"""Build the verified wildlife import from a local, deduplicated photo inventory.

Usage: python scripts/import_photos.py /path/to/inventory.json /path/to/originals
Original files are never modified. Classification is reviewed before running.
"""
import hashlib
import json
import re
import sys
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

from PIL import Image, ImageOps

ROOT = Path(__file__).resolve().parents[1]
IMPORT = ROOT / "imports" / "2026-10-10"
CREATED = "2026-10-10T23:00:00Z"


def digest(path):
    data = path.read_bytes()
    return hashlib.sha256(data).hexdigest(), hashlib.sha1(
        b"blob " + str(len(data)).encode() + b"\0" + data
    ).hexdigest()


def prepare(item):
    original, album, source_dir, note, caption = item
    path = source_dir / original["file"]
    assert digest(path)[0] == original["sha256"], f"Changed original: {path.name}"
    photo_id = "photo-" + original["sha256"][:24]
    image = f"images/{album['id']}/{photo_id}.jpg"
    thumbnail = f"images/{album['id']}/{photo_id}-thumb.jpg"
    output = ROOT / "docs" / image
    output.parent.mkdir(parents=True, exist_ok=True)
    original_exif = original["exif"]
    stamp = original_exif["DateTimeOriginal"]
    assert re.fullmatch(r"\d{4}:\d{2}:\d{2} \d{2}:\d{2}:\d{2}", stamp)
    offset = original_exif.get("OffsetTimeOriginal", "")
    with Image.open(path) as source:
        icc = source.info.get("icc_profile")
        im = ImageOps.exif_transpose(source).convert("RGB")
        im.thumbnail((3200, 3200), Image.Resampling.LANCZOS)
        exif = Image.Exif()
        exif[274] = 1
        exif[315] = "Joseph Botros"
        exif[33432] = original_exif.get("Copyright", "JB Photography")
        exif[34665] = {36867: stamp, 36868: stamp, 40962: im.width, 40963: im.height}
        if re.fullmatch(r"[+-]\d{2}:\d{2}", offset):
            exif[34665][36881] = offset
        im.save(output, "JPEG", quality=90, subsampling=0, optimize=True,
                progressive=True, exif=exif, icc_profile=icc)
        width, height = im.size
        im.thumbnail((800, 800), Image.Resampling.LANCZOS)
        im.save(ROOT / "docs" / thumbnail, "JPEG", quality=86,
                optimize=True, progressive=True, icc_profile=icc)
    photo = dict(id=photo_id, birdId=album["id"], width=width, height=height,
                 originalName=original["file"], capturedOn=stamp[:10].replace(":", "-"),
                 capturedTime=stamp[11:19], captureOffset=offset,
                 location="", caption=caption, createdAt=CREATED,
                 image=image, thumbnail=thumbnail)
    if note:
        photo["identificationNote"] = note
    assets = []
    for relative in [image, thumbnail]:
        target = ROOT / "docs" / relative
        sha256, git_sha = digest(target)
        assets.append(dict(path="docs/" + relative, bytes=target.stat().st_size,
                           sha256=sha256, gitBlobSha=git_sha))
    provenance = dict(originalName=original["file"], originalSha256=original["sha256"],
                      originalBytes=original["bytes"], originalWidth=original["width"],
                      originalHeight=original["height"], photoId=photo_id,
                      albumId=album["id"], capturedOn=photo["capturedOn"],
                      capturedTime=photo["capturedTime"], captureOffset=offset)
    return photo, assets, provenance


def main():
    catalogue_path = ROOT / "docs" / "birds.json"
    if catalogue_path.exists() and json.loads(catalogue_path.read_text()).get("birds"):
        raise SystemExit("The catalogue already contains photographs. Recreate this import in a separate workspace with an empty catalogue to protect later edits.")
    inventory = json.loads(Path(sys.argv[1]).read_text())
    originals = Path(sys.argv[2])
    classification = json.loads((IMPORT / "classification.json").read_text())
    source = {photo["file"]: photo for photo in inventory["photos"]}
    files = [name for album in classification["albums"] for name in album["files"]]
    assert len(files) == len(set(files)) == len(source) == 177
    assert set(files) == set(source)
    assert len({photo["sha256"] for photo in source.values()}) == 177
    tasks = [(source[name], album, originals,
              classification["photoNotes"].get(name, ""),
              classification["captions"].get(name, ""))
             for album in classification["albums"] for name in album["files"]]
    with ThreadPoolExecutor(max_workers=3) as pool:
        prepared = list(pool.map(prepare, tasks))
    photos = {photo["originalName"]: photo for photo, _, _ in prepared}
    catalogue = {"version": 1, "birds": []}
    for album in classification["albums"]:
        bird = {key: album[key] for key in ["id", "name", "scientificName", "family", "kind"]}
        bird["createdAt"] = CREATED
        bird["coverPhotoId"] = photos[album["coverFile"]]["id"]
        bird["photos"] = sorted([photos[name] for name in album["files"]],
                                key=lambda photo: (photo["capturedOn"], photo["capturedTime"], photo["originalName"]))
        if album.get("identificationNote"):
            bird["identificationNote"] = album["identificationNote"]
        catalogue["birds"].append(bird)
    catalogue["birds"].sort(key=lambda bird: bird["name"].lower())
    (ROOT / "docs" / "birds.json").write_text(json.dumps(catalogue, indent=2, ensure_ascii=False) + "\n")
    assets = [asset for _, items, _ in prepared for asset in items]
    (IMPORT / "assets.json").write_text(json.dumps(assets, indent=2) + "\n")
    provenance = [item for _, _, item in prepared]
    # Public provenance deliberately excludes camera serial numbers and raw EXIF/XMP.
    (IMPORT / "photos.json").write_text(json.dumps(provenance, indent=2) + "\n")
    summary = dict(uniqueImages=177, archiveEntries=inventory["archiveEntries"],
                   duplicateEntries=inventory["archiveEntries"]-177,
                   birdAlbums=sum(b["kind"] == "bird" for b in catalogue["birds"]),
                   wildlifeAlbums=sum(b["kind"] == "wildlife" for b in catalogue["birds"]),
                   captureDates=177, captureTimes=177, gpsLocations=0, writtenLocations=0,
                   displayAssets=len(assets), displayBytes=sum(a["bytes"] for a in assets),
                   originalsModified=False, displayLongEdge=3200)
    (IMPORT / "summary.json").write_text(json.dumps(summary, indent=2) + "\n")
    print(json.dumps(summary, indent=2))


if __name__ == "__main__":
    main()

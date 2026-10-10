import type { Bird, BirdPhoto, Change, Collection } from "./models.ts";

export const nameKey = (name: string) => name.trim().normalize("NFKC").toLocaleLowerCase("en");
const idOK = (id: unknown): id is string => typeof id === "string" && /^[a-zA-Z0-9-]{1,80}$/.test(id);
const fieldOK = (v: unknown,max: number): v is string => typeof v === "string" && v.length <= max;
export function validateCollection(value: unknown): asserts value is Collection {
  if (!value || typeof value !== "object" || !("version" in value) || value.version !== 1 || !("birds" in value) || !Array.isArray(value.birds)) throw Error("The bird catalogue has an unsupported format.");
  const birdIds = new Set<string>(), names = new Set<string>(), photoIds = new Set<string>(), paths = new Set<string>();
  for (const bird of value.birds as Bird[]) {
    if (!idOK(bird.id) || birdIds.has(bird.id) || !fieldOK(bird.name,160) || !bird.name.trim() || names.has(nameKey(bird.name)) || !fieldOK(bird.scientificName,160) || !fieldOK(bird.family,100) || !fieldOK(bird.createdAt,40) || !Array.isArray(bird.photos)) throw Error("The catalogue contains an invalid or duplicate bird.");
    if ((bird.kind !== undefined && bird.kind !== "bird" && bird.kind !== "wildlife") || (bird.identificationNote !== undefined && !fieldOK(bird.identificationNote,600))) throw Error("The catalogue contains invalid album details.");
    birdIds.add(bird.id); names.add(nameKey(bird.name));
    for (const photo of bird.photos as BirdPhoto[]) {
      if (!idOK(photo.id) || photoIds.has(photo.id) || photo.birdId !== bird.id || !Number.isInteger(photo.width) || photo.width < 1 || !Number.isInteger(photo.height) || photo.height < 1 || !fieldOK(photo.originalName,255) || !fieldOK(photo.caption,600) || !fieldOK(photo.location,160) || !fieldOK(photo.capturedOn,10) || !fieldOK(photo.createdAt,40)) throw Error("The catalogue contains an invalid photograph.");
      if (photo.capturedOn && (!/^\d{4}-\d{2}-\d{2}$/.test(photo.capturedOn) || new Date(photo.capturedOn+"T12:00:00Z").toISOString().slice(0,10) !== photo.capturedOn)) throw Error("Choose a valid date for the photograph.");
      if (photo.capturedTime !== undefined && (!fieldOK(photo.capturedTime,8) || (photo.capturedTime && !/^(?:[01]\d|2[0-3]):[0-5]\d(?::[0-5]\d)?$/.test(photo.capturedTime)))) throw Error("Choose a valid time for the photograph.");
      if (photo.captureOffset !== undefined && (!fieldOK(photo.captureOffset,6) || (photo.captureOffset && !/^[+-](?:0\d|1[0-4]):[0-5]\d$/.test(photo.captureOffset)))) throw Error("The photograph has an invalid camera time offset.");
      if (photo.identificationNote !== undefined && !fieldOK(photo.identificationNote,600)) throw Error("The photograph has invalid identification details.");
      photoIds.add(photo.id);
      for (const path of [photo.image,photo.thumbnail]) {
        if (typeof path !== "string" || !new RegExp(`^images/${bird.id}/${photo.id}(?:-thumb)?\\.(?:jpg|png|webp|avif)$`).test(path) || paths.has(path)) throw Error("The catalogue contains an invalid photograph path.");
        paths.add(path);
      }
    }
    if (bird.coverPhotoId !== null && !bird.photos.some(p=>p.id===bird.coverPhotoId)) throw Error("The album cover must belong to this bird.");
  }
}

const editablePhotoFields = ["capturedOn","capturedTime","captureOffset","location","caption"] as const;

// Merge additions and per-photo details without replacing another editor's changes.
export function mergeChanges(remote: Collection,changes: Change[]): Collection {
  validateCollection(remote);
  const result: Collection = structuredClone(remote);
  const seen = new Set<string>();
  for (const change of changes) {
    const bird = change.bird, base = change.base;
    if (seen.has(bird.id)) throw Error("This batch contains the same bird twice.");
    seen.add(bird.id);
    const current = result.birds.find(item=>item.id===bird.id);
    if (!base) {
      if (current || result.birds.some(item=>nameKey(item.name)===nameKey(bird.name))) throw Error(`${bird.name} was already added on GitHub. Review the published collection before retrying.`);
      result.birds.push(structuredClone(bird));
      continue;
    }
    if (!current || current.id !== base.id || bird.id !== base.id) throw Error(`${bird.name} changed on GitHub. Review the published collection before retrying.`);
    for (const local of bird.photos) {
      const original = base.photos.find(photo=>photo.id===local.id);
      if (!original) continue;
      for (const key of editablePhotoFields) {
        if ((local[key] || "") === (original[key] || "")) continue;
        const published = current.photos.find(photo=>photo.id===local.id);
        if (!published || ((published[key] || "") !== (original[key] || "") && (published[key] || "") !== (local[key] || ""))) throw Error(`${local.originalName}'s ${key} changed on GitHub. Review it before publishing your draft.`);
        published[key] = local[key] || "";
      }
    }
    const added = bird.photos.filter(photo=>!base.photos.some(original=>original.id===photo.id));
    for (const photo of added) {
      const duplicate=current.photos.find(item=>item.id===photo.id);
      if (duplicate && JSON.stringify(duplicate)!==JSON.stringify(photo)) throw Error("A photograph changed on GitHub. Your draft is still saved.");
      if (!duplicate) current.photos.push(structuredClone(photo));
    }
    if (bird.coverPhotoId !== base.coverPhotoId) {
      if (current.coverPhotoId !== base.coverPhotoId && current.coverPhotoId !== bird.coverPhotoId) throw Error(`${bird.name}'s cover changed on GitHub. Review it before publishing your draft.`);
      current.coverPhotoId=bird.coverPhotoId;
    }
  }
  validateCollection(result);
  return result;
}

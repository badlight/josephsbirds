# Joseph's Birds

A bird photography gallery for Joseph Botros, with the cream and bronze styling of Joseph's Coins. Each species has its own album, full-size display photographs, thumbnails, individual capture dates/times, optional locations/captions, and a selectable cover. Other wildlife has its own filter.

This is a separate project intended for `badlight/josephsbirds`. The first import contains **177 unique photographs** in **40 bird albums and 4 other-wildlife albums**. Three ZIPs contained 185 entries; eight byte-identical duplicate entries were counted once. All 177 have an EXIF capture date and time. None contains usable GPS coordinates or written location tags, so the gallery says “Location not recorded.” A few inferred species identifications are explicitly provisional.

## GitHub Pages

The complete static website is in `docs/`. In GitHub repository Settings → Pages, choose **Deploy from a branch**, **main**, **/docs**, then Save. The intended address is `https://badlight.github.io/josephsbirds/`.

The built website has no server, database, third-party analytics, or required paid services. Display photos, thumbnails, and catalogue records are stored in this repository. The first import uses high-quality JPEG display copies up to 3200 pixels on the long edge, with camera capture timestamps and copyright metadata preserved. The supplied originals were left unchanged; they are not included in this repository because their combined size exceeds the GitHub Pages site limit. `.nojekyll` allows GitHub Pages to serve the build directly.

## Add photographs

1. Open **Manage collection** in the gallery footer.
2. Choose **Add a bird**, enter its common name, select photographs, and choose **Prepare photographs** to review the optimized copies and metadata. Scientific name, family, capture date, location, and caption are optional. JPEG, PNG, WebP, and AVIF are supported up to 80 MB per source file.
3. Save to a draft. Draft photographs are kept locally in this browser using IndexedDB; they are not visible to other visitors.
4. Open an album to add more photographs or choose its cover. **Edit photo details** lets you enter an individual location, date, time, and caption for the selected photo, then save those changes to your draft. The public gallery also has an **Edit photo** button beneath every selected photograph’s details; it opens the manager and editor for that exact photo.
5. Choose **Publish draft**. Supply a fine-grained GitHub token for `badlight/josephsbirds` with **Contents: Read and write**, limited to this one repository. The token stays in memory for that publish and is cleared afterward. Do not place tokens in source files or send them in chat.

Publishing creates one Git commit for the catalogue and its photos. Existing albums and unrelated repository files are preserved. Concurrent album additions are merged; conflicting cover or same-field photo-detail changes stop with a review message. Changes to different fields are merged without losing either editor’s work. The branch update never force-pushes. GitHub Pages may take a minute to show an accepted publish.

## Image viewer

Photographs reach the top of the viewer. Simple `<` and `>` arrows appear at the image edges on hover and remain available on touch devices. Image controls sit in the cream section of the card, with rounded beige buttons and bronze text. Zoom, drag-to-pan, double-click zoom, keyboard navigation, fullscreen, photo download, shareable album URLs, and cover selection are included. There is no comparison feature or number-of-number header.

## Maps and review filters

Switch between **Albums** and **Map** on the main page. The heatmap counts photographs at recorded GPS locations; **Pins** opens photo previews. Year, location, family, wildlife type, and recently-photographed sorting work with both views. Each album also has its own **Species heatmap**.

In **Edit photo details**, choose **Choose on map**. Search for a nearby city, click the actual photo location, drag the pin to refine it, or enter latitude and longitude. Clearing both coordinates removes the GPS location. Coordinates are included in the public catalogue when the draft is published. No coordinates were guessed for the first 177 photos; the maps initially show zero mapped photos until genuine locations are entered.

The manager adds **Pending edits**, **Missing location label**, **Missing GPS**, **Needs identification review**, and **Trash** filters. Browser-local browsing preferences and a **Resume last photograph** button help continue a review session.

## Album and photo organization

**Manage album** edits the common/scientific names, family, wildlife type, and identification note. It can merge an album into another or move an album to Trash. **Organize this photograph** moves a photo between albums, changes its order, or moves it to Trash. The Trash filter provides restoration controls. These actions are saved to the existing browser draft and become public in one publish.

Moves and merges retain immutable image paths. Trash retains records and files for restoration; it removes photos/albums from the public gallery after publishing. Concurrent independent metadata edits merge; competing edits to the same field or photo ownership stop publication for review.

## Smarter photo imports

The uploader accepts JPEG, PNG, WebP, and AVIF files up to 80 MB each. **Prepare photographs** reads individual EXIF capture dates/times and GPS when available, skips exact SHA-256 duplicates, and creates JPEG display copies up to 3200 pixels plus 800-pixel thumbnails. Source files are untouched. The review table lists read/missing metadata and skipped files before saving. Optional batch values only fill blank fields, including a fallback map pin; they do not overwrite existing timestamps or GPS.

Original-file SHA-256 fingerprints were added to the initial 177 catalogue records from the verified import manifest. All other imported metadata and image paths were preserved.

Maps use Leaflet and OpenStreetMap raster tiles with visible attribution and ordinary browser caching; there is no tile prefetching or bulk downloading. City lookup is a user-triggered Open-Meteo/GeoNames search, cached within the session. It zooms the picker to a city; the user still chooses the actual photo location. Map modules load only when used. Third-party network failures leave numeric coordinate entry available.

## Development

```sh
npm install
npm test
npm run build
```

The React/TypeScript source is in `src/`. **Never delete `docs/` or overwrite its `birds.json` and `images/` with a starter build.** Vite is configured to preserve those user records when rebuilding. Built application files are committed for branch-based GitHub Pages deployment. When changing source, first fetch the current repository including all published photos, then rebuild and commit only the intended changes.

Tests cover catalogue validation, merging concurrent changes, image publication, and rejected branch updates.

## Import provenance

`imports/2026-10-10/` records the reviewed species grouping, original filenames and hashes, individual camera timestamps, generated asset hashes, and verified counts. Camera serial numbers and raw EXIF/XMP are excluded from public records. `scripts/import_photos.py` recreates the web copies from the local deduplicated inventory and originals (requires Python and Pillow). Run it in a separate workspace with an empty catalogue; it refuses to replace existing records. It verifies all 177 originals by SHA-256 and does not modify them.


## Collection views and photo workflow

- **Contact sheet** (photo manager): select photos across filtered views and apply checked location, caption, outing, GPS, favourite, or album changes as one atomic draft. Camera dates/times and original image paths are preserved. Fill-blanks-only keeps recorded values. The selection and unfinished batch form survive reloads in this browser.
- **Photo details**: unfinished fields autosave locally, separately from the publish queue. Reopening restores the form; same-field changes since the form was started require review. Save to draft queues the edit for publication. Discard unfinished edits resets only that photo's form.
- **Saved shooting locations**: named GPS pins are private to the browser. Choose a saved place to apply its label and coordinates to a photo, a batch, or importer fallback fields. Applying a location to photos makes it public when the draft is published.
- **Highlights**: mark favourites in the photo viewer or contact sheet, then publish the draft. The public Highlights view shows those photographs separately from the albums.
- **Journal**: first/last photographed dates, annual photographed-species totals, and outings. Set the same outing/trip name on multiple photos to group a trip across dates. Unnamed outings group by camera date and location label. Non-bird wildlife appears in outings but is excluded from photographed bird-species totals. Gallery filters apply to journal statistics.

Existing catalogue version 1 remains supported. `favourite` (boolean) and `trip` (up to 100 characters) are optional per-photo fields. Both use the existing conflict-aware publication and draft storage flow. Unfinished forms and saved places are browser-local; staged photo metadata reaches GitHub only through Publish draft.

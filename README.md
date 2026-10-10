# Joseph's Birds

A bird photography gallery for Joseph Botros, with the cream and bronze styling of Joseph's Coins. Each species has its own album, original photographs, thumbnails, optional date/location/caption, and a selectable cover.

This is a separate project intended for `badlight/josephsbirds`. No bird photographs have been added yet.

## GitHub Pages

The complete static website is in `docs/`. In GitHub repository Settings → Pages, choose **Deploy from a branch**, **main**, **/docs**, then Save. The intended address is `https://badlight.github.io/josephsbirds/`.

The built website has no server, database, third-party analytics, or required paid services. All original photos and catalogue records are stored in this repository. `.nojekyll` allows GitHub Pages to serve the build directly.

## Add photographs

1. Open **Manage collection** in the gallery footer.
2. Choose **Add a bird**, enter its common name, and select photographs. Scientific name, family, capture date, location, and caption are optional. JPEG, PNG, WebP, and AVIF are supported up to 20 MB per file.
3. Save to a draft. Draft photographs are kept locally in this browser using IndexedDB; they are not visible to other visitors.
4. Open an album to add more photographs or choose its cover.
5. Choose **Publish draft**. Supply a fine-grained GitHub token for `badlight/josephsbirds` with **Contents: Read and write**, limited to this one repository. The token stays in memory for that publish and is cleared afterward. Do not place tokens in source files or send them in chat.

Publishing creates one Git commit for the catalogue and its photos. Existing albums and unrelated repository files are preserved. Concurrent album additions are merged; conflicting cover changes stop with a review message. The branch update never force-pushes. GitHub Pages may take a minute to show an accepted publish.

## Image viewer

Photographs reach the top of the viewer. Simple `<` and `>` arrows appear at the image edges on hover and remain available on touch devices. Image controls are rounded and light against black. Zoom, drag-to-pan, double-click zoom, keyboard navigation, fullscreen, original download, shareable album URLs, and cover selection are included. There is no comparison feature or number-of-number header.

## Development

```sh
npm install
npm test
npm run build
```

The React/TypeScript source is in `src/`. **Never delete `docs/` or overwrite its `birds.json` and `images/` with a starter build.** Vite is configured to preserve those user records when rebuilding. Built application files are committed for branch-based GitHub Pages deployment. When changing source, first fetch the current repository including all published photos, then rebuild and commit only the intended changes.

Tests cover catalogue validation, merging concurrent changes, image publication, and rejected branch updates.

export type BirdPhoto = {
  id: string; birdId: string; width: number; height: number;
  originalName: string; capturedOn: string; location: string; caption: string;
  createdAt: string; image: string; thumbnail: string;
};
export type Bird = {
  id: string; name: string; scientificName: string; family: string;
  coverPhotoId: string | null; createdAt: string; photos: BirdPhoto[];
};
export type Collection = { version: 1; birds: Bird[] };
export type Catalogue = Collection & { canManage: boolean; draftCount: number };
export type Asset = { path: string; blob: Blob };
export type Change = { bird: Bird; base: Bird | null; assets: Asset[] };

const previews = new Map<string,string>();
export function setPhotoPreviews(assets: Asset[]) {
  for (const url of previews.values()) URL.revokeObjectURL(url);
  previews.clear();
  for (const asset of assets) previews.set(asset.path,URL.createObjectURL(asset.blob));
}
export const photoUrl = (photo: BirdPhoto, thumbnail = false) => {
  const path = thumbnail ? photo.thumbnail : photo.image;
  return previews.get(path) || new URL(path,window.location.href.split("?")[0]).href;
};

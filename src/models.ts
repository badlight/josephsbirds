export type GPSLocation = { latitude:number; longitude:number; source?:"manual"|"exif" };
export type BirdPhoto = {
  id: string; birdId: string; width: number; height: number;
  originalName: string; capturedOn: string; location: string; caption: string;
  capturedTime?: string; captureOffset?: string; identificationNote?: string;
  gps?:GPSLocation; originalSha256?:string; sortOrder?:number; trashedAt?:string;
  favourite?:boolean; trip?:string;
  createdAt: string; image: string; thumbnail: string;
};
export type Bird = {
  id: string; name: string; scientificName: string; family: string;
  coverPhotoId: string | null; createdAt: string; photos: BirdPhoto[];
  kind?: "bird" | "wildlife"; identificationNote?: string;
  archivedAt?:string;
};
export type Collection = { version: 1; birds: Bird[] };
export type Catalogue = Collection & { canManage: boolean; draftCount: number; pendingPhotoIds?:string[]; pendingAlbumIds?:string[] };
export type Asset = { path: string; blob: Blob };
export type Change = { bird: Bird; base: Bird | null; assets: Asset[] };
export type PhotoDetails = Pick<BirdPhoto,"capturedOn" | "capturedTime" | "captureOffset" | "location" | "caption" | "gps" | "identificationNote" | "trip">;
export type AlbumDetails = Pick<Bird,"name"|"scientificName"|"family"|"kind"|"identificationNote">;
export type PreparedPhoto = {file:File;thumbnail:File;width:number;height:number;originalName:string;originalSha256:string;details:PhotoDetails};

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


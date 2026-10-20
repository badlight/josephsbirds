import { nameKey,mergeChanges,validateCollection,activeCollection,draftIdentifiers } from "./collection.ts";
import { setPhotoPreviews,type Asset,type Bird,type BirdPhoto,type Catalogue,type Change,type Collection,type PhotoDetails,type AlbumDetails } from "./models.ts";
import { publishChanges } from "./publisher.ts";

export const manageMode = new URL(window.location.href).searchParams.get("manage") === "1";
let database: Promise<IDBDatabase>|undefined;
let collection: Collection|undefined;
let changes: Change[]=[];
let writes: Promise<unknown>=Promise.resolve();
function openDatabase() {
  if(!window.indexedDB) return Promise.reject(Error("Draft storage is unavailable in this browser."));
  if(!database) database=new Promise((resolve,reject)=>{
    const request=window.indexedDB.open("josephs-birds-editor-v1",1);
    request.onupgradeneeded=()=>request.result.createObjectStore("drafts");
    request.onsuccess=()=>resolve(request.result);
    request.onerror=()=>{database=undefined;reject(request.error);};
  });
  return database;
}
async function readDraft(): Promise<Change[]> {
  const db=await openDatabase();
  return new Promise((resolve,reject)=>{
    const transaction=db.transaction("drafts","readonly"),request=transaction.objectStore("drafts").get("current");
    request.onsuccess=()=>resolve(request.result||[]);
    request.onerror=()=>reject(request.error);
  });
}
async function writeDraft(next: Change[]) {
  next=next.filter(c=>{const ids=draftIdentifiers([c]);return ids.pendingPhotoIds.length||ids.pendingAlbumIds.length||c.assets.length;});
  const db=await openDatabase();
  await new Promise<void>((resolve,reject)=>{
    const transaction=db.transaction("drafts","readwrite");
    transaction.objectStore("drafts").put(next,"current");
    transaction.oncomplete=()=>resolve();
    transaction.onerror=()=>reject(transaction.error);
    transaction.onabort=()=>reject(transaction.error||Error("Draft saving was interrupted."));
  });
  changes=next;
}
function serialize<T>(task:()=>Promise<T>): Promise<T> {
  const next=writes.then(task);
  writes=next.catch(()=>{});
  return next;
}
export async function loadCatalogue(): Promise<Catalogue> {
  if(!collection) {
    const response=await fetch("./birds.json",{cache:"no-store"});
    if(!response.ok) throw Error("The bird collection could not be loaded. Please try again.");
    const value:unknown=await response.json();validateCollection(value);
    const saved=manageMode?await readDraft():[];
    mergeChanges(value,saved);
    collection=value;changes=saved;
  }
  const visible=manageMode?mergeChanges(collection,changes):collection;
  setPhotoPreviews(manageMode?changes.flatMap(change=>change.assets):[]);
  return {...(manageMode?{...visible,birds:visible.birds.map(b=>({...b,photos:[...b.photos].sort((a,b)=>(a.sortOrder??Number.MAX_SAFE_INTEGER)-(b.sortOrder??Number.MAX_SAFE_INTEGER))}))}:activeCollection(visible)),canManage:manageMode,draftCount:changes.length,...draftIdentifiers(changes)};
}
function editingBird(id: string): Change {
  const existing=changes.find(change=>change.bird.id===id);
  if(existing) return structuredClone(existing);
  const bird=collection?.birds.find(bird=>bird.id===id);
  if(!bird) throw Error("That bird album could not be found.");
  return {bird:structuredClone(bird),base:structuredClone(bird),assets:[]};
}
const extension: Record<string,string>={"image/jpeg":"jpg","image/png":"png","image/webp":"webp","image/avif":"avif"};
export async function stagePhotos(input: {birdId?:string;name:string;scientificName:string;family:string;capturedOn:string;location:string;caption:string;photos:{file:File;thumbnail:File;width:number;height:number;details?:PhotoDetails;originalName?:string;originalSha256?:string}[]}) {
  return serialize(async()=>{
    if(!manageMode) throw Error("Open the photo manager to add photographs.");
    const current=await loadCatalogue();
    let change:Change;
    if(input.birdId) change=editingBird(input.birdId);
    else {
      const name=input.name.trim();
      if(!name) throw Error("Enter the bird's common name.");
      if(current.birds.some(bird=>!bird.archivedAt&&nameKey(bird.name)===nameKey(name))) throw Error("This bird already has an album. Open it and choose Add photos.");
      const bird:Bird={id:crypto.randomUUID(),name,scientificName:input.scientificName.trim(),family:input.family.trim(),createdAt:new Date().toISOString(),coverPhotoId:null,photos:[]};
      change={bird,base:null,assets:[]};
    }
    if(!input.photos.length) throw Error("Select at least one photograph.");
    let firstId="";
    const knownHashes=new Set(current.birds.flatMap(b=>b.photos.map(p=>p.originalSha256).filter(Boolean)));
    for(const item of input.photos) {
      const ext=extension[item.file.type];
      if(!ext||item.file.size>20*1024*1024||item.file.size===0) throw Error("Choose JPEG, PNG, WebP, or AVIF photographs up to 20 MB each.");
      if(item.originalSha256&&knownHashes.has(item.originalSha256))throw Error(item.originalName+" is already in the collection or this batch.");
      if(item.originalSha256)knownHashes.add(item.originalSha256);
      const id=crypto.randomUUID(),image=`images/${change.bird.id}/${id}.${ext}`,thumbnail=`images/${change.bird.id}/${id}-thumb.jpg`;
      const photo:BirdPhoto={id,birdId:change.bird.id,width:item.width,height:item.height,originalName:item.originalName||item.file.name,...(item.details||{capturedOn:input.capturedOn,location:input.location.trim(),caption:input.caption.trim()}),originalSha256:item.originalSha256,createdAt:new Date().toISOString(),image,thumbnail};
      change.bird.photos.push(photo);change.assets.push({path:image,blob:item.file},{path:thumbnail,blob:item.thumbnail});
      firstId ||= id;
      change.bird.coverPhotoId ||= id;
    }
    const next=[...changes.filter(item=>item.bird.id!==change.bird.id),change];
    mergeChanges(collection!,next); // Validate the complete batch before saving any files.
    await writeDraft(next);
    return {birdId:change.bird.id,photoId:firstId};
  });
}
export async function stageCover(birdId: string,photoId: string) {
  return serialize(async()=>{
    if(!manageMode) throw Error("Open the photo manager to change an album cover.");
    await loadCatalogue();const change=editingBird(birdId);
    if(!change.bird.photos.some(photo=>photo.id===photoId)) throw Error("Choose a photograph from this bird's album.");
    change.bird.coverPhotoId=photoId;
    const next=[...changes.filter(item=>item.bird.id!==birdId),change];mergeChanges(collection!,next);await writeDraft(next);
  });
}
export async function stagePhotoDetails(birdId:string,photoId:string,details:PhotoDetails) {
  return serialize(async()=>{
    if(!manageMode) throw Error("Open the photo manager to edit photo details.");
    await loadCatalogue();const change=editingBird(birdId);
    const photo=change.bird.photos.find(item=>item.id===photoId);
    if(!photo) throw Error("That photograph could not be found.");
    photo.capturedOn=details.capturedOn;
    photo.capturedTime=details.capturedTime?.trim()||"";
    photo.captureOffset=details.captureOffset?.trim()||"";
    photo.location=details.location.trim();photo.caption=details.caption.trim();
    if(Object.hasOwn(details,"gps"))photo.gps=details.gps;
    if(Object.hasOwn(details,"identificationNote"))photo.identificationNote=details.identificationNote;
    if(Object.hasOwn(details,"trip"))photo.trip=details.trip?.trim()||'';
    const next=[...changes.filter(item=>item.bird.id!==birdId),change];
    mergeChanges(collection!,next);await writeDraft(next);
  });
}
export async function publishDraft(token: string,onProgress: (message:string)=>void) {
  return serialize(async()=>{
    if(!manageMode) throw Error("Open the photo manager to publish your draft.");
    await loadCatalogue();const result=await publishChanges({token,changes,onProgress});
    // Persist the accepted catalogue before clearing local files. Pages may take a minute to update.
    collection=result.catalogue;
    try {await writeDraft([]);} catch {changes=[];throw Error("Published to GitHub, but this browser could not clear its draft. Do not publish it again; reload the manager after the site updates.");}
    return result;
  });
}
export async function discardDraft() {
  return serialize(async()=>{if(!manageMode)throw Error("Open the photo manager first.");await writeDraft([]);});
}


function stageEdit(task:(edit:(id:string)=>Change,current:Catalogue)=>void){
  return serialize(async()=>{
    if(!manageMode)throw Error('Open the photo manager to edit the collection.');
    const current=await loadCatalogue();
    const draft=new Map(changes.map(c=>[c.bird.id,structuredClone(c)]));
    const edit=(id:string)=>{let c=draft.get(id);if(!c){c=editingBird(id);draft.set(id,c);}return c;};
    task(edit,current);const next=[...draft.values()];mergeChanges(collection!,next);await writeDraft(next);
  });
}
export const stageAlbumDetails=(birdId:string,details:AlbumDetails)=>stageEdit(edit=>{
  const b=edit(birdId).bird;Object.assign(b,{...details,name:details.name.trim(),scientificName:details.scientificName.trim(),family:details.family.trim()});
});
function resetCover(b:Bird){if(!b.photos.some(p=>p.id===b.coverPhotoId&&!p.trashedAt))b.coverPhotoId=b.photos.find(p=>!p.trashedAt)?.id||null;}
function transfer(source:Change,target:Change,ids:Set<string>){
  if(source.bird.id===target.bird.id)throw Error('Choose a different album.');
  const moved=source.bird.photos.filter(p=>ids.has(p.id)),paths=new Set(moved.flatMap(p=>[p.image,p.thumbnail]));
  const offset=target.bird.photos.reduce((n,p)=>Math.max(n,(p.sortOrder??target.bird.photos.indexOf(p))+1),0);
  moved.forEach((p,i)=>{p.birdId=target.bird.id;p.sortOrder=offset+i;});
  target.bird.photos.push(...moved);source.bird.photos=source.bird.photos.filter(p=>!ids.has(p.id));
  target.assets.push(...source.assets.filter(a=>paths.has(a.path)));source.assets=source.assets.filter(a=>!paths.has(a.path));resetCover(source.bird);resetCover(target.bird);
}
export const stageMovePhoto=(fromId:string,toId:string,photoId:string)=>stageEdit(edit=>{
  const source=edit(fromId),target=edit(toId);if(target.bird.archivedAt)throw Error('Restore the destination album first.');
  if(!source.bird.photos.some(p=>p.id===photoId))throw Error('That photograph could not be found.');
  transfer(source,target,new Set([photoId]));
});
export const stageMergeAlbum=(fromId:string,toId:string)=>stageEdit(edit=>{
  const source=edit(fromId),target=edit(toId);if(target.bird.archivedAt)throw Error('Restore the destination album first.');
  transfer(source,target,new Set(source.bird.photos.map(p=>p.id)));source.bird.archivedAt=new Date().toISOString();
});
export const stageAlbumArchive=(birdId:string,archived:boolean)=>stageEdit(edit=>{const b=edit(birdId).bird;b.archivedAt=archived?new Date().toISOString():undefined;});
export const stagePhotoTrash=(birdId:string,photoId:string,trashed:boolean)=>stageEdit(edit=>{
  const b=edit(birdId).bird,p=b.photos.find(p=>p.id===photoId);if(!p)throw Error('That photograph could not be found.');p.trashedAt=trashed?new Date().toISOString():undefined;resetCover(b);
});
export const stagePhotoOrder=(birdId:string,ids:string[])=>stageEdit(edit=>{
  const b=edit(birdId).bird,active=b.photos.filter(p=>!p.trashedAt);
  if(new Set(ids).size!==active.length||ids.length!==active.length||active.some(p=>!ids.includes(p.id)))throw Error('The album changed. Reopen it before reordering.');
  for(const p of active)p.sortOrder=ids.indexOf(p.id);
});

export type PhotoSelection={birdId:string;photoId:string};
export type BulkPhotoPatch=Partial<Pick<BirdPhoto,'location'|'caption'|'gps'|'trip'|'favourite'>>;
export const stageBatchPhotoEdits=(selection:PhotoSelection[],patch:BulkPhotoPatch,targetAlbumId?:string,fillOnly=false)=>stageEdit((edit,current)=>{
  if(!selection.length)throw Error('Select at least one photograph.');
  const keys=Object.keys(patch);if(keys.some(k=>!['location','caption','gps','trip','favourite'].includes(k)))throw Error('That field cannot be edited in a batch.');
  if(!keys.length&&!targetAlbumId)throw Error('Choose at least one change to apply.');
  const seen=new Set<string>(),moves=new Map<string,Set<string>>();
  const target=targetAlbumId?edit(targetAlbumId):undefined;
  if(target?.bird.archivedAt)throw Error('Restore the destination album first.');
  for(const item of selection){
    if(seen.has(item.photoId))throw Error('The same photograph was selected twice.');seen.add(item.photoId);
    const source=edit(item.birdId),p=source.bird.photos.find(p=>p.id===item.photoId);
    if(!p||p.trashedAt||source.bird.archivedAt||!current.birds.some(b=>b.id===item.birdId))throw Error('A selected photograph changed. Refresh the contact sheet and select it again.');
    for(const key of keys as (keyof BulkPhotoPatch)[]){if(fillOnly&&p[key]!==undefined&&p[key]!=='')continue;Object.assign(p,{[key]:structuredClone(patch[key])});}
    if(target&&target.bird.id!==source.bird.id){const ids=moves.get(source.bird.id)||new Set<string>();ids.add(p.id);moves.set(source.bird.id,ids);}
  }
  if(target)for(const [sourceId,ids] of moves)transfer(edit(sourceId),target,ids);
});
export const stageFavourite=(birdId:string,photoId:string,favourite:boolean)=>stageBatchPhotoEdits([{birdId,photoId}],{favourite});

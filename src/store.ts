import { nameKey,mergeChanges,validateCollection } from "./collection";
import { setPhotoPreviews,type Asset,type Bird,type BirdPhoto,type Catalogue,type Change,type Collection } from "./models";
import { publishChanges } from "./publisher";

export const manageMode = new URL(window.location.href).searchParams.get("manage") === "1";
let database: Promise<IDBDatabase>|undefined;
let collection: Collection|undefined;
let changes: Change[]=[];
let writes: Promise<unknown>=Promise.resolve();
function openDatabase() {
  if(!window.indexedDB) return Promise.reject(Error("Draft storage is unavailable in this browser."));
  if(!database) database=new Promise((resolve,reject)=>{
    const request=indexedDB.open("josephs-birds-editor-v1",1);
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
  return {...visible,canManage:manageMode,draftCount:changes.length};
}
function editingBird(id: string): Change {
  const existing=changes.find(change=>change.bird.id===id);
  if(existing) return structuredClone(existing);
  const bird=collection?.birds.find(bird=>bird.id===id);
  if(!bird) throw Error("That bird album could not be found.");
  return {bird:structuredClone(bird),base:structuredClone(bird),assets:[]};
}
const extension: Record<string,string>={"image/jpeg":"jpg","image/png":"png","image/webp":"webp","image/avif":"avif"};
export async function stagePhotos(input: {birdId?:string;name:string;scientificName:string;family:string;capturedOn:string;location:string;caption:string;photos:{file:File;thumbnail:File;width:number;height:number}[]}) {
  return serialize(async()=>{
    if(!manageMode) throw Error("Open the photo manager to add photographs.");
    const current=await loadCatalogue();
    let change:Change;
    if(input.birdId) change=editingBird(input.birdId);
    else {
      const name=input.name.trim();
      if(!name) throw Error("Enter the bird's common name.");
      if(current.birds.some(bird=>nameKey(bird.name)===nameKey(name))) throw Error("This bird already has an album. Open it and choose Add photos.");
      const bird:Bird={id:crypto.randomUUID(),name,scientificName:input.scientificName.trim(),family:input.family.trim(),createdAt:new Date().toISOString(),coverPhotoId:null,photos:[]};
      change={bird,base:null,assets:[]};
    }
    if(!input.photos.length) throw Error("Select at least one photograph.");
    let firstId="";
    for(const item of input.photos) {
      const ext=extension[item.file.type];
      if(!ext||item.file.size>20*1024*1024||item.file.size===0) throw Error("Choose JPEG, PNG, WebP, or AVIF photographs up to 20 MB each.");
      const id=crypto.randomUUID(),image=`images/${change.bird.id}/${id}.${ext}`,thumbnail=`images/${change.bird.id}/${id}-thumb.jpg`;
      const photo:BirdPhoto={id,birdId:change.bird.id,width:item.width,height:item.height,originalName:item.file.name,capturedOn:input.capturedOn,location:input.location.trim(),caption:input.caption.trim(),createdAt:new Date().toISOString(),image,thumbnail};
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

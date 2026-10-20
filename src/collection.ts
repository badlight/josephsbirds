import type { Bird, BirdPhoto, Change, Collection, GPSLocation } from './models.ts';

export const nameKey=(name:string)=>name.trim().normalize('NFKC').toLocaleLowerCase('en');
const idOK=(v:unknown):v is string=>typeof v==='string'&&/^[a-zA-Z0-9-]{1,80}$/.test(v);
const fieldOK=(v:unknown,max:number):v is string=>typeof v==='string'&&v.length<=max;
const stampOK=(v:unknown)=>v===undefined||(typeof v==='string'&&/^\d{4}-\d{2}-\d{2}T/.test(v)&&Number.isFinite(Date.parse(v)));
export function validGPS(value:unknown):value is GPSLocation {
  if(!value||typeof value!=='object')return false;
  const v=value as GPSLocation;
  return Number.isFinite(v.latitude)&&Math.abs(v.latitude)<=90&&Number.isFinite(v.longitude)&&Math.abs(v.longitude)<=180&&(v.source===undefined||v.source==='manual'||v.source==='exif');
}
export function validateCollection(value:unknown):asserts value is Collection {
  if(!value||typeof value!=='object'||!('version'in value)||value.version!==1||!('birds'in value)||!Array.isArray(value.birds))throw Error('The bird catalogue has an unsupported format.');
  const ids=new Set<string>(),names=new Set<string>(),photoIds=new Set<string>(),paths=new Set<string>();
  for(const b of value.birds as Bird[]){
    if(!idOK(b.id)||ids.has(b.id)||!fieldOK(b.name,160)||!b.name.trim()||!fieldOK(b.scientificName,160)||!fieldOK(b.family,100)||!fieldOK(b.createdAt,40)||!Array.isArray(b.photos))throw Error('The catalogue contains an invalid or duplicate bird.');
    if((!b.archivedAt&&names.has(nameKey(b.name)))||(b.kind!==undefined&&!['bird','wildlife'].includes(b.kind))||(b.identificationNote!==undefined&&!fieldOK(b.identificationNote,600))||!stampOK(b.archivedAt))throw Error('The catalogue contains invalid or duplicate album details.');
    ids.add(b.id);if(!b.archivedAt)names.add(nameKey(b.name));
    for(const p of b.photos){
      if(!idOK(p.id)||photoIds.has(p.id)||p.birdId!==b.id||!Number.isInteger(p.width)||p.width<1||!Number.isInteger(p.height)||p.height<1||!fieldOK(p.originalName,255)||!fieldOK(p.caption,600)||!fieldOK(p.location,160)||!fieldOK(p.capturedOn,10)||!fieldOK(p.createdAt,40))throw Error('The catalogue contains an invalid photograph.');
      if(p.capturedOn&&(!/^\d{4}-\d{2}-\d{2}$/.test(p.capturedOn)||new Date(p.capturedOn+'T12:00:00Z').toISOString().slice(0,10)!==p.capturedOn))throw Error('Choose a valid date for the photograph.');
      if(p.capturedTime!==undefined&&(!fieldOK(p.capturedTime,8)||(p.capturedTime&&!/^(?:[01]\d|2[0-3]):[0-5]\d(?::[0-5]\d)?$/.test(p.capturedTime))))throw Error('Choose a valid time for the photograph.');
      if((p.favourite!==undefined&&typeof p.favourite!=='boolean')||(p.trip!==undefined&&!fieldOK(p.trip,100)))throw Error('The photograph has invalid highlight or outing details.');
      if(p.captureOffset!==undefined&&(!fieldOK(p.captureOffset,6)||(p.captureOffset&&!/^[+-](?:0\d|1[0-4]):[0-5]\d$/.test(p.captureOffset))))throw Error('The photograph has an invalid camera time offset.');
      if((p.gps!==undefined&&!validGPS(p.gps))||(p.identificationNote!==undefined&&!fieldOK(p.identificationNote,600))||!stampOK(p.trashedAt)||(p.sortOrder!==undefined&&(!Number.isFinite(p.sortOrder)||p.sortOrder<0))||(p.originalSha256!==undefined&&!/^[a-f0-9]{64}$/.test(p.originalSha256)))throw Error('The photograph has invalid location or management details.');
      photoIds.add(p.id);
      for(const path of [p.image,p.thumbnail]){
        if(typeof path!=='string'||!new RegExp('^images/[a-zA-Z0-9-]{1,80}/'+p.id+'(?:-thumb)?\\.(?:jpg|png|webp|avif)$').test(path)||paths.has(path))throw Error('The catalogue contains an invalid photograph path.');
        paths.add(path);
      }
    }
    if(b.coverPhotoId!==null&&!b.photos.some(p=>p.id===b.coverPhotoId))throw Error('The album cover must belong to this bird.');
  }
}
export const editablePhotoFields=['capturedOn','capturedTime','captureOffset','location','caption','gps','identificationNote','sortOrder','trashedAt','favourite','trip'] as const;
const albumFields=['name','scientificName','family','kind','identificationNote','archivedAt'] as const;
const immutablePhotoFields=['id','width','height','originalName','createdAt','image','thumbnail','originalSha256'] as const;
function same(key:string,a:unknown,b:unknown){const norm=(v:unknown)=>key==='kind'?(v||'bird'):key==='favourite'?(v===true):key==='gps'||key==='sortOrder'?(v??null):(v??'');return JSON.stringify(norm(a))===JSON.stringify(norm(b));}

// Resolve photo ownership across the entire batch before applying any moves.
// Images keep their original, immutable paths when moving between albums.
export function mergeChanges(remote:Collection,changes:Change[]):Collection {
  validateCollection(remote);
  const result=structuredClone(remote),seen=new Set<string>();
  const desired=new Map<string,{photo:BirdPhoto;birdId:string}>(),originals=new Map<string,{photo:BirdPhoto;birdId:string}>();
  for(const c of changes){
    if(seen.has(c.bird.id))throw Error('This batch contains the same bird twice.');seen.add(c.bird.id);
    for(const p of c.bird.photos){if(desired.has(p.id))throw Error('A photograph cannot belong to two albums.');desired.set(p.id,{photo:p,birdId:c.bird.id});}
    for(const p of c.base?.photos||[])originals.set(p.id,{photo:p,birdId:c.base!.id});
  }
  for(const c of changes){
    const local=c.bird,base=c.base,current=result.birds.find(b=>b.id===local.id);
    if(!base){
      if(current||result.birds.some(b=>!b.archivedAt&&!local.archivedAt&&nameKey(b.name)===nameKey(local.name)))throw Error(local.name+' was already added on GitHub. Review the collection before retrying.');
      // Photos are merged below, including existing photographs moved into a new album.
      result.birds.push({...structuredClone(local),coverPhotoId:null,photos:[]});continue;
    }
    if(!current||current.id!==base.id||local.id!==base.id)throw Error(local.name+' changed on GitHub. Review it before publishing.');
    for(const key of albumFields){
      if(same(key,local[key],base[key]))continue;
      if(!same(key,current[key],base[key])&&!same(key,current[key],local[key]))throw Error(local.name+"'s "+key+' changed on GitHub. Review it before publishing.');
      Object.assign(current,{[key]:local[key]});
    }
    for(const p of base.photos)if(!desired.has(p.id))throw Error('Move photographs to Trash instead of removing their records.');
  }
  for(const {photo:local,birdId} of desired.values()){
    const original=originals.get(local.id),target=result.birds.find(b=>b.id===birdId)!;
    let owner=result.birds.find(b=>b.photos.some(p=>p.id===local.id));
    let published=owner?.photos.find(p=>p.id===local.id);
    if(!original){
      if(published){if(JSON.stringify(published)!==JSON.stringify(local))throw Error('A photograph changed on GitHub. Your draft is still saved.');}
      else target.photos.push(structuredClone(local));
      continue;
    }
    for(const key of immutablePhotoFields)if(!same(key,local[key],original.photo[key]))throw Error('Published image files and original metadata cannot be replaced while editing details.');
    if(!published||!owner||(owner.id!==original.birdId&&owner.id!==birdId))throw Error(local.originalName+' moved or was removed on GitHub. Review it before publishing.');
    for(const key of editablePhotoFields){
      if(same(key,local[key],original.photo[key]))continue;
      if(!same(key,published[key],original.photo[key])&&!same(key,published[key],local[key]))throw Error(local.originalName+"'s "+key+' changed on GitHub. Review it before publishing your draft.');
      Object.assign(published,{[key]:structuredClone(local[key])});
    }
    if(owner.id!==birdId){owner.photos=owner.photos.filter(p=>p.id!==local.id);published.birdId=birdId;target.photos.push(published);}
  }
  for(const c of changes){
    const current=result.birds.find(b=>b.id===c.bird.id)!;
    if(!c.base){current.coverPhotoId=c.bird.coverPhotoId;continue;}
    if(c.bird.coverPhotoId!==c.base.coverPhotoId){
      if(current.coverPhotoId!==c.base.coverPhotoId&&current.coverPhotoId!==c.bird.coverPhotoId)throw Error(c.bird.name+"'s cover changed on GitHub. Review it before publishing.");
      current.coverPhotoId=c.bird.coverPhotoId;
    }
    if(current.coverPhotoId&&!current.photos.some(p=>p.id===current.coverPhotoId))current.coverPhotoId=current.photos.find(p=>!p.trashedAt)?.id||null;
  }
  validateCollection(result);return result;
}
export function activeCollection(c:Collection):Collection {
  return {version:1,birds:c.birds.filter(b=>!b.archivedAt).map(b=>({...b,photos:b.photos.filter(p=>!p.trashedAt).sort((a,b)=>(a.sortOrder??Number.MAX_SAFE_INTEGER)-(b.sortOrder??Number.MAX_SAFE_INTEGER))}))};
}
export function draftIdentifiers(changes:Change[]){
  const photos=new Set<string>(),albums=new Set<string>();
  for(const c of changes){
    if(!c.base||albumFields.some(k=>!same(k,c.bird[k],c.base![k]))||c.bird.coverPhotoId!==c.base.coverPhotoId)albums.add(c.bird.id);
    for(const p of c.bird.photos){const old=c.base?.photos.find(x=>x.id===p.id);if(!old||editablePhotoFields.some(k=>!same(k,p[k],old[k])))photos.add(p.id);}
    if(c.base?.photos.some(p=>!c.bird.photos.some(x=>x.id===p.id)))albums.add(c.bird.id);
  }
  return {pendingPhotoIds:[...photos],pendingAlbumIds:[...albums]};
}

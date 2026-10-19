import test from 'node:test';
import assert from 'node:assert/strict';
import exifr from 'exifr';
import { IDBFactory } from 'fake-indexeddb';
import { mergeChanges,validateCollection,activeCollection,draftIdentifiers,validGPS } from '../src/collection.ts';
import { metadataDetails } from '../src/photo-import.ts';
import { locationBounds,locatedPhotos } from '../src/geo.ts';
import { browseBirds } from '../src/browse.ts';
const photo=(id,birdId='a')=>({id,birdId,width:1200,height:800,originalName:id+'.jpg',capturedOn:'2025-12-31',capturedTime:'23:59:59',location:'',caption:'',createdAt:'2026-10-10T00:00:00Z',image:'images/'+birdId+'/'+id+'.jpg',thumbnail:'images/'+birdId+'/'+id+'-thumb.jpg'});
const bird=(id,name,photos=[])=>({id,name,scientificName:'',family:'Anatidae',createdAt:'2026-10-10T00:00:00Z',coverPhotoId:photos[0]?.id||null,photos});
const catalogue=()=>({version:1,birds:[bird('a','Goldeneye',[photo('one'),photo('two')]),bird('b','Merganser',[photo('three','b')])]});
const changes=(remote)=>remote.birds.map(base=>({base:structuredClone(base),bird:structuredClone(base),assets:[]}));

test('album rename and photo GPS merge with independent remote edits',()=>{
 const remote=catalogue(),batch=changes(remote);batch[0].bird.name='Common Goldeneye';batch[0].bird.photos[0].gps={latitude:0,longitude:0,source:'manual'};remote.birds[0].family='Updated family';remote.birds[0].photos[0].caption='Remote caption';
 const result=mergeChanges(remote,batch);assert.equal(result.birds[0].family,'Updated family');assert.equal(result.birds[0].photos[0].caption,'Remote caption');assert.deepEqual(result.birds[0].photos[0].gps,{latitude:0,longitude:0,source:'manual'});assert.equal(result.birds[0].name,'Common Goldeneye');
});
test('moving a photo keeps its image paths and concurrent metadata',()=>{
 const remote=catalogue(),batch=changes(remote),moved=batch[0].bird.photos.shift();moved.birdId='b';batch[1].bird.photos.push(moved);batch[0].bird.coverPhotoId='two';remote.birds[0].photos[0].caption='Keep this caption';
 const result=mergeChanges(remote,batch),target=result.birds[1].photos.find(p=>p.id==='one');assert.equal(result.birds[0].photos.length,1);assert.equal(target.image,'images/a/one.jpg');assert.equal(target.caption,'Keep this caption');assert.equal(target.birdId,'b');assert.doesNotThrow(()=>validateCollection(result));
});
test('moves reject competing remote ownership changes without mutating remote',()=>{
 const remote=catalogue(),batch=changes(remote),moved=batch[0].bird.photos.shift();moved.birdId='b';batch[1].bird.photos.push(moved);batch[0].bird.coverPhotoId='two';remote.birds.push(bird('c','Heron',[]));const r=remote.birds[0].photos.shift();r.birdId='c';remote.birds[2].photos.push(r);remote.birds[0].coverPhotoId='two';remote.birds[2].coverPhotoId='one';const snapshot=structuredClone(remote);assert.throws(()=>mergeChanges(remote,batch),/moved or was removed/);assert.deepEqual(remote,snapshot);
});
test('trash and archived albums retain records while leaving the public collection and maps',()=>{
 const data=catalogue();data.birds[0].photos[0].gps={latitude:45,longitude:-75};data.birds[0].photos[0].trashedAt='2026-10-19T12:00:00Z';data.birds[1].archivedAt='2026-10-19T12:00:00Z';const active=activeCollection(data);assert.equal(active.birds.length,1);assert.deepEqual(active.birds[0].photos.map(p=>p.id),['two']);assert.equal(locatedPhotos(data.birds).length,0);assert.equal(data.birds.flatMap(b=>b.photos).length,3);
});
test('GPS pairs are atomic and invalid coordinates cannot be published',()=>{
 assert.equal(validGPS({latitude:0,longitude:0}),true);for(const gps of [{latitude:91,longitude:0},{latitude:0,longitude:-181},{latitude:NaN,longitude:20},{latitude:45}]){const data=catalogue();data.birds[0].photos[0].gps=gps;assert.throws(()=>validateCollection(data));}
 const remote=catalogue(),batch=changes(remote);remote.birds[0].photos[0].gps={latitude:45,longitude:-75};batch[0].bird.photos[0].gps={latitude:46,longitude:-76};assert.throws(()=>mergeChanges(remote,batch),/gps changed/);
});
test('heatmap counts photos per species and fits date-line locations correctly',()=>{
 const data=catalogue();data.birds[0].photos.forEach(p=>p.gps={latitude:45,longitude:-75});data.birds[1].photos[0].gps={latitude:-35,longitude:149};assert.equal(locatedPhotos(data.birds).length,3);assert.equal(locatedPhotos([data.birds[0]]).length,2);const bounds=locationBounds([{latitude:10,longitude:179},{latitude:20,longitude:-179}]);assert.equal(bounds[1][1]-bounds[0][1],2);assert.equal(locationBounds([]),null);
});
test('review filters combine filename, year, location, pending status, and trash',()=>{
 const c={...catalogue(),canManage:true,draftCount:1,pendingPhotoIds:['two']};c.birds[0].photos[1].location='Ottawa wetland';const f={query:'two.jpg',family:'',kind:'',year:'2025',location:'ottawa',status:'pending',sort:'name'};assert.deepEqual(browseBirds(c,f).flatMap(b=>b.photos.map(p=>p.id)),['two']);assert.equal(browseBirds(c,{...f,year:'2024'}).length,0);c.birds[0].photos[0].trashedAt='2026-10-19T12:00:00Z';assert.deepEqual(browseBirds(c,{...f,query:'',year:'',location:'',status:'trash'}).flatMap(b=>b.photos.map(p=>p.id)),['one']);
});
test('EXIF timestamps retain camera time and zero-valued GPS',()=>{
 const details=metadataDetails({DateTimeOriginal:'2025:01:02 23:59:59',OffsetTimeOriginal:'+10:00',latitude:0,longitude:0});assert.equal(details.capturedOn,'2025-01-02');assert.equal(details.capturedTime,'23:59:59');assert.equal(details.captureOffset,'+10:00');assert.deepEqual(details.gps,{latitude:0,longitude:0,source:'exif'});assert.equal(metadataDetails({DateTimeOriginal:'2025:02:30 10:00:00'}).capturedOn,'');
});
test('the EXIF parser and importer preserve a real TIFF capture timestamp without timezone conversion',async()=>{
 const buffer=Buffer.alloc(83);buffer.write('II',0);buffer.writeUInt16LE(42,2);buffer.writeUInt32LE(8,4);buffer.writeUInt16LE(1,8);buffer.writeUInt16LE(0x8769,10);buffer.writeUInt16LE(4,12);buffer.writeUInt32LE(1,14);buffer.writeUInt32LE(26,18);buffer.writeUInt16LE(2,26);buffer.writeUInt16LE(0x9003,28);buffer.writeUInt16LE(2,30);buffer.writeUInt32LE(20,32);buffer.writeUInt32LE(56,36);buffer.writeUInt16LE(0x9011,40);buffer.writeUInt16LE(2,42);buffer.writeUInt32LE(7,44);buffer.writeUInt32LE(76,48);buffer.write('2025:01:02 23:59:59\0',56);buffer.write('+10:00\0',76);const raw=await exifr.parse(buffer,{reviveValues:false});const details=metadataDetails(raw);assert.equal(details.capturedOn,'2025-01-02');assert.equal(details.capturedTime,'23:59:59');assert.equal(details.captureOffset,'+10:00');
});
let session=0;
async function store(remote=catalogue()){
 globalThis.window={location:{href:'https://example.test/josephsbirds/?manage=1'},indexedDB:new IDBFactory()};globalThis.fetch=async()=>new Response(JSON.stringify(remote),{status:200});return import('../src/store.ts?test='+ ++session);
}
test('GPS edits survive reloading the browser store and flag only the changed photo',async()=>{
 const s=await store();await s.loadCatalogue();await s.stagePhotoDetails('a','one',{capturedOn:'2025-12-31',capturedTime:'23:59:59',location:'Wetland',caption:'',gps:{latitude:45,longitude:-75,source:'manual'}});const reopened=await import('../src/store.ts?test='+ ++session);const visible=await reopened.loadCatalogue();assert.equal(visible.birds[0].photos[0].gps.latitude,45);assert.equal(visible.birds[0].photos[1].capturedTime,'23:59:59');assert.deepEqual(visible.pendingPhotoIds,['one']);
});
test('album merge stages atomically, survives reload, and retains every image path',async()=>{
 const s=await store();await s.loadCatalogue();await s.stageMergeAlbum('a','b');const reopened=await import('../src/store.ts?test='+ ++session),c=await reopened.loadCatalogue();assert.equal(c.birds[0].photos.length,0);assert.ok(c.birds[0].archivedAt);assert.equal(c.birds[1].photos.length,3);assert.equal(c.birds[1].photos.find(p=>p.id==='one').image,'images/a/one.jpg');assert.equal(activeCollection(c).birds.length,1);
});
test('trash can be restored and reordering survives a fresh store',async()=>{
 const s=await store();await s.loadCatalogue();await s.stagePhotoTrash('a','one',true);assert.equal(activeCollection(await s.loadCatalogue()).birds[0].photos.length,1);await s.stagePhotoTrash('a','one',false);await s.stagePhotoOrder('a',['two','one']);const reopened=await import('../src/store.ts?test='+ ++session);assert.deepEqual((await reopened.loadCatalogue()).birds[0].photos.map(p=>p.id),['two','one']);
});
test('invalid edits do not replace an already saved draft',async()=>{
 const s=await store();await s.loadCatalogue();await s.stageAlbumDetails('a',{name:'Common Goldeneye',scientificName:'',family:'Anatidae'});const before=await s.loadCatalogue();await assert.rejects(s.stagePhotoDetails('a','one',{capturedOn:'2025-12-31',location:'',caption:'',gps:{latitude:200,longitude:0}}));assert.deepEqual(await s.loadCatalogue(),before);
});
test('no-op saves do not create a pending batch',async()=>{
 const s=await store();const c=await s.loadCatalogue(),p=c.birds[0].photos[0];await s.stagePhotoDetails('a','one',{capturedOn:p.capturedOn,capturedTime:p.capturedTime,location:'',caption:''});assert.equal((await s.loadCatalogue()).draftCount,0);
});
test('moving an unpublished photo also moves its staged assets',async()=>{
 const s=await store();await s.loadCatalogue();const f=new File([new Uint8Array([1,2,3])],'new.jpg',{type:'image/jpeg'}),result=await s.stagePhotos({birdId:'a',name:'',scientificName:'',family:'',capturedOn:'2024-06-16',location:'Wetland',caption:'',photos:[{file:f,thumbnail:f,width:1200,height:800,originalSha256:'a'.repeat(64)}]});
 await s.stageMovePhoto('a','b',result.photoId);const visible=await s.loadCatalogue();assert.equal(visible.birds[1].photos.find(p=>p.id===result.photoId).birdId,'b');
 const db=await new Promise((resolve,reject)=>{const req=window.indexedDB.open('josephs-birds-editor-v1',1);req.onsuccess=()=>resolve(req.result);req.onerror=()=>reject(req.error);});
 const saved=await new Promise((resolve,reject)=>{const req=db.transaction('drafts').objectStore('drafts').get('current');req.onsuccess=()=>resolve(req.result);req.onerror=()=>reject(req.error);});assert.equal(saved.length,1);assert.equal(saved[0].bird.id,'b');assert.equal(saved[0].assets.length,2);assert.ok(saved[0].assets.every(a=>a.path.startsWith('images/a/')));db.close();
});
test('exact duplicates are rejected without partially saving a batch',async()=>{
 const remote=catalogue();remote.birds[0].photos[0].originalSha256='a'.repeat(64);const s=await store(remote);const before=await s.loadCatalogue(),f=new File([new Uint8Array([1,2,3])],'same.jpg',{type:'image/jpeg'});
 await assert.rejects(s.stagePhotos({birdId:'a',name:'',scientificName:'',family:'',capturedOn:'',location:'',caption:'',photos:[{file:f,thumbnail:f,width:100,height:100,originalSha256:'b'.repeat(64)},{file:f,thumbnail:f,width:100,height:100,originalSha256:'a'.repeat(64)}]}),/already in the collection/);assert.deepEqual(await s.loadCatalogue(),before);
});

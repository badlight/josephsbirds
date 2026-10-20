import test from 'node:test';
import assert from 'node:assert/strict';
import {IDBFactory} from 'fake-indexeddb';
import {photoForm,saveWorkingPhoto,loadWorkingPhoto,clearWorkingPhoto,savePlace,loadPlaces,removePlace} from '../src/editor-memory.ts';
import {speciesJournal} from '../src/journal.ts';
import {mergeChanges,validateCollection} from '../src/collection.ts';
const values=new Map();globalThis.localStorage={getItem:k=>values.get(k)??null,setItem:(k,v)=>values.set(k,v),removeItem:k=>values.delete(k)};
const photo=(id,birdId='a')=>({id,birdId,width:1200,height:800,originalName:id+'.jpg',capturedOn:'2025-12-31',capturedTime:'23:59:59',captureOffset:'-05:00',location:'',caption:'',createdAt:'2026-10-10T00:00:00Z',image:'images/'+birdId+'/'+id+'.jpg',thumbnail:'images/'+birdId+'/'+id+'-thumb.jpg'});
const bird=(id,name,photos)=>({id,name,scientificName:'',family:'',createdAt:'2026-10-10T00:00:00Z',coverPhotoId:photos[0]?.id||null,photos});
const catalogue=()=>({version:1,birds:[bird('a','Goldeneye',[photo('one'),photo('two')]),bird('b','Merganser',[photo('three','b')])]});
async function store(data=catalogue()) {globalThis.window={location:{href:'https://birds.test/?manage=1'},indexedDB:new IDBFactory()};globalThis.fetch=async()=>({ok:true,json:async()=>structuredClone(data)});const s=await import('../src/store.ts?workflow='+Math.random());await s.loadCatalogue();return s;}

test('unfinished photo forms restore independently, rebase untouched fields, and detect same-field conflicts',()=>{
 values.clear();const p=photo('one'),f={...photoForm(p),caption:'Still editing',latitude:'0',longitude:'0'};saveWorkingPhoto(p,f);const q=photo('two');saveWorkingPhoto(q,{...photoForm(q),location:'Wetland'});
 assert.equal(loadWorkingPhoto(p).form.caption,'Still editing');assert.equal(loadWorkingPhoto(q).form.location,'Wetland');
 const changed={...p,location:'Published location'};assert.equal(loadWorkingPhoto(changed).form.location,'Published location');assert.deepEqual(loadWorkingPhoto(changed).conflicts,[]);
 assert.deepEqual(loadWorkingPhoto({...p,caption:'Another edit'}).conflicts,['caption']);clearWorkingPhoto(p.id);assert.equal(loadWorkingPhoto(p).restored,false);assert.equal(loadWorkingPhoto(q).restored,true);
});
test('saved places retain valid zero coordinates, update a named place, and survive reloading',()=>{
 values.clear();savePlace('Equator',{latitude:0,longitude:0});assert.equal(loadPlaces()[0].gps.longitude,0);const id=loadPlaces()[0].id;savePlace('Equator',{latitude:1,longitude:2});assert.equal(loadPlaces().length,1);assert.equal(loadPlaces()[0].id,id);assert.throws(()=>savePlace('Invalid',{latitude:91,longitude:4}));removePlace(id);assert.equal(loadPlaces().length,0);
});
test('batch photo changes and album transfers persist atomically while preserving timestamps, GPS and assets',async()=>{
 const data=catalogue();data.birds[0].photos[0].gps={latitude:0,longitude:0,source:'exif'};const s=await store(data);
 await s.stageBatchPhotoEdits([{birdId:'a',photoId:'one'},{birdId:'a',photoId:'two'}],{caption:'Trip caption',trip:'Winter visit',favourite:true},'b');
 const c=await s.loadCatalogue();assert.equal(c.birds[0].photos.length,0);assert.equal(c.birds[1].photos.length,3);const p=c.birds[1].photos.find(p=>p.id==='one');assert.equal(p.birdId,'b');assert.equal(p.image,'images/a/one.jpg');assert.equal(p.capturedTime,'23:59:59');assert.equal(p.captureOffset,'-05:00');assert.deepEqual(p.gps,{latitude:0,longitude:0,source:'exif'});assert.equal(p.trip,'Winter visit');assert.equal(p.favourite,true);
 const fresh=await import('../src/store.ts?reloaded='+Math.random()),again=await fresh.loadCatalogue();assert.equal(again.birds[1].photos.find(p=>p.id==='two').caption,'Trip caption');assert.ok(again.pendingPhotoIds.includes('one'));
});
test('batch fill-only preserves existing metadata and invalid batches leave the prior draft intact',async()=>{
 const d=catalogue();d.birds[0].photos[0].location='Original';d.birds[0].photos[0].gps={latitude:0,longitude:0};const s=await store(d);const selection=[{birdId:'a',photoId:'one'},{birdId:'a',photoId:'two'}];
 await s.stageBatchPhotoEdits(selection,{location:'New place',gps:{latitude:40,longitude:20}},undefined,true);let c=await s.loadCatalogue();assert.equal(c.birds[0].photos[0].location,'Original');assert.equal(c.birds[0].photos[0].gps.latitude,0);assert.equal(c.birds[0].photos[1].location,'New place');
 await assert.rejects(s.stageBatchPhotoEdits(selection,{gps:{latitude:91,longitude:20}}));c=await s.loadCatalogue();assert.equal(c.birds[0].photos[1].gps.latitude,40);await assert.rejects(s.stageBatchPhotoEdits([...selection,{birdId:'a',photoId:'missing'}],{caption:'Must not save'}));assert.equal((await s.loadCatalogue()).birds[0].photos[0].caption,'');
});
test('highlight and trip edits merge unrelated remote updates and reject competing favourites',()=>{
 const remote=catalogue(),base=structuredClone(remote.birds[0]),local=structuredClone(base);local.photos[0].favourite=true;local.photos[0].trip='Spring';remote.birds[0].photos[0].caption='Remote caption';const c=mergeChanges(remote,[{base,bird:local,assets:[]}]);assert.equal(c.birds[0].photos[0].caption,'Remote caption');assert.equal(c.birds[0].photos[0].favourite,true);
 assert.throws(()=>validateCollection({version:1,birds:[{...local,photos:[{...local.photos[0],favourite:'yes'},local.photos[1]]}]}));
});
test('journal counts species once per year, excludes wildlife from the bird list and groups named trips across dates',()=>{
 const d=catalogue();d.birds[0].photos[0].capturedOn='2024-01-01';d.birds[0].photos.forEach(p=>p.trip='Winter trip');d.birds.push({...bird('c','Beaver',[{...photo('four','c'),trip:'Winter trip'}]),kind:'wildlife'});d.birds[1].photos[0].trashedAt='2026-10-10T00:00:00Z';
 const j=speciesJournal(d.birds);assert.equal(j.entries.length,1);assert.equal(j.entries[0].first,'2024-01-01');assert.equal(j.entries[0].last,'2025-12-31');assert.equal(j.years.find(y=>y.year==='2025').species,1);assert.equal(j.outings.length,1);assert.equal(j.outings[0].photos.length,3);assert.equal(j.outings[0].species.size,1);
});

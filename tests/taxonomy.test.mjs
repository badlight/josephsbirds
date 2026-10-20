import test from 'node:test';
import assert from 'node:assert/strict';
import {IDBFactory} from 'fake-indexeddb';
import {applyBirdTaxonomy,birdNameKey,changeBirdName,createBirdTaxonomyLookup,emptyTaxonomyFields,parseBirdSearch,parseBirdTaxonomy} from '../src/bird-taxonomy.ts';
const robin={id:12727,name:'Turdus migratorius',preferred_common_name:'American Robin',rank:'species',is_active:true,ancestor_ids:[1,2,3,15977],ancestors:[{id:3,rank:'class',name:'Aves'},{id:15977,rank:'family',name:'Turdidae'}]};
const body=(results,total_results=results.length)=>({results,total_results});
const signal=()=>new AbortController().signal;

test('exact common names auto-match accepted bird species and normalize punctuation',()=>{
 assert.equal(parseBirdSearch(body([robin]),'  american ROBIN ').automatic.id,12727);
 const hawk={...robin,id:1579017,name:'Astur cooperii',preferred_common_name:"Cooper's Hawk"};
 assert.equal(parseBirdSearch(body([hawk]),'Cooper’s Hawk').automatic.scientificName,'Astur cooperii');
 assert.equal(birdNameKey('Black–capped Chickadee'),birdNameKey('Black-capped chickadee'));
});
test('broad, ambiguous and incomplete searches require an explicit choice',()=>{
 const european={...robin,id:13094,name:'Erithacus rubecula',preferred_common_name:'European Robin',matched_term:'Robin'};
 assert.equal(parseBirdSearch(body([robin,european],118),'Robin').automatic,null);
 assert.equal(parseBirdSearch(body([robin,{...robin,id:2}]),'American Robin').automatic,null);
 assert.equal(parseBirdSearch(body([robin],50),'American Robin').automatic,null);
 assert.equal(parseBirdSearch(body([robin]),'American Rob').automatic,null);
});
test('non-birds, inactive names and higher ranks cannot fill the form',()=>{
 const result=parseBirdSearch(body([{...robin,ancestor_ids:[1,2],ancestors:[]},{...robin,is_active:false},{...robin,rank:'genus'},robin,robin]),'American Robin');
 assert.equal(result.matches.length,1);assert.equal(result.automatic.id,12727);
 assert.deepEqual(parseBirdSearch(body([]),'Something unknown'),{matches:[],automatic:null});
 assert.throws(()=>parseBirdSearch({error:'bad response'},'Robin'));
});
test('family comes from the family ancestor and must belong to the selected species',()=>{
 assert.deepEqual(parseBirdTaxonomy(body([robin]),12727),{id:12727,commonName:'American Robin',scientificName:'Turdus migratorius',family:'Turdidae'});
 assert.throws(()=>parseBirdTaxonomy(body([{...robin,ancestors:[{rank:'subfamily',name:'Wrong rank'}]}]),12727));
 assert.throws(()=>parseBirdTaxonomy(body([robin]),13094));
});
test('late matches cannot overwrite another species or manual edits',()=>{
 const taxon=parseBirdTaxonomy(body([robin]),12727);let fields={...emptyTaxonomyFields(),name:'American Robin'};
 fields=applyBirdTaxonomy(fields,'American Robin',taxon);assert.equal(fields.family,'Turdidae');
 const next=changeBirdName(fields,'Blue Jay');assert.equal(next.scientificName,'');assert.equal(next.family,'');
 assert.strictEqual(applyBirdTaxonomy(next,'American Robin',taxon),next);
 const manual={...fields,scientificName:'My correction',manualScientific:true,family:'',manualFamily:true};
 assert.deepEqual(applyBirdTaxonomy(manual,'American Robin',taxon),manual);
 const chosen=applyBirdTaxonomy(manual,'American Robin',taxon,true);assert.equal(chosen.scientificName,'Turdus migratorius');assert.equal(chosen.family,'Turdidae');assert.equal(chosen.manualScientific,false);
 assert.equal(changeBirdName(manual,'Blue Jay').scientificName,'My correction');
});
test('lookup uses a public credential-free API, caches successes and passes cancellation',async()=>{
 const calls=[],fetcher=async(url,options)=>{calls.push({url,options});return {ok:true,json:async()=>body([robin])};};
 const lookup=createBirdTaxonomyLookup(fetcher);assert.equal((await lookup.search('American Robin',signal())).automatic.id,12727);
 await lookup.search(' american robin ',signal());assert.equal(calls.length,1);
 assert.equal(new URL(calls[0].url).searchParams.get('taxon_id'),'3');assert.equal(calls[0].options.credentials,'omit');assert.equal(calls[0].options.referrerPolicy,'no-referrer');
 assert.equal((await lookup.details(12727,signal())).family,'Turdidae');await lookup.details(12727,signal());assert.equal(calls.length,2);
 const controller=new AbortController();controller.abort();await assert.rejects(lookup.search('American Robin',controller.signal));assert.equal(calls.length,2);
});
test('failures are retryable, short inputs skip requests and aborted responses are never cached',async()=>{
 let calls=0;const lookup=createBirdTaxonomyLookup(async()=>({ok:++calls>1,json:async()=>body([robin])}));
 await lookup.search('ab',signal());assert.equal(calls,0);await assert.rejects(lookup.search('American Robin',signal()));assert.equal((await lookup.search('American Robin',signal())).automatic.id,12727);assert.equal(calls,2);
 const controller=new AbortController();let attempts=0;
 const cancelled=createBirdTaxonomyLookup(async()=>({ok:true,json:async()=>{if(++attempts===1)controller.abort();return body([robin]);}}));
 await assert.rejects(cancelled.search('American Robin',controller.signal));await cancelled.search('American Robin',signal());assert.equal(attempts,2);
});
test('automatically filled taxonomy survives saving a new album and reloading the draft',async()=>{
 globalThis.window={location:{href:'https://birds.test/?manage=1'},indexedDB:new IDBFactory()};
 globalThis.fetch=async()=>({ok:true,json:async()=>({version:1,birds:[]})});
 const store=await import('../src/store.ts?taxonomy-draft');await store.loadCatalogue();
 const fields=applyBirdTaxonomy({...emptyTaxonomyFields(),name:'American Robin'},'American Robin',parseBirdTaxonomy(body([robin]),12727));
 const file=new File([new Uint8Array([1,2,3])],'robin.jpg',{type:'image/jpeg'});
 const result=await store.stagePhotos({name:fields.name,scientificName:fields.scientificName,family:fields.family,capturedOn:'2026-10-20',location:'',caption:'',photos:[{file,thumbnail:file,width:100,height:100,originalSha256:'b'.repeat(64)}]});
 const fresh=await import('../src/store.ts?taxonomy-reloaded'),catalogue=await fresh.loadCatalogue();
 const bird=catalogue.birds.find(b=>b.id===result.birdId);assert.equal(bird.scientificName,'Turdus migratorius');assert.equal(bird.family,'Turdidae');assert.equal(bird.photos.length,1);
});

import test from "node:test";
import assert from "node:assert/strict";
import { mergeChanges,validateCollection } from "../src/collection.ts";
import { publishChanges } from "../src/publisher.ts";

const photo=(id,birdId="bird-1")=>({id,birdId,width:1200,height:800,originalName:`${id}.jpg`,capturedOn:"2026-10-09",location:"",caption:"",createdAt:"2026-10-09T00:00:00Z",image:`images/${birdId}/${id}.jpg`,thumbnail:`images/${birdId}/${id}-thumb.jpg`});
const bird=(id="bird-1",name="Chickadee",photos=[photo("photo-1",id)])=>({id,name,scientificName:"",family:"",createdAt:"2026-10-09T00:00:00Z",coverPhotoId:photos[0]?.id||null,photos});
const collection=birds=>({version:1,birds});
const assets=p=>[p.image,p.thumbnail].map(path=>({path,blob:new Blob([new Uint8Array([1,2,3])],{type:"image/jpeg"})}));

test("publishing preserves concurrently added photos and unrelated albums",()=>{
  const base=bird(),local=structuredClone(base);local.photos.push(photo("local"));
  const remoteBird=structuredClone(base);remoteBird.photos.push(photo("remote"));
  const other=bird("bird-2","Heron",[photo("other","bird-2")]);
  const remote=collection([remoteBird,other]);
  const merged=mergeChanges(remote,[{base,bird:local,assets:assets(photo("local"))}]);
  assert.deepEqual(merged.birds[0].photos.map(p=>p.id),["photo-1","remote","local"]);
  assert.deepEqual(merged.birds[1],other);
  assert.equal(remote.birds[0].photos.length,2);
});

test("conflicting covers and duplicate species are rejected before publication",()=>{
  const base=bird();base.photos.push(photo("photo-2"),photo("photo-3"));
  const local=structuredClone(base),remote=structuredClone(base);local.coverPhotoId="photo-2";remote.coverPhotoId="photo-3";
  assert.throws(()=>mergeChanges(collection([remote]),[{base,bird:local,assets:[]}]),/cover changed/);
  assert.throws(()=>mergeChanges(collection([base]),[{base:null,bird:bird("other-bird","  CHICKADEE ",[]),assets:[]}]),/already added/);
});

test("malformed dates, cover ownership, and external photo paths are rejected",()=>{
  for(const mutate of [b=>b.photos[0].capturedOn="2026-02-30",b=>b.coverPhotoId="other",b=>b.photos[0].image="https://example.com/bird.jpg",b=>b.photos[0].image="images/bird-1/../photo.jpg"]) {
    const item=bird();mutate(item);assert.throws(()=>validateCollection(collection([item])));
  }
});

test("each photo keeps its own date, time, location, and immutable image",()=>{
  const base=bird();base.photos.push(photo("photo-2"));
  const local=structuredClone(base);
  Object.assign(local.photos[0],{capturedOn:"2024-06-16",capturedTime:"08:39:15",captureOffset:"-05:00",location:"A named wetland"});
  const merged=mergeChanges(collection([base]),[{base,bird:local,assets:[]}]);
  assert.equal(merged.birds[0].photos[0].capturedOn,"2024-06-16");
  assert.equal(merged.birds[0].photos[0].capturedTime,"08:39:15");
  assert.equal(merged.birds[0].photos[0].image,base.photos[0].image);
  assert.deepEqual(merged.birds[0].photos[1],base.photos[1]);
});

test("detail edits preserve independent remote edits but reject same-field conflicts",()=>{
  const base=bird(),local=structuredClone(base),remote=structuredClone(base);
  local.photos[0].location="My wetland";remote.photos[0].caption="A remote caption";
  const merged=mergeChanges(collection([remote]),[{base,bird:local,assets:[]}]);
  assert.equal(merged.birds[0].photos[0].location,"My wetland");
  assert.equal(merged.birds[0].photos[0].caption,"A remote caption");
  remote.photos[0].location="A different wetland";
  assert.throws(()=>mergeChanges(collection([remote]),[{base,bird:local,assets:[]}]),/location changed/);
});

test("capture times and wildlife kinds are validated without requiring GPS",()=>{
  const valid=bird();valid.kind="wildlife";valid.photos[0].capturedTime="23:59:59";valid.photos[0].captureOffset="-05:00";
  assert.doesNotThrow(()=>validateCollection(collection([valid])));
  for(const mutate of [b=>b.photos[0].capturedTime="24:00:00",b=>b.photos[0].capturedTime="12:90:00",b=>b.photos[0].captureOffset="bad",b=>b.kind="unknown"]){const invalid=structuredClone(valid);mutate(invalid);assert.throws(()=>validateCollection(collection([invalid])));}
});

function mockGitHub(remote,conflict=false) {
  const calls=[];
  const fetcher=async(url,init)=>{
    const path=url.split("badlight/josephsbirds/")[1],body=init.body?JSON.parse(init.body):undefined;calls.push({path,...init,body});
    let result;
    if(path==="git/ref/heads/main") result={object:{sha:"head"}};
    else if(path==="git/commits/head") result={tree:{sha:"existing-tree"}};
    else if(path==="contents/docs/birds.json?ref=head") result={content:Buffer.from(JSON.stringify(remote)).toString("base64")};
    else if(path==="git/blobs") result={sha:`blob-${calls.length}`};
    else if(path==="git/trees") result={sha:"new-tree"};
    else if(path==="git/commits") result={sha:"new-commit"};
    else if(path==="git/refs/heads/main") {
      if(conflict) return new Response(JSON.stringify({message:"Not a fast forward"}),{status:422});
      result={object:{sha:"new-commit"}};
    } else throw Error(`Unexpected API call ${path}`);
    return new Response(JSON.stringify(result),{status:200});
  };
  return {calls,fetcher};
}

test("originals, thumbnails, and catalogue publish as one commit without replacing source",async()=>{
  const item=bird("new-bird","Heron",[photo("new-photo","new-bird")]);
  const mock=mockGitHub(collection([]));
  const result=await publishChanges({token:"test-only-token",changes:[{base:null,bird:item,assets:assets(item.photos[0])}],fetcher:mock.fetcher});
  assert.equal(result.sha,"new-commit");
  const tree=mock.calls.find(call=>call.path==="git/trees").body;
  assert.equal(tree.base_tree,"existing-tree");
  assert.deepEqual(tree.tree.map(entry=>entry.path),["docs/images/new-bird/new-photo.jpg","docs/images/new-bird/new-photo-thumb.jpg","docs/birds.json"]);
  assert.equal(JSON.parse(tree.tree[2].content).birds[0].name,"Heron");
  assert.deepEqual(mock.calls.find(call=>call.path==="git/commits").body.parents,["head"]);
  assert.deepEqual(mock.calls.at(-1).body,{sha:"new-commit",force:false});
});

test("a concurrently moved branch is never overwritten and the draft is retained",async()=>{
  const item=bird("new-bird","Heron",[photo("new-photo","new-bird")]);
  const changes=[{base:null,bird:item,assets:assets(item.photos[0])}],before=structuredClone(changes);
  const mock=mockGitHub(collection([]),true);
  await assert.rejects(publishChanges({token:"test-only-token",changes,fetcher:mock.fetcher}),/draft is saved/);
  assert.deepEqual(changes,before);
  assert.equal(mock.calls.filter(call=>call.path==="git/refs/heads/main").length,1);
  assert.equal(mock.calls.at(-1).body.force,false);
});

test("missing originals prevent a catalogue-only publish",async()=>{
  const item=bird("new-bird","Heron",[photo("new-photo","new-bird")]);
  const mock=mockGitHub(collection([]));
  await assert.rejects(publishChanges({token:"test-only-token",changes:[{base:null,bird:item,assets:[]}],fetcher:mock.fetcher}),/missing/);
  assert.equal(mock.calls.some(call=>call.path==="git/trees"),false);
});


test('publishing an album move reuses the existing immutable image files',async()=>{
 const a=bird('bird-1','Chickadee',[photo('photo-1')]),b=bird('bird-2','Heron',[photo('photo-2','bird-2')]),remote=collection([a,b]),localA=structuredClone(a),localB=structuredClone(b),moved=localA.photos.shift();moved.birdId=b.id;localB.photos.push(moved);localA.coverPhotoId=null;
 const mock=mockGitHub(remote);await publishChanges({token:'test-only-token',changes:[{base:a,bird:localA,assets:[]},{base:b,bird:localB,assets:[]}],fetcher:mock.fetcher});
 assert.equal(mock.calls.filter(c=>c.path==='git/blobs').length,0);const tree=mock.calls.find(c=>c.path==='git/trees').body.tree;assert.deepEqual(tree.map(e=>e.path),['docs/birds.json']);const result=JSON.parse(tree[0].content);assert.equal(result.birds[1].photos[1].image,'images/bird-1/photo-1.jpg');assert.equal(result.birds.flatMap(b=>b.photos).length,2);
});

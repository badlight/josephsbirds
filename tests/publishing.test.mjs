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

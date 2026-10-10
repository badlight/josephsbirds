import { mergeChanges, validateCollection } from "./collection.ts";
import type { Change, Collection } from "./models.ts";

export const REPOSITORY = "badlight/josephsbirds";
export const BRANCH = "main";
function decode64(value: string) {
  return new TextDecoder().decode(Uint8Array.from(atob(value.replace(/\s/g,"")),char=>char.charCodeAt(0)));
}
function encode64(bytes: Uint8Array) {
  let value="";
  for(let i=0;i<bytes.length;i+=32768) value+=String.fromCharCode(...bytes.subarray(i,i+32768));
  return btoa(value);
}

export async function publishChanges(options: { token: string; changes: Change[]; onProgress?: (message: string)=>void; fetcher?: typeof fetch }) {
  const { changes,onProgress=()=>{},fetcher=fetch }=options;
  let token=options.token.trim();
  if(!token) throw Error("Enter a GitHub token with Contents: Read and write for badlight/josephsbirds.");
  if(!changes.length) throw Error("Save a bird or photograph to your draft first.");
  async function request(path: string,method="GET",body?: unknown) {
    const response=await fetcher(`https://api.github.com/repos/${REPOSITORY}/${path}`,{
      method,headers:{Accept:"application/vnd.github+json",Authorization:`Bearer ${token}`,"X-GitHub-Api-Version":"2022-11-28",...(body?{"Content-Type":"application/json"}:{})},
      ...(body?{body:JSON.stringify(body)}:{})
    });
    const result=await response.json().catch(()=>({}));
    if(!response.ok) {
      if(response.status===401||response.status===403) throw Error("GitHub rejected the token or its permissions. Use Contents: Read and write for this repository.");
      if(path.startsWith("git/refs/")&&method==="PATCH") throw Error("GitHub changed while publishing. Your draft is saved and no existing commit was overwritten. Review the collection and try again.");
      throw Error(`GitHub request failed (${response.status}): ${result.message||"Please retry."}`);
    }
    return result;
  }
  try {
    onProgress("Checking the latest collection…");
    const ref=await request(`git/ref/heads/${BRANCH}`), head=ref.object.sha;
    const [commit,content]=await Promise.all([request(`git/commits/${head}`),request(`contents/docs/birds.json?ref=${head}`)]);
    if(!content.content) throw Error("The GitHub catalogue could not be read.");
    const remote=JSON.parse(decode64(content.content)) as Collection;
    validateCollection(remote);
    const catalogue=mergeChanges(remote,changes);
    const tree: Record<string,unknown>[]=[],seen=new Set<string>();
    for(const change of changes) {
      const allowed=new Set(change.bird.photos.flatMap(photo=>[photo.image,photo.thumbnail]));
      for(const asset of change.assets) {
        if(!allowed.has(asset.path)||seen.has(asset.path)||asset.blob.size>20*1024*1024) throw Error("A staged photograph has an invalid destination or size.");
        // Assets are immutable. Never replace a published original photograph.
        if(remote.birds.some(bird=>bird.photos.some(photo=>photo.image===asset.path||photo.thumbnail===asset.path))) throw Error("This photograph is already published. Review the saved draft before retrying.");
        seen.add(asset.path);onProgress(`Uploading photograph file ${seen.size}…`);
        const blob=await request("git/blobs","POST",{content:encode64(new Uint8Array(await asset.blob.arrayBuffer())),encoding:"base64"});
        tree.push({path:`docs/${asset.path}`,mode:"100644",type:"blob",sha:blob.sha});
      }
      for(const photo of change.bird.photos.filter(photo=>!change.base?.photos.some(p=>p.id===photo.id))) {
        if(!seen.has(photo.image)||!seen.has(photo.thumbnail)) throw Error("An original photograph or thumbnail is missing from this draft.");
      }
    }
    tree.push({path:"docs/birds.json",mode:"100644",type:"blob",content:JSON.stringify(catalogue,null,2)+"\n"});
    onProgress("Publishing your collection…");
    const newTree=await request("git/trees","POST",{base_tree:commit.tree.sha,tree});
    const newCommit=await request("git/commits","POST",{message:`Update ${changes.length} bird album${changes.length===1?"":"s"} from photo manager`,tree:newTree.sha,parents:[head]});
    await request(`git/refs/heads/${BRANCH}`,"PATCH",{sha:newCommit.sha,force:false});
    return {sha:newCommit.sha,catalogue};
  } finally {token="";}
}

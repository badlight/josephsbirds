// Public, read-only iNaturalist taxonomy API. Only the entered name is sent.
const API='https://api.inaturalist.org/v1';
type RawTaxon={id?:number;name?:string;preferred_common_name?:string;rank?:string;is_active?:boolean;ancestor_ids?:number[];ancestors?:RawTaxon[]};
export type BirdTaxon={id:number;commonName:string;scientificName:string};
export type BirdTaxonomy=BirdTaxon&{family:string};
export type TaxonomySearch={matches:BirdTaxon[];automatic:BirdTaxon|null};
export type TaxonomyFields={name:string;scientificName:string;family:string;manualScientific:boolean;manualFamily:boolean};
export const emptyTaxonomyFields=():TaxonomyFields=>({name:'',scientificName:'',family:'',manualScientific:false,manualFamily:false});
export const birdNameKey=(name:string)=>name.normalize('NFKD').replace(/\p{M}/gu,'').toLowerCase().replace(/['’‘]/g,'').replace(/[^\p{L}\p{N}]+/gu,' ').trim();

export function changeBirdName(fields:TaxonomyFields,name:string):TaxonomyFields{
  if(birdNameKey(name)===birdNameKey(fields.name))return {...fields,name};
  return {...fields,name,scientificName:fields.manualScientific?fields.scientificName:'',family:fields.manualFamily?fields.family:''};
}
export function applyBirdTaxonomy(fields:TaxonomyFields,query:string,taxon:BirdTaxonomy,replaceManual=false):TaxonomyFields{
  if(birdNameKey(fields.name)!==birdNameKey(query))return fields;
  return {...fields,scientificName:fields.manualScientific&&!replaceManual?fields.scientificName:taxon.scientificName,family:fields.manualFamily&&!replaceManual?fields.family:taxon.family,manualScientific:replaceManual?false:fields.manualScientific,manualFamily:replaceManual?false:fields.manualFamily};
}
const birdSpecies=(taxon:RawTaxon)=>taxon.rank==='species'&&taxon.is_active===true&&(taxon.ancestor_ids?.includes(3)||taxon.ancestors?.some(a=>a.id===3&&a.rank==='class'));
function candidate(taxon:RawTaxon):BirdTaxon|null{
  if(!birdSpecies(taxon)||!Number.isSafeInteger(taxon.id)||taxon.id!<=0||!taxon.name?.trim()||taxon.name.length>160)return null;
  const commonName=taxon.preferred_common_name?.trim();
  return commonName&&commonName.length<=160?{id:taxon.id!,commonName,scientificName:taxon.name.trim()}:null;
}
export function parseBirdSearch(data:unknown,query:string):TaxonomySearch{
  const body=data as {results?:RawTaxon[];total_results?:number};
  if(!body||!Array.isArray(body.results))throw Error('Bird lookup returned an unreadable response.');
  const seen=new Set<number>(),matches:BirdTaxon[]=[];
  for(const raw of body.results){const match=raw&&candidate(raw);if(match&&!seen.has(match.id)){seen.add(match.id);matches.push(match);}}
  const exact=matches.filter(m=>birdNameKey(m.commonName)===birdNameKey(query));
  // Broad names and truncated searches require a choice, even if an alias matches.
  return {matches,automatic:exact.length===1&&(body.total_results??Infinity)<=body.results.length?exact[0]:null};
}
export function parseBirdTaxonomy(data:unknown,id:number):BirdTaxonomy{
  const body=data as {results?:RawTaxon[]},raw=body?.results?.find(t=>t?.id===id),match=raw&&candidate(raw);
  const family=raw?.ancestors?.find(a=>a.rank==='family')?.name?.trim();
  if(!match||!family||family.length>100)throw Error('Scientific name and family could not both be confirmed.');
  return {...match,family};
}
export function createBirdTaxonomyLookup(fetcher:typeof fetch=fetch){
  const searches=new Map<string,TaxonomySearch>(),details=new Map<number,BirdTaxonomy>();
  const remember=<K,V>(cache:Map<K,V>,key:K,value:V)=>{if(cache.size>=50)cache.delete(cache.keys().next().value!);cache.set(key,value);return value;};
  const json=async(url:string,signal:AbortSignal)=>{
    const response=await fetcher(url,{signal:AbortSignal.any([signal,AbortSignal.timeout(12000)]),credentials:'omit',referrerPolicy:'no-referrer'});
    if(!response.ok)throw Error('Bird lookup is temporarily unavailable.');
    const data:unknown=await response.json();signal.throwIfAborted();return data;
  };
  return {
    async search(query:string,signal:AbortSignal):Promise<TaxonomySearch>{
      signal.throwIfAborted();const key=birdNameKey(query);if(key.length<3)return {matches:[],automatic:null};
      const cached=searches.get(key);if(cached)return cached;
      const params=new URLSearchParams({q:query.trim(),taxon_id:'3',rank:'species',is_active:'true',per_page:'12',locale:'en'});
      return remember(searches,key,parseBirdSearch(await json(API+'/taxa?'+params,signal),query));
    },
    async details(id:number,signal:AbortSignal):Promise<BirdTaxonomy>{
      signal.throwIfAborted();if(!Number.isSafeInteger(id)||id<=0)throw Error('Choose a valid bird species.');
      const cached=details.get(id);if(cached)return cached;
      return remember(details,id,parseBirdTaxonomy(await json(API+'/taxa/'+id+'?locale=en',signal),id));
    }
  };
}

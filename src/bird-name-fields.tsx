import {useEffect,useRef,useState,type Dispatch,type SetStateAction} from 'react';
import {applyBirdTaxonomy,birdNameKey,changeBirdName,createBirdTaxonomyLookup,type BirdTaxon,type BirdTaxonomy,type TaxonomyFields} from './bird-taxonomy';
const lookup=createBirdTaxonomyLookup();
type LookupState={phase:'idle'|'searching'|'choose'|'matched'|'empty'|'error';matches?:BirdTaxon[];taxon?:BirdTaxonomy};
export default function BirdNameFields({value,onChange}:{value:TaxonomyFields;onChange:Dispatch<SetStateAction<TaxonomyFields>>}){
  const [state,setState]=useState<LookupState>({phase:'idle'}),[selected,setSelected]=useState<BirdTaxon|null>(null),[retry,setRetry]=useState(0);
  const request=useRef<AbortController|null>(null);
  useEffect(()=>{
    const query=value.name.trim(),controller=new AbortController();request.current=controller;
    if(birdNameKey(query).length<3){setState({phase:'idle'});return()=>controller.abort();}
    setState({phase:'searching'});
    const run=async()=>{
      try{
        const results=selected?null:await lookup.search(query,controller.signal);
        if(controller.signal.aborted)return;
        const match=selected||results?.automatic;
        if(!match){setState({phase:results?.matches.length?'choose':'empty',matches:results?.matches});return;}
        const taxon=await lookup.details(match.id,controller.signal);
        if(controller.signal.aborted)return;
        onChange(previous=>applyBirdTaxonomy(previous,query,taxon,Boolean(selected)));
        setState({phase:'matched',taxon});
      }catch{if(!controller.signal.aborted)setState({phase:'error'});}
    };
    const timer=window.setTimeout(run,selected?0:650);
    return()=>{window.clearTimeout(timer);controller.abort();};
  },[value.name,selected,retry,onChange]);
  const manual=value.manualScientific||value.manualFamily;
  return <div className='bird-fields'>
    <label>Common name<input value={value.name} onChange={e=>{const name=e.target.value;request.current?.abort();setSelected(null);onChange(previous=>changeBirdName(previous,name));}} required maxLength={160} autoComplete='off' aria-describedby='bird-taxonomy-status'/></label>
    <div className='taxonomy-lookup'>
      <p id='bird-taxonomy-status' role='status' aria-live='polite'>
        {state.phase==='idle'&&'Enter a common name to fill the scientific name and family automatically.'}
        {state.phase==='searching'&&'Looking up bird details…'}
        {state.phase==='choose'&&'Choose the species below, or enter a more specific common name.'}
        {state.phase==='empty'&&'No matching bird found. Check the spelling or enter the details below.'}
        {state.phase==='error'&&'Bird lookup is unavailable. You can still enter both fields yourself.'}
        {state.phase==='matched'&&(manual?'Match found. Your manual changes have been kept.':'Details filled for '+state.taxon?.commonName+'. Both fields stay editable.')}
      </p>
      {state.phase==='choose'&&<ul className='taxonomy-matches' aria-label='Matching bird species'>{state.matches?.map(t=><li key={t.id}><button type='button' onClick={()=>{request.current?.abort();onChange(previous=>changeBirdName(previous,t.commonName));setSelected(t);}}><span>{t.commonName}</span><i>{t.scientificName}</i></button></li>)}</ul>}
      {state.phase==='error'&&<button className='text-button' type='button' onClick={()=>setRetry(v=>v+1)}>Try lookup again</button>}
      {state.phase==='matched'&&state.taxon&&<div className='taxonomy-source'><a href={'https://www.inaturalist.org/taxa/'+state.taxon.id} target='_blank' rel='noreferrer'>iNaturalist species details ↗</a>{manual&&<button className='text-button' type='button' onClick={()=>onChange(previous=>applyBirdTaxonomy(previous,value.name,state.taxon!,true))}>Use matched details</button>}</div>}
    </div>
    <label>Scientific name<input value={value.scientificName} onChange={e=>{const scientificName=e.target.value;onChange(previous=>({...previous,scientificName,manualScientific:true}));}} maxLength={160}/></label>
    <label>Family<input value={value.family} onChange={e=>{const family=e.target.value;onChange(previous=>({...previous,family,manualFamily:true}));}} maxLength={100}/></label>
  </div>;
}

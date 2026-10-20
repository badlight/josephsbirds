import { lazy,Suspense,useEffect,useRef,useState,type FormEvent } from 'react';
import { X } from 'lucide-react';
import type { BirdPhoto,GPSLocation } from './models';
import { stagePhotoDetails } from './store';
import { validGPS } from './collection';
import {loadWorkingPhoto,saveWorkingPhoto,clearWorkingPhoto,photoForm,type WorkingPhoto} from './editor-memory';
import SavedPlaces from './saved-places';
const LocationPicker=lazy(()=>import('./photo-map').then(m=>({default:m.LocationPicker})));
export default function PhotoDetailsDialog({photo,onClose,onComplete}:{photo:BirdPhoto;onClose:()=>void;onComplete:()=>Promise<void>}){
  const initial=useRef<ReturnType<typeof loadWorkingPhoto>|null>(null),storageError=useRef('');
  if(!initial.current){try{initial.current=loadWorkingPhoto(photo);}catch{initial.current={form:photoForm(photo),restored:false,conflicts:[]};storageError.current='Unfinished edits cannot be stored in this browser. Use Save to draft before closing.';}}
  const dialog=useRef<HTMLDialogElement>(null),[form,setForm]=useState(initial.current.form),[conflicts,setConflicts]=useState(initial.current.conflicts),[mapOpen,setMapOpen]=useState(!!photo.gps),[busy,setBusy]=useState(false),[error,setError]=useState(''),[saved,setSaved]=useState(initial.current.restored?'Unfinished edits restored.':'');
  const finished=useRef(false),[memoryError,setMemoryError]=useState(storageError.current);
  const change=(key:keyof WorkingPhoto,value:string)=>setForm(f=>({...f,[key]:value}));
  useEffect(()=>{dialog.current?.showModal();},[]);
  useEffect(()=>{if(conflicts.length||finished.current)return;try{saveWorkingPhoto(photo,form);setMemoryError('');setSaved(JSON.stringify(form)===JSON.stringify(photoForm(photo))?'':'Unfinished edits saved in this browser.');}catch{setMemoryError('Unfinished edits could not be stored. Use Save to draft before closing.');}},[photo,form,conflicts]);
  const close=()=>{if(busy)return;if(!conflicts.length&&!finished.current)try{saveWorkingPhoto(photo,form);}catch{}onClose();};
  const reset=()=>{try{clearWorkingPhoto(photo.id);setForm(photoForm(photo));setConflicts([]);setSaved('Unfinished edits discarded.');}catch{setMemoryError('The saved form could not be cleared.');}};
  const submit=async(event:FormEvent)=>{
    event.preventDefault();if(conflicts.length)return;setBusy(true);setError('');
    try{
      let gps:GPSLocation|undefined;
      if(form.latitude.trim()||form.longitude.trim()){
        if(!form.latitude.trim()||!form.longitude.trim())throw Error('Enter both latitude and longitude, or clear GPS.');
        gps={latitude:Number(form.latitude),longitude:Number(form.longitude),source:Number(form.latitude)===photo.gps?.latitude&&Number(form.longitude)===photo.gps?.longitude?photo.gps?.source:'manual'};
        if(!validGPS(gps))throw Error('Choose coordinates between ±90 latitude and ±180 longitude.');
      }
      await stagePhotoDetails(photo.birdId,photo.id,{capturedOn:form.capturedOn,capturedTime:form.capturedTime,captureOffset:photo.captureOffset,location:form.location,caption:form.caption,gps,identificationNote:form.note.trim(),trip:form.trip.trim()});
      finished.current=true;try{clearWorkingPhoto(photo.id);}catch{}await onComplete();
    }catch(e){setError(e instanceof Error?e.message:'The details could not be saved.');}finally{setBusy(false);}
  };
  return <dialog ref={dialog} className='upload-dialog' aria-labelledby='photo-details-title' onCancel={e=>{e.preventDefault();close();}}><div className='upload-heading'><div><span className='eyebrow'>This photograph</span><h2 id='photo-details-title'>Edit photo details</h2><p className='photo-filename'>{photo.originalName}</p></div><button className='icon-button' aria-label='Close photo details' disabled={busy} onClick={close}><X size={22}/></button></div>
    <div className='editor-save-status' role='status'>{memoryError||saved||'Changes are saved here as you type. Save to draft when ready to publish.'}{saved&&<button type='button' className='text-button' disabled={busy} onClick={reset}>Discard unfinished edits</button>}</div>
    {conflicts.length>0&&<div className='message error'><p>This photograph changed since you started editing. Review your restored {conflicts.join(', ')} before saving.</p><button onClick={reset}>Use current photo details</button><button onClick={()=>setConflicts([])}>Keep my unfinished edits</button></div>}
    <form onSubmit={submit}><fieldset disabled={busy}><div className='photo-fields'><label>Date taken<input type='date' value={form.capturedOn} onChange={e=>change('capturedOn',e.target.value)}/></label><label>Time taken<input type='time' step='1' value={form.capturedTime} onChange={e=>change('capturedTime',e.target.value)}/></label></div><p className='field-help'>Time is recorded as shown by the camera.</p>
    <label>Location<input value={form.location} onChange={e=>change('location',e.target.value)} maxLength={160} placeholder='Where this photograph was taken'/></label>
    <SavedPlaces location={form.location} latitude={form.latitude} longitude={form.longitude} onChange={(latitude,longitude,location)=>setForm(f=>({...f,latitude,longitude,location}))}/>
    <div className='gps-editor'><div className='gps-editor-heading'><strong>GPS location</strong><button type='button' onClick={()=>setMapOpen(v=>!v)}>{mapOpen?'Hide map':'Choose on map'}</button></div>{mapOpen?<Suspense fallback={<p>Loading location map…</p>}><LocationPicker latitude={form.latitude} longitude={form.longitude} onChange={(latitude,longitude,label)=>setForm(f=>({...f,latitude,longitude,location:label&&!f.location.trim()?label.slice(0,160):f.location}))}/></Suspense>:<p className='map-help'>{form.latitude&&form.longitude?form.latitude+', '+form.longitude:'No GPS recorded. Add a pin to include this photograph in the heatmaps.'}</p>}</div>
    <label className='caption-field'>Outing or trip<input value={form.trip} onChange={e=>change('trip',e.target.value)} maxLength={100} placeholder='e.g. Spring at Point Pelee'/><span className='field-help'>Use the same name to group photographs in your journal.</span></label>
    <label className='caption-field'>Caption<textarea value={form.caption} onChange={e=>change('caption',e.target.value)} rows={3} maxLength={600}/></label>{(photo.identificationNote||form.note)&&<label className='caption-field'>Identification note<textarea value={form.note} onChange={e=>change('note',e.target.value)} maxLength={600} rows={2}/><button type='button' className='text-button' onClick={()=>change('note','')}>Mark identification reviewed</button></label>}</fieldset><p className='form-error' role='alert'>{error}</p><div className='form-actions'><span>Save to draft adds this edit to your publish queue.</span><button type='button' disabled={busy} onClick={close}>Close</button><button className='primary' disabled={busy||conflicts.length>0}>{busy?'Saving…':'Save to draft'}</button></div></form></dialog>;
}

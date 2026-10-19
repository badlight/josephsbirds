import { lazy,Suspense,useEffect,useRef,useState,type FormEvent } from 'react';
import { X } from 'lucide-react';
import type { BirdPhoto,GPSLocation } from './models';
import { stagePhotoDetails } from './store';
import { validGPS } from './collection';
const LocationPicker=lazy(()=>import('./photo-map').then(m=>({default:m.LocationPicker})));
export default function PhotoDetailsDialog({photo,onClose,onComplete}:{photo:BirdPhoto;onClose:()=>void;onComplete:()=>Promise<void>}){
  const dialog=useRef<HTMLDialogElement>(null),[capturedOn,setCapturedOn]=useState(photo.capturedOn),[capturedTime,setCapturedTime]=useState(photo.capturedTime||''),[location,setLocation]=useState(photo.location),[caption,setCaption]=useState(photo.caption),[note,setNote]=useState(photo.identificationNote||''),[latitude,setLatitude]=useState(photo.gps?.latitude.toString()||''),[longitude,setLongitude]=useState(photo.gps?.longitude.toString()||''),[mapOpen,setMapOpen]=useState(!!photo.gps),[busy,setBusy]=useState(false),[error,setError]=useState('');
  useEffect(()=>{dialog.current?.showModal();},[]);
  const submit=async(event:FormEvent)=>{
    event.preventDefault();setBusy(true);setError('');
    try{
      let gps:GPSLocation|undefined;
      if(latitude.trim()||longitude.trim()){
        if(!latitude.trim()||!longitude.trim())throw Error('Enter both latitude and longitude, or clear GPS.');
        gps={latitude:Number(latitude),longitude:Number(longitude),source:Number(latitude)===photo.gps?.latitude&&Number(longitude)===photo.gps?.longitude?photo.gps?.source:'manual'};
        if(!validGPS(gps))throw Error('Choose coordinates between ±90 latitude and ±180 longitude.');
      }
      await stagePhotoDetails(photo.birdId,photo.id,{capturedOn,capturedTime,captureOffset:photo.captureOffset,location,caption,gps,identificationNote:note.trim()});await onComplete();
    }catch(e){setError(e instanceof Error?e.message:'The details could not be saved.');}finally{setBusy(false);}
  };
  return <dialog ref={dialog} className='upload-dialog' aria-labelledby='photo-details-title' onCancel={e=>{e.preventDefault();if(!busy)onClose();}}><div className='upload-heading'><div><span className='eyebrow'>This photograph</span><h2 id='photo-details-title'>Edit photo details</h2><p className='photo-filename'>{photo.originalName}</p></div><button className='icon-button' aria-label='Close photo details' disabled={busy} onClick={onClose}><X size={22}/></button></div><form onSubmit={submit}><fieldset disabled={busy}><div className='photo-fields'><label>Date taken<input type='date' value={capturedOn} onChange={e=>setCapturedOn(e.target.value)}/></label><label>Time taken<input type='time' step='1' value={capturedTime} onChange={e=>setCapturedTime(e.target.value)}/></label></div><p className='field-help'>Time is recorded as shown by the camera.</p><label>Location<input value={location} onChange={e=>setLocation(e.target.value)} maxLength={160} placeholder='Where this photograph was taken'/></label><div className='gps-editor'><div className='gps-editor-heading'><strong>GPS location</strong><button type='button' onClick={()=>setMapOpen(v=>!v)}>{mapOpen?'Hide map':'Choose on map'}</button></div>{mapOpen?<Suspense fallback={<p>Loading location map…</p>}><LocationPicker latitude={latitude} longitude={longitude} onChange={(lat,lng,label)=>{setLatitude(lat);setLongitude(lng);if(label&&!location.trim())setLocation(label.slice(0,160));}}/></Suspense>:<p className='map-help'>{latitude&&longitude?latitude+', '+longitude:'No GPS recorded. Add a pin to include this photograph in the heatmaps.'}</p>}</div><label className='caption-field'>Caption<textarea value={caption} onChange={e=>setCaption(e.target.value)} rows={3} maxLength={600}/></label>{(photo.identificationNote||note)&&<label className='caption-field'>Identification note<textarea value={note} onChange={e=>setNote(e.target.value)} maxLength={600} rows={2}/><button type='button' className='text-button' onClick={()=>setNote('')}>Mark identification reviewed</button></label>}</fieldset><p className='form-error' role='alert'>{error}</p><div className='form-actions'><span>Changes apply to this photograph only.</span><button type='button' disabled={busy} onClick={onClose}>Cancel</button><button className='primary' disabled={busy}>{busy?'Saving…':'Save to draft'}</button></div></form></dialog>;
}

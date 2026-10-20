import type { BirdPhoto, GPSLocation } from './models.ts';
import { validGPS } from './collection.ts';

export type WorkingPhoto={capturedOn:string;capturedTime:string;location:string;caption:string;note:string;latitude:string;longitude:string;trip:string};
const memoryKey='josephsbirds-unfinished-photos-v1',placeKey='josephsbirds-saved-places-v1';
export function photoForm(p:BirdPhoto):WorkingPhoto{return {capturedOn:p.capturedOn,capturedTime:p.capturedTime||'',location:p.location,caption:p.caption,note:p.identificationNote||'',latitude:p.gps?.latitude.toString()||'',longitude:p.gps?.longitude.toString()||'',trip:p.trip||''};}
function readObject(key:string):Record<string,unknown>{const v=JSON.parse(localStorage.getItem(key)||'{}');if(!v||typeof v!=='object'||Array.isArray(v))throw Error('Saved editor data could not be read.');return v;}
function validForm(v:unknown):v is WorkingPhoto{return !!v&&typeof v==='object'&&Object.keys(photoForm({capturedOn:'',location:'',caption:''} as BirdPhoto)).every(k=>typeof (v as Record<string,unknown>)[k]==='string'&&String((v as Record<string,unknown>)[k]).length<=600);}
export function loadWorkingPhoto(p:BirdPhoto){
  const current=photoForm(p),saved=readObject(memoryKey)[p.id] as {base:WorkingPhoto;form:WorkingPhoto}|undefined;
  if(!saved||!validForm(saved.base)||!validForm(saved.form))return {form:current,restored:false,conflicts:[] as string[]};
  const form={...current},conflicts:string[]=[];
  for(const k of Object.keys(current) as (keyof WorkingPhoto)[]){if(saved.form[k]===saved.base[k])continue;form[k]=saved.form[k];if(current[k]!==saved.base[k]&&current[k]!==saved.form[k])conflicts.push(k);}
  return {form,restored:JSON.stringify(form)!==JSON.stringify(current),conflicts};
}
export function saveWorkingPhoto(p:BirdPhoto,form:WorkingPhoto){const saved=readObject(memoryKey);if(JSON.stringify(form)===JSON.stringify(photoForm(p)))delete saved[p.id];else saved[p.id]={base:photoForm(p),form,updatedAt:new Date().toISOString()};localStorage.setItem(memoryKey,JSON.stringify(saved));}
export function clearWorkingPhoto(id:string){const saved=readObject(memoryKey);delete saved[id];localStorage.setItem(memoryKey,JSON.stringify(saved));}
export type SavedPlace={id:string;name:string;gps:GPSLocation};
export function loadPlaces():SavedPlace[]{const v=JSON.parse(localStorage.getItem(placeKey)||'[]');if(!Array.isArray(v))throw Error('Saved places could not be read.');return v.filter((p:SavedPlace)=>p&&typeof p.id==='string'&&typeof p.name==='string'&&p.name.trim()&&p.name.length<=160&&validGPS(p.gps));}
export function savePlace(name:string,gps:GPSLocation):SavedPlace[]{name=name.trim();if(!name||name.length>160||!validGPS(gps))throw Error('Enter a place name and choose valid GPS coordinates first.');const places=loadPlaces(),existing=places.find(p=>p.name.toLocaleLowerCase()===name.toLocaleLowerCase());const place={id:existing?.id||crypto.randomUUID(),name,gps:{...gps,source:'manual' as const}};const next=[...places.filter(p=>p.id!==place.id),place].sort((a,b)=>a.name.localeCompare(b.name));localStorage.setItem(placeKey,JSON.stringify(next));return next;}
export function removePlace(id:string){const next=loadPlaces().filter(p=>p.id!==id);localStorage.setItem(placeKey,JSON.stringify(next));return next;}

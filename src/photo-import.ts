import exifr from 'exifr';
import type { PhotoDetails,PreparedPhoto } from './models';
import { validGPS } from './collection.ts';
export function metadataDetails(raw:Record<string,unknown>|undefined):PhotoDetails {
  const out:PhotoDetails={capturedOn:'',location:'',caption:''};if(!raw)return out;
  const match=String(raw.DateTimeOriginal||raw.CreateDate||'').match(/^(\d{4})[:-](\d{2})[:-](\d{2})[ T](\d{2}):(\d{2}):(\d{2})/);
  if(match){const date=match[1]+'-'+match[2]+'-'+match[3],time=match[4]+':'+match[5]+':'+match[6];if(Number.isFinite(Date.parse(date+'T12:00:00Z'))&&new Date(date+'T12:00:00Z').toISOString().slice(0,10)===date&&/^(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d$/.test(time)){out.capturedOn=date;out.capturedTime=time;}}
  if(typeof raw.OffsetTimeOriginal==='string'&&/^[+-](?:0\d|1[0-4]):[0-5]\d$/.test(raw.OffsetTimeOriginal))out.captureOffset=raw.OffsetTimeOriginal;
  const gps={latitude:raw.latitude as number,longitude:raw.longitude as number,source:'exif' as const};if(validGPS(gps))out.gps=gps;
  return out;
}
export async function fileHash(file:Blob){const digest=await crypto.subtle.digest('SHA-256',await file.arrayBuffer());return [...new Uint8Array(digest)].map(v=>v.toString(16).padStart(2,'0')).join('');}
export async function preparePhoto(file:File,hash?:string):Promise<PreparedPhoto>{
  if(!['image/jpeg','image/png','image/webp','image/avif'].includes(file.type))throw Error('Use JPEG, PNG, WebP, or AVIF.');
  if(!file.size||file.size>80*1024*1024)throw Error('Choose a photograph up to 80 MB.');
  const [metadata,originalSha256]=await Promise.all([exifr.parse(file,{reviveValues:false,exif:true,gps:true,skip:["MakerNote","UserComment"]}).catch(()=>undefined),hash?Promise.resolve(hash):fileHash(file)]);
  const bitmap=await createImageBitmap(file);
  try{
    const copy=async(edge:number,quality:number)=>{const scale=Math.min(1,edge/Math.max(bitmap.width,bitmap.height)),width=Math.max(1,Math.round(bitmap.width*scale)),height=Math.max(1,Math.round(bitmap.height*scale)),canvas=document.createElement('canvas');canvas.width=width;canvas.height=height;const context=canvas.getContext('2d');if(!context)throw Error('This browser could not prepare the photograph.');context.fillStyle='#fff';context.fillRect(0,0,width,height);context.drawImage(bitmap,0,0,width,height);const blob=await new Promise<Blob>((resolve,reject)=>canvas.toBlob(value=>value?resolve(value):reject(Error('Could not create the web copy.')),'image/jpeg',quality));return {blob,width,height};};
    const display=await copy(3200,.9),thumb=await copy(800,.86);
    return {file:new File([display.blob],file.name.replace(/\.[^.]+$/,'')+'.jpg',{type:'image/jpeg'}),thumbnail:new File([thumb.blob],'preview.jpg',{type:'image/jpeg'}),width:display.width,height:display.height,originalName:file.name,originalSha256,details:metadataDetails(metadata)};
  }finally{bitmap.close();}
}

import { useEffect,useMemo,useRef,useState } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import type { Bird,GPSLocation } from './models';
import { photoUrl } from './models';
import { validGPS } from './collection';
import { locatedPhotos,locationBounds,unwrapLongitude,type LocatedPhoto } from './geo';

const TILE_URL='https://tile.openstreetmap.org/{z}/{x}/{y}.png';
const ATTRIBUTION='&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">OpenStreetMap contributors</a>';
function tileLayer(map:L.Map,onError:()=>void){return L.tileLayer(TILE_URL,{maxZoom:19,minZoom:2,attribution:ATTRIBUTION,referrerPolicy:'strict-origin-when-cross-origin',keepBuffer:2}).on('tileerror',onError).addTo(map);}
function fit(map:L.Map,points:GPSLocation[]){const bounds=locationBounds(points);if(bounds)map.fitBounds(bounds,{padding:[45,45],maxZoom:13,animate:false});else map.setView([20,0],2);}
function popup(point:LocatedPhoto,count:number,onOpen?:(birdId:string,photoId:string)=>void){
  const box=document.createElement('div');box.className='map-popup';const image=document.createElement('img');image.src=photoUrl(point.photo,true);image.alt=point.bird.name;box.append(image);
  const title=document.createElement('strong');title.textContent=count>1?count+' photographs at this location':point.bird.name;box.append(title);
  const info=document.createElement('span');info.textContent=point.photo.location||point.bird.name;box.append(info);
  const button=document.createElement('button');button.type='button';button.textContent='View photograph';button.addEventListener('click',()=>onOpen?.(point.bird.id,point.photo.id));box.append(button);return box;
}
function HeatCanvas(map:L.Map,points:LocatedPhoto[]){
  const canvas=L.DomUtil.create('canvas','photo-heat-canvas',map.getPanes().overlayPane),context=canvas.getContext('2d');if(!context){canvas.remove();return()=>{};}
  const draw=()=>{
    const size=map.getSize(),dpr=Math.min(window.devicePixelRatio||1,2);canvas.width=size.x*dpr;canvas.height=size.y*dpr;canvas.style.width=size.x+'px';canvas.style.height=size.y+'px';L.DomUtil.setPosition(canvas,map.containerPointToLayerPoint([0,0]));context.scale(dpr,dpr);
    const bins=new Map<string,{x:number;y:number;count:number}>();
    for(const p of points){const xy=map.latLngToContainerPoint([p.gps.latitude,unwrapLongitude(p.gps.longitude,map.getCenter().lng)]);if(xy.x< -60||xy.x>size.x+60||xy.y< -60||xy.y>size.y+60)continue;const key=Math.round(xy.x/24)+','+Math.round(xy.y/24),bin=bins.get(key);if(bin){bin.x=(bin.x*bin.count+xy.x)/(bin.count+1);bin.y=(bin.y*bin.count+xy.y)/(bin.count+1);bin.count++;}else bins.set(key,{x:xy.x,y:xy.y,count:1});}
    const max=Math.max(1,...[...bins.values()].map(b=>b.count));
    for(const b of bins.values()){const r=46,gradient=context.createRadialGradient(b.x,b.y,2,b.x,b.y,r);gradient.addColorStop(0,'rgba(0,0,0,'+(.32+.58*Math.sqrt(b.count/max))+')');gradient.addColorStop(1,'rgba(0,0,0,0)');context.fillStyle=gradient;context.fillRect(b.x-r,b.y-r,r*2,r*2);}
    const pixels=context.getImageData(0,0,canvas.width,canvas.height),data=pixels.data;
    const stops=[[70,126,121],[177,180,82],[244,178,48],[226,103,34],[165,44,32]];
    for(let i=0;i<data.length;i+=4){const alpha=data[i+3]/255;if(!alpha)continue;const n=Math.min(3.999,alpha*5),lo=Math.floor(n),t=n-lo;for(let c=0;c<3;c++)data[i+c]=Math.round(stops[lo][c]*(1-t)+stops[lo+1][c]*t);data[i+3]=Math.min(218,data[i+3]*1.15);}
    context.putImageData(pixels,0,0);
  };
  map.on('moveend zoomend resize',draw);draw();return()=>{map.off('moveend zoomend resize',draw);canvas.remove();};
}

export default function PhotoMap({birds,title='Photo locations',onOpen}:{birds:Bird[];title?:string;onOpen?:(birdId:string,photoId:string)=>void}){
  const node=useRef<HTMLDivElement>(null),map=useRef<L.Map|null>(null),open=useRef(onOpen);open.current=onOpen;
  const [mode,setMode]=useState<'heat'|'pins'>('heat'),[tileError,setTileError]=useState(false);
  const points=useMemo(()=>locatedPhotos(birds),[birds]),total=birds.reduce((n,b)=>n+b.photos.filter(p=>!p.trashedAt).length,0);
  useEffect(()=>{if(!node.current)return;const m=L.map(node.current,{scrollWheelZoom:false,worldCopyJump:true,minZoom:2});map.current=m;tileLayer(m,()=>setTileError(true));m.setView([20,0],2);const observer=new ResizeObserver(()=>m.invalidateSize());observer.observe(node.current);return()=>{observer.disconnect();m.remove();map.current=null;};},[]);
  useEffect(()=>{
    const m=map.current;if(!m)return;fit(m,points.map(p=>p.gps));const group=L.layerGroup().addTo(m);const cleanup=mode==='heat'?HeatCanvas(m,points):()=>{};
    const addMarkers=()=>{
      group.clearLayers();const grouped=new Map<string,{p:LocatedPhoto;count:number}>();
      for(const p of points){const key=p.gps.latitude.toFixed(5)+','+p.gps.longitude.toFixed(5);const old=grouped.get(key);if(old)old.count++;else grouped.set(key,{p,count:1});}
      for(const {p,count} of grouped.values())L.circleMarker([p.gps.latitude,unwrapLongitude(p.gps.longitude,m.getCenter().lng)],{radius:mode==='pins'?6+Math.min(9,Math.log2(count+1)):10,weight:mode==='pins'?2:0,color:'#fffdf8',fillColor:'#624728',fillOpacity:mode==='pins'?.9:0,opacity:mode==='pins'?1:0}).bindPopup(()=>popup(p,count,(b,id)=>open.current?.(b,id))).addTo(group);
    };
    addMarkers();m.on('moveend',addMarkers);return()=>{cleanup();m.off('moveend',addMarkers);group.remove();};
  },[points,mode]);
  return <section className='photo-map-card' aria-label={title}><div className='map-heading'><div><h3>{title}</h3><p>{points.length} of {total} photographs mapped</p></div><div className='map-actions'><button type='button' aria-pressed={mode==='heat'} onClick={()=>setMode('heat')}>Heatmap</button><button type='button' aria-pressed={mode==='pins'} onClick={()=>setMode('pins')}>Pins</button><button type='button' onClick={()=>map.current&&fit(map.current,points.map(p=>p.gps))}>Fit locations</button></div></div><div className='map-frame'><div ref={node} className='photo-map' aria-label={title+' interactive map'}/>{!points.length&&<div className='map-empty'><strong>No GPS locations yet</strong><span>Add a pin in Edit photo to start this map.</span></div>}</div><div className='map-legend'><span>Photograph density</span><i aria-hidden='true'/><span>Fewer → More</span></div>{tileError&&<p className='map-help' role='status'>Some map tiles could not load. Recorded coordinates are still available.</p>}<p className='map-help'>Only recorded GPS locations appear. Density counts photographs, not individual birds.</p></section>;
}

type Place={id:number;name:string;latitude:number;longitude:number;admin1?:string;country?:string};
const placeCache=new Map<string,Place[]>();
export function LocationPicker({latitude,longitude,onChange}:{latitude:string;longitude:string;onChange:(latitude:string,longitude:string,label?:string)=>void}){
  const node=useRef<HTMLDivElement>(null),map=useRef<L.Map|null>(null),marker=useRef<L.Marker|null>(null),change=useRef(onChange),cityLabel=useRef('');change.current=onChange;
  const [query,setQuery]=useState(''),[places,setPlaces]=useState<Place[]>([]),[searching,setSearching]=useState(false),[message,setMessage]=useState(''),[tileError,setTileError]=useState(false);
  const current=latitude.trim()&&longitude.trim()?{latitude:Number(latitude),longitude:Number(longitude)}:undefined;
  const valid=validGPS(current);
  const pin=(gps:GPSLocation)=>{
    const m=map.current;if(!m)return;
    if(marker.current)marker.current.setLatLng([gps.latitude,gps.longitude]);
    else{marker.current=L.marker([gps.latitude,gps.longitude],{draggable:true,icon:L.divIcon({className:'location-pin',html:'<span></span>',iconSize:[24,32],iconAnchor:[12,30]}),title:'Selected photo location',alt:'Selected photo location'}).addTo(m);marker.current.on('dragend',()=>{const p=marker.current!.getLatLng();change.current(p.lat.toFixed(6),(((p.lng+180)%360+360)%360-180).toFixed(6),cityLabel.current);});}
  };
  useEffect(()=>{
    if(!node.current)return;const m=L.map(node.current,{scrollWheelZoom:false,worldCopyJump:true,minZoom:2});map.current=m;tileLayer(m,()=>setTileError(true));if(valid)m.setView([current.latitude,current.longitude],12);else{let region:{latitude:number;longitude:number;zoom:number}|undefined;try{region=JSON.parse(localStorage.getItem('josephsbirds-last-map-region')||'null')||undefined;}catch{}if(validGPS(region)&&Number.isFinite(region.zoom))m.setView([region.latitude,region.longitude],Math.max(2,Math.min(16,region.zoom)));else m.setView([20,0],2);}
    m.on('moveend',()=>{const p=m.getCenter();try{localStorage.setItem('josephsbirds-last-map-region',JSON.stringify({latitude:p.lat,longitude:((p.lng+180)%360+360)%360-180,zoom:m.getZoom()}));}catch{}});
    m.on('click',(event:L.LeafletMouseEvent)=>{const lng=((event.latlng.lng+180)%360+360)%360-180;change.current(event.latlng.lat.toFixed(6),lng.toFixed(6),cityLabel.current);});
    const observer=new ResizeObserver(()=>m.invalidateSize());observer.observe(node.current);return()=>{observer.disconnect();m.remove();map.current=null;marker.current=null;};
  },[]);
  useEffect(()=>{if(valid)pin(current);else if(marker.current){marker.current.remove();marker.current=null;}},[latitude,longitude]);
  const search=async()=>{
    const key=query.trim().toLocaleLowerCase();if(key.length<2){setMessage('Enter at least two letters of a city name.');return;}
    setSearching(true);setMessage('');
    try{let found=placeCache.get(key);if(!found){const response=await fetch('https://geocoding-api.open-meteo.com/v1/search?'+new URLSearchParams({name:query.trim(),count:'5',language:'en',format:'json'}),{referrerPolicy:'strict-origin-when-cross-origin'});if(!response.ok)throw Error('City search is unavailable. You can pan the map or enter coordinates.');const data=await response.json();found=Array.isArray(data.results)?data.results.filter((p:Place)=>validGPS(p)):[];placeCache.set(key,found!);}setPlaces(found!);if(!found!.length)setMessage('No matching city. Try a nearby city, then pan to the exact spot.');}
    catch(error){setMessage(error instanceof Error?error.message:'City search is unavailable.');}finally{setSearching(false);}
  };
  return <div className='location-picker'><div className='coordinate-fields'><label>Latitude<input type='number' min='-90' max='90' step='any' value={latitude} onChange={e=>onChange(e.target.value,longitude)} required={!!longitude.trim()} placeholder='45.4215'/></label><label>Longitude<input type='number' min='-180' max='180' step='any' value={longitude} onChange={e=>onChange(latitude,e.target.value)} required={!!latitude.trim()} placeholder='−75.6972'/></label></div><div className='city-search'><label><span className='sr-only'>Find a city</span><input value={query} placeholder='Find a city, then choose the exact spot…' onChange={e=>setQuery(e.target.value)} onKeyDown={e=>{if(e.key==='Enter'){e.preventDefault();void search();}}}/></label><button type='button' disabled={searching} onClick={()=>void search()}>{searching?'Searching…':'Find city'}</button></div>{places.length>0&&<ul className='place-results'>{places.map(p=><li key={p.id}><button type='button' onClick={()=>{cityLabel.current=[p.name,p.admin1,p.country].filter(Boolean).join(', ');map.current?.setView([p.latitude,p.longitude],12,{animate:false});setPlaces([]);setMessage('Click the exact photo location on the map.');}}>{[p.name,p.admin1,p.country].filter(Boolean).join(', ')}</button></li>)}</ul>}{message&&<p className='map-help' role='status'>{message}</p>}<div ref={node} className='location-picker-map' aria-label='Choose the photo location on the map'/><div className='coordinate-actions'><span>Click to place a pin; drag it to refine.</span><button type='button' disabled={!valid} onClick={()=>{if(valid)map.current?.setView([current.latitude,current.longitude],14,{animate:false});}}>Go to pin</button><button type='button' disabled={!latitude&&!longitude} onClick={()=>onChange('','')}>Clear GPS</button></div>{tileError&&<p className='map-help' role='status'>Map tiles are unavailable. You can enter latitude and longitude above.</p>}<p className='map-help'>Coordinates are included when you publish your draft. City search: <a href='https://open-meteo.com/' target='_blank' rel='noreferrer'>Open-Meteo</a> / <a href='https://www.geonames.org/' target='_blank' rel='noreferrer'>GeoNames</a>.</p></div>;
}

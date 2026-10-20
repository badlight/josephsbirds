import type {Bird} from './models.ts';
export function speciesJournal(birds:Bird[]){
 const entries=birds.filter(b=>b.kind!=='wildlife'&&!b.archivedAt&&b.photos.some(p=>!p.trashedAt)).map(bird=>{
 const photos=bird.photos.filter(p=>!p.trashedAt),dates=photos.map(p=>p.capturedOn).filter(Boolean).sort();
 return {bird,first:dates[0]||'',last:dates.at(-1)||'',count:photos.length,years:[...new Set(dates.map(d=>d.slice(0,4)))]};});
 const years=[...new Set(entries.flatMap(e=>e.years))].sort().reverse().map(year=>({year,species:entries.filter(e=>e.years.includes(year)).length,photos:entries.reduce((n,e)=>n+e.bird.photos.filter(p=>!p.trashedAt&&p.capturedOn.startsWith(year+'-')).length,0)}));
 const groups=new Map<string,{name:string;named:boolean;first:string;last:string;species:Set<string>;photos:{bird:Bird;photo:Bird['photos'][number]}[]}>();
 for(const bird of birds.filter(b=>!b.archivedAt))for(const photo of bird.photos.filter(p=>!p.trashedAt)){
 const named=!!photo.trip?.trim(),key=named?'trip:'+photo.trip!.trim():'day:'+photo.capturedOn+'|'+photo.location;
 const g=groups.get(key)||{name:named?photo.trip!.trim():[photo.capturedOn||'Undated photographs',photo.location].filter(Boolean).join(' · '),named,first:photo.capturedOn,last:photo.capturedOn,species:new Set<string>(),photos:[]};
 if(photo.capturedOn){g.first=g.first&&g.first<photo.capturedOn?g.first:photo.capturedOn;g.last=g.last>photo.capturedOn?g.last:photo.capturedOn;}if(bird.kind!=='wildlife')g.species.add(bird.id);g.photos.push({bird,photo});groups.set(key,g);
 }
 return {entries:entries.sort((a,b)=>a.bird.name.localeCompare(b.bird.name)),years,outings:[...groups.values()].sort((a,b)=>b.last.localeCompare(a.last))};
}

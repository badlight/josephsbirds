import type { Bird,Catalogue } from './models.ts';
import { validGPS } from './collection.ts';
import { photoTime } from './geo.ts';
export type BrowseFilters={query:string;family:string;kind:string;year:string;location:string;status:string;sort:string};
export function browseBirds(catalogue:Catalogue,f:BrowseFilters):Bird[]{
  const pending=new Set(catalogue.pendingPhotoIds||[]),pendingAlbums=new Set(catalogue.pendingAlbumIds||[]),text=(v:string)=>v.toLocaleLowerCase().normalize('NFKC'),q=text(f.query.trim()),loc=text(f.location.trim());
  const trash=catalogue.canManage&&f.status==='trash';
  const result=catalogue.birds.filter(b=>trash?(!!b.archivedAt||b.photos.some(p=>p.trashedAt)):!b.archivedAt).filter(b=>(!f.kind||(b.kind||'bird')===f.kind)&&(!f.family||b.family===f.family)).flatMap(b=>{
    const albumMatches=[b.name,b.scientificName,b.family].some(v=>text(v).includes(q));
    const photos=b.photos.filter(p=>trash?(b.archivedAt||p.trashedAt):!p.trashedAt).filter(p=>
      (!q||albumMatches||[p.originalName,p.location,p.caption,p.capturedOn].some(v=>text(v).includes(q)))&&
      (!f.year||p.capturedOn.startsWith(f.year+'-'))&&(!loc||text(p.location).includes(loc))&&
      (!catalogue.canManage||!f.status||f.status==='trash'||
        (f.status==='pending'&&(pending.has(p.id)||pendingAlbums.has(b.id)))||
        (f.status==='missing-location'&&!p.location.trim())||
        (f.status==='missing-gps'&&!validGPS(p.gps))||
        (f.status==='review'&&!!(b.identificationNote||p.identificationNote)))
    ).sort((a,b)=>(a.sortOrder??Number.MAX_SAFE_INTEGER)-(b.sortOrder??Number.MAX_SAFE_INTEGER));
    const allowEmpty=!b.photos.length&&!q&&!f.year&&!loc&&(!f.status||(f.status==='pending'&&pendingAlbums.has(b.id))||(trash&&b.archivedAt));
    return photos.length||allowEmpty?[{...b,photos}]:[];
  });
  const latest=(b:Bird)=>b.photos.reduce((max,p)=>photoTime(p)>max?photoTime(p):max,'');
  return result.sort((a,b)=>f.sort==='recent'?b.createdAt.localeCompare(a.createdAt):f.sort==='photographed'?latest(b).localeCompare(latest(a)):a.name.localeCompare(b.name));
}

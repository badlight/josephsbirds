import type { Bird,BirdPhoto,GPSLocation } from './models.ts';
import { validGPS } from './collection.ts';
export type LocatedPhoto={bird:Bird;photo:BirdPhoto;gps:GPSLocation};
export const locatedPhotos=(birds:Bird[]):LocatedPhoto[]=>birds.filter(b=>!b.archivedAt).flatMap(b=>b.photos.filter(p=>!p.trashedAt&&validGPS(p.gps)).map(photo=>({bird:b,photo,gps:photo.gps!})));
export const unwrapLongitude=(longitude:number,anchor:number)=>longitude+360*Math.round((anchor-longitude)/360);
// The smallest longitudinal arc avoids stretching date-line photographs across the world.
export function locationBounds(points:GPSLocation[]):[[number,number],[number,number]]|null {
  if(!points.length)return null;
  const longs=points.map(p=>(p.longitude+360)%360).sort((a,b)=>a-b);
  let gap=-1,start=longs[0];
  for(let i=0;i<longs.length;i++){const next=i===longs.length-1?longs[0]+360:longs[i+1];if(next-longs[i]>gap){gap=next-longs[i];start=next%360;}}
  const adjusted=points.map(p=>{let x=(p.longitude+360)%360;if(x<start)x+=360;return x;});
  return [[Math.min(...points.map(p=>p.latitude)),Math.min(...adjusted)],[Math.max(...points.map(p=>p.latitude)),Math.max(...adjusted)]];
}
export function photoTime(p:BirdPhoto){return p.capturedOn+(p.capturedTime?'T'+p.capturedTime:'');}
export const familyLabels:Record<string,string>={Accipitridae:'Hawks & eagles',Anatidae:'Ducks, geese & swans',Ardeidae:'Herons',Cacatuidae:'Cockatoos',Canidae:'Dogs & coyotes',Cardinalidae:'Cardinals',Castoridae:'Beavers',Corvidae:'Jays & crows',Cricetidae:'Muskrats',Falconidae:'Falcons',Icteridae:'Blackbirds',Laridae:'Gulls & terns',Macropodidae:'Kangaroos',Pandionidae:'Ospreys',Paridae:'Chickadees',Parulidae:'Warblers',Passerellidae:'Sparrows',Phalacrocoracidae:'Cormorants',Phasianidae:'Turkeys & pheasants',Picidae:'Woodpeckers',Psittaculidae:'Parrots',Rallidae:'Rails & swamphens',Sittidae:'Nuthatches',Strigidae:'Owls',Threskiornithidae:'Ibises',Turdidae:'Thrushes & robins',Tyrannidae:'Flycatchers'};

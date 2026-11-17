import proj4 from 'proj4';
import {readFile,writeFile} from 'node:fs/promises';
import {VectorTile} from '@mapbox/vector-tile';
import {PbfReader} from 'pbf';
const base=JSON.parse(await readFile('public/opo-environment.geojson','utf8'));
const source=base.metadata.tile_source,z=14,n=2**z;
const xAt=lng=>Math.floor((lng+180)/360*n),yAt=lat=>Math.floor((1-Math.asinh(Math.tan(lat*Math.PI/180))/Math.PI)/2*n);
const bounds=base.metadata.bounds,items=[];
for(let x=xAt(bounds[0]);x<=xAt(bounds[2]);x++)for(let y=yAt(bounds[3]);y<=yAt(bounds[1]);y++){
 const url=source.replace('{z}',z).replace('{x}',x).replace('{y}',y);
 const r=await fetch(url);if(!r.ok)throw Error(`${r.status} ${url}`);
 const tile=new VectorTile(new PbfReader(new Uint8Array(await r.arrayBuffer())));
 const layer=tile.layers.poi;if(!layer)continue;
 for(let i=0;i<layer.length;i++){const f=layer.feature(i);items.push({id:f.id,...f.properties,geometry:f.toGeoJSON(x,y,z).geometry})}
}
const building = JSON.parse(await readFile('public/sample-buildings.geojson','utf8'));
const crs = '+proj=tmerc +lat_0=38 +lon_0=127 +k=1 +x_0=200000 +y_0=600000 +ellps=GRS80 +units=m +no_defs';
const origin = building.metadata.local_origin_xy, seen = new Set(), features = [];
for (const p of items) {
 const category = /올리브영|olive\s*young/i.test(p.name || '') ? 'beauty' : p.subclass === 'convenience' ? 'convenience' : p.subclass === 'school' ? 'school' : null;
 if (!category || !p.name || seen.has(p.id) || p.geometry.type !== 'Point') continue;
 const xy = proj4('WGS84', crs, p.geometry.coordinates);
 const x = xy[0]-origin[0], y = xy[1]-origin[1];
 if (Math.abs(x)>1200 || Math.abs(y)>1200) continue;
 seen.add(p.id);
 features.push({type:'Feature',geometry:p.geometry,properties:{id:String(p.id),name:p.name,category,distance_m:Math.round(Math.hypot(x,y))}});
}
features.sort((a,b)=>a.properties.distance_m-b.properties.distance_m);
const snapshot = source.match(/\/(\d{4})(\d{2})(\d{2})_/);
await writeFile('public/opo-pois.geojson', JSON.stringify({type:'FeatureCollection',metadata:{source:'OpenStreetMap via OpenFreeMap',tile_source:source,snapshot:snapshot?.slice(1).join('-') ?? 'unknown',license:'ODbL',attribution:'© OpenStreetMap contributors',school_boundaries:'not included',distance_method:'EPSG:5186 straight-line distance from sample origin'},features},null,2)+'\n');
console.log(`Saved ${features.length} named places within ±1200m. School catchments are not included.`);

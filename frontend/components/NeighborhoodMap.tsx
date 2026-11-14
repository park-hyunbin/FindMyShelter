'use client';
import {useEffect,useRef,useState} from 'react';
import type {Map as LibreMap,StyleSpecification} from 'maplibre-gl';
import type {FeatureCollection} from 'geojson';
import 'maplibre-gl/dist/maplibre-gl.css';
const themed=(dark:string,light:string):['case',['boolean',['global-state',string],boolean],string,string]=>['case',['boolean',['global-state','explore'],false],dark,light];
type Props={data:FeatureCollection;selectedId:string|null;onSelect:(id:string)=>void;tilt:boolean;zoom:number;angle:number;resetToken:number;mode:'explore'|'cozy'};
export default function NeighborhoodMap({data,selectedId,onSelect,tilt,zoom,angle,resetToken,mode}:Props){
 const host=useRef<HTMLDivElement>(null),map=useRef<LibreMap|null>(null),select=useRef(onSelect),last=useRef<number|null>(null);select.current=onSelect;
 const [message,setMessage]=useState('배경 지도를 불러오는 중…');
 const [terrainEnabled,setTerrainEnabled]=useState(true),[terrainReady,setTerrainReady]=useState(false);
 const modeRef=useRef(mode);modeRef.current=mode;const selectedRef=useRef(selectedId);selectedRef.current=selectedId;
 const [discovered,setDiscovered]=useState(false),[waterReady,setWaterReady]=useState(false),[waterVisible,setWaterVisible]=useState(true),[roadsReady,setRoadsReady]=useState(false),[roadsVisible,setRoadsVisible]=useState(false);
 const enabled=useRef(true);enabled.current=terrainEnabled;
 useEffect(()=>{let cancelled=false;let instance:LibreMap|null=null;
 (async()=>{const lib=await import('maplibre-gl');lib.setWorkerUrl(new URL('/maplibre-worker.mjs',window.location.href).href);let style:StyleSpecification;
 try{const response=await fetch('/osm-roads-style.json',{signal:AbortSignal.timeout(12000)});if(!response.ok)throw Error();style=await response.json();
 }catch{style={version:8,sources:{},layers:[{id:'background',type:'background',paint:{'background-color':'#edf0e6'}}]};if(!cancelled)setMessage('배경지도 연결 실패 · 건물 데이터는 표시합니다.');}
 let localWater:FeatureCollection|null=null;let localRoads:FeatureCollection|null=null;
 if(['localhost','127.0.0.1'].includes(window.location.hostname)){try{const r=await fetch('/water/sample.geojson');if(r.ok)localWater=await r.json()}catch{}}
 if(['localhost','127.0.0.1'].includes(window.location.hostname)){try{const r=await fetch('/roads/sample.geojson');if(r.ok)localRoads=await r.json()}catch{}}
 let terrainMeta:{bounds:[number,number,number,number];minzoom:number;maxzoom:number}|null=null;
 try{const r=await fetch('/dem/manifest.json');if(!r.ok)throw Error();terrainMeta=await r.json()}catch{if(!cancelled)setMessage('지형 자료를 불러오지 못했습니다. 평면 지도는 사용할 수 있어요.')}
 style.transition={duration:0,delay:0};
 for(const l of style.layers){if(l.type==='background')l.paint={...l.paint,'background-color':themed('#111f30','#f0f0e9')};if(l.type==='fill')l.paint={...l.paint,'fill-color':themed(/water/.test(l.id)?'#173c4d':'#182b3a',/water/.test(l.id)?'#dde3df':'#e9ece5')};if(l.type==='line')l.paint={...l.paint,'line-color':themed('#304754',/casing|outline/.test(l.id)?'#c6ccc4':'#fafbf6')};if(l.type==='symbol')l.paint={...l.paint,'text-color':themed('#769498','#989f96'),'text-halo-color':themed('#152b37','#f6f7f0')};}

 if(cancelled||!host.current)return;
 const origin=(data as FeatureCollection&{metadata:{center_lnglat:[number,number]}}).metadata.center_lnglat;
 try{instance=new lib.Map({container:host.current,style,globalState:{explore:modeRef.current==='explore'},center:origin,zoom:16.5,pitch:60,bearing:-25,maxPitch:70,attributionControl:{compact:true}});}catch{setMessage('WebGL 지도를 시작하지 못했습니다. 브라우저의 그래픽 가속 설정을 확인해주세요.');return;}
 map.current=instance;const m=instance;
 m.on('style.load',()=>{if(cancelled)return;m.setGlobalStateProperty('explore',modeRef.current==='explore');
 if(terrainMeta){m.addSource('local-dem',{type:'raster-dem',tiles:[new URL('/dem/{z}/{x}/{y}.png?v=bilinear-1',window.location.href).href.replace(/%7B/g,'{').replace(/%7D/g,'}')],tileSize:256,minzoom:terrainMeta.minzoom,maxzoom:terrainMeta.maxzoom,bounds:terrainMeta.bounds,encoding:'mapbox',attribution:'사용자 제공 VWorld DEM · 90m · 표고 단위 미확인'});
 m.addSource('local-shade',{type:'raster-dem',tiles:[new URL('/dem/{z}/{x}/{y}.png?v=bilinear-1',window.location.href).href.replace(/%7B/g,'{').replace(/%7D/g,'}')],tileSize:256,minzoom:terrainMeta.minzoom,maxzoom:terrainMeta.maxzoom,bounds:terrainMeta.bounds,encoding:'mapbox'});
 m.addLayer({id:'local-hillshade',type:'hillshade',source:'local-shade',paint:{'hillshade-exaggeration':.22,'hillshade-shadow-color':themed('#091724','#947b61'),'hillshade-highlight-color':themed('#41676b','#faf7e9'),'hillshade-accent-color':themed('#213d4b','#b7a187')}});
 if(enabled.current)m.setTerrain({source:'local-dem',exaggeration:1});setTerrainReady(true);}
 m.addSource('dem-contours',{type:'geojson',data:'/dem/contours.geojson'});m.addLayer({id:'contour-glow',type:'line',source:'dem-contours',paint:{'line-color':'#8bdbcc','line-width':5,'line-opacity':.06,'line-blur':3}});m.addLayer({id:'contour-lines',type:'line',source:'dem-contours',paint:{'line-color':themed('#8bdbcc','#a99477'),'line-width':1,'line-opacity':.36}});
 if(localRoads){m.addSource('local-roads',{type:'geojson',data:localRoads,attribution:'사용자 제공 도로명주소 실폭도로 · 로컬 검증 전용'});m.addLayer({id:'local-road-area',type:'fill',source:'local-roads',paint:{'fill-color':themed('#677d83','#e7dfce'),'fill-opacity':.38},layout:{visibility:'none'}});m.addLayer({id:'local-road-edge',type:'line',source:'local-roads',paint:{'line-color':themed('#81969b','#a79b82'),'line-opacity':.45,'line-width':.7},layout:{visibility:'none'}});setRoadsReady(true);}
 if(localWater){m.addSource('local-water',{type:'geojson',data:localWater,attribution:'사용자 제공 LSMD_CONT_UJ301 · 소하천구역/예정지 · 로컬 검증 전용'});m.addLayer({id:'water-zones',type:'fill',source:'local-water',filter:['==',['get','zone_code'],'UJC100'],paint:{'fill-color':'#83c6e3','fill-opacity':.32}});m.addLayer({id:'water-boundary',type:'line',source:'local-water',filter:['==',['get','zone_code'],'UJC100'],paint:{'line-color':'#85cbdf','line-width':2,'line-opacity':.7}});m.addLayer({id:'water-planned',type:'line',source:'local-water',filter:['==',['get','zone_code'],'UJC200'],paint:{'line-color':'#b5c3da','line-width':1.5,'line-dasharray':[3,2],'line-opacity':.7}});setWaterReady(true);}
 m.addSource('sample',{type:'geojson',data,generateId:true});
 const color=['case',['boolean',['feature-state','selected'],false],themed('#f2d79a','#9ac7dc'),['==',['get','target'],true],themed('#c9b787','#c8a47e'),themed('#6a8790','#d9c6ac')] as const;
 m.addLayer({id:'sample-ground',type:'fill',source:'sample',paint:{'fill-color':['case',['==',['get','height_m'],null],'#e5e0d5','#e2d5c1'],'fill-opacity':.9}});
 m.addLayer({id:'sample-outline',type:'line',source:'sample',paint:{'line-color':'#b29b80','line-width':1}});
 m.addLayer({id:'sample-3d',type:'fill-extrusion',source:'sample',paint:{'fill-extrusion-color':color as unknown as string,'fill-extrusion-height':['coalesce',['get','height_m'],0],'fill-extrusion-base':0,'fill-extrusion-opacity':1}});
 if(selectedRef.current){const idx=data.features.findIndex(f=>f.properties?.id===selectedRef.current);if(idx>=0){m.setFeatureState({source:'sample',id:idx},{selected:true});last.current=idx;}}
 m.once('idle',()=>{if(!cancelled)setDiscovered(true);});
 m.on('click',e=>{const features=m.queryRenderedFeatures(e.point,{layers:['sample-3d','sample-ground']});const f=features[0];if(f?.properties?.id)select.current(String(f.properties.id))});
 m.on('mousemove',e=>{m.getCanvas().style.cursor=m.queryRenderedFeatures(e.point,{layers:['sample-3d','sample-ground']}).length?'pointer':''});
 setMessage(Object.keys(style.sources).length?'':'배경지도 연결 실패 · 건물 데이터만 표시합니다.');});
 m.on('error',e=>{console.warn('Map resource:',e.error?.message);if(!cancelled&&e.error?.message&&!/source.*sample/i.test(e.error.message))setMessage('배경지도 일부를 불러오지 못했습니다. 건물 선택은 사용할 수 있어요.');});
 const resize=new ResizeObserver(()=>m.resize());resize.observe(host.current);m.once('remove',()=>resize.disconnect());
 })();return()=>{cancelled=true;instance?.remove();map.current=null;};
 // One source load per sample; view controls update separately.
 // eslint-disable-next-line react-hooks/exhaustive-deps
 },[data]);
 useEffect(()=>{const m=map.current;if(!m)return;const update=()=>{if(!m.getSource('sample'))return;if(last.current!==null)m.setFeatureState({source:'sample',id:last.current},{selected:false});const idx=data.features.findIndex(f=>f.properties?.id===selectedId);if(idx>=0)m.setFeatureState({source:'sample',id:idx},{selected:true});last.current=idx>=0?idx:null;};update();return()=>{}},[selectedId]);
 useEffect(()=>{map.current?.easeTo({pitch:tilt?60:0,zoom:16.5+Math.log2(zoom/1.5),bearing:angle,duration:350})},[tilt,zoom,angle]);
 useEffect(()=>{const m=map.current;if(m&&resetToken){const origin=(data as FeatureCollection&{metadata:{center_lnglat:[number,number]}}).metadata.center_lnglat;m.easeTo({center:origin,zoom:16.5,pitch:60,bearing:-25,duration:500})}},[resetToken,data]);
 useEffect(()=>{const m=map.current;if(m)m.setGlobalStateProperty('explore',mode==='explore')},[mode]);
 useEffect(()=>{const m=map.current;if(!m||!roadsReady)return;for(const id of ['local-road-area','local-road-edge'])if(m.getLayer(id))m.setLayoutProperty(id,'visibility',roadsVisible?'visible':'none')},[roadsVisible,roadsReady]);
 useEffect(()=>{const m=map.current;if(!m||!waterReady)return;for(const id of ['water-zones','water-boundary','water-planned'])if(m.getLayer(id))m.setLayoutProperty(id,'visibility',waterVisible?'visible':'none')},[waterVisible,waterReady]);
 useEffect(()=>{const m=map.current;if(!m||!terrainReady)return;m.setTerrain(terrainEnabled?{source:'local-dem',exaggeration:1}:null);if(m.getLayer('local-hillshade'))m.setLayoutProperty('local-hillshade','visibility',terrainEnabled?'visible':'none')},[terrainEnabled,terrainReady]);
 return <><div ref={host} className="maplibre-host" aria-label="저채도 OSM 도로 배경과 실제 건물 입체 지도"/>{mode==='explore'&&<div className="exploration-atmosphere" aria-hidden="true"/>}<div className="discovery-label" role="status">{discovered?'✧ 건물·지형 발견 · 능선/용맥 미분석 · 물길은 로컬 구역 검증':'실제 공간 데이터를 펼치고 있어요…'}</div><div className="terrain-controls"><div><button disabled={!terrainReady} aria-pressed={terrainEnabled} onClick={()=>setTerrainEnabled(v=>!v)}>⌁ 90m 지형 {terrainEnabled?'켜짐':'꺼짐'}</button><button disabled={!terrainReady} onClick={()=>map.current?.easeTo({zoom:14.6,pitch:65,duration:700})}>주변 지형 보기 ↗</button>{waterReady&&<button aria-pressed={waterVisible} onClick={()=>setWaterVisible(v=>!v)}>≈ 소하천구역 {waterVisible?'켜짐':'꺼짐'}</button>}{roadsReady&&<button aria-pressed={roadsVisible} onClick={()=>setRoadsVisible(v=>!v)}>실폭도로 {roadsVisible?'켜짐':'꺼짐'}</button>}</div><small>화면만 보간 · 원본 90m · 표고 m 가정/수직 기준 미확인 · 하늘색: 소하천구역 / 점선: 예정지</small></div>{message&&<div className="basemap-status" role="status">{message}</div>}</>;
}

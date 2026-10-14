// 3D digital twin of the assembly hall. Builds a low-poly scene once, then moves spacecraft to the seats and queues
// the simulation snapshot implies. Data-driven overlays (panels, tracker, lists) live in app.mjs.
import {Scene,PerspectiveCamera,WebGLRenderer,Color,Fog,HemisphereLight,DirectionalLight,Group,Mesh,InstancedMesh,Object3D,BoxGeometry,CylinderGeometry,SphereGeometry,ConeGeometry,PlaneGeometry,CircleGeometry,TorusGeometry,OctahedronGeometry,EdgesGeometry,LineSegments,LineBasicMaterial,LineDashedMaterial,Line,BufferGeometry,MeshStandardMaterial,MeshBasicMaterial,Vector2,Vector3,Raycaster,QuadraticBezierCurve3,CanvasTexture,PCFShadowMap,DoubleSide,SRGBColorSpace,OrbitControls} from './vendor/three-bundle.mjs';
import {LABELS} from './model.mjs';
import {SeatMap,chamberBatches,satelliteStatus,satName,stationStatus} from './twin-state.mjs';

const FLOOR=.4;
const ZONES=[{x:-52,w:18},{x:-22,w:36},{x:7,w:15},{x:30,w:24},{x:54,w:16}];
const ZONE_Z=-13,ZONE_D=26,QUEUE_Z=10,QUEUE_GAP=3.4,QUEUE_MAX=12;
const SPAWN=new Vector3(-73,FLOOR,-14),EXIT=new Vector3(73,FLOOR,-14);
const HOME={dir:new Vector3(56,138,155).normalize(),dist:215,target:new Vector3(2,0,-2)};
const queueSlot=(s,i)=>new Vector3(ZONES[s].x+(i%4-1.5)*QUEUE_GAP,FLOOR,QUEUE_Z+Math.floor(i/4)*QUEUE_GAP);

const shared=g=>(g.userData.shared=true,g);
const geoCache=new Map();
const cached=(key,make)=>{if(!geoCache.has(key))geoCache.set(key,shared(make()));return geoCache.get(key);};
const boxGeo=(w,h,d)=>cached(`b${w},${h},${d}`,()=>new BoxGeometry(w,h,d));
const cylGeo=(rt,rb,h,seg=20,open=false)=>cached(`c${rt},${rb},${h},${seg},${open}`,()=>new CylinderGeometry(rt,rb,h,seg,1,open));
const planeGeo=(w,d)=>cached(`p${w},${d}`,()=>new PlaneGeometry(w,d));
const mat=(color,o={})=>new MeshStandardMaterial({color,roughness:.7,metalness:0,...o});
const own=m=>(m.userData.own=true,m);
const M={
 ground:mat(0xe4eaf1,{roughness:1}),floor:mat(0xf7f9fc,{roughness:.95}),wall:mat(0xffffff,{roughness:.85}),trim:mat(0x1f5fd6,{roughness:.5}),
 road:mat(0xcdd4dd,{roughness:1}),curb:mat(0xeef2f6,{roughness:1}),paint:mat(0xffffff,{roughness:1}),white:mat(0xf4f7fb,{roughness:.55}),
 steel:mat(0xc9d2dd,{roughness:.45,metalness:.1}),dark:mat(0x2b3a4f,{roughness:.6}),glass:mat(0x4d6b8c,{roughness:.2,metalness:.1}),
 gold:mat(0xe6b350,{roughness:.42,metalness:.15,emissive:0x3a2600,emissiveIntensity:.25}),panel:mat(0x2f5fe0,{roughness:.35,metalness:.1,emissive:0x0b1f5c,emissiveIntensity:.35}),
 crate:mat(0xdcbd8e,{roughness:.9}),pallet:mat(0xb99467,{roughness:.95}),cart:mat(0xdbe2ea,{roughness:.6}),blue:mat(0x2563eb,{roughness:.45}),
 red:mat(0xe6392e,{roughness:.4,emissive:0xe6392e,emissiveIntensity:.45}),tree:mat(0xa9d8a0,{roughness:.9}),trunk:mat(0xb59b7a,{roughness:.9}),
 fence:mat(0xbfe3c4,{roughness:.6,transparent:true,opacity:.5}),yellow:mat(0xf2b134,{roughness:.5}),off:mat(0xe9edf2,{roughness:.9}),
 chamber:mat(0xf1f4f8,{roughness:.4,metalness:.08,side:DoubleSide}),pick:new MeshBasicMaterial({colorWrite:false,depthWrite:false})
};
const LINE={yellow:new LineBasicMaterial({color:0xf0b650}),gray:new LineBasicMaterial({color:0xc4ccd6})};

function add(parent,geo,material,x,y,z,{cast=true,receive=true}={}){
 const m=new Mesh(geo,material);m.position.set(x,y,z);m.castShadow=cast;m.receiveShadow=receive;parent.add(m);return m;
}
const box=(p,w,h,d,m,x,y,z,o)=>add(p,boxGeo(w,h,d),m,x,y,z,o);
function flat(parent,geo,material,x,y,z){const m=add(parent,geo,material,x,y,z,{cast:false});m.rotation.x=-Math.PI/2;return m;}
function outline(parent,w,d,material,x,y,z){
 const l=new LineSegments(new EdgesGeometry(planeGeo(w,d)),material);l.rotation.x=-Math.PI/2;l.position.set(x,y,z);parent.add(l);return l;
}
function dashed(parent,points,color,dash,gap){
 const l=new Line(new BufferGeometry().setFromPoints(points),new LineDashedMaterial({color,dashSize:dash,gapSize:gap}));
 l.computeLineDistances();parent.add(l);return l;
}
function disposeGroup(g){
 g.traverse(o=>{if(o.geometry&&!o.geometry.userData.shared)o.geometry.dispose();if(o.material?.userData?.own)o.material.dispose();});
 g.removeFromParent();
}

function makeTruck(){
 const t=new Group();
 box(t,9,3.6,3.3,M.white,-1.6,2.6,0);
 box(t,9.04,.45,3.34,M.trim,-1.6,1.9,0,{cast:false});
 box(t,2.6,3,3.2,M.white,4.4,2.3,0);
 box(t,.06,1.1,2.6,M.glass,5.72,3.05,0,{cast:false});
 box(t,9.6,.35,2.4,M.dark,-.4,.85,0,{cast:false});
 for(const x of [-4.8,-3.5,4])for(const z of [-1.45,1.45]){const w=add(t,cylGeo(.55,.55,.5,14),M.dark,x,.55,z);w.rotation.x=Math.PI/2;}
 return t;
}

function makeSign(){
 const c=document.createElement('canvas');c.width=1024;c.height=160;
 const g=c.getContext('2d');g.fillStyle='#ffffff';g.fillRect(0,0,1024,160);g.fillStyle='#1f5fd6';g.fillRect(0,0,22,160);
 g.font='800 64px system-ui,sans-serif';g.fillStyle='#152840';g.fillText('SATELLITE AIT HALL',52,82);
 g.font='600 36px system-ui,sans-serif';g.fillStyle='#5b6d84';g.fillText('위성 조립·통합·시험동  ·  BAY 01',54,132);
 const tex=new CanvasTexture(c);tex.colorSpace=SRGBColorSpace;tex.anisotropy=4;
 return new Mesh(planeGeo(28,4.4),new MeshBasicMaterial({map:tex}));
}

function buildEnvironment(scene){
 const g=new Group();scene.add(g);
 box(g,800,.1,800,M.ground,0,-.05,0,{cast:false});
 box(g,128,FLOOR,50,M.floor,0,FLOOR/2,-4,{cast:false});
 box(g,129.6,7,.8,M.wall,0,FLOOR+3.5,-29.4);
 box(g,130.4,.8,1,M.trim,0,FLOOR+7.3,-29.4);
 const sign=makeSign();sign.position.set(-18,FLOOR+4.6,-28.98);g.add(sign);
 for(const sx of [-1,1]){
  const x=sx*64.4;
  box(g,.8,7,11,M.wall,x,FLOOR+3.5,-23.5);box(g,.8,7,31,M.wall,x,FLOOR+3.5,5.5);box(g,.8,2,8,M.wall,x,FLOOR+6,-14);
  box(g,1,.8,51,M.trim,x,FLOOR+7.3,-4);
  for(const z of [-18.3,-9.7])box(g,.7,5.2,.6,M.trim,x+sx*.5,FLOOR+2.6,z);
  box(g,.7,.6,9.2,M.trim,x+sx*.5,FLOOR+5.2,-14);
  box(g,.4,1.4,7.6,M.steel,x+sx*.2,FLOOR+4.3,-14,{cast:false});
  box(g,32,.15,22,M.curb,sx*81,.08,-14,{cast:false});
  box(g,10,.12,46,M.curb,sx*84,.06,13,{cast:false});
 }
 box(g,800,.12,13,M.road,0,.06,37,{cast:false});
 for(const z of [30,44])box(g,800,.25,1.4,M.curb,0,.12,z,{cast:false});
 const dummy=new Object3D();
 const dashes=new InstancedMesh(boxGeo(4,.02,.35),M.paint,90);
 for(let i=0;i<90;i++){dummy.position.set(-400+i*9,.13,37);dummy.updateMatrix();dashes.setMatrixAt(i,dummy.matrix);}
 g.add(dashes);
 const near=x=>Math.abs(Math.abs(x)-84)<7;
 const posts=[],trees=[];
 for(let x=-170;x<=170;x+=4)if(!near(x))posts.push(x);
 for(let x=-150;x<=150;x+=10)if(!near(x))trees.push([x,24.5]);
 for(let x=-140;x<=140;x+=13)trees.push([x+4,-44]);
 const postMesh=new InstancedMesh(boxGeo(.25,1.8,.25),M.white,posts.length);
 posts.forEach((x,i)=>{dummy.position.set(x,.9,27.5);dummy.updateMatrix();postMesh.setMatrixAt(i,dummy.matrix);});
 postMesh.castShadow=true;g.add(postMesh);
 for(const [a,b] of [[-170,-91],[-77,77],[91,170]])box(g,b-a,1.5,.06,M.fence,(a+b)/2,.85,27.5,{cast:false});
 const trunks=new InstancedMesh(cylGeo(.22,.3,2.4,8),M.trunk,trees.length),crowns=new InstancedMesh(cached('crown',()=>new SphereGeometry(1.7,10,8)),M.tree,trees.length);
 trees.forEach(([x,z],i)=>{
  dummy.position.set(x,1.2,z);dummy.scale.set(1,1,1);dummy.updateMatrix();trunks.setMatrixAt(i,dummy.matrix);
  dummy.position.set(x,3.3,z);dummy.scale.setScalar(.85+((i*37)%10)/30);dummy.updateMatrix();crowns.setMatrixAt(i,dummy.matrix);
 });
 trunks.castShadow=crowns.castShadow=true;g.add(trunks,crowns);
 const inbound=makeTruck();inbound.position.set(-80,0,-14);inbound.rotation.y=Math.PI;
 const outbound=makeTruck();outbound.position.set(80,0,-14);
 g.add(inbound,outbound);
 const road=[makeTruck(),makeTruck()];
 road[0].position.set(-120,0,34.2);road[1].position.set(140,0,39.8);road[1].rotation.y=Math.PI;
 g.add(...road);
 return {road};
}

function buildZones(scene){
 const g=new Group();scene.add(g);
 const zones=ZONES.map((zn,s)=>{
  const fill=own(mat(0xeef3fb,{roughness:.95}));
  flat(g,planeGeo(zn.w,ZONE_D),fill,zn.x,FLOOR+.01,ZONE_Z);
  const edge=outline(g,zn.w,ZONE_D,own(new LineBasicMaterial({color:0xb8c7dc,transparent:true})),zn.x,FLOOR+.03,ZONE_Z);
  const qw=4*QUEUE_GAP+1.2,qd=3*QUEUE_GAP+1.2,qz=QUEUE_Z+QUEUE_GAP;
  const q=[[-qw/2,-qd/2],[qw/2,-qd/2],[qw/2,qd/2],[-qw/2,qd/2],[-qw/2,-qd/2]].map(([dx,dz])=>new Vector3(zn.x+dx,FLOOR+.03,qz+dz));
  dashed(g,q,0xe0a43a,.7,.5);
  const pick=add(g,boxGeo(zn.w,12,ZONE_D+22),M.pick,zn.x,6,ZONE_Z+11,{cast:false,receive:false});
  pick.userData.station=s;
  return {fill,edge,pick};
 });
 dashed(g,[new Vector3(-61,FLOOR+.04,4.5),new Vector3(62,FLOOR+.04,4.5)],0x2563eb,1.4,1);
 for(let s=0;s<4;s++){
  const x=(ZONES[s].x+ZONES[s].w/2+ZONES[s+1].x-ZONES[s+1].w/2)/2;
  flat(g,cached('arrow',()=>new CircleGeometry(1,3)),M.blue,x,FLOOR+.05,4.5);
 }
 const arc=new QuadraticBezierCurve3(new Vector3(3,FLOOR+1.5,1.5),new Vector3(-9,FLOOR+13,1.5),new Vector3(-20,FLOOR+1.5,1.5));
 const rework=dashed(g,arc.getPoints(48),0x8b5cf6,.9,.6);
 return {zones,rework,reworkApex:arc.getPoint(.5)};
}

function buildReceiving(){
 const g=new Group(),seats=[],lights=[];
 for(const z of [-20,-12,-4]){
  box(g,7,1.2,5,M.white,-52,FLOOR+.6,z);
  for(const dz of [-2.8,2.8])box(g,.4,4.6,.4,M.steel,-52,FLOOR+2.3,z+dz);
  box(g,.5,.5,6,M.steel,-52,FLOOR+4.6,z);
  const bar=own(mat(0x36dbc0,{emissive:0x36dbc0,emissiveIntensity:0}));
  box(g,.6,.18,5.4,bar,-52,FLOOR+4.3,z,{cast:false});
  lights.push(bar);seats.push(new Vector3(-52,FLOOR+1.2,z));
 }
 for(const [x,z,h] of [[-59.5,-26,2],[-56.5,-26,1],[-59.5,-23,1]]){
  box(g,2.6,.3,2.6,M.pallet,x,FLOOR+.15,z);
  for(let k=0;k<h;k++)box(g,2.2,1.6,2.2,M.crate,x,FLOOR+1.1+k*1.65,z);
 }
 return {group:g,seats,lights};
}

function buildAssembly(lines,staffed){
 const g=new Group(),seats=[],arms=[];
 for(let i=0;i<lines;i++){
  const x=-22+(i%5-2)*6.8,z=i<5?-19:-11.6,on=i<staffed;
  flat(g,planeGeo(6,6),on?M.white:M.off,x,FLOOR+.02,z);
  outline(g,6,6,on?LINE.yellow:LINE.gray,x,FLOOR+.05,z);
  add(g,cylGeo(1.3,1.5,1,20),on?M.steel:M.off,x,FLOOR+.5,z);
  const arm=new Group();arm.position.set(x+2.3,FLOOR,z-2.3);arm.rotation.y=-Math.PI*3/4;g.add(arm);
  add(arm,cylGeo(.55,.7,.8,14),on?M.white:M.off,0,.4,0);
  const shoulder=new Group();shoulder.position.y=.8;arm.add(shoulder);
  box(shoulder,.45,2.8,.45,on?M.white:M.off,0,1.4,0);
  add(shoulder,cached('joint',()=>new SphereGeometry(.38,10,8)),on?M.blue:M.off,0,2.8,0);
  const elbow=new Group();elbow.position.y=2.8;shoulder.add(elbow);
  box(elbow,.36,2.2,.36,on?M.white:M.off,0,1.1,0);
  add(elbow,cylGeo(.22,.12,.5,10),on?M.blue:M.off,0,2.35,0);
  shoulder.rotation.z=-.55;elbow.rotation.z=-1.35;
  arms.push({shoulder,elbow,on,phase:i*1.7});
  seats.push(new Vector3(x,FLOOR+1,z));
 }
 return {group:g,seats,arms};
}

function buildTesting(){
 const g=new Group(),seats=[],screens=[];
 for(const z of [-20,-12,-4]){
  box(g,7.5,1.1,4.6,M.white,6.5,FLOOR+.55,z);
  box(g,1.4,3.8,4.2,M.dark,1.3,FLOOR+1.9,z);
  const screen=own(mat(0x0f2a3a,{emissive:0x36dbc0,emissiveIntensity:0,roughness:.3}));
  const m=add(g,planeGeo(3.2,1.6),screen,2.02,FLOOR+2.6,z,{cast:false});m.rotation.y=Math.PI/2;
  screens.push(screen);seats.push(new Vector3(7,FLOOR+1.1,z));
 }
 return {group:g,seats,screens};
}

function buildChambers(count){
 const g=new Group(),list=[];
 for(let c=0;c<count;c++){
  const x=30+(c%3-1)*7.6,z=c<3?-19:-10,y=FLOOR+3.3;
  const shell=add(g,cylGeo(2.8,2.8,7,28,true),M.chamber,x,y,z);shell.rotation.x=Math.PI/2;
  add(g,cached('cap',()=>new CircleGeometry(2.8,28)),M.white,x,y,z-3.5,{cast:false});
  for(const dz of [-2.2,2.2])box(g,4.4,1,1,M.steel,x,FLOOR+.5,z+dz);
  const ring=own(mat(0xc5cfdb,{emissive:0xf0a030,emissiveIntensity:0,metalness:.1,roughness:.4}));
  add(g,cached('ring',()=>new TorusGeometry(2.85,.2,10,32)),ring,x,y,z+3.5,{cast:false});
  const pivot=new Group();pivot.position.set(x-2.8,y,z+3.65);g.add(pivot);
  const door=add(pivot,cylGeo(2.8,2.8,.3,28),M.white,2.8,0,0);door.rotation.x=Math.PI/2;
  add(pivot,cylGeo(1,1,.34,20),M.trim,2.8,0,.02,{cast:false}).rotation.x=Math.PI/2;
  pivot.rotation.y=-1.9;
  list.push({pivot,ring,seat:new Vector3(x,FLOOR+2.1,z),running:false});
 }
 return {group:g,list};
}

function buildFinal(){
 const g=new Group(),seats=[];
 for(const z of [-18,-8]){
  box(g,7.4,.8,6.4,M.white,54,FLOOR+.4,z);
  for(const [dx,dz] of [[-3.4,-3],[3.4,-3]])box(g,.35,6.2,.35,M.steel,54+dx,FLOOR+3.1,z+dz);
  box(g,7.2,.35,.35,M.steel,54,FLOOR+6.2,z-3);
  seats.push(new Vector3(54,FLOOR+.8,z));
 }
 box(g,9,4,4.2,M.white,55,FLOOR+2,-24.4);box(g,9.04,.6,4.24,M.trim,55,FLOOR+3.1,-24.4,{cast:false});
 return {group:g,seats};
}

const SAT_GEO={bus:boxGeo(2.1,2.1,2.1),panel:boxGeo(9,.12,1.5),crate:boxGeo(2.4,2.2,2.4),plates:boxGeo(.25,1.9,1.7),cart:boxGeo(2.8,.45,2.8),dish:cylGeo(.62,.22,.24,14),mast:cylGeo(.06,.06,.6,6)};
function makeSat(id){
 const group=new Group(),body=new Group();
 const cart=add(group,SAT_GEO.cart,M.cart,0,.225,0);
 group.add(body);
 const crate=add(body,SAT_GEO.crate,M.crate,0,1.1,0),plates=add(body,SAT_GEO.plates,M.panel,1.45,1,0);
 const bus=add(body,SAT_GEO.bus,M.gold,0,1.05,0),panel=add(body,SAT_GEO.panel,M.panel,0,1.3,0);
 const mast=add(body,SAT_GEO.mast,M.white,0,2.4,0),dish=add(body,SAT_GEO.dish,M.white,0,2.78,0);dish.rotation.x=.45;
 const marker=add(body,cached('marker',()=>new OctahedronGeometry(.48)),M.red,0,4.1,0,{cast:false});
 for(const m of [cart,crate,plates,bus,panel])m.userData.satId=id;
 return {id,group,cart,body,crate,plates,bus,panel,mast,dish,marker,target:new Vector3(),scale:1,wantCart:false,hide:false,leaving:false};
}
function setForm(sat,form,{cart=false,progress=0,retry=false}={}){
 const parts=form==='crate';
 sat.crate.visible=sat.plates.visible=parts;
 sat.bus.visible=sat.mast.visible=sat.dish.visible=!parts;
 const len=form==='assembling'?Math.max(0,(progress-.35)/.65):form==='folded'?.42:form==='deployed'?1:0;
 sat.panel.visible=!parts&&len>.02;
 sat.panel.scale.x=Math.max(.25,len);
 sat.wantCart=cart;sat.marker.visible=retry;sat.form=form;
}
function formFor(s,phase,retry,progress){
 if(s===0)return 'crate';
 if(s===1)return retry?'folded':phase==='queue'?'crate':progress<.35?'bus':'assembling';
 if(s===4&&phase==='active')return 'deployed';
 return 'folded';
}

export function createTwin(stage,{onSelect}){
 const reduced=matchMedia('(prefers-reduced-motion: reduce)').matches;
 const renderer=new WebGLRenderer({antialias:true,powerPreference:'high-performance'});
 renderer.setPixelRatio(Math.min(devicePixelRatio,2));
 renderer.shadowMap.enabled=true;renderer.shadowMap.type=PCFShadowMap;
 const canvas=renderer.domElement;canvas.className='twin-canvas';canvas.setAttribute('aria-label','위성 조립동 3D 디지털 트윈. 드래그로 회전, 휠로 확대, 클릭으로 공정이나 위성을 선택합니다.');canvas.setAttribute('role','img');
 stage.prepend(canvas);

 const scene=new Scene();scene.background=new Color(0xe8edf3);scene.fog=new Fog(0xe8edf3,280,560);
 const camera=new PerspectiveCamera(30,1,1,1200);camera.position.copy(HOME.target).addScaledVector(HOME.dir,HOME.dist);
 scene.add(new HemisphereLight(0xffffff,0xd9e1ea,1.25));
 const sun=new DirectionalLight(0xffffff,1.7);sun.position.set(55,120,60);sun.target.position.set(0,0,-6);
 sun.castShadow=true;sun.shadow.mapSize.set(2048,2048);
 Object.assign(sun.shadow.camera,{left:-100,right:100,top:70,bottom:-70,near:10,far:320});
 sun.shadow.bias=-.0004;sun.shadow.normalBias=.03;
 scene.add(sun,sun.target);

 const controls=new OrbitControls(camera,canvas);
 controls.target.copy(HOME.target);controls.enableDamping=!reduced;controls.dampingFactor=.08;
 controls.minDistance=28;controls.maxDistance=330;controls.minPolarAngle=.2;controls.maxPolarAngle=1.32;
 controls.screenSpacePanning=false;controls.autoRotateSpeed=.5;
 controls.update();

 const env=buildEnvironment(scene),zoneSet=buildZones(scene);
 const fixtures=[buildReceiving(),null,buildTesting(),null,buildFinal()];
 for(const f of fixtures)if(f)scene.add(f.group);
 const seatMaps=[0,1,2,3,4].map(()=>new SeatMap());
 let fixtureKey='',chambers=[];

 const labels=document.createElement('div');labels.className='twin-labels';stage.append(labels);
 const stationLabels=LABELS.map((name,s)=>{
  const el=document.createElement('button');el.type='button';el.className='twin-label station';
  el.innerHTML=`<b>0${s+1}</b><span class="name">${name}</span><span class="count"></span>`;
  el.addEventListener('click',()=>onSelect({type:'station',s}));labels.append(el);return el;
 });
 const queueLabels=LABELS.map(()=>{const el=document.createElement('span');el.className='twin-label queue';el.hidden=true;labels.append(el);return el;});
 const reworkLabel=document.createElement('span');reworkLabel.className='twin-label rework';labels.append(reworkLabel);
 const satLabel=document.createElement('span');satLabel.className='twin-label sat';satLabel.hidden=true;labels.append(satLabel);

 const selBox=new LineSegments(new EdgesGeometry(new BoxGeometry(4.4,4.6,4.4)),new LineBasicMaterial({color:0x2563eb}));selBox.visible=false;scene.add(selBox);
 const dots=Array.from({length:14},()=>{const d=flat(scene,cached('dot',()=>new CircleGeometry(.34,14)),new MeshBasicMaterial({color:0x2563eb,transparent:true}),0,0,0);d.visible=false;return d;});
 const pin=new Group();
 add(pin,cached('pinHead',()=>new SphereGeometry(1,16,12)),M.blue,0,1.2,0);
 add(pin,cached('pinTip',()=>new ConeGeometry(.62,1.5,16)),M.blue,0,0,0).rotation.x=Math.PI;
 add(pin,cached('pinDot',()=>new SphereGeometry(.38,12,10)),M.white,0,1.25,.82,{cast:false});
 pin.visible=false;scene.add(pin);

 const sats=new Map();
 let moved=false,insets={top:0,right:0,bottom:0};
 // Pull the home view back when the free area is narrow (portrait phones) so the whole hall fits.
 const homeDist=()=>{const a=(width-insets.right)/Math.max(1,height-insets.top-insets.bottom);return Math.min(330,HOME.dist*Math.max(1,1.62/a));};
 let selection=null,followOn=false,lastFollow=new Vector3(),tween=null,state=null,elapsed=0;

 function rebuildFixtures(result){
  const key=`${result.config.lines}|${result.capacity[1]}|${result.config.chambers}`;
  if(key===fixtureKey)return;
  fixtureKey=key;
  if(fixtures[1])disposeGroup(fixtures[1].group);
  if(fixtures[3])disposeGroup(fixtures[3].group);
  fixtures[1]=buildAssembly(result.config.lines,result.capacity[1]);
  fixtures[3]=buildChambers(result.config.chambers);chambers=fixtures[3].list;
  fixtures[3].seats=chambers.map(c=>c.seat);
  scene.add(fixtures[1].group,fixtures[3].group);
 }
 function removeSat(sat){sat.group.removeFromParent();sats.delete(sat.id);}

 function update(next){
  state=next;
  const {result,shot,day,snap,station}=next;
  // The default station follows the bottleneck, which can move when the scenario changes.
  if(station!=null&&selection?.type!=='sat')selection={type:'station',s:station};
  rebuildFixtures(result);
  const want=new Map(),occupied=[new Set(),new Set(),new Set(),new Set(),new Set()];
  shot.stages.forEach((st,s)=>{
   if(s===3){
    const batches=chamberBatches(result,st.active.map(a=>a.id),day);
    const seats=seatMaps[3].assign(batches.map(b=>b.key),chambers.length);
    for(const b of batches){
     const c=Math.min(seats.get(b.key),chambers.length-1);occupied[3].add(c);
     b.ids.forEach((id,k)=>want.set(id,{pos:chambers[c].seat.clone().add(new Vector3((k%2-.5)*1.1,0,(Math.floor(k/2)-1.5)*1.1)),form:'folded',hide:true,scale:.5}));
    }
   }else{
    // Only staffed assembly cells take work; unstaffed ones stay dimmed and empty.
    const seats=fixtures[s].seats,count=s===1?result.capacity[1]:seats.length,map=seatMaps[s].assign(st.active.map(a=>a.id),count);
    for(const a of st.active){
     const seat=Math.min(map.get(a.id),count-1);occupied[s].add(seat);
     want.set(a.id,{pos:seats[seat],form:formFor(s,'active',a.retry,a.progress),progress:a.progress,retry:a.retry});
    }
   }
   st.queue.forEach((id,i)=>{
    // Long queues show their first rows; a selected spacecraft further back waits just behind them.
    if(i>=QUEUE_MAX&&!(selection?.type==='sat'&&selection.id===id))return;
    const retry=s<3&&satelliteStatus(result.jobs[id-1],day).retry;
    want.set(id,{pos:queueSlot(s,Math.min(i,QUEUE_MAX)),form:formFor(s,'queue',retry,0),cart:true,retry});
   });
  });
  for(const [id,w] of want){
   let sat=sats.get(id);
   const fresh=!sat;
   if(fresh){sat=makeSat(id);sats.set(id,sat);scene.add(sat.group);}
   setForm(sat,w.form,w);
   sat.target.copy(w.pos);sat.hide=!!w.hide;sat.scale=w.scale??1;sat.leaving=false;
   if(snap||reduced){sat.group.position.copy(w.pos);sat.group.scale.setScalar(sat.scale);sat.group.visible=!sat.hide;}
   else{
    if(fresh){
     const fromTruck=w.form==='crate'&&shot.stages[0].queue.includes(id);
     sat.group.position.copy(fromTruck?SPAWN:w.pos);sat.group.scale.setScalar(fromTruck?1:.01);
    }
    if(!sat.hide)sat.group.visible=true;
   }
  }
  for(const sat of [...sats.values()]){
   if(want.has(sat.id))continue;
   const job=result.jobs[sat.id-1];
   if(!snap&&!reduced&&job&&job.done!==null&&job.done<=day){
    if(!sat.leaving){sat.leaving=true;sat.target.copy(EXIT);setForm(sat,'folded',{cart:true});sat.hide=false;sat.scale=1;sat.group.visible=true;}
   }else removeSat(sat);
  }
  fixtures[0].lights.forEach((m,i)=>m.userData.on=occupied[0].has(i));
  fixtures[2].screens.forEach((m,i)=>m.userData.on=occupied[2].has(i));
  fixtures[1].arms.forEach((a,i)=>a.busy=occupied[1].has(i));
  chambers.forEach((c,i)=>c.running=occupied[3].has(i));

  shot.stages.forEach((st,s)=>{
   const status=stationStatus(result,shot,s);
   stationLabels[s].dataset.status=status;
   stationLabels[s].querySelector('.count').textContent=`작업 ${st.active.length} · 대기 ${st.queue.length}`;
   const q=queueLabels[s],over=st.queue.length-QUEUE_MAX;
   q.hidden=!st.queue.length;
   q.textContent=over>0?`대기 ${st.queue.length}기 · 표시 외 ${over}기`:`대기 ${st.queue.length}기`;
   q.classList.toggle('hot',status==='bottleneck');
   const z=zoneSet.zones[s],sel=selection?.type==='station'&&selection.s===s;
   z.fill.color.set(status==='bottleneck'?0xfdeceb:sel?0xe2ebfd:0xeef3fb);
   z.edge.material.color.set(status==='bottleneck'?0xe6392e:sel?0x2563eb:0xb8c7dc);
   z.bottleneck=status==='bottleneck';
  });
  const reworkOn=result.config.rework>0;
  zoneSet.rework.visible=reworkOn;reworkLabel.hidden=!reworkOn;
  reworkLabel.textContent=`재작업 루프 · ${result.reworkCount}기`;
  refreshSatLabel();
 }

 function refreshSatLabel(){
  if(selection?.type!=='sat'||!state){satLabel.hidden=true;return;}
  const st=satelliteStatus(state.result.jobs[selection.id-1],state.day);
  const where=st.phase==='pending'?'투입 전':st.phase==='shipped'?'출하 완료':`${LABELS[st.stage]} ${st.phase==='active'?`${Math.round(st.progress*100)}%`:'대기'}`;
  satLabel.textContent=`${satName(selection.id)} · ${where}`;
  satLabel.classList.toggle('retry',!!st.retry);
 }

 function destinationFor(id){
  const st=satelliteStatus(state.result.jobs[id-1],state.day);
  if(st.phase==='pending')return queueSlot(0,0);
  if(st.phase==='shipped')return null;
  if(st.phase==='queue')return new Vector3(ZONES[st.stage].x,FLOOR,ZONE_Z+2);
  return st.stage===4?EXIT.clone():new Vector3(ZONES[st.stage+1].x,FLOOR,QUEUE_Z);
 }

 function flyTo(target,dist,dir,chase=null){
  const offset=(dir??camera.position.clone().sub(controls.target)).normalize().multiplyScalar(dist);
  if(reduced){controls.target.copy(target);camera.position.copy(target).add(offset);controls.update();return;}
  tween={start:performance.now(),dur:950,p0:camera.position.clone(),t0:controls.target.clone(),t1:target.clone(),offset,chase};
 }
 function select(sel,{fly=true}={}){
  selection=sel;followOn=sel?.type==='sat';if(fly)moved=true;
  if(sel?.type==='station'){
   if(fly)flyTo(new Vector3(ZONES[sel.s].x,0,ZONE_Z+6),Math.max(70,ZONES[sel.s].w*2.4));
  }else if(sel?.type==='sat'&&state){
   const sat=sats.get(sel.id);
   const st=satelliteStatus(state.result.jobs[sel.id-1],state.day);
   const target=sat?sat.group.position.clone():st.phase==='shipped'?EXIT.clone():SPAWN.clone();
   if(fly)flyTo(target,52,null,sat??null);
  }
  if(state)update(state);
 }

 const ray=new Raycaster(),ndc=new Vector2();
 const shown=o=>{for(let n=o;n;n=n.parent)if(!n.visible)return false;return true;};
 function pick(e){
  const r=canvas.getBoundingClientRect();
  ndc.set((e.clientX-r.left)/r.width*2-1,-(e.clientY-r.top)/r.height*2+1);
  ray.setFromCamera(ndc,camera);
  const meshes=[];for(const s of sats.values())meshes.push(s.cart,s.crate,s.plates,s.bus,s.panel);
  const hit=ray.intersectObjects(meshes,false).find(h=>shown(h.object));
  if(hit)return {type:'sat',id:hit.object.userData.satId};
  const zone=ray.intersectObjects(zoneSet.zones.map(z=>z.pick),false)[0];
  return zone?{type:'station',s:zone.object.userData.station}:null;
 }
 let down=null,hoverAt=0;
 canvas.addEventListener('pointerdown',e=>{down={x:e.clientX,y:e.clientY};canvas.style.cursor='grabbing';stage.classList.add('touched');});
 setTimeout(()=>stage.classList.add('touched'),9000);
 canvas.addEventListener('pointerup',e=>{
  canvas.style.cursor='';
  if(!down)return;const moved=Math.hypot(e.clientX-down.x,e.clientY-down.y);down=null;
  if(moved<6){const hit=pick(e);if(hit)onSelect(hit);}
 });
 canvas.addEventListener('pointermove',e=>{
  if(e.buttons||performance.now()-hoverAt<90)return;hoverAt=performance.now();
  canvas.style.cursor=pick(e)?'pointer':'';
 });
 controls.addEventListener('start',()=>{tween=null;moved=true;});

 const v=new Vector3();
 let width=1,height=1;
 function place(el,p,dy=0){
  v.copy(p).project(camera);
  const off=v.z>1||v.x<-1.15||v.x>1.15||v.y<-1.15||v.y>1.15;
  if(el.dataset.off!==String(off)){el.dataset.off=off;}
  if(!off)el.style.transform=`translate(${((v.x+1)/2*width).toFixed(1)}px,${((1-v.y)/2*height+dy).toFixed(1)}px)`;
 }
 const tmp=new Vector3();
 function placeLabels(){
  stationLabels.forEach((el,s)=>place(el,tmp.set(ZONES[s].x,11,-27)));
  queueLabels.forEach((el,s)=>{if(!el.hidden)place(el,tmp.set(ZONES[s].x,FLOOR,QUEUE_Z+3*QUEUE_GAP+.6),14);});
  if(!reworkLabel.hidden)place(reworkLabel,zoneSet.reworkApex);
  if(selection?.type==='sat'){
   const sat=sats.get(selection.id);
   satLabel.hidden=!sat;
   if(sat)place(satLabel,tmp.copy(sat.group.position).add(new Vector3(0,sat.group.visible?5.4:6.4,0)));
  }
 }

 function animate(dt,now){
  elapsed+=dt;
  const k=reduced?1:1-Math.exp(-dt*4.2);
  for(const sat of [...sats.values()]){
   const p=sat.group.position;p.lerp(sat.target,k);
   const sc=sat.group.scale.x+(sat.scale-sat.group.scale.x)*k;sat.group.scale.setScalar(sc);
   const d=p.distanceTo(sat.target);
   const moving=d>1.2;
   sat.cart.visible=sat.wantCart||moving;sat.body.position.y=sat.cart.visible?.45:0;
   if(sat.hide&&d<.8)sat.group.visible=false;
   if(sat.leaving&&d<1.6)removeSat(sat);
   if(sat.marker.visible)sat.marker.rotation.y+=dt*2.2;
  }
  if(!reduced){
   const pulse=.55+.45*Math.sin(elapsed*4);
   fixtures[0].lights.forEach(m=>m.emissiveIntensity=m.userData.on?.5+.6*pulse:0);
   fixtures[2].screens.forEach(m=>m.emissiveIntensity=m.userData.on?.65+.35*pulse:.05);
   fixtures[1]?.arms.forEach(a=>{
    if(!a.on||!a.busy)return;
    a.shoulder.rotation.z=-.55+Math.sin(elapsed*1.6+a.phase)*.22;
    a.elbow.rotation.z=-1.35+Math.sin(elapsed*2.1+a.phase)*.3;
   });
   for(const z of zoneSet.zones)if(z.bottleneck)z.edge.material.opacity=.45+.55*pulse;else z.edge.material.opacity=1;
   for(const t of env.road){t.position.x+=(t.rotation.y?-1:1)*dt*9;if(t.position.x>260)t.position.x=-260;if(t.position.x<-260)t.position.x=260;}
  }else{
   fixtures[0].lights.forEach(m=>m.emissiveIntensity=m.userData.on?.8:0);
   fixtures[2].screens.forEach(m=>m.emissiveIntensity=m.userData.on?.8:.05);
  }
  for(const c of chambers){
   const goal=c.running?0:-1.9;c.pivot.rotation.y+=(goal-c.pivot.rotation.y)*(reduced?1:1-Math.exp(-dt*3));
   c.ring.emissiveIntensity=c.running?(reduced?.9:.6+.5*Math.sin(elapsed*3)):0;
  }
  const sat=selection?.type==='sat'?sats.get(selection.id):null;
  selBox.visible=!!sat;
  if(sat){
   selBox.position.copy(sat.group.position);selBox.position.y+=sat.group.visible?2.4:2.9;
   selBox.scale.setScalar(sat.group.visible?1:1.55);
   // Keep the camera's offset to a moving spacecraft; orbit/zoom/pan still work around it.
   if(followOn&&!tween){const delta=tmp.copy(sat.group.position).sub(lastFollow);camera.position.add(delta);controls.target.add(delta);}
   lastFollow.copy(sat.group.position);
  }
  const dest=sat&&state?destinationFor(sat.id):null;
  pin.visible=!!dest;
  dots.forEach((d,i)=>{
   d.visible=!!dest;
   if(!dest)return;
   const a=(i+1)/(dots.length+1);
   d.position.set(sat.group.position.x+(dest.x-sat.group.position.x)*a,FLOOR+.07,sat.group.position.z+(dest.z-sat.group.position.z)*a);
   d.material.opacity=reduced?.85:.35+.65*Math.max(0,Math.sin(elapsed*5-i*.55));
  });
  if(dest){pin.position.set(dest.x,FLOOR+5.5+(reduced?0:Math.sin(elapsed*2.4)*.5),dest.z);pin.rotation.y=elapsed*.8;}
  if(tween){
   // Wall-clock progress so slow frames do not stretch the flight; a chased spacecraft keeps moving the goal.
   if(tween.chase&&sats.get(tween.chase.id)===tween.chase)tween.t1.copy(tween.chase.group.position);
   const a=Math.min(1,(now-tween.start)/tween.dur),e=a<.5?4*a*a*a:1-Math.pow(-2*a+2,3)/2;
   controls.target.lerpVectors(tween.t0,tween.t1,e);
   camera.position.lerpVectors(tween.p0,tmp.copy(tween.t1).add(tween.offset),e);
   if(a>=1)tween=null;
  }
 }

 let last=performance.now(),inView=true,running=false;
 function frame(now){
  const dt=Math.min(.25,(now-last)/1000);last=now;
  animate(dt,now);controls.update();
  renderer.render(scene,camera);placeLabels();
 }
 // Render only while the twin is on screen and the tab is visible.
 function loop(){last=performance.now();running=inView&&!document.hidden;renderer.setAnimationLoop(running?frame:null);}
 new IntersectionObserver(([e])=>{inView=e.isIntersecting;loop();}).observe(stage);
 document.addEventListener('visibilitychange',loop);
 new ResizeObserver(()=>{
  width=stage.clientWidth||1;height=stage.clientHeight||1;
  renderer.setSize(width,height);camera.aspect=width/height;
  // Centre the projection in the area the overlay cards leave free (CSS sets the insets per layout).
  const cs=getComputedStyle(stage);
  for(const k of ['top','right','bottom'])insets[k]=parseFloat(cs.getPropertyValue(`--inset-${k}`))||0;
  camera.setViewOffset(width,height,insets.right/2,(insets.bottom-insets.top)/2,width,height);
  if(!moved){controls.target.copy(HOME.target);camera.position.copy(HOME.target).addScaledVector(HOME.dir,homeDist());}
  if(!running){renderer.render(scene,camera);placeLabels();}
 }).observe(stage);
 loop();

 return {
  update,select,
  resetView(){followOn=false;flyTo(HOME.target,homeDist(),HOME.dir.clone());},
  zoom(f){const dist=Math.min(controls.maxDistance,Math.max(controls.minDistance,camera.position.distanceTo(controls.target)*f));flyTo(controls.target.clone(),dist);},
  toggleRotate(){controls.autoRotate=!controls.autoRotate;return controls.autoRotate;}
 };
}

// 工房の3D描画。計算はモデルに任せ、表示倍率、照明、視点だけをここで変える。
import { toThree, cameraPosition } from './view3d.js';
import { attachOrbitControls } from './orbit-controls.js';
import { studioTexture, haloTexture } from './studio-art.js';

export const THREE_LOCAL_URL = new URL('../../vendor/three.module.js', import.meta.url).href;
export const THREE_URL = THREE_LOCAL_URL;
export async function loadThree(urls=[THREE_LOCAL_URL]) {
  const errors=[];
  for(const url of urls){try{return await import(url);}catch(e){errors.push(String(e.message));}}
  throw new Error('同梱の3D描画を読み込めません：'+errors.join(' / '));
}
const SCALE=10, TRAIL_MAX=3000;
const remove=object=>{object.parent?.remove(object);object.geometry?.dispose();object.material?.dispose();};

export async function createThree3D(canvas,{url,theater=false}={}) {
  const T=await loadThree(url?[url]:undefined);
  const renderer=new T.WebGLRenderer({canvas,antialias:true,alpha:false,powerPreference:'high-performance'});
  renderer.outputColorSpace=T.SRGBColorSpace;
  renderer.setClearColor(0x0b1426,1);
  const scene=new T.Scene(),camera=new T.PerspectiveCamera(42,1,.05,520);
  const hemi=new T.HemisphereLight(0xe1f4ff,0x314064,1.6);
  const key=new T.DirectionalLight(0xffecd2,2.3);key.position.set(7,11,10);
  const fill=new T.DirectionalLight(0x90c4ff,1.1);fill.position.set(-7,1,-8);
  const planetLight=new T.PointLight(0xfff4d6,4.3,0,0);
  scene.add(hemi,key,fill,planetLight);
  const world=new T.Group();scene.add(world);
  const textures=new Map(),halo=haloTexture(T);
  const meshes=new Map(),trails=new Map(),guides=new Map(),clouds=new Map(),arrows=[],rods=[];
  const sphere=new T.SphereGeometry(1,theater?48:32,theater?32:24);
  const cube=new T.BoxGeometry(1,1,1), cylinder=new T.CylinderGeometry(1,1,1,12);
  let dimensions='',grid=null,focus='',theme='';
  const cam={theta:.55,phi:1.07,dist:theater?26:28};
  const detach=attachOrbitControls(canvas,cam);
  const projected=new T.Vector3(), direction=new T.Vector3(), up=new T.Vector3(0,1,0);
  const tags=document.createElement('div');tags.className='studio-label-layer';tags.setAttribute('aria-hidden','true');
  canvas.parentElement?.append(tags);
  const tagNodes=new Map();
  let seed=1527;
  const rnd=()=>((seed=(Math.imul(1664525,seed)+1013904223)>>>0)/4294967296);
  const starPos=new Float32Array(6000),starColors=new Float32Array(6000);
  for(let i=0;i<starPos.length;i+=3){
    const a=rnd()*2*Math.PI,z=rnd()*2-1,r=170+rnd()*29,l=Math.sqrt(1-z*z),b=.33+rnd()*.6;
    starPos.set([r*l*Math.cos(a),r*z,r*l*Math.sin(a)],i);starColors.set([b*(.71+rnd()*.29),b*(.79+rnd()*.21),b],i);
  }
  const starGeo=new T.BufferGeometry();starGeo.setAttribute('position',new T.BufferAttribute(starPos,3));starGeo.setAttribute('color',new T.BufferAttribute(starColors,3));
  const stars=new T.Points(starGeo,new T.PointsMaterial({vertexColors:true,size:.59,transparent:true,opacity:.83,depthWrite:false}));
  scene.add(stars);

  function body(b){
    const old=meshes.get(b.id);if(old)return old;
    const outer=new T.Group();world.add(outer);
    let map=null;
    if(b.look){if(!textures.has(b.look))textures.set(b.look,studioTexture(T,b.look));map=textures.get(b.look);}
    const opacity=b.opacity??1;
    const m=b.wire?new T.LineSegments(new T.EdgesGeometry(cube),new T.LineBasicMaterial({color:b.color,transparent:true,opacity:.76})):
      new T.Mesh(b.box?cube:sphere,b.look==='sun'||b.material==='light'
        ? new T.MeshBasicMaterial({color:map?0xffffff:b.color,map})
        : new T.MeshStandardMaterial({color:map?0xffffff:b.color,map,transparent:opacity<1,opacity,depthWrite:opacity>=1,
          roughness:b.material==='metal'?.31:.66,metalness:b.material==='metal'?.30:.04,emissive:b.color,emissiveIntensity:opacity<1?.12:.045}));
    outer.add(m);
    if(b.ring) {
      const base=b.look==='saturn'?0xcda97c:0x9af4ee;
      const tilt=new T.Group();tilt.rotation.x=Math.PI/2+.30;outer.add(tilt);
      for(const [a,z,op] of [[1.32,1.50,.48],[1.53,1.81,.78],[1.88,2.04,.46],[2.07,2.31,.65]]) {
        const ring=new T.Mesh(new T.RingGeometry(a,z,96),new T.MeshBasicMaterial({color:base,side:T.DoubleSide,transparent:true,opacity:op,depthWrite:false}));
        tilt.add(ring);
      }
    }
    if(b.atmosphere){
      const air=new T.Mesh(sphere,new T.ShaderMaterial({
        uniforms:{tint:{value:new T.Color(0x68caff)}},side:T.FrontSide,transparent:true,depthWrite:false,
        vertexShader:'varying vec3 n; varying vec3 viewDir; void main(){vec4 q=modelViewMatrix*vec4(position,1.);n=normalize(normalMatrix*normal);viewDir=normalize(-q.xyz);gl_Position=projectionMatrix*q;}',
        fragmentShader:'varying vec3 n; varying vec3 viewDir; uniform vec3 tint; void main(){float f=pow(1.-max(0.,dot(normalize(n),normalize(viewDir))),3.3);gl_FragColor=vec4(tint,.54*f);}',
      }));air.scale.setScalar(1.035);outer.add(air);
    }
    if(b.glow){const light=new T.Sprite(new T.SpriteMaterial({map:halo,color:b.color,transparent:true,opacity:.64,depthWrite:false,blending:T.AdditiveBlending}));light.scale.set(5.6,5.6,1);outer.add(light);}
    const v={outer,m};meshes.set(b.id,v);return v;
  }
  function buffer(cache,spec,isCloud=false) {
    let old=cache.get(spec.id), count=spec.points.length;
    if(!old||old.count<count||old.dash!==!!spec.dash){
      if(old)remove(old.object);
      const data=new Float32Array(Math.max(count,2)*3),geo=new T.BufferGeometry();
      geo.setAttribute('position',new T.BufferAttribute(data,3).setUsage(T.DynamicDrawUsage));
      const common={color:spec.color,opacity:spec.opacity??1,transparent:true,depthWrite:false};
      const mat=isCloud?new T.PointsMaterial({...common,size:spec.size??.06, map:halo, alphaTest:.05}):spec.dash?new T.LineDashedMaterial({...common,dashSize:.10,gapSize:.07}):new T.LineBasicMaterial(common);
      const object=isCloud?new T.Points(geo,mat):new T.Line(geo,mat);
      object.frustumCulled=false;world.add(object);
      old={count,object,data,dash:!!spec.dash,points:null};cache.set(spec.id,old);
    }
    const {object,data}=old;
    object.visible=true;
    if(old.points!==spec.points){
      spec.points.forEach((p,i)=>data.set(toThree(p),i*3));object.geometry.attributes.position.needsUpdate=true;
      object.geometry.setDrawRange(0,count);
      if(old.dash){
        // 線の座標は計算単位。見た目の縮尺に合わせて破線の間隔だけ揃える。
        object.computeLineDistances();
      }
      old.points=spec.points;
    }
    object.material.color.setHex(spec.color);
    object.material.opacity=spec.opacity??1;
    if(old.dash){object.material.dashSize=.17/world.scale.x;object.material.gapSize=.11/world.scale.x;}
  }
  const clearTrail=()=>{for(const item of trails.values()){item.n=0;item.path=null;item.object.geometry.setDrawRange(0,0);}};
  function trail(b) {
    let t=trails.get(b.id);
    if(!t){
      const data=new Float32Array(TRAIL_MAX*3),g=new T.BufferGeometry();
      g.setAttribute('position',new T.BufferAttribute(data,3).setUsage(T.DynamicDrawUsage));g.setDrawRange(0,0);
      const object=new T.Line(g,new T.LineBasicMaterial({color:b.trailColor??b.color,transparent:true,opacity:.95}));
      object.frustumCulled=false;world.add(object);trails.set(b.id,t={object,data,n:0,path:null});
    }
    t.object.visible=true;
    if(b.path){
      if(t.path===b.path)return;
      t.path=b.path;t.n=Math.min(TRAIL_MAX,b.path.length);
      for(let i=0;i<t.n;i++)t.data.set(toThree(b.path[i]),i*3);
    }else{
      const q=toThree(b.pos);
      if(t.n && q.every((x,j)=>Math.fround(x)===t.data[(t.n-1)*3+j]))return;
      if(t.n>=TRAIL_MAX){t.data.copyWithin(0,3);t.n--;}
      t.data.set(q,t.n++*3);
    }
    t.object.geometry.setDrawRange(0,t.n);t.object.geometry.attributes.position.needsUpdate=true;
  }
  function layout(v,w,h) {
    tags.hidden=canvas.hidden;
    tags.style.width=w+'px';tags.style.height=h+'px';tags.style.left=canvas.offsetLeft+'px';tags.style.top=canvas.offsetTop+'px';
    const entries=[...v.bodies.filter(b=>b.label).map(b=>[b.id,b.pos,b.label,b.color]),
      ...(v.vectors??[]).flatMap((a,i)=>a.label&&Math.hypot(...a.dir)>1e-8?[['vec'+i,a.from.map((x,j)=>x+a.dir[j]),a.label,a.color]]:[])];
    // 追いかける天体は優先。全体では太陽を先に置き、文字の重なりを避ける。
    const first=focus||'sun';
    entries.sort((a,b)=>Number(b[0]===first)-Number(a[0]===first));
    const visible=new Set(),placed=[];
    for(const [id,pos,label,color] of entries){
      projected.set(...toThree(pos));world.localToWorld(projected);projected.project(camera);
      const x=(projected.x+1)*w/2,y=(1-projected.y)*h/2;
      if(projected.z < -1||projected.z > 1||x<14||x>w-24||y<17||y>h-14)continue;
      if(placed.some(([a,b])=>Math.abs(a-x)<46&&Math.abs(b-y)<17))continue;
      let tag=tagNodes.get(id);
      if(!tag){tag=document.createElement('span');tags.append(tag);tagNodes.set(id,tag);}
      tag.textContent=label;tag.style.color='#'+(color??0xa4c7ff).toString(16).padStart(6,'0');
      tag.style.transform='translate('+x.toFixed(1)+'px,'+y.toFixed(1)+'px) translate(8px,-50%)';tag.hidden=false;
      visible.add(id);placed.push([x,y]);
    }
    for(const [id,tag] of tagNodes)tag.hidden=!visible.has(id);
  }
  return {
    clearTrail,
    camera:()=>({...cam,focus}),
    setView(mode){
      focus=mode==='overview'||mode==='top'?'':mode;
      cam.theta=mode==='top'?0:.55;cam.phi=mode==='top'?.05:1.07;cam.dist=focus?23:theater?26:28;
    },
    frame(v) {
      const dpr=Math.min(globalThis.devicePixelRatio||1,theater?1.8:1.5);
      const w=canvas.clientWidth||300,h=canvas.clientHeight||200,size=w+':'+h+':'+dpr;
      if(dimensions!==size){dimensions=size;renderer.setPixelRatio(dpr);renderer.setSize(w,h,false);camera.aspect=w/h;camera.updateProjectionMatrix();}
      const current=v.theme??(theater?'space':'lab');
      if(current!==theme){theme=current;stars.visible=current==='space';renderer.setClearColor(current==='space'?0x02040d:0x0d172a,1);}
      const target=focus?v.bodies.find(b=>b.id===focus):null;
      const center=target?.pos??v.center??[0,0,0],extent=target?Math.max(target.radius*4.3,Math.min(v.extent*.21,12)):v.extent;
      world.scale.setScalar(SCALE/extent);world.position.set(...toThree(center).map(x=>-x*SCALE/extent));
      if(v.grid!==false&&current!=='space'){
        if(!grid){grid=new T.GridHelper(20,20,0x315979,0x253b55);scene.add(grid);}
        grid.visible=true;
        grid.position.set(0,(0-center[2])*SCALE/extent,0);
      }else if(grid)grid.visible=false;
      hemi.intensity=v.lightAt?.length?1.05:1.85;key.intensity=v.lightAt?.length?.42:2.1;
      planetLight.visible=Boolean(v.lightAt);if(v.lightAt)planetLight.position.set(...toThree(v.lightAt.map((x,j)=>(x-center[j])*SCALE/extent)));
      const seen=new Set();
      for(const b of v.bodies){
        const {outer,m}=body(b);outer.visible=true;seen.add(b.id);
        outer.position.set(...toThree(b.pos));
        if(b.box||b.ellipsoid){outer.scale.set(...toThree(b.box??b.ellipsoid).map(Math.abs));}
        else outer.scale.setScalar(b.radius);
        if(b.quaternion)outer.quaternion.set(...b.quaternion);
        else outer.rotation.set(0,0,b.rotationZ??0);
        if(Number.isFinite(b.angle))m.rotation.y=b.angle;
        if(b.trail||b.path)trail(b);else if(trails.has(b.id))trails.get(b.id).object.visible=false;
      }
      for(const [id,{outer}] of meshes)if(!seen.has(id))outer.visible=false;
      for(const [id,o] of trails)if(!seen.has(id))o.object.visible=false;
      for(const [cache,list,isCloud] of [[guides,v.guides??[],false],[clouds,v.clouds??[],true]]){
        for(const o of cache.values())o.object.visible=false;
        for(const spec of list)buffer(cache,spec,isCloud);
      }
      (v.rods??[]).forEach((r,i)=>{
        if(!rods[i]){rods[i]=new T.Mesh(cylinder,new T.MeshStandardMaterial({color:0xd7ebfb,metalness:.23,roughness:.39}));world.add(rods[i]);}
        const b=rods[i],a=toThree(r.from),z=toThree(r.to);
        direction.set(...z.map((x,j)=>x-a[j]));const l=direction.length();
        b.visible=l>1e-8;b.position.set(...a.map((x,j)=>(x+z[j])/2));b.scale.set(r.radius??extent*.005,l,r.radius??extent*.005);
        b.material.color.setHex(r.color??0xd7ebfb);if(b.visible)b.quaternion.setFromUnitVectors(up,direction.normalize());
      });
      for(let i=(v.rods??[]).length;i<rods.length;i++)rods[i].visible=false;
      (v.vectors??[]).forEach((v,i)=>{
        direction.set(...toThree(v.dir));const l=direction.length();
        if(!arrows[i]){arrows[i]=new T.ArrowHelper(new T.Vector3(1,0,0),new T.Vector3(),1,v.color);world.add(arrows[i]);}
        const a=arrows[i];a.visible=l>1e-8;
        if(a.visible){a.position.set(...toThree(v.from));a.setDirection(direction.normalize());a.setLength(l,l*.23,l*.14);a.setColor(v.color);}
      });
      for(let i=(v.vectors??[]).length;i<arrows.length;i++)arrows[i].visible=false;
      camera.position.set(...cameraPosition(cam.theta,cam.phi,cam.dist));
      camera.lookAt(0,0,0);camera.updateMatrixWorld();world.updateMatrixWorld();
      renderer.render(scene,camera);layout(v,w,h);
    },
    dispose(){
      detach();tags.remove();
      scene.traverse(o=>{o.geometry?.dispose();if(Array.isArray(o.material))o.material.forEach(m=>m.dispose());else o.material?.dispose();});
      for(const tex of textures.values())tex.dispose();halo.dispose();renderer.dispose();renderer.forceContextLoss();
    },
  };
}

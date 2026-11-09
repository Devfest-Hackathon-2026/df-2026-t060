// 工房の各実験の舞台。見た目は変えても、測定値は同じエンジンの値を使う。
import { traceRays } from '../systems/lens/model.js';
import { layoutOf } from '../systems/circuit/model.js';

const TAU=Math.PI*2, cyan=0x55d8ff, amber=0xffb464, lilac=0xb5a2ff, mint=0x68ebc0;
const seq=(n,f)=>Array.from({length:n},(_,i)=>f(i));
const line=(id,points,color=cyan,opacity=.85,dash=false)=>({id,points,color,opacity,dash});
const orb=(id,pos,radius,color,label,extra={})=>({id,pos,radius,color,label,...extra});
const box=(id,pos,dims,color,label,extra={})=>orb(id,pos,1,color,label,{box:dims,...extra});
const ring=(cx,cy,cz,r,n=81)=>seq(n,i=>[cx+r*Math.cos(i*TAU/(n-1)),cy+r*Math.sin(i*TAU/(n-1)),cz]);
const ground=(id,pos,size)=>box(id,pos,size,0x26344f,'',{material:'matte'});
const vsub=(a,b)=>a.map((x,i)=>x-b[i]);
const radials=[[0,0],[.387,13],[.723,19],[1,27],[1.524,36],[5.203,52],[9.54,70],[19.18,88],[30.06,104],[60,130],[120,165]];
const catalog={
  mercury:['水星',.8,0xa8a29e],venus:['金星',1.3,0xfde047],earth:['地球',1.5,0x38bdf8],
  mars:['火星',1,0xf87171],jupiter:['木星',3.6,0xfbbf24],saturn:['土星',3,0xfcd34d],
  uranus:['天王星',2.2,0x67e8f9],neptune:['海王星',2.1,0x60a5fa],
};
function compress(p) {
  const r=Math.hypot(...p);
  if(r<1e-8)return [0,0,0];
  let i=radials.findIndex(([x])=>x>r);
  if(i<1)i=radials.length-1;
  const [a,b]=radials[i-1],[c,d]=radials[i];
  const rr=b+(r-a)*(d-b)/(c-a);
  return p.map(x=>x*rr/r);
}
let seed=6457;
const rnd=()=>((seed=(Math.imul(1664525,seed)+1013904223)>>>0)/4294967296);
const asteroid=seq(850,()=>{const a=TAU*rnd(),r=41+rnd()*6;return [r*Math.cos(a),r*Math.sin(a),(rnd()-.5)*2.3];});
const cometPath=seq(151,i=>{const t=i*TAU/150;return [68*Math.cos(t)-32,28*Math.sin(t),14*Math.sin(t)];});

function solar(o,p) {
  const bodies=[orb('sun',[0,0,0],6.5,0xffbb47,'太陽',{look:'sun',glow:true})];
  const guides=p.paths.flatMap((path,i)=>path.length?[line('orbit-'+i,path.map(compress),0x5e82a8,.6)]:[]);
  for(const v of o.planets) {
    const [name,r,color]=catalog[v.id];
    const pos=compress(vsub(v.pos,o.sun));
    bodies.push(orb(v.id,pos,r,color,name,{look:v.id,angle:o.t*(v.id==='earth'?1.2:.4),ring:v.id==='saturn'||v.id==='uranus'}));
    if(v.id==='earth') {
      const a=o.t*TAU/.0748;
      bodies.push(orb('moon',[pos[0]+3.2*Math.cos(a),pos[1]+3.2*Math.sin(a),pos[2]+.22*Math.sin(a)],.45,0xe2e8f0,'月（模式）',{look:'moon'}));
      guides.push(line('moon-orbit',ring(...pos,3.2,49),0x9eb9d4,.35));
    }
  }
  const a=(.8+o.t*.17)%TAU,c=[68*Math.cos(a)-32,28*Math.sin(a),14*Math.sin(a)];
  if(p.set==='all') {
    const d=Math.hypot(...c)||1;
    bodies.push(orb('comet',c,.9,cyan,'彗星（模式）',{material:'light',glow:true}));
    guides.push(line('comet-orbit',cometPath,0x62c5e6,.36,true),line('comet-tail',[c,c.map(x=>x*(1+10/d))],0x90e2ff,.85));
  }
  return {theme:'space',center:[0,0,0],extent:p.set==='inner'?46:118,bodies,guides,
    lightAt:[0,0,0],clouds:p.set==='all'?[{id:'belt',points:asteroid,color:0x99bad8,size:.053,static:true}]:[]};
}
function pendulum(o,p,double) {
  const L=double?p.L1+p.L2:p.L, first=double?[o.first[0],0,o.first[1]]:[o.x,0,o.y];
  const second=double?[o.second[0],0,o.second[1]]:null;
  const B=L*.12, base=-L*1.13, rods=[{from:[0,0,0],to:first,color:0xd0e4f5,radius:L*.008}];
  const bodies=[ground('bench',[0,0,base-.04*L],[1.75*L,1.05*L,.07*L]),
    box('post',[-.65*L,.27*L,base/2],[.045*L,.047*L,-base],0x738eac),
    box('beam',[-.325*L,.135*L,0],[.73*L,.06*L,.048*L],0x738eac),
    orb('pin',[0,0,0],L*.036,0xdbe7fd,'支点',{material:'metal'}),
    orb('bob-a',first,B*(double?.65:.82),amber,double?'上のおもり':'おもり',{trail:!double,trailColor:amber,material:'metal'})];
  const guides=[line('zero',[[0,0,0],[0,0,-L]],0x7d96b7,.5,true)];
  if(second){rods.push({from:first,to:second,color:0xd0e4f5,radius:L*.008});bodies.push(orb('bob-b',second,B*.65,cyan,'下のおもり',{trail:true,trailColor:cyan,material:'metal'}));}
  else guides.push(line('arc',seq(81,i=>{const a=(i/80*2-1)*Math.abs(p.theta0);return [L*Math.sin(a),0,-L*Math.cos(a)];}),cyan,.54,true));
  return {theme:'lab',extent:L*1.13,center:[0,0,-.50*L],bodies,rods,guides,grid:false};
}
function projectile(o,p,model) {
  const v=model.view3d(o,p), T=(p.vy0+Math.sqrt(p.vy0**2+2*p.g*p.h0))/p.g, d=v.extent;
  v.theme='lab';v.center[2]=Math.max(p.h0,p.h0+p.vy0**2/(2*p.g))*.42;
  v.bodies.push(ground('track',[v.center[0],0,-.023*d],[2.05*d,.94*d,.042*d]),
    box('launch-tower',[0,0,p.h0/2],[.075*d,.075*d,Math.max(.025*d,p.h0)],0x526b90,'発射台'));
  Object.assign(v.bodies[0],{label:o.landed===null?'球':'着地',material:'metal'});
  v.guides=[line('horizontal',[[-d*.07,0,0],[Math.max(d,p.vx0*T)+d*.08,0,0]],0x9caec7,.4),
    line('drop-line',[[0,0,0],[0,0,p.h0]],lilac,.72,true)];
  if(o.landed!==null)v.bodies.push(orb('impact',[o.x,0,.012*d],.022*d,mint,'着地位置',{material:'light'}));
  return v;
}
function buoyancy(o) {
  const scale=.21/Math.max(o.up,o.down,o.normal,1e-8);
  const vectors=[{from:[-.16,0,o.z],dir:[0,0,o.up*scale],color:mint,label:'浮力'},
    {from:[.16,0,o.z],dir:[0,0,-o.down*scale],color:0xff7487,label:'重力'}];
  if(o.normal>.002)vectors.push({from:[0,0,-.48],dir:[0,0,o.normal*scale],color:cyan,label:'底からの力'});
  return {theme:'lab',grid:false,extent:.5,center:[0,0,-.17],vectors,bodies:[
    ground('stand',[0,0,-.534],[.7,.58,.068]),box('glass',[0,0,-.14],[.62,.5,.72],0x83c7f2,'',{wire:true}),
    box('water',[0,0,-.25],[.61,.49,.5],0x2f9fde,'',{opacity:.22}),
    box('surface',[0,0,0],[.61,.49,.002],0x72eaff,'水面',{opacity:.37}),
    box('block',[0,0,o.z],[.1,.1,.1],amber,'物体',{material:'metal'}),
  ]};
}
function lens(o,p) {
  const ex=Math.max(2.3*p.f,1.23*p.a,Math.min(Math.abs(o.b??0)*1.22,4*p.f+2*p.a));
  const apt=Math.max(p.h*2,p.f*.54), rays=traceRays(p), colors=[cyan,mint,lilac];
  const b=[box('base',[0,0,-.34*ex],[2.12*ex,.49*ex,.038*ex],0x253c56),
    orb('lens',[0,0,0],apt,0x7cd7ff,'凸レンズ',{ellipsoid:[.045*ex,apt,apt],opacity:.26}),
    orb('f1',[-p.f,0,0],.017*ex,amber,'F',{material:'light'}),orb('f2',[p.f,0,0],.017*ex,amber,'F',{material:'light'})];
  const g=[line('axis',[[-ex,0,0],[ex,0,0]],0x96aec7,.45)];
  const v=[{from:[-p.a,0,0],dir:[0,0,p.h],color:amber,label:'物体'}];
  rays.forEach((r,i)=>{
    if(Math.abs(r.y0)>apt)return;
    const right=Math.min(ex,.75*ex/Math.max(.75,Math.abs(r.s1)));
    g.push(line('ray'+i,[[-p.a,0,p.h],[0,0,r.y0],[right,0,r.y0+r.s1*right]],colors[i],.93));
    if(o.image&&!o.image.real&&Math.abs(o.image.x)<ex)g.push(line('virtual'+i,[[0,0,r.y0],[o.image.x,0,o.image.y]],colors[i],.47,true));
  });
  if(o.image && Math.abs(o.image.x)<ex && Math.abs(o.image.y)<ex*.75) {
    v.push({from:[o.image.x,0,0],dir:[0,0,o.image.y],color:0xffdd96,label:o.image.real?'実像':'虚像'});
    if(o.image.real)b.push(box('screen',[o.image.x,0,0],[.013*ex,.38*ex,.67*ex],0x9bc9ef,'スクリーン',{opacity:.19}));
  }
  return {theme:'lab',extent:ex,center:[0,0,0],grid:false,bodies:b,vectors:v,guides:g};
}
function doppler(o,p) {
  const w=p.c*.028, guides=[];
  const k=Math.floor(o.t*p.f0);
  for(let i=Math.max(0,k-24);i<=k;i++){
    const age=o.t-i/p.f0;if(age<=0||age>.028)continue;
    const x=p.v*i/p.f0,rr=age*p.c;
    guides.push(line('wave-'+(i%25),ring(x,0,.01,rr,65),cyan,.85-.53*age/.028));
  }
  if(o.cone!=null){const a=o.cone*Math.PI/180;for(const s of [-1,1])guides.push(line('mach'+s,[[o.x,0,0],[o.x-w*Math.cos(a),s*w*Math.sin(a),0]],amber,.9,true));}
  return {theme:'lab',extent:w*1.12,center:[o.x-w*.23,0,0],bodies:[orb('source',[o.x,0,.12],.028*w,amber,'音源',{material:'light',glow:true})],guides,
    vectors:p.v?[{from:[o.x,0,0],dir:[w*.26,0,0],color:amber,label:'進む向き'}]:[]};
}
function sound(o,p) {
  const lam=o.wavelength, points=[], compressions=[], v=(x)=>x+lam*.16*(p.A/60)*Math.sin(TAU*(o.f*o.t-x/lam));
  for(let i=0;i<35;i++) for(let j=-1;j<=1;j++)points.push([v(lam*i/16),j*lam*.11,0]);
  for(let j=-2;j<=3;j++){const x=lam*(o.f*o.t-Math.floor(o.f*o.t)+j+.5);if(x<0||x>2.2*lam)continue;compressions.push(line('crest'+j,[[x,-.36*lam,0],[x,.36*lam,0]],cyan,.55,true));}
  return {theme:'lab',extent:lam*1.2,center:[lam*1.07,0,0],bodies:[
    box('speaker',[-.08*lam,0,0],[lam*.095,lam*.48,lam*.46],0x6883a5,'音源'),
    orb('marked',[v(lam),0,0],lam*.026,amber,'同じ空気の粒',{material:'light'})],
    clouds:[{id:'air',points,color:cyan,size:.072}],guides:compressions};
}
function along(pts,d) {
  for(let j=1;j<pts.length;j++){const [a,b]=[pts[j-1],pts[j]],l=Math.hypot(...vsub(a,b));if(d<=l)return a.map((x,k)=>x+(b[k]-x)*d/l);d-=l;}
  return pts.at(-1);
}
function circuit(o,p) {
  const layout=layoutOf(p.layout), w=.15, b=[ground('board',[5,3,-.18],[9.6,5.8,.32]),
    box('battery',[1,3,.17],[.75,1,.33],0xf2b35f,p.V+' V',{material:'metal'})], rods=[], lights=[];
  const peak=Math.max(1e-9,...o.parts.map(x=>Math.abs(x.I)));
  for(const path of layout.paths) {
    const pts=path.pts.map(([x,y])=>[x,y,.17]);
    const length=pts.slice(1).reduce((s,q,i)=>s+Math.hypot(...vsub(q,pts[i])),0);
    const amps=Math.min(...path.via.map(n=>Math.abs(o.parts.find(x=>x.name===n).I)));
    pts.slice(1).forEach((q,i)=>rods.push({from:pts[i],to:q,color:0x658db1,radius:.045}));
    for(let d=(o.t*2.7*amps/peak)%.61;d<length;d+=.61)lights.push(along(pts,d).map((x,i)=>i===2?x+w:x));
  }
  for(const q of o.parts){
    const [[x,y],dir]=layout.draw[q.name],hot=Math.min(1,q.P/6);
    b.push(box('res-'+q.name,[x,y,.26],dir==='h'?[1.24,.44,.40]:[.44,1.24,.40],hot>.48?amber:0xbd9875,q.name+' '+q.R+' Ω',{material:'metal'}));
  }
  return {theme:'lab',extent:5.2,center:[5,3,0],grid:false,bodies:b,rods,
    clouds:[{id:'current',points:lights,color:0xffe17d,size:.10}]};
}

export function studioView(engine, options={}) {
  const {p,system}=engine,o=engine.observe();
  switch(system.name){
    case 'solar':return solar(o,p);
    case 'orbit': {
      const v=system.model.view3d(o,p,options);
      v.theme='space';v.grid=false;Object.assign(v.bodies[0],{look:'earth',label:'地球',angle:o.t/86400,atmosphere:true});
      v.bodies[1].material='light';v.bodies[1].label='衛星';
      v.guides=[line('launch-alt',ring(0,0,0,p.r0,111),0x91b1de,.41,true)];
      return v;
    }
    case 'projectile':return projectile(o,p,system.model);
    case 'pendulum':return pendulum(o,p,false);
    case 'doublependulum':return pendulum(o,p,true);
    case 'domino': {
      const v=system.model.view3d(o,p);v.theme='lab';
      const d=v.extent;v.grid=false;
      v.bodies[0].label='最初の板';v.bodies.push(ground('floor',[v.center[0],0,-.017],[2.2*d,1.05*d,.034]));
      v.guides=[line('measure',[[-.08,0,.003],[v.center[0]*2+.07,0,.003]],0x83b5e2,.42,true)];
      return v;
    }
    case 'buoyancy':return buoyancy(o);
    case 'circuit':return circuit(o,p);
    case 'doppler':return doppler(o,p);
    case 'lens':return lens(o,p);
    case 'sound':return sound(o,p);
    default:return system.model.view3d(o,p,options);
  }
}

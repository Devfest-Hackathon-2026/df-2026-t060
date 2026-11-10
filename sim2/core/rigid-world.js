// 工房用の小規模な剛体ソルバー。球・直方体・平面、重力、反発、クーロン摩擦。
// 衝突法線は球の最近点またはOBBの分離軸で求め、接触点の並進・回転にインパルスを配る。
// 連続衝突検出や変形は扱わない。速い物体も固定刻みを細かくして進める。
const add=(a,b)=>a.map((x,i)=>x+b[i]);
const sub=(a,b)=>a.map((x,i)=>x-b[i]);
const mul=(a,n)=>a.map(x=>x*n);
const dot=(a,b)=>a[0]*b[0]+a[1]*b[1]+a[2]*b[2];
const cross=(a,b)=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
const unit=a=>mul(a,1/(Math.hypot(...a)||1));
const clamp=(x,l,h)=>Math.max(l,Math.min(h,x));
export class Vec3 {
  constructor(x=0,y=0,z=0){this.set(x,y,z);}
  set(x,y,z){this.x=x;this.y=y;this.z=z;return this;}
  get a(){return [this.x,this.y,this.z];}
  put(a){this.set(...a);}
}
export class Quaternion {
  constructor(){this.x=this.y=this.z=0;this.w=1;}
  setFromEuler(x,y,z){
    const [s,c]=[[x,y,z].map(a=>Math.sin(a/2)),[x,y,z].map(a=>Math.cos(a/2))];
    this.x=s[0]*c[1]*c[2]+c[0]*s[1]*s[2];this.y=c[0]*s[1]*c[2]-s[0]*c[1]*s[2];
    this.z=c[0]*c[1]*s[2]+s[0]*s[1]*c[2];this.w=c[0]*c[1]*c[2]-s[0]*s[1]*s[2];
  }
  rotate(v){const a=[this.x,this.y,this.z], t=mul(cross(a,v),2);return add(add(v,mul(t,this.w)),cross(a,t));}
  integrate(w,dt){
    const v=[this.x,this.y,this.z], d=mul(add(mul(w,this.w),cross(w,v)),dt/2);
    const q=[...add(v,d),this.w-dot(w,v)*dt/2], r=Math.hypot(...q)||1;
    [this.x,this.y,this.z,this.w]=q.map(x=>x/r);
  }
}
export class Sphere { constructor(r){this.kind='sphere';this.r=r;} }
export class Box { constructor(h){this.kind='box';this.h=h.a;} }
export class Plane { constructor(){this.kind='plane';} }
export class Body {
  constructor({mass=0,shape,position=new Vec3(),restitution=.13,friction=.48}={}){
    Object.assign(this,{mass,shape,position,restitution,friction});
    this.velocity=new Vec3();this.angularVelocity=new Vec3();this.quaternion=new Quaternion();
    this.inv=mass>0?1/mass:0;
    this.ii = !this.inv ? [0,0,0] : shape.kind==='sphere' ? Array(3).fill(2.5/(mass*shape.r**2)) :
      shape.h.map((_,i)=>3/(mass*(shape.h[(i+1)%3]**2+shape.h[(i+2)%3]**2)));
  }
}
const signs=Array.from({length:8},(_,i)=>[i&1?1:-1,i&2?1:-1,i&4?1:-1]);
function proxy(b) {
  const x=b.position.a, a=[[1,0,0],[0,1,0],[0,0,1]].map(u=>b.quaternion.rotate(u));
  const {kind,h,r}=b.shape;
  const v=kind==='box'?signs.map(s=>a.reduce((p,u,i)=>add(p,mul(u,s[i]*h[i])),x)):[];
  const reach=kind==='box'?x.map((_,i)=>a.reduce((s,u,j)=>s+Math.abs(u[i])*h[j],0)):x.map(()=>r);
  return {b,x,a,kind,h,r,v,reach};
}
const local=(p,x)=>p.a.map(a=>dot(sub(x,p.x),a));
const extent=(p,n)=>p.kind==='sphere'?p.r:p.a.reduce((s,a,i)=>s+Math.abs(dot(a,n))*p.h[i],0);
const support=(p,n)=>p.kind==='sphere'?add(p.x,mul(n,p.r)):p.a.reduce((x,a,i)=>add(x,mul(a,Math.sign(dot(a,n))*p.h[i])),p.x);
const hits=(a,b)=>a.x.every((x,i)=>Math.abs(x-b.x[i])<=a.reach[i]+b.reach[i]+1e-6);
const point=(p,d)=>({p,d});
function contact(a,b) {
  if(a.kind==='plane' || b.kind==='plane'){
    if(b.kind==='plane'){const r=contact(b,a);return r?{n:mul(r.n,-1),points:r.points}:null;}
    const n=a.a[2], vs=b.kind==='sphere'?[sub(b.x,mul(n,b.r))]:b.v;
    const pts=vs.map(v=>point(v,-dot(sub(v,a.x),n))).filter(c=>c.d>0).sort((x,y)=>y.d-x.d).slice(0,4);
    return pts.length?{n,points:pts}:null;
  }
  if(!hits(a,b))return null;
  const delta=sub(b.x,a.x);
  if(a.kind==='sphere'&&b.kind==='sphere'){
    const l=Math.hypot(...delta), n=l>1e-8?mul(delta,1/l):[1,0,0], d=a.r+b.r-l;
    return d>0?{n,points:[point(add(a.x,mul(n,a.r-d/2)),d)]}:null;
  }
  if(a.kind==='sphere'&&b.kind==='box'){const r=contact(b,a);return r?{n:mul(r.n,-1),points:r.points}:null;}
  if(a.kind==='box'&&b.kind==='sphere'){
    const l=local(a,b.x), p=a.a.reduce((x,u,i)=>add(x,mul(u,clamp(l[i],-a.h[i],a.h[i]))),a.x);
    const sep=sub(b.x,p), len=Math.hypot(...sep);
    if(len>1e-8)return len<b.r?{n:mul(sep,1/len),points:[point(p,b.r-len)]}:null;
    const ds=l.map((x,i)=>a.h[i]-Math.abs(x)), i=ds.indexOf(Math.min(...ds));
    const n=mul(a.a[i],l[i]<0?-1:1);
    return {n,points:[point(add(b.x,mul(n,ds[i])),b.r+ds[i])]};
  }
  let n=null,d=Infinity;
  const axes=[...a.a,...b.a,...a.a.flatMap(u=>b.a.map(v=>cross(u,v)))];
  for(const u of axes){
    const len=Math.hypot(...u);if(len<1e-6)continue;
    const ax=mul(u,1/len), proj=dot(delta,ax), overlap=extent(a,ax)+extent(b,ax)-Math.abs(proj);
    if(overlap<=0)return null;
    if(overlap<d){d=overlap;n=mul(ax,proj<0?-1:1);}
  }
  const middle=(dot(a.x,n)+extent(a,n)+dot(b.x,n)-extent(b,n))/2;
  const inside=(p,x)=>local(p,x).every((v,i)=>Math.abs(v)<=p.h[i]+1e-5);
  const pts=[];
  for(const x of [...a.v.filter(x=>inside(b,x)),...b.v.filter(x=>inside(a,x))]){
    const q=add(x,mul(n,middle-dot(x,n)));
    if(pts.every(o=>Math.hypot(...sub(o.p,q))>1e-4))pts.push(point(q,d));
  }
  return {n,points:pts.length?pts.slice(0,4):[point(mul(add(support(a,n),support(b,mul(n,-1))),.5),d)]};
}
const inverseInertia=(o,v)=>o.a.reduce((p,a,i)=>add(p,mul(a,dot(v,a)*o.b.ii[i])),[0,0,0]);
const velAt=(b,r)=>add(b.velocity.a,cross(b.angularVelocity.a,r));
const eff=(o,r,n)=>o.b.inv+dot(cross(inverseInertia(o,cross(r,n)),r),n);
function apply(o,r,j){
  const b=o.b;if(!b.inv)return;
  b.velocity.put(add(b.velocity.a,mul(j,b.inv)));
  b.angularVelocity.put(add(b.angularVelocity.a,inverseInertia(o,cross(r,j))));
}
export class World {
  constructor(){this.gravity=new Vec3(0,-9.80665,0);this.bodies=[];this.contacts=[];}
  addBody(b){if(!this.bodies.includes(b))this.bodies.push(b);}
  removeBody(b){this.bodies=this.bodies.filter(x=>x!==b);}
  step(dt){
    const count=Math.max(1,Math.ceil(dt*240-1e-7));
    this.contacts=[];
    for(let j=0;j<count;j++)this.tick(dt/count);
  }
  tick(dt) {
    for(const b of this.bodies) if(b.inv){
      b.velocity.put(add(mul(b.velocity.a,.9999),mul(this.gravity.a,dt)));
      b.angularVelocity.put(mul(b.angularVelocity.a,.9994));
      b.position.put(add(b.position.a,mul(b.velocity.a,dt)));
      b.quaternion.integrate(b.angularVelocity.a,dt);
    }
    const shapes=this.bodies.map(proxy), cs=[];
    for(let i=0;i<shapes.length;i++)for(let j=i+1;j<shapes.length;j++){
      const a=shapes[i],b=shapes[j];if(!a.b.inv&&!b.b.inv)continue;
      const c=contact(a,b);if(!c)continue;
      this.contacts.push([a.b,b.b]);
      for(const {p,d} of c.points){
        const u=sub(p,a.x),v=sub(p,b.x), n=c.n, rel=sub(velAt(b.b,v),velAt(a.b,u)), vn=dot(rel,n);
        const t=unit(sub(rel,mul(n,vn)));
        cs.push({a,b,u,v,n,t,normal:0,friction:0,
          mu:Math.sqrt(a.b.friction*b.b.friction),
          k:eff(a,u,n)+eff(b,v,n),
          kt:eff(a,u,t)+eff(b,v,t),
          bias:Math.min(.7,Math.max(0,d-.00025)*.12/dt)+(vn<-.45?-vn*Math.min(a.b.restitution,b.b.restitution):0)});
      }
    }
    for(let i=0;i<10;i++)for(const c of cs){
      const rel=()=>sub(velAt(c.b.b,c.v),velAt(c.a.b,c.u));
      const impulse=(axis,d)=>{const j=mul(axis,d);apply(c.a,c.u,mul(j,-1));apply(c.b,c.v,j);};
      const n=Math.max(0,c.normal+(c.bias-dot(rel(),c.n))/c.k);
      impulse(c.n,n-c.normal);c.normal=n;
      const f=clamp(c.friction-dot(rel(),c.t)/c.kt,-c.mu*n,c.mu*n);
      impulse(c.t,f-c.friction);c.friction=f;
    }
  }
}
// 元の3D描画関数が使うAPIの、必要な範囲だけ。
export class SAPBroadphase { constructor() {} }

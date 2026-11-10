// 小さな模様は描画用。観測写真や計算モデルの地図ではない。通信なしで同じ絵を出す。
export function studioTexture(THREE, look) {
  const c=document.createElement('canvas');c.width=512;c.height=256;
  const g=c.getContext('2d'), w=c.width,h=c.height;
  let seed=2817+[...look].reduce((a,b)=>a+b.charCodeAt(0),0);
  const rand=()=>((seed=(Math.imul(seed,1664525)+1013904223)>>>0)/4294967296);
  const paint=(color)=>{g.fillStyle=color;g.fillRect(0,0,w,h);};
  const ell=(x,y,rx,ry,color)=>{g.beginPath();g.ellipse(x,y,rx,ry,0,0,Math.PI*2);g.fillStyle=color;g.fill();};
  if(look==='earth'){
    paint('#155aa2');
    const bath=g.createLinearGradient(0,0,0,h);bath.addColorStop(0,'#c0dcec');bath.addColorStop(.14,'#2065b2');bath.addColorStop(.45,'#0e68a0');bath.addColorStop(.78,'#153c87');bath.addColorStop(1,'#b4cddc');paint(bath);
    const continents=[
      [[-168,66],[-135,71],[-108,77],[-86,68],[-65,55],[-80,43],[-73,37],[-85,28],[-95,18],[-85,8],[-101,13],[-114,26],[-124,39],[-136,57],[-160,58]],
      [[-81,11],[-67,12],[-51,6],[-36,-7],[-44,-23],[-54,-31],[-67,-54],[-73,-41],[-77,-18],[-81,1]],
      [[-55,83],[-22,78],[-28,59],[-49,61],[-63,72]],
      [[-10,36],[-16,20],[-17,12],[-5,5],[10,3],[13,-12],[22,-35],[36,-23],[43,-12],[51,11],[40,15],[35,29],[15,35]],
      [[-10,36],[-9,46],[6,56],[22,58],[19,69],[31,72],[55,68],[83,75],[128,72],[156,62],[173,64],[162,52],[142,47],[130,31],[120,22],[102,16],[111,3],[98,2],[88,20],[81,9],[69,24],[61,25],[55,17],[44,25],[34,37],[23,37],[10,45]],
      [[113,-21],[125,-13],[138,-16],[145,-11],[153,-28],[145,-39],[125,-34],[115,-30]],
      [[46,-14],[50,-16],[49,-26],[43,-24]],
      [[-179,-74],[-138,-71],[-94,-76],[-55,-64],[-22,-73],[38,-68],[82,-71],[131,-68],[179,-76],[179,-90],[-179,-90]],
    ];
    for(const coast of continents){
      const poly=new Path2D();coast.forEach(([lng,lat],i)=>poly[i?'lineTo':'moveTo']((lng+180)*w/360,(90-lat)*h/180));poly.closePath();
      g.save();g.clip(poly);
      const land=g.createLinearGradient(0,0,0,h);land.addColorStop(0,'#e5e9df');land.addColorStop(.18,'#5a895f');land.addColorStop(.35,'#829852');land.addColorStop(.42,'#bbac6b');land.addColorStop(.54,'#3a8151');land.addColorStop(.69,'#a69657');land.addColorStop(.84,'#567c62');land.addColorStop(1,'#f1f8fa');paint(land);
      for(let i=0;i<900;i++){const y=rand()*h;ell(rand()*w,y,1+rand()*8,1+rand()*4,i%2?'#f3c78435':'#153a2942');}
      g.restore();
    }
    for(let i=0;i<110;i++){
      const x=rand()*w,y=32+rand()*192, dx=5+rand()*25;
      const q=g.createRadialGradient(x,y,0,x,y,dx);q.addColorStop(0,'#e8f7fe86');q.addColorStop(1,'#fff0');
      g.save();g.translate(x,y);g.scale(1,.28);g.translate(-x,-y);ell(x,y,dx,dx,q);g.restore();
    }
  }else if(['jupiter','saturn','uranus','neptune','venus'].includes(look)){
    const tones={jupiter:['#ead4aa','#a77854','#f5e4c8','#a05741'],saturn:['#e7c586','#bc9561','#f8dda3','#ccac75'],uranus:['#92e7e6','#5bbec9','#b4f6ec','#a3dee5'],neptune:['#567dee','#244cb5','#809dff','#2258d1'],venus:['#f3ce81','#bd9852','#fff0b3','#e3ac54']}[look];
    for(let y=0;y<h;y++){g.fillStyle=tones[Math.floor(4*(.5+.49*Math.sin(y*.15+2*Math.sin(y*.041))))];g.fillRect(0,y,w,1);}
    for(let i=0;i<900;i++)ell(rand()*w,rand()*h,1+rand()*34,.4+rand()*1.7,i%2?'#fff2':'#10203316');
    if(look==='jupiter'){ell(w*.32,h*.64,w*.075,h*.045,'#bd6043');ell(w*.32,h*.64,w*.053,h*.031,'#d47e5a');}
  }else{
    paint({sun:'#ffc052',mars:'#b75836',moon:'#9b9c9a',mercury:'#88847a'}[look]??'#a4b5c5');
    for(let i=0;i<1100;i++)ell(rand()*w,rand()*h,1+rand()*7,1+rand()*4,look==='sun'?(i%2?'#ffef7c82':'#ec5b054c'):(i%2?'#0f182833':'#f8e7ca3b'));
    if(look!=='sun')for(let i=0;i<46;i++){const x=rand()*w,y=rand()*h,r=2+rand()*11;ell(x,y,r,r*.66,'#231d1b50');ell(x,y+1,r*.67,r*.42,'#27293633');}
  }
  const t=new THREE.CanvasTexture(c);t.colorSpace=THREE.SRGBColorSpace;t.anisotropy=4;return t;
}
export function haloTexture(THREE) {
  const c=document.createElement('canvas');c.width=c.height=128;
  const g=c.getContext('2d'), r=g.createRadialGradient(64,64,3,64,64,64);
  r.addColorStop(0,'#ffffffb8');r.addColorStop(.28,'#ffffff5c');r.addColorStop(.63,'#ffffff13');r.addColorStop(1,'#ffffff00');
  g.fillStyle=r;g.fillRect(0,0,128,128);return new THREE.CanvasTexture(c);
}

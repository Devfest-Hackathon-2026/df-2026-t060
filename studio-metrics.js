// 実験ごとに「何を見るか」を一つに絞る。値は全部、共通の計算エンジンから受け取る。
export const STUDIO = Object.freeze({
  orbit: { key:'alt', target:'ratio', time:21600, unit:'秒', pair:[1.4,1.45], cue:'同じ高度から打ち出し、同じ時刻の高さと軌道を比べる。', focus:'地表からの高さ' },
  solar: { key:'Tmain', target:'sunMass', time:3, unit:'年', pair:[1,1.3], cue:'公転周期が確定するのは1周した後。天体の距離・大きさは表示用。', focus:'一周にかかった時間' },
  projectile: { key:'range', target:'angle', time:8, unit:'秒', pair:[30,60], cue:'高さと初速をそろえ、着地した位置を比べる。', focus:'水平に進んだ距離' },
  pendulum: { key:'period', target:'L', time:8, unit:'秒', pair:[.6,1.6], cue:'同じ向きに戻るまでを1往復として時間を測る。', focus:'1往復の時間' },
  doublependulum: { key:'angle2', target:'angle2', time:8, unit:'秒', pair:[100,101], cue:'下側の初期角度だけを1°変え、8秒後の動きを比べる。', focus:'下のおもりの角度' },
  domino: { key:'fallen', target:'gap', time:8, unit:'秒', pair:[.08,.23], cue:'板の間隔だけを変え、倒れた枚数と次に届く時刻を比べる。', focus:'倒れた枚数' },
  circuit: { key:'Itotal', target:'layout', time:3, unit:'秒', pair:['series2','parallel2'], cue:'電源と抵抗をそろえて、配線のしかたと電流を比べる。', focus:'電源を流れる電流' },
  doppler: { key:'back', target:'mach', time:.06, unit:'秒', pair:[.2,.65], cue:'静止した観測者を想定し、進む音源の前後の波面を比べる。', focus:'後方の周波数' },
  lens: { key:'b', target:'a', time:.3, unit:'秒', pair:[30,15], cue:'焦点の位置をそろえ、光線が交わる場所を見る。', focus:'レンズから像までの距離' },
  sound: { key:'wavelength', target:'f', time:.06, unit:'秒', pair:[220,440], cue:'粒はその場で前後に動く。圧縮の模様が進む距離を比べる。', focus:'圧縮から次の圧縮まで' },
  buoyancy: { key:'percent', target:'rhoObject', time:12, unit:'秒', pair:[650,1200], cue:'液体を同じにして、物体の密度と水に入る割合を比べる。', focus:'水に入っている割合' },
});

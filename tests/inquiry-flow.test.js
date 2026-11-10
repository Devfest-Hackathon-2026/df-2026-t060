// 見せ場に直接かかわる回帰テスト。実データを作り、先生への転送と再現を検査する。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createEngine, runHeadless } from '../public/js/sim2/core/engine.js';
import { defaultConfig, getSystem } from '../public/js/sim2/systems/index.js';
import { captureRun, encodeContext, parseContext, localPlan, changesBetween, checkedConfig, openNotebook } from '../public/js/inquiry-data.js';
import { questionFields } from '../public/js/question-fields.js';
import { RoomStore, validateQuestion } from '../public/js/relay/room-store.js';
import { proposeInquiry } from '../server/inquiry-plan.js';
const orbit = getSystem('orbit');
const config = (ratio = 1) => ({ ...defaultConfig('orbit'), params: { alt:400, ratio, incl:0, m:1000 } });
const record = (ratio, t=1200) => { const c=config(ratio), e=runHeadless(orbit,c,t,{every:1}); return captureRun({ engine:e,config:c,seat:1,materialId:'m1',observation:'動きを見た' }); };
const context = () => ({ schema:1,rootId:'root-1',materialId:'m1',revision:1,question:'遠ざかっても戻る？',runs:[record(.6),record(1.6)],reflection:{result:'速さで変わった',evidence:'同じ出発点',reason:'重力が中心を向く',unknown:'境目はどこ？'} });

test('衝突と周期未測定を保存でき、衝突の損失を積分誤差と取り違えない',()=>{
 const run=record(.6); assert.equal(run.observed.crashed,380); assert.match(run.status,/地表/); assert.equal(run.measures.find(r=>r.key==='period').value,null);
 assert.deepEqual(run.quality.warnings,[]); assert.ok(run.quality.energyDrift < 1e-3);
 assert.equal(run.config.params.ratio,.6); assert.notEqual(run.inference.initialSpecificEnergy, run.observed.energy.total/1000);
});
test('表示の時間倍率を変えても固定刻みと同時刻の計算値は変わらない',()=>{
 const e=createEngine(orbit,config()); for(let i=0;i<10;i++) e.advance(.1);
 const ref=runHeadless(orbit,config(),e.t); assert.equal(e.dt,10); assert.ok(e.t>=590); assert.deepEqual(e.y,ref.y);
});
test('2件の実験・説明・出所をBluetoothでも落とさず渡せる',()=>{
 const c=context(), text=encodeContext(c); const q=questionFields({seat:1,text:c.question,inquiryContext:text});
 assert.equal(q.inquiryContext,text); assert.equal(validateQuestion({...q,uid:'test-student-1'}).ok,true);
 const store=new RoomStore({code:()=> 'ABC234'});const code=store.createClass({name:'test',grade:9});
 const received=store.addQuestion(code,{...q,uid:'test-student-1'}); const restored=parseContext(received.inquiryContext);
 assert.deepEqual(restored.runs.map(r=>r.id),c.runs.map(r=>r.id)); assert.equal(restored.reflection.reason,c.reflection.reason);
 assert.equal(validateQuestion({...q,inquiryContext:'a'.repeat(40001)}).ok,false);
});
test('モデルを混同せず、比較案は1条件だけを変える',()=>{
 const p=localPlan(context()); assert.deepEqual(changesBetween(...p.configs),['ratio']); assert.deepEqual(p.configs.map(c=>c.params.ratio),[1.4,1.45]);
 assert.ok(createEngine(orbit,p.configs[0]).p.eps<0);assert.ok(createEngine(orbit,p.configs[1]).p.eps>0);
 assert.throws(()=>checkedConfig({...config(),gen:{name:'orbit'}}),/対応範囲外/);assert.throws(()=>checkedConfig(config(5)),/条件/);
});
test('Gemmaへ渡るのは実際の根拠。範囲外の提案や同じ2条件を拒む',async()=>{
 let prompt; const fake=async(x)=>{prompt=x;return {json:{answer:'観察と推論を分けて比べよう',question:'境目はどこ？',rationale:'1条件をそろえる',distinguish:'時刻と距離',values:[1.4,1.45]}}};
 const c=context(),out=await proposeInquiry(encodeContext(c),c.question,fake);
 assert.ok(prompt.user.includes(c.runs[0].id)); assert.ok(prompt.user.includes('elapsed'));assert.deepEqual(out.plan.sourceRecordIds,c.runs.map(r=>r.id));
 await assert.rejects(()=>proposeInquiry(encodeContext(c),'?',async()=>({json:{question:'x',rationale:'x',distinguish:'x',values:[10,20]}})),/条件/);
 await assert.rejects(()=>proposeInquiry(encodeContext(c),'?',async()=>({json:{question:'x',rationale:'x',distinguish:'x',values:[1.4,1.4]}})),/条件2件/);
});
test('6件の軌跡を送る場合は圧縮し、同じ記録IDを維持する',()=>{
 const c=context();c.runs=Array.from({length:6},(_,i)=>({...record(1.2),trace:Array.from({length:180},(_,j)=>[j,1000000.12345678+j,2000000.12345678,3000000.12345678])}));
 const text=encodeContext(c),r=parseContext(text);assert.ok(text.length<40000);assert.equal(r.runs.length,6);assert.equal(r.runs[0].trace.length,60);assert.equal(r.runs[0].id,c.runs[0].id);
});
test('音は縦波の別モデルで、振動数2倍なら波長は半分、振幅を変えても周期は変わらない',()=>{
 const s=getSystem('sound'),c=defaultConfig('sound'); const obs=(p)=>runHeadless(s,{...c,params:p},.02).observe();
 const a=obs({f:220,A:30}),b=obs({f:440,A:30}),d=obs({f:220,A:60}); assert.equal(a.wavelength/2,b.wavelength);assert.equal(a.period,d.period);assert.equal(a.f,220);
});
test('同じブラウザでも生徒番号ごとに実験ノートを分け、再読込で復元する',()=>{
 const mem=new Map();globalThis.localStorage={getItem:k=>mem.get(k)??null,setItem:(k,v)=>mem.set(k,v)};
 const a=openNotebook({code:'ABC',seat:1,materialId:'m1'},'orbit');a.data.runs.push(record(1));a.save();
 assert.equal(openNotebook({code:'ABC',seat:2,materialId:'m1'},'orbit').data.runs.length,0);
 assert.equal(openNotebook({code:'ABC',seat:1,materialId:'m1'},'orbit').data.runs.length,1);
});

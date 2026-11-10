// 先生PCのHTTPとGemma呼出しの結線を、模擬Ollamaで確認する。実モデルの品質試験とは別。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { defaultConfig, getSystem } from '../public/js/sim2/systems/index.js';
import { runHeadless } from '../public/js/sim2/core/engine.js';
import { captureRun, encodeContext } from '../public/js/inquiry-data.js';
const listen = (s) => new Promise(r => s.listen(0, '127.0.0.1', r));
const delay = (t) => new Promise(r => setTimeout(r,t));

test('先生PCからのみ比較案を生成し、Gemmaへの根拠と戻る条件を確認する', async () => {
  let input;
  const ollama = createServer(async (req, res) => {
    let data='';for await(const chunk of req)data+=chunk;
    input=JSON.parse(data);const j={answer:'観察と推論を分けて比べよう',question:'境目を絞って確かめよう',rationale:'速さ以外をそろえる',distinguish:'同じ時刻の距離と、長時間後の帰還を比べる',values:[1.4,1.45]};
    res.setHeader('Content-Type','application/x-ndjson');res.end(JSON.stringify({message:{content:JSON.stringify(j)},done:true,eval_count:10})+'\n');
  });
  await listen(ollama);
  const reserve=createServer();await listen(reserve);const port=reserve.address().port;await new Promise(r=>reserve.close(r));
  const dir=await mkdtemp(join(tmpdir(),'inquiry-ai-'));
  const child=spawn(process.execPath,['server/index.js'],{env:{...process.env,PORT:String(port),RELAY_DATA_DIR:dir,RELAY_BLE_PORT:'off',LLM_BASE_URL:`http://127.0.0.1:${ollama.address().port}`,LLM_MODEL:'existing-friend-model'},stdio:'ignore'});
  const url=`http://127.0.0.1:${port}`;
  const post=async(p,b,headers={})=>{const r=await fetch(url+p,{method:'POST',headers:{'Content-Type':'application/json',...headers},body:JSON.stringify(b)});return {status:r.status,json:await r.json()}};
  try {
    for(let i=0;i<100;i++){try{if((await fetch(url+'/health')).ok)break}catch{}await delay(30);}
    const cls=await post('/relay/classes',{name:'確認クラス',grade:9});assert.equal(cls.status,200);
    const config=defaultConfig('orbit'),e=runHeadless(getSystem('orbit'),config,100);
    const run=captureRun({engine:e,config,seat:1,observation:'球が動いた',materialId:'m1'});
    const text=encodeContext({schema:1,rootId:'root-test',materialId:'m1',revision:1,question:'どこまで帰る？',runs:[run],reflection:{}});
    const out=await post('/api/inquiry-plan',{code:cls.json.code,inquiryContext:text,question:'どこまで帰る？'});
    assert.equal(out.status,200,JSON.stringify(out.json));assert.equal(input.model,'existing-friend-model');assert.ok(input.messages[1].content.includes(run.id));assert.equal(out.json.plan.configs[1].params.ratio,1.45);
    const denied=await post('/api/inquiry-plan',{code:cls.json.code,inquiryContext:text},{Origin:'https://different.example'});assert.equal(denied.status,401);
    const gz=await fetch(url+'/models/vosk-ja-0.22.tar.gz');assert.equal(gz.status,404);await gz.body.cancel();
    const old=await post('/api/sample',{code:cls.json.code,topic:'旧版の実験',simType:'roller'});assert.equal(old.status,400);
    const gen=await post('/api/generate',{code:cls.json.code,text:'任意コード'});assert.equal(gen.status,404);
    const raw=await fetch(url+'/original-3d.html');assert.equal(raw.status,200);await raw.body.cancel();
  } finally {child.kill();await new Promise(r=>child.exitCode!==null?r():child.once('exit',r));await new Promise(r=>ollama.close(r));}
});

// 工房の11実験・元の3D・先生が選べる範囲を実ブラウザで通す。
const assert=require('node:assert/strict');
const {chromium}=require('playwright');
const {spawn}=require('node:child_process');
const {once}=require('node:events');
const {resolve}=require('node:path');
const root=resolve(__dirname,'..');
const button=(p,name)=>p.getByRole('button',{name,exact:true});
async function main(){
  const server=spawn(process.env.PYTHON||'python3',['start_local.py','--port','0'],{cwd:root,stdio:['ignore','pipe','inherit']});
  let browser;
  try {
    const [out]=await once(server.stdout,'data');
    const origin=String(out).match(/http:\/\/127\.0\.0\.1:\d+/)?.[0];
    assert.ok(origin,String(out));
    browser=await chromium.launch({executablePath:process.env.CHROME,headless:true,args:['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
    const ctx=await browser.newContext({viewport:{width:1440,height:960}});
    ctx.setDefaultTimeout(22000);
    const outside=[],errors=[];
    await ctx.route('**/*',r=>{
      if(r.request().url().startsWith(origin+'/')||r.request().url().startsWith('blob:'))return r.continue();
      outside.push(r.request().url());return r.abort();
    });
    const newPage=async()=>{const p=await ctx.newPage();p.on('pageerror',e=>errors.push(e.message));return p;};
    const p=await newPage();
    await p.goto(origin+'/hybrid-lab.html');
    const plans=[['space','solar','太陽系'],['space','escape','脱出'],['motion','projectile','投射'],['motion','pendulum','振り子'],
      ['motion','doublependulum','二重振り子'],['motion','domino','連鎖'],['electric','circuit','回路'],['wave','doppler','ドップラー'],
      ['wave','lens','凸レンズ'],['wave','sound','音'],['fluid','buoyancy','浮力']];
    for(const [family,preset,name] of plans){
      await p.locator('[data-family='+family+']').click();
      await p.locator('[data-preset='+preset+']').click();
      if(await button(p,'3D表示').isVisible())await button(p,'3D表示').click();
      const canvas=p.locator('.lab-stage canvas.studio-canvas:not([hidden])');
      await canvas.waitFor();
      if(preset==='solar'){
        await p.getByLabel('3Dの視点').selectOption('saturn');
        await p.locator('.studio-label-layer span').filter({hasText:'土星'}).first().waitFor();
        await p.getByLabel('3Dの視点').selectOption('overview');
      }
      assert.ok((await canvas.boundingBox()).width>=260,name);
      await button(p,'おすすめの2条件を比べる').click();
      await p.locator('.lab-compare-stage .inq-controlled').waitFor();
      const fast=button(p,preset==='escape'?'6時間まで進める':'標準の観察時刻へ');
      await fast.click();await p.locator('.lab-compare-stage .inq-message').filter({hasText:'再計算しました'}).waitFor();
      const cells=await p.locator('.inq-compare-table tbody tr').count();assert.ok(cells>2);
      console.log('工房 3Dと同じ時刻の比較:',name);
    }
    await p.setViewportSize({width:390,height:844});
    assert.ok(await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'工房のスマホ幅');
    await p.waitForFunction(()=>!!navigator.serviceWorker.controller);
    await ctx.setOffline(true);
    for(const name of ['solar','projectile','domino']){
      const q=await newPage();
      await q.goto(origin+'/original-3d.html?scene='+name);
      await q.locator('#sim-stage[data-original-ready='+name+'] canvas').waitFor();
      if(name==='solar')await q.locator('[data-vmode=all]').click();
      if(name==='projectile')await q.locator('#btn-free-fall').click();
      if(name==='domino'){await q.locator('#btn-tower-scene').click();await q.locator('#btn-fire-plasma').click();}
      assert.ok(await q.locator('#hud-metric-val').textContent());
      await q.close();
      console.log('原版3D オフライン:',name);
    }
    await ctx.setOffline(false);
    const demo=await newPage();await demo.goto(origin+'/demo.html?demo');
    await demo.locator('#create').click();
    const url=await demo.locator('#links a').first().getAttribute('href');
    const t=await newPage();await t.goto(new URL(url,origin+'/').href);
    const choice=t.locator('#sampleSim option');await choice.nth(11).waitFor({state:'attached'});
    assert.equal(await choice.count(),12);
    assert.equal(await t.getByLabel('教材の実験').locator('option').count(),12);
    assert.equal(await t.getByLabel('教材で使う計算モデル').locator('option').count(),11);
    assert.equal(await t.locator('script[src*=voice]').count(),0);
    assert.deepEqual(outside,[]);assert.deepEqual(errors,[]);
    console.log('工房の11件だけを教材・取り込み・Gemmaの選択肢に表示。外部通信・画面例外なし。');
  }finally{await browser?.close();server.kill();}
}
main().catch(e=>{console.error(e);process.exitCode=1;});

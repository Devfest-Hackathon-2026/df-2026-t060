// node tools/final-integration-browser.cjs (Playwright + Chromium)
// ブラウザ・HTTP/SSE・TCP・実験計算は本物。無線機器とGemma APIだけを模擬する。
const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const { createServer } = require('node:http');
const net = require('node:net');
const { spawn } = require('node:child_process');
const { once } = require('node:events');
const { mkdtemp, rm } = require('node:fs/promises');
const { tmpdir } = require('node:os');
const { join, resolve } = require('node:path');
const root = resolve(__dirname, '..');
const wait = (ms) => new Promise(r => setTimeout(r, ms));
const listen = s => new Promise(r => s.listen(0, '127.0.0.1', r));
const close = s => new Promise(r => s.close(r));
const button = (p, name) => p.getByRole('button', { name, exact: true });
const field = (p, name) => p.getByRole('textbox', { name, exact: true });
const flow = (p, name) => p.locator('[data-flow-step="' + name + '"]').click();

async function main() {
  const calls = [], errors = [], outside = [];
  const gemma = createServer(async (req, res) => {
    if (req.url === '/api/tags') return res.end(JSON.stringify({ models: [{ name: 'gemma4:12b' }] }));
    if (req.url !== '/api/chat') return res.writeHead(404).end();
    let input = ''; for await (const part of req) input += part;
    const body = JSON.parse(input); calls.push(body);
    const proposal = body.format?.properties?.preset
      ? { preset: 'escape', edits: [{ key: 'ratio', value: 1.2 }], reason: '同じ高度で、打ち出す速さだけ比べよう' }
      : { answer: '短い時間だけでは、戻ってくるかはまだ分かりません。', question: '速さを少し変えたら、どちらが戻る？',
        rationale: '発射の速さだけを変え、地球へ戻るか比べる', distinguish: '同じ時間と、10日後までの軌道を比べる', values: [1.4, 1.45] };
    res.writeHead(200, { 'Content-Type': 'application/x-ndjson' });
    res.end(JSON.stringify({ done: true, message: { content: JSON.stringify(proposal) }, eval_count: 20 }) + '\n');
  });
  await listen(gemma);
  const probe = net.createServer(); await listen(probe);
  const port = probe.address().port; await close(probe);
  const data = await mkdtemp(join(tmpdir(), 'fushigi-final-test-'));
  const origin = 'http://127.0.0.1:' + port;
  const server = spawn(process.execPath, ['server/index.js'], {
    cwd: root, env: { ...process.env, PORT: String(port), RELAY: '1', RELAY_BLE_PORT: '0', RELAY_DATA_DIR: data,
      LLM_BACKEND: 'ollama', LLM_MODEL: 'gemma4:12b', LLM_BASE_URL: 'http://127.0.0.1:' + gemma.address().port },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let log = '', app, browser;
  server.stdout.on('data', d => { log += d; }); server.stderr.on('data', d => { log += d; });
  try {
    const until = async (fn) => {
      for (let i = 0; i < 240; i++) { const result = fn(); if (result) return result; await wait(25); }
      throw new Error('中継サーバーが起動しません: ' + log);
    };
    const bridgePort = Number((await until(() => /中継アプリとの口:127\.0\.0\.1:(\d+)/.exec(log)))[1]);
    app = net.connect(bridgePort, '127.0.0.1'); app.setEncoding('utf8'); await once(app, 'connect');
    const send = value => app.write(JSON.stringify(value) + '\n');
    send({ t: 'hello', app: 'IntegrationTest', name: 'KyozaiRelay-Test' });
    const sessions = new Map();
    let buf = '';
    app.on('data', chunk => {
      buf += chunk;
      for (let i; (i = buf.indexOf('\n')) >= 0;) {
        const msg = JSON.parse(buf.slice(0, i)); buf = buf.slice(i + 1);
        const session = sessions.get(msg.s);
        if (msg.t !== 'tx' || !session) continue;
        session.pending.push(msg.b);
        if (session.timer) continue;
        session.timer = setTimeout(() => {
          session.timer = null; const packets = session.pending.splice(0);
          session.page.evaluate(p => window.__receiveTestPackets?.(p), packets).catch(() => {});
        }, 0);
      }
    });
    browser = await chromium.launch({ executablePath: process.env.CHROME, headless: true,
      args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
    const { RX_UUID, TX_UUID } = await import('../public/js/relay/protocol.js');
    async function page(session, viewport = { width: 1260, height: 930 }) {
      const ctx = await browser.newContext({ viewport });
      ctx.setDefaultTimeout(16000);
      const p = await ctx.newPage();
      p.on('pageerror', e => errors.push(e.message));
      await ctx.route('**/*', route => {
        const u = route.request().url();
        if (u.startsWith(origin + '/') || u.startsWith('blob:')) return route.continue();
        outside.push(u); return route.abort();
      });
      if (session) {
        sessions.set(session, { page: p, pending: [], timer: null });
        await p.exposeBinding('__testGatt', (_src, op, bytes) => {
          if (op === 'open') send({ t: 'open', s: session, mtu: 185 });
          if (op === 'close') send({ t: 'close', s: session });
          if (op === 'write') send({ t: 'rx', s: session, b: Buffer.from(bytes).toString('base64') });
        });
        await p.addInitScript(({ RX_UUID, TX_UUID }) => {
          const tx = new EventTarget(), device = new EventTarget();
          tx.startNotifications = async () => tx;
          const rx = { writeValueWithResponse: bytes => window.__testGatt('write', [...bytes]) };
          const service = { getCharacteristic: async id => id === RX_UUID ? rx : id === TX_UUID ? tx : null };
          Object.assign(device, { name: 'KyozaiRelay-Test', gatt: {
            connect: async () => { await window.__testGatt('open'); return { getPrimaryService: async () => service }; },
            disconnect: () => window.__testGatt('close'),
          } });
          Object.defineProperty(navigator, 'bluetooth', { value: { requestDevice: async () => device } });
          window.__receiveTestPackets = packets => { for (const p of packets) {
            tx.value = new DataView(Uint8Array.from(atob(p), c => c.charCodeAt(0)).buffer);
            tx.dispatchEvent(new Event('characteristicvaluechanged'));
          } };
        }, { RX_UUID, TX_UUID });
      }
      return [p, ctx];
    }
    const [teacher] = await page(null);
    await teacher.goto(origin + '/teacher.html?relay');
    await teacher.locator('#className').fill('提出版の確認教室');
    await teacher.locator('#grade').selectOption('9');
    await button(teacher, 'つくる').click();
    await teacher.locator('#app:not([hidden])').waitFor();
    const code = await teacher.locator('#code').textContent();
    assert.ok((await teacher.locator('#studentUrl').getAttribute('href')).startsWith(origin + '/student.html?'));

    await button(teacher, '実験工房を開く').click();
    await teacher.locator('#hybridLabDialog[open] .lab-stage canvas.s2-canvas:not([hidden])').waitFor();
    await teacher.locator('[data-family=fluid]').click();
    await teacher.locator('.lab-title').filter({ hasText: '浮く物体' }).waitFor();
    await teacher.locator('.lab-stage [data-param=rhoObject]').fill('820');
    await button(teacher, 'この条件を教材の下書きにする').click();
    await teacher.locator('#draftSaveStatus').filter({ hasText: '保存しました' }).waitFor();
    await teacher.reload();
    await teacher.locator('#draftSaveStatus').filter({ hasText: '復元しました' }).waitFor();
    assert.equal(await teacher.locator('#matForm [name=title]').inputValue(), '浮く物体と沈む物体');
    await button(teacher, '配信する').click();
    await teacher.locator('#matMsg').filter({ hasText: '配信しました' }).waitFor();

    await button(teacher, '実験工房を開く').click();
    await teacher.locator('.lab-ai input').fill('地球から離れる速さを比べたい');
    await button(teacher, 'Gemmaに条件を相談').click();
    await teacher.locator('.lab-message').filter({ hasText: '提案を表示しました' }).waitFor();
    assert.equal(await teacher.locator('.lab-stage [data-param=ratio]').inputValue(), '1.2');
    await button(teacher, 'この条件を教材の下書きにする').click();
    await button(teacher, '配信する').click();
    await teacher.locator('#matMsg').filter({ hasText: '配信しました' }).waitFor();
    console.log('実験工房 → 下書き自動保存と復元 → 実際の教材配信。GemmaのAPIで軌道条件を提案。');

    async function student(session, seat) {
      const [p, ctx] = await page(session, { width: 900, height: 820 });
      await p.goto(origin + '/student.html?ble&code=' + code + '&seat=' + seat);
      await p.locator('#bleConnect').click();
      await button(p, '入る').click();
      await p.locator('#app:not([hidden])').waitFor();
      return [p, ctx];
    }
    const [a] = await student('student-A', 1);
    const [b, bCtx] = await student('student-B', 2);
    await teacher.locator('#bleStatus').filter({ hasText: '2 台' }).waitFor();
    await a.locator('.tile').filter({ hasText: '浮く物体と沈む物体' }).click();
    await flow(a, 'experiment');
    assert.equal(await a.locator('.s2 [data-param=rhoObject]').inputValue(), '820');
    await a.locator('.tile').filter({ hasText: '地球から脱出できる？' }).click();
    await flow(a, 'predict');
    await field(a, '予想').fill('大きい速さの方が遠くまで行く');
    for (const speed of ['0.6', '1.6']) {
      await flow(a, 'experiment');
      await a.locator('.s2 [data-param=ratio]').fill(speed);
      await button(a, '再生').click();
      await field(a, '観察したこと').fill(speed + '倍の高さと動きを観察した');
      await a.locator('[data-action=record-run]').click();
      await a.locator('.s2[data-inquiry-flow=compare]').waitFor();
    }
    await flow(a, 'question');
    const question = '遠ざかったらあとで戻らないの？';
    await field(a, '次の問い').fill(question);
    await button(a, '根拠と問いを先生へ送る').click();
    const evidence = teacher.locator('#questions > li').filter({ hasText: question }).locator('.inq-evidence');
    await evidence.locator(':scope > summary').click();
    assert.equal(await evidence.locator('.inq-run').count(), 2);
    await button(evidence, '先生PCのGemmaに根拠から提案させる').click();
    await evidence.getByText('AIの未承認案です。条件と根拠を確認してください').waitFor();
    const next = '速さを少し変えたら、どちらが戻る？';
    assert.equal(await b.locator('.tile').filter({ hasText: next }).count(), 0, '承認前には児童に届かない');
    await evidence.locator('[data-action=prepare-inquiry-draft]').click();
    await button(teacher, '配信する').click();
    await teacher.locator('#matMsg').filter({ hasText: '配信しました' }).waitFor();
    await b.locator('.tile').filter({ hasText: next }).click();
    await flow(b, 'compare');
    await b.locator('[data-action=approved-comparison]').click();
    await button(b, '発展：10日まで確かめる').click();
    await b.locator('.inq-comparison .inq-message').filter({ hasText: '864,000' }).waitFor();
    await button(b, '軌道を3Dで重ねる').click();
    await b.locator('canvas[aria-label="2つの軌道を同じ空間で比較する3D"]:not([hidden])').waitFor();
    await button(b, '地球の近くに寄る').click();
    await b.locator('.inq-range-note').filter({ hasText: '地球付近' }).waitFor();
    await field(b, '比較して気づいたこと').fill('初めはどちらも離れたけれど、観察時間を延ばすと軌道が分かれた');
    await button(b, '比較した2件を自分の記録に保存').click();
    assert.equal(calls.length, 2);
    const revised = await b.evaluate(code => JSON.parse(localStorage.getItem('kyozai-ble-materials:' + code)).find(m => m.inquiry?.revision === 2), code);
    assert.equal(revised.inquiry.sources.length, 2);
    assert.equal(revised.inquiry.comparison.configs[1].params.ratio, 1.45);
    assert.ok(revised.inquiry.sources.every(r => calls[1].messages[1].content.includes(r.id)));
    console.log('児童A → 模擬GATT → 実サーバー → 模擬Gemma → 先生の承認 → 児童Bで同時計算と軌道3D。');

    await b.waitForFunction(() => !!navigator.serviceWorker.controller);
    await bCtx.setOffline(true);
    send({ t: 'close', s: 'student-B' });
    await b.reload();
    await b.locator('#bleCardState').filter({ hasText: '保存した教材を閲覧中' }).waitFor();
    await b.locator('.tile').filter({ hasText: next }).waitFor();
    await b.locator('.tile').filter({ hasText: next }).click();
    await flow(b, 'question');
    const offlineQuestion = '1.41倍と1.42倍にすると境目をもっと絞れる？';
    await field(b, '次の問い').fill(offlineQuestion);
    await button(b, '根拠と問いを先生へ送る').click();
    await b.getByText('根拠つきの問いを送信待ちに入れました。', { exact: false }).waitFor();
    assert.equal(await teacher.locator('#questions > li').filter({ hasText: offlineQuestion }).count(), 0);
    await b.locator('#bleCardBtn').click();
    await teacher.locator('#questions > li').filter({ hasText: offlineQuestion }).waitFor();
    await b.waitForFunction(() => JSON.parse(localStorage.getItem('kyozai-ble-outbox') || '[]').length === 0);
    await b.setViewportSize({ width: 390, height: 844 });
    assert.ok(await b.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
    await b.goto(origin + '/hybrid-lab.html');
    await b.locator('[data-family=wave]').click();
    await b.locator('[data-preset=doppler]').click();
    await b.locator('.lab-stage canvas.s2-canvas:not([hidden])').waitFor();
    assert.ok(await b.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
    assert.deepEqual(errors, []);
    assert.deepEqual(outside, []);
    console.log('回線とBluetoothなしで再読込 → 保存教材 → 次の問いを保留し、再接続で送信。390px幅、外部通信と画面例外なし。');
  } finally {
    app?.destroy();
    await browser?.close();
    server.kill();
    if (server.exitCode === null) await once(server, 'exit');
    await close(gemma);
    await rm(data, { recursive: true, force: true });
  }
}

main().catch(error => { console.error(error); process.exitCode = 1; });

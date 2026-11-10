// node tools/inquiry-flow-browser.cjs (Playwright と Chrome が必要)
const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const { once } = require('node:events');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const button = (page, name) => page.getByRole('button', { name, exact: true });
const field = (page, name) => page.getByRole('textbox', { name, exact: true });
const step = (page, name) => page.locator(`[data-flow-step="${name}"]`).click();
const stored = (page, code) => page.evaluate(code => JSON.parse(localStorage.getItem('kyozai-demo:' + code)), code);

async function join(page, url) {
  await page.goto(url);
  await button(page, '入る').click();
  await page.locator('#app:not([hidden])').waitFor();
}

async function publishPlan(teacher, question, revisedQuestion) {
  const card = teacher.locator('#questions > li').filter({ hasText: question }).locator('.inq-evidence');
  if (await card.getAttribute('open') === null) await card.locator(':scope > summary').click();
  await card.locator('[data-action=manual-plan]').click();
  if (revisedQuestion) await field(card, 'クラスで確かめる問い').fill(revisedQuestion);
  await card.locator('[data-action=prepare-inquiry-draft]').click();
  await button(teacher.locator('#matForm'), '配信する').click();
  await teacher.locator('#matMsg').filter({ hasText: '配信しました' }).waitFor();
}

async function run() {
  const python = process.env.PYTHON ?? (process.platform === 'win32' ? 'python' : 'python3');
  const server = spawn(python, ['start_local.py', '--port', '0'], { cwd: root, stdio: ['ignore', 'pipe', 'inherit'] });
  let browser;
  try {
    const [out] = await once(server.stdout, 'data');
    const origin = String(out).match(/http:\/\/127\.0\.0\.1:\d+/)?.[0];
    assert.ok(origin, String(out));
    browser = await chromium.launch({
      executablePath: process.env.CHROME,
      headless: true,
      args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
    });
    const context = await browser.newContext({ viewport: { width: 1280, height: 1000 } });
    context.setDefaultTimeout(15000);
    const errors = [];
    const external = [];
    const addPage = async () => {
      const page = await context.newPage();
      page.on('pageerror', error => errors.push(error.message));
      return page;
    };
    await context.route('**/*', route => {
      const url = route.request().url();
      if (url.startsWith(origin + '/') || url.startsWith('blob:')) return route.continue();
      external.push(url);
      return route.abort();
    });

    const home = await addPage();
    await home.goto(origin);
    await home.getByRole('link', { name: 'デモを開く' }).click();
    await home.locator('#create').click();
    await home.locator('#links a').nth(2).waitFor();
    const [teacherUrl, aUrl, bUrl] = await home.locator('#links a').evaluateAll(links => links.map(a => a.href));
    const code = new URL(aUrl).searchParams.get('code');
    const teacher = await addPage();
    await teacher.goto(teacherUrl);
    await teacher.locator('#app:not([hidden])').waitFor();
    const a = await addPage();
    const b = await addPage();
    await join(a, aUrl);
    await join(b, bUrl);
    const orbit = /地球のまわり/;
    await a.locator('.tile').filter({ hasText: orbit }).click();

    // 記録がなければ、比較から実験の入力に案内される。
    await step(a, 'compare');
    await a.locator('[data-action=compare-runs]').click();
    await a.locator('.s2[data-inquiry-flow=experiment] .if-field-error').waitFor();
    await step(a, 'predict');
    await field(a, '予想').fill('速さが小さいとぶつかり、大きいと離れそう');
    for (const [speed, note] of [[0.6, '地表へ近づいた'], [1.6, '観察した時間内では遠ざかった']]) {
      await step(a, 'experiment');
      await a.getByRole('slider', { name: /打ち出す速さ/ }).fill(String(speed));
      await button(a, '再生').click();
      await field(a, '観察したこと').fill(note);
      await a.locator('[data-action=record-run]').click();
      await a.locator('.s2[data-inquiry-flow=compare]').waitFor();
    }
    assert.equal(await a.locator('.inq-run').count(), 2);

    // 送信内容にひもづく自己評価を保存し、先生へ渡す。
    const firstQuestion = '遠ざかっても、あとで戻ることはある？';
    await step(a, 'question');
    await field(a, '次の問い').fill(firstQuestion);
    await step(a, 'explain');
    await field(a, '説明の結果').fill('速さによって動きが変わる');
    await field(a, '説明の根拠').fill('高さと方向をそろえて0.60倍と1.60倍を比べた');
    await button(a, 'この説明を保存').click();
    await a.locator('[data-understanding-panel=student] > summary').click();
    await a.getByLabel('自己評価：根拠').selectOption('2');
    await button(a, 'この説明の自己評価を保存').click();
    await step(a, 'question');
    await button(a, '根拠と問いを先生へ送る').click();
    await a.getByText('根拠つきの問いを送りました。', { exact: false }).waitFor();
    const first = (await stored(a, code)).questions[0];
    assert.equal(JSON.parse(first.inquiryContext).understanding.levels.evidence, 2);

    const evidence = teacher.locator('#questions > li').filter({ hasText: firstQuestion }).locator('.inq-evidence');
    await evidence.locator(':scope > summary').click();
    const review = evidence.locator('[data-understanding-panel=teacher]');
    await review.locator(':scope > summary').click();
    await review.getByLabel('先生の確認：根拠').selectOption('2');
    const comment = '同じ高さで比べた記録を確認しました。';
    await field(review, '理解の確認コメント').fill(comment);
    await button(review, '確認した段階とコメントを本人へ返す').click();
    await review.getByText('本人へ確認結果を返しました。', { exact: false }).waitFor();
    await a.locator('#replies .replya').filter({ hasText: comment }).waitFor();
    await a.locator('[data-understanding-panel=reply] > summary').click();
    await a.locator('[data-understanding-panel=reply] canvas').waitFor();
    assert.equal(await b.locator('#replies .reply').count(), 0);
    console.log('児童の記録・自己評価 → 先生 → 宛先の児童への確認');

    await publishPlan(teacher, firstQuestion);
    const revision = (await stored(a, code)).materials.find(m => m.inquiry?.revision === 2);
    assert.equal(revision.inquiry.sources.length, 2);
    assert.equal(revision.inquiry.sourceQuestionIds[0], first.id);
    await b.locator('.tile').filter({ hasText: revision.title }).click();
    await step(b, 'compare');
    await b.locator('[data-action=approved-comparison]').click();
    await button(b, '6時間まで進める').click();
    await b.locator('.inq-comparison .inq-message').filter({ hasText: '21,600' }).waitFor();
    await button(b, '発展：10日まで確かめる').click();
    await b.locator('.inq-comparison .inq-message').filter({ hasText: '864,000' }).waitFor();
    await button(b, '軌道を3Dで重ねる').click();
    await b.locator('.inq-compare-view > canvas:not([hidden])').waitFor();
    await field(b, '比較して気づいたこと').fill('はじめはどちらも遠ざかったが、長く見ると違いが出た');
    await button(b, '比較した2件を自分の記録に保存').click();
    assert.equal(await b.locator('.inq-run').count(), 4);
    await step(b, 'explain');
    await field(b, '説明の結果').fill('観察する時間によって見えるものが変わる');
    await step(b, 'question');
    const secondQuestion = '観察を10日まで延ばせば見分けられる？';
    await field(b, '次の問い').fill(secondQuestion);
    await button(b, '根拠と問いを先生へ送る').click();
    await b.getByText('根拠つきの問いを送りました。', { exact: false }).waitFor();
    const inherited = JSON.parse((await stored(b, code)).questions.at(-1).inquiryContext);
    assert.equal(inherited.rootId, revision.inquiry.rootId);
    assert.equal(inherited.runs.length, 4);
    assert.ok(inherited.runs.slice(-2).every(r => r.seat === 2 && r.sourceIds.length === 2));
    await publishPlan(teacher, secondQuestion, '10日間で軌道がどう違う？');
    assert.ok((await stored(b, code)).materials.some(m => m.inquiry?.revision === 3 && m.inquiry.sources.length === 4));
    console.log('承認・再配信 → 別の児童の比較・3D → 次の改訂');

    // 端末に保存した記録・手順と、音教材のオフライン起動を確認する。
    await b.waitForFunction(() => !!navigator.serviceWorker.controller);
    await b.setViewportSize({ width: 390, height: 844 });
    await context.setOffline(true);
    await b.reload();
    await b.locator('#app:not([hidden])').waitFor();
    await b.getByRole('button', { name: '改訂2：' + revision.title, exact: true }).click();
    await b.locator('.s2[data-inquiry-flow=question]').waitFor();
    assert.equal(await field(b, '次の問い').inputValue(), secondQuestion);
    await step(b, 'compare');
    assert.equal(await b.locator('.inq-run').count(), 4);
    await b.locator('.tile').filter({ hasText: '音と空気' }).click();
    await step(b, 'experiment');
    await button(b, '再生').click();
    await button(b, '今の音を0.8秒聞く').click();
    await field(b, '観察したこと').fill('同じ点が左右に動いた');
    await b.locator('[data-action=record-run]').click();
    await b.locator('.s2[data-inquiry-flow=compare]').waitFor();
    assert.equal(await b.locator('.inq-run').count(), 1);
    assert.ok(await b.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
    await home.goto(origin);
    await home.getByRole('heading', { name: /ひとりの問いが/ }).waitFor();
    assert.deepEqual(errors, []);
    assert.deepEqual(external, []);
    console.log('オフライン再読込・学習の再開・音の記録・スマホ幅');
  } finally {
    await browser?.close();
    server.kill();
  }
}

run().catch(error => { console.error(error); process.exitCode = 1; });

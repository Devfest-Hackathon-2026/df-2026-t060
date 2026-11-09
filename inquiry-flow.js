// 共通の学習手順。入力不足の場所を開き、その場で案内する。
import { el } from './common.js';

const controllers = new WeakMap();
const steps = ['予想', '実験', '比較', '説明', '次の問い'];
const keys = ['predict', 'experiment', 'compare', 'explain', 'question'];

const hints = [
  '教材を読んで、どうなるか考えよう。予想は後から書き直せます。',
  '条件を変えて再生し、見えたことを記録しよう。',
  '記録を選んで比べよう。1件からでも説明へ進めます。',
  '記録を根拠に、自分の言葉で説明しよう。理解の3Dは任意です。',
  'まだ分からないことを問いにして、先生へ送ろう。研究計画も作れます。'
];

let serial = 0;

// この学習画面だけに適用する装飾。
const CSS = `
.s2[data-inquiry-flow]{display:block!important}
.s2[data-inquiry-flow]>.s2-simpart,
.s2[data-inquiry-flow]>.inq-results,
.s2[data-inquiry-flow]>.inq-predict{
  position:static!important;
  max-height:none!important;
  overflow:visible!important;
  width:100%;
  box-sizing:border-box;
  margin:12px 0!important
}
.s2[data-inquiry-flow]>.s2-tabs{
  display:grid;
  grid-template-columns:repeat(5,minmax(0,1fr));
  grid-column:1/-1;
  gap:6px;
  top:var(--if-top,0px)
}
.s2[data-inquiry-flow] .s2-tabs button{
  min-width:0;
  padding:10px 5px;
  overflow-wrap:anywhere
}
.s2[data-inquiry-flow] .if-heading{
  padding:12px 16px;
  background:#eaf3ff;
  border-radius:12px;
  margin:10px 0;
  scroll-margin-top:calc(var(--if-top,0px) + 120px)
}
.s2[data-inquiry-flow] .if-heading h3{
  margin:0 0 5px;
  font-size:18px
}
.s2[data-inquiry-flow] .if-heading p{
  margin:0;
  line-height:1.6
}
.s2[data-inquiry-flow] .if-footer{
  display:flex;
  gap:12px;
  align-items:center;
  justify-content:space-between;
  flex-wrap:wrap;
  padding:16px 0;
  grid-column:1/-1
}
.s2[data-inquiry-flow] .if-footer span{
  color:#536a83;
  font-size:13px
}
.s2[data-inquiry-flow] [hidden]{
  display:none!important
}
.if-field-error{
  display:block;
  flex-basis:100%;
  padding:8px 10px;
  border-left:4px solid #af3d20;
  background:#fff2eb;
  color:#8b301c;
  font-size:14px;
  font-weight:600;
  line-height:1.6;
  white-space:pre-wrap;
  scroll-margin:180px 0 60px
}
.if-needs-input{
  outline:3px solid #c34e2d!important;
  outline-offset:3px;
  scroll-margin:180px 0 60px
}
@media(min-width:1100px){
  body.student .s2[data-inquiry-flow=explain]{
    display:grid!important;
    grid-template-columns:minmax(0,1fr) minmax(350px,1fr);
    gap:16px;
    align-items:start
  }
  body.student .s2[data-inquiry-flow=explain]>.if-heading{
    grid-column:1/-1
  }
  body.student .s2[data-inquiry-flow=explain]>.s2-simpart{
    grid-column:1;
    grid-row:3;
    position:sticky!important;
    top:calc(var(--if-top,0px) + 75px);
    max-height:calc(100vh - var(--if-top,0px) - 100px)!important;
    overflow:auto!important
  }
  body.student .s2[data-inquiry-flow=explain]>.inq-results{
    grid-column:2;
    grid-row:3
  }
}
@media(max-width:650px){
  .s2[data-inquiry-flow]>.s2-tabs{
    grid-template-columns:repeat(3,minmax(0,1fr))
  }
  .s2[data-inquiry-flow] .if-heading{
    padding:10px
  }
  .s2[data-inquiry-flow] .if-footer button{
    flex:1
  }
}
`;

function style() {
  if (!document.getElementById('inquiryFlowStyle')) {
    document.head.append(
      el('style', { id: 'inquiryFlowStyle' }, CSS)
    );
  }
}

// 必要な画面・折りたたみを開き、入力欄へ移動する。
// 勝手に値を入れたり、送信したりはしない。
export function guideTo(target, message) {
  if (!target) return false;

  style();

  const root = target.closest('.s2');

  controllers.get(root)?.reveal(target);

  for (let n = target; n; n = n.parentElement) {
    if (n.tagName === 'DETAILS') n.open = true;
  }

  const field = target.matches(
    'input,textarea,select,button,summary'
  )
    ? target
    : target.querySelector('input,textarea,select,button')
      ?? target.querySelector('summary')
      ?? target;

  for (
    const note of
    (root ?? target.parentElement)?.querySelectorAll(
      '.if-field-error'
    ) ?? []
  ) {
    note._clear?.();
  }

  const id = 'inquiry-field-error-' + (++serial);
  const oldInvalid = field.getAttribute('aria-invalid');
  const oldDescription = field.getAttribute('aria-describedby');

  const note = el(
    'span',
    {
      id,
      class: 'if-field-error',
      role: 'alert'
    },
    message
  );

  if (target.tagName === 'DETAILS') {
    target.querySelector(':scope>summary')?.after(note);
  } else {
    target.after(note);
  }

  field.classList.add('if-needs-input');

  if (field.matches('input,textarea,select')) {
    field.setAttribute('aria-invalid', 'true');
  }

  field.setAttribute(
    'aria-describedby',
    [oldDescription, id].filter(Boolean).join(' ')
  );

  // 入力が修正されたら、その場の案内を消す。
  const clear = () => {
    note.remove();
    field.classList.remove('if-needs-input');

    if (oldInvalid === null) {
      field.removeAttribute('aria-invalid');
    } else {
      field.setAttribute('aria-invalid', oldInvalid);
    }

    if (oldDescription === null) {
      field.removeAttribute('aria-describedby');
    } else {
      field.setAttribute('aria-describedby', oldDescription);
    }

    field.removeEventListener('input', changed);
    field.removeEventListener('click', clicked);
    target.removeEventListener('change', clear);
  };

  const changed = () => {
    if (String(field.value ?? '').trim()) clear();
  };

  const clicked = () => {
    if (field.matches('button')) clear();
  };

  note._clear = clear;

  field.addEventListener('input', changed);
  field.addEventListener('click', clicked);
  target.addEventListener('change', clear);

  if (
    !field.matches(
      'input,textarea,select,button,summary,[tabindex]'
    )
  ) {
    field.tabIndex = -1;
  }

  requestAnimationFrame(() => {
    if (
      note.isConnected &&
      field.isConnected &&
      field.getClientRects().length
    ) {
      field.focus({ preventScroll: true });

      field.scrollIntoView({
        block: 'center',
        behavior: 'auto'
      });
    }
  });

  return false;
}

// 記録がなければ実験へ。
// 選択不足なら履歴を開き、選択欄へ移る。
export function guideRecords(anchor, message) {
  const c = controllers.get(anchor?.closest('.s2'));

  return guideTo(
    c?.recordTarget() ?? anchor,
    message
  );
}

// 5段階の学習画面を作る。
export function createInquiryFlow(o) {
  style();

  let current = 0;
  let first = true;
  let dead = false;

  const buttons = steps.map((name, i) =>
    el(
      'button',
      {
        type: 'button',
        class: 's2-tab',
        'data-flow-step': keys[i],
        onclick: () => go(i)
      },
      `${i + 1} ${name}`
    )
  );

  o.api.tabs.replaceChildren(...buttons);
  o.api.tabs.setAttribute('aria-label', '学習の手順');

  const title = el('h3', { tabindex: -1 });
  const hint = el('p', {});

  const heading = el(
    'div',
    { class: 'if-heading' },
    title,
    hint
  );

  const back = el(
    'button',
    {
      type: 'button',
      class: 's2-btn',
      onclick: () => go(Math.max(0, current - 1))
    },
    '前へ'
  );

  const next = el(
    'button',
    {
      type: 'button',
      class: 's2-btn primary',

      onclick: () => {
        if (current === 1 && !o.rows.length) {
          if (!(o.engine().t > 0)) {
            return guideTo(
              o.playButton,
              'まず「再生」で実験を動かそう。'
            );
          }

          if (!o.observation.value.trim()) {
            return guideTo(
              o.observation,
              '見えたことを書いて「この実験を記録」を押そう。'
            );
          }

          return guideTo(
            o.recordBox.querySelector(
              '[data-action=record-run]'
            ),
            'この実験を記録してから次へ進もう。'
          );
        }

        if (
          current === 3 &&
          ![
            ...o.reflection.querySelectorAll(
              'textarea[aria-label^="説明の"]'
            )
          ].some(f => f.value.trim())
        ) {
          return guideTo(
            o.reflection.querySelector('textarea'),
            '結果・根拠・理由のうち、説明を1つ以上書こう。'
          );
        }

        go(current === 4 ? 1 : current + 1);
      }
    },
    '次へ'
  );

  const position = el('span', {});

  const footer = el(
    'div',
    { class: 'if-footer' },
    back,
    position,
    next
  );

  function root() {
    return o.api.tabs.closest('.s2');
  }

  function go(i) {
    if (dead) return;

    o.api.show(steps[i]);

    title.focus({ preventScroll: true });

    heading.scrollIntoView({
      block: 'start',
      behavior: 'auto'
    });
  }

  function refresh() {
    if (dead) return;

    // 比較欄を1つの段階にまとめる。
    // 既存の入力要素とイベントは保持する。
    let compare = o.api.resultPanel.querySelector(
      ':scope>[data-flow-panel=compare]'
    );

    if (!compare) {
      compare = el(
        'section',
        { 'data-flow-panel': 'compare' }
      );

      for (const child of [...o.api.resultPanel.children]) {
        if (
          [
            o.reflection,
            o.understanding,
            o.advance,
            o.questionPanel
          ].includes(child)
        ) {
          break;
        }

        compare.append(child);
      }

      o.api.resultPanel.prepend(compare);
    }

    compare.hidden = current !== 2;

    o.reflection.hidden =
      o.understanding.hidden =
        current !== 3;

    o.advance.hidden =
      o.questionPanel.hidden =
        current !== 4;

    const r = root();
    const sim = o.recordBox.closest('.s2-simpart');

    if (!r) return;

    controllers.set(r, controller);
    r.dataset.inquiryFlow = keys[current];

    r.style.setProperty(
      '--if-top',
      (document.querySelector('.appbar')?.offsetHeight ?? 0)
        + 'px'
    );

    if (heading.previousElementSibling !== o.api.tabs) {
      o.api.tabs.after(heading);
    }

    if (r.lastElementChild !== footer) {
      r.append(footer);
    }

    o.api.predictPanel.hidden = current !== 0;
    o.api.resultPanel.hidden = current < 2;

    if (sim) {
      sim.hidden = current !== 1 && current !== 3;
    }

    o.recordBox.hidden = current !== 1;

    r.classList.toggle(
      'inq-is-comparing',
      current === 2 &&
        !!compare.querySelector('.inq-comparison')
    );

    buttons.forEach((b, i) => {
      b.setAttribute(
        'aria-pressed',
        String(i === current)
      );

      if (i === current) {
        b.setAttribute('aria-current', 'step');
      } else {
        b.removeAttribute('aria-current');
      }
    });

    title.textContent =
      `${current + 1}．${steps[current]}`;

    hint.textContent = hints[current];

    position.textContent =
      `手順 ${current + 1} / 5`;

    back.disabled = current === 0;

    next.textContent =
      current === 4
        ? '実験に戻って確かめる'
        : '次へ：' + steps[current + 1];
  }

  const controller = {
    show(name) {
      let i = steps.indexOf(
        name === '結果' ? '比較' : name
      );

      if (i < 0) i = current;

      // 開き直したときは、前の段階から再開する。
      if (first && root()) {
        first = false;

        if (
          name === '予想' &&
          keys.includes(o.data.flowStep)
        ) {
          i = keys.indexOf(o.data.flowStep);
        }
      }

      current = i;

      if (i !== 1) o.pause();

      refresh();

      if (o.data.flowStep !== keys[i]) {
        o.data.flowStep = keys[i];
        o.save();
      }
    },

    refresh,

    // 入力欄が属する段階へ切り替える。
    reveal(target) {
      const i =
        o.api.predictPanel.contains(target)
          ? 0
          : o.recordBox.contains(target) ||
              target === o.playButton
            ? 1
            : o.reflection.contains(target) ||
                o.understanding.contains(target)
              ? 3
              : o.advance.contains(target) ||
                  o.questionPanel.contains(target)
                ? 4
                : 2;

      o.api.show(steps[i]);
    },

    recordTarget() {
      if (!o.rows.length) {
        return o.api.recordBox.querySelector(
          '[data-action=record-run]'
        );
      }

      return o.api.resultPanel.querySelector(
        '[data-flow-panel=compare] .inq-history'
      ) ?? o.api.recordBox;
    },

    destroy() {
      dead = true;

      window.removeEventListener('resize', refresh);

      const r = root();

      if (r) {
        controllers.delete(r);

        for (
          const n of r.querySelectorAll('.if-field-error')
        ) {
          n._clear?.();
        }
      }

      heading.remove();
      footer.remove();
    }
  };

  window.addEventListener('resize', refresh);

  return controller;
}

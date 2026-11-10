// 保存するのは先生が編集中の下書きだけ。クラスをまたいで読み込まない。
const FIELDS = ['title', 'explanation', 'lQuestion', 'lPredict', 'lCheck', 'lResult', 'lSummary', 'q', 'c1', 'c2', 'c3', 'answer'];

export function createDraftAutosave({ form, code, owner, sampleTopic, sampleSim, status, readState, restoreState }) {
  const key = 'kyozai-material-draft:v1:' + JSON.stringify([owner, code]);
  let timer, dirty = false, restored = false;
  try {
    const saved = JSON.parse(localStorage.getItem(key) ?? 'null');
    if (saved?.version === 1 && saved.fields) {
      restoreState(saved.state);
      for (const name of FIELDS) {
        const value = saved.fields[name];
        if (typeof value === 'string') form.elements.namedItem(name).value = value;
      }
      if (typeof saved.topic === 'string') sampleTopic.value = saved.topic;
      if ([...sampleSim.options].some(opt => opt.value === saved.choice)) sampleSim.value = saved.choice;
      restored = Boolean(saved.fields.title || saved.fields.explanation || saved.state?.sim ||
        FIELDS.some(name => name !== 'answer' && saved.fields[name]));
      if (restored) status.textContent = 'このブラウザに残っていた下書きを復元しました。';
    }
  } catch {
    status.textContent = '前回の下書きを読み込めませんでした。このまま編集できます。';
  }
  function flush(force = false) {
    if (!dirty && !force) return;
    clearTimeout(timer); dirty = false;
    try {
      const fields = Object.fromEntries(FIELDS.map(name => [name, form.elements.namedItem(name).value]));
      const state = readState();
      localStorage.setItem(key, JSON.stringify({ version: 1, fields, state, topic: sampleTopic.value, choice: sampleSim.value }));
      status.textContent = '下書きをこのブラウザに保存しました。';
    } catch {
      status.textContent = 'このブラウザに保存できません。閉じる前に必要な内容を控えてください。';
    }
  }
  function schedule() {
    clearTimeout(timer); dirty = true;
    status.textContent = '下書きを保存中…';
    timer = setTimeout(flush, 350);
  }
  const hide = () => { if (document.hidden) flush(); };
  const leave = () => flush();
  form.addEventListener('input', schedule);
  form.addEventListener('change', schedule);
  sampleTopic.addEventListener('input', schedule);
  sampleSim.addEventListener('change', schedule);
  window.addEventListener('pagehide', leave);
  document.addEventListener('visibilitychange', hide);
  return { schedule, flush, restored };
}

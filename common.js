// DOM を安全に組み立てる（innerHTML を使わないので、入力文字がそのまま表示されるだけ）
export function el(tag, props = {}, ...children) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (k === 'class') e.className = v;
    else if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
    else if (v !== undefined && v !== null && v !== false) e.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children.flat()) if (c !== null && c !== undefined && c !== false) e.append(c);
  return e;
}

export function showMode(transport) {
  const m = document.getElementById('mode');
  if (!m) return;
  m.textContent = { demo: 'デモモード（同じブラウザ内のみ）', relay: 'Bluetooth教室（先生PCの中）', ble: 'Bluetooth（先生のパソコン）' }[transport.mode] ?? 'オンライン（Firebase）';
  m.className = 'badge ' + transport.mode;
}

export function watchOnline(target) {
  const update = () => {
    target.textContent = navigator.onLine ? '● つながっています' : '● オフライン（届いた教材は見られます）';
    target.className = 'net ' + (navigator.onLine ? 'on' : 'off');
  };
  addEventListener('online', update);
  addEventListener('offline', update);
  update();
}

export function timeText(ms) {
  return new Date(ms).toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' });
}

// シミュレーションは sims.js(画面)・sim-physics.js(物理)・sim-catalog.js(条件の一覧)にある

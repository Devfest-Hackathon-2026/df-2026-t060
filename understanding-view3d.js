// 3D座標を透視投影して描く軽量ビュー。
// WebGLや追加のモデル取得は不要。
// 物理シミュレーションと同じカメラ操作を使う。

import {
  projectPoint
} from './sim2/render/view3d.js';

import {
  attachOrbitControls
} from './sim2/render/orbit-controls.js';

import {
  ASPECTS,
  emptyLevels,
  shapeVertices
} from './understanding-core.js';

// 上下の頂点と、4方向の頂点を結んで立体を作る。
const FACES = Array.from(
  { length: 4 },
  (_, i) => [
    [4, i, (i + 1) % 4],
    [5, (i + 1) % 4, i]
  ]
).flat();

const EDGES = Array.from(
  { length: 4 },
  (_, i) => [
    [i, (i + 1) % 4],
    [4, i],
    [5, i]
  ]
).flat();

// 面の色に明暗を付ける。
const shade = (hex, factor) => {
  const n = parseInt(hex.slice(1), 16);

  return `rgb(${
    [16, 8, 0].map(s =>
      Math.round(
        Math.min(
          255,
          ((n >> s) & 255) * factor
        )
      )
    ).join(',')
  })`;
};

const views = new WeakMap();

// 返信一覧を作り直す前に、古い図のイベントを解除する。
export function disposeUnderstandingViews(host) {
  for (
    const canvas of host.querySelectorAll(
      'canvas[data-understanding3d]'
    )
  ) {
    views.get(canvas)?.destroy();
  }
}

export function createUnderstandingView(canvas) {
  const ctx = canvas.getContext('2d');

  if (!ctx) {
    throw new Error(
      'この端末で3D図を描けません。下の表で確認してください。'
    );
  }

  canvas.dataset.understanding3d = 'true';
  canvas.tabIndex = 0;

  canvas.setAttribute(
    'aria-label',
    '理解の振り返りの3D図。ドラッグまたは矢印キーで回転。数値は下の表にも表示します。'
  );

  const cam = {
    theta: .65,
    phi: 1.04,
    dist: 18
  };

  let levels = emptyLevels();
  let comparison = null;
  let destroyed = false;

  const detach = attachOrbitControls(
    canvas,
    cam
  );

  function line(
    a,
    b,
    color,
    width = 1,
    dash = []
  ) {
    if (!a || !b) return;

    ctx.strokeStyle = color;
    ctx.lineWidth = width;
    ctx.setLineDash(dash);

    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.stroke();

    ctx.setLineDash([]);
  }

  function draw() {
    if (destroyed || !canvas.isConnected) {
      return;
    }

    const w = canvas.clientWidth;
    const h = canvas.clientHeight;

    if (!w || !h) return;

    const dpr = Math.min(
      devicePixelRatio || 1,
      2
    );

    if (
      canvas.width !== Math.round(w * dpr) ||
      canvas.height !== Math.round(h * dpr)
    ) {
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
    }

    ctx.setTransform(
      dpr, 0, 0, dpr, 0, 0
    );

    // 背景を描く。
    const bg = ctx.createRadialGradient(
      w * .5,
      h * .45,
      5,
      w * .5,
      h * .5,
      Math.max(w, h)
    );

    bg.addColorStop(0, '#203850');
    bg.addColorStop(1, '#071321');

    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, w, h);

    const project = p => projectPoint(
      p,
      cam,
      { extent: 3.4, w, h }
    );

    // 最大段階の外枠を薄く表示する。
    const reference = shapeVertices(
      Object.fromEntries(
        ASPECTS.map(a => [a.key, 3])
      )
    ).map(project);

    for (const [a, b] of EDGES) {
      line(
        reference[a],
        reference[b],
        '#75899a50',
        1
      );
    }

    const vertices = shapeVertices(levels);
    const points = vertices.map(project);

    // 奥の面から順番に描く。
    const faces = FACES.filter(f =>
      f.slice(1).every(i =>
        i > 3 ||
        levels[ASPECTS[i].key] !== null
      )
    ).map(f => ({
      f,
      depth: f.reduce(
        (sum, i) =>
          sum + (points[i]?.depth ?? 0),
        0
      ) / 3
    })).sort(
      (a, b) => b.depth - a.depth
    );

    for (const { f } of faces) {
      if (f.some(i => !points[i])) {
        continue;
      }

      const [a, b, c] = f.map(
        i => points[i]
      );

      const factor = .64 + Math.max(
        0,
        Math.min(
          1,
          (
            b.x - a.x +
            c.y - a.y
          ) / Math.max(w, h) + .4
        )
      ) * .65;

      ctx.globalAlpha = .8;

      ctx.fillStyle = shade(
        ASPECTS[f[1] % 4].color,
        factor
      );

      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.lineTo(c.x, c.y);
      ctx.closePath();
      ctx.fill();

      ctx.globalAlpha = 1;
    }

    // 現在の評価の輪郭を描く。
    for (const [a, b] of EDGES) {
      const unknown = [a, b].some(i =>
        i < 4 &&
        levels[ASPECTS[i].key] === null
      );

      line(
        points[a],
        points[b],
        unknown
          ? '#a4b1be70'
          : '#cfe9ffb0',
        1.25,
        unknown ? [3, 4] : []
      );
    }

    // 前回の評価や先生の確認を、白い破線で重ねる。
    if (comparison) {
      const previous =
        shapeVertices(comparison).map(project);

      for (const [a, b] of EDGES) {
        line(
          previous[a],
          previous[b],
          '#ffffffc0',
          2,
          [6, 5]
        );
      }
    }

    // 各方向の名前と段階を表示する。
    for (let i = 0; i < 4; i++) {
      const aspect = ASPECTS[i];
      const angle = i * Math.PI / 2;

      const p = project([
        2.6 * Math.cos(angle),
        2.6 * Math.sin(angle),
        .05
      ]);

      if (!p) continue;

      const caption =
        `${aspect.label} ${
          levels[aspect.key] ?? '未評価'
        }`;

      ctx.font =
        'bold 13px system-ui,sans-serif';

      const width =
        ctx.measureText(caption).width + 18;

      const x = Math.max(
        width / 2 + 5,
        Math.min(
          w - width / 2 - 5,
          p.x
        )
      );

      const y = Math.max(
        20,
        Math.min(h - 22, p.y)
      );

      ctx.fillStyle = '#112334';

      ctx.fillRect(
        x - width / 2,
        y - 14,
        width,
        27
      );

      ctx.strokeStyle = aspect.color;
      ctx.lineWidth = 1;

      ctx.strokeRect(
        x - width / 2,
        y - 14,
        width,
        27
      );

      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = aspect.color;

      ctx.fillText(caption, x, y);

      const point = points[i];

      if (point) {
        ctx.fillStyle =
          levels[aspect.key] === null
            ? '#8b9aa7'
            : aspect.color;

        ctx.beginPath();

        ctx.arc(
          point.x,
          point.y,
          3.5,
          0,
          Math.PI * 2
        );

        ctx.fill();
      }
    }

    ctx.textAlign = 'left';
    ctx.fillStyle = '#b3c4d3';
    ctx.font = '12px system-ui,sans-serif';

    ctx.fillText(
      '塗り：表示中の評価　破線：比較対象',
      12,
      h - 13
    );
  }

  const redraw = () => draw();

  canvas.addEventListener(
    'pointermove',
    redraw
  );

  canvas.addEventListener(
    'wheel',
    redraw
  );

  // キーボードでも回転・拡大できるようにする。
  const key = event => {
    if (
      ![
        'ArrowLeft',
        'ArrowRight',
        'ArrowUp',
        'ArrowDown',
        '+',
        '-',
        '='
      ].includes(event.key)
    ) {
      return;
    }

    event.preventDefault();

    if (event.key === 'ArrowLeft') {
      cam.theta -= .12;
    }

    if (event.key === 'ArrowRight') {
      cam.theta += .12;
    }

    if (event.key === 'ArrowUp') {
      cam.phi = Math.max(
        .1,
        cam.phi - .1
      );
    }

    if (event.key === 'ArrowDown') {
      cam.phi = Math.min(
        Math.PI - .1,
        cam.phi + .1
      );
    }

    if (
      event.key === '+' ||
      event.key === '='
    ) {
      cam.dist = Math.max(
        8,
        cam.dist * .9
      );
    }

    if (event.key === '-') {
      cam.dist = Math.min(
        80,
        cam.dist * 1.1
      );
    }

    draw();
  };

  canvas.addEventListener('keydown', key);

  // 表示サイズが変わったときに描き直す。
  const observer = globalThis.ResizeObserver
    ? new ResizeObserver(redraw)
    : null;

  if (observer) {
    observer.observe(canvas);
  } else {
    window.addEventListener(
      'resize',
      redraw
    );
  }

  const api = {
    set(next, previous = null) {
      levels = next;
      comparison = previous;
      draw();
    },

    draw,

    camera: () => ({ ...cam }),

    reset() {
      Object.assign(cam, {
        theta: .65,
        phi: 1.04,
        dist: 18
      });

      draw();
    },

    destroy() {
      if (destroyed) return;

      destroyed = true;

      detach();
      observer?.disconnect();

      window.removeEventListener(
        'resize',
        redraw
      );

      canvas.removeEventListener(
        'pointermove',
        redraw
      );

      canvas.removeEventListener(
        'wheel',
        redraw
      );

      canvas.removeEventListener(
        'keydown',
        key
      );

      views.delete(canvas);
    }
  };

  views.set(canvas, api);

  return api;
}

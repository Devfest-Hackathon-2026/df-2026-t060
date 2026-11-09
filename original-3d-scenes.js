// gemma412Bシミュレーション.docx の3D描画関数を使う観察用の画面。
// 原文は docs/original/teacherrelay-physics-original.html。Cannon互換部だけ同梱の剛体計算で置き換える。
import * as THREE from './vendor/three.module.js';
import * as CANNON from './sim2/core/rigid-world.js';

const $ = id => document.getElementById(id);
const hudMetricLabel = $('hud-metric-label'), hudMetricVal = $('hud-metric-val'), hudFps = $('hud-fps');
const labelsLayer = $('labels-layer'), thoughtTrace = $('thought-trace'), dynamicSliders = $('dynamic-sliders'), engineActionBtn = $('engine-action-btn');
    function setTelemetry(label, value) {
      if (hudMetricLabel && hudMetricVal) {
        hudMetricLabel.textContent = label;
        hudMetricVal.textContent = value;
      }
    }
    let fpsFrames = 0;
    let fpsLast = performance.now();
    function tickFps(now) {
      fpsFrames++;
      if (now - fpsLast >= 300) {
        hudFps.textContent = String(Math.min(60, Math.round((fpsFrames * 1000) / (now - fpsLast))));
        fpsFrames = 0;
        fpsLast = now;
      }
    }
    function mountOrbit3DSolarSystemEngine(container, config) {
      labelsLayer.innerHTML = '';
      const scene = new THREE.Scene();
      scene.background = new THREE.Color(0x02040a);
      const camera = new THREE.PerspectiveCamera(45, container.clientWidth / container.clientHeight, 0.1, 4000);
      let camDistance = 140;
      let camTheta = 0.8;
      let camPhi = 1.0;
      let followTarget = 'sun';
      let isMouseDown = false, mouseX = 0, mouseY = 0;
      const renderer = new THREE.WebGLRenderer({ antialias: true });
      renderer.setSize(Math.max(1, container.clientWidth), Math.max(1, container.clientHeight));
      renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
      container.appendChild(renderer.domElement);
      const starGeo = new THREE.BufferGeometry();
      const starCoords = [];
      for (let i = 0; i < 2000; i++) {
        starCoords.push(
          (Math.random() - 0.5) * 2000,
          (Math.random() - 0.5) * 2000,
          (Math.random() - 0.5) * 2000
        );
      }
      starGeo.setAttribute('position', new THREE.Float32BufferAttribute(starCoords, 3));
      scene.add(new THREE.Points(starGeo, new THREE.PointsMaterial({ color: 0x94a3b8, size: 1.2, transparent: true, opacity: 0.8 })));
      scene.add(new THREE.AmbientLight(0x475569, 0.7));
      const sunLight = new THREE.PointLight(0xfff7ed, 3.2, 2500, 0.2);
      scene.add(sunLight);
      // Sun
      const sunMesh = new THREE.Mesh(new THREE.SphereGeometry(6.5, 32, 32), new THREE.MeshBasicMaterial({ color: 0xffb703 }));
      scene.add(sunMesh);
      const sunGlow = new THREE.Mesh(new THREE.SphereGeometry(7.8, 32, 32), new THREE.MeshBasicMaterial({ color: 0xf59e0b, transparent: true, opacity: 0.25 }));
      scene.add(sunGlow);
      let solarMassScale = 1.0;
      let timeSpeed = 1.0;
      const planetData = [
        { id: 'mercury', name: '水星', r: 0.8, dist: 13, speed: 0.045, color: 0xa8a29e, angle: 0.3 },
        { id: 'venus',   name: '金星', r: 1.3, dist: 19, speed: 0.032, color: 0xfde047, angle: 1.2 },
        { id: 'earth',   name: '地球', r: 1.5, dist: 27, speed: 0.024, color: 0x38bdf8, angle: 2.1 },
        { id: 'mars',    name: '火星', r: 1.0, dist: 36, speed: 0.019, color: 0xf87171, angle: 3.5 },
        { id: 'jupiter', name: '木星', r: 3.6, dist: 52, speed: 0.011, color: 0xfbbf24, angle: 4.8 },
        { id: 'saturn',  name: '土星', r: 3.0, dist: 70, speed: 0.008, color: 0xfcd34d, angle: 5.6, hasRing: true },
        { id: 'uranus',  name: '天王星', r: 2.2, dist: 88, speed: 0.005, color: 0x67e8f9, angle: 0.9, hasThinRing: true },
        { id: 'neptune', name: '海王星', r: 2.1, dist: 104, speed: 0.004, color: 0x60a5fa, angle: 2.7 }
      ];
      const planetMeshes = {};
      planetData.forEach(p => {
        const mesh = new THREE.Mesh(new THREE.SphereGeometry(p.r, 24, 24), new THREE.MeshStandardMaterial({ color: p.color, roughness: 0.55 }));
        mesh.castShadow = true;
        scene.add(mesh);
        planetMeshes[p.id] = { mesh, data: p, currentDist: p.dist, currentAngle: p.angle };
        if (p.hasRing) {
          const ringGeo = new THREE.RingGeometry(p.r * 1.4, p.r * 2.4, 48);
          const ringMat = new THREE.MeshBasicMaterial({ color: 0xd97706, side: THREE.DoubleSide, transparent: true, opacity: 0.65 });
          const ring = new THREE.Mesh(ringGeo, ringMat);
          ring.rotation.x = Math.PI / 2.4;
          mesh.add(ring);
        }
        if (p.hasThinRing) {
          const ringGeo = new THREE.RingGeometry(p.r * 1.35, p.r * 1.7, 36);
          const ringMat = new THREE.MeshBasicMaterial({ color: 0x67e8f9, side: THREE.DoubleSide, transparent: true, opacity: 0.35 });
          const ring = new THREE.Mesh(ringGeo, ringMat);
          ring.rotation.y = Math.PI / 3;
          mesh.add(ring);
        }
        const pts = new THREE.EllipseCurve(0, 0, p.dist, p.dist, 0, 2 * Math.PI, false, 0).getPoints(96).map(pt => new THREE.Vector3(pt.x, 0, pt.y));
        const orbitLine = new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), new THREE.LineBasicMaterial({ color: 0x334155, transparent: true, opacity: 0.45 }));
        scene.add(orbitLine);
        planetMeshes[p.id].orbitLine = orbitLine;
      });
      // Earth's Moon
      const moonMesh = new THREE.Mesh(new THREE.SphereGeometry(0.45, 16, 16), new THREE.MeshStandardMaterial({ color: 0xe2e8f0, roughness: 0.7 }));
      scene.add(moonMesh);
      let moonAngle = 0;
      // Asteroid Belt (between Mars & Jupiter: r = 41 to 47)
      const asteroidCount = 850;
      const asteroidGeo = new THREE.BufferGeometry();
      const asteroidPos = new Float32Array(asteroidCount * 3);
      for (let i = 0; i < asteroidCount; i++) {
        const r = 41 + Math.random() * 6;
        const th = Math.random() * Math.PI * 2;
        asteroidPos[i * 3] = Math.cos(th) * r;
        asteroidPos[i * 3 + 1] = (Math.random() - 0.5) * 2.2;
        asteroidPos[i * 3 + 2] = Math.sin(th) * r;
      }
      asteroidGeo.setAttribute('position', new THREE.BufferAttribute(asteroidPos, 3));
      const asteroidBelt = new THREE.Points(asteroidGeo, new THREE.PointsMaterial({ color: 0x94a3b8, size: 0.65, transparent: true, opacity: 0.75 }));
      scene.add(asteroidBelt);
      // Halley's Comet (Eccentric 3D Orbit + Tail)
      const cometGroup = new THREE.Group();
      const cometHead = new THREE.Mesh(new THREE.SphereGeometry(0.9, 16, 16), new THREE.MeshBasicMaterial({ color: 0x67e8f9 }));
      cometGroup.add(cometHead);
      const cometTailGeo = new THREE.ConeGeometry(1.4, 9, 16);
      cometTailGeo.translate(0, -4.5, 0);
      cometTailGeo.rotateX(Math.PI / 2);
      const cometTail = new THREE.Mesh(cometTailGeo, new THREE.MeshBasicMaterial({ color: 0x38bdf8, transparent: true, opacity: 0.45 }));
      cometGroup.add(cometTail);
      scene.add(cometGroup);
      const cometOrbitPts = [];
      for (let i = 0; i <= 120; i++) {
        const th = (i / 120) * Math.PI * 2;
        const cx = Math.cos(th) * 68 - 32;
        const cz = Math.sin(th) * 28;
        const cy = Math.sin(th) * 14;
        cometOrbitPts.push(new THREE.Vector3(cx, cy, cz));
      }
      const cometOrbitLine = new THREE.Line(new THREE.BufferGeometry().setFromPoints(cometOrbitPts), new THREE.LineDashedMaterial({ color: 0x38bdf8, dashSize: 2, gapSize: 1, transparent: true, opacity: 0.4 }));
      cometOrbitLine.computeLineDistances();
      scene.add(cometOrbitLine);
      let cometAngle = 0.8;
      // 3D Spacetime Gravity Well Grid
      const wellSize = 220;
      const wellSegments = 56;
      const wellGeo = new THREE.PlaneGeometry(wellSize, wellSize, wellSegments, wellSegments);
      wellGeo.rotateX(-Math.PI / 2);
      const wellMat = new THREE.MeshBasicMaterial({ color: 0x1e3a8a, wireframe: true, transparent: true, opacity: 0.42 });
      const gravityWellMesh = new THREE.Mesh(wellGeo, wellMat);
      gravityWellMesh.position.y = -10;
      scene.add(gravityWellMesh);
      // Probes: 1st, 2nd, and 3rd Cosmic Velocities
      const probes = [];
      function launchCosmicProbe(type) {
        const earthData = planetMeshes.earth;
        const ePos = earthData.mesh.position.clone();
        const probeColor = type === 1 ? 0x38bdf8 : type === 2 ? 0x22c55e : 0xf43f5e;
        const pMesh = new THREE.Mesh(new THREE.SphereGeometry(0.55, 16, 16), new THREE.MeshBasicMaterial({ color: probeColor }));
        scene.add(pMesh);
        const maxPts = 600;
        const positions = new Float32Array(maxPts * 3);
        const trailGeo = new THREE.BufferGeometry();
        trailGeo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
        const trailLine = new THREE.Line(trailGeo, new THREE.LineBasicMaterial({ color: probeColor, transparent: true, opacity: 0.9 }));
        scene.add(trailLine);
        // Tangential vector of Earth's orbit
        const tangent = new THREE.Vector3(-Math.sin(earthData.currentAngle), 0, Math.cos(earthData.currentAngle)).normalize();
        const radialOut = new THREE.Vector3(Math.cos(earthData.currentAngle), 0, Math.sin(earthData.currentAngle)).normalize();
        let pos = ePos.clone().addScaledVector(radialOut, 2.5);
        let vel;
        if (type === 1) {
          // 1st Cosmic Velocity (~7.9 km/s): Circular Low Earth Orbit
          vel = tangent.clone().multiplyScalar(0.42);
        } else if (type === 2) {
          // 2nd Cosmic Velocity (~11.2 km/s): Escape Earth's pull into Heliocentric elliptical orbit
          vel = tangent.clone().multiplyScalar(0.56).addScaledVector(radialOut, 0.14);
        } else {
          // 3rd Cosmic Velocity (~16.7 km/s): Escape the entire Solar System (Hyperbolic trajectory)
          vel = tangent.clone().multiplyScalar(0.95).addScaledVector(radialOut, 0.42).add(new THREE.Vector3(0, 0.12, 0));
        }
        probes.push({ mesh: pMesh, pos, vel, type, trailLine, trailPositions: positions, trailIndex: 0, stepCount: 0, alive: true, earthAngleOffset: 0 });
      }
      setTimeout(() => { launchCosmicProbe(1); launchCosmicProbe(2); launchCosmicProbe(3); }, 300);
      // Controls
      const onDown = (e) => {
        if (e.target.closest('#left-panel') || e.target.closest('header')) return;
        isMouseDown = true;
        mouseX = e.clientX || (e.touches && e.touches[0].clientX);
        mouseY = e.clientY || (e.touches && e.touches[0].clientY);
      };
      const onMove = (e) => {
        if (!isMouseDown) return;
        const cx = e.clientX || (e.touches && e.touches[0].clientX);
        const cy = e.clientY || (e.touches && e.touches[0].clientY);
        camTheta += (cx - mouseX) * 0.007;
        camPhi = Math.max(0.1, Math.min(Math.PI - 0.1, camPhi - (cy - mouseY) * 0.007));
        mouseX = cx;
        mouseY = cy;
      };
      const onUp = () => { isMouseDown = false; };
      const onWheel = (e) => { camDistance = Math.max(12, Math.min(600, camDistance + e.deltaY * 0.15)); };
      container.addEventListener('pointerdown', onDown);
      window.addEventListener('pointermove', onMove);
      window.addEventListener('pointerup', onUp);
      container.addEventListener('wheel', onWheel, { passive: true });
      dynamicSliders.innerHTML = `
        <div class="space-y-2">
          <div>
            <span class="block text-[11px] font-semibold text-purple-300 mb-1">🎥 カメラ追従ターゲット</span>
            <div class="grid grid-cols-4 gap-1 text-[10px]">
              <button data-cam="sun" class="cam-target-btn py-1 rounded bg-purple-500/30 border border-purple-400 text-white font-semibold">☀️ 太陽系</button>
              <button data-cam="earth" class="cam-target-btn py-1 rounded bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-200">🌍 地球＆月</button>
              <button data-cam="saturn" class="cam-target-btn py-1 rounded bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-200">🪐 土星</button>
              <button data-cam="comet" class="cam-target-btn py-1 rounded bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-200">☄️ 彗星</button>
            </div>
          </div>
          <div class="flex items-center justify-between text-[11px] pt-1">
            <span class="text-slate-300">太陽質量倍率: <span id="val-solar-mass" class="mono text-sky-400 font-bold">${solarMassScale.toFixed(1)}</span> M☉</span>
            <label class="flex items-center gap-1 text-[10px] text-sky-300 cursor-pointer">
              <input id="toggle-well-cb" type="checkbox" checked class="rounded text-sky-500">
              <span>時空重力ウェル</span>
            </label>
          </div>
          <input id="slider-solar-mass" type="range" min="0.1" max="3.0" step="0.1" value="${solarMassScale}" class="w-full h-1 bg-slate-700 rounded-lg cursor-pointer">
          <div class="flex items-center justify-between text-[11px]">
            <span class="text-slate-300">公転スピード: <span id="val-time-speed" class="mono text-sky-400 font-bold">${timeSpeed.toFixed(1)}</span>x</span>
          </div>
          <input id="slider-time-speed" type="range" min="0.1" max="4.0" step="0.1" value="${timeSpeed}" class="w-full h-1 bg-slate-700 rounded-lg cursor-pointer">
          <div class="pt-1">
            <span class="block text-[11px] font-semibold text-sky-400 mb-1">🪐 天体の出し入れ (ON/OFF)</span>
            <div class="grid grid-cols-4 gap-1 text-[10px]">
              ${planetData.map(p => `
                <label class="flex items-center gap-1 cursor-pointer bg-slate-800/80 p-1 rounded border border-slate-700/60 hover:border-slate-500">
                  <input type="checkbox" checked data-planet="${p.id}" class="planet-cb rounded text-sky-500 focus:ring-0">
                  <span class="truncate">${p.name}</span>
                </label>
              `).join('')}
              <label class="flex items-center gap-1 cursor-pointer bg-slate-800/80 p-1 rounded border border-slate-700/60">
                <input type="checkbox" checked id="cb-moon" class="rounded text-sky-500">
                <span>🌙 月</span>
              </label>
              <label class="flex items-center gap-1 cursor-pointer bg-slate-800/80 p-1 rounded border border-slate-700/60">
                <input type="checkbox" checked id="cb-comet" class="rounded text-sky-500">
                <span>☄️ 彗星</span>
              </label>
              <label class="flex items-center gap-1 cursor-pointer bg-slate-800/80 p-1 rounded border border-slate-700/60 col-span-2">
                <input type="checkbox" checked id="cb-asteroids" class="rounded text-sky-500">
                <span>🪨 小惑星帯 (850個)</span>
              </label>
            </div>
          </div>
          <div class="pt-1">
            <span class="block text-[11px] font-semibold text-sky-400 mb-1">🚀 宇宙速度の設定モード選択 (地球発射)</span>
            <div class="grid grid-cols-2 gap-1 mb-1">
              <button data-vmode="v1" class="vmode-btn py-1.5 px-1.5 rounded bg-sky-500/20 hover:bg-sky-500/40 border border-sky-400/50 text-[10px] text-sky-200 font-semibold text-left">
                ① 第1宇宙速度 (7.9km/s)<br><span class="text-[9px] text-slate-300">地球の周りを円軌道周回</span>
              </button>
              <button data-vmode="v2" class="vmode-btn py-1.5 px-1.5 rounded bg-emerald-500/20 hover:bg-emerald-500/40 border border-emerald-400/50 text-[10px] text-emerald-200 font-semibold text-left">
                ② 第2宇宙速度 (11.2km/s)<br><span class="text-[9px] text-slate-300">地球圏を脱出し太陽周回</span>
              </button>
              <button data-vmode="v3" class="vmode-btn py-1.5 px-1.5 rounded bg-rose-500/20 hover:bg-rose-500/40 border border-rose-400/50 text-[10px] text-rose-200 font-semibold text-left">
                ③ 第3宇宙速度 (16.7km/s)<br><span class="text-[9px] text-slate-300">太陽重力を振り切り太陽系脱出</span>
              </button>
              <button data-vmode="all" class="vmode-btn py-1.5 px-1.5 rounded bg-purple-500/30 hover:bg-purple-500/50 border border-purple-400 text-[10px] text-white font-semibold text-left">
                🌟 3つの宇宙速度を同時比較<br><span class="text-[9px] text-purple-200">軌道の違いを一斉トレース</span>
              </button>
            </div>
          </div>
        </div>
      `;
      function clearProbes() {
        for (let i = probes.length - 1; i >= 0; i--) {
          scene.remove(probes[i].mesh);
          scene.remove(probes[i].trailLine);
          if (probes[i].labelEl) probes[i].labelEl.remove();
        }
        probes.length = 0;
      }
      function applyCosmicVelocityMode(mode) {
        clearProbes();
        if (mode === 'v1') {
          followTarget = 'earth';
          camDistance = 16;
          launchCosmicProbe(1);
          thoughtTrace.textContent = `【第1宇宙速度モード (v₁ ≈ 7.9 km/s)】\n地球の重力と遠心力が釣り合い、地球の表面すれすれ（低軌道）を円軌道で周回し続けます。`;
        } else if (mode === 'v2') {
          followTarget = 'earth';
          camDistance = 42;
          launchCosmicProbe(2);
          thoughtTrace.textContent = `【第2宇宙速度モード (v₂ ≈ 11.2 km/s)】\n地球の重力圏（ヒル球）を振り切る脱出速度に達し、地球を離れて太陽を焦点とする人工惑星（楕円軌道）へ遷移します。`;
        } else if (mode === 'v3') {
          followTarget = 'sun';
          camDistance = 135;
          launchCosmicProbe(3);
          thoughtTrace.textContent = `【第3宇宙速度モード (v₃ ≈ 16.7 km/s)】\n地球の公転速度(約29.8km/s)を利用して太陽の脱出速度(約42.1km/s)を超え、双曲線軌道を描いて太陽系外（星間空間）へと永久に脱出します。`;
        } else {
          followTarget = 'earth';
          camDistance = 38;
          launchCosmicProbe(1);
          launchCosmicProbe(2);
          launchCosmicProbe(3);
          thoughtTrace.textContent = `【第1・第2・第3宇宙速度 同時比較モード】\n地球から発射された3機の探査機の軌道（①地球周回円軌道、②太陽周回楕円軌道、③太陽系脱出双曲線軌道）を同時に3D比較します。`;
        }
        document.querySelectorAll('.vmode-btn').forEach(b => {
          const active = b.dataset.vmode === mode;
          b.style.boxShadow = active ? '0 0 12px rgba(56, 189, 248, 0.5)' : 'none';
          b.style.borderWidth = active ? '2px' : '1px';
        });
      }
      document.querySelectorAll('.cam-target-btn').forEach(btn => {
        btn.addEventListener('click', () => {
          followTarget = btn.dataset.cam;
          if (followTarget === 'earth') camDistance = 26;
          else if (followTarget === 'saturn') camDistance = 32;
          else if (followTarget === 'comet') camDistance = 38;
          else camDistance = 140;
          document.querySelectorAll('.cam-target-btn').forEach(b => {
            b.className = b === btn
              ? 'cam-target-btn py-1 rounded bg-purple-500/30 border border-purple-400 text-white font-semibold'
              : 'cam-target-btn py-1 rounded bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-200';
          });
        });
      });
      document.getElementById('toggle-well-cb').addEventListener('change', (e) => {
        gravityWellMesh.visible = e.target.checked;
      });
      document.getElementById('slider-solar-mass').addEventListener('input', (e) => {
        solarMassScale = parseFloat(e.target.value);
        document.getElementById('val-solar-mass').textContent = solarMassScale.toFixed(1);
      });
      document.getElementById('slider-time-speed').addEventListener('input', (e) => {
        timeSpeed = parseFloat(e.target.value);
        document.getElementById('val-time-speed').textContent = timeSpeed.toFixed(1);
      });
      document.querySelectorAll('.planet-cb').forEach(cb => {
        cb.addEventListener('change', (e) => {
          const pid = e.target.dataset.planet;
          if (planetMeshes[pid]) {
            planetMeshes[pid].mesh.visible = e.target.checked;
            planetMeshes[pid].orbitLine.visible = e.target.checked;
          }
        });
      });
      document.getElementById('cb-moon').addEventListener('change', (e) => { moonMesh.visible = e.target.checked; });
      document.getElementById('cb-comet').addEventListener('change', (e) => {
        cometGroup.visible = e.target.checked;
        cometOrbitLine.visible = e.target.checked;
      });
      document.getElementById('cb-asteroids').addEventListener('change', (e) => { asteroidBelt.visible = e.target.checked; });
      document.querySelectorAll('.vmode-btn').forEach(btn => {
        btn.onclick = () => applyCosmicVelocityMode(btn.dataset.vmode);
      });
      if (config.cosmicMode) {
        setTimeout(() => applyCosmicVelocityMode(config.cosmicMode), 320);
      }
      engineActionBtn.textContent = '🚀 3宇宙速度一斉発射';
      engineActionBtn.onclick = () => applyCosmicVelocityMode('all');
      // 3D floating HTML labels for Earth and Probes
      function createFloatingLabel(text, colorHex) {
        const el = document.createElement('div');
        el.className = 'fixed px-1.5 py-0.5 rounded bg-slate-950/85 border text-[10px] mono font-semibold pointer-events-none whitespace-nowrap transition-opacity duration-150';
        el.style.borderColor = colorHex;
        el.style.color = colorHex;
        el.textContent = text;
        labelsLayer.appendChild(el);
        return el;
      }
      const earthLabel = createFloatingLabel('🌍 地球 (発射基地)', '#38bdf8');
      function projectToScreen(vec3) {
        const v = vec3.clone().project(camera);
        if (v.z > 1 || v.z < -1) return null;
        return {
          x: (v.x * 0.5 + 0.5) * container.clientWidth,
          y: (-(v.y * 0.5) + 0.5) * container.clientHeight
        };
      }
      const lookAtTarget = new THREE.Vector3(0, 0, 0);
      let rafId = null, lastTime = performance.now();
      function loop(now) {
        rafId = requestAnimationFrame(loop);
        tickFps(now);
        const dt = Math.min((now - lastTime) / 1000, 0.05);
        lastTime = now;
        planetData.forEach(p => {
          const entry = planetMeshes[p.id];
          if (!entry) return;
          entry.currentAngle += p.speed * Math.sqrt(solarMassScale) * timeSpeed * 0.7;
          const targetDist = p.dist / Math.pow(Math.max(0.15, solarMassScale), 0.25);
          entry.currentDist += (targetDist - entry.currentDist) * 0.03;
          entry.mesh.position.set(Math.cos(entry.currentAngle) * entry.currentDist, 0, Math.sin(entry.currentAngle) * entry.currentDist);
          entry.mesh.rotation.y += 0.02;
        });
        const earthPos = planetMeshes.earth.mesh.position;
        moonAngle += 0.09 * timeSpeed;
        moonMesh.position.set(earthPos.x + Math.cos(moonAngle) * 3.2, earthPos.y, earthPos.z + Math.sin(moonAngle) * 3.2);
        asteroidBelt.rotation.y += 0.0018 * timeSpeed;
        // Halley's Comet update
        cometAngle += 0.012 * timeSpeed * Math.sqrt(solarMassScale);
        const cx = Math.cos(cometAngle) * 68 - 32;
        const cz = Math.sin(cometAngle) * 28;
        const cy = Math.sin(cometAngle) * 14;
        cometGroup.position.set(cx, cy, cz);
        cometGroup.lookAt(0, 0, 0);
        // Update 3D Spacetime Gravity Well vertices
        if (gravityWellMesh.visible) {
          const posAttr = wellGeo.attributes.position;
          const jupPos = planetMeshes.jupiter.mesh.position;
          for (let i = 0; i < posAttr.count; i++) {
            const vx = posAttr.getX(i);
            const vz = posAttr.getZ(i);
            const dSun = Math.sqrt(vx * vx + vz * vz);
            const dJup = Math.sqrt((vx - jupPos.x) ** 2 + (vz - jupPos.z) ** 2);
            const sunDip = -(28 * solarMassScale) / (1 + dSun * 0.12);
            const jupDip = -6.5 / (1 + dJup * 0.25);
            posAttr.setY(i, sunDip + jupDip);
          }
          posAttr.needsUpdate = true;
        }
        // Cosmic Velocity Probes update
        for (let i = probes.length - 1; i >= 0; i--) {
          const pb = probes[i];
          if (!pb.alive) continue;
          if (!pb.labelEl) {
            const labelTitle = pb.type === 1
              ? '① 第1宇宙速度 (7.9km/s: 地球周回)'
              : pb.type === 2
                ? '② 第2宇宙速度 (11.2km/s: 地球脱出)'
                : '③ 第3宇宙速度 (16.7km/s: 太陽系脱出)';
            const labelColor = pb.type === 1 ? '#38bdf8' : pb.type === 2 ? '#22c55e' : '#f43f5e';
            pb.labelEl = createFloatingLabel(labelTitle, labelColor);
          }
          if (pb.type === 1) {
            pb.earthAngleOffset += 0.14 * timeSpeed;
            pb.pos.set(
              earthPos.x + Math.cos(pb.earthAngleOffset) * 2.3,
              earthPos.y + Math.sin(pb.earthAngleOffset * 0.7) * 0.6,
              earthPos.z + Math.sin(pb.earthAngleOffset) * 2.3
            );
          } else if (pb.type === 2) {
            const rSun = pb.pos.clone().negate();
            const dSunSq = Math.max(25, pb.pos.lengthSq());
            pb.vel.addScaledVector(rSun.normalize(), ((solarMassScale * 18) / dSunSq) * dt * 60 * timeSpeed);
            pb.pos.addScaledVector(pb.vel, dt * 60 * timeSpeed);
          } else {
            const rSun = pb.pos.clone().negate();
            const dSunSq = Math.max(35, pb.pos.lengthSq());
            pb.vel.addScaledVector(rSun.normalize(), ((solarMassScale * 6) / dSunSq) * dt * 60 * timeSpeed);
            pb.pos.addScaledVector(pb.vel, dt * 60 * timeSpeed);
          }
          pb.mesh.position.copy(pb.pos);
          const sp = projectToScreen(pb.pos);
          if (sp && pb.labelEl) {
            pb.labelEl.style.left = `${sp.x + 10}px`;
            pb.labelEl.style.top = `${sp.y - 10}px`;
            pb.labelEl.style.opacity = '1';
          } else if (pb.labelEl) {
            pb.labelEl.style.opacity = '0';
          }
          pb.stepCount++;
          if (pb.stepCount % 2 === 0 && pb.trailIndex < 600) {
            const idx = pb.trailIndex * 3;
            pb.trailPositions[idx] = pb.pos.x;
            pb.trailPositions[idx + 1] = pb.pos.y;
            pb.trailPositions[idx + 2] = pb.pos.z;
            pb.trailIndex++;
            pb.trailLine.geometry.attributes.position.needsUpdate = true;
            pb.trailLine.geometry.setDrawRange(0, pb.trailIndex);
          }
          if (pb.pos.length() > 750) {
            scene.remove(pb.mesh);
            scene.remove(pb.trailLine);
            if (pb.labelEl) pb.labelEl.remove();
            pb.alive = false;
            probes.splice(i, 1);
          }
        }
        // Smooth camera target follow
        let targetVec = new THREE.Vector3(0, 0, 0);
        if (followTarget === 'earth') targetVec.copy(earthPos);
        else if (followTarget === 'saturn') targetVec.copy(planetMeshes.saturn.mesh.position);
        else if (followTarget === 'comet') targetVec.copy(cometGroup.position);
        lookAtTarget.lerp(targetVec, 0.08);
        camera.position.set(
          lookAtTarget.x + camDistance * Math.sin(camPhi) * Math.sin(camTheta),
          lookAtTarget.y + camDistance * Math.cos(camPhi),
          lookAtTarget.z + camDistance * Math.sin(camPhi) * Math.cos(camTheta)
        );
        camera.lookAt(lookAtTarget);
        const ep = projectToScreen(earthPos);
        if (ep) {
          earthLabel.style.left = `${ep.x - 40}px`;
          earthLabel.style.top = `${ep.y + 14}px`;
          earthLabel.style.opacity = planetMeshes.earth.mesh.visible ? '1' : '0';
        }
        renderer.render(scene, camera);
        setTelemetry('探査機 / 太陽質量:', `${probes.length}機 (①地球周回 ②太陽周回 ③太陽系脱出) / ${solarMassScale.toFixed(1)} M☉`);
      }
      rafId = requestAnimationFrame(loop);
      const onResize = () => {
        camera.aspect = container.clientWidth / container.clientHeight;
        camera.updateProjectionMatrix();
        renderer.setSize(Math.max(1, container.clientWidth), Math.max(1, container.clientHeight));
      };
      window.addEventListener('resize', onResize);
      return {
        setSolarMass(m) {
          solarMassScale = m;
          const sl = document.getElementById('slider-solar-mass');
          if (sl) sl.value = m;
          const vl = document.getElementById('val-solar-mass');
          if (vl) vl.textContent = m.toFixed(1);
        },
        applyCosmicVelocityMode,
        launchCosmicProbe,
        dispose() {
          cancelAnimationFrame(rafId);
          window.removeEventListener('resize', onResize);
          window.removeEventListener('pointermove', onMove);
          window.removeEventListener('pointerup', onUp);
          labelsLayer.innerHTML = '';
          container.innerHTML = '';
        }
      };
    }
    // --- ENGINE 2-A: CANNON 3D RIGID BODY (DOMINO & TOWER COLLAPSE) ---
    function mountCannon3DRigidEngine(container, config) {
      labelsLayer.innerHTML = '';
      const scene = new THREE.Scene();
      scene.background = new THREE.Color(0x060a12);
      scene.fog = new THREE.FogExp2(0x060a12, 0.015);
      const camera = new THREE.PerspectiveCamera(45, container.clientWidth / container.clientHeight, 0.1, 1000);
      camera.position.set(0, 16, 32);
      const renderer = new THREE.WebGLRenderer({ antialias: true });
      renderer.setSize(Math.max(1, container.clientWidth), Math.max(1, container.clientHeight));
      renderer.shadowMap.enabled = true;
      container.appendChild(renderer.domElement);
      scene.add(new THREE.AmbientLight(0xffffff, 0.5));
      const light = new THREE.DirectionalLight(0xffffff, 1.2);
      light.position.set(15, 30, 20);
      light.castShadow = true;
      scene.add(light);
      const world = new CANNON.World();
      world.gravity.set(0, -9.82, 0);
      world.broadphase = new CANNON.SAPBroadphase(world);
      const groundBody = new CANNON.Body({ mass: 0, shape: new CANNON.Plane() });
      groundBody.quaternion.setFromEuler(-Math.PI / 2, 0, 0);
      world.addBody(groundBody);
      const grid = new THREE.GridHelper(60, 60, 0x38bdf8, 0x1e293b);
      scene.add(grid);
      const syncedObjects = [];
      function addRigid(mesh, body) {
        scene.add(mesh);
        world.addBody(body);
        syncedObjects.push({ mesh, body });
      }
      function clearRigids() {
        for (const obj of syncedObjects) {
          scene.remove(obj.mesh);
          world.removeBody(obj.body);
        }
        syncedObjects.length = 0;
      }
      function setupDominoScene() {
        clearRigids();
        // Slope
        const slopeGeo = new THREE.BoxGeometry(10, 0.5, 5);
        const slopeMat = new THREE.MeshStandardMaterial({ color: 0x334155 });
        const slopeMesh = new THREE.Mesh(slopeGeo, slopeMat);
        const slopeBody = new CANNON.Body({ mass: 0, shape: new CANNON.Box(new CANNON.Vec3(5, 0.25, 2.5)), position: new CANNON.Vec3(-7, 5, 0) });
        slopeBody.quaternion.setFromEuler(0, 0, -0.35);
        addRigid(slopeMesh, slopeBody);
        // Dominoes
        for (let i = 0; i < 9; i++) {
          const dMesh = new THREE.Mesh(new THREE.BoxGeometry(0.4, 3.6, 2.4), new THREE.MeshStandardMaterial({ color: 0xf43f5e }));
          dMesh.castShadow = true;
          const dBody = new CANNON.Body({ mass: 2, shape: new CANNON.Box(new CANNON.Vec3(0.2, 1.8, 1.2)), position: new CANNON.Vec3(-0.5 + i * 1.5, 1.8, 0) });
          addRigid(dMesh, dBody);
        }
        // Rolling spheres
        const colors = [0x38bdf8, 0xa855f7, 0xfacc15, 0x22c55e];
        for (let i = 0; i < 16; i++) {
          const r = 0.6;
          const sMesh = new THREE.Mesh(new THREE.SphereGeometry(r, 24, 24), new THREE.MeshStandardMaterial({ color: colors[i % 4] }));
          sMesh.castShadow = true;
          const sBody = new CANNON.Body({
            mass: 2.5,
            shape: new CANNON.Sphere(r),
            position: new CANNON.Vec3(-10 + (i % 4) * 1.3, 9 + Math.floor(i / 4) * 1.6, -1 + (i % 3))
          });
          addRigid(sMesh, sBody);
        }
      }
      function setupTowerScene() {
        clearRigids();
        const floors = 7;
        for (let y = 0; y < floors; y++) {
          for (let x = -1; x <= 1; x++) {
            const bMesh = new THREE.Mesh(new THREE.BoxGeometry(1.8, 1.4, 1.8), new THREE.MeshStandardMaterial({ color: y % 2 === 0 ? 0x38bdf8 : 0x818cf8 }));
            bMesh.castShadow = true;
            const bBody = new CANNON.Body({ mass: 1.5, shape: new CANNON.Box(new CANNON.Vec3(0.9, 0.7, 0.9)), position: new CANNON.Vec3(x * 1.85, 0.7 + y * 1.42, 0) });
            addRigid(bMesh, bBody);
          }
        }
      }
      function firePlasmaBall() {
        if (syncedObjects.length >= 72) return;
        const r = 0.85;
        const mesh = new THREE.Mesh(new THREE.SphereGeometry(r, 24, 24), new THREE.MeshBasicMaterial({ color: 0xfacc15 }));
        const body = new CANNON.Body({ mass: 12, shape: new CANNON.Sphere(r), position: new CANNON.Vec3(0, 6, 20) });
        body.velocity.set((Math.random() - 0.5) * 4, 2, -38);
        addRigid(mesh, body);
      }
      setupDominoScene();
      dynamicSliders.innerHTML = `
        <div class="space-y-2">
          <span class="block text-[11px] font-semibold text-sky-400">3D剛体プリセット選択</span>
          <div class="grid grid-cols-2 gap-1.5">
            <button id="btn-domino-scene" class="py-1.5 px-2 rounded bg-sky-500/20 border border-sky-400 text-xs font-semibold text-white">🎲 坂道＆連鎖ドミノ</button>
            <button id="btn-tower-scene" class="py-1.5 px-2 rounded bg-indigo-500/20 border border-indigo-400 text-xs font-semibold text-white">🏰 多層タワー建設</button>
          </div>
          <button id="btn-fire-plasma" class="w-full py-1.5 rounded bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold text-xs transition">
            💥 高速プラズマ砲弾を発射 (画面クリックでも発射可)
          </button>
        </div>
      `;
      document.getElementById('btn-domino-scene').onclick = setupDominoScene;
      document.getElementById('btn-tower-scene').onclick = setupTowerScene;
      document.getElementById('btn-fire-plasma').onclick = firePlasmaBall;
      engineActionBtn.textContent = '💥 プラズマ弾発射';
      engineActionBtn.onclick = firePlasmaBall;
      const onStageClick = (e) => {
        if (e.target.closest('#left-panel') || e.target.closest('header')) return;
        firePlasmaBall();
      };
      container.addEventListener('click', onStageClick);
      let rafId = null;
      function loop(now) {
        rafId = requestAnimationFrame(loop);
        tickFps(now);
        world.step(1 / 60);
        for (const obj of syncedObjects) {
          obj.mesh.position.copy(obj.body.position);
          obj.mesh.quaternion.copy(obj.body.quaternion);
        }
        camera.lookAt(0, 3, 0);
        renderer.render(scene, camera);
        setTelemetry('3D剛体オブジェクト数:', `${syncedObjects.length} 個`);
      }
      rafId = requestAnimationFrame(loop);
      const onResize = () => {
        camera.aspect = container.clientWidth / container.clientHeight;
        camera.updateProjectionMatrix();
        renderer.setSize(Math.max(1, container.clientWidth), Math.max(1, container.clientHeight));
      };
      window.addEventListener('resize', onResize);
      return {
        dispose() {
          cancelAnimationFrame(rafId);
          window.removeEventListener('resize', onResize);
          container.removeEventListener('click', onStageClick);
          container.innerHTML = '';
        }
      };
    }
    // --- ENGINE 2-B: PROJECTILE & FREE FALL (3D / 2D SWITCHABLE) ---
    function mountMechanicsEngine(container, config) {
      labelsLayer.innerHTML = '';
      let is3D = config.is3D ?? true;
      let angleDeg = config.angle ?? 45;
      let v0 = config.velocity ?? 22;
      let h0 = config.height ?? 10;
      let g = config.gravity ?? 9.8;
      let activeBalls = [];
      let rafId = null;
      let renderer = null, scene = null, camera = null, canvas2d = null, ctx2d = null;
      function launchBall(freeFall = false) {
        const rad = (angleDeg * Math.PI) / 180;
        const vx = freeFall ? 0 : v0 * Math.cos(rad);
        const vy = freeFall ? 0 : v0 * Math.sin(rad);
        if (activeBalls.length >= 14) { const gone = activeBalls.shift(); if (gone.mesh) { scene?.remove(gone.mesh); gone.mesh.geometry.dispose(); gone.mesh.material.dispose(); } }
        const ball = {
          x: 0,
          y: h0,
          vx,
          vy,
          t: 0,
          color: freeFall ? '#f43f5e' : '#38bdf8',
          trail: [{ x: 0, y: h0 }],
          mesh: null,
          line: null
        };
        if (is3D && scene) {
          const mat = new THREE.MeshStandardMaterial({ color: freeFall ? 0xf43f5e : 0x38bdf8 });
          ball.mesh = new THREE.Mesh(new THREE.SphereGeometry(0.9, 24, 24), mat);
          ball.mesh.position.set(-20, h0, 0);
          scene.add(ball.mesh);
        }
        activeBalls.push(ball);
      }
      function setupView() {
        if (rafId) cancelAnimationFrame(rafId);
        renderer?.dispose();
        container.innerHTML = '';
        activeBalls = [];
        if (is3D) {
          scene = new THREE.Scene();
          scene.background = new THREE.Color(0x060a12);
          camera = new THREE.PerspectiveCamera(45, container.clientWidth / container.clientHeight, 0.1, 1000);
          camera.position.set(5, 18, 55);
          camera.lookAt(5, 8, 0);
          renderer = new THREE.WebGLRenderer({ antialias: true });
          renderer.setSize(Math.max(1, container.clientWidth), Math.max(1, container.clientHeight));
          container.appendChild(renderer.domElement);
          scene.add(new THREE.AmbientLight(0xffffff, 0.6));
          const dir = new THREE.DirectionalLight(0xffffff, 1.1);
          dir.position.set(20, 40, 20);
          scene.add(dir);
          const grid = new THREE.GridHelper(90, 45, 0x38bdf8, 0x1e293b);
          scene.add(grid);
          // Launch tower
          const tower = new THREE.Mesh(new THREE.BoxGeometry(2.5, Math.max(0.5, h0), 2.5), new THREE.MeshStandardMaterial({ color: 0x334155 }));
          tower.position.set(-20, h0 / 2, 0);
          scene.add(tower);
        } else {
          canvas2d = document.createElement('canvas');
          canvas2d.className = 'w-full h-full block';
          container.appendChild(canvas2d);
          ctx2d = canvas2d.getContext('2d');
          canvas2d.width = container.clientWidth;
          canvas2d.height = container.clientHeight;
        }
        launchBall(false);
        rafId = requestAnimationFrame(loop);
      }
      dynamicSliders.innerHTML = `
        <div class="space-y-2">
          <div class="flex items-center justify-between">
            <span class="text-[11px] font-semibold text-sky-400">視点モード切替</span>
            <div class="flex gap-1">
              <button id="btn-mech-3d" class="px-2.5 py-0.5 rounded text-[10px] font-bold border">3D 空間</button>
              <button id="btn-mech-2d" class="px-2.5 py-0.5 rounded text-[10px] font-bold border">2D 軌跡解析</button>
            </div>
          </div>
          <div class="flex items-center justify-between text-[11px]">
            <span class="text-slate-300">投げる角度 θ: <span id="val-angle" class="mono text-sky-400 font-bold">${angleDeg}</span>°</span>
            <span class="text-slate-300">初速 v₀: <span id="val-v0" class="mono text-sky-400 font-bold">${v0}</span> m/s</span>
          </div>
          <input id="slider-angle" type="range" min="0" max="85" step="1" value="${angleDeg}" class="w-full h-1 bg-slate-700 rounded-lg cursor-pointer">
          <input id="slider-v0" type="range" min="0" max="38" step="1" value="${v0}" class="w-full h-1 bg-slate-700 rounded-lg cursor-pointer">
          <div class="flex items-center justify-between text-[11px]">
            <span class="text-slate-300">発射高さ h: <span id="val-h0" class="mono text-sky-400 font-bold">${h0}</span> m</span>
            <span class="text-slate-300">重力 g: <span id="val-g" class="mono text-amber-400 font-bold">${g.toFixed(1)}</span> m/s²</span>
          </div>
          <input id="slider-h0" type="range" min="0" max="25" step="1" value="${h0}" class="w-full h-1 bg-slate-700 rounded-lg cursor-pointer">
          <input id="slider-g" type="range" min="1.6" max="24.8" step="0.2" value="${g}" class="w-full h-1 bg-slate-700 rounded-lg cursor-pointer">
          <div class="grid grid-cols-2 gap-1.5 pt-1">
            <button id="btn-throw-ball" class="py-1.5 rounded bg-sky-600 hover:bg-sky-500 text-white font-semibold text-xs">⚾ ボールを投げる</button>
            <button id="btn-free-fall" class="py-1.5 rounded bg-rose-600 hover:bg-rose-500 text-white font-semibold text-xs">⬇️ 自由落下 (v₀=0)</button>
          </div>
        </div>
      `;
      function updateToggleButtons() {
        const b3 = document.getElementById('btn-mech-3d');
        const b2 = document.getElementById('btn-mech-2d');
        b3.className = is3D ? 'px-2.5 py-0.5 rounded text-[10px] font-bold bg-sky-500/30 border-sky-400 text-white' : 'px-2.5 py-0.5 rounded text-[10px] font-bold bg-slate-800 border-slate-700 text-slate-400';
        b2.className = !is3D ? 'px-2.5 py-0.5 rounded text-[10px] font-bold bg-sky-500/30 border-sky-400 text-white' : 'px-2.5 py-0.5 rounded text-[10px] font-bold bg-slate-800 border-slate-700 text-slate-400';
      }
      updateToggleButtons();
      document.getElementById('btn-mech-3d').onclick = () => { is3D = true; updateToggleButtons(); setupView(); };
      document.getElementById('btn-mech-2d').onclick = () => { is3D = false; updateToggleButtons(); setupView(); };
      document.getElementById('slider-angle').oninput = (e) => { angleDeg = parseFloat(e.target.value); document.getElementById('val-angle').textContent = angleDeg; };
      document.getElementById('slider-v0').oninput = (e) => { v0 = parseFloat(e.target.value); document.getElementById('val-v0').textContent = v0; };
      document.getElementById('slider-h0').oninput = (e) => { h0 = parseFloat(e.target.value); document.getElementById('val-h0').textContent = h0; };
      document.getElementById('slider-g').oninput = (e) => { g = parseFloat(e.target.value); document.getElementById('val-g').textContent = g.toFixed(1); };
      document.getElementById('btn-throw-ball').onclick = () => launchBall(false);
      document.getElementById('btn-free-fall').onclick = () => launchBall(true);
      engineActionBtn.textContent = '⚾ 投射＆落下同時比較';
      engineActionBtn.onclick = () => { launchBall(false); launchBall(true); };
      function loop(now) {
        rafId = requestAnimationFrame(loop);
        tickFps(now);
        const dt = 1 / 60;
        for (const b of activeBalls) {
          if (b.y > 0 || b.vy > 0) {
            b.t += dt;
            b.x += b.vx * dt;
            b.vy -= g * dt;
            b.y += b.vy * dt;
            if (b.y <= 0) {
              b.y = 0;
              b.vy = -b.vy * 0.55;
              b.vx *= 0.8;
              if (Math.abs(b.vy) < 1.2) b.vy = 0;
            }
            b.trail.push({ x: b.x, y: b.y });
            if (b.trail.length > 200) b.trail.shift();
          }
          if (is3D && b.mesh) {
            b.mesh.position.set(-20 + b.x, b.y + 0.9, 0);
          }
        }
        if (is3D && renderer) {
          renderer.render(scene, camera);
        } else if (!is3D && ctx2d) {
          ctx2d.fillStyle = '#060a12';
          ctx2d.fillRect(0, 0, canvas2d.width, canvas2d.height);
          const ox = 100;
          const oy = canvas2d.height - 80;
          const scale = 8.5;
          // Ground
          ctx2d.strokeStyle = '#334155';
          ctx2d.lineWidth = 2;
          ctx2d.beginPath();
          ctx2d.moveTo(0, oy);
          ctx2d.lineTo(canvas2d.width, oy);
          ctx2d.stroke();
          // Tower
          ctx2d.fillStyle = '#1e293b';
          ctx2d.fillRect(ox - 12, oy - h0 * scale, 24, h0 * scale);
          for (const b of activeBalls) {
            ctx2d.strokeStyle = b.color;
            ctx2d.lineWidth = 2;
            ctx2d.beginPath();
            b.trail.forEach((pt, idx) => {
              const px = ox + pt.x * scale;
              const py = oy - pt.y * scale;
              if (idx === 0) ctx2d.moveTo(px, py);
              else ctx2d.lineTo(px, py);
            });
            ctx2d.stroke();
            const bx = ox + b.x * scale;
            const by = oy - b.y * scale;
            ctx2d.fillStyle = b.color;
            ctx2d.beginPath();
            ctx2d.arc(bx, by, 8, 0, Math.PI * 2);
            ctx2d.fill();
          }
        }
        const lastBall = activeBalls[activeBalls.length - 1];
        if (lastBall) {
          setTelemetry('飛距離 X / 高さ Y:', `X=${lastBall.x.toFixed(1)} m / Y=${lastBall.y.toFixed(1)} m`);
        }
      }
      setupView();
      return {
        dispose() {
          cancelAnimationFrame(rafId);
          container.innerHTML = '';
        }
      };
    }

const mode = new URLSearchParams(location.search).get('scene') || 'solar';
const available = {solar:mountOrbit3DSolarSystemEngine, domino:mountCannon3DRigidEngine, projectile:mountMechanicsEngine};
for(const a of document.querySelectorAll('[data-original]')) if(a.dataset.original===mode)a.setAttribute('aria-current','page');
try {
  const stage = $('sim-stage');
  const current = (available[mode] ?? available.solar)(stage, {is3D:true,angle:45,velocity:24,height:12});
  stage.dataset.originalReady = mode;
  addEventListener('pagehide',()=>current?.dispose?.(),{once:true});
} catch (e) {
  $('sim-stage').textContent = 'この端末では元のWebGL画面を表示できません。工房の2D表示からも実験できます。';
  $('sim-stage').dataset.originalError = String(e.message);
}

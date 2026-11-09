// カメラの操作(ドラッグで回転・ホイール/2本指で拡大縮小)。WebGL の 3D(three3d.js)と、
// WebGL なしの簡易3D(canvas3d.js)で、同じ操作にするために共有する。
//   const cam = { theta: 0.7, phi: 1.1, dist: 26 };
//   const detach = attachOrbitControls(canvas, cam);
export const CAM_LIMITS = { min: 8, max: 80 };

export function attachOrbitControls(canvas, cam) {
  const pointers = new Map();
  let pinch = 0;
  const onDown = (e) => {
    try { canvas.setPointerCapture?.(e.pointerId); } catch { /* つかめないポインター(合成した操作など)でも、回転はできるようにする */ }
    pointers.set(e.pointerId, [e.clientX, e.clientY]);
  };
  const onMove = (e) => {
    const old = pointers.get(e.pointerId); if (!old) return;
    pointers.set(e.pointerId, [e.clientX, e.clientY]);
    if (pointers.size === 2) {
      const [a, b] = [...pointers.values()], d = Math.hypot(a[0] - b[0], a[1] - b[1]);
      if (pinch) cam.dist = Math.min(CAM_LIMITS.max, Math.max(CAM_LIMITS.min, cam.dist * (pinch / d)));
      pinch = d;
    } else if (pointers.size === 1) {
      cam.theta -= (e.clientX - old[0]) * 0.008;
      cam.phi = Math.min(Math.PI - 0.05, Math.max(0.05, cam.phi - (e.clientY - old[1]) * 0.008));
    }
  };
  const onUp = (e) => { pointers.delete(e.pointerId); pinch = 0; };
  const onWheel = (e) => { e.preventDefault(); cam.dist = Math.min(CAM_LIMITS.max, Math.max(CAM_LIMITS.min, cam.dist * (1 + Math.sign(e.deltaY) * 0.1))); };
  canvas.addEventListener('pointerdown', onDown); canvas.addEventListener('pointermove', onMove);
  canvas.addEventListener('pointerup', onUp); canvas.addEventListener('pointercancel', onUp);
  canvas.addEventListener('wheel', onWheel, { passive: false });
  return () => {
    canvas.removeEventListener('pointerdown', onDown); canvas.removeEventListener('pointermove', onMove);
    canvas.removeEventListener('pointerup', onUp); canvas.removeEventListener('pointercancel', onUp);
    canvas.removeEventListener('wheel', onWheel);
  };
}

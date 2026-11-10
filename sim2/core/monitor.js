// 物理がこわれていないかを見張る(validator の層)。毎フレーム、保存量や解析解からのずれを調べ、
// 許せるはばをこえたら警告を出す。
//   系の validator.js がわたすもの
//     conserved(p) → true なら、エネルギーが保存するはず(まさつ・ていこうがないとき)
//     checks(p) → [{ id, label, tol, measure(engine) → 値 or null, expected(p) → 値 }]
//   系の model.js の energy(y, p) → { K, U, total }(あれば、エネルギーのずれを見る)

/**
 * @returns {{update(): void, warnings: string[], energyDrift: number, results: object[]}}
 */
export function createMonitor(system, engine) {
  const { model, validator = {} } = system;
  const p = engine.p;
  const E0 = model.energy ? model.energy(engine.y, p).total : null;
  const scale = model.energyScale?.(p) ?? Math.max(Math.abs(E0 ?? 0), 1e-9);
  // conservedは衝突などの段階によって変わる。毎回判定する。
  const energyTol = validator.energyTol ?? 1e-3;
  const checks = validator.checks?.(p) ?? [];
  const m = {
    warnings: [], energyDrift: 0, results: [],
    update() {
      const warnings = [];
      if (E0 !== null && (validator.conserved?.(p, engine) ?? false)) {
        const drift = Math.abs(model.energy(engine.y, p).total - E0) / scale;
        m.energyDrift = Math.max(m.energyDrift, drift);
        if (!Number.isFinite(drift) || drift > energyTol) warnings.push(`エネルギーが ${(drift * 100).toFixed(2)}% ずれています(許せるはば ${(energyTol * 100).toFixed(2)}%)`);
      }
      if (engine.y.some((v) => !Number.isFinite(v))) warnings.push('計算の値が数でなくなりました(NaN)');
      m.results = checks.map((c) => {
        const got = c.measure(engine);
        if (got === null || got === undefined || c.expected(p) === null) return { id: c.id, label: c.label, got: null, expected: c.expected(p), rel: null, ok: null };
        const expected = c.expected(p);
        const rel = Math.abs(got - expected) / Math.max(Math.abs(expected), 1e-12);
        const ok = rel <= c.tol;
        if (!ok) warnings.push(`${c.label}が理論値と ${(rel * 100).toFixed(1)}% ちがいます(計った値 ${got.toPrecision(4)} / 理論値 ${expected.toPrecision(4)})`);
        return { id: c.id, label: c.label, got, expected, rel, ok };
      });
      m.warnings = warnings;
    },
  };
  return m;
}

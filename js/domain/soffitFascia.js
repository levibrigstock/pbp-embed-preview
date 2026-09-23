/**
 * What the soffit and fascia actually are, on each run of a building.
 *
 * Before this, soffit and fascia were decided in three places that did not
 * agree. The takeoff billed 2x6 sub-fascia wrapped in SANG 1½x5½ single angle
 * and soffit panels cut to the overhang less ½"; the renderer drew a flat 4.08"
 * band and a thin pan whatever the overhang was; and nothing at all was
 * exposed to the person selling the building. So a 12" framed overhang was
 * quoted as a box eave and drawn as a square one.
 *
 * This module is the single answer. It DERIVES the spec from the building the
 * same way the takeoff always has, then lets explicit overrides replace any
 * part of it — the "inherit unless overridden" shape used elsewhere. With no
 * overrides the derivation must reproduce today's billing exactly, because the
 * 289 PBP matrix assertions are real orders and none of them may move.
 *
 * Dimensions here are not taste. They come from the parts actually on the
 * quote:
 *
 *   - sub-fascia is 2x6 (SKU 26122YP / 26202YP, "2X6 2YP") -> 5.5" of face
 *   - it is wrapped in SANG512, "Single Angle 15X55" -> 1.5" x 5.5" legs
 *   - soffit panel is cut to the overhang less ½" (billed at 1'-2½" on a 15"
 *     overhang), so that is how deep the soffit is
 *
 * The check asserts those against the takeoff rather than restating them, so
 * the drawing cannot drift away from the order again.
 */

/** Soffit venting. A square eave has always been center-vent in the billing. */
export const SOFFIT_VENTS = {
  solid: { id: 'solid', label: 'Solid (no venting)', vented: false },
  vented: { id: 'vented', label: 'Vented (perforated)', vented: true },
  centerVent: { id: 'centerVent', label: 'Center vent strip', vented: true },
};

/** What the soffit is made of. */
export const SOFFIT_MATERIALS = {
  steel29: { id: 'steel29', label: '29ga steel', gauge: '29' },
  steel26: { id: 'steel26', label: '26ga steel', gauge: '26' },
  vinyl: { id: 'vinyl', label: 'Vinyl', gauge: '' },
  wood: { id: 'wood', label: 'Wood', gauge: '' },
};

/** Sub-fascia lumber, by actual dressed depth in inches. */
export const SUB_FASCIA_SIZES = {
  '2x6': { id: '2x6', label: '2x6', depthIn: 5.5 },
  '2x8': { id: '2x8', label: '2x8', depthIn: 7.25 },
  '2x10': { id: '2x10', label: '2x10', depthIn: 9.25 },
};

/**
 * Metal fascia profiles, named by their legs. SANG512 is the one the takeoff
 * bills today; its description "Single Angle 15X55" is 1.5" x 5.5".
 */
export const FASCIA_PROFILES = {
  sang15x55: { id: 'sang15x55', label: 'Single angle 1½ x 5½', faceIn: 5.5, returnIn: 1.5 },
  sang15x725: { id: 'sang15x725', label: 'Single angle 1½ x 7¼', faceIn: 7.25, returnIn: 1.5 },
  none: { id: 'none', label: 'No metal fascia', faceIn: 0, returnIn: 0 },
};

/** The runs a building has soffit and fascia on. */
export const SF_RUNS = ['eave', 'rake', 'lean'];

export const SF_RUN_LABELS = {
  eave: 'Eave (side walls)',
  rake: 'Rake (gable ends)',
  lean: 'Lean-to / attached',
};

function num(v, d = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? n : d;
}

/** Overhang the metal actually projects, in inches. Mirrors the takeoff.
 *  `edge`: 'eave' | 'gable' | 'rake' (rake ≡ gable). Default eave for back-compat.
 */
export function metalOverhangIn(b, edge = 'eave') {
  const e = edge === 'gable' || edge === 'rake' ? 'gable' : 'eave';
  if (e === 'gable') {
    if (b?.metalOverhangGableIn != null && Number.isFinite(Number(b.metalOverhangGableIn))) {
      return Math.max(0, Number(b.metalOverhangGableIn));
    }
  } else if (b?.metalOverhangEaveIn != null && Number.isFinite(Number(b.metalOverhangEaveIn))) {
    return Math.max(0, Number(b.metalOverhangEaveIn));
  }
  const m = num(b?.metalOverhangIn, NaN);
  return Number.isFinite(m) ? Math.max(0, m) : 3;
}

/** Framed (wood) overhang in inches. `edge`: 'eave' | 'gable' | 'rake'. */
export function frameOverhangIn(b, edge = 'eave') {
  const e = edge === 'gable' || edge === 'rake' ? 'gable' : 'eave';
  if (e === 'gable') {
    if (b?.overhangGableIn != null && Number.isFinite(Number(b.overhangGableIn))) {
      return Math.max(0, Number(b.overhangGableIn));
    }
  } else if (b?.overhangEaveIn != null && Number.isFinite(Number(b.overhangEaveIn))) {
    return Math.max(0, Number(b.overhangEaveIn));
  }
  return Math.max(0, num(b?.overhangIn, 0));
}

/** Total projection past the wall, in inches. */
export function totalOverhangIn(b, edge = 'eave') {
  return frameOverhangIn(b, edge) + metalOverhangIn(b, edge);
}

/**
 * Square eave or box eave?
 *
 * Copied from the takeoff's own test (engine.js "--- Soffit ---"): a square
 * eave is a frame overhang under 1" with metal drip no more than 3½". Anything
 * else is a box eave. Stated once here so the two cannot drift.
 */
export function eaveProfileMode(b) {
  return frameOverhangIn(b) < 1 && metalOverhangIn(b) <= 3.5 ? 'square' : 'box';
}

/** Soffit depth in inches: the panel is cut to the overhang less ½".
 *  `edge` selects eave vs gable/rake overhang.
 */
export function soffitDepthIn(b, edge = 'eave') {
  if (edge === 'eave' || edge === undefined) {
    if (eaveProfileMode(b) === 'square') return 11.5; // yard strip
  }
  return Math.max(2, totalOverhangIn(b, edge) - 0.5);
}

/**
 * The derived spec — what the building is, before anyone overrides anything.
 *
 * `subFascia` follows the takeoff's own framing-extras predicate rather than
 * guessing: if the order buys the lumber, the drawing shows it.
 */
export function deriveSoffitFascia(b, opts = {}) {
  const mode = eaveProfileMode(b);
  const square = mode === 'square';
  const hasSubFascia = !!opts.framingExtras;
  const hasMetalFascia = !!opts.trimFascia;

  const soffit = {
    present: true,
    material: 'steel29',
    // A square eave has always been billed center-vent; a box eave solid.
    vent: square ? 'centerVent' : 'solid',
    depthIn: soffitDepthIn(b, 'eave'),
    // Soffit is billed in the WALL colour, not the trim colour — the takeoff
    // has always passed wallColor to the soffit panel lines. The renderer was
    // painting it trim-black, so a white building drew a black soffit and
    // quoted a white one. Named here so both read the same field.
    colorSource: 'wall',
  };
  const fascia = {
    present: hasMetalFascia,
    profile: hasMetalFascia ? 'sang15x55' : 'none',
    subFascia: hasSubFascia ? '2x6' : null,
  };

  const run = (edge = 'eave') => ({
    soffit: { ...soffit, depthIn: soffitDepthIn(b, edge) },
    fascia: { ...fascia },
  });

  return {
    mode,
    totalOverhangIn: totalOverhangIn(b, 'eave'),
    frameOverhangIn: frameOverhangIn(b, 'eave'),
    metalOverhangIn: metalOverhangIn(b, 'eave'),
    totalOverhangGableIn: totalOverhangIn(b, 'gable'),
    frameOverhangGableIn: frameOverhangIn(b, 'gable'),
    metalOverhangGableIn: metalOverhangIn(b, 'gable'),
    eave: run('eave'),
    rake: run('gable'),
    lean: run('eave'),
  };
}

const SOFFIT_KEYS = ['present', 'material', 'vent', 'depthIn', 'colorSource'];
const FASCIA_KEYS = ['present', 'profile', 'subFascia'];

function applyRunOverride(base, over) {
  if (!over || typeof over !== 'object') return base;
  const out = { soffit: { ...base.soffit }, fascia: { ...base.fascia } };
  if (over.soffit && typeof over.soffit === 'object') {
    for (const k of SOFFIT_KEYS) {
      if (over.soffit[k] !== undefined && over.soffit[k] !== null) out.soffit[k] = over.soffit[k];
    }
  }
  if (over.fascia && typeof over.fascia === 'object') {
    for (const k of FASCIA_KEYS) {
      if (over.fascia[k] !== undefined) out.fascia[k] = over.fascia[k];
    }
  }
  return out;
}

/**
 * The spec in force: derived, then overridden where the user has said so.
 *
 * Overrides live on `b.soffitFascia` and are SPARSE — only what was changed.
 * A building with no overrides must resolve identically to deriveSoffitFascia,
 * which is what keeps every existing job and PBP matrix exactly where it is.
 */
export function resolveSoffitFascia(b, opts = {}) {
  const base = deriveSoffitFascia(b, opts);
  const over = b?.soffitFascia;
  if (!over || typeof over !== 'object') return base;

  const out = { ...base };
  // An "all runs" override applies first; a named run then wins over it.
  for (const runName of SF_RUNS) {
    let r = base[runName];
    if (over.all) r = applyRunOverride(r, over.all);
    if (over[runName]) r = applyRunOverride(r, over[runName]);
    out[runName] = r;
  }
  return out;
}

/** True when the building carries any explicit soffit/fascia override. */
export function hasSoffitFasciaOverrides(b) {
  const o = b?.soffitFascia;
  if (!o || typeof o !== 'object') return false;
  return ['all', ...SF_RUNS].some((k) => {
    const r = o[k];
    if (!r || typeof r !== 'object') return false;
    const s = r.soffit && SOFFIT_KEYS.some((x) => r.soffit[x] !== undefined && r.soffit[x] !== null);
    const f = r.fascia && FASCIA_KEYS.some((x) => r.fascia[x] !== undefined);
    return !!(s || f);
  });
}

/** Fascia face height in feet, for drawing. 0 when there is no metal fascia. */
export function fasciaFaceFt(runSpec) {
  if (!runSpec?.fascia?.present) return 0;
  const p = FASCIA_PROFILES[runSpec.fascia.profile] || FASCIA_PROFILES.none;
  return p.faceIn / 12;
}

/** Sub-fascia lumber depth in feet, or 0 when the order does not buy it. */
export function subFasciaDepthFt(runSpec) {
  const id = runSpec?.fascia?.subFascia;
  if (!id) return 0;
  return (SUB_FASCIA_SIZES[id]?.depthIn || 0) / 12;
}

/**
 * How tall the eave assembly reads on the drawing, in feet.
 *
 * The fascia wraps the sub-fascia, so the visible face is the DEEPER of the
 * two, never their sum — stacking them is how you end up with a 12" band on a
 * building that has a 5½" board.
 */
export function eaveAssemblyFaceFt(runSpec) {
  return Math.max(fasciaFaceFt(runSpec), subFasciaDepthFt(runSpec));
}

/** Where a run's soffit takes its colour from: 'wall' | 'trim' | 'roof'. */
export const SOFFIT_COLOR_SOURCES = ['wall', 'trim', 'roof'];

export function soffitColorSource(runSpec) {
  const c = runSpec?.soffit?.colorSource;
  return SOFFIT_COLOR_SOURCES.includes(c) ? c : 'wall';
}

/** Is this run's soffit vented in any form? */
export function runIsVented(runSpec) {
  const v = SOFFIT_VENTS[runSpec?.soffit?.vent];
  return !!(runSpec?.soffit?.present && v?.vented);
}

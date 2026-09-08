/**
 * PoleBarn Pro — PUBLIC configurator contract.
 *
 * This module is the single source of truth for the JSON that a customer-facing
 * website embed is allowed to produce and send back to the company.
 *
 * HARD RULE: nothing in here describes price, SKUs, material/takeoff lines,
 * framing, plan sheets, or any internal quoting/CRM field. A public config
 * carries only what a customer may see and control in a viewer:
 *
 *   - Building envelope (width, length, eave height, pitch, roof style)
 *   - Colors (wall, roof, trim, wainscot)
 *   - Lean-tos (wall, depth, length, offset, enclosed, pitch, eave height)
 *   - Metal gauge (26 / 29)
 *   - Openings (windows, walk doors, overhead/garage doors) on a main wall
 *     (`host: 'main'`) or on an enclosed lean-to wall (`host: <leanTo id>` +
 *     `face: outer | leftEnd | rightEnd`)
 *   - Concrete slab (yes/no + thickness in inches)
 *   - companyId (multi-tenant embed routing — a plain public identifier)
 *
 * Everything else is intentionally absent. `stripSecretsFromConfig()` exists so
 * that if an internal building object is ever handed to public code by mistake,
 * we still only emit the safe subset.
 *
 * No imports on purpose: this file must stay usable in a bare browser embed and
 * in Node (future lead-intake validation) without pulling the 3D engine or the
 * estimator.
 */

/* ─────────────────────────── Allowed value sets ─────────────────────────── */

export const PUBLIC_SCHEMA_VERSION = 1;

/** Walls a customer can attach things to / place openings on. */
export const PUBLIC_WALLS = ['front', 'back', 'left', 'right'];

export const PUBLIC_WALL_LABELS = {
  front: 'Front (gable end)',
  back: 'Back (gable end)',
  left: 'Left (side wall)',
  right: 'Right (side wall)',
};

export const PUBLIC_ROOF_STYLES = ['gable', 'mono'];

/**
 * Color codes shared with the viewer (js/render/scene.js COLOR_HEX). The public
 * UI shows the label + a swatch; only the code travels in the payload.
 */
export const PUBLIC_COLORS = {
  // Tuned for phone/embed contrast (true white vs warm Alamo; punchier hues).
  BK: { label: 'Matte Black', hex: '#121212' },
  AL: { label: 'Alamo White', hex: '#f7ecd8' },
  GAL: { label: 'Galvalume', hex: '#c8d0d8' },
  WH: { label: 'Bright White', hex: '#ffffff' },
  BR: { label: 'Brown', hex: '#6b3f24' },
  TN: { label: 'Tan', hex: '#d4b896' },
  GR: { label: 'Evergreen', hex: '#1f6b38' },
  RD: { label: 'Crimson Red', hex: '#b01e1e' },
  BU: { label: 'Burgundy', hex: '#7a1838' },
  SL: { label: 'Charcoal / Slate', hex: '#4a5160' },
  LB: { label: 'Light Blue', hex: '#4f8fc4' },
  CG: { label: 'Clay / Claystone', hex: '#b08455' },
};

export const PUBLIC_COLOR_CODES = Object.keys(PUBLIC_COLORS);

/** 'NONE' = no wainscot band. */
export const PUBLIC_WAINSCOT_CODES = ['NONE', ...PUBLIC_COLOR_CODES];

export const PUBLIC_GAUGES = ['29', '26'];

export const PUBLIC_OPENING_TYPES = {
  window: { label: 'Window', defaultW: 3, defaultH: 4, defaultSill: 3 },
  walk: { label: 'Walk door', defaultW: 3, defaultH: 7, defaultSill: 0 },
  overhead: { label: 'Garage / overhead door', defaultW: 10, defaultH: 10, defaultSill: 0 },
};

export const PUBLIC_OPENING_TYPE_KEYS = Object.keys(PUBLIC_OPENING_TYPES);

/**
 * Lean-to wall faces a customer can place an opening on. Matches the internal
 * `opening.face` values (js/domain/types.js) exactly — the viewer already emits
 * these from taps on an enclosed lean-to. Main-wall openings use `host: 'main'`
 * and carry no `face`.
 */
export const PUBLIC_OPENING_FACES = ['outer', 'leftEnd', 'rightEnd'];

export const PUBLIC_OPENING_FACE_LABELS = {
  outer: 'Outer wall',
  leftEnd: 'Left end wall',
  rightEnd: 'Right end wall',
};

/* ───────────────────────────── Numeric limits ──────────────────────────────
 * Bounds are for sanity + keeping the viewer stable, not engineering approval.
 * validatePublicConfig() clamps into range and records a warning.
 */
export const PUBLIC_LIMITS = {
  building: {
    width: { min: 12, max: 100 },
    length: { min: 12, max: 300 },
    eaveHeight: { min: 8, max: 20 },
    pitch: { min: 1, max: 12 }, // rise per 12" run
  },
  leanTo: {
    depth: { min: 4, max: 40 },
    length: { min: 0, max: 300 }, // 0 = full wall
    offset: { min: 0, max: 300 },
    pitch: { min: 0.5, max: 12 },
    eaveHeight: { min: 6, max: 20 },
    maxCount: 8,
  },
  opening: {
    width: { min: 1, max: 24 },
    height: { min: 1, max: 16 },
    offset: { min: 0, max: 300 },
    sillHeight: { min: 0, max: 18 },
    maxCount: 60,
  },
  concrete: {
    thicknessIn: { min: 3, max: 8 },
  },
};

/* ─────────────────────────────── Defaults ──────────────────────────────── */

export function defaultPublicConfig(companyId = 'demo') {
  return {
    schemaVersion: PUBLIC_SCHEMA_VERSION,
    /** Public multi-tenant identifier — NOT a secret, NOT an auth token. */
    companyId: sanitizeCompanyId(companyId),
    building: {
      width: 30,
      length: 40,
      eaveHeight: 12,
      pitch: 4,
      roofStyle: 'gable',
    },
    colors: {
      wall: 'AL',
      roof: 'BK',
      trim: 'BK',
      wainscot: 'NONE',
      wainscotHeightFt: 3,
    },
    metalGauge: '29',
    leanTos: [],
    openings: [],
    concrete: {
      enabled: false,
      thicknessIn: 4,
    },
  };
}

export function defaultPublicLeanTo(partial = {}) {
  return {
    id: partial.id || uid('lt'),
    wall: pickEnum(partial.wall, PUBLIC_WALLS, 'left'),
    depth: clampNum(partial.depth, PUBLIC_LIMITS.leanTo.depth, 12),
    length: clampNum(partial.length, PUBLIC_LIMITS.leanTo.length, 0),
    offset: clampNum(partial.offset, PUBLIC_LIMITS.leanTo.offset, 0),
    enclosed: partial.enclosed !== false,
    pitch: clampNum(partial.pitch, PUBLIC_LIMITS.leanTo.pitch, 3),
    /** '' / null = let the viewer derive it from the mono drop. */
    eaveHeight:
      partial.eaveHeight == null || partial.eaveHeight === ''
        ? null
        : clampNum(partial.eaveHeight, PUBLIC_LIMITS.leanTo.eaveHeight, 10),
  };
}

export function defaultPublicOpening(partial = {}) {
  const type = pickEnum(partial.type, PUBLIC_OPENING_TYPE_KEYS, 'window');
  const def = PUBLIC_OPENING_TYPES[type];
  const host = sanitizeOpeningHost(partial.host);
  const op = {
    id: partial.id || uid('op'),
    type,
    /**
     * Host surface: 'main' = one of the four main walls (use `wall`); any other
     * value is a lean-to id (see leanTos[].id) and the opening also carries a
     * `face`. Whichever it is, `wall` still records the main wall the surface
     * belongs to so the form/list can label it.
     */
    host,
    wall: pickEnum(partial.wall, PUBLIC_WALLS, 'front'),
    width: clampNum(partial.width, PUBLIC_LIMITS.opening.width, def.defaultW),
    height: clampNum(partial.height, PUBLIC_LIMITS.opening.height, def.defaultH),
    /** Feet from the left end of the wall, viewed from outside. */
    offset: clampNum(partial.offset, PUBLIC_LIMITS.opening.offset, 0),
    sillHeight: clampNum(partial.sillHeight, PUBLIC_LIMITS.opening.sillHeight, def.defaultSill),
  };
  // `face` is only meaningful for a lean-to host.
  if (host !== 'main') {
    op.face = pickEnum(partial.face, PUBLIC_OPENING_FACES, 'outer');
  }
  return op;
}

/* ────────────────────────────── Validation ─────────────────────────────── */

/**
 * Normalize + range-check an incoming public config.
 *
 * Always returns a complete, safe config (never throws). Out-of-range values are
 * clamped; unknown enums fall back to the default. Callers that care about data
 * quality read `warnings`.
 *
 * @param {any} input
 * @returns {{ ok: boolean, config: object, warnings: string[] }}
 */
export function validatePublicConfig(input) {
  const warnings = [];
  const src = isObject(input) ? input : {};
  const out = defaultPublicConfig(src.companyId);

  if (!isObject(input)) {
    warnings.push('Config was not an object; using defaults.');
    return { ok: false, config: out, warnings };
  }

  // ── building ──
  const b = isObject(src.building) ? src.building : {};
  out.building.width = clampWarn(b.width, PUBLIC_LIMITS.building.width, out.building.width, 'building.width', warnings);
  out.building.length = clampWarn(b.length, PUBLIC_LIMITS.building.length, out.building.length, 'building.length', warnings);
  out.building.eaveHeight = clampWarn(b.eaveHeight, PUBLIC_LIMITS.building.eaveHeight, out.building.eaveHeight, 'building.eaveHeight', warnings);
  out.building.pitch = clampWarn(b.pitch, PUBLIC_LIMITS.building.pitch, out.building.pitch, 'building.pitch', warnings);
  out.building.roofStyle = pickEnumWarn(b.roofStyle, PUBLIC_ROOF_STYLES, out.building.roofStyle, 'building.roofStyle', warnings);

  // ── colors ──
  const c = isObject(src.colors) ? src.colors : {};
  out.colors.wall = pickEnumWarn(c.wall, PUBLIC_COLOR_CODES, out.colors.wall, 'colors.wall', warnings);
  out.colors.roof = pickEnumWarn(c.roof, PUBLIC_COLOR_CODES, out.colors.roof, 'colors.roof', warnings);
  out.colors.trim = pickEnumWarn(c.trim, PUBLIC_COLOR_CODES, out.colors.trim, 'colors.trim', warnings);
  out.colors.wainscot = pickEnumWarn(c.wainscot, PUBLIC_WAINSCOT_CODES, out.colors.wainscot, 'colors.wainscot', warnings);
  // min 0: height 0 = no wainscot band in 3D even if a color is selected
  out.colors.wainscotHeightFt = clampWarn(c.wainscotHeightFt, { min: 0, max: 6 }, out.colors.wainscotHeightFt, 'colors.wainscotHeightFt', warnings);

  // ── metal gauge ──
  out.metalGauge = pickEnumWarn(
    normalizeGauge(src.metalGauge),
    PUBLIC_GAUGES,
    out.metalGauge,
    'metalGauge',
    warnings,
  );

  // ── lean-tos ──
  const leans = Array.isArray(src.leanTos) ? src.leanTos : [];
  if (leans.length > PUBLIC_LIMITS.leanTo.maxCount) {
    warnings.push(`Too many lean-tos (${leans.length}); kept first ${PUBLIC_LIMITS.leanTo.maxCount}.`);
  }
  out.leanTos = leans.slice(0, PUBLIC_LIMITS.leanTo.maxCount).map((lt) => defaultPublicLeanTo(isObject(lt) ? lt : {}));

  // ── openings ──
  // Validated AFTER lean-tos so a lean-to host can be checked for existence +
  // enclosure and the face clamped to a real value.
  const leanById = new Map(out.leanTos.map((lt) => [lt.id, lt]));
  const ops = Array.isArray(src.openings) ? src.openings : [];
  if (ops.length > PUBLIC_LIMITS.opening.maxCount) {
    warnings.push(`Too many openings (${ops.length}); kept first ${PUBLIC_LIMITS.opening.maxCount}.`);
  }
  out.openings = ops.slice(0, PUBLIC_LIMITS.opening.maxCount).map((op) => {
    const shaped = defaultPublicOpening(isObject(op) ? op : {});
    if (shaped.host !== 'main') {
      const lean = leanById.get(shaped.host);
      if (!lean) {
        warnings.push(`opening ${shaped.id}: lean-to "${shaped.host}" not found; moved to the ${shaped.wall} wall.`);
        return demoteOpeningToMain(shaped);
      }
      if (lean.enclosed === false) {
        warnings.push(`opening ${shaped.id}: that lean-to is open (no walls); moved to the ${shaped.wall} wall.`);
        return demoteOpeningToMain(shaped);
      }
    }
    // Keep opening top under eave/roof trim (~0.45' clearance for eave band)
    const eaveFt =
      shaped.host !== 'main' && leanById.get(shaped.host)?.eaveHeight != null
        ? Number(leanById.get(shaped.host).eaveHeight)
        : Number(out.building.eaveHeight) || 12;
    const maxTop = eaveFt - 0.45;
    const sill = Number(shaped.sillHeight) || 0;
    const top = sill + (Number(shaped.height) || 0);
    if (top > maxTop) {
      const nextH = Math.max(0.5, maxTop - sill);
      warnings.push(
        `opening ${shaped.id}: height clamped ${shaped.height}' → ${nextH}' so it stays under the eave trim.`,
      );
      shaped.height = nextH;
    }
    return shaped;
  });

  // ── concrete ──
  const con = isObject(src.concrete) ? src.concrete : {};
  out.concrete.enabled = con.enabled === true;
  out.concrete.thicknessIn = clampWarn(con.thicknessIn, PUBLIC_LIMITS.concrete.thicknessIn, out.concrete.thicknessIn, 'concrete.thicknessIn', warnings);

  return { ok: warnings.length === 0, config: out, warnings };
}

/**
 * Reduce ANY config-ish object (including an internal building/project) down to
 * the public contract. Defence in depth: even if internal data leaks into public
 * code, only safe fields survive.
 *
 * Accepts either a public-shaped object or a loose object that has
 * `width/length/eaveHeight/...` at the top level (an internal building).
 */
export function stripSecretsFromConfig(anyConfig) {
  const src = isObject(anyConfig) ? anyConfig : {};

  // If it looks like an internal building (flat fields), lift them into shape.
  const looksInternalBuilding =
    src.building == null && (src.width != null || src.eaveHeight != null);

  const shaped = looksInternalBuilding
    ? {
        companyId: src.companyId,
        building: {
          width: src.width,
          length: src.length,
          eaveHeight: src.eaveHeight,
          pitch: src.pitch,
          roofStyle: src.roofStyle,
        },
        colors: {
          wall: src.wallColor,
          roof: src.roofColor,
          trim: src.trimColor,
          wainscot: src.wainscotColor,
          wainscotHeightFt: src.wainscotHeightFt,
        },
        metalGauge: src.wallGauge ?? src.roofGauge,
        leanTos: (src.leanTos || []).map((lt) => ({
          id: lt.id,
          wall: lt.wall,
          depth: lt.depth,
          length: lt.length,
          offset: lt.offset,
          enclosed: lt.enclosed,
          pitch: lt.pitch,
          eaveHeight: lt.eaveHeight,
        })),
        openings: (src.openings || [])
          // main-wall openings, plus openings on an enclosed lean-to that exists
          .filter((op) => {
            if (!op.host || op.host === 'main') return true;
            const lean = (src.leanTos || []).find((lt) => lt.id === op.host);
            return !!lean && lean.enclosed !== false;
          })
          .map((op) => {
            const base = {
              id: op.id,
              type: op.type,
              wall: op.wall,
              width: op.width,
              height: op.height,
              offset: op.offset,
              sillHeight: op.sillHeight,
              host: op.host && op.host !== 'main' ? op.host : 'main',
            };
            if (base.host !== 'main') base.face = op.face || 'outer';
            return base;
          }),
        concrete: {
          enabled: src.hasSlab === true,
          thicknessIn: src.slabThicknessIn,
        },
      }
    : src;

  // Run through the validator so the result is always in-contract and in-range.
  return validatePublicConfig(shaped).config;
}

/* ──────────────────── Mapping: public config → viewer ──────────────────── */

/**
 * Convert a validated public config into a partial suitable for
 * `createBuilding()` in js/domain/types.js. Pure — no imports; embedApp.js is
 * responsible for calling createProject/createBuilding.
 *
 * Only viewer-relevant fields are set. Everything the estimator would need
 * (post sizes, spacing, insulation, freight, labor…) is deliberately left to
 * type defaults because the public UI never touches it.
 */
export function publicConfigToBuildingPartial(publicConfig) {
  const cfg = validatePublicConfig(publicConfig).config;
  const wainscot = cfg.colors.wainscot && cfg.colors.wainscot !== 'NONE' ? cfg.colors.wainscot : 'NONE';

  return {
    name: 'Your Building',
    width: cfg.building.width,
    length: cfg.building.length,
    eaveHeight: cfg.building.eaveHeight,
    pitch: cfg.building.pitch,
    roofStyle: cfg.building.roofStyle,

    wallColor: cfg.colors.wall,
    roofColor: cfg.colors.roof,
    trimColor: cfg.colors.trim,
    wainscotColor: wainscot,
    wainscotHeightFt: cfg.colors.wainscotHeightFt,

    wallGauge: cfg.metalGauge,
    roofGauge: cfg.metalGauge,

    hasSlab: cfg.concrete.enabled,
    slabThicknessIn: cfg.concrete.thicknessIn,

    leanTos: cfg.leanTos.map((lt) => ({
      // Keep the public id so an opening's `host` maps to the same lean-to once
      // createBuilding() runs (createLeanTo honours a provided id).
      id: lt.id,
      wall: lt.wall,
      depth: lt.depth,
      length: lt.length,
      offset: lt.offset,
      enclosed: lt.enclosed,
      pitch: lt.pitch,
      ...(lt.eaveHeight != null ? { eaveHeight: lt.eaveHeight } : {}),
    })),

    openings: cfg.openings.map((op) => {
      // Keep the public id so the viewer's drag/select events map back to the
      // exact entry in publicConfig.openings (the id is already part of the
      // public contract and the lead payload).
      const mapped = {
        id: op.id,
        type: op.type,
        wall: op.wall,
        width: op.width,
        height: op.height,
        offset: op.offset,
        sillHeight: op.sillHeight,
        host: op.host || 'main',
      };
      // Lean-to openings carry a face; validatePublicConfig has already checked
      // the host lean-to exists and is enclosed.
      if (mapped.host !== 'main') mapped.face = op.face || 'outer';
      return mapped;
    }),
  };
}

/* ──────────────────────────────── helpers ──────────────────────────────── */

export function sanitizeCompanyId(id) {
  const s = String(id == null ? '' : id).trim().toLowerCase();
  const cleaned = s.replace(/[^a-z0-9_-]/g, '').slice(0, 64);
  return cleaned || 'demo';
}

/**
 * A public opening host is either 'main' or a lean-to id (same id space as
 * leanTos[].id — see `uid('lt')`). Anything unusable falls back to 'main'.
 */
function sanitizeOpeningHost(host) {
  if (host == null || host === '' || host === 'main') return 'main';
  const cleaned = String(host).replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 40);
  return cleaned || 'main';
}

/** Move a lean-to opening back onto its main wall (drops the `face`). */
function demoteOpeningToMain(op) {
  const { face, ...rest } = op;
  return { ...rest, host: 'main' };
}

function normalizeGauge(g) {
  if (g == null) return null;
  const s = String(g).replace(/[^0-9]/g, '');
  return s || null;
}

function uid(prefix = 'id') {
  return `${prefix}_${Math.random().toString(36).slice(2, 9)}`;
}

function isObject(v) {
  return v != null && typeof v === 'object' && !Array.isArray(v);
}

function toNum(v) {
  const n = typeof v === 'string' ? parseFloat(v) : v;
  return Number.isFinite(n) ? n : null;
}

function clampNum(v, range, fallback) {
  const n = toNum(v);
  if (n == null) return fallback;
  return Math.min(range.max, Math.max(range.min, n));
}

function clampWarn(v, range, fallback, path, warnings) {
  const n = toNum(v);
  if (n == null) return fallback;
  if (n < range.min || n > range.max) {
    const clamped = Math.min(range.max, Math.max(range.min, n));
    warnings.push(`${path} ${n} out of range [${range.min}, ${range.max}]; clamped to ${clamped}.`);
    return clamped;
  }
  return n;
}

function pickEnum(v, allowed, fallback) {
  return allowed.includes(v) ? v : fallback;
}

function pickEnumWarn(v, allowed, fallback, path, warnings) {
  if (v == null || v === '') return fallback;
  if (allowed.includes(v)) return v;
  warnings.push(`${path} "${v}" not allowed; using "${fallback}".`);
  return fallback;
}

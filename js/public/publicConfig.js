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
 *   - Openings (windows, walk doors, overhead/garage doors)
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
  BK: { label: 'Matte Black', hex: '#1a1a1a' },
  AL: { label: 'Alamo White', hex: '#e8e4dc' },
  GAL: { label: 'Galvalume', hex: '#b8c0c8' },
  WH: { label: 'Bright White', hex: '#f5f5f0' },
  BR: { label: 'Brown', hex: '#5c4030' },
  TN: { label: 'Tan', hex: '#c4a882' },
  GR: { label: 'Evergreen', hex: '#2d5a3d' },
  RD: { label: 'Crimson Red', hex: '#8b1e1e' },
  BU: { label: 'Burgundy', hex: '#5c1a2e' },
  SL: { label: 'Charcoal / Slate', hex: '#3a3d42' },
  LB: { label: 'Light Blue', hex: '#6a8fad' },
  CG: { label: 'Clay / Claystone', hex: '#9a7b5a' },
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
  return {
    id: partial.id || uid('op'),
    type,
    wall: pickEnum(partial.wall, PUBLIC_WALLS, 'front'),
    width: clampNum(partial.width, PUBLIC_LIMITS.opening.width, def.defaultW),
    height: clampNum(partial.height, PUBLIC_LIMITS.opening.height, def.defaultH),
    /** Feet from the left end of the wall, viewed from outside. */
    offset: clampNum(partial.offset, PUBLIC_LIMITS.opening.offset, 0),
    sillHeight: clampNum(partial.sillHeight, PUBLIC_LIMITS.opening.sillHeight, def.defaultSill),
  };
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
  out.colors.wainscotHeightFt = clampWarn(c.wainscotHeightFt, { min: 1, max: 6 }, out.colors.wainscotHeightFt, 'colors.wainscotHeightFt', warnings);

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
  const ops = Array.isArray(src.openings) ? src.openings : [];
  if (ops.length > PUBLIC_LIMITS.opening.maxCount) {
    warnings.push(`Too many openings (${ops.length}); kept first ${PUBLIC_LIMITS.opening.maxCount}.`);
  }
  out.openings = ops.slice(0, PUBLIC_LIMITS.opening.maxCount).map((op) => defaultPublicOpening(isObject(op) ? op : {}));

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
          // only main-wall openings are exposed publicly
          .filter((op) => !op.host || op.host === 'main')
          .map((op) => ({
            id: op.id,
            type: op.type,
            wall: op.wall,
            width: op.width,
            height: op.height,
            offset: op.offset,
            sillHeight: op.sillHeight,
          })),
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
      wall: lt.wall,
      depth: lt.depth,
      length: lt.length,
      offset: lt.offset,
      enclosed: lt.enclosed,
      pitch: lt.pitch,
      ...(lt.eaveHeight != null ? { eaveHeight: lt.eaveHeight } : {}),
    })),

    openings: cfg.openings.map((op) => ({
      // Keep the public id so the viewer's drag/select events map back to the
      // exact entry in publicConfig.openings (the id is already part of the
      // public contract and the lead payload).
      id: op.id,
      type: op.type,
      wall: op.wall,
      width: op.width,
      height: op.height,
      offset: op.offset,
      sillHeight: op.sillHeight,
      host: 'main',
    })),
  };
}

/* ──────────────────────────────── helpers ──────────────────────────────── */

export function sanitizeCompanyId(id) {
  const s = String(id == null ? '' : id).trim().toLowerCase();
  const cleaned = s.replace(/[^a-z0-9_-]/g, '').slice(0, 64);
  return cleaned || 'demo';
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

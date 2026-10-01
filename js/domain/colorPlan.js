/**
 * Which colour every piece of the building is, and where that colour came from.
 *
 * The building used to carry four flat fields — wallColor, roofColor,
 * trimColor, wainscotColor — and every one of the fifteen or so trim pieces
 * took `trimColor`. That is fine until someone wants the gable edge in the
 * wall colour and the corners black, which is an ordinary request and was
 * impossible to express.
 *
 * So: five named SLOTS, the ones a customer actually picks from —
 *
 *     roof · trim · walls · garageDoor · accent1
 *
 * and a registry of PARTS, each pointing at the slot it takes its colour from
 * by default. A part can be repointed at a different slot, or pinned to an
 * explicit colour code, one piece at a time. Inherit unless overridden.
 *
 * The one rule that governs everything here: a building with no colour plan
 * must resolve to exactly the colours it resolved to before this module
 * existed. The slots fall back to the legacy fields rather than replacing
 * them, so an old job — and all 289 PBP shop orders — price unchanged.
 * color-plan-check asserts that line for line against the takeoff.
 */

/**
 * The colour palette, as the selectors already offer it.
 *
 * Taken from the existing Colors accordion so the codes here are the codes the
 * catalog already prices — this is a label lookup, not a new palette.
 */
export const COLOR_CODES = {
  BK: 'Matte Black',
  AL: 'Alamo White',
  WH: 'White',
  OTG: 'Ash Gray (OTG)',
  GAL: 'Galvanized',
  BR: 'Brown',
  TN: 'Tan',
  GR: 'Evergreen',
  RD: 'Crimson Red',
  BU: 'Burgundy',
  SL: 'Charcoal / Slate',
  LB: 'Light Blue',
  CG: 'Clay / Claystone',
  TP: 'Taupe',
  CN: 'Colony Green',
  LS: 'Lt Stone',
  BS: 'Burnished Slate',
};

/** A human label for a colour code, falling back to the code itself. */
export function colorLabel(code) {
  const c = String(code || '').toUpperCase();
  return COLOR_CODES[c] || (code ? String(code) : '');
}

/** The five slots a customer picks. Order is the order they are shown. */
export const COLOR_SLOTS = ['roof', 'trim', 'walls', 'garageDoor', 'accent1'];

export const COLOR_SLOT_LABELS = {
  roof: 'Roof',
  trim: 'Trim',
  walls: 'Walls',
  garageDoor: 'Garage Door',
  accent1: 'Accent 1',
};

/**
 * Which legacy field each slot falls back to when the plan does not set it.
 *
 * garageDoor and accent1 have no legacy field: unset means "leave it alone",
 * which for a garage door means the per-opening colour it already carries.
 * Inventing a default for them would repaint every existing job.
 */
const SLOT_LEGACY_FIELD = {
  roof: 'roofColor',
  trim: 'trimColor',
  walls: 'wallColor',
  garageDoor: null,
  accent1: null,
};

const SLOT_LEGACY_DEFAULT = {
  roof: 'BK',
  trim: 'BK',
  walls: 'AL',
};

/**
 * Every colourable piece, and the slot it follows by default.
 *
 * The default slot is not a design opinion — it is what the code already did.
 * Each entry names the takeoff `usage` it bills under so the check can read
 * the colour back off the order rather than trusting this table.
 */
export const COLOR_PARTS = {
  roofPanel: { id: 'roofPanel', label: 'Roof panels', slot: 'roof', usage: 'ExteriorRoof', group: 'Panels' },
  wallPanel: { id: 'wallPanel', label: 'Wall panels', slot: 'walls', usage: 'ExteriorWall', group: 'Panels' },
  soffit: { id: 'soffit', label: 'Soffit', slot: 'walls', usage: 'Soffit', group: 'Panels' },

  ridgeCap: { id: 'ridgeCap', label: 'Ridge cap', slot: 'trim', usage: 'RidgeCap', group: 'Roof trim' },
  eaveEdge: { id: 'eaveEdge', label: 'Eave edge / drip', slot: 'trim', usage: 'EaveEdge', group: 'Roof trim' },
  gableEdge: { id: 'gableEdge', label: 'Gable / rake edge', slot: 'trim', usage: 'GableEdge', group: 'Roof trim' },
  eaveFascia: { id: 'eaveFascia', label: 'Eave fascia', slot: 'trim', usage: 'EaveFascia', group: 'Roof trim' },
  gableFascia: { id: 'gableFascia', label: 'Gable fascia', slot: 'trim', usage: 'GableFascia', group: 'Roof trim' },
  valleyTrim: { id: 'valleyTrim', label: 'Valley trim', slot: 'trim', usage: 'ValleyTrim', group: 'Roof trim' },

  corner: { id: 'corner', label: 'Outside corners', slot: 'trim', usage: 'Corner', group: 'Wall trim' },
  insideCorner: { id: 'insideCorner', label: 'Inside corners', slot: 'trim', usage: 'InsideCorner', group: 'Wall trim' },
  topOfWall: { id: 'topOfWall', label: 'Top of wall', slot: 'trim', usage: 'TopOfWall', group: 'Wall trim' },
  base: { id: 'base', label: 'Base / rat guard', slot: 'trim', usage: 'Base', group: 'Wall trim' },
  jTrim: { id: 'jTrim', label: 'J-trim', slot: 'trim', usage: 'JTrim', group: 'Wall trim' },
  wainscotTrim: { id: 'wainscotTrim', label: 'Wainscot trim', slot: 'trim', usage: 'WainscotTrim', group: 'Wall trim' },

  ohdTrim: { id: 'ohdTrim', label: 'Overhead door trim', slot: 'trim', usage: 'OHDTrim', group: 'Openings' },
  overheadDoor: { id: 'overheadDoor', label: 'Overhead doors', slot: 'garageDoor', usage: '', group: 'Openings' },
};

export const COLOR_PART_IDS = Object.keys(COLOR_PARTS);

/** Parts grouped for display, in registry order. */
export function colorPartGroups() {
  const out = [];
  for (const id of COLOR_PART_IDS) {
    const p = COLOR_PARTS[id];
    let g = out.find((x) => x.group === p.group);
    if (!g) out.push((g = { group: p.group, parts: [] }));
    g.parts.push(p);
  }
  return out;
}

function str(v) {
  const s = String(v ?? '').trim();
  return s || null;
}

/**
 * The colour in each slot, falling back to the legacy field.
 *
 * Returns null for a slot with nothing behind it (garageDoor, accent1) so a
 * caller can tell "not chosen" from "chosen and happens to be black".
 */
export function resolveSlots(b) {
  const plan = b?.colorPlan;
  const out = {};
  for (const slot of COLOR_SLOTS) {
    const explicit = str(plan?.slots?.[slot]);
    if (explicit) {
      out[slot] = explicit;
      continue;
    }
    const field = SLOT_LEGACY_FIELD[slot];
    out[slot] = field ? str(b?.[field]) || SLOT_LEGACY_DEFAULT[slot] || null : null;
  }
  return out;
}

/**
 * What colour one part is, and why.
 *
 * @returns {{ code: string|null, source: 'part'|'slot'|'legacy', slot: string|null }}
 *   `source` is what the UI shows so nobody has to guess whether a piece is
 *   inheriting or pinned.
 */
export function resolvePart(b, partId) {
  const part = COLOR_PARTS[partId];
  if (!part) return { code: null, source: 'legacy', slot: null };
  const over = b?.colorPlan?.parts?.[partId];
  const slots = resolveSlots(b);

  // Pinned to an explicit colour.
  const pinned = str(over?.code);
  if (pinned) return { code: pinned, source: 'part', slot: null };

  // Repointed at a different slot.
  const named = str(over?.slot);
  if (named && COLOR_SLOTS.includes(named)) {
    const c = slots[named];
    // A repoint at an EMPTY slot is not a colour. Falling through to the
    // default slot would silently ignore the user's choice; returning null
    // lets the caller keep what it had and the UI say the slot is unset.
    return { code: c, source: 'slot', slot: named };
  }

  const c = slots[part.slot];
  return { code: c, source: c ? 'slot' : 'legacy', slot: part.slot };
}

/**
 * Just the colour code for a part, or `fallback` when the plan has nothing.
 *
 * This is what call sites use: `partColor(b, 'gableEdge', trimColor)` reads as
 * "the gable edge colour, or the old behaviour if nobody has said otherwise".
 */
export function partColor(b, partId, fallback = null) {
  const r = resolvePart(b, partId);
  return r.code || fallback;
}

/** True when this building carries any explicit colour choice. */
export function hasColorPlan(b) {
  const plan = b?.colorPlan;
  if (!plan || typeof plan !== 'object') return false;
  const slotSet = COLOR_SLOTS.some((s) => str(plan.slots?.[s]));
  const partSet = COLOR_PART_IDS.some((p) => {
    const o = plan.parts?.[p];
    return !!(o && (str(o.code) || str(o.slot)));
  });
  return slotSet || partSet;
}

/** Parts that are not simply following their default slot. */
export function overriddenParts(b) {
  return COLOR_PART_IDS.filter((id) => {
    const o = b?.colorPlan?.parts?.[id];
    return !!(o && (str(o.code) || str(o.slot)));
  });
}

/**
 * Keep a stored plan to the shape above.
 *
 * Sparse on purpose: an absent key means "inherit", so nothing is filled in.
 * Unknown parts and slots are dropped rather than carried forever in saved
 * jobs, and a part entry that names neither a code nor a slot is removed so
 * hasColorPlan cannot report an override that does nothing.
 */
export function normalizeColorPlan(raw) {
  if (!raw || typeof raw !== 'object') return undefined;
  const out = {};
  const slots = {};
  for (const s of COLOR_SLOTS) {
    const v = str(raw.slots?.[s]);
    if (v) slots[s] = v;
  }
  if (Object.keys(slots).length) out.slots = slots;

  const parts = {};
  for (const id of COLOR_PART_IDS) {
    const o = raw.parts?.[id];
    if (!o || typeof o !== 'object') continue;
    const code = str(o.code);
    const slot = str(o.slot);
    const kept = {};
    if (code) kept.code = code;
    else if (slot && COLOR_SLOTS.includes(slot)) kept.slot = slot;
    if (Object.keys(kept).length) parts[id] = kept;
  }
  if (Object.keys(parts).length) out.parts = parts;

  return Object.keys(out).length ? out : undefined;
}

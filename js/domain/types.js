/**
 * Post-frame domain primitives.
 * Dimensions are feet unless noted. Pitch is rise per 12" run.
 */

export const WALLS = ['front', 'back', 'left', 'right'];

/** Human labels for main-building walls */
export const WALL_LABELS = {
 front: 'Front (gable)',
 back: 'Back (gable)',
 left: 'Left (eave)',
 right: 'Right (eave)',
};

/** True if wall is a gable end (front/back on rectangular plan). */
export function isGableWall(wall) {
 return wall === 'front' || wall === 'back';
}

/** True if wall is an eave sidewall (left/right). */
export function isEaveWall(wall) {
 return wall === 'left' || wall === 'right';
}

/**
 * Normalize open-wall list from building data.
 *
 * Explicit `openWalls` array always wins (including empty []).
 * Legacy only: if openWalls is missing entirely and sidewallMetal === false,
 * treat both eave walls as open.
 *
 * @returns {string[]} subset of WALLS
 */
export function openWallList(b) {
 if (!b) return [];
 // Explicit array (even empty) is the source of truth — never re-add from sidewallMetal
 if (Array.isArray(b.openWalls)) {
 return WALLS.filter((w) => b.openWalls.includes(w));
 }
 // Legacy jobs without openWalls field
 if (b.sidewallMetal === false) return ['left', 'right'];
 return [];
}

/** True if this main wall is fully open (drive-through): no metal / girts / intermediate posts. */
export function isWallOpen(b, wall) {
 if (!wall || !WALLS.includes(wall)) return false;
 return openWallList(b).includes(wall);
}

/** Walls that still receive metal + girts + intermediate posts. */
export function closedWallList(b) {
 return WALLS.filter((w) => !isWallOpen(b, w));
}

/**
 * Toggle a main wall open/closed for drive-through.
 * Returns a new openWalls array (does not mutate b).
 */
export function toggleOpenWall(b, wall) {
 if (!WALLS.includes(wall)) return openWallList(b);
 const set = new Set(openWallList(b));
 if (set.has(wall)) set.delete(wall);
 else set.add(wall);
 return WALLS.filter((w) => set.has(w));
}

/** Keep legacy sidewallMetal in sync with openWalls (both eaves open ⇒ false). */
export function syncSidewallMetalFromOpenWalls(b) {
 if (!b) return;
 if (!Array.isArray(b.openWalls)) {
 b.openWalls = openWallList(b);
 }
 const open = openWallList(b);
 b.sidewallMetal = !(open.includes('left') && open.includes('right'));
}

/** Lean-to wall faces that can be opened (drive-through) on an enclosed lean. */
export const LEAN_FACES = ['outer', 'leftEnd', 'rightEnd'];

export const LEAN_FACE_LABELS = {
 outer: 'Outer eave',
 leftEnd: 'Left end',
 rightEnd: 'Right end',
};

/**
 * Faces opened on an enclosed lean-to (no metal/girts/mid-posts on that face).
 * Fully open (non-enclosed) leans treat all faces as open for materials.
 */
export function leanOpenFaceList(lean) {
 if (!lean) return [];
 if (!isLeanEnclosed(lean)) return [...LEAN_FACES];
 const raw = Array.isArray(lean.openFaces) ? lean.openFaces : [];
 return LEAN_FACES.filter((f) => raw.includes(f));
}

export function isLeanFaceOpen(lean, face) {
 if (!lean || !face) return false;
 return leanOpenFaceList(lean).includes(face);
}

/** Toggle one lean face open/closed. Returns new openFaces array. */
export function toggleLeanOpenFace(lean, face) {
 if (!LEAN_FACES.includes(face)) return leanOpenFaceList(lean);
 // Only meaningful on enclosed leans — force enclosed if toggling a face open
 const set = new Set(
 Array.isArray(lean?.openFaces)
 ? lean.openFaces.filter((f) => LEAN_FACES.includes(f))
 : [],
 );
 if (set.has(face)) set.delete(face);
 else set.add(face);
 return LEAN_FACES.filter((f) => set.has(f));
}

/** 6' 8" walk door height in feet */
export const WALK_DOOR_HEIGHT = 6 + 8 / 12; // 6.666...

export const OPENING_TYPES = {
 walk: { label: 'Walk Door', defaultW: 3, defaultH: 7 },
 window: { label: 'Window', defaultW: 3, defaultH: 4 },
 overhead: { label: 'Garage / Overhead Door', defaultW: 10, defaultH: 10 },
 slider: { label: 'Slider Door', defaultW: 12, defaultH: 8 },
};

/** 7' walk door height in feet */
export const WALK_DOOR_7 = 7;

/** Standard opening presets (We Build Structures). */
export const OPENING_PRESETS = [
 {
 id: 'walk-3x7',
 type: 'walk',
 label: "Walk Door 3' × 7'",
 width: 3,
 height: WALK_DOOR_7,
 sillHeight: 0,
 },
 {
 id: 'walk-3x68',
 type: 'walk',
 label: "Walk Door 3' × 6' 8\"",
 width: 3,
 height: WALK_DOOR_HEIGHT,
 sillHeight: 0,
 },
 { id: 'win-3x3', type: 'window', label: "Window 3' × 3'", width: 3, height: 3, sillHeight: 3.5 },
 { id: 'win-3x4', type: 'window', label: "Window 3' × 4'", width: 3, height: 4, sillHeight: 3 },
 { id: 'win-3x5', type: 'window', label: "Window 3' × 5'", width: 3, height: 5, sillHeight: 2.5 },
 { id: 'win-3x6', type: 'window', label: "Window 3' × 6'", width: 3, height: 6, sillHeight: 2 },
 { id: 'oh-8x8', type: 'overhead', label: "Garage 8' × 8'", width: 8, height: 8, sillHeight: 0 },
 { id: 'oh-10x10', type: 'overhead', label: "Garage 10' × 10'", width: 10, height: 10, sillHeight: 0 },
 { id: 'oh-12x12', type: 'overhead', label: "Garage 12' × 12'", width: 12, height: 12, sillHeight: 0 },
];

export function uid(prefix = 'id') {
 return `${prefix}_${Math.random().toString(36).slice(2, 9)}`;
}

export function createOpening(partial = {}) {
 const type = partial.type || 'walk';
 const defaults = OPENING_TYPES[type] || OPENING_TYPES.walk;
 const defaultSill =
 type === 'window' ? 3 : 0;
 /** Finish color WH (white) or BK (black) for doors and windows. */
 const colorTypes =
 type === 'walk' || type === 'overhead' || type === 'slider' || type === 'window';
 let finishColor = String(partial.color || partial.doorColor || '').toUpperCase();
 if (finishColor === 'WHITE' || finishColor === 'AL' || finishColor === 'WH') finishColor = 'WH';
 else if (finishColor === 'BLACK' || finishColor === 'MB' || finishColor === 'BK') finishColor = 'BK';
 else finishColor = colorTypes ? 'WH' : '';
 return {
 id: partial.id || uid('op'),
 type,
 width: partial.width ?? defaults.defaultW,
 height: partial.height ?? defaults.defaultH,
 wall: partial.wall || 'front',
 /** Offset (ft) along the wall from the left end when facing the wall from outside. */
 offset: partial.offset ?? 0,
 sillHeight: partial.sillHeight ?? defaultSill,
 /**
     * Host surface:
     * - 'main' = main building wall (use wall)
     * - lean-to id = opening on lean-to (use face: outer | leftEnd | rightEnd)
     */
 host: partial.host || 'main',
 /** Lean-to face when host is a lean-to id */
 face: partial.face || 'outer',
 /** Walk / garage / slider / window finish: 'WH' | 'BK' */
 color: colorTypes ? finishColor || 'WH' : '',
 };
}

/** Format height for display (e.g. 6.667 → 6' 8"). */
export function formatOpeningSize(w, h) {
 const fmt = (ft) => {
 const whole = Math.floor(ft + 1e-9);
 const inches = Math.round((ft - whole) * 12);
 if (inches <= 0) return `${whole}'`;
 if (inches === 12) return `${whole + 1}'`;
 return `${whole}' ${inches}"`;
 };
 return `${fmt(w)} × ${fmt(h)}`;
}

/**
 * Attached structure on a main-building wall:
 * - lean-to / shed roof (mono from main wall down to outer eave)
 * - gable extension (ridge down center of projection, two slopes)
 *
 * Dimensions: depth = out from wall, length = along wall (0 = full wall).
 * Enclosure: enclosed = wall metal + girts on outer + both ends;
 *            open = posts + roof only (carport style).
 */
/** Round feet to nearest 1" (production cut heights: 11'4" not 11.3'). */
export function roundFtToNearestInch(ft) {
  const n = Number(ft);
  if (!Number.isFinite(n)) return 0;
  return Math.round(n * 12) / 12;
}

export function createLeanTo(partial = {}) {

 const resolvedKind =
 partial.kind ||
 (partial.roofStyle === 'gable' ? 'gable-extension' : 'leanto');
 const roofStyle =
 partial.roofStyle ||
 (resolvedKind === 'gable-extension' ? 'gable' : 'shed');
 // Default enclosed (walls). Accept enclosed bool or enclosure: 'open'|'enclosed'
 let enclosed = true;
 if (typeof partial.enclosed === 'boolean') enclosed = partial.enclosed;
 else if (partial.enclosure === 'open') enclosed = false;
 else if (partial.enclosure === 'enclosed') enclosed = true;
 // Ceiling liner: none | yes (double-bubble / liner under lean roof)
 let ceilingLiner = 'none';
 if (partial.ceilingLiner === true || partial.ceilingLiner === 'yes') ceilingLiner = 'yes';
 else if (partial.ceilingLiner === false || partial.ceilingLiner === 'none') ceilingLiner = 'none';
 else if (partial.ceilingLiner) ceilingLiner = String(partial.ceilingLiner);
 return {
 id: partial.id || uid('lt'),
 name:
 partial.name ||
 (resolvedKind === 'gable-extension' ? 'Gable extension' : 'Lean-to'),
 /** 'leanto' | 'gable-extension' */
 kind: resolvedKind,
 /** 'shed' (mono) | 'gable' */
 roofStyle: roofStyle === 'gable' ? 'gable' : 'shed',
 wall: partial.wall || 'left',
 /** Projection distance from main wall (ft). */
 depth: partial.depth ?? 12,
 /** Length along the wall (ft). 0 = full wall length. */
 length: partial.length ?? 0,
 /** Offset from wall start (ft). */
 offset: partial.offset ?? 0,
 /**
     * Outer eave height (ft). Shed outer eave; gable side eaves.
     * If omitted: main eave − depth×(pitch/12) (mono drop from main), min 8'.
     * Example: 14' main · 8' deep · 4/12 → 14 − 2.67 ≈ 11.3'.
     */
 eaveHeight: (() => {
 if (partial.eaveHeight != null && partial.eaveHeight !== '') {
 return roundFtToNearestInch(Number(partial.eaveHeight) || 10);
 }
 const mainE = Number(partial._mainEaveHeight) || 12;
 const depth = Number(partial.depth) || 12;
 const pitch =
 Number(partial.pitch) ||
 Number(partial._mainPitch) ||
 4;
 return Math.max(8, roundFtToNearestInch(mainE - depth * (pitch / 12)));
 })(),
 // Default lean pitch = main roof pitch (not 3) so outer eave / girts match main
 pitch: partial.pitch ?? partial._mainPitch ?? 4,
 /** Lean post spacing o.c. (ft). Defaults to 10 — independent of main building. */
 postSpacing: partial.postSpacing ?? 10,
 /**
     * Attachment ledger on the main wall (entire lean length). Standard 2x8;
     * changeable. 2-ply so lean rafters / purlins seat like a carrier.
     */
 ledgerSize: ['2x6', '2x8', '2x10', '2x12'].includes(partial.ledgerSize)
 ? partial.ledgerSize
 : '2x8',
 /**
     * Outer eave rafter bearer (replaces lean sub-fascia). 2-ply on each side of
     * the outer posts — same idea as main truss bearers. Default 2x10.
     */
 rafterBearerSize: ['2x6', '2x8', '2x10', '2x12'].includes(partial.rafterBearerSize)
 ? partial.rafterBearerSize
 : partial._mainTrussCarrierSize || '2x10',
 /**
     * Shed lean: metal in the end triangles formed by corner cross-bracing
     * (outer corner back to main wall under the roof rake). Default on.
     * When false: no end-filler / upper-triangle metal in takeoff or 3D.
     */
 endTriangleMetal: partial.endTriangleMetal !== false,
 /** Snap ends to nearest main-wall posts (default off — custom lean lengths OK) */
 snapToPosts: partial.snapToPosts ?? false,
 /**
     * true = wall metal + girts on outer eave + both end walls.
     * false = open (posts + roof only; carport / open lean-to).
     */
 enclosed,
 /**
     * Per-face open walls on an enclosed lean (drive-through).
     * Values: 'outer' | 'leftEnd' | 'rightEnd'
     * Fully open leans (enclosed=false) ignore this — all faces are open.
     */
 openFaces: Array.isArray(partial.openFaces)
 ? partial.openFaces.filter((f) => ['outer', 'leftEnd', 'rightEnd'].includes(f))
 : [],
 /** Structural frame overhang past outer posts (inches). */
 overhangIn: partial.overhangIn ?? 0,
 /** Metal-only overhang past framing at outer eave (inches). Default 3". */
 metalOverhangIn: partial.metalOverhangIn ?? 3,
 /**
     * Ceiling liner under lean roof: 'none' | 'yes'
     * Adds insulation/liner area on takeoff when yes.
     */
 ceilingLiner,
 /** Concrete slab under lean footprint (independent of main hasSlab). */
 hasSlab: partial.hasSlab === true,
 /** Slab thickness (in). Defaults to main building slab when omitted. */
 slabThicknessIn:
 partial.slabThicknessIn != null
 ? Number(partial.slabThicknessIn) || 4
 : partial._mainSlabThicknessIn != null
 ? Number(partial._mainSlabThicknessIn) || 4
 : 4,
 };
}

/** Whether lean-to has wall skin / girts (not open carport). */
export function isLeanEnclosed(lean) {
 if (!lean) return true;
 if (typeof lean.enclosed === 'boolean') return lean.enclosed;
 return lean.enclosure !== 'open';
}

/**
 * Shed lean-to roof rise (ft) from outer eave up to main-wall attach.
 * Uses pitch × depth (production slope).
 */
export function leanToRoofRise(lean) {
 return (Number(lean.depth) || 0) * ((Number(lean.pitch) || 3) / 12);
}

/** Lean-to total roof overhang (ft) — prefers lean fields, falls back to main building. */
export function leanToOverhangFt(lean, b = {}) {
 const frameIn =
 lean?.overhangIn != null ? Number(lean.overhangIn) : Number(b.overhangIn) || 0;
 const metalIn =
 lean?.metalOverhangIn != null
 ? Number(lean.metalOverhangIn)
 : b.metalOverhangIn != null
 ? Number(b.metalOverhangIn)
 : 3;
 return (frameIn + metalIn) / 12;
}

/**
 * Roof-panel / rafter length for one lean-to plane (ft), including metal overhang.
 * Shed: single mono plane. Gable: one slope of the two (half-depth run).
 */
export function leanToRafterLength(lean, b = {}) {
 const metalOh = leanToOverhangFt(lean, b);
 const pitch = (Number(lean.pitch) || 3) / 12;
 if ((lean.roofStyle || 'shed') === 'gable') {
 const half = (Number(lean.depth) || 0) / 2;
 const run = half + metalOh;
 const rise = half * pitch;
 return Math.hypot(run, rise);
 }
 const depth = Number(lean.depth) || 0;
 const run = depth + metalOh;
 const rise = depth * pitch;
 return Math.hypot(run, rise);
}

/** Plan area of lean roof (for ceiling liner), sq ft. */
export function leanToRoofAreaSqFt(lean, b = {}, lengthFt) {
 const len = lengthFt != null ? lengthFt : Number(lean.length) || 0;
 const rafter = leanToRafterLength(lean, b);
 const sides = (lean.roofStyle || 'shed') === 'gable' ? 2 : 1;
 return rafter * Math.max(len, 0) * sides;
}

/** High-side attach height (ft) for shed lean roof at main wall. */
export function leanToAttachHeight(b, lean) {
 const outer = Number(lean.eaveHeight) || 10;
 const fromPitch = outer + leanToRoofRise(lean);
 // Prefer geometric attach under main eave when lean is lower; never below outer
 const mainEave = Number(b.eaveHeight) || fromPitch;
 return Math.max(outer, Math.min(mainEave, fromPitch));
}

/**
 * Ridge height above outer eave for a gable attachment.
 * Gable lean ridge runs out from main wall — span is lean length (width of gable), not depth.
 */
export function attachmentRidgeRise(att) {
 if ((att.roofStyle || 'shed') !== 'gable') return 0;
 const span = Number(att.length) > 0 ? Number(att.length) : Number(att.depth) || 0;
 return (span / 2) * ((Number(att.pitch) || 3) / 12);
}

/** Effective lean-to length along host wall. */
export function leanToLength(b, lean) {
 const wl = wallLength(b, lean.wall);
 if (lean.length > 0) return Math.min(lean.length, Math.max(0, wl - lean.offset));
 return Math.max(0, wl - lean.offset);
}

/** Max wall length available for an opening host. */
export function openingHostLength(b, opening) {
 if (!opening || opening.host === 'main' || !opening.host) {
 return wallLength(b, opening?.wall || 'front');
 }
 const lean = (b.leanTos || []).find((l) => l.id === opening.host);
 if (!lean) return wallLength(b, opening.wall || 'front');
 if (opening.face === 'leftEnd' || opening.face === 'rightEnd') return lean.depth;
 return leanToLength(b, lean);
}

export function createBuilding(partial = {}) {
 return {
 id: partial.id || uid('bldg'),
 name: partial.name || 'Main Building',
 width: partial.width ?? 30,
 length: partial.length ?? 40,
 eaveHeight: partial.eaveHeight ?? 12,
 pitch: partial.pitch ?? 4,
 roofStyle: partial.roofStyle || 'gable', // gable | mono
 /**
   * Roof truss style drawn in 3D / noted on takeoff:
   * common | scissor | attic | parallelChord
   */
 trussType: ['common', 'scissor', 'attic', 'parallelChord'].includes(partial.trussType)
 ? partial.trussType
 : 'common',
 /** Parallel-chord / attic depth helper (ft). Default 3.5′. */
 trussDepthFt: partial.trussDepthFt ?? 3.5,
 postSpacing: partial.postSpacing ?? 10,
 /** Embedment / hole depth below grade (ft). Typical frost range 3–6. */
 postDepthFt: partial.postDepthFt ?? 3,
 trussSpacing: partial.trussSpacing ?? 5,
 /**
   * Gable fly / lookout rafter spacing o.c. (ft). Default 5′.
   * Qty = (floor(width / spacing) + 1) × 2 gable ends.
   */
 rafterSpacing: partial.rafterSpacing ?? 5,
 /** Gable fly / lookout lumber. Standard 2x8. */
 rafterSize: ['2x6', '2x8', '2x10', '2x12'].includes(partial.rafterSize)
 ? partial.rafterSize
 : '2x8',
 girtSpacingIn: partial.girtSpacingIn ?? 24,
 purlinSpacingIn: partial.purlinSpacingIn ?? 24,
 postSize: partial.postSize || '6x6',
 /** Wall girt lumber: '2x4' | '2x6' | '2x8'. Default 2x6. */
 girtSize: ['2x4', '2x6', '2x8'].includes(partial.girtSize)
 ? partial.girtSize
 : '2x6',
 /** Roof purlin lumber: '2x4' | '2x6' | '2x8'. Default 2x4; Kane/benchmark often 2x6. */
 purlinSize: ['2x4', '2x6', '2x8'].includes(partial.purlinSize)
 ? partial.purlinSize
 : '2x4',
 /** Treated skirt at grade — main building perimeter only (not lean-tos). Default 2x6. */
 skirtSize: partial.skirtSize || '2x6',
 /**
     * Post protector sleeves on main structure posts only (never lean-tos / awnings).
     */
 postProtectors: partial.postProtectors ?? false,
 /**
     * Perma-Column precast piers on main structure posts only (never lean-tos / awnings).
     */
 permaColumns: partial.permaColumns ?? false,
 /**
     * @deprecated Prefer openWalls. false = open left+right eaves when openWalls is absent.
     */
 sidewallMetal: partial.sidewallMetal ?? true,
 /**
     * Open Wall (drive-through).
     * List of main walls with no wall metal, no girts, and no intermediate posts
     * (corner posts kept when shared with a closed wall / for roof support).
     * Values: 'front' | 'back' | 'left' | 'right'
     *
     * Always an array after createBuilding (never undefined) so openWallList
     * does not fall back to sidewallMetal.
     */
 openWalls: Array.isArray(partial.openWalls)
 ? partial.openWalls.filter((w) => WALLS.includes(w))
 : partial.sidewallMetal === false
 ? ['left', 'right']
 : [],
 /**
     * Truss carrier on eave walls (left & right): always 2-ply.
     * Size 2x10 or 2x12.
     */
 trussCarrierSize: partial.trussCarrierSize || '2x10',
 /** Structural frame overhang (inches). 0 = square eave; metal may still project. */
 overhangIn: partial.overhangIn ?? 0,
 /**
     * Raised / energy heel above eave (ft). Adds to post ORDER height only
     * (Doug benchmark heel 2′6″ → eave posts cut 22′, peak jambs 26′).
     */
 heelHeightFt: Math.max(0, Number(partial.heelHeightFt) || 0),
 /**
     * Main-building ceiling liner (Arctic / Thrifty panels + FJ). 'yes' | 'none'.
     * Jim benchmark: FJ Arctic ×30 + wall FJ Black ×31.
     */
 ceilingLiner:
  partial.ceilingLiner === true || partial.ceilingLiner === 'yes'
   ? 'yes'
   : 'none',
 /** Trim/panel color for ceiling liner FJ (default AR = Arctic). */
 ceilingLinerColor: partial.ceilingLinerColor || 'AR',
 /**
     * Roof panel only overhang past framing (inches). Standard We Build: 3".
     * Used for roof panel length & purlin row count, not post layout.
     */
 metalOverhangIn: partial.metalOverhangIn ?? 3,
 /**
     * Always 'auto' in the app — benchmark package from geometry (eave ≥ 14′ or lean → full).
     * 'small' | 'full' only for internal regression tests.
     */
 orderPackageMode: ['auto', 'small', 'full'].includes(partial.orderPackageMode)
 ? partial.orderPackageMode
 : 'auto',
 /**
     * Mid-gable post stock when required is ~18.1–18.5′:
     * 'auto' | 'demote18' | 'keep20'. Default auto (width/lean + package rule).
     * Frank benchmark 35×50 uses keep20 so mid-gable orders 20′ without breaking
     * 30×40 / 40×40 / 35×55 auto demotion goldens.
     */
 midGablePostPolicy: ['auto', 'demote18', 'keep20'].includes(partial.midGablePostPolicy)
 ? partial.midGablePostPolicy
 : 'auto',
 wallColor: partial.wallColor || 'AL',
 roofColor: partial.roofColor || 'BK',
 /**
     * Metal panel gauge for walls / roof. benchmark & Kane item lists use 29 GA default
     * or 26 GA upgrade (e.g. 2640BKQLP / 26GLIFE-MATTEBLACK).
     * Values: '29' | '26'
     */
 wallGauge: partial.wallGauge === 26 || partial.wallGauge === '26' ? '26' : '29',
 roofGauge: partial.roofGauge === 26 || partial.roofGauge === '26' ? '26' : '29',
 /** Exterior metal trim color (ridge, eave, corner, base, etc.) */
 trimColor: partial.trimColor || 'BK',
 /**
     * Lower wall wainscot color. Empty / 'NONE' = no wainscot.
     * When set, wainscot band height is wainscotHeightFt (0 = off even if color set).
     */
 wainscotColor: partial.wainscotColor || 'NONE',
 wainscotHeightFt: partial.wainscotHeightFt ?? 3,
 /**
     * Insulation location: 'none' | 'roof' | 'walls' | 'both'
     */
 insulation: partial.insulation || 'none',
 /**
     * Insulation product when location ≠ none:
     * 'fiberglass3' | 'thermaguard' | 'both' (double: fiberglass + ThermaGuard)
     */
 insulationType:
 partial.insulationType === 'thermaguard' ||
 partial.insulationType === 'both' ||
 partial.insulationType === 'double'
 ? partial.insulationType === 'double'
 ? 'both'
 : partial.insulationType
 : 'fiberglass3',
 hasSlab: partial.hasSlab ?? false,
 slabThicknessIn: partial.slabThicknessIn ?? 4,
 /** Site placement for multi-building layouts (ft). */
 siteX: partial.siteX ?? 0,
 siteZ: partial.siteZ ?? 0,
 rotationDeg: partial.rotationDeg ?? 0,
 openings: (partial.openings || []).map(createOpening),
 leanTos: (partial.leanTos || []).map((lt) =>
 createLeanTo({
 ...lt,
 _mainEaveHeight: partial.eaveHeight ?? lt._mainEaveHeight,
 }),
 ),
 };
}

/** Background / site props for sales staging (people, animals, vehicles). */
export const SITE_PROP_TYPES = {
 man: { id: 'man', label: 'Man', category: 'people', defaultRot: 25 },
 woman: { id: 'woman', label: 'Woman', category: 'people', defaultRot: -15 },
 dog: { id: 'dog', label: 'Dog', category: 'animals', defaultRot: 40 },
 horse: { id: 'horse', label: 'Horse', category: 'animals', defaultRot: -30 },
 cow: { id: 'cow', label: 'Cow', category: 'animals', defaultRot: 10 },
 truck_chevy_2500: {
 id: 'truck_chevy_2500',
 label: 'Chevy 2500 Duramax flatbed',
 category: 'vehicles',
 defaultRot: 200,
 },
};

export function createSiteProp(partial = {}) {
 const type = partial.type && SITE_PROP_TYPES[partial.type] ? partial.type : 'man';
 const def = SITE_PROP_TYPES[type];
 return {
 id: partial.id || uid('prop'),
 type,
 label: partial.label || def.label,
 /** Site X (ft) — world X */
 x: partial.x ?? 0,
 /** Site Z (ft) — world Z */
 z: partial.z ?? 0,
 rotationDeg: partial.rotationDeg ?? def.defaultRot ?? 0,
 scale: partial.scale ?? 1,
 };
}

export function createProject(partial = {}) {
 const buildings = (partial.buildings || [createBuilding()]).map(createBuilding);
 const props = Array.isArray(partial.props)
 ? partial.props.map((p) => createSiteProp(p))
 : [];
 return {
 id: partial.id || uid('job'),
 customer: partial.customer || 'Customer Name',
 project: partial.project || '30x40 Shop',
 location: partial.location || 'Oklahoma',
 /**
     * Optional install labor ($/sq ft). Default 0 so Calculated Price matches
     * Materials-package totals unless labor is entered.
     */
 laborPerSqFt: partial.laborPerSqFt ?? 0,
 /** Markup % applies to labor only — materials are never marked up. */
 markupPct: partial.markupPct ?? 25,
 /** One-way loaded miles for freight ($4.50/mi + $50 unload). */
 freightMiles: partial.freightMiles ?? 0,
 /** Sales tax rate % on materials + freight (default 9.5). */
 salesTaxPct: partial.salesTaxPct ?? 9.5,
 buildings,
 activeBuildingId: partial.activeBuildingId || buildings[0].id,
 /** Site staging props (people, animals, trucks) */
 props,
 /** Basic CRM fields (expandable later) */
 crm: {
 name: partial.crm?.name ?? partial.customer ?? '',
 address: partial.crm?.address ?? '',
 state: partial.crm?.state ?? '',
 salesman: partial.crm?.salesman ?? '',
 /** Optional override for shareable job URL; default built from id */
 jobLink: partial.crm?.jobLink ?? '',
 notes: partial.crm?.notes ?? '',
 },
 };
}

/** Wall length in feet for a rectangular building. */
export function wallLength(b, wall) {
 return wall === 'front' || wall === 'back' ? b.width : b.length;
}

/** Roof rise (ft) for half-span (gable) or full span (mono). */
export function roofRise(b) {
 if (b.roofStyle === 'mono') return b.width * (b.pitch / 12);
 return (b.width / 2) * (b.pitch / 12);
}

/** Structural + metal overhang in feet (panel projection). */
export function totalRoofOverhangFt(b) {
 return ((b.overhangIn || 0) + (b.metalOverhangIn ?? 3)) / 12;
}

/** One-side rafter / roof-panel length including metal overhang (ft). */
export function rafterLength(b) {
 const oh = totalRoofOverhangFt(b);
 if (b.roofStyle === 'mono') {
 const run = b.width + oh;
 const rise = b.width * (b.pitch / 12);
 return Math.hypot(run, rise);
 }
 // Gable: half-span run + oh, rise on the building half-width (pitch on frame)
 const half = b.width / 2;
 const run = half + oh;
 const rise = half * (b.pitch / 12);
 return Math.hypot(run, rise);
}

export function roofAreaSqFt(b) {
 const oh = (b.overhangIn || 0) / 12;
 const rafter = rafterLength(b);
 if (b.roofStyle === 'mono') return rafter * (b.length + 2 * oh);
 return 2 * rafter * (b.length + 2 * oh);
}

export function wallAreaSqFt(b) {
 // Approximate four walls at eave height (gable end triangles handled in metal takeoff).
 return 2 * (b.width * b.eaveHeight + b.length * b.eaveHeight);
}

export function gableEndTriangleArea(b) {
 if (b.roofStyle === 'mono') return 0;
 const rise = roofRise(b);
 return 2 * (0.5 * b.width * rise);
}

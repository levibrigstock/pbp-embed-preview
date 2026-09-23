/**
 * Post-frame domain primitives.
 * Dimensions are feet unless noted. Pitch is rise per 12" run.
 */
import { normalizeColorPlan } from './colorPlan.js?v=20260923frameView1';


export const WALLS = ['front', 'back', 'left', 'right'];

/** Human labels for main-building walls */
export const WALL_LABELS = {
 front: 'Front (gable)',
 back: 'Back (gable)',
 left: 'Left (eave)',
 right: 'Right (eave)',
};

/** Host walls an ell can butt. Mirrors ELL_WALLS in domain/ell.js. */
export const ELL_ATTACH_WALLS = ['left', 'right', 'front', 'back'];

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


/** Job-level: include exterior roof metal (panels + roof-skin trim). Default on. */
export function buildingIncludesRoofMetal(b) {
  return !b || b.includeRoofMetal !== false;
}

/** Job-level: include exterior wall metal (panels + wall-skin trim). Default on. */
export function buildingIncludesWallMetal(b) {
  return !b || b.includeWallMetal !== false;
}

/** Lean-to wall faces that can be opened (drive-through) on an enclosed lean. */
export const LEAN_FACES = ['outer', 'leftEnd', 'rightEnd'];

export const LEAN_FACE_LABELS = {
 outer: 'Outer eave',
 leftEnd: 'Left end',
 rightEnd: 'Right end',
};

/**
 * Faces with no wall metal / girts / mid-posts.
 * Cantilever (roof-only): all faces open — no walls, no posts.
 * Open (carport) leans: outer eave is open; END walls still get metal
 * (the white rake/side panels in sales photos). Enclosed leans use openFaces.
 */
export function leanOpenFaceList(lean) {
 if (!lean) return [];
 if (isLeanCantilever(lean)) return [...LEAN_FACES];
 if (!isLeanEnclosed(lean)) return ['outer'];
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

/**
 * A cross gable over an entry: a roof feature, not a building and not a
 * lean-to. See js/domain/crossGable.js for the geometry and why it is neither.
 */
export function createCrossGable(partial = {}) {
  const wall = WALLS.includes(partial.wall) ? partial.wall : 'left';
  return {
    id: partial.id || uid('cg'),
    name: (partial.name && String(partial.name).trim()) || 'Entry gable',
    wall,
    /** Along the wall, from its origin corner, to the gable's near edge. */
    offset: Math.max(0, Number(partial.offset) || 0),
    /** Along the wall. */
    width: Math.max(2, Number(partial.width) || 10),
    /** Past the wall. 0 = it sits entirely on the roof. */
    projection: Math.max(0, Number(partial.projection) || 0),
    pitch: Math.max(0, Number(partial.pitch) || 0),
    /** Blank/0 = continue the main eave line. */
    eaveHeight:
      partial.eaveHeight == null || partial.eaveHeight === ''
        ? null
        : Number(partial.eaveHeight),
    /** Post protector sleeves on standing entry-gable posts (projection > 0). */
    postProtectors: partial.postProtectors ?? false,
    /** Perma-Column piers on standing entry-gable posts (projection > 0). */
    permaColumns: partial.permaColumns ?? false,
  };
}

/** 6' 8" walk door height in feet */
export const WALK_DOOR_HEIGHT = 6 + 8 / 12; // 6.666...

export const OPENING_TYPES = {
 walk: { label: 'Walk Door', defaultW: 3, defaultH: 7 },
 window: { label: 'Window', defaultW: 3, defaultH: 4 },
 overhead: { label: 'Garage / Overhead Door', defaultW: 10, defaultH: 10 },
 slider: { label: 'Sliding Barn Door', defaultW: 12, defaultH: 10 },
};

/** Slide direction for type === 'slider'. */
export const SLIDE_MODES = {
 left: { label: 'Left slide' },
 right: { label: 'Right slide' },
 center: { label: 'Center slide (two leaves)' },
};

export function normalizeSlideMode(raw, type = 'slider') {
 if (type !== 'slider') return '';
 const m = String(raw || '').toLowerCase();
 if (m === 'right' || m === 'center' || m === 'left') return m;
 return 'left';
}

/** Track mount for type === 'slider': top-mount vs face-mount brackets + covers. */
export const SLIDE_MOUNTS = {
 top: { label: 'Top mount' },
 face: { label: 'Face mount' },
};

export function normalizeSlideMount(raw, type = 'slider') {
 if (type !== 'slider') return '';
 const m = String(raw || '').toLowerCase();
 if (m === 'face' || m === 'top') return m;
 return 'top';
}

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
 {
 id: 'slider-12x10-left',
 type: 'slider',
 label: "Sliding Barn 12' × 10' — Left",
 width: 12,
 height: 10,
 sillHeight: 0,
 slideMode: 'left',
 },
 {
 id: 'slider-12x10-right',
 type: 'slider',
 label: "Sliding Barn 12' × 10' — Right",
 width: 12,
 height: 10,
 sillHeight: 0,
 slideMode: 'right',
 },
 {
 id: 'slider-12x10-center',
 type: 'slider',
 label: "Sliding Barn 12' × 10' — Center",
 width: 12,
 height: 10,
 sillHeight: 0,
 slideMode: 'center',
 },
 {
 id: 'slider-10x10-center',
 type: 'slider',
 label: "Sliding Barn 10' × 10' — Center",
 width: 10,
 height: 10,
 sillHeight: 0,
 slideMode: 'center',
 },
];

export function uid(prefix = 'id') {
 return `${prefix}_${Math.random().toString(36).slice(2, 9)}`;
}

/**
 * Does the stored `offset` run left-to-right along this wall as seen by someone
 * standing OUTSIDE looking at it?
 *
 * The stored offset is a world-axis coordinate: +X on the front and back walls,
 * +Z on the left and right (scene.js _openingWorldPos). Whether that axis reads
 * left-to-right depends on which side the viewer stands on, and the answer is
 * NOT something to derive by hand — an earlier version of this reasoned its way
 * to the exact opposite table and a check that reasoned the same way agreed with
 * it, so both were wrong together. The table below is what three.js's own
 * projection produces when a camera is placed outside each wall and the ends of
 * that wall are projected to NDC; opening-placement-check.mjs re-runs that
 * projection rather than re-deriving it.
 *
 *   front (outward -Z): offset 0 lands on the viewer's RIGHT  -> mirror
 *   back  (outward +Z): offset 0 lands on the viewer's LEFT   -> straight
 *   left  (outward -X): offset 0 lands on the viewer's LEFT   -> straight
 *   right (outward +X): offset 0 lands on the viewer's RIGHT  -> mirror
 */
export function wallOffsetRunsFromLeft(wall) {
  return wall === 'back' || wall === 'left';
}

/**
 * Convert between the stored axis offset and the distance a person would
 * measure from the left corner as they face the wall.
 *
 * Mirroring is its own inverse, so this one function serves both directions —
 * UI to stored and stored back to UI — and cannot drift out of step with itself.
 */
export function mirrorOpeningOffset(wall, wallLenFt, widthFt, offsetFt) {
  const off = Number(offsetFt) || 0;
  if (wallOffsetRunsFromLeft(wall)) return off;
  const len = Number(wallLenFt) || 0;
  const w = Number(widthFt) || 0;
  return Math.max(0, len - off - w);
}

/**
 * Keep a soffit/fascia override object to the shape the resolver expects.
 *
 * Sparse on purpose: a key that is absent means "derive it", so this must not
 * fill anything in. It only drops what is not a recognised run or field, which
 * stops a stray key from riding along into saved jobs forever.
 */
export function normalizeSoffitFascia(raw) {
  if (!raw || typeof raw !== 'object') return undefined;
  const RUNS = ['all', 'eave', 'rake', 'lean'];
  const SOFFIT = ['present', 'material', 'vent', 'depthIn', 'colorSource'];
  const FASCIA = ['present', 'profile', 'subFascia'];
  const out = {};
  for (const run of RUNS) {
    const r = raw[run];
    if (!r || typeof r !== 'object') continue;
    const kept = {};
    for (const [group, keys] of [['soffit', SOFFIT], ['fascia', FASCIA]]) {
      const g = r[group];
      if (!g || typeof g !== 'object') continue;
      const sub = {};
      for (const k of keys) {
        // undefined means "not set"; false and 0 are real choices and stay.
        if (g[k] !== undefined) sub[k] = g[k];
      }
      if (Object.keys(sub).length) kept[group] = sub;
    }
    if (Object.keys(kept).length) out[run] = kept;
  }
  return Object.keys(out).length ? out : undefined;
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
 const slideMode = normalizeSlideMode(partial.slideMode, type);
 const slideMount = normalizeSlideMount(partial.slideMount, type);
 return {
 id: partial.id || uid('op'),
 type,
 width: partial.width ?? defaults.defaultW,
 height: partial.height ?? defaults.defaultH,
 wall: partial.wall || 'front',
 /**
  * Offset (ft) of the opening's left edge along the wall, measured from the
  * wall's ORIGIN corner — the +X end for front/back, the +Z end for left/right.
  *
  * This is a geometry coordinate, NOT "from the left as you look at the wall".
  * On the back and left walls the origin corner is on the viewer's RIGHT, so
  * the two disagree there. Everything that draws or bills from this value
  * (the wall skin's cutouts, the opening mesh, girts, headers, the plan views)
  * shares this origin and stays consistent with itself.
  *
  * Use mirrorOpeningOffset() to convert to and from what a person standing
  * outside would call the left corner. That is a UI concern and is applied at
  * that boundary only — moving the flip into geometry would desync the door
  * from the hole it sits in.
  */
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
 /**
   * Sliding barn door only: 'left' | 'right' | 'center'.
   * Center = two leaves meeting in the middle on a shared top track.
   */
 slideMode,
 /**
   * Sliding barn door only: 'top' | 'face' track bracket mount (default top).
   */
 slideMount,
 /**
   * - 'installed' = include door/window/garage unit (default)
   * - 'framed' = rough opening only (no unit in 3D or takeoff)
   */
 installMode:
  String(partial.installMode || '').toLowerCase() === 'framed' ? 'framed' : 'installed',
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
 *            open = carport style — outer eave open, END walls still metalled;
 *            cantilever = roof-only canopy — no walls, no lean posts.
 */
/** Round feet to nearest 1" (production cut heights: 11'4" not 11.3'). */
export function roundFtToNearestInch(ft) {
  const n = Number(ft);
  if (!Number.isFinite(n)) return 0;
  return Math.round(n * 12) / 12;
}

/** Interior liner flags: only an explicit yes turns the product on. */
export function yesLinerFlag(v) {
  return v === true || v === 'yes' ? 'yes' : 'none';
}

export function createLeanTo(partial = {}) {

 const WRAP_CORNERS = ['FL', 'FR', 'BL', 'BR'];
 const WRAP_CORNER_WALLS = {
 FL: ['front', 'left'],
 FR: ['front', 'right'],
 BL: ['back', 'left'],
 BR: ['back', 'right'],
 };
 let resolvedKind =
 partial.kind ||
 (partial.roofStyle === 'gable' ? 'gable-extension' : 'leanto');
 if (resolvedKind === 'wrap-lean') resolvedKind = 'wrap';
 const isWrap = resolvedKind === 'wrap';
 const wrapCorner = WRAP_CORNERS.includes(String(partial.corner || '').toUpperCase())
 ? String(partial.corner).toUpperCase()
 : 'FL';
 // Primary wall for legacy callers: first wall of the corner pair
 const wrapWalls = WRAP_CORNER_WALLS[wrapCorner];
 const roofStyle = isWrap
 ? 'shed'
 : partial.roofStyle ||
 (resolvedKind === 'gable-extension' ? 'gable' : 'shed');
 // Default enclosed (walls). Accept enclosed bool, support, or enclosure:
 // 'open' | 'enclosed' | 'cantilever'
 let enclosed = true;
 let support = partial.support === 'cantilever' ? 'cantilever' : 'posts';
 if (
   partial.support === 'cantilever' ||
   partial.cantilever === true ||
   partial.enclosure === 'cantilever'
 ) {
   enclosed = false;
   support = 'cantilever';
 } else if (typeof partial.enclosed === 'boolean') {
   enclosed = partial.enclosed;
 } else if (partial.enclosure === 'open') {
   enclosed = false;
 } else if (partial.enclosure === 'enclosed') {
   enclosed = true;
 }
 if (support === 'cantilever') enclosed = false;
 // Ceiling / wall liner: none | yes
 const ceilingLiner = yesLinerFlag(partial.ceilingLiner);
 const wallLiner = yesLinerFlag(partial.wallLiner);
 return {
 id: partial.id || uid('lt'),
 name:
 partial.name ||
 (isWrap
 ? 'Wrap-around lean-to'
 : resolvedKind === 'gable-extension'
 ? 'Gable extension'
 : 'Lean-to'),
 /** 'leanto' | 'gable-extension' | 'wrap' */
 kind: isWrap ? 'wrap' : resolvedKind,
 /** 'shed' (mono) | 'gable' */
 roofStyle: roofStyle === 'gable' ? 'gable' : 'shed',
 wall: partial.wall || 'left',
 /**
     * Rafter spacing on a shed lean (ft): 2, 4 or 5.
     *
     * Shed leans frame with rafters — end rafters at each end and the rest on
     * centre. A GABLE EXTENSION does not: that is a wing and it frames with
     * trusses, so this is ignored there.
     */
 rafterSpacing: [2, 4, 5].includes(Number(partial.rafterSpacing))
 ? Number(partial.rafterSpacing)
 : 5,
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
 /** Post protector sleeves on this lean's posts (independent of main). Ignored for cantilever. */
 postProtectors: partial.postProtectors ?? false,
 /** Perma-Column piers on this lean's posts (independent of main). Ignored for cantilever. */
 permaColumns: partial.permaColumns ?? false,
 /**
     * Shed lean: bill joist hangers at the ledger for each rafter station.
     * When true, lean rafter lumber size follows joistHangerSize (2x8|2x10).
     * Gable / wrap takeoff ignores this (no shed rafter stations billed).
     */
 joistHangers: partial.joistHangers === true,
 /**
     * Hanger / rafter size when joistHangers is on. Same JOIST2810 SKU for both;
     * size still drives rafter lumber and BOM description.
     */
 joistHangerSize: ['2x8', '2x10'].includes(partial.joistHangerSize)
 ? partial.joistHangerSize
 : '2x8',
 /**
     * Optional hanger qty override. null = match shed rafter station count;
     * a positive integer bills that many JOIST2810 instead.
     */
 joistHangerQty: (() => {
 const n = Number(partial.joistHangerQty);
 if (Number.isFinite(n) && n > 0) return Math.round(n);
 return null;
 })(),
 /**
     * Attachment ledger on the main wall (entire lean length). Double-banded
     * 2x10 (2-ply) so lean rafters / purlins seat like a carrier; changeable.
     */
 ledgerSize: ['2x6', '2x8', '2x10', '2x12'].includes(partial.ledgerSize)
 ? partial.ledgerSize
 : '2x10',
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
     * false = open carport — outer eave open; END walls still metalled
     * (or cantilever roof-only when support === 'cantilever').
     */
 enclosed,
 /**
     * 'posts' = outer (and end when enclosed) lean posts carry the roof.
     * 'cantilever' = roof-only canopy off the main wall — zero lean posts,
     * no lean wall metal/girts. Implies enclosed=false and all faces open.
     */
 support,
 /**
     * Per-face open walls on an enclosed lean (drive-through).
     * Values: 'outer' | 'leftEnd' | 'rightEnd'
     * Open leans (enclosed=false) always treat outer as open; ends stay metalled.
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
     * Bills interior ceiling panels, FJ, nailers, and liner-color screws.
     */
 ceilingLiner,
 ceilingLinerColor: String(partial.ceilingLinerColor || 'AR').toUpperCase() || 'AR',
 /**
     * Interior wall liner on enclosed (and still-metalled) lean faces.
     * Bills interior wall panels, base, FJ, J-trim, and liner-color screws.
     */
 wallLiner,
 wallLinerColor: String(partial.wallLinerColor || 'AR').toUpperCase() || 'AR',
 /** Concrete slab under lean footprint (independent of main hasSlab). */
 hasSlab: partial.hasSlab === true,
 /** Slab thickness (in). Defaults to main building slab when omitted. */
 slabThicknessIn:
 partial.slabThicknessIn != null
 ? Number(partial.slabThicknessIn) || 4
 : partial._mainSlabThicknessIn != null
 ? Number(partial._mainSlabThicknessIn) || 4
 : 4,
 /**
 * Wrap-around lean (kind === 'wrap'): open porch wrapping a 90° corner.
 * Enclosed wrap walls are TODO — v1 forces open posts + roof.
 */
 ...(isWrap
 ? {
 kind: 'wrap',
 corner: wrapCorner,
 wall: partial.wall && ['front','back','left','right'].includes(partial.wall)
 ? partial.wall
 : wrapWalls[0],
 walls: wrapWalls,
 lengthA: Math.max(0, Number(partial.lengthA) || 0),
 lengthB: Math.max(0, Number(partial.lengthB) || 0),
 // Open porch v1 — ignore enclosed/cantilever for wrap
 enclosed: false,
 support: 'posts',
 openFaces: ['outer', 'leftEnd', 'rightEnd'],
 name: partial.name || 'Wrap-around lean-to',
 }
 : {}),
 };
}

/**
 * Roof-only cantilever lean: no walls, no lean posts. Depth still set like a
 * lean-to; roof metal / rafters / purlins / ledger still bill.
 */
export function isLeanCantilever(lean) {
 if (!lean) return false;
 if (lean.support === 'cantilever') return true;
 if (lean.cantilever === true) return true;
 if (lean.enclosure === 'cantilever') return true;
 return false;
}

/** Whether lean-to has wall skin / girts (not open carport / cantilever). */
export function isLeanEnclosed(lean) {
 if (!lean) return true;
 if (isLeanCantilever(lean)) return false;
 if (typeof lean.enclosed === 'boolean') return lean.enclosed;
 return lean.enclosure !== 'open' && lean.enclosure !== 'cantilever';
}

/** Operator-facing enclosure label: Enclosed | Open | Cantilever. */
export function leanEnclosureLabel(lean) {
 if (isLeanCantilever(lean)) return 'Cantilever';
 if (!isLeanEnclosed(lean)) return 'Open';
 return 'Enclosed';
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

/** True when lean pitch matches main (within 0.01) — continuous slope is valid. */
export function leanPitchMatchesMain(b, lean) {
  const main = Number(b?.pitch) || 4;
  const leanP = Number(lean?.pitch);
  const p = Number.isFinite(leanP) && leanP > 0 ? leanP : main;
  return Math.abs(p - main) < 0.01;
}

/**
 * True when a shed lean on this main wall shares main pitch (flush continuous
 * roof join — no under-soffit step). Gable leans never match this path.
 */
export function mainWallHasMatchingPitchShedLean(b, wall) {
  return (b?.leanTos || []).some((lt) => {
    if (!lt || lt.wall !== wall || (Number(lt.depth) || 0) <= 0.1) return false;
    if ((lt.roofStyle || 'shed') === 'gable') return false;
    return leanPitchMatchesMain(b, lt);
  });
}

/** True when any lean (open or enclosed) attaches to this main wall. */

function WRAP_CORNER_WALLS_LOCAL(corner) {
  const m = {
    FL: ['front', 'left'],
    FR: ['front', 'right'],
    BL: ['back', 'left'],
    BR: ['back', 'right'],
  };
  const c = String(corner || 'FL').toUpperCase();
  return m[c] || m.FL;
}

export function mainWallHasLean(b, wall) {
  return (b?.leanTos || []).some((lt) => {
    if (!lt || (Number(lt.depth) || 0) <= 0.1) return false;
    if (lt.kind === 'wrap' || lt.kind === 'wrap-lean') {
      const walls = lt.walls || WRAP_CORNER_WALLS_LOCAL(lt.corner);
      return walls.includes(wall);
    }
    return lt.wall === wall;
  });
}

/**
 * True when a shed lean's high edge is flush with the main eave plane (within
 * ~2.5"). Pitch-number match alone is not enough — a lean can share pitch and
 * still step down under the soffit when its outer eave is lower; that case
 * must keep main eave trim continuous over the lean.
 */
export function leanAttachFlushWithMainEave(b, lean) {
  if (!lean) return false;
  if ((lean.roofStyle || 'shed') === 'gable') return true;
  const mainH = Number(b?.eaveHeight) || 12;
  const attach = leanToAttachHeight(b, lean);
  return Math.abs(attach - mainH) < 0.22;
}

/**
 * Occupied [start,end) spans (ft along host wall) for leans on `wall`.
 * Merges overlaps. Used to keep main eave band/drip on free wall length and
 * only omit the portion that would sit on lean roof metal.
 *
 * `omitMainEaveTrim` — when true, main eave band should not run through this
 * span (flush shed attach, gable peak on main roof, or an ell). Stepped
 * (under-soffit) shed leans keep omitMainEaveTrim false so the main roofline
 * trim stays continuous over the lean.
 *
 * `omitMainEaveDrip` — only ells (and gable leans whose pans cover the OH tip).
 * The outer drip fascia is the "trim above the lean" and must run continuous
 * for every shed lean, flush or stepped — carving it left a visible gap.
 */
export function leanOccupiedSpansOnWall(b, wall) {
  const spans = [];
  for (const lt of b?.leanTos || []) {
    if (!lt || (Number(lt.depth) || 0) <= 0.1) continue;
    // Wrap-around: may occupy this wall as one of two host walls
    if (lt.kind === 'wrap' || lt.kind === 'wrap-lean') {
      const walls = lt.walls || WRAP_CORNER_WALLS_LOCAL(lt.corner);
      if (!walls.includes(wall)) continue;
      const max = wallLength(b, wall);
      const isA = walls[0] === wall;
      const raw = isA ? Number(lt.lengthA) : Number(lt.lengthB);
      const len = raw > 0 ? Math.min(raw, max) : max;
      if (len <= 0.1) continue;
      const corner = String(lt.corner || 'FL').toUpperCase();
      let start = 0;
      if (wall === 'front' || wall === 'back') {
        if (corner === 'FR' || corner === 'BR') start = Math.max(0, max - len);
      } else if (corner === 'BL' || corner === 'BR') {
        start = Math.max(0, max - len);
      }
      const isGable = false;
      const pitchMatch = leanPitchMatchesMain(b, lt);
      const flush = leanAttachFlushWithMainEave(b, lt);
      spans.push({
        start,
        end: Math.min(max, start + len),
        leanId: lt.id,
        omitMainEaveTrim: pitchMatch && flush,
        omitMainEaveDrip: false,
        isGable,
      });
      continue;
    }
    if (lt.wall !== wall) continue;
    const start = Math.max(0, Number(lt.offset) || 0);
    const len = leanToLength(b, lt);
    if (len <= 0.1) continue;
    const isGable = (lt.roofStyle || 'shed') === 'gable';
    const pitchMatch = !isGable && leanPitchMatchesMain(b, lt);
    const flush = leanAttachFlushWithMainEave(b, lt);
    spans.push({
      start,
      end: start + len,
      pitchMatch,
      omitMainEaveTrim: isGable || flush,
      // Shed leans never eat the outer drip — only gable (peak on main roof)
      // or ells do. A flush shed still leaves the OH drip tip exposed.
      omitMainEaveDrip: isGable,
    });
  }
  // An ell occupies a wall exactly as a lean does: a whole building stands in
  // front of that stretch, so the eave band, drip and soffit have nothing to
  // run along there. `_ellSpans` is stamped by resolveEllPlacements — see
  // domain/ell.js — because the link points from wing to host, not back.
  for (const es of b?._ellSpans || []) {
    if (!es || es.wall !== wall || !(es.lengthFt > 0.1)) continue;
    spans.push({
      start: es.start,
      end: es.end,
      pitchMatch: false,
      omitMainEaveTrim: true,
      omitMainEaveDrip: true,
    });
  }
  spans.sort((a, b) => a.start - b.start || a.end - b.end);
  // Do not coalesce abutting lean + ell spans when their omit flags differ.
  // OR-ing omitMainEaveDrip across a lean↔wing junction used to carve the
  // host drip (and band) over the lean span as if it were an ell.
  const merged = [];
  for (const s of spans) {
    const last = merged[merged.length - 1];
    const sameOmit =
      last &&
      !!last.omitMainEaveTrim === !!s.omitMainEaveTrim &&
      !!last.omitMainEaveDrip === !!s.omitMainEaveDrip;
    if (!last || s.start > last.end + 0.05 || !sameOmit) {
      merged.push({ ...s });
    } else {
      last.end = Math.max(last.end, s.end);
      last.pitchMatch = !!(last.pitchMatch && s.pitchMatch);
    }
  }
  return merged;
}

/**
 * Free [start,end) segments of a wall not covered by any lean roof.
 * @param {{ forEaveTrim?: boolean, forEaveDrip?: boolean }} [opts]
 *   - `forEaveTrim`: only spans with `omitMainEaveTrim` carve (wall-face band).
 *   - `forEaveDrip`: only spans with `omitMainEaveDrip` carve (outer fascia).
 *   Shed leans never carve the drip — that was the missing section over the lean.
 */
export function mainWallFreeSegments(b, wall, wallLenFt, opts = {}) {
  const wl = Math.max(0, Number(wallLenFt) || wallLength(b, wall));
  const forEaveTrim = opts?.forEaveTrim === true;
  const forEaveDrip = opts?.forEaveDrip === true;
  const occ = leanOccupiedSpansOnWall(b, wall).filter((s) => {
    if (forEaveDrip) return !!s.omitMainEaveDrip;
    if (forEaveTrim) return !!s.omitMainEaveTrim;
    return true;
  });
  const free = [];
  let cursor = 0;
  for (const s of occ) {
    const a = Math.max(0, Math.min(wl, s.start));
    const e = Math.max(0, Math.min(wl, s.end));
    if (a > cursor + 0.05) free.push({ start: cursor, end: a });
    cursor = Math.max(cursor, e);
  }
  if (wl > cursor + 0.05) free.push({ start: cursor, end: wl });
  return free;
}

/**
 * Visual outer eave height (ft) for shed lean 3D (enclosed walls/trim AND
 * open carport posts / eyebrow). Matches js/render/scene.js _addLeanTo:
 * when stored outer is too close to attach for the pitch, the outer wall/roof
 * is dropped so the mono reads. Posts, corner trim, and eyebrow must use THIS
 * height (plus under-roof nest) or they pierce the lean pans up to the stored
 * (too-tall) eave. Takeoff stock still keys off lean.eaveHeight.
 *
 * Same-pitch continuous: outer is clamped to mainE − designRise so a tall
 * stored eave cannot fight a flush attach at the main eave (stepped lip).
 */
export function leanVisualOuterEaveFt(b, lean) {
  if (!lean) return Number(b?.eaveHeight) || 12;
  if ((lean.roofStyle || 'shed') === 'gable') {
    return Number(lean.eaveHeight) || 10;
  }
  const mainE = Number(b?.eaveHeight) || 12;
  const outer = Number(lean.eaveHeight) || 10;
  const depth = Number(lean.depth) || 0;
  const pitch = Number(lean.pitch) || Number(b?.pitch) || 4;
  const designRise = Math.max(
    leanToRoofRise(lean),
    depth * (pitch / 12),
    0.5,
  );
  const attach = leanToAttachHeight(b, lean);
  const continuousOuter = Math.max(8, mainE - designRise);
  // Same threshold as _addLeanTo (0.45′): not enough drop for pitch → drop outer
  if (Math.min(mainE, attach) < outer + 0.45) {
    return continuousOuter;
  }
  // Same-pitch: never leave outer above the continuous plane (fights flush attach)
  if (leanPitchMatchesMain(b, lean) && outer > continuousOuter + 0.05) {
    return continuousOuter;
  }
  return outer;
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
 if (lean && (lean.kind === 'wrap' || lean.kind === 'wrap-lean')) {
 // Sum of both legs along walls (for rough stats); openings use face-specific.
 const wa = wallLength(b, (lean.walls && lean.walls[0]) || lean.wall || 'front');
 const wb = wallLength(b, (lean.walls && lean.walls[1]) || 'left');
 const la = Number(lean.lengthA) > 0 ? Math.min(Number(lean.lengthA), wa) : wa;
 const lb = Number(lean.lengthB) > 0 ? Math.min(Number(lean.lengthB), wb) : wb;
 return la + lb;
 }
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


/** Round ft for stable Advanced Edit part IDs. */
export function roundPartFt(ft, places = 2) {
 const n = Number(ft);
 if (!Number.isFinite(n)) return 0;
 const f = 10 ** places;
 return Math.round(n * f) / f;
}

/** Stable post part id from plan coordinates (ft). */
export function postPartId(x, z, scope = 'main') {
 return `post:${scope}:x${roundPartFt(x)}:z${roundPartFt(z)}`;
}

/** Stable wall metal panel id from wall-local u/v rect (ft). */
export function wallPanelPartId(wall, u0, u1, v0, v1) {
 return `wall-panel:${wall}:u${roundPartFt(u0)}-${roundPartFt(u1)}:v${roundPartFt(v0)}-${roundPartFt(v1)}`;
}

/**
 * Production / Edit-parts id for a ~3′ wall sheathing bay band.
 * Matches getSheathingLayout + 2D Edit: sheathing:{wall}:{i}:{band}
 * where band is full | upper | wainscot | peak.
 */
export function sheathingWallPartId(wall, bayIndex, band = 'full') {
 const i = Math.max(1, Math.round(Number(bayIndex) || 1));
 const b = String(band || 'full').toLowerCase();
 return `sheathing:${wall}:${i}:${b}`;
}

/** 1-based bay index for a wall-local U span (3′ coverage), matching getSheathingLayout. */
export function sheathingBayIndex(u0, u1, coverageFt = 3) {
 const cov = Math.max(0.01, Number(coverageFt) || 3);
 const mid = (Number(u0) + Number(u1)) / 2;
 return Math.max(1, Math.floor(mid / cov) + 1);
}

/** Normalize partOverrides map from saved JSON. */
export function normalizePartOverrides(raw) {
 if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
 const out = {};
 for (const [id, v] of Object.entries(raw)) {
 if (!id || !v || typeof v !== 'object') continue;
 const entry = {};
 if (v.suppressed) entry.suppressed = true;
 if (v.color) entry.color = String(v.color);
 if (v.gauge === '26' || v.gauge === 26) entry.gauge = '26';
 else if (v.gauge === '29' || v.gauge === 29) entry.gauge = '29';
 if (v.note) entry.note = String(v.note).slice(0, 200);
 if (v.label) entry.label = String(v.label).slice(0, 120);
 const wall = String(v.wall || '').toLowerCase();
 if (['front', 'back', 'left', 'right'].includes(wall)) entry.wall = wall;
 if (v.offsetFt != null && v.offsetFt !== '' && Number.isFinite(Number(v.offsetFt))) {
 entry.offsetFt = roundPartFt(Number(v.offsetFt));
 }
 if (Object.keys(entry).length) out[id] = entry;
 }
 return out;
}

export function partOverride(building, partId) {
 if (!building || !partId) return null;
 const map = building.partOverrides;
 if (!map || typeof map !== 'object') return null;
 return map[partId] || null;
}

export function isPartSuppressed(building, partId) {
 return !!partOverride(building, partId)?.suppressed;
}

/**
 * Distance along a wall from the left end (outside face), matching opening offsets.
 * front/back → X; left/right → Z.
 */
export function postOffsetAlongWall(b, wall, x, z) {
 const W = Number(b?.width) || 0;
 const L = Number(b?.length) || 0;
 const xx = Number(x) || 0;
 const zz = Number(z) || 0;
 if (wall === 'front' || wall === 'back') {
 return roundPartFt(Math.max(0, Math.min(W, xx)));
 }
 if (wall === 'left' || wall === 'right') {
 return roundPartFt(Math.max(0, Math.min(L, zz)));
 }
 // Infer wall from position if not provided
 if (Math.abs(zz) < 0.15) return roundPartFt(Math.max(0, Math.min(W, xx)));
 if (Math.abs(zz - L) < 0.15) return roundPartFt(Math.max(0, Math.min(W, xx)));
 if (Math.abs(xx) < 0.15) return roundPartFt(Math.max(0, Math.min(L, zz)));
 if (Math.abs(xx - W) < 0.15) return roundPartFt(Math.max(0, Math.min(L, zz)));
 return roundPartFt(xx);
}

/** Convert wall + offset-from-left (ft) → plan X/Z on that wall line. */
export function wallOffsetToXZ(b, wall, offsetFt) {
 const W = Number(b?.width) || 0;
 const L = Number(b?.length) || 0;
 const u = Number(offsetFt) || 0;
 if (wall === 'front') return { x: Math.max(0, Math.min(W, u)), z: 0 };
 if (wall === 'back') return { x: Math.max(0, Math.min(W, u)), z: L };
 if (wall === 'left') return { x: 0, z: Math.max(0, Math.min(L, u)) };
 if (wall === 'right') return { x: W, z: Math.max(0, Math.min(L, u)) };
 return { x: u, z: 0 };
}

/** Infer primary wall for a post at x/z (corners prefer primaryWall if given). */
export function inferPostWall(b, x, z, preferredWall = null) {
 if (preferredWall && ['front', 'back', 'left', 'right'].includes(preferredWall)) {
 return preferredWall;
 }
 const W = Number(b?.width) || 0;
 const L = Number(b?.length) || 0;
 const xx = Number(x) || 0;
 const zz = Number(z) || 0;
 const eps = 0.2;
 const onFront = Math.abs(zz) < eps;
 const onBack = Math.abs(zz - L) < eps;
 const onLeft = Math.abs(xx) < eps;
 const onRight = Math.abs(xx - W) < eps;
 if (onFront && !onLeft && !onRight) return 'front';
 if (onBack && !onLeft && !onRight) return 'back';
 if (onLeft && !onFront && !onBack) return 'left';
 if (onRight && !onFront && !onBack) return 'right';
 // Corner: prefer eave (left/right) then gable
 if (onLeft) return 'left';
 if (onRight) return 'right';
 if (onFront) return 'front';
 if (onBack) return 'back';
 return 'front';
}

/**
 * Apply Advanced Edit placement override to a generated post.
 * Returns { x, z, wall, offsetFt, partId }.
 */
export function resolvePostWorldPos(b, post) {
 const ox = Number(post.x) || 0;
 const oz = Number(post.z) || 0;
 const partId = postPartId(ox, oz, post.leanToId ? `lean:${post.leanToId}` : 'main');
 const ov = partOverride(b, partId);
 const preferred =
 (ov && ov.wall) ||
 post.primaryWall ||
 (Array.isArray(post.walls) ? post.walls[0] : null) ||
 (post.walls instanceof Set ? [...post.walls][0] : null);
 const wall = inferPostWall(b, ox, oz, preferred);
 let offsetFt =
 ov && ov.offsetFt != null
 ? Number(ov.offsetFt)
 : post.alongFt != null
 ? Number(post.alongFt)
 : postOffsetAlongWall(b, wall, ox, oz);
 const max = wallLength(b, wall);
 offsetFt = Math.max(0, Math.min(max, offsetFt));
 offsetFt = roundPartFt(offsetFt);
 if (ov && ov.offsetFt != null && ov.wall) {
 const pos = wallOffsetToXZ(b, ov.wall || wall, offsetFt);
 return { x: pos.x, z: pos.z, wall: ov.wall || wall, offsetFt, partId, moved: true };
 }
 return { x: ox, z: oz, wall, offsetFt, partId, moved: false };
}


/** Main building uses stud walls (no perimeter posts). */
export function isStudFrame(b) {
 return String(b?.frameSystem || 'post').toLowerCase() === 'stud';
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
 /**
     * Wall framing system:
     * - 'post' = post-frame (default): 6x6 posts + girts + treated skirt
     * - 'stud' = stud-frame: studs + treated bottom plate (no perimeter posts)
     */
 frameSystem: partial.frameSystem === 'stud' ? 'stud' : 'post',
 /** Stud lumber when frameSystem === 'stud'. */
 studSize: ['2x4', '2x6', '2x8'].includes(partial.studSize)
 ? partial.studSize
 : '2x6',
 /** Stud spacing o.c. (inches): 16 or 24. */
 studSpacingIn: [16, 24].includes(Number(partial.studSpacingIn))
 ? Number(partial.studSpacingIn)
 : 16,
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
 /** Roof purlin lumber: '2x4' | '2x6' | '2x8'. Default 2x4; shop package often 2x6. */
 purlinSize: ['2x4', '2x6', '2x8'].includes(partial.purlinSize)
 ? partial.purlinSize
 : '2x4',
 /** Treated skirt at grade — main building perimeter only (not lean-tos). Default 2x6. */
 skirtSize: partial.skirtSize || '2x6',
 /**
     * Post protector sleeves on this building's main posts.
     * Lean-tos / wings / entry gables have their own flags.
     */
 postProtectors: partial.postProtectors ?? false,
 /**
     * Perma-Column precast piers on this building's main posts.
     * Lean-tos / wings / entry gables have their own flags.
     */
 permaColumns: partial.permaColumns ?? false,
 /**
     * @deprecated Prefer openWalls. false = open left+right eaves when openWalls is absent.
     */
 sidewallMetal: partial.sidewallMetal ?? true,
 /**
     * Include exterior roof metal (main + lean/wing roof panels + roof-skin trim).
     * false = omit from 3D/2D skin and takeoff. Default true.
     */
 includeRoofMetal: partial.includeRoofMetal !== false,
 /**
     * Include exterior wall / sidewall metal (main + lean walls + wall-skin trim).
     * Independent of openWalls (drive-through). false = omit skin + BOM. Default true.
     */
 includeWallMetal: partial.includeWallMetal !== false,
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
 /**
     * Independent framed overhangs (inches). Eave = left/right (slope);
     * gable = front/back (rake / fly). Legacy `overhangIn` migrates to both.
     */
 overhangEaveIn: partial.overhangEaveIn ?? partial.overhangIn ?? 0,
 overhangGableIn: partial.overhangGableIn ?? partial.overhangIn ?? 0,
 /** @deprecated convenience — equals overhangEaveIn for back-compat callers. */
 overhangIn: partial.overhangEaveIn ?? partial.overhangIn ?? 0,
 /**
     * Explicit soffit and fascia choices, SPARSE — only what the user changed.
     * Everything absent is derived from the building by js/domain/soffitFascia.js,
     * so an untouched job resolves exactly as it always did and no existing
     * quote moves. Shape: { all?, eave?, rake?, lean?: { soffit?, fascia? } }.
     */
 soffitFascia: normalizeSoffitFascia(partial.soffitFascia),
 /**
     * Raised / energy heel above eave (ft). Adds to post ORDER height only
     * (Doug PBP matrix heel 2′6″ → eave posts cut 22′, peak jambs 26′).
     */
 heelHeightFt: Math.max(0, Number(partial.heelHeightFt) || 0),
 /**
     * Main-building ceiling liner (Arctic / Thrifty panels + FJ). 'yes' | 'none'.
     * Jim PBP matrix: FJ Arctic ×30 + wall FJ Black ×31.
     */
 ceilingLiner: yesLinerFlag(partial.ceilingLiner),
 /** Trim/panel color for ceiling liner FJ (default AR = Arctic). */
 ceilingLinerColor: String(partial.ceilingLinerColor || 'AR').toUpperCase() || 'AR',
 /**
     * Interior wall liner on closed walls. 'yes' | 'none'.
     * Panels from the floor to the roof line, plus base, FJ, J-trim, screws.
     */
 wallLiner: yesLinerFlag(partial.wallLiner),
 wallLinerColor: String(partial.wallLinerColor || 'AR').toUpperCase() || 'AR',
 /**
     * Metal-only overhang past framing (inches). Split eave/gable; legacy
     * `metalOverhangIn` migrates to both. Standard We Build: 3".
     */
 metalOverhangEaveIn: partial.metalOverhangEaveIn ?? partial.metalOverhangIn ?? 3,
 metalOverhangGableIn: partial.metalOverhangGableIn ?? partial.metalOverhangIn ?? 3,
 /** @deprecated convenience — equals metalOverhangEaveIn. */
 metalOverhangIn: partial.metalOverhangEaveIn ?? partial.metalOverhangIn ?? 3,
 /**
     * Always 'auto' in the app — PBP matrix package from geometry (eave ≥ 14′ or lean → full).
     * 'small' | 'full' only for internal regression tests.
     */
 orderPackageMode: ['auto', 'small', 'full'].includes(partial.orderPackageMode)
 ? partial.orderPackageMode
 : 'auto',
 /**
     * Mid-gable post stock when required is ~18.1–18.5′:
     * 'auto' | 'demote18' | 'keep20'. Default auto (width/lean + package rule).
     * Frank PBP matrix 35×50 uses keep20 so mid-gable orders 20′ without breaking
     * 30×40 / 40×40 / 35×55 auto demotion goldens.
     */
 midGablePostPolicy: ['auto', 'demote18', 'keep20'].includes(partial.midGablePostPolicy)
 ? partial.midGablePostPolicy
 : 'auto',
 wallColor: partial.wallColor || 'AL',
 roofColor: partial.roofColor || 'BK',
 /**
     * Metal panel gauge for walls / roof. PBP matrix & yard catalogs use 29 GA default
     * or 26 GA upgrade (e.g. 2640BKQLP / 26GLIFE-MATTEBLACK).
     * Values: '29' | '26'
     */
 wallGauge: partial.wallGauge === 26 || partial.wallGauge === '26' ? '26' : '29',
 roofGauge: partial.roofGauge === 26 || partial.roofGauge === '26' ? '26' : '29',
 /** Exterior metal trim color (ridge, eave, corner, base, etc.) */
 trimColor: partial.trimColor || 'BK',
 /**
     * Per-piece colour choices, SPARSE. Five slots (roof, trim, walls,
     * garageDoor, accent1) plus a per-part override for any individual trim
     * piece. Everything absent inherits, and the slots fall back to the four
     * legacy colour fields above rather than replacing them, so a job saved
     * before this existed resolves to exactly the same colours.
     * Resolved by js/domain/colorPlan.js.
     */
 colorPlan: normalizeColorPlan(partial.colorPlan),
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
     * | 'housewrap' (10'x150' house wrap rolls)
     */
 insulationType:
 partial.insulationType === 'thermaguard' ||
 partial.insulationType === 'both' ||
 partial.insulationType === 'double' ||
 partial.insulationType === 'housewrap'
 ? partial.insulationType === 'double'
 ? 'both'
 : partial.insulationType
 : 'fiberglass3',
 /**
     * OSB sheathing location: 'none' | 'roof' | 'walls' | 'both'
     *
     * Sheathing goes UNDER the metal, it does not replace it: the panels, screws
     * and trim are unchanged and the OSB is an added layer over the purlins and
     * girts. A job that wants OSB instead of metal is a different build and is
     * not what this option does.
     */
 osb: ['roof', 'walls', 'both'].includes(partial.osb) ? partial.osb : 'none',
 /** Panel thickness when osb !== none. */
 osbThickness: ['7/16', '1/2', '5/8'].includes(partial.osbThickness)
 ? partial.osbThickness
 : '7/16',
 /**
     * Which face of the frame the sheathing lands on: 'outside' | 'inside'.
     *
     * Outside is the exterior face of the posts and girts, with the metal over
     * it — the usual structural sheathing. Inside is the interior face, a solid
     * surface inside the shop, still with the metal on the outside of the frame.
     * It changes nothing about how much OSB a wall takes and everything about
     * where the crew hangs it, which is why it rides on the line rather than in
     * the quantity.
     */
 osbSide: partial.osbSide === 'inside' ? 'inside' : 'outside',
 hasSlab: partial.hasSlab ?? false,
 slabThicknessIn: partial.slabThicknessIn ?? 4,
 /**
     * Site placement for multi-building layouts (ft).
     * On an ell these are DERIVED from the attachment below and overwritten by
     * resolveEllPlacements before each rebuild — set attachWall/attachOffset,
     * not these.
     */
 siteX: partial.siteX ?? 0,
 siteZ: partial.siteZ ?? 0,
 rotationDeg: partial.rotationDeg ?? 0,
 /**
     * Ell attachment: this building is a WING butted to another building,
     * sharing a roof junction with it. Null for a standalone building, which is
     * everything that existed before ells.
     *
     * A wing is a building in its own right — own posts, trusses, walls — not a
     * lean-to borrowing the host's structure. That is the whole difference.
     */
 attachedTo: partial.attachedTo || null,
 /** Which host wall the wing butts: left | right (valley) | front | back. */
 attachWall: ELL_ATTACH_WALLS.includes(partial.attachWall)
 ? partial.attachWall
 : 'left',
 /** Wing's near edge measured along that wall from its origin corner (ft). */
 attachOffset: Math.max(0, Number(partial.attachOffset) || 0),
 /**
     * Advanced Edit overrides keyed by stable partId
     * (post:… / wall-panel:…). Values: { suppressed?, color?, gauge?, note? }.
     */
 partOverrides: normalizePartOverrides(partial.partOverrides),
 openings: (partial.openings || []).map(createOpening),
 /** Cross gables over entries — roof features, not buildings or lean-tos. */
 crossGables: (partial.crossGables || []).map(createCrossGable),
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
 /** One-way loaded miles for freight ($4.50/mi). */
 freightMiles: partial.freightMiles ?? 0,
 /** Donkey / unload fee $ (typically 50–75). */
 freightDonkeyFee: partial.freightDonkeyFee ?? 50,
 /**
  * Truck count override. 0 / unset = auto from material weight ÷ maxLbPerTruck.
  * Manual value ≥ 1 overrides the suggestion.
  */
 freightTrucks: partial.freightTrucks ?? 0,
 /** States passed through for oversize permit ($100 each). */
 freightPermitStates: partial.freightPermitStates ?? 0,
 /** Number of freight escorts. */
 freightEscorts: partial.freightEscorts ?? 0,
 /** Unit cost per escort ($). */
 freightEscortRate: partial.freightEscortRate ?? 0,
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

/** Non-negative inch helper. */
function inchesOr(v, fallback = 0) {
 const n = Number(v);
 return Number.isFinite(n) ? Math.max(0, n) : fallback;
}

/**
 * Framed (wood) eave overhang in inches.
 * Migrates legacy `overhangIn` when `overhangEaveIn` is absent.
 * Eave = left/right for gable (and mono high/low); drives rafter / slope run.
 */
export function frameOverhangEaveIn(b) {
 if (b?.overhangEaveIn != null && Number.isFinite(Number(b.overhangEaveIn))) {
  return inchesOr(b.overhangEaveIn, 0);
 }
 return inchesOr(b?.overhangIn, 0);
}

/**
 * Framed (wood) gable / rake overhang in inches.
 * Migrates legacy `overhangIn` when `overhangGableIn` is absent.
 * Gable = front/back; drives fly rafters / roof length past gable ends.
 */
export function frameOverhangGableIn(b) {
 if (b?.overhangGableIn != null && Number.isFinite(Number(b.overhangGableIn))) {
  return inchesOr(b.overhangGableIn, 0);
 }
 return inchesOr(b?.overhangIn, 0);
}

/** Metal-only eave overhang inches (default 3″). */
export function metalOverhangEaveIn(b) {
 if (b?.metalOverhangEaveIn != null && Number.isFinite(Number(b.metalOverhangEaveIn))) {
  return inchesOr(b.metalOverhangEaveIn, 3);
 }
 const m = Number(b?.metalOverhangIn);
 return Number.isFinite(m) ? Math.max(0, m) : 3;
}

/** Metal-only gable / rake overhang inches (default 3″). */
export function metalOverhangGableIn(b) {
 if (b?.metalOverhangGableIn != null && Number.isFinite(Number(b.metalOverhangGableIn))) {
  return inchesOr(b.metalOverhangGableIn, 3);
 }
 const m = Number(b?.metalOverhangIn);
 return Number.isFinite(m) ? Math.max(0, m) : 3;
}

/** Eave total (frame + metal) overhang in feet — slope / rafter projection. */
export function totalEaveOverhangFt(b) {
 return (frameOverhangEaveIn(b) + metalOverhangEaveIn(b)) / 12;
}

/** Gable / rake total (frame + metal) overhang in feet — along building length. */
export function totalGableOverhangFt(b) {
 return (frameOverhangGableIn(b) + metalOverhangGableIn(b)) / 12;
}

/**
 * Structural + metal overhang in feet (panel projection on the eave / slope).
 * Alias of totalEaveOverhangFt for back-compat callers.
 */
export function totalRoofOverhangFt(b) {
 return totalEaveOverhangFt(b);
}

/** One-side rafter / roof-panel length including eave metal overhang (ft). */
export function rafterLength(b) {
 const oh = totalEaveOverhangFt(b);
 if (b.roofStyle === 'mono') {
 const run = b.width + oh;
 const rise = b.width * (b.pitch / 12);
 return Math.hypot(run, rise);
 }
 // Gable: half-span run + eave oh, rise on the building half-width (pitch on frame)
 const half = b.width / 2;
 const run = half + oh;
 const rise = half * (b.pitch / 12);
 return Math.hypot(run, rise);
}

export function roofAreaSqFt(b) {
 const ohEave = frameOverhangEaveIn(b) / 12;
 const ohGable = frameOverhangGableIn(b) / 12;
 const rafter = rafterLength(b);
 // Length extension is gable OH (front/back); slope already includes eave OH.
 if (b.roofStyle === 'mono') return rafter * (b.length + 2 * ohGable);
 return 2 * rafter * (b.length + 2 * ohGable);
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

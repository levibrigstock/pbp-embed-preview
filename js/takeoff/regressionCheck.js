/**
 * Multi-size production regression checks (golden size matrix).
 *
 * Goal: one shared rules engine → same results as SB at every calibrated size.
 * When a size fails, fix the RULE (productionPolicy / engine), not a one-off.
 *
 * Matrix:
 *   30×40×12 plain  — SB plain shop (sheathing, framing, trim, accessories)
 *   40×40×12 plain  — SB plain shop (sheathing ladder + accessories)
 *   40×60×14 mid    — scale sanity (gates, counts grow)
 *   Levi 55×80+lean — full production scorecard
 */

import {
  createProject,
  createBuilding,
  createLeanTo,
  createOpening,
} from '../domain/types.js?v=20260806f';
import { takeoffProject } from './engine.js?v=20260806f';
import { buildLeviReferenceProject, runLeviScorecard } from './scorecard.js?v=20260806f';
import { describePolicyForBuilding } from '../domain/productionPolicy.js?v=20260806f';

function qtyAt(items, usage, lengthStartsWith) {
  return (items || [])
    .filter((i) => i.usage === usage)
    .filter((i) => {
      if (!lengthStartsWith) return true;
      const L = String(i.length || '');
      return L === lengthStartsWith || L.startsWith(lengthStartsWith);
    })
    .reduce((s, i) => s + (Number(i.qty) || 0), 0);
}

/** Sum qty for usage (all lengths). */
function qtyUsage(items, usage) {
  return qtyAt(items, usage, null);
}

function check(name, actual, expected) {
  const ok = actual === expected;
  return {
    name,
    actual,
    expected,
    ok,
    delta: actual - expected,
  };
}

/** Plain shop defaults shared by 30×40 / 40×40 SB lists. */
function plainShopBuilding(partial) {
  return createBuilding({
    eaveHeight: 12,
    pitch: 4,
    roofStyle: 'gable',
    postSpacing: 10,
    postDepthFt: 3,
    trussSpacing: 5,
    girtSpacingIn: 24,
    purlinSpacingIn: 24,
    metalOverhangIn: 3,
    overhangIn: 0,
    wallColor: 'AL',
    roofColor: 'BK',
    trimColor: 'BK',
    wainscotColor: 'NONE',
    trussCarrierSize: '2x10',
    openings: [],
    leanTos: [],
    ...partial,
  });
}

/** 30×40×12 plain — SB framing + sheathing + accessories */
export function check30x40() {
  const b = plainShopBuilding({ width: 30, length: 40 });
  const items = takeoffProject(createProject({ buildings: [b] })).items || [];
  const policy = describePolicyForBuilding(b);
  const rows = [
    // Framing
    check('Girt 20\'', qtyAt(items, 'Girt', "20"), 35),
    check('Purlin 16\'', qtyAt(items, 'Purlin', "16"), 36),
    check('Purlin 12\'', qtyAt(items, 'Purlin', "12"), 18),
    check('Post 16\'', qtyAt(items, 'Post', "16"), 10),
    // Mid-gable: req ~18.33′ → 18′ with shortfall allowance (SB-aligned)
    check('Post 18\'', qtyAt(items, 'Post', "18"), 4),
    check('No Post 20\'', qtyAt(items, 'Post', "20"), 0),
    check('TrussBlock', qtyAt(items, 'TrussBlock', "12"), 1),
    check('TrussBearer 20\'', qtyAt(items, 'TrussBearer', "20"), 8),
    check('Skirt 20\'', qtyAt(items, 'SkirtBoard', "20"), 7), // peri 140/20; no door deduct
    // Sheathing
    check('Roof 16\'2"', qtyAt(items, 'ExteriorRoof', "16' 2"), 29),
    check('Eave wall 12\'8"', qtyAt(items, 'ExteriorWall', "12' 8"), 28),
    check('Gable 18\'2"', qtyAt(items, 'ExteriorWall', "18' 2"), 4),
    // Trim (SB plain package — no fascia/TOW)
    check('RidgeCap 10\'', qtyAt(items, 'RidgeCap', "10"), 5),
    check('EaveEdge 10\'', qtyAt(items, 'EaveEdge', "10"), 9),
    check('Corner 14\'', qtyAt(items, 'Corner', "14"), 4),
    check('GableEdge 16\'', qtyAt(items, 'GableEdge', "16"), 4),
    check('Base 10\'', qtyAt(items, 'Base', "10"), 15),
    check('No EaveFascia', qtyAt(items, 'EaveFascia', null), 0),
    check('No GableFascia', qtyAt(items, 'GableFascia', null), 0),
    check('No TopOfWall', qtyAt(items, 'TopOfWall', null), 0),
    check('No EaveSubFascia', qtyAt(items, 'EaveSubFascia', null), 0),
    check('No GableSubFascia', qtyAt(items, 'GableSubFascia', null), 0),
    check('No fly Rafter', qtyAt(items, 'Rafter', null), 0),
    check('No EndRafter', qtyAt(items, 'EndRafter', null), 0),
    // Accessories (same rules as 40×40; bag rates scale with area)
    check('FastenersRoof bags', qtyUsage(items, 'FastenersRoof'), 5),
    check('FastenersWall bags', qtyUsage(items, 'FastenersWall'), 7),
    check('FastenersRidgeCap bags', qtyUsage(items, 'FastenersRidgeCap'), 1),
    check('FastenersTrim bags', qtyUsage(items, 'FastenersTrim'), 2),
    check('ButylTape', qtyUsage(items, 'ButylTape'), 10),
    check('ClosuresInside', qtyUsage(items, 'ClosuresInside'), 27),
    check('ClosuresOutside', qtyUsage(items, 'ClosuresOutside'), 27),
    check('TorqueBitBucket', qtyUsage(items, 'TorqueBitBucket'), 2),
    check('TimberHexScrew', qtyUsage(items, 'TimberHexScrew'), 1),
    check('Nails16D', qtyUsage(items, 'Nails16D'), 1),
    check('Nails40D', qtyUsage(items, 'Nails40D'), 1),
  ];
  return {
    job: '30×40×12 plain (SB)',
    policy,
    rows,
    pass: rows.every((r) => r.ok),
    passCount: rows.filter((r) => r.ok).length,
    total: rows.length,
  };
}

/**
 * 40×40×12 plain 4/12 3″ OH — SB sheathing + accessories (golden).
 * Locks the size-general rules that previously drifted (roof 21′6″, gable ladder @4).
 */
export function check40x40() {
  const b = plainShopBuilding({ width: 40, length: 40 });
  const items = takeoffProject(createProject({ buildings: [b] })).items || [];
  const policy = describePolicyForBuilding(b);
  const rows = [
    // Sheathing — exact SB Job Review lines
    check('Roof 21\'6"', qtyAt(items, 'ExteriorRoof', "21' 6"), 29),
    check('Eave wall 12\'8"', qtyAt(items, 'ExteriorWall', "12' 8"), 28),
    check('Gable 19\'10"', qtyAt(items, 'ExteriorWall', "19' 10"), 4),
    check('Gable 18\'10"', qtyAt(items, 'ExteriorWall', "18' 10"), 4),
    check('Gable 17\'10"', qtyAt(items, 'ExteriorWall', "17' 10"), 4),
    check('Gable 16\'10"', qtyAt(items, 'ExteriorWall', "16' 10"), 4),
    check('Gable 15\'10"', qtyAt(items, 'ExteriorWall', "15' 10"), 4),
    check('Gable 14\'10"', qtyAt(items, 'ExteriorWall', "14' 10"), 4),
    check('Gable 13\'10"', qtyAt(items, 'ExteriorWall', "13' 10"), 4),
    // No fragmented gable inch-steps (was 14 lines @ qty 2)
    check('Gable line count = 7', (items || []).filter((i) => i.usage === 'ExteriorWall' && /Gable/i.test(i.description || '')).length, 7),
    // Accessories — SB Accessories tab (AL wall / BK roof)
    check('FastenersRoof 15MWBK', qtyUsage(items, 'FastenersRoof'), 6),
    check('FastenersWall 15MWAL', qtyUsage(items, 'FastenersWall'), 8),
    check('FastenersRidgeCap 2MW', qtyUsage(items, 'FastenersRidgeCap'), 1),
    check('FastenersTrim', qtyUsage(items, 'FastenersTrim'), 2),
    check('ButylTape 10', qtyUsage(items, 'ButylTape'), 10),
    check('ClosuresInside 27', qtyUsage(items, 'ClosuresInside'), 27),
    check('ClosuresOutside 27', qtyUsage(items, 'ClosuresOutside'), 27),
    check('TorqueBitBucket 2', qtyUsage(items, 'TorqueBitBucket'), 2),
    check('TimberHexScrew 1', qtyUsage(items, 'TimberHexScrew'), 1),
    check('Nails16D 1', qtyUsage(items, 'Nails16D'), 1),
    check('Nails40D 1', qtyUsage(items, 'Nails40D'), 1),
    // Framing — SB 40×40 framing tab
    check('Post 16\'', qtyAt(items, 'Post', "16"), 10),
    check('Post 18\' (mid-gable)', qtyAt(items, 'Post', "18"), 4),
    check('No Post 20\'', qtyAt(items, 'Post', "20"), 0),
    check('Post 24\' (peaks)', qtyAt(items, 'Post', "24"), 2),
    check('No Post 22\'', qtyAt(items, 'Post', "22"), 0),
    check('Girt 20\'', qtyAt(items, 'Girt', "20"), 40),
    check('Purlin 16\'', qtyAt(items, 'Purlin', "16"), 48),
    check('Purlin 12\'', qtyAt(items, 'Purlin', "12"), 24),
    check('TrussBearer 20\'', qtyAt(items, 'TrussBearer', "20"), 8),
    check('Skirt 20\'', qtyAt(items, 'SkirtBoard', "20"), 8),
    check('TrussBlock', qtyUsage(items, 'TrussBlock'), 1),
    // Plain package gates (same rules as 30×40)
    check('Small-shop girt (no eave row)', policy.girtIncludeEave ? 0 : 1, 1),
    check('No EaveFascia', qtyUsage(items, 'EaveFascia'), 0),
    check('No TopOfWall', qtyUsage(items, 'TopOfWall'), 0),
  ];
  return {
    job: '40×40×12 plain (SB golden)',
    policy,
    rows,
    pass: rows.every((r) => r.ok),
    passCount: rows.filter((r) => r.ok).length,
    total: rows.length,
  };
}

/** Levi reference — full scorecard + key SB framing lines */
export function checkLevi() {
  const sc = runLeviScorecard();
  const items = sc.takeoff?.items || [];
  const b = buildLeviReferenceProject().buildings[0];
  const policy = describePolicyForBuilding(b);
  const rows = [
    check('Scorecard 100%', sc.report.fail === 0 ? 1 : 0, 1),
    check('Girt 20\'', qtyAt(items, 'Girt', "20"), 130),
    check('Purlin 16\'', qtyAt(items, 'Purlin', "16"), 158),
    check('Purlin 12\'', qtyAt(items, 'Purlin', "12"), 43),
    check('Roof 38\'4"', qtyAt(items, 'ExteriorRoof', "38' 4"), 28),
    check('Roof 29\'11"', qtyAt(items, 'ExteriorRoof', "29' 11"), 27),
    check('Header 12\'', qtyAt(items, 'Header', "12"), 5),
    check('Trimmer 12\'', qtyAt(items, 'Trimmer', "12"), 2),
    check('RidgeCap 10\'', qtyAt(items, 'RidgeCap', "10"), 10),
    check('EaveEdge 10\'', qtyAt(items, 'EaveEdge', "10"), 18),
    check('EaveFascia 10\'', qtyAt(items, 'EaveFascia', "10"), 18),
    check('GableFascia 10\'', qtyAt(items, 'GableFascia', "10"), 15),
    check('TopOfWall 10\'', qtyAt(items, 'TopOfWall', "10"), 31),
    check('Base 10\'', qtyAt(items, 'Base', "10"), 38),
    check('WainscotTrim 10\'', qtyAt(items, 'WainscotTrim', "10"), 37),
    check('EaveSubFascia present', qtyAt(items, 'EaveSubFascia', null) > 0 ? 1 : 0, 1),
    check('Rafter fly present', qtyAt(items, 'Rafter', "12"), 15),
    check('EndRafter', qtyAt(items, 'EndRafter', "12"), 2),
  ];
  return {
    job: 'Levi 55×80×14 + lean + openings',
    policy,
    scorecard: `${sc.report.pass}/${sc.report.total}`,
    rows,
    pass: rows.every((r) => r.ok),
    passCount: rows.filter((r) => r.ok).length,
    total: rows.length,
  };
}

/**
 * Mid-size 40×60×14 — scale sanity (full package gates fire at eave 14′).
 * Not a full SB dump; proves counts grow and rules still run.
 */
export function check40x60() {
  const b = createBuilding({
    width: 40,
    length: 60,
    eaveHeight: 14,
    pitch: 4,
    postSpacing: 10,
    postDepthFt: 3,
    metalOverhangIn: 6,
    overhangIn: 0,
    wainscotColor: 'NONE',
    trussCarrierSize: '2x10',
    wallColor: 'AL',
    roofColor: 'BK',
    trimColor: 'BK',
  });
  const items = takeoffProject(createProject({ buildings: [b] })).items || [];
  const policy = describePolicyForBuilding(b);
  const girt = qtyAt(items, 'Girt', "20");
  const purlin = qtyAt(items, 'Purlin', null);
  const roof = qtyAt(items, 'ExteriorRoof', null);
  const wallF = qtyUsage(items, 'FastenersWall');
  const roofF = qtyUsage(items, 'FastenersRoof');
  const rows = [
    check('Full girt package (eave≥14)', policy.girtIncludeEave ? 1 : 0, 1),
    check('Girt qty > 30×40', girt > 35 ? 1 : 0, 1),
    check('Purlin qty > 0', purlin > 0 ? 1 : 0, 1),
    check('Roof qty = 2*ceil(60/3)+1', roof, 2 * Math.ceil(60 / 3) + 1),
    check('TrussBlock = ceil(60/40)', qtyAt(items, 'TrussBlock', "12"), 2),
    check('Posts exist', qtyAt(items, 'Post', null) >= 12 ? 1 : 0, 1),
    // Accessories scale up from 40×40 plain
    check('Roof fastener bags ≥ 40×40', roofF >= 6 ? 1 : 0, 1),
    check('Wall fastener bags ≥ 40×40', wallF >= 8 ? 1 : 0, 1),
    check('Ridge fasteners ≥ 1', qtyUsage(items, 'FastenersRidgeCap') >= 1 ? 1 : 0, 1),
    check('EaveFascia present (full pkg)', qtyUsage(items, 'EaveFascia') > 0 ? 1 : 0, 1),
  ];
  return {
    job: '40×60×14 mid-size (scale sanity)',
    policy,
    detail: { girt, purlin, roof, wallF, roofF },
    rows,
    pass: rows.every((r) => r.ok),
    passCount: rows.filter((r) => r.ok).length,
    total: rows.length,
  };
}

/**
 * 60×60×10 plain 4/12 3″ OH — SB framing tab (golden).
 * Posts/girts/skirt/bearer match SB. Small-shop package (eave 10′ → no fly/subfascia).
 */
export function check60x60() {
  const b = plainShopBuilding({
    width: 60,
    length: 60,
    eaveHeight: 10,
    postSpacing: 10,
    postDepthFt: 3,
    metalOverhangIn: 3,
  });
  const items = takeoffProject(createProject({ buildings: [b] })).items || [];
  const policy = describePolicyForBuilding(b);
  const rows = [
    // Posts — exact SB
    check('Post 14\'', qtyAt(items, 'Post', "14"), 14),
    check('Post 18\'', qtyAt(items, 'Post', "18"), 4),
    check('Post 22\'', qtyAt(items, 'Post', "22"), 4),
    check('Post 24\'', qtyAt(items, 'Post', "24"), 2),
    // Girts / skirt / bearer / block — exact SB
    check('Girt 20\'', qtyAt(items, 'Girt', "20"), 48),
    check('Skirt 20\'', qtyAt(items, 'SkirtBoard', "20"), 12),
    check('TrussBearer 20\'', qtyAt(items, 'TrussBearer', "20"), 12),
    check('TrussBlock', qtyUsage(items, 'TrussBlock'), 2),
    // Small-shop package (eave 10′ plain — not full just because L=60)
    check('Small-shop girts (no eave row)', policy.girtIncludeEave ? 0 : 1, 1),
    check('No EaveSubFascia', qtyUsage(items, 'EaveSubFascia'), 0),
    check('No GableSubFascia', qtyUsage(items, 'GableSubFascia'), 0),
    check('No fly Rafter', qtyUsage(items, 'Rafter'), 0),
    check('No EndRafter', qtyUsage(items, 'EndRafter'), 0),
    // Purlins — staggered upgrade + mid-length stubs (SB 118@16 + 27@12)
    check('Purlin 16\'', qtyAt(items, 'Purlin', "16"), 118),
    check('Purlin 12\'', qtyAt(items, 'Purlin', "12"), 27),
    // Sheathing — SB 60×60×10
    check('Roof 32\'0"', qtyAt(items, 'ExteriorRoof', "32'"), 41),
    check('Eave wall 10\'8"', qtyAt(items, 'ExteriorWall', "10' 8"), 40),
    check('Gable 21\'2"', qtyAt(items, 'ExteriorWall', "21' 2"), 4),
    check('Gable 12\'2"', qtyAt(items, 'ExteriorWall', "12' 2"), 4),
  ];
  return {
    job: '60×60×10 plain (SB golden)',
    policy,
    rows,
    pass: rows.every((r) => r.ok),
    passCount: rows.filter((r) => r.ok).length,
    total: rows.length,
  };
}

/**
 * 60×60×10 reference openings layout (P1 golden) — locked to SB framing dump.
 *
 * Layout (exact jamb stock match to SB 4@14 + 1@18 + 1@20 + 1@22 + 1@24):
 *   - Front OH 10×10 @14′ and @32′
 *   - Left walk 3×6.67 @5′
 *   - Right walk 3×6.67 @5′
 *
 * Package: Girt 44 (48 − 4 doors), Header 2×2x12 + 5×2x6, Purlin 118/27,
 * Post 14/18/22/24 = 14/4/2/2, 6x6 total 30 (22 Post + 8 Jamb).
 */
export function build60x60OpeningsBuilding() {
  return plainShopBuilding({
    width: 60,
    length: 60,
    eaveHeight: 10,
    postSpacing: 10,
    postDepthFt: 3,
    metalOverhangIn: 3,
    openings: [
      createOpening({
        type: 'overhead',
        wall: 'front',
        offset: 14,
        width: 10,
        height: 10,
        sillHeight: 0,
      }),
      createOpening({
        type: 'overhead',
        wall: 'front',
        offset: 32,
        width: 10,
        height: 10,
        sillHeight: 0,
      }),
      createOpening({
        type: 'walk',
        wall: 'left',
        offset: 5,
        width: 3,
        height: 6.67,
        sillHeight: 0,
      }),
      createOpening({
        type: 'walk',
        wall: 'right',
        offset: 5,
        width: 3,
        height: 6.67,
        sillHeight: 0,
      }),
    ],
  });
}

export function check60x60Openings() {
  const b = build60x60OpeningsBuilding();
  const items = takeoffProject(createProject({ buildings: [b] })).items || [];
  const policy = describePolicyForBuilding(b);
  const rows = [
    // Package / openings lumber
    check('Small-shop package', policy.girtIncludeEave ? 0 : 1, 1),
    // Long continuous: RO width×levels/20 (doors 10+10+3+3=26, 4 rows → floor(104/20)=5 → 43)
    check('Girt 20\' (width×levels deduct)', qtyAt(items, 'Girt', "20"), 43),
    // Headers: 2 OH × (1×2x12 + 2×2x6) + 2 walks × 2×2x6 = 2@2x12 + 8@2x6
    check('Header 2x12 present', qtyAt(items, 'Header', "12") >= 2 ? 1 : 0, 1),
    check('Header total 12\'', qtyAt(items, 'Header', "12"), 10),
    check('No Trimmer (small-shop)', qtyUsage(items, 'Trimmer'), 0),
    check('No Sill (small-shop)', qtyUsage(items, 'Sill'), 0),
    check('No Backing (small-shop)', qtyUsage(items, 'Backing'), 0),
    // Purlins / bearer / skirt / block
    check('Purlin 16\'', qtyAt(items, 'Purlin', "16"), 118),
    check('Purlin 12\'', qtyAt(items, 'Purlin', "12"), 27),
    check('TrussBearer 20\'', qtyAt(items, 'TrussBearer', "20"), 12),
    // Even L + grade doors: SB −1 skirt (240/20 → 11)
    check('Skirt 20\'', qtyAt(items, 'SkirtBoard', "20"), 11),
    check('TrussBlock', qtyUsage(items, 'TrussBlock'), 2),
    // Posts — SB matched openings dump
    check('Post 14\'', qtyAt(items, 'Post', "14"), 14),
    check('Post 18\'', qtyAt(items, 'Post', "18"), 4),
    check('Post 22\'', qtyAt(items, 'Post', "22"), 2),
    check('Post 24\'', qtyAt(items, 'Post', "24"), 2),
    // Jambs — eave stock = wall stock (no −2 step); low-gable may still mix
    check('JambPost 14\'', qtyAt(items, 'JambPost', "14"), 4),
    check('JambPost 18\'', qtyAt(items, 'JambPost', "18"), 1),
    check('JambPost 20\'', qtyAt(items, 'JambPost', "20"), 1),
    check('JambPost 22\'', qtyAt(items, 'JambPost', "22"), 1),
    check('JambPost 24\'', qtyAt(items, 'JambPost', "24"), 1),
    check('No JambPost 16\'', qtyAt(items, 'JambPost', "16"), 0),
    check('6x6 total 30', qtyUsage(items, 'Post') + qtyUsage(items, 'JambPost'), 30),
  ];
  return {
    job: '60×60×10 openings reference (SB golden)',
    policy,
    rows,
    pass: rows.every((r) => r.ok),
    passCount: rows.filter((r) => r.ok).length,
    total: rows.length,
  };
}

/**
 * 60×60×12 + 3×10×10 eave OH — SB framing dump.
 * Layout: left eave OH @5′, @15′ (shared jamb), @31′.
 * Locks: mid-gable 20′ (wide), girt width×levels, skirt −1 even L, bearer +1 multi-OH,
 * half-bay stub join (spacing/2), off-grid-only JambPost.
 */
export function build60x60x12OpeningsBuilding() {
  return plainShopBuilding({
    width: 60,
    length: 60,
    eaveHeight: 12,
    postSpacing: 10,
    postDepthFt: 3,
    metalOverhangIn: 3,
    openings: [
      createOpening({
        type: 'overhead',
        wall: 'left',
        offset: 5,
        width: 10,
        height: 10,
        sillHeight: 0,
      }),
      createOpening({
        type: 'overhead',
        wall: 'left',
        offset: 15,
        width: 10,
        height: 10,
        sillHeight: 0,
      }),
      createOpening({
        type: 'overhead',
        wall: 'left',
        offset: 31,
        width: 10,
        height: 10,
        sillHeight: 0,
      }),
    ],
  });
}

export function check60x60x12Openings() {
  const b = build60x60x12OpeningsBuilding();
  const items = takeoffProject(createProject({ buildings: [b] })).items || [];
  const policy = describePolicyForBuilding(b);
  const rows = [
    check('Small-shop package', policy.girtIncludeEave ? 0 : 1, 1),
    check('Post 16\'', qtyAt(items, 'Post', "16"), 10),
    check('Post 20\' (mid-gable wide)', qtyAt(items, 'Post', "20"), 4),
    check('No Post 18\'', qtyAt(items, 'Post', "18"), 0),
    check('Post 24\' total', qtyAt(items, 'Post', "24"), 6),
    check('JambPost 16\'', qtyAt(items, 'JambPost', "16"), 5),
    check('JambPost total 5', qtyUsage(items, 'JambPost'), 5),
    check('Header total 12\'', qtyAt(items, 'Header', "12"), 9),
    check('Girt 20\'', qtyAt(items, 'Girt', "20"), 53),
    check('TrussBearer 20\'', qtyAt(items, 'TrussBearer', "20"), 13),
    check('Skirt 20\'', qtyAt(items, 'SkirtBoard', "20"), 11),
    check('Purlin 16\'', qtyAt(items, 'Purlin', "16"), 118),
    check('Purlin 12\'', qtyAt(items, 'Purlin', "12"), 27),
    check('TrussBlock', qtyUsage(items, 'TrussBlock'), 2),
  ];
  return {
    job: '60×60×12 3 OH eave (SB golden)',
    policy,
    rows,
    pass: rows.every((r) => r.ok),
    passCount: rows.filter((r) => r.ok).length,
    total: rows.length,
  };
}

/**
 * 35×55×12 + 3×10×10 eave OH — SB framing dump.
 * Layout: left eave OH @8′, @22.5′, @37′.
 */
export function build35x55OpeningsBuilding() {
  return plainShopBuilding({
    width: 35,
    length: 55,
    eaveHeight: 12,
    postSpacing: 10,
    postDepthFt: 3,
    metalOverhangIn: 3,
    openings: [
      createOpening({
        type: 'overhead',
        wall: 'left',
        offset: 8,
        width: 10,
        height: 10,
        sillHeight: 0,
      }),
      createOpening({
        type: 'overhead',
        wall: 'left',
        offset: 22.5,
        width: 10,
        height: 10,
        sillHeight: 0,
      }),
      createOpening({
        type: 'overhead',
        wall: 'left',
        offset: 37,
        width: 10,
        height: 10,
        sillHeight: 0,
      }),
    ],
  });
}

export function check35x55Openings() {
  const b = build35x55OpeningsBuilding();
  const items = takeoffProject(createProject({ buildings: [b] })).items || [];
  const policy = describePolicyForBuilding(b);
  const rows = [
    check('Small-shop package', policy.girtIncludeEave ? 0 : 1, 1),
    check('Post 16\'', qtyAt(items, 'Post', "16"), 9),
    check('Post 18\' (mid-gable narrow)', qtyAt(items, 'Post', "18"), 4),
    check('Post 22\'', qtyAt(items, 'Post', "22"), 2),
    check('No Post 20\'', qtyAt(items, 'Post', "20"), 0),
    check('JambPost 16\'', qtyAt(items, 'JambPost', "16"), 6),
    check('Header total 12\'', qtyAt(items, 'Header', "12"), 9),
    check('Girt 20\'', qtyAt(items, 'Girt', "20"), 41),
    check('TrussBearer 20\'', qtyAt(items, 'TrussBearer', "20"), 13),
    check('Skirt 20\'', qtyAt(items, 'SkirtBoard', "20"), 9),
    check('Purlin 16\'', qtyAt(items, 'Purlin', "16"), 60),
    check('Purlin 12\'', qtyAt(items, 'Purlin', "12"), 20),
    check('TrussBlock', qtyUsage(items, 'TrussBlock'), 2),
  ];
  return {
    job: '35×55×12 3 OH eave (SB golden)',
    policy,
    rows,
    pass: rows.every((r) => r.ok),
    passCount: rows.filter((r) => r.ok).length,
    total: rows.length,
  };
}

/**
 * Layout invariance: same door widths/count on a 60×60×12 eave wall must keep
 * packing (girt/skirt/bearer/header/purlin) fixed while posts/jambs may vary
 * with offsets. Spot-checks off-grid vs on-grid JambPost counts.
 */
export function checkLayoutInvariants() {
  const layouts = [
    [5, 25, 45],
    [5, 15, 31],
    [5, 15, 38],
    [8, 22, 40],
    [10, 25, 40],
    [3, 20, 40],
    [7, 17, 35],
    [12, 30, 48],
    [4, 14, 34],
    [6, 26, 46],
  ];
  const packs = [];
  const rows = [];
  for (const offs of layouts) {
    const b = plainShopBuilding({
      width: 60,
      length: 60,
      eaveHeight: 12,
      postSpacing: 10,
      postDepthFt: 3,
      metalOverhangIn: 3,
      openings: offs.map((o) =>
        createOpening({
          type: 'overhead',
          wall: 'left',
          offset: o,
          width: 10,
          height: 10,
          sillHeight: 0,
        }),
      ),
    });
    const items = takeoffProject(createProject({ buildings: [b] })).items || [];
    packs.push({
      girt: qtyAt(items, 'Girt', "20"),
      skirt: qtyAt(items, 'SkirtBoard', "20"),
      bearer: qtyAt(items, 'TrussBearer', "20"),
      header: qtyAt(items, 'Header', "12"),
      p16: qtyAt(items, 'Purlin', "16"),
      p12: qtyAt(items, 'Purlin', "12"),
    });
  }
  const key0 = JSON.stringify(packs[0]);
  const packStable = packs.every((p) => JSON.stringify(p) === key0);
  rows.push(check('Packing stable across 10 layouts', packStable ? 1 : 0, 1));
  rows.push(check('Girt 53 (3×10′ OH)', packs[0].girt, 53));
  rows.push(check('Skirt 11', packs[0].skirt, 11));
  rows.push(check('Bearer 13', packs[0].bearer, 13));
  rows.push(check('Header 9', packs[0].header, 9));
  rows.push(check('Purlin 118/27', packs[0].p16 === 118 && packs[0].p12 === 27 ? 1 : 0, 1));

  const jambCount = (offs) => {
    const b = plainShopBuilding({
      width: 60,
      length: 60,
      eaveHeight: 12,
      openings: offs.map((o) =>
        createOpening({
          type: 'overhead',
          wall: 'left',
          offset: o,
          width: 10,
          height: 10,
          sillHeight: 0,
        }),
      ),
    });
    return qtyUsage(takeoffProject(createProject({ buildings: [b] })).items || [], 'JambPost');
  };
  // 10-20 + 40-50 on grid; only 25-35 off → 2 jambs
  rows.push(check('On-grid OH pair → 2 JambPost', jambCount([10, 25, 40]), 2));
  // 40-50 on grid; 5-15 + 25-35 off → 4 jambs
  rows.push(check('Mixed on/off-grid → 4 JambPost', jambCount([5, 25, 40]), 4));
  // Adjacent pair + isolated → 5 unique off-grid jambs
  rows.push(check('Adjacent+isolated → 5 JambPost', jambCount([5, 15, 31]), 5));
  // Three independent off-grid on long eave: SB promotes 1 slid column → 5 Jamb + 10@16
  {
    const b = plainShopBuilding({
      width: 60,
      length: 60,
      eaveHeight: 12,
      openings: [5, 25, 45].map((o) =>
        createOpening({
          type: 'overhead',
          wall: 'left',
          offset: o,
          width: 10,
          height: 10,
          sillHeight: 0,
        }),
      ),
    });
    const items = takeoffProject(createProject({ buildings: [b] })).items || [];
    rows.push(check('Equal-space 3 OH → 5 JambPost (SB)', qtyUsage(items, 'JambPost'), 5));
    rows.push(check('Equal-space 3 OH → 10 Post 16\' (SB)', qtyAt(items, 'Post', "16"), 10));
  }

  return {
    job: 'Layout invariants (random offsets)',
    detail: { layouts: layouts.length, pack: packs[0] },
    rows,
    pass: rows.every((r) => r.ok),
    passCount: rows.filter((r) => r.ok).length,
    total: rows.length,
  };
}

/**
 * P4 scaffolds — purlin size expansion.
 * Targets are null until an SB order dump is locked (see NEED_FROM_USER in report).
 * These still assert package gates + monotonic growth so CI catches regressions.
 */
export function checkPurlinScaffold(label, partial, opts = {}) {
  const b = plainShopBuilding({
    eaveHeight: partial.eaveHeight ?? 12,
    metalOverhangIn: partial.metalOverhangIn ?? 3,
    ...partial,
  });
  const items = takeoffProject(createProject({ buildings: [b] })).items || [];
  const policy = describePolicyForBuilding(b);
  const p16 = qtyAt(items, 'Purlin', "16");
  const p12 = qtyAt(items, 'Purlin', "12");
  const rows = [
    check('Purlin 16\' present', p16 > 0 ? 1 : 0, 1),
    check('Purlin 12\' present', p12 > 0 ? 1 : 0, 1),
    check('Package mode runs', policy.girtPackMode ? 1 : 0, 1),
  ];
  if (opts.expect16 != null) rows.push(check('Purlin 16\' SB', p16, opts.expect16));
  if (opts.expect12 != null) rows.push(check('Purlin 12\' SB', p12, opts.expect12));
  return {
    job: label,
    policy,
    detail: { p16, p12, needSbDump: opts.expect16 == null },
    rows,
    pass: rows.every((r) => r.ok),
    passCount: rows.filter((r) => r.ok).length,
    total: rows.length,
  };
}

export function check50x60Scaffold() {
  return checkPurlinScaffold('50×60×12 purlin scaffold (P4 — needs SB dump)', {
    width: 50,
    length: 60,
    eaveHeight: 12,
    metalOverhangIn: 3,
  });
}

export function check70x70Scaffold() {
  return checkPurlinScaffold('70×70×12 purlin scaffold (P4 — needs SB dump)', {
    width: 70,
    length: 70,
    eaveHeight: 12,
    metalOverhangIn: 3,
  });
}

export function check40x80Scaffold() {
  return checkPurlinScaffold('40×80×14 purlin scaffold (P4 — needs SB dump)', {
    width: 40,
    length: 80,
    eaveHeight: 14,
    metalOverhangIn: 6,
  });
}

/** Force package override sanity (P5). */
export function checkPackageForce() {
  const small = plainShopBuilding({
    width: 40,
    length: 40,
    eaveHeight: 14, // would be full in auto
    orderPackageMode: 'small',
  });
  const full = plainShopBuilding({
    width: 30,
    length: 40,
    eaveHeight: 10, // would be small in auto
    orderPackageMode: 'full',
  });
  const ps = describePolicyForBuilding(small);
  const pf = describePolicyForBuilding(full);
  const itemsSmall = takeoffProject(createProject({ buildings: [small] })).items || [];
  const itemsFull = takeoffProject(createProject({ buildings: [full] })).items || [];
  const rows = [
    check('Force small @ eave 14', ps.girtIncludeEave ? 0 : 1, 1),
    check('Force full @ eave 10', pf.girtIncludeEave ? 1 : 0, 1),
    check('Forced small: no EaveFascia', qtyUsage(itemsSmall, 'EaveFascia'), 0),
    check('Forced full: has EaveFascia', qtyUsage(itemsFull, 'EaveFascia') > 0 ? 1 : 0, 1),
  ];
  return {
    job: 'Package force toggle (P5)',
    rows,
    pass: rows.every((r) => r.ok),
    passCount: rows.filter((r) => r.ok).length,
    total: rows.length,
  };
}

/**
 * Run the full golden size matrix.
 * Order: small plain → mid plain → mid full-gate → wide plain → openings → package force → scaffolds → large+lean.
 */
export function runAllRegressionChecks() {
  const jobs = [
    check30x40(),
    check40x40(),
    check40x60(),
    check60x60(),
    check60x60Openings(),
    check60x60x12Openings(),
    check35x55Openings(),
    checkLayoutInvariants(),
    checkPackageForce(),
    check50x60Scaffold(),
    check70x70Scaffold(),
    check40x80Scaffold(),
    checkLevi(),
  ];
  const passCount = jobs.reduce((s, j) => s + j.passCount, 0);
  const total = jobs.reduce((s, j) => s + j.total, 0);
  return {
    jobs,
    passCount,
    total,
    pass: jobs.every((j) => j.pass),
    pct: total ? Math.round((1000 * passCount) / total) / 10 : 0,
  };
}

export function formatRegressionReport(result) {
  const lines = [
    `Production regression — ${result.passCount}/${result.total} (${result.pct}%)`,
    result.pass ? 'ALL CHECKS PASSED' : 'FAILURES PRESENT',
    '',
  ];
  for (const j of result.jobs) {
    lines.push(`── ${j.job} ${j.pass ? '✓' : '✗'} ──`);
    if (j.scorecard) lines.push(`  scorecard ${j.scorecard}`);
    if (j.policy) {
      lines.push(
        `  policy: girt=${j.policy.girtPackage}; purlinPad=${j.policy.purlinStationPad}; metalOH=${j.policy.panelMetalOverhangIn}"`,
      );
    }
    for (const r of j.rows) {
      lines.push(
        `  ${r.ok ? '✓' : '✗'} ${r.name}: got ${r.actual} want ${r.expected}${r.ok ? '' : ` Δ${r.delta > 0 ? '+' : ''}${r.delta}`}`,
      );
    }
    lines.push('');
  }
  return lines.join('\n');
}

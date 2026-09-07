
/**
 * Live material catalog — Item (13).csv prices + import from item-list CSVs.
 * Persists overrides in localStorage.
 */

import { ITEM13 } from './item13Data.js?v=20260806f';

export const STOCK_LUMBER = [8, 10, 12, 14, 16, 18, 20, 24];
export const PANEL_COVERAGE_FT = 3;
/** Bump when catalog schema / Item 13 mapping changes. */
export const CATALOG_STORAGE_KEY = 'polebarn_pro_catalog_v6_item13';

/** App color code → Item (13) color suffix */
export const COLOR_MAP = ITEM13.colorMap || {
  AL: 'ALAMOWHITE',
  BK: 'MATTEBLACK',
  GAL: 'GALVALUME',
  BR: 'BROWN',
  TN: 'TAN',
  GR: 'HUNTERGREEN',
  RD: 'RUSTICRED',
  BU: 'BURGUNDY',
  SL: 'CHARCOAL',
  LB: 'OCEANBLUE',
  CG: 'LIGHTSTONE',
  OTG: 'ASHGRAY',
};

/**
 * Resolve Item (13) color suffix for an app color code.
 * @param {string} code
 */
export function item13ColorSuffix(code) {
  const c = String(code || 'BK').toUpperCase();
  if (c === 'GAL') return 'ALAMOWHITE'; // no galv formed trim — use white
  return COLOR_MAP[c] || COLOR_MAP.BK || 'MATTEBLACK';
}

function buildDefaultFromItem13() {
  const I = ITEM13;
  const posts = {};
  for (const [L, v] of Object.entries(I.posts || {})) {
    posts[Number(L)] = { sku: v.sku, desc: v.desc, cost: v.cost };
  }
  const boards = { ...(I.boards || {}) };
  const metalPanelPerFt = {};
  for (const [code, v] of Object.entries(I.panelByAppColor || {})) {
    metalPanelPerFt[code] = {
      sku: v.sku,
      desc: v.desc || '29ga Smart Rib Plus',
      costPerFt: v.costPerFt,
    };
  }
  // Ensure core colors
  if (!metalPanelPerFt.BK) {
    metalPanelPerFt.BK = { sku: '29G40-MATTEBLACK', desc: '29ga Smart Rib Plus (40 yr)-Matte Black', costPerFt: 3.08 };
  }
  if (!metalPanelPerFt.AL) {
    metalPanelPerFt.AL = { sku: '29G40-ALAMOWHITE', desc: '29ga Smart Rib Plus (40 yr)-Alamo White', costPerFt: 3.08 };
  }

  // 26ga Smart Rib Plus (Lifetime) — Item (13) 26GLIFE-*; Kane item lists 2640**QLP @ ~$4.58/ft
  // Prices from item-13-mapped.json (26GLIFE-* price field).
  const PANEL26 = {
    AL: { sku: '26GLIFE-ALAMOWHITE', desc: '26ga Smart Rib Plus (Lifetime)-Alamo White', costPerFt: 3.86 },
    BK: { sku: '26GLIFE-MATTEBLACK', desc: '26ga Smart Rib Plus (Lifetime)- Matte Black', costPerFt: 3.86 },
    OTG: { sku: '26GLIFE-ASHGRAY', desc: '26ga Smart Rib Plus (Lifetime)- Ash Gray', costPerFt: 3.86 },
    BR: { sku: '26GLIFE-BROWN', desc: '26ga Smart Rib Plus (Lifetime)- Brown', costPerFt: 3.86 },
    TN: { sku: '26GLIFE-TAN', desc: '26ga Smart Rib Plus (Lifetime)- Tan', costPerFt: 3.86 },
    GR: { sku: '26GLIFE-HUNTERGREEN', desc: '26ga Smart Rib Plus (Lifetime)- Hunter Green', costPerFt: 3.86 },
    RD: { sku: '26GLIFE-RUSTICRED', desc: '26ga Smart Rib Plus (Lifetime)- Rustic Red', costPerFt: 3.86 },
    BU: { sku: '26GLIFE-BURGUNDY', desc: '26ga Smart Rib Plus (Lifetime)- Burgundy', costPerFt: 3.86 },
    SL: { sku: '26GLIFE-CHARCOAL', desc: '26ga Smart Rib Plus (Lifetime)- Charcoal', costPerFt: 3.86 },
    LB: { sku: '26GLIFE-OCEANBLUE', desc: '26ga Smart Rib Plus (Lifetime)- Ocean Blue', costPerFt: 3.86 },
    CG: { sku: '26GLIFE-LIGHTSTONE', desc: '26ga Smart Rib Plus (Lifetime)- Light Stone', costPerFt: 3.86 },
    WH: { sku: '26GLIFE-BRILLIANTWHITE', desc: '26ga Smart Rib Plus (Lifetime)- Brilliant White', costPerFt: 3.86 },
    MB: { sku: '26GLIFE-MATTEBLACK', desc: '26ga Smart Rib Plus (Lifetime)- Matte Black', costPerFt: 3.86 },
    SB: { sku: '26GLIFE-SHINYBLACK', desc: '26ga Smart Rib Plus (Lifetime)- Shiny Black', costPerFt: 3.86 },
    // No 26ga Galvalume SKU — map to Alamo White 26
    GAL: { sku: '26GLIFE-ALAMOWHITE', desc: '26ga Smart Rib Plus (Lifetime)-Alamo White', costPerFt: 3.86 },
  };
  const metalPanelPerFt26 = { ...PANEL26 };

  const td = I.trimDefaults || {};
  const acc = I.accessories || {};
  const s15 = I.screw15ByAppColor?.BK || { sku: '10112HLBLA', price: 13.59, name: '#10 1 1/2" - Black' };
  const s2 = I.screw2ByAppColor?.BK || { sku: '102HLBLA', price: 15.23, name: '#10 2" - Black' };

  return {
    posts,
    boards,
    metalPanelPerFt,
    metalPanelPerFt26,
    metalByKey: {},
    trim: {
      ridge: {
        sku: td.ridge?.sku || '29G1010RDG',
        desc: td.ridge?.desc || '29ga Ridge',
        len: 10,
        cost: td.ridge?.cost ?? 24.02,
      },
      rakeCorner: {
        sku: td.corner?.sku || '29G10CORN',
        desc: td.corner?.desc || '29ga Corner',
        len: 10,
        cost: td.corner?.cost ?? 20.46,
      },
      eave: {
        sku: td.eave?.sku || '29G102EV',
        desc: td.eave?.desc || '29ga Eave',
        len: 10,
        cost: td.eave?.cost ?? 11.27,
      },
      jTrim: {
        sku: td.jTrim?.sku || '29G102JT',
        desc: td.jTrim?.desc || '29ga J-Trim',
        len: 10,
        cost: td.jTrim?.cost ?? 7.8,
      },
      ratGuard: {
        sku: td.ratGuard?.sku || '29G102RTGD',
        desc: td.ratGuard?.desc || '29ga Rat Guard',
        len: 10,
        cost: td.ratGuard?.cost ?? 7.8,
      },
      ohdTrim: {
        sku: td.ohdTrim?.sku || '29G12OHD',
        desc: td.ohdTrim?.desc || '29ga OHD Trim',
        len: 12,
        cost: td.ohdTrim?.cost ?? 32.23,
      },
      valley: {
        sku: td.valley?.sku || '29G10VAL',
        desc: td.valley?.desc || '29ga Valley Trim',
        len: 10,
        cost: td.valley?.cost ?? 22.0,
      },
      insideCorner: {
        sku: td.insideCorner?.sku || '29G10ICORN',
        desc: td.insideCorner?.desc || 'Inside Rake and Corner',
        len: 10,
        cost: td.insideCorner?.cost ?? 21.0,
      },
      // Not in Item (13) as separate SKUs — keep placeholders until priced
      singleAngle: {
        sku: 'SANG512',
        desc: 'Single Angle 15X55 (price TBD — not in Item 13)',
        len: 10,
        cost: 18.5,
      },
      doubleAngle: {
        sku: 'DANG',
        desc: 'Double Angle (price TBD — not in Item 13)',
        len: 10,
        cost: 14.2,
      },
      topOfWall: {
        sku: 'FJQLP',
        desc: 'Top of Wall / Quadra Fj (price TBD — not in Item 13)',
        len: 10,
        cost: 12.5,
      },
      sidewallFlash: {
        sku: 'SWF',
        desc: 'Sidewall / Transition Flash (price TBD — not in Item 13)',
        len: 10,
        cost: 26.5,
      },
    },
    trimBySku: {},
    fasteners: {
      screws: {
        sku: s15.sku || '10112HLBLA',
        desc: s15.name || '1 1/2 Metal Screw',
        costPerBox: s15.price ?? 13.59,
        boxCount: 250,
        weightLb: 3,
        squaresPerBag: 2.2,
        sqFtPerSquare: 100,
        sfPerBagRoof: 314,
        sfPerBagWall: 253,
        sfPerBagWainscot: 250,
      },
      screws2: {
        sku: s2.sku || '102HLBLA',
        desc: s2.name || '2" Metal Screw',
        costPerBox: s2.price ?? 15.23,
        boxCount: 250,
        weightLb: 4,
      },
      // Production SKUs (Levi/Kyle/SB lists). Item13 TBD/$0 entries are overridden.
      nails16d: {
        sku:
          Number(acc.nails16d?.cost) > 0 && !/TBD/i.test(acc.nails16d?.desc || '')
            ? acc.nails16d.sku
            : 'NAIL16DRS',
        desc:
          Number(acc.nails16d?.cost) > 0 && !/TBD/i.test(acc.nails16d?.desc || '')
            ? acc.nails16d.desc
            : '16D RING SHANK BOX GALVANIZED 50LB BOX',
        cost: Number(acc.nails16d?.cost) > 0 ? acc.nails16d.cost : 103.14,
        weightLb: 50,
      },
      nails40d: {
        sku:
          Number(acc.nails40d?.cost) > 0 && !/TBD/i.test(acc.nails40d?.desc || '')
            ? acc.nails40d.sku
            : 'NPB4025',
        desc:
          Number(acc.nails40d?.cost) > 0 && !/TBD/i.test(acc.nails40d?.desc || '')
            ? acc.nails40d.desc
            : 'POLE BARN 40D NAIL MAZE GALV 25LB',
        cost: Number(acc.nails40d?.cost) > 0 ? acc.nails40d.cost : 94.01,
        weightLb: 30,
      },
      timberHex: {
        sku: 'SCREW5164',
        desc: 'TIMBER HEX SCREW 5/16X4',
        cost: 357.58,
        weightLb: 0,
      },
      deckScrewBucket: {
        sku: 'DECKSCR3',
        desc: '3X9 STAR DRIVE DECK SCREW GREEN',
        cost: 123.09,
        weightLb: 4,
        qtyPerBuilding: 2,
      },
      nails: {
        sku: 'NAIL16DRS',
        desc: '16D RING SHANK BOX GALVANIZED 50LB BOX',
        cost: 103.14,
      },
      anchors: { sku: 'POSTANCH', desc: 'Post uplift anchor / strap', cost: 4.5 },
      postProtector: {
        sku: 'POSTPROT6',
        desc: '6x6 Post protector sleeve',
        cost: 12.5,
      },
      permaColumn: {
        sku: 'PERMACOL',
        desc: 'Perma-Column precast post pier',
        cost: 48,
      },
    },
    accessories: {
      // Production SKUs match SB / Levi / Kyle item lists
      butylTape: {
        sku: 'BUTYLTAPE',
        desc: "BUTYL TAPE 39'",
        cost: 4.03,
        weightLb: 3,
        qtyPerBuilding: 10,
      },
      closureInside: {
        sku: 'CLOSEINSQLP',
        desc: 'I/S CLOSURE STRIP',
        cost: 0.58,
        weightLb: 1,
        pieceLenFt: 3,
      },
      closureOutside: {
        sku: 'CLOSOUTQLP',
        desc: 'O/S CLOSURE STRIP',
        cost: 0.66,
        weightLb: 1,
        pieceLenFt: 3,
      },
      paintPen: {
        skuPrefix: 'PAINTPEN',
        desc: 'PAINT PEN',
        cost: 8.42,
        weightLb: 0,
      },
      /** Kane/SB square-eave package (no frame OH): center-vent eave soffit */
      centerVentSoffit: {
        sku: 'CVSOFFITAL12',
        desc: 'Center Vent Soffit',
        len: 12,
        cost: 42.92,
        weightLb: 0,
      },
      trimScrewLfPerBag: 200,
    },
    freight: {
      perMile: 4.5,
      unloadFee: 50,
      mileSku: 'MISC_FREIGHT',
      mileDesc: '$4.50 per loaded mile',
      unloadSku: 'MISC_DONKEY',
      unloadDesc: 'DONKEY OFF-LOAD',
    },
    accessoriesBySku: {},
    openings: {
      walk: { sku: 'DOOR3070', desc: "3' x 7' Walk Door Opening", cost: 0 },
      window: { sku: 'WIN3040', desc: "3' x 4' Window Opening", cost: 0 },
      overhead: { sku: 'OHD', desc: 'Overhead Door (opening)', cost: 0 },
      slider: { sku: 'SLIDER', desc: 'Slider Door (opening)', cost: 0 },
    },
    trussPerFtWidth: 4.2,
    trussDefault: I.trussesBySpan?.['55'] || I.trussesBySpan?.['40'] || {
      sku: 'CT5OC-55',
      desc: 'Common Truss - 5OC-55',
      cost: 180,
    },
    trussesBySpan: I.trussesBySpan || {},
    concretePerYd: 155,
    rebarStick: { sku: '4RBR20', desc: 'Rebar - #4 20ft', cost: 8.38 },
    vapor: { sku: '20100VAPOR', desc: "20'x100' Vapor Barrier (Black)", costPerSqFt: 0.06 },
    insulation: {
      fiberglass3: {
        sku: 'FG3VINYL',
        desc: '3" Fiberglass vinyl-faced insulation',
        costPerSqFt: 0.55,
      },
      thermaguard: {
        sku: '6125THGRD',
        desc: '6x125 THERMAGUARD',
        costPerRoll: 169.57,
        coverageSqFt: 750,
        weightLb: 0,
      },
    },
    screw15ByAppColor: I.screw15ByAppColor || {},
    screw2ByAppColor: I.screw2ByAppColor || {},
    paintBySuffix: I.paintBySuffix || {},
    importedRows: [],
    sourceName: I.sourceName || 'Item (13).csv',
    importedAt: new Date().toISOString(),
  };
}

const DEFAULT_CATALOG = buildDefaultFromItem13();



/**
 * Full Item (13) SKU for formed trim by kind + app color + optional length (ft).
 * @param {'ridge'|'eave'|'ratGuard'|'jTrim'|'ohd'|'corner'|'rake'} kind
 * @param {string} colorCode
 * @param {number} [lengthFt=10]
 */
export function resolveTrimSku(kind, colorCode, lengthFt = 10) {
  const suf = item13ColorSuffix(colorCode);
  const L = Number(lengthFt) || 10;
  let prefix = '29G10CORN';
  if (kind === 'ridge') prefix = '29G1010RDG';
  else if (kind === 'eave') prefix = '29G102EV';
  else if (kind === 'ratGuard' || kind === 'base') prefix = '29G102RTGD';
  else if (kind === 'jTrim') prefix = '29G102JT';
  else if (kind === 'ohd') prefix = '29G12OHD';
  else if (kind === 'valley') prefix = '29G10VAL';
  else if (kind === 'insideCorner') prefix = '29G10ICORN';
  else if (kind === 'corner' || kind === 'rake' || kind === 'gableEdge') {
    // Map ordered length to nearest stocked corner SKU
    if (L >= 16) prefix = '29G166CORN'; // 16'6"
    else if (L >= 14) prefix = '29G146CORN'; // 14'6"
    else if (L >= 12.5) prefix = '29G126CORN';
    else if (L >= 12) prefix = '29G12CORN';
    else if (L >= 10.5) prefix = '29G106CORN';
    else prefix = '29G10CORN';
  }
  return `${prefix}-${suf}`;
}

/**
 * @returns {{ sku: string, desc: string, cost: number }}
 */
export function resolveTrimLine(kind, colorCode, lengthFt = 10) {
  const sku = resolveTrimSku(kind, colorCode, lengthFt);
  const suf = item13ColorSuffix(colorCode);
  // Prefer live catalog trim costs by kind
  let cost = 20;
  let desc = sku;
  const t = CATALOG.trim || {};
  if (kind === 'ridge' && t.ridge) {
    cost = t.ridge.cost;
    desc = t.ridge.desc;
  } else if ((kind === 'eave') && t.eave) {
    cost = t.eave.cost;
    desc = t.eave.desc;
  } else if ((kind === 'ratGuard' || kind === 'base') && t.ratGuard) {
    cost = t.ratGuard.cost;
    desc = t.ratGuard.desc;
  } else if (kind === 'jTrim' && t.jTrim) {
    cost = t.jTrim.cost;
    desc = t.jTrim.desc;
  } else if (kind === 'ohd' && t.ohdTrim) {
    cost = t.ohdTrim.cost;
    desc = t.ohdTrim.desc;
  } else if (kind === 'valley' && t.valley) {
    cost = t.valley.cost;
    desc = t.valley.desc;
  } else if (kind === 'insideCorner' && t.insideCorner) {
    cost = t.insideCorner.cost;
    desc = t.insideCorner.desc;
  } else if ((kind === 'corner' || kind === 'rake' || kind === 'gableEdge') && t.rakeCorner) {
    cost = t.rakeCorner.cost;
    // Longer corners cost more in Item 13
    if (lengthFt >= 16) cost = 33.77;
    else if (lengthFt >= 14) cost = 29.67;
    else if (lengthFt >= 12.5) cost = 25.58;
    else if (lengthFt >= 12) cost = 24.56;
    else if (lengthFt >= 10.5) cost = 21.49;
    else cost = 20.46;
    desc = t.rakeCorner.desc;
  }
  // single/double/top keep catalog placeholders
  if (kind === 'singleAngle' && t.singleAngle) {
    return { sku: colorSku(t.singleAngle.sku, colorCode), desc: t.singleAngle.desc, cost: t.singleAngle.cost };
  }
  if (kind === 'doubleAngle' && t.doubleAngle) {
    return { sku: colorSku(t.doubleAngle.sku, colorCode), desc: t.doubleAngle.desc, cost: t.doubleAngle.cost };
  }
  if (kind === 'topOfWall' && t.topOfWall) {
    return { sku: colorSku(t.topOfWall.sku, colorCode), desc: t.topOfWall.desc, cost: t.topOfWall.cost };
  }
  return { sku, desc, cost };
}

/**
 * #10 1.5" screw bag for app color (Item 13).
 */
/** Short production color code for accessory SKUs (15MWBK, PAINTPENAL). */
function productionColorCode(colorCode) {
  const c = String(colorCode || 'BK').toUpperCase().replace(/[^A-Z]/g, '');
  // Known app codes
  if (
    /^(AL|BK|GAL|BR|TN|GR|RD|BU|SL|LB|CG|OTG|WH)$/.test(c)
  ) {
    return c === 'GAL' || c === 'WH' ? 'AL' : c;
  }
  // Long Item13 names → short
  if (/ALAMO|WHITE/.test(c)) return 'AL';
  if (/MATTE|BLACK/.test(c)) return 'BK';
  if (/ASH|GRAY|GREY|OTG/.test(c)) return 'OTG';
  if (/BROWN/.test(c)) return 'BR';
  if (/TAN/.test(c)) return 'TN';
  if (/GREEN|HUNTER|EVER/.test(c)) return 'GR';
  if (/RED|RUSTIC|CRIMSON/.test(c)) return 'RD';
  if (/BURG/.test(c)) return 'BU';
  if (/CHAR|SLATE/.test(c)) return 'SL';
  if (/BLUE|OCEAN/.test(c)) return 'LB';
  if (/STONE|CLAY/.test(c)) return 'CG';
  return 'BK';
}

export function resolveScrew15(colorCode) {
  const code = productionColorCode(colorCode);
  const map = CATALOG.screw15ByAppColor || ITEM13.screw15ByAppColor || {};
  const hit = map[code] || map[colorCode] || map.BK || {};
  // Production order lists: 15MW{BK|AL|…} / "1 12 Metwood Screw" (SB / Levi / Kyle)
  const cost = hit.price ?? hit.cost ?? 14.34;
  return {
    sku: `15MW${code}`,
    desc: '1 12 Metwood Screw',
    cost,
  };
}

/**
 * #10 2" screw bag for ridge / trim color.
 */
export function resolveScrew2(colorCode) {
  const code = productionColorCode(colorCode);
  const map = CATALOG.screw2ByAppColor || ITEM13.screw2ByAppColor || {};
  const hit = map[code] || map[colorCode] || map.BK || {};
  // Production: 2MW{color} / "2 Metwood Screw"
  const cost = hit.price ?? hit.cost ?? 16.08;
  return {
    sku: `2MW${code}`,
    desc: '2 Metwood Screw',
    cost,
  };
}

/**
 * Touch-up paint for app color.
 */
export function resolvePaint(colorCode) {
  const code = productionColorCode(colorCode);
  const longSuf = item13ColorSuffix(colorCode);
  const map = CATALOG.paintBySuffix || ITEM13.paintBySuffix || {};
  const hit = map[longSuf] || map[code];
  // Production lists: PAINTPEN{BK|AL|…}
  if (hit) {
    return {
      sku: `PAINTPEN${code}`,
      desc: 'PAINT PEN',
      cost: hit.cost ?? hit.price ?? 8.42,
    };
  }
  return {
    sku: `PAINTPEN${code}`,
    desc: 'PAINT PEN',
    cost: 8.42,
  };
}

/**
 * Truss SKU by span (ft) from Item 13 CT5OC-*.
 */
export function resolveTruss(spanFt) {
  const span = Math.round(Number(spanFt) || 40);
  const map = CATALOG.trussesBySpan || ITEM13.trussesBySpan || {};
  if (map[String(span)]) return map[String(span)];
  // nearest
  const keys = Object.keys(map).map(Number).sort((a, b) => a - b);
  if (!keys.length) {
    return CATALOG.trussDefault || { sku: `CT5OC-${span}`, desc: `Common Truss - 5OC-${span}`, cost: 180 };
  }
  let best = keys[0];
  for (const k of keys) {
    if (Math.abs(k - span) < Math.abs(best - span)) best = k;
  }
  return map[String(best)];
}


/** Mutable live catalog (deep-cloned defaults, then overlays). */
export let CATALOG = cloneCatalog(DEFAULT_CATALOG);

function cloneCatalog(src) {
 return JSON.parse(JSON.stringify(src));
}

export function resetCatalog() {
 CATALOG = cloneCatalog(DEFAULT_CATALOG);
 try {
 localStorage.removeItem(CATALOG_STORAGE_KEY);
 } catch (_) {}
 return CATALOG;
}

export function saveCatalog() {
 try {
 localStorage.setItem(CATALOG_STORAGE_KEY, JSON.stringify(CATALOG));
 } catch (_) {}
}

export function loadCatalogFromStorage() {
 try {
 const raw = localStorage.getItem(CATALOG_STORAGE_KEY);
 if (!raw) {
 CATALOG = cloneCatalog(DEFAULT_CATALOG);
 return false;
 }
 const data = JSON.parse(raw);
 // Always start from Item (13) defaults, then overlay saved overrides
 CATALOG = cloneCatalog(DEFAULT_CATALOG);
 CATALOG.posts = { ...DEFAULT_CATALOG.posts, ...(data.posts || {}) };
 CATALOG.boards = { ...DEFAULT_CATALOG.boards, ...(data.boards || {}) };
 CATALOG.metalPanelPerFt = { ...DEFAULT_CATALOG.metalPanelPerFt, ...(data.metalPanelPerFt || {}) };
 CATALOG.metalPanelPerFt26 = {
 ...DEFAULT_CATALOG.metalPanelPerFt26,
 ...(data.metalPanelPerFt26 || {}),
 };
 CATALOG.trim = { ...DEFAULT_CATALOG.trim, ...(data.trim || {}) };
 CATALOG.fasteners = { ...DEFAULT_CATALOG.fasteners, ...(data.fasteners || {}) };
 CATALOG.accessories = { ...DEFAULT_CATALOG.accessories, ...(data.accessories || {}) };
 if (data.screw15ByAppColor) CATALOG.screw15ByAppColor = data.screw15ByAppColor;
 if (data.screw2ByAppColor) CATALOG.screw2ByAppColor = data.screw2ByAppColor;
 if (data.trussesBySpan) CATALOG.trussesBySpan = data.trussesBySpan;
 if (data.paintBySuffix) CATALOG.paintBySuffix = data.paintBySuffix;
 if (data.sourceName) CATALOG.sourceName = data.sourceName;
 if (data.importedAt) CATALOG.importedAt = data.importedAt;
 CATALOG.openings = { ...DEFAULT_CATALOG.openings, ...(data.openings || {}) };
 CATALOG.insulation = {
 ...DEFAULT_CATALOG.insulation,
 ...(data.insulation || {}),
 };
 CATALOG.freight = { ...DEFAULT_CATALOG.freight, ...(data.freight || {}) };
 return true;
 } catch (_) {
 return false;
 }
}

// Load on module init
loadCatalogFromStorage();

export function boardLookup(size, lengthFt, treated = false) {
 const key = treated ? `${size}-treated|${lengthFt}` : `${size}|${lengthFt}`;
 if (CATALOG.boards[key]) return CATALOG.boards[key];
 // nearest length in catalog for same size
 const prefix = treated ? `${size}-treated|` : `${size}|`;
 const candidates = Object.keys(CATALOG.boards)
 .filter((k) => k.startsWith(prefix))
 .map((k) => ({ k, len: Number(k.split('|')[1]) }))
 .filter((x) => x.len >= lengthFt)
 .sort((a, b) => a.len - b.len);
 if (candidates.length) {
 const hit = CATALOG.boards[candidates[0].k];
 return { ...hit, _stockLen: candidates[0].len };
 }
 return {
 sku: `${size.replace(/x/gi, '')}${lengthFt}${treated ? 'T' : 'YP'}`,
 desc: `${size.toUpperCase()} ${treated ? 'CCA treated' : 'YP'}`,
 cost: lengthFt * (treated ? 1.8 : 0.9) * (String(size).startsWith('2x4') ? 0.7 : 1),
 };
}

export function postLookup(lengthFt) {
 const raw = Number(lengthFt) || 8;
 // Supplier 6x6 max 24' — never invent longer stock SKUs
 const MAX = 24;
 let L = Math.max(8, Math.min(MAX, Math.ceil(raw - 1e-9)));
 // Snap to even feet in catalog
 if (L % 2 === 1) L = Math.min(MAX, L + 1);
 if (CATALOG.posts[L]) return CATALOG.posts[L];
 const lengths = Object.keys(CATALOG.posts)
 .map(Number)
 .filter((l) => l >= Math.min(raw, MAX) - 0.01 && l <= MAX)
 .sort((a, b) => a - b);
 if (lengths.length) return CATALOG.posts[lengths[0]];
 // Fallback: longest stocked post
 const maxAvail = Math.max(...Object.keys(CATALOG.posts).map(Number), 24);
 return (
 CATALOG.posts[maxAvail] || {
 sku: '66242CCA',
 desc: '6x6x24 #2 CCA',
 cost: 129.6,
 }
 );
}

export function colorSku(baseSku, color) {
  // Item (13) full SKUs when base is a 29G prefix; else legacy suffix style
  const base = String(baseSku || '');
  if (base.startsWith('29G')) {
    const suf = item13ColorSuffix(color);
    // strip existing color suffix if present
    const prefix = base.split('-')[0];
    return `${prefix}-${suf}`;
  }
  return `${base}${color || ''}`;
}

/**
 * Normalize panel gauge to '26' | '29' (default 29).
 * @param {string|number|null|undefined} gauge
 */
export function normalizePanelGauge(gauge) {
  return gauge === 26 || gauge === '26' ? '26' : '29';
}

/**
 * Catalog meta for a panel color + gauge (SKU, desc, $/ft).
 * 29ga → metalPanelPerFt; 26ga → metalPanelPerFt26 (Item13 26GLIFE / Kane 2640QLP).
 * @param {string} color
 * @param {string|number} [gauge='29']
 */
export function panelMetaForGauge(color, gauge = '29') {
  const code = String(color || 'BK').toUpperCase();
  const g = normalizePanelGauge(gauge);
  if (g === '26') {
    const table = CATALOG.metalPanelPerFt26 || {};
    return (
      table[code] ||
      table.BK || {
        sku: '26GLIFE-MATTEBLACK',
        desc: '26ga Smart Rib Plus (Lifetime)- Matte Black',
        costPerFt: 3.86,
      }
    );
  }
  return (
    CATALOG.metalPanelPerFt[code] ||
    CATALOG.metalPanelPerFt.BK || {
      sku: '29G40-MATTEBLACK',
      desc: '29ga Smart Rib Plus (40 yr)-Matte Black',
      costPerFt: 3.08,
    }
  );
}

export function metalLookup(color, lengthFt, gauge = '29') {
  const g = normalizePanelGauge(gauge);
  const inches = Math.round(lengthFt * 12);
  // Imported cut-length keys are 29ga unless marked |26
  const key29 = `${color}|${inches}`;
  const keyG = g === '26' ? `${color}|${inches}|26` : key29;
  if (CATALOG.metalByKey[keyG]) return CATALOG.metalByKey[keyG];
  if (g === '29' && CATALOG.metalByKey[key29]) return CATALOG.metalByKey[key29];
  // nearest longer panel same color (gauge-aware when |26 keys present)
  const prefix = `${color}|`;
  const candidates = Object.entries(CATALOG.metalByKey)
    .filter(([k]) => {
      if (!k.startsWith(prefix)) return false;
      const is26 = k.endsWith('|26');
      return g === '26' ? is26 : !is26;
    })
    .map(([k, v]) => {
      const parts = k.split('|');
      return { inches: Number(parts[1]), v };
    })
    .filter((x) => x.inches >= inches - 1)
    .sort((a, b) => a.inches - b.inches);
  if (candidates.length) return candidates[0].v;
  const meta = panelMetaForGauge(color, g);
  return {
    sku: meta.sku,
    desc: meta.desc,
    color,
    lengthFt,
    cost: meta.costPerFt * lengthFt,
  };
}

export function catalogStats() {
 return {
 sourceName: CATALOG.sourceName || 'Built-in defaults',
 importedAt: CATALOG.importedAt,
 posts: Object.keys(CATALOG.posts).length,
 boards: Object.keys(CATALOG.boards).length,
 metal: Object.keys(CATALOG.metalByKey || {}).length,
 trimSkus: Object.keys(CATALOG.trimBySku || {}).length,
 accessories: Object.keys(CATALOG.accessoriesBySku || {}).length,
 importedRows: (CATALOG.importedRows || []).length,
 };
}

/**
 * Apply parsed import result onto live catalog and persist.
 */
export function applyImport(parsed, sourceName = 'Imported CSV') {
 const n = { posts: 0, boards: 0, metal: 0, trim: 0, accessories: 0, trusses: 0 };

 for (const row of parsed.rows) {
 const cat = (row.category || '').toLowerCase();
 const desc = (row.description || '').toUpperCase();
 const sku = row.sku || '';
 const cost = row.cost;
 const lenFt = row.lengthFt;

 if (cat.includes('framing') || cat === 'framing') {
 if (/POST|6X6|6\s*X\s*6/i.test(desc + sku) && lenFt) {
 const L = Math.round(lenFt);
 CATALOG.posts[L] = { sku: sku || `66${L}CCAPOST`, desc: row.description, cost };
 n.posts++;
 } else {
 const size = detectLumberSize(desc);
 if (size && lenFt) {
 const treated = /CCA|KDAT|TREATED|PRESSURE/i.test(desc + sku);
 const key = treated ? `${size}-treated|${Math.round(lenFt)}` : `${size}|${Math.round(lenFt)}`;
 CATALOG.boards[key] = { sku, desc: row.description, cost };
 n.boards++;
 }
 }
 } else if (cat.includes('sheath') || /PANEL|QLOC|29\s*GA/i.test(desc)) {
 const color = row.color || detectColor(sku, desc) || 'BK';
 if (lenFt > 0) {
 const inches = Math.round(lenFt * 12);
 CATALOG.metalByKey[`${color}|${inches}`] = {
 sku,
 desc: row.description,
 color,
 lengthFt: lenFt,
 cost,
 };
 // Update per-ft average
 const cpf = cost / lenFt;
 CATALOG.metalPanelPerFt[color] = {
 sku: sku.replace(/\d+$/, '') || sku,
 desc: row.description.replace(/,.*/, ''),
 costPerFt: cpf,
 };
 n.metal++;
 }
 } else if (cat.includes('trim')) {
 if (sku) {
 CATALOG.trimBySku[sku] = {
 sku,
 desc: row.description,
 color: row.color || '',
 lengthFt: lenFt || 10,
 cost,
 };
 n.trim++;
 // Map common trim types
 if (/RIDGE/i.test(desc)) {
 CATALOG.trim.ridge = { sku: stripColorFromTrimSku(sku), desc: row.description, len: Math.round(lenFt || 10), cost };
 } else if (/RAKE|CORNER/i.test(desc)) {
 CATALOG.trim.rakeCorner = { sku: stripColorFromTrimSku(sku), desc: row.description, len: Math.round(lenFt || 10), cost };
 } else if (/EAVE/i.test(desc)) {
 CATALOG.trim.eave = { sku: stripColorFromTrimSku(sku), desc: row.description, len: Math.round(lenFt || 10), cost };
 } else if (/RAT\s*GUARD|RTG/i.test(desc + sku)) {
 CATALOG.trim.ratGuard = { sku: stripColorFromTrimSku(sku), desc: row.description, len: Math.round(lenFt || 10), cost };
 } else if (/OVERHEAD|OHD/i.test(desc + sku)) {
 CATALOG.trim.ohdTrim = { sku: stripColorFromTrimSku(sku), desc: row.description, len: Math.round(lenFt || 12), cost };
 } else if (/\bJ\s*TRIM|\bJT/i.test(desc + sku)) {
 CATALOG.trim.jTrim = { sku: stripColorFromTrimSku(sku), desc: row.description, len: Math.round(lenFt || 10), cost };
 }
 }
 } else if (cat.includes('accessor') || cat.includes('fasten')) {
 if (sku) {
 CATALOG.accessoriesBySku[sku] = { sku, desc: row.description, color: row.color || '', cost };
 n.accessories++;
 if (/SCREW|METWOOD|15MW/i.test(desc + sku)) {
 CATALOG.fasteners.screws = {
 sku: sku.replace(/(AL|BK|GAL)$/i, '') || '15MW',
 desc: row.description,
 costPerBox: cost,
 boxCount: 250,
 squaresPerBag: CATALOG.fasteners.screws?.squaresPerBag ?? 2.2,
 sqFtPerSquare: CATALOG.fasteners.screws?.sqFtPerSquare ?? 100,
 };
 }
 if (/NAIL16|16D/i.test(desc + sku)) {
 CATALOG.fasteners.nails = { sku, desc: row.description, cost };
 }
 }
 } else if (cat.includes('truss')) {
 if (!CATALOG.trussDefault || cost > 0) {
 CATALOG.trussDefault = { sku, desc: row.description, cost };
 n.trusses++;
 }
 } else if (cat.includes('door') || cat.includes('window')) {
 if (/WALK|3'\s*X\s*7|3X7/i.test(desc)) {
 CATALOG.openings.walk = { sku, desc: row.description, cost };
 } else if (/WINDOW/i.test(desc)) {
 CATALOG.openings.window = { sku, desc: row.description, cost };
 }
 }
 }

 CATALOG.importedRows = parsed.rows;
 CATALOG.sourceName = sourceName;
 CATALOG.importedAt = new Date().toISOString();
 saveCatalog();
 return n;
}

function stripColorFromTrimSku(sku) {
 // CORBK102 -> COR, RCPBK106 -> RCP
 return sku.replace(/(AL|BK|GAL|WH|BR|GR|RD)(\d+)?$/i, '') || sku;
}

function detectLumberSize(desc) {
 const m = desc.match(/2\s*X\s*(4|6|8|10|12)/i);
 if (m) return `2x${m[1]}`;
 return null;
}

function detectColor(sku, desc) {
 const s = `${sku} ${desc}`.toUpperCase();
 if (/\bAL\b|GALVALUME/.test(s)) return 'AL';
 if (/\bBK\b|BLACK/.test(s)) return 'BK';
 if (/\bGAL\b|GALVANIZED/.test(s)) return 'GAL';
 if (/2940AL|15MWAL|PAINTPENAL/.test(s)) return 'AL';
 if (/2940BK|15MWBK|PAINTPENBK|CORBK|RCPBK|LETBK|JTBK|RTGBK|OHDBK/.test(s)) return 'BK';
 return '';
}

/**
 * Parse item-list item list CSV text.
 * @returns {{ rows: Array, categories: string[] }}
 */
export function parseItemListCsv(text) {
 // strip BOM
 const clean = text.replace(/^\uFEFF/, '');
 const lines = clean.split(/\r?\n/);
 let category = 'General';
 const rows = [];
 const categories = new Set();

 for (let i = 0; i < lines.length; i++) {
 const line = lines[i].trim();
 if (!line) continue;

 // Category header alone
 if (!line.includes(',') && !/^SKU/i.test(line)) {
 // might be category like "Framing"
 if (!/^(Customer|SKU)/i.test(line) && line.length < 40) {
 category = line;
 categories.add(category);
 }
 continue;
 }

 // Skip header rows
 if (/^SKU,/i.test(line) || /^Customer Name/i.test(line)) continue;
 // Skip customer info rows that aren't material
 if (i < 5 && !/^\w+,/.test(line)) continue;

 const cols = parseCsvLine(line);
 if (cols.length < 5) continue;
 const [sku, description, color, lengthRaw, qtyRaw, costRaw, extRaw] = cols;
 // Material rows have a description; skip pure empties
 if (!description && !sku) continue;
 // Skip if looks like address row (no qty/cost)
 const qty = parseFloat(String(qtyRaw).replace(/[^0-9.]/g, ''));
 const cost = parseFloat(String(costRaw).replace(/[^0-9.]/g, ''));
 if (Number.isNaN(qty) && Number.isNaN(cost)) continue;

 const lengthFt = parseLengthToFeet(lengthRaw);
 rows.push({
 category,
 sku: (sku || '').trim(),
 description: (description || '').trim(),
 color: (color || '').trim(),
 lengthRaw: (lengthRaw || '').trim(),
 lengthFt,
 qty: Number.isNaN(qty) ? 0 : qty,
 cost: Number.isNaN(cost) ? 0 : cost,
 extCost: parseFloat(String(extRaw || '').replace(/[^0-9.]/g, '')) || 0,
 });
 categories.add(category);
 }

 return { rows, categories: [...categories] };
}

function parseCsvLine(line) {
 const out = [];
 let cur = '';
 let inQ = false;
 for (let i = 0; i < line.length; i++) {
 const ch = line[i];
 if (ch === '"') {
 if (inQ && line[i + 1] === '"') {
 cur += '"';
 i++;
 } else inQ = !inQ;
 } else if (ch === ',' && !inQ) {
 out.push(cur);
 cur = '';
 } else cur += ch;
 }
 out.push(cur);
 return out;
}

/**
 * Parse lengths like 20', 16' 8", 23' 10"", 0'
 */
export function parseLengthToFeet(raw) {
 if (raw == null || raw === '') return 0;
 const s = String(raw).trim().replace(/""/g, '"');
 if (!s || s === "0'" || s === '0') return 0;
 // 23' 10" or 16' 8"
 let m = s.match(/(\d+)\s*'\s*(\d+)\s*"?/);
 if (m) return Number(m[1]) + Number(m[2]) / 12;
 m = s.match(/(\d+)\s*'/);
 if (m) return Number(m[1]);
 m = s.match(/^(\d+(?:\.\d+)?)$/);
 if (m) return Number(m[1]);
 return 0;
}

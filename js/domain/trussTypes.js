/**
 * Roof truss type options for PoleBarn Pro.
 *
 * common         — flat bottom chord (standard Fink-style)
 * scissor        — vaulted ceiling; bottom chords slope ~½ roof pitch
 * attic          — room-in-attic loft (rectangle under single-pitch top chords)
 * parallelChord  — top & bottom chords parallel (same pitch)
 *
 * Segments are [ [x,y], [x,y] ] in building plan feet (x across width).
 * All web endpoints snap to chord joints so 3D beams meet cleanly.
 */

export const TRUSS_TYPES = [
  {
    id: 'common',
    label: 'Common (standard)',
    blurb: 'Flat bottom chord — most economical pole-barn truss.',
  },
  {
    id: 'scissor',
    label: 'Scissor',
    blurb: 'Sloped bottom chords for a vaulted / cathedral ceiling (~½ roof pitch).',
  },
  {
    id: 'attic',
    label: 'Attic (room-in-attic)',
    blurb: 'Loft room in the truss — storage or living space above.',
  },
  {
    id: 'parallelChord',
    label: 'Parallel chord',
    blurb: 'Top and bottom chords parallel — vaulted ceiling matching the roof pitch.',
  },
];

export function normalizeTrussType(v) {
  const id = String(v || 'common');
  return TRUSS_TYPES.some((t) => t.id === id) ? id : 'common';
}

function lerp(a, b, t) {
  return a + (b - a) * t;
}

/** Y on a pitched top chord (left eave → ridge → right eave). */
function yOnGableTop(x, left, mid, right, yEave, yRidge) {
  if (x <= mid) {
    const t = (x - left) / Math.max(mid - left, 1e-6);
    return lerp(yEave, yRidge, Math.max(0, Math.min(1, t)));
  }
  const t = (x - mid) / Math.max(right - mid, 1e-6);
  return lerp(yRidge, yEave, Math.max(0, Math.min(1, t)));
}

/** Y on a pitched bottom chord (scissor / parallel). */
function yOnPitchedBottom(x, left, mid, right, yEave, yPeak) {
  if (x <= mid) {
    const t = (x - left) / Math.max(mid - left, 1e-6);
    return lerp(yEave, yPeak, Math.max(0, Math.min(1, t)));
  }
  const t = (x - mid) / Math.max(right - mid, 1e-6);
  return lerp(yPeak, yEave, Math.max(0, Math.min(1, t)));
}

/**
 * @returns {{ type:string, top:number[][][], bottom:number[][][], webs:number[][][], atticRoom?: object }}
 */
export function trussMemberLayout(b, { xL, xR, eaveY, ridgeY, underRoof = 0.28 } = {}) {
  const type = normalizeTrussType(b?.trussType);
  const W = Number(b?.width) || 30;
  const H = Number(b?.eaveHeight) || 12;
  const pitch = (Number(b?.pitch) || 4) / 12;
  const left = xL != null ? xL : 0.55;
  const right = xR != null ? xR : W - 0.55;
  const mid = W / 2;
  const topEave = eaveY != null ? eaveY : H - 0.04;
  const topRidge =
    ridgeY != null ? ridgeY : H + (W / 2) * pitch - underRoof;

  const yTop = (x) => yOnGableTop(x, left, mid, right, topEave, topRidge);

  // Shared top chords for pitched roofs (single pitch — never gambrel)
  const top = [
    [
      [left, topEave],
      [mid, topRidge],
    ],
    [
      [mid, topRidge],
      [right, topEave],
    ],
  ];

  if (type === 'scissor') {
    const botPitch = pitch * 0.5;
    const botRise = (mid - left) * botPitch;
    const botPeak = topEave + botRise;
    const yBot = (x) => yOnPitchedBottom(x, left, mid, right, topEave, botPeak);

    const jL = [left + 0.05, topEave];
    const jPeakBot = [mid, botPeak];
    const jR = [right - 0.05, topEave];
    const jPeakTop = [mid, topRidge];

    // Panel points on top & bottom chords (exact Y on each chord)
    const xA = lerp(left, mid, 0.45);
    const xB = lerp(mid, right, 0.55);
    const jATop = [xA, yTop(xA)];
    const jBTop = [xB, yTop(xB)];
    const jABot = [xA, yBot(xA)];
    const jBBot = [xB, yBot(xB)];

    return {
      type,
      top,
      bottom: [
        [jL, jPeakBot],
        [jPeakBot, jR],
      ],
      webs: [
        [jABot, jATop],
        [jBBot, jBTop],
        [jPeakBot, jPeakTop],
        [jABot, jPeakTop],
        [jBBot, jPeakTop],
        [jATop, jPeakBot],
        [jBTop, jPeakBot],
      ],
    };
  }

  if (type === 'attic') {
    // Room-in-attic: single-pitch top chords + flat floor + rectangular room.
    // Room width is limited by roof rise so knee walls fit under the slope.
    const riseAvail = Math.max(1.25, topRidge - topEave);
    // Target clear height, but never taller than rise − heel clearance
    const wantH = Math.min(7.5, Math.max(3.25, riseAvail - 0.85));
    // At knee wall, top chord height above floor ≈ wantH
    // yTop(x0) - topEave = wantH  =>  fraction from mid
    // From left: (x0-left)/(mid-left) * riseAvail = wantH
    const tKnee = Math.min(0.92, Math.max(0.2, wantH / riseAvail));
    const x0 = left + tKnee * (mid - left);
    const x1 = right - tKnee * (right - mid);
    const yFloor = topEave;
    // Collar meets the top chords at the knee (classic attic look)
    const yCeil = yTop(x0);

    const jHeelL = [left + 0.05, yFloor];
    const jHeelR = [right - 0.05, yFloor];
    const jKneeL = [x0, yFloor];
    const jKneeR = [x1, yFloor];
    const jCollarL = [x0, yCeil];
    const jCollarR = [x1, yCeil];
    const jPeak = [mid, topRidge];

    // Extra top-chord panel points above the room for webbing
    const xMidL = lerp(x0, mid, 0.5);
    const xMidR = lerp(mid, x1, 0.5);
    const jTopMidL = [xMidL, yTop(xMidL)];
    const jTopMidR = [xMidR, yTop(xMidR)];

    return {
      type,
      top,
      bottom: [[jHeelL, jHeelR]],
      webs: [
        // Room side walls (verticals) — floor to collar / top chord
        [jKneeL, jCollarL],
        [jKneeR, jCollarR],
        // Attic ceiling / collar tie
        [jCollarL, jCollarR],
        // Outer knee braces: heel → collar (triangulate outer bays)
        [jHeelL, jCollarL],
        [jHeelR, jCollarR],
        // Above room: collar corners → peak (and mid points)
        [jCollarL, jPeak],
        [jCollarR, jPeak],
        [jCollarL, jTopMidL],
        [jCollarR, jTopMidR],
        [jTopMidL, jPeak],
        [jTopMidR, jPeak],
      ],
      atticRoom: { x0, x1, yFloor, yCeil },
    };
  }

  if (type === 'parallelChord') {
    const depth = Math.max(2.5, Math.min(4.5, Number(b?.trussDepthFt) || 3.5));
    const botEave = topEave;
    // Bottom peak stays parallel: same pitch, offset by depth along vertical
    const botPeak = Math.max(botEave + 0.75, topRidge - depth);
    const yBot = (x) => yOnPitchedBottom(x, left, mid, right, botEave, botPeak);

    const jL = [left + 0.05, botEave];
    const jR = [right - 0.05, botEave];
    const jPeakBot = [mid, botPeak];
    const jPeakTop = [mid, topRidge];

    const xs = [0.18, 0.32, 0.5, 0.68, 0.82].map((t) => lerp(left, right, t));
    const webs = [];
    for (const x of xs) {
      webs.push([
        [x, yBot(x)],
        [x, yTop(x)],
      ]);
    }
    // Diagonals between adjacent verticals (connect chord joints)
    for (let i = 0; i < xs.length - 1; i++) {
      const xA = xs[i];
      const xB = xs[i + 1];
      // Alternate diagonal direction
      if (i % 2 === 0) {
        webs.push([
          [xA, yBot(xA)],
          [xB, yTop(xB)],
        ]);
      } else {
        webs.push([
          [xA, yTop(xA)],
          [xB, yBot(xB)],
        ]);
      }
    }
    webs.push([jPeakBot, jPeakTop]);

    return {
      type,
      top,
      bottom: [
        [jL, jPeakBot],
        [jPeakBot, jR],
      ],
      webs,
    };
  }

  // common — flat bottom + Fink webs meeting shared joints
  const jL = [left + 0.05, topEave];
  const jR = [right - 0.05, topEave];
  const jPeak = [mid, topRidge];
  const xA = lerp(left, mid, 0.5);
  const xB = lerp(mid, right, 0.5);
  const jATop = [xA, yTop(xA)];
  const jBTop = [xB, yTop(xB)];
  const jABot = [xA, topEave];
  const jBBot = [xB, topEave];
  const jMidBot = [mid, topEave];

  return {
    type,
    top,
    bottom: [[jL, jR]],
    webs: [
      [jABot, jATop],
      [jBBot, jBTop],
      [jMidBot, jPeak],
      [jATop, jMidBot],
      [jBTop, jMidBot],
      [jABot, jPeak],
      [jBBot, jPeak],
    ],
  };
}

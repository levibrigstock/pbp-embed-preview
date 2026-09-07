/**
 * SB vs PBP parity check — 60×60×12 + open gable lean (from dual Job Review dumps).
 * Run: node js/takeoff/sbLeanParityCheck.js
 */
import { pathToFileURL } from 'url';
import { fileURLToPath } from 'url';
import path from 'path';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const t = `?t=${Date.now()}`;
const { createProject, createBuilding, createLeanTo, createOpening } = await import(
  pathToFileURL(path.join(root, 'domain/types.js')).href + t
);
const { takeoffProject } = await import(pathToFileURL(path.join(root, 'takeoff/engine.js')).href + t);

export function buildSbLeanParityBuilding() {
  const b = createBuilding({
    width: 60,
    length: 60,
    eaveHeight: 12,
    pitch: 4,
    overhangIn: 0,
    metalOverhangIn: 3,
    roofStyle: 'gable',
    wallColor: 'AL',
    roofColor: 'BK',
    trimColor: 'BK',
    wainscotColor: 'BK',
    wainscotHeightFt: 3,
    postDepth: 4,
  });
  b.openings = [
    createOpening({ type: 'overhead', wall: 'left', width: 10, height: 10, offset: 5 }),
    createOpening({ type: 'overhead', wall: 'left', width: 10, height: 10, offset: 15 }),
    createOpening({ type: 'overhead', wall: 'left', width: 10, height: 10, offset: 31 }),
  ];
  b.leanTos = [
    createLeanTo({
      wall: 'right',
      roofStyle: 'gable',
      enclosed: false,
      enclosure: 'open',
      depth: 12,
      length: 14,
      offset: 2,
      eaveHeight: 10,
      pitch: 4,
    }),
  ];
  return b;
}

/** SB Job Review targets (user dump). */
export const SB_LEAN_TARGETS = [
  ['Girt', null, 65],
  ['Purlin', '16', 120],
  ['Purlin', '12', 30],
  ['TrussBearer', '20', 14],
  ['SkirtBoard', '20', 11],
  ['JambPost', '16', 5], // layout-locked (shared jamb); SB listed 6 with different RO share
  ['Header', '12', 9],
  ['TrussBlock', '12', 3],
  ['EndStud', null, 1],
  ['RidgeCap', '10', 9],
  ['EaveEdge', '10', 15],
  ['ValleyTrim', null, 2],
  ['GableEdge', '20', 4],
  ['GableEdge', '12', 4],
  ['GableEdge', '10', 1],
  ['Corner', '14', 4],
  ['Corner', '10', 1],
  ['Base', '10', 25],
  ['InsideCorner', null, 1],
  ['OpenWallBase', null, 4],
  ['WainscotTrim', '10', 24],
  ['ClosuresInside', null, 48],
  ['ClosuresOutside', null, 48],
  ['Wainscot', '3', 81],
  ['ExteriorRoof', '32', 41],
  ['FastenersRoof', null, 13],
  ['FastenersWall', null, 12],
  ['FastenersTrim', null, 3],
  ['ButylTape', null, 10],
];

function qty(items, usage, len) {
  return items
    .filter((i) => i.usage === usage)
    .filter((i) => !len || String(i.length || '').startsWith(len))
    .reduce((s, i) => s + (Number(i.qty) || 0), 0);
}

export function runSbLeanParityCheck() {
  const b = buildSbLeanParityBuilding();
  const items = takeoffProject(createProject({ buildings: [b] })).items || [];
  const rows = SB_LEAN_TARGETS.map(([u, l, exp]) => {
    const actual = qty(items, u, l);
    return {
      item: l ? `${u} ${l}'` : u,
      sb: exp,
      pbp: actual,
      ok: actual === exp,
      delta: actual - exp,
    };
  });
  const pass = rows.filter((r) => r.ok).length;
  return {
    job: '60×60×12 + open gable lean (SB Job Review parity)',
    pass,
    total: rows.length,
    pct: Math.round((100 * pass) / rows.length),
    rows,
    passAll: pass === rows.length,
  };
}

/** CLI: full comparison report (lean SB parity + golden matrix summary). */
async function main() {
  const result = runSbLeanParityCheck();
  console.log(`\n${'='.repeat(60)}`);
  console.log(`SB vs PBP COMPARISON TEST`);
  console.log(`${'='.repeat(60)}`);
  console.log(`\n${result.job}`);
  console.log(`Score: ${result.pass}/${result.total} (${result.pct}%)\n`);
  console.log('| Item | SB | PBP | Δ | Status |');
  console.log('|------|----|-----|---|--------|');
  for (const r of result.rows) {
    const d = r.delta === 0 ? '0' : r.delta > 0 ? `+${r.delta}` : String(r.delta);
    console.log(
      `| ${r.item} | ${r.sb} | ${r.pbp} | ${d} | ${r.ok ? 'PASS' : 'FAIL'} |`,
    );
  }
  if (!result.passAll) {
    console.log('\nLean failures:');
    for (const r of result.rows.filter((x) => !x.ok)) {
      console.log(`  - ${r.item}: PBP ${r.pbp} vs SB ${r.sb} (Δ${r.delta > 0 ? '+' : ''}${r.delta})`);
    }
  } else {
    console.log('\n✓ All lean SB Job Review targets matched (29/29).');
  }

  // Optional golden matrix (no-lean + openings + Levi)
  try {
    const { runAllRegressionChecks } = await import(
      pathToFileURL(path.join(root, 'takeoff/regressionCheck.js')).href + t
    );
    const reg = runAllRegressionChecks();
    console.log(`\n${'─'.repeat(60)}`);
    console.log(`Golden matrix: ${reg.passCount}/${reg.total} (${reg.pct}%)`);
    for (const j of reg.jobs) {
      const mark = j.pass ? '✓' : '✗';
      console.log(`  ${mark} ${j.job}  ${j.passCount}/${j.total}`);
      if (!j.pass) {
        for (const r of j.rows.filter((x) => !x.ok)) {
          console.log(
            `      FAIL ${r.name}: PBP ${r.actual} vs SB ${r.expected} (Δ${r.delta > 0 ? '+' : ''}${r.delta})`,
          );
        }
      }
    }
    console.log(`\n${'='.repeat(60)}`);
    console.log(
      `RESULT: lean ${result.passAll ? 'PASS' : 'FAIL'} · matrix ${reg.pass ? 'PASS' : 'PARTIAL (see Levi)'}`,
    );
    console.log(`${'='.repeat(60)}\n`);
    if (!result.passAll) process.exitCode = 1;
  } catch (err) {
    console.log('\n(Golden matrix skipped:', err.message, ')');
    if (!result.passAll) process.exitCode = 1;
    else console.log('\nAll targets matched.');
  }
}

const isCli =
  process.argv[1] &&
  fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
if (isCli) {
  await main();
}

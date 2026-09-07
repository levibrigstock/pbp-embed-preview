/**
 * Production package — shop/field package: order list + plans.
 * Opens a window with Print (→ Save as PDF) and Download HTML (true save to disk).
 */

import { takeoffProject, money } from './engine.js?v=20260806f';

const ESC = (s) =>
  String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

function slugName(s) {
  return (
    String(s || 'production-package')
      .replace(/[^a-z0-9]+/gi, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 60) || 'production-package'
  );
}

/**
 * Build full HTML document string for the production package.
 * @param {object} project
 * @param {{ plansDataUrl?: string, buildingId?: string }} [opts]
 */
export function buildProductionPackageHtml(project, opts = {}) {
  if (!project) throw new Error('No project loaded.');

  const takeoff = takeoffProject(project);

  const b =
    project.buildings?.find((x) => x.id === (opts.buildingId || project.activeBuildingId)) ||
    project.buildings?.[0];
  const title = project.project || project.customer || 'Job';
  const now = new Date();
  const stamp = {
    job: title,
    customer: project.customer || '',
    date: now.toLocaleDateString(),
    time: now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
    rev: project.revision || 'A',
    fileBase: slugName(`${title}-${stampDate(now)}`),
  };

  const sizeLine = b
    ? `${b.width}′×${b.length}′×${b.eaveHeight}′ · ${b.pitch}/12 ${b.roofStyle || 'gable'}`
    : '';
  const ohIn = (b?.overhangIn || 0) + (b?.metalOverhangIn ?? 3);
  const leanLine = (b?.leanTos || [])
    .map((lt) => {
      const len = lt.length > 0 ? lt.length : 'full';
      return `${lt.wall} lean ${lt.depth}′×${len}`;
    })
    .join('; ');

  const sections = [
    'Framing',
    'Sheathing',
    'Trim',
    'Doors & Windows',
    'Accessories',
    'Trusses',
    'Insulation',
    'Concrete',
    'Freight',
  ];

  const byCat = {};
  for (const sec of sections) byCat[sec] = [];
  for (const i of takeoff.items || []) {
    const c = i.category || 'Other';
    if (!byCat[c]) byCat[c] = [];
    byCat[c].push(i);
  }

  let tablesHtml = '';
  for (const sec of sections) {
    const rows = byCat[sec] || [];
    if (!rows.length) continue;
    tablesHtml += `<section class="sec"><h2>${ESC(sec)}</h2>
 <table>
 <thead><tr>
 <th>Usage</th><th>SKU</th><th>Material</th><th>Color</th>
 <th>Angle</th><th>Len</th><th class="num">Qty</th>
 <th class="num">Cost</th><th class="num">Ext</th>
 </tr></thead><tbody>`;
    for (const i of rows) {
      tablesHtml += `<tr>
 <td><b>${ESC(i.usage || '')}</b></td>
 <td class="sku">${ESC(i.sku)}</td>
 <td>${ESC(i.description)}</td>
 <td>${ESC(i.color)}</td>
 <td>${ESC(i.angle || '')}</td>
 <td>${ESC(i.length)}</td>
 <td class="num">${ESC(i.qty)}</td>
 <td class="num">${money(i.cost)}</td>
 <td class="num">${money(i.extCost)}</td>
 </tr>`;
    }
    tablesHtml += `</tbody></table></section>`;
  }

  const plansImg = opts.plansDataUrl
    ? `<section class="sec plans"><h2>Construction Plans</h2>
 <img src="${opts.plansDataUrl}" alt="Plans" /></section>`
    : `<section class="sec"><p class="note">Plans image unavailable — use 2D / Plans → Print for drawings.</p></section>`;

  const mat = takeoff.material || 0;
  const labor = takeoff.laborSell != null ? takeoff.laborSell : takeoff.labor || 0;
  const freight = takeoff.freight || 0;
  const tax = takeoff.salesTax || 0;
  const total = takeoff.total || mat + labor + freight + tax;

  const fileBase = stamp.fileBase;

  return {
    fileBase,
    html: `<!DOCTYPE html>
<html lang="en">
<head>
 <meta charset="UTF-8" />
 <title>Production Package — ${ESC(title)}</title>
 <style>
    * { box-sizing: border-box; }
    body { margin: 0; font-family: Arial, Helvetica, sans-serif; font-size: 11px; color: #111; background: #fff; }
    .cover { padding: 28px 32px; border-bottom: 3px solid #222; page-break-after: always; }
    .cover h1 { font-size: 22px; margin: 0 0 6px; }
    .cover .sub { color: #444; margin-bottom: 18px; }
    .stamp { display: grid; grid-template-columns: 1fr 1fr; gap: 8px 24px; max-width: 640px; }
    .stamp div { border-bottom: 1px solid #ddd; padding: 4px 0; }
    .stamp b { display: inline-block; min-width: 110px; color: #333; }
    .banner { background: #1a1025; color: #f5e6d3; padding: 10px 16px; margin: 16px 0 0; font-weight: 700; }
    .totals { margin-top: 16px; font-size: 12px; }
    .totals span { margin-right: 16px; }
    .sec { padding: 16px 24px; page-break-inside: avoid; }
    .sec h2 { font-size: 14px; margin: 0 0 8px; border-bottom: 2px solid #333; padding-bottom: 4px; }
    table { width: 100%; border-collapse: collapse; margin-bottom: 8px; }
    th, td { border: 1px solid #ccc; padding: 3px 6px; text-align: left; vertical-align: top; }
    th { background: #f0ebe3; font-size: 10px; }
    td.num, th.num { text-align: right; white-space: nowrap; }
    .sku { font-family: ui-monospace, Menlo, monospace; font-size: 10px; color: #444; }
    .note { color: #666; font-style: italic; }
    .plans img { width: 100%; display: block; }
    .footer { position: fixed; bottom: 8px; left: 24px; right: 24px; font-size: 9px; color: #888;
      display: flex; justify-content: space-between; border-top: 1px solid #ddd; padding-top: 4px; }
    .actions {
      padding: 12px 20px; background: #1a1025; color: #f5e6d3;
      border-bottom: 3px solid #e8871a; display: flex; flex-wrap: wrap; gap: 10px; align-items: center;
      position: sticky; top: 0; z-index: 20;
    }
    .actions button {
      padding: 10px 16px; font-weight: 700; cursor: pointer; border-radius: 4px; border: 0; font-size: 13px;
    }
    .actions .btn-print { background: linear-gradient(90deg,#6b2d9b,#e8871a); color: #fff; }
    .actions .btn-save {
      background: #2a6a45; color: #e8f5e8; border: 1px solid #3a8a55;
    }
    .actions .btn-close { background: #333; color: #eee; }
    .actions .help { font-size: 11px; color: #c8b8a0; max-width: 420px; line-height: 1.35; }
    .actions .help b { color: #fff; }
    @media print {
      .no-print { display: none !important; }
      .sec { page-break-inside: auto; }
      thead { display: table-header-group; }
      .footer { position: running(footer); }
    }
 </style>
</head>
<body>
 <div class="actions no-print">
   <button type="button" class="btn-save" id="btnDownload">⬇ Download package</button>
   <button type="button" class="btn-print" id="btnPrint">Print / Save as PDF…</button>
   <button type="button" class="btn-close" onclick="window.close()">Close</button>
   <span class="help">
     <b>Download</b> saves this package to your computer as an HTML file (always works).<br/>
     <b>Print / Save as PDF</b> → in the dialog set <b>Destination = Save as PDF</b> (Chrome/Edge)
     or <b>PDF → Save as PDF</b> (Safari/Mac).
   </span>
 </div>

 <div class="cover">
 <h1>Production Package</h1>
 <div class="sub">We Build Structures · PoleBarn Pro · Order list + construction plans</div>
 <div class="stamp">
 <div><b>Job</b> ${ESC(stamp.job)}</div>
 <div><b>Customer</b> ${ESC(stamp.customer) || '—'}</div>
 <div><b>Date</b> ${ESC(stamp.date)} ${ESC(stamp.time)}</div>
 <div><b>Revision</b> ${ESC(stamp.rev)}</div>
 <div><b>Building</b> ${ESC(sizeLine)}</div>
 <div><b>Overhang</b> ${ohIn}" total (frame+metal)</div>
 <div><b>Lean-tos</b> ${ESC(leanLine) || 'none'}</div>
 <div><b>Wainscot</b> ${b?.wainscotColor && b.wainscotColor !== 'NONE' ? ESC(String(b.wainscotHeightFt || 3) + "′ " + b.wainscotColor) : 'none'}</div>
 <div><b>Wall / Roof</b> ${ESC(b?.wallColor || '—')} / ${ESC(b?.roofColor || '—')}</div>
 <div><b>Trim</b> ${ESC(b?.trimColor || b?.roofColor || '—')}</div>
 <div><b>Post embed</b> ${ESC(b?.postDepthFt ?? 3)}′</div>
 <div><b>Lines</b> ${(takeoff.items || []).length}</div>
 </div>
 <div class="banner">MATERIAL ORDER LIST</div>
 <div class="totals">
 <span><b>Materials</b> ${money(mat)}</span>
 <span><b>Labor</b> ${money(labor)}</span>
 <span><b>Freight</b> ${money(freight)}</span>
 <span><b>Tax</b> ${money(tax)}</span>
 <span><b>Total</b> ${money(total)}</span>
 </div>
 <p class="note" style="margin-top:14px">
 Shop: use Length + Angle on Trim. Field: plans below show panel stations and framing.
 Peak posts ordered as catalog stock may note <b>FIELD SPLICED</b> lengths for the crew.
 </p>
 </div>

 ${tablesHtml}
 ${plansImg}

 <div class="footer">
 <span>${ESC(stamp.job)} · Rev ${ESC(stamp.rev)}</span>
 <span>PoleBarn Pro production package · ${ESC(stamp.date)}</span>
 </div>

 <script>
 (function () {
   var FILE = ${JSON.stringify(fileBase + '-production-package.html')};
   function downloadHtml() {
     try {
       var html = '<!DOCTYPE html>\\n' + document.documentElement.outerHTML;
       // Strip the sticky action bar from saved file so print is clean when reopened
       // Keep a simple reopen tip
       var blob = new Blob([html], { type: 'text/html;charset=utf-8' });
       var a = document.createElement('a');
       a.href = URL.createObjectURL(blob);
       a.download = FILE;
       document.body.appendChild(a);
       a.click();
       setTimeout(function () {
         URL.revokeObjectURL(a.href);
         a.remove();
       }, 500);
     } catch (e) {
       alert('Download failed: ' + (e.message || e));
     }
   }
   function doPrint() {
     window.print();
   }
   var d = document.getElementById('btnDownload');
   var p = document.getElementById('btnPrint');
   if (d) d.addEventListener('click', downloadHtml);
   if (p) p.addEventListener('click', doPrint);
 })();
 </script>
</body>
</html>`,
  };
}

function stampDate(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}${m}${day}`;
}

/**
 * Open production package window (print + download).
 * @param {object} project
 * @param {{ plansDataUrl?: string, buildingId?: string }} [opts]
 */
export function printProductionPackage(project, opts = {}) {
  if (!project) {
    alert('No project loaded.');
    return;
  }

  let built;
  try {
    built = buildProductionPackageHtml(project, opts);
  } catch (err) {
    console.error(err);
    alert('Takeoff failed: ' + (err.message || err));
    return;
  }

  const w = window.open('', '_blank');
  if (!w) {
    // Pop-up blocked — fall back to direct download of the HTML package
    try {
      const blob = new Blob([built.html], { type: 'text/html;charset=utf-8' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `${built.fileBase}-production-package.html`;
      a.click();
      URL.revokeObjectURL(a.href);
      alert(
        'Pop-up blocked — package downloaded as HTML instead.\n\nOpen the file, then use Print → Save as PDF if you need a PDF.',
      );
    } catch (e) {
      alert('Pop-up blocked and download failed. Allow pop-ups for this site.');
    }
    return;
  }
  w.document.open();
  w.document.write(built.html);
  w.document.close();
}

/**
 * Download production package HTML without opening a window.
 * @param {object} project
 * @param {{ plansDataUrl?: string, buildingId?: string }} [opts]
 */
export function downloadProductionPackage(project, opts = {}) {
  if (!project) {
    alert('No project loaded.');
    return;
  }
  try {
    const built = buildProductionPackageHtml(project, opts);
    const blob = new Blob([built.html], { type: 'text/html;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `${built.fileBase}-production-package.html`;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => {
      URL.revokeObjectURL(a.href);
      a.remove();
    }, 500);
  } catch (err) {
    console.error(err);
    alert('Download failed: ' + (err.message || err));
  }
}

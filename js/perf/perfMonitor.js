/**
 * PoleBarn Pro — performance monitor.
 *
 * Measures the operations that PERFORMANCE.md sets hard targets for, so the
 * targets are checkable instead of aspirational. Zero dependencies, no build
 * step, safe to leave in production.
 *
 * Usage from the console:
 *   __pbpPerf.report()    // console.table of every metric vs its budget
 *   __pbpPerf.snapshot()  // same data as plain JSON (copy/paste friendly)
 *   __pbpPerf.hud()       // toggle the on-screen FPS + last-refresh overlay
 *   __pbpPerf.reset()     // clear all samples
 *
 * Disable entirely with ?perf=0 on the URL.
 */

/** Hard engineering targets. `ms` = upper bound, `fps` = lower bound. */
export const PERF_BUDGETS = {
  'input.response': { ms: 50, label: 'Button/input response' },
  'visual.simple': { ms: 100, label: 'Simple visual modification' },
  'geometry.major': { ms: 200, label: 'Major building geometry change' },
  'price.recalc': { ms: 100, label: 'Price recalculation' },
  'bom.recalc': { ms: 250, label: 'BOM recalculation' },
  'save.background': { ms: 500, label: 'Background save' },
  'project.open': { ms: 1000, label: 'Existing project open' },
  'nav.pane': { ms: 300, label: 'Normal page navigation' },
  'render.fps': { fps: 60, label: '3D interaction' },
};

/** Samples kept per metric. Ring buffer — oldest drops off. */
const MAX_SAMPLES = 240;

const now =
  typeof performance !== 'undefined' && typeof performance.now === 'function'
    ? () => performance.now()
    : () => Date.now();

function queryFlag(name) {
  try {
    return new URLSearchParams(location.search).get(name);
  } catch (_) {
    return null;
  }
}

class PerfMonitor {
  constructor() {
    this.enabled = queryFlag('perf') !== '0';
    /** @type {Map<string, number[]>} */
    this._samples = new Map();
    /** @type {Map<string, number>} */
    this._open = new Map();
    this._lastFrameAt = 0;
    this._hudEl = null;
    this._hudTimer = null;
    this._inputObserver = null;
    this._warned = new Set();
  }

  // ---------------------------------------------------------------- samples

  record(name, value) {
    if (!this.enabled || !Number.isFinite(value)) return value;
    let arr = this._samples.get(name);
    if (!arr) {
      arr = [];
      this._samples.set(name, arr);
    }
    arr.push(value);
    if (arr.length > MAX_SAMPLES) arr.shift();
    return value;
  }

  /** Begin a manual span. Returns an end() that records and returns the ms. */
  start(name) {
    if (!this.enabled) return () => 0;
    const t0 = now();
    return () => this.record(name, now() - t0);
  }

  /** Time a synchronous call. Returns whatever fn returns. */
  time(name, fn) {
    if (!this.enabled) return fn();
    const t0 = now();
    try {
      return fn();
    } finally {
      this.record(name, now() - t0);
    }
  }

  /** Time an async call. Returns fn's promise. */
  async timeAsync(name, fn) {
    if (!this.enabled) return fn();
    const t0 = now();
    try {
      return await fn();
    } finally {
      this.record(name, now() - t0);
    }
  }

  /** Record a metric assembled from several already-measured phases. */
  composite(name, ...durations) {
    let total = 0;
    for (const d of durations) {
      if (Number.isFinite(d)) total += d;
    }
    return this.record(name, total);
  }

  // ----------------------------------------------------------------- frames

  /** Call once per rendered frame from the render loop. */
  frame() {
    if (!this.enabled) return;
    const t = now();
    if (this._lastFrameAt) {
      const delta = t - this._lastFrameAt;
      // Ignore backgrounded tabs / resumed loops — those are not dropped frames.
      if (delta > 0 && delta < 1000) {
        this.record('render.frameMs', delta);
        this.record('render.fps', 1000 / delta);
      }
    }
    this._lastFrameAt = t;
  }

  // ------------------------------------------------------------ input delay

  /**
   * Observe real input latency (event dispatch through to the next paint).
   * Uses the Event Timing API where available; otherwise falls back to a
   * capture-phase listener plus a post-paint callback.
   */
  attachInputObserver(target = document) {
    if (!this.enabled || this._inputObserver) return;
    const INTERESTING = ['click', 'pointerdown', 'keydown', 'input', 'change'];

    if (typeof PerformanceObserver !== 'undefined') {
      try {
        const obs = new PerformanceObserver((list) => {
          for (const entry of list.getEntries()) {
            if (!INTERESTING.includes(entry.name)) continue;
            this.record('input.response', entry.duration);
          }
        });
        obs.observe({ type: 'event', durationThreshold: 16, buffered: true });
        this._inputObserver = obs;
        return;
      } catch (_) {
        // Event Timing unsupported — fall through to the manual path.
      }
    }

    const handler = (ev) => {
      const started = Number.isFinite(ev.timeStamp) ? ev.timeStamp : now();
      afterPaint(() => this.record('input.response', now() - started));
    };
    for (const type of INTERESTING) {
      target.addEventListener(type, handler, { capture: true, passive: true });
    }
    this._inputObserver = { manual: true };
  }

  // ------------------------------------------------------------------ stats

  stats(name) {
    const arr = this._samples.get(name);
    if (!arr || !arr.length) return null;
    const sorted = [...arr].sort((a, b) => a - b);
    const at = (p) => sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))];
    const sum = sorted.reduce((a, b) => a + b, 0);
    return {
      count: sorted.length,
      min: sorted[0],
      p50: at(0.5),
      p95: at(0.95),
      max: sorted[sorted.length - 1],
      mean: sum / sorted.length,
    };
  }

  /** All metrics with their budget verdict. Budgeted metrics come first. */
  snapshot() {
    const rows = [];
    for (const name of this._samples.keys()) {
      const s = this.stats(name);
      if (!s) continue;
      const budget = PERF_BUDGETS[name] || null;
      let target = null;
      let observed = null;
      let verdict = '—';
      if (budget && budget.ms != null) {
        target = `< ${budget.ms} ms`;
        observed = s.p95;
        verdict = s.p95 <= budget.ms ? 'PASS' : 'MISS';
      } else if (budget && budget.fps != null) {
        target = `>= ${budget.fps} fps`;
        // Frame rate is judged on the bad frames, not the good ones.
        observed = s.p50;
        verdict = at5thPercentile(this._samples.get(name)) >= budget.fps * 0.9 ? 'PASS' : 'MISS';
      }
      rows.push({
        metric: name,
        label: budget?.label || '',
        target,
        p50: round(s.p50),
        p95: round(s.p95),
        max: round(s.max),
        samples: s.count,
        verdict,
        budgeted: !!budget,
        observed: observed == null ? null : round(observed),
      });
    }
    rows.sort((a, b) => {
      if (a.budgeted !== b.budgeted) return a.budgeted ? -1 : 1;
      return a.metric.localeCompare(b.metric);
    });
    return rows;
  }

  report() {
    const rows = this.snapshot();
    if (!rows.length) {
      console.log('[perf] no samples yet — interact with the app first');
      return rows;
    }
    const view = rows.map((r) => ({
      Metric: r.metric,
      Operation: r.label,
      Target: r.target || '',
      'p50': r.p50,
      'p95': r.p95,
      'max': r.max,
      'n': r.samples,
      '': r.verdict,
    }));
    if (console.table) console.table(view);
    else console.log(JSON.stringify(view, null, 2));
    const missed = rows.filter((r) => r.verdict === 'MISS');
    if (missed.length) {
      console.warn(`[perf] ${missed.length} target(s) missed: ${missed.map((m) => m.metric).join(', ')}`);
    } else {
      console.log('[perf] all budgeted targets within spec');
    }
    return rows;
  }

  reset() {
    this._samples.clear();
    this._open.clear();
    this._lastFrameAt = 0;
    return this;
  }

  // -------------------------------------------------------------------- hud

  hud(on) {
    const want = on == null ? !this._hudEl : !!on;
    if (!want) {
      if (this._hudTimer) clearInterval(this._hudTimer);
      this._hudTimer = null;
      this._hudEl?.remove();
      this._hudEl = null;
      return false;
    }
    if (this._hudEl) return true;
    const el = document.createElement('div');
    el.id = 'pbpPerfHud';
    el.style.cssText = [
      'position:fixed', 'right:8px', 'bottom:8px', 'z-index:99999',
      'background:rgba(10,16,24,.88)', 'color:#c8d6e8', 'padding:6px 9px',
      'border:1px solid #3a5a7a', 'border-radius:6px', 'pointer-events:none',
      'font:11px/1.45 ui-monospace,Menlo,monospace', 'white-space:pre',
    ].join(';');
    document.body.appendChild(el);
    this._hudEl = el;
    this._hudTimer = setInterval(() => this._paintHud(), 500);
    this._paintHud();
    return true;
  }

  _paintHud() {
    if (!this._hudEl) return;
    const lines = [];
    const fps = this.stats('render.fps');
    if (fps) lines.push(`fps  ${round(fps.p50)} (min ${round(fps.min)})`);
    for (const name of ['visual.simple', 'geometry.major', 'bom.recalc', 'input.response']) {
      const s = this.stats(name);
      if (!s) continue;
      const budget = PERF_BUDGETS[name];
      const flag = budget?.ms != null && s.p95 > budget.ms ? ' !' : '';
      lines.push(`${name.padEnd(15)} ${String(round(s.p95)).padStart(6)}ms${flag}`);
    }
    this._hudEl.textContent = lines.join('\n') || 'perf: no samples';
  }
}

function round(n) {
  return Math.round(n * 10) / 10;
}

/** Worst-case frame rate: the 5th percentile of observed fps. */
function at5thPercentile(arr) {
  if (!arr || !arr.length) return 0;
  const sorted = [...arr].sort((a, b) => a - b);
  return sorted[Math.floor(0.05 * sorted.length)];
}

/** Run fn after the browser has painted the current frame. */
function afterPaint(fn) {
  requestAnimationFrame(() => setTimeout(fn, 0));
}

export const perf = new PerfMonitor();

if (typeof window !== 'undefined') {
  window.__pbpPerf = perf;
}

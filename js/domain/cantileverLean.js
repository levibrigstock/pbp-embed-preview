/**
 * Cantilever lean-to eave limits.
 *
 * A cantilever lean has no posts: its rafters hang off a ledger on the main
 * wall, so the whole roof slides up and down that wall with `lean.eaveHeight`
 * (outer / low eave). The high side (eave + depth × pitch) sits on the ledger
 * and must stay at or below the main eave; `max` is that limit floored to the
 * inch. `min` keeps walking headroom under the tip (7').
 *
 * Stored values are never rewritten on load — old jobs keep their saved eave.
 * The clamp runs when an eave is entered (Add / Edit), so any edit moves the
 * lean and the value shown is the value stored.
 */
export const CANTILEVER_EAVE_MIN_FT = 7;

export function cantileverLeanEaveLimits(b, lean) {
  const mainEaveFt = Number(b?.eaveHeight) || 12;
  const depth = Math.max(2, Number(lean?.depth) || 12);
  const pitch = Number(lean?.pitch) || Number(b?.pitch) || 4;
  const riseFt = depth * (pitch / 12);
  const maxRaw = Math.floor((mainEaveFt - riseFt) * 12 + 1e-6) / 12;
  const min = CANTILEVER_EAVE_MIN_FT;
  const max = Math.max(min, maxRaw);
  return {
    min,
    max,
    mainEaveFt,
    riseFt,
    /** Flush under the main eave — what a new cantilever gets. */
    defaultFt: max,
    /** false when even a 7' eave cannot fit this depth × pitch under the main eave */
    pitchValid: maxRaw >= min,
  };
}

/** Clamp a requested cantilever outer eave (ft) into range, rounded to the inch. */
export function clampCantileverLeanEave(b, lean, ft) {
  const lim = cantileverLeanEaveLimits(b, lean);
  const n = Number(ft);
  if (!Number.isFinite(n) || n <= 0) return lim.defaultFt;
  const c = Math.min(lim.max, Math.max(lim.min, n));
  return Math.min(lim.max, Math.round(c * 12) / 12);
}

/**
 * True when a cantilever's stored eave fits under the main eave (high side =
 * eave + rise ≤ main eave). Then the ledger/attach line is eave + rise and
 * the whole lean translates with the eave; renderers must not snap it back
 * to the main-eave "continuous" plane.
 */
export function cantileverEaveInRange(b, lean) {
  const mainEaveFt = Number(b?.eaveHeight) || 12;
  const outer = Number(lean?.eaveHeight) || 0;
  const rise = (Number(lean?.depth) || 0) * ((Number(lean?.pitch) || 3) / 12);
  return outer > 0 && outer + rise <= mainEaveFt + 0.01;
}

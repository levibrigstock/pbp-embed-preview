/**
 * Job Errors & Warnings — SmartBuild-style message list for quote/review gates.
 * Combines construction rules (error/warn) with sales/ops checklist reminders.
 */

import { evaluateProjectRules } from './postFrameRules.js?v=20260806f';
import { roofRise } from '../domain/types.js?v=20260806f';

/**
 * @typedef {{ level: 'error'|'warn', code: string, message: string, category?: string, buildingName?: string }} JobMessage
 */

/**
 * Sales / ops checklist (always useful at quote time).
 * @param {object} project
 * @param {object} [takeoff]
 * @returns {JobMessage[]}
 */
export function collectChecklistMessages(project, takeoff = null) {
  /** @type {JobMessage[]} */
  const out = [];
  const freight = Number(project?.freightMiles) || 0;
  const tax = Number(project?.salesTaxPct);
  const buildings = project?.buildings || [];

  if (freight <= 0) {
    out.push({
      level: 'warn',
      code: 'CHECK_FREIGHT',
      message: 'Did you add freight (miles) to the quote?',
      category: 'Quote',
    });
  }

  if (!Number.isFinite(tax) || tax <= 0) {
    out.push({
      level: 'warn',
      code: 'CHECK_TAX',
      message: 'Did you add sales tax to the quote?',
      category: 'Quote',
    });
  }

  // Truss / shipping style reminders (size-aware)
  let maxLen = 0;
  let maxEave = 0;
  let maxPeak = 0;
  let hasLean = false;
  for (const b of buildings) {
    maxLen = Math.max(maxLen, Number(b.length) || 0);
    maxEave = Math.max(maxEave, Number(b.eaveHeight) || 0);
    const peak = (Number(b.eaveHeight) || 0) + (roofRise(b) || 0);
    maxPeak = Math.max(maxPeak, peak);
    if ((b.leanTos || []).length) hasLean = true;
  }

  if (maxLen > 50) {
    out.push({
      level: 'warn',
      code: 'TRUSS_LENGTH_SHIP',
      message: `Truss lengths over 50' may require a separate roll-off truck (building length ${maxLen}').`,
      category: 'Shipping',
    });
  }

  // Tall packages only (avoid noise on standard 10–12′ shops)
  if (maxPeak >= 22 || maxEave >= 14) {
    out.push({
      level: 'warn',
      code: 'TRUSS_HEIGHT_PERMIT',
      message: `Truss height may require permits by state (peak ~${maxPeak.toFixed(1)}', eave ${maxEave}').`,
      category: 'Code',
    });
  }

  out.push({
    level: 'warn',
    code: 'CHECK_TRUSS_BRACING',
    message: 'Did you include BC/web bracing in packages for truss braces?',
    category: 'Truss',
  });

  if (hasLean) {
    out.push({
      level: 'warn',
      code: 'CHECK_LEAN_FLASH',
      message: 'Lean-to present — confirm transition flashing and attachment ledger on the order.',
      category: 'Lean-to',
    });
  }

  // Openings without freight already covered; large OH count
  let ohCount = 0;
  for (const b of buildings) {
    for (const o of b.openings || []) {
      if ((o.type || '') === 'overhead' || (o.type || '') === 'slider') ohCount += 1;
    }
  }
  if (ohCount >= 2) {
    out.push({
      level: 'warn',
      code: 'CHECK_OH_HEADERS',
      message: `${ohCount} overhead/slider doors — verify header sizes and jamb posts on the framing tab.`,
      category: 'Openings',
    });
  }

  // Empty job
  if (!buildings.length) {
    out.push({
      level: 'error',
      code: 'NO_BUILDING',
      message: 'No building on this job — add dimensions before quoting.',
      category: 'Job',
    });
  }

  // Takeoff sanity
  if (takeoff && Array.isArray(takeoff.items) && takeoff.items.length === 0 && buildings.length) {
    out.push({
      level: 'error',
      code: 'EMPTY_TAKEOFF',
      message: 'Takeoff produced no line items — check building size and catalog.',
      category: 'Takeoff',
    });
  }

  return out;
}

/**
 * Construction rules that are not "ok".
 * @param {object} project
 * @param {object[]} [takeoffItems]
 * @returns {JobMessage[]}
 */
export function collectRuleMessages(project, takeoffItems = null) {
  const rules = evaluateProjectRules(project, takeoffItems) || [];
  return rules
    .filter((r) => r.level === 'error' || r.level === 'warn')
    .map((r) => ({
      level: r.level,
      code: r.code,
      message: r.buildingName ? `[${r.buildingName}] ${r.message}` : r.message,
      category: r.category || 'Construction',
      buildingName: r.buildingName,
    }));
}

/**
 * Full Errors & Warnings list for the modal.
 * @param {object} project
 * @param {object} [takeoff]
 * @returns {{ errors: JobMessage[], warnings: JobMessage[], all: JobMessage[], errorCount: number, warnCount: number, total: number }}
 */
export function collectJobMessages(project, takeoff = null) {
  const items = takeoff?.items || null;
  const rules = collectRuleMessages(project, items);
  const checks = collectChecklistMessages(project, takeoff);
  // Dedupe by code+message
  const seen = new Set();
  /** @type {JobMessage[]} */
  const all = [];
  for (const m of [...rules, ...checks]) {
    const key = `${m.level}|${m.code}|${m.message}`;
    if (seen.has(key)) continue;
    seen.add(key);
    all.push(m);
  }
  const errors = all.filter((m) => m.level === 'error');
  const warnings = all.filter((m) => m.level === 'warn');
  return {
    errors,
    warnings,
    all,
    errorCount: errors.length,
    warnCount: warnings.length,
    total: all.length,
  };
}

/**
 * Sales board CRM — Kanban pipeline (encrypted localStorage per user).
 * Drag cards between columns; expand later with API sync.
 */

import { loadSealed, saveSealed, isVaultUnlocked } from '../security/cryptoVault.js';

const CRM_STORAGE_PREFIX = 'polebarn_pro_sales_board_';

export const DEFAULT_COLUMNS = [
 { id: 'design', title: 'In Design', subtitle: 'PoleBarn Pro' },
 { id: 'pending', title: 'Pending Estimates', subtitle: 'Pending Estimate' },
 { id: 'old_pending', title: 'Old Pending', subtitle: 'Old Pending' },
 { id: 'leads', title: 'Company Leads', subtitle: 'Company Leads' },
 { id: 'email', title: 'Email ONLY', subtitle: 'Email ONLY' },
 { id: 'requote', title: 'Re-Quote', subtitle: 'Re-Quote' },
];

function uid(prefix = 'card') {
 return `${prefix}_${Math.random().toString(36).slice(2, 10)}`;
}

function storageKey(userId) {
 return `${CRM_STORAGE_PREFIX}${userId || 'local'}`;
}

export function defaultBoard() {
 return {
 columns: DEFAULT_COLUMNS.map((c) => ({ ...c })),
 cards: [],
 };
}

function normalizeBoard(data) {
 if (!data || typeof data !== 'object') return defaultBoard();
 if (!data.columns?.length) data.columns = DEFAULT_COLUMNS.map((c) => ({ ...c }));
 if (!Array.isArray(data.cards)) data.cards = [];
 for (const col of DEFAULT_COLUMNS) {
 if (!data.columns.find((c) => c.id === col.id)) {
 data.columns.push({ ...col });
 }
 }
 return data;
}

/** Load CRM board (decrypts / migrates plaintext when vault is unlocked). */
export async function loadBoard(userId) {
 try {
 if (!isVaultUnlocked()) return defaultBoard();
 const data = await loadSealed(storageKey(userId), { migrate: true });
 if (!data) return defaultBoard();
 return normalizeBoard(data);
 } catch (err) {
 console.warn('loadBoard failed', err);
 return defaultBoard();
 }
}

/** Persist CRM board (encrypted). */
export async function saveBoard(userId, board) {
 try {
 if (!isVaultUnlocked()) {
 console.warn('saveBoard: vault locked');
 return false;
 }
 await saveSealed(storageKey(userId), board);
 return true;
 } catch (err) {
 console.warn('saveBoard failed', err);
 return false;
 }
}

export function createCard(partial = {}) {
 const now = new Date().toISOString();
 return {
 id: partial.id || uid('card'),
 name: partial.name || 'New lead',
 stage: partial.stage || 'leads',
 pipeline: partial.pipeline || 'Residential Retail',
 salesman: partial.salesman || '',
 assignees: Array.isArray(partial.assignees)
 ? partial.assignees
 : partial.salesman
 ? [initials(partial.salesman)]
 : [],
 address: partial.address || '',
 state: partial.state || '',
 jobId: partial.jobId || '',
 jobLink: partial.jobLink || '',
 notes: partial.notes || '',
 daysInStage: partial.daysInStage ?? 0,
 docsDone: partial.docsDone ?? 0,
 docsTotal: partial.docsTotal ?? 0,
 calls: partial.calls ?? 0,
 order: partial.order ?? Date.now(),
 stageEnteredAt: partial.stageEnteredAt || now,
 createdAt: partial.createdAt || now,
 updatedAt: now,
 };
}

export function initials(name) {
 const parts = String(name || '')
 .trim()
 .split(/\s+/)
 .filter(Boolean);
 if (!parts.length) return '?';
 if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
 return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

export function cardsInColumn(board, columnId) {
 return (board.cards || [])
 .filter((c) => c.stage === columnId)
 .sort((a, b) => (a.order || 0) - (b.order || 0));
}

export function moveCard(board, cardId, toStage, beforeCardId = null) {
 const card = board.cards.find((c) => c.id === cardId);
 if (!card) return board;
 const fromStage = card.stage;
 if (fromStage !== toStage) {
 card.stage = toStage;
 card.stageEnteredAt = new Date().toISOString();
 card.daysInStage = 0;
 }
 const colCards = cardsInColumn(board, toStage).filter((c) => c.id !== cardId);
 let insertAt = colCards.length;
 if (beforeCardId) {
 const idx = colCards.findIndex((c) => c.id === beforeCardId);
 if (idx >= 0) insertAt = idx;
 }
 colCards.splice(insertAt, 0, card);
 colCards.forEach((c, i) => {
 c.order = i;
 c.updatedAt = new Date().toISOString();
 });
 return board;
}

export function daysSince(iso) {
 if (!iso) return 0;
 const t = new Date(iso).getTime();
 if (Number.isNaN(t)) return 0;
 return Math.max(0, Math.floor((Date.now() - t) / 86400000));
}

export function avatarColor(seed) {
 const colors = [
 '#6b2d9b',
 '#e8871a',
 '#b8337a',
 '#3d7a9a',
 '#5a8a3a',
 '#c45c2a',
 '#4a6ab0',
 '#8a4a9a',
 ];
 let h = 0;
 const s = String(seed || '?');
 for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
 return colors[Math.abs(h) % colors.length];
}

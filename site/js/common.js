// Shared helpers for host and player.

export const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export const $ = (sel, root = document) => root.querySelector(sel);

export function newCode() {
  const A = 'ABCDEFGHJKLMNPQRSTUVWXYZ'; // no I or O
  let c = '';
  const r = crypto.getRandomValues(new Uint32Array(4));
  for (const n of r) c += A[n % A.length];
  return c;
}

export function newId() {
  const b = crypto.getRandomValues(new Uint8Array(9));
  return Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
}

// Answer order for a question. Seeded by the question's id, so the TV and every phone
// show the same order (A–D letters match) without sending it over the wire.
export function shuffled(seed, arr) {
  let h = 2166136261;
  for (const c of String(seed)) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
  const rand = () => {
    h = Math.imul(h ^ (h >>> 15), h | 1) ^ (h + Math.imul(h ^ (h >>> 7), h | 61));
    return ((h ^ (h >>> 14)) >>> 0) / 4294967296;
  };
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export const chUp = (code) => `/game/${code}/up`;
export const chDown = (code) => `/game/${code}/down`;

export function cleanName(s) {
  return String(s || '')
    .replace(/[^\p{L}\p{N} '.\-ʻ]/gu, '')
    .trim()
    .slice(0, 16);
}

export function fmtTime(ts) {
  return new Date(ts).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', second: '2-digit' });
}

export function store(key, val) {
  try {
    if (val === undefined) return JSON.parse(localStorage.getItem(key) || 'null');
    localStorage.setItem(key, JSON.stringify(val));
  } catch {
    return null;
  }
}

export function statusDot(el, status) {
  el.dataset.status = status;
  el.title = status;
}

/**
 * Book-aligned miner rollup: utilised threads vs device inventory,
 * and proven-hash H/s (accepts × 2^shareBits / elapsed), not share/s.
 */
import { hashesProvenByShare, SHARE_DIFFICULTY_BITS } from './book_law.js';

export const HASHRATE_WINDOW_MS = 72_000;
export const MAX_THREADS = 256;

export function provenHashrate({
  accepts = 0,
  shareBits = SHARE_DIFFICULTY_BITS,
  elapsedMs = 1000,
} = {}) {
  const n = Math.max(0, Math.floor(Number(accepts) || 0));
  const hashes = n * hashesProvenByShare(shareBits);
  const dt = Math.max(1, Math.max(0, Number(elapsedMs) || 0) / 1000);
  return hashes / dt;
}

export function provenHashrateFromAccepts(
  acceptAt,
  shareBits = SHARE_DIFFICULTY_BITS,
  now = Date.now(),
  windowMs = HASHRATE_WINDOW_MS,
) {
  const at = Number(now) || Date.now();
  const win = Math.max(1, Number(windowMs) || HASHRATE_WINDOW_MS);
  const cut = at - win;
  const hits = (Array.isArray(acceptAt) ? acceptAt : []).filter((t) => Number(t) > cut);
  if (!hits.length) {
    return { hashrate: 0, accepts: 0, hits: [], spanMs: 0 };
  }
  const spanMs = Math.max(1000, Math.min(win, at - hits[0]));
  return {
    hashrate: provenHashrate({ accepts: hits.length, shareBits, elapsedMs: spanMs }),
    accepts: hits.length,
    hits,
    spanMs,
  };
}

export function utilisedThreadsOf(row) {
  const n = Math.floor(Number(row?.claimedThreads ?? row?.running ?? row?.threads ?? 0));
  if (!Number.isFinite(n) || n < 0) return 0;
  return Math.min(MAX_THREADS, n);
}

export function deviceCpuThreadsOf(row) {
  const n = Math.floor(Number(row?.cpuThreads || 0));
  if (!Number.isFinite(n) || n < 0) return 0;
  return Math.min(MAX_THREADS, n);
}

export function deviceCpuCoresOf(row) {
  const n = Math.floor(Number(row?.cpuCores || 0));
  if (!Number.isFinite(n) || n < 0) return 0;
  return Math.min(MAX_THREADS, n);
}

export function rollupHonesty(workers) {
  const list = Array.isArray(workers) ? workers : [];
  if (!list.length) return 'unknown';
  if (list.some((w) => w.threadHonesty === 'inflate')) return 'inflate';
  if (list.some((w) => w.threadHonesty === 'underreport')) return 'underreport';
  if (list.every((w) => w.threadHonesty === 'honest')) return 'honest';
  return 'unknown';
}

/** Roll up workers: utilised = sum claimed, device threads/cores = max, not sum. */
export function rollupMinerWorkers(tag, workers) {
  const list = Array.isArray(workers) ? workers : [];
  const sum = (key) => list.reduce((s, w) => s + Number(w[key] || 0), 0);
  const utilised = list.reduce((s, w) => s + utilisedThreadsOf(w), 0);
  return {
    tag: String(tag || ''),
    hashrate: sum('hashrate'),
    accepted: sum('accepted'),
    rejected: sum('rejected'),
    threads: utilised,
    hashes: sum('hashes'),
    hashesThisRound: sum('hashesThisRound'),
    connected: list.some((w) => w.connected),
    claimedThreads: utilised,
    cpuThreads: Math.max(0, ...list.map((w) => deviceCpuThreadsOf(w))),
    cpuCores: Math.max(0, ...list.map((w) => deviceCpuCoresOf(w))),
    inferredThreads: sum('inferredThreads'),
    threadsHonest: list.every((w) => w.threadsHonest !== false),
    threadHonesty: rollupHonesty(list),
  };
}

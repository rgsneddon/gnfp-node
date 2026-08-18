/**
 * Immutable book law. Every gnfp-node uses these rules.
 * Pool / explorer only report them — they do not invent a second difficulty.
 */
import { createHash } from 'crypto';
/** Legacy 1e-8 subunit (1 GNFP pot). Too coarse for the 1e-9 hash bonus. */
export const UNITS_PER_GNFP = 100_000_000;
export const NANOS_PER_GNFP = 1_000_000_000;
export const BLOCK_REWARD_GNFP = 1;
export const BLOCK_REWARD_MICRO = UNITS_PER_GNFP;
export const BLOCK_REWARD_NANOS = NANOS_PER_GNFP;
/** 0.000000001 GNFP per in-window hash. Resets every formed block. */
export const HASH_BONUS_NANOS = 1;
export const HASH_BONUS_GNFP = HASH_BONUS_NANOS / NANOS_PER_GNFP;
/** Public pool/explorer preview. Amounts honest; parties sheared. */
export const PUBLIC_TX_PREVIEW = 10;
/** @deprecated old 1e-8 per accepted share — do not use for new credits */
export const SHARE_CREDIT_MICRO = 0;
/** Target spacing for retarget. Not a mint clock. */
export const TARGET_BLOCK_INTERVAL_MS = 90_000;
export const MIN_DIFFICULTY_BITS = 1;
export const MAX_DIFFICULTY_BITS = 32;
/** Live floor: 2^14 hashes ≈ 90s at ~182 H/s. Never collapse to 1/8-bit on restart. */
export const LIVE_MIN_DIFFICULTY_BITS = 14;
/** Unknown hashrate (restart) aims ~90s at a few hundred H/s. */
export const GENESIS_DIFFICULTY_BITS = 21;

export function clampDifficultyBits(bits) {
  const n = Math.floor(Number(bits) || 0);
  if (!Number.isFinite(n) || n <= 0) return GENESIS_DIFFICULTY_BITS;
  return Math.max(MIN_DIFFICULTY_BITS, Math.min(MAX_DIFFICULTY_BITS, n));
}

export function expectedHashesPerBlock(hashrate, intervalMs = TARGET_BLOCK_INTERVAL_MS) {
  const h = Math.max(0, Number(hashrate) || 0);
  const ms = Math.max(1, Number(intervalMs) || TARGET_BLOCK_INTERVAL_MS);
  if (h <= 0) return 2 ** GENESIS_DIFFICULTY_BITS;
  return Math.max(2, h * (ms / 1000));
}

/** Bits closest to hashrate × 90s. Live network never below 14 bits. */
export function blockBitsFromHashrate(hashrate, intervalMs = TARGET_BLOCK_INTERVAL_MS) {
  const h = Math.max(0, Number(hashrate) || 0);
  if (h <= 0) return GENESIS_DIFFICULTY_BITS;
  const target = expectedHashesPerBlock(h, intervalMs);
  const raw = Math.log2(Math.max(2, target));
  const lo = Math.floor(raw);
  const hi = Math.ceil(raw);
  const nearest = Math.abs((2 ** hi) - target) < Math.abs((2 ** lo) - target) ? hi : lo;
  return Math.max(LIVE_MIN_DIFFICULTY_BITS, clampDifficultyBits(nearest));
}

/**
 * Quick 90s retarget from the last real block interval.
 * 0.5s blocks at 14 bits → +8 bits in one step (not +1).
 * Hashrate is a fallback only when no interval has been seen.
 */
export function retargetBits(
  hashrate,
  previousBits,
  intervalMs = TARGET_BLOCK_INTERVAL_MS,
  observed = {},
) {
  const target = Math.max(1, Number(intervalMs) || TARGET_BLOCK_INTERVAL_MS);
  const prevRaw = Math.floor(Number(previousBits) || 0);
  const prev = prevRaw >= LIVE_MIN_DIFFICULTY_BITS ? prevRaw : GENESIS_DIFFICULTY_BITS;
  const seen = Number(observed.lastBlockIntervalMs ?? observed.intervalMs ?? 0);
  // Same-tick shares are not a block interval — do not treat 1ms as 90s/0.001.
  if (Number.isFinite(seen) && seen >= 250) {
    const ratio = target / seen;
    const delta = Math.round(Math.log2(Math.max(1 / 256, Math.min(256, ratio))));
    return Math.max(
      LIVE_MIN_DIFFICULTY_BITS,
      Math.min(MAX_DIFFICULTY_BITS, prev + delta),
    );
  }
  return Math.max(LIVE_MIN_DIFFICULTY_BITS, blockBitsFromHashrate(hashrate, target));
}

/**
 * Network difficulty is 2^bits (the work miners actually meet).
 * Uses a fixed target interval so hashrate no longer cancels to 60_000.
 */
export function networkDifficulty({
  bits,
  hashrate = 0,
  intervalMs = TARGET_BLOCK_INTERVAL_MS,
} = {}) {
  const interval = Math.max(1, Number(intervalMs) || TARGET_BLOCK_INTERVAL_MS);
  const h = Math.max(0, Number(hashrate) || 0);
  const b = bits == null || bits === ''
    ? blockBitsFromHashrate(h, interval)
    : clampDifficultyBits(bits);
  const work = 2 ** b;
  const expected = Math.round(expectedHashesPerBlock(h, interval));
  return {
    difficulty: work,
    expectedHashes: expected,
    difficultyBits: b,
    work,
    intervalMs: interval,
  };
}

export function targetBlockIntervalMs() {
  return TARGET_BLOCK_INTERVAL_MS;
}

/** Time never forms a block. Only a hash that meets the book target. */
export function canFormBlock({ blockHashMet } = {}) {
  return blockHashMet === true;
}

export function coinbaseAmountGnfp() {
  return BLOCK_REWARD_GNFP;
}

export function looksLikeSecretParty(raw) {
  const s = String(raw || '').trim();
  if (!s) return false;
  if (/^gnfp1[0-9a-z]+$/i.test(s)) return true;
  if (/^\d{1,3}(\.\d{1,3}){3}(:\d+)?$/.test(s)) return true;
  if (/@/.test(s)) return true;
  return false;
}

/** Public party tag. Never a wallet, IP, or login. */
export function shearPublicParty(raw) {
  const s = String(raw || '').trim();
  if (!s) return '';
  if (s === 'coinbase' || s === 'miners') return s;
  if (/^shear-[0-9a-f]{8}$/i.test(s)) return s.toLowerCase();
  const hex = createHash('sha256').update(`cfx-party:${s}`).digest('hex').slice(0, 8);
  return `shear-${hex}`;
}

export function publicTxPreview(txs, limit = PUBLIC_TX_PREVIEW) {
  const n = Math.max(0, Math.min(PUBLIC_TX_PREVIEW, Math.floor(Number(limit) || PUBLIC_TX_PREVIEW)));
  const list = Array.isArray(txs) ? txs : [];
  return list.slice(-n).reverse().map((t) => {
    const from = shearPublicParty(t?.from);
    const to = shearPublicParty(t?.to);
    return {
      id: String(t?.id || ''),
      kind: String(t?.kind || ''),
      asset: String(t?.asset || 'GNFP'),
      from,
      to,
      amount: Number(t?.amount) || 0,
      height: Number(t?.height) || undefined,
    };
  }).filter((row) => !looksLikeSecretParty(row.from) && !looksLikeSecretParty(row.to));
}

export function emptyHashWindow() {
  return Object.create(null);
}

export function hashesThisRoundOf(window, miner) {
  return Math.max(0, Math.floor(Number(window?.[miner]) || 0));
}

/** Only valid submitted hashes. Rejects / invalid work pass n <= 0. */
export function noteMinerHashes(window, miner, n) {
  const add = Math.max(0, Math.floor(Number(n) || 0));
  const key = String(miner || '').trim();
  const next = { ...(window && typeof window === 'object' ? window : {}) };
  if (!key || add <= 0) return next;
  next[key] = hashesThisRoundOf(next, key) + add;
  return next;
}

export function hashBonusNanos(hashes) {
  return Math.max(0, Math.floor(Number(hashes) || 0)) * HASH_BONUS_NANOS;
}

export function hashBonusGnfp(hashes) {
  return hashBonusNanos(hashes) / NANOS_PER_GNFP;
}

function splitPotByHashes(hashCounts, potNanos) {
  const pot = Math.max(0, Math.floor(Number(potNanos) || 0));
  const entries = Object.entries(hashCounts || {}).map(([k, v]) => [
    k,
    Math.max(0, Math.floor(Number(v) || 0)),
  ]);
  const total = entries.reduce((s, [, n]) => s + n, 0);
  const out = {};
  if (pot <= 0 || total <= 0) {
    for (const [k] of entries) out[k] = 0;
    return out;
  }
  let allocated = 0;
  const parts = entries.map(([k, n]) => {
    const share = Math.floor((pot * n) / total);
    allocated += share;
    return { k, share, n };
  });
  parts.sort((a, b) => b.n - a.n || String(a.k).localeCompare(String(b.k)));
  const rem = pot - allocated;
  if (rem > 0 && parts.length) parts[0].share += rem;
  for (const p of parts) out[p.k] = p.share;
  return out;
}

/**
 * 1 GNFP pot split by in-window hashes, plus 1e-9 GNFP per hash.
 * Returns a fresh empty window — bonus resets on every formed block.
 */
export function settleWindowCredits(hashCounts, { potNanos = BLOCK_REWARD_NANOS } = {}) {
  const counts = hashCounts && typeof hashCounts === 'object' ? hashCounts : {};
  const potSplits = splitPotByHashes(counts, potNanos);
  const bonusNanos = {};
  const totalsNanos = {};
  for (const [k, n] of Object.entries(counts)) {
    const h = Math.max(0, Math.floor(Number(n) || 0));
    bonusNanos[k] = hashBonusNanos(h);
    totalsNanos[k] = (potSplits[k] || 0) + bonusNanos[k];
  }
  return {
    potNanos: Math.max(0, Math.floor(Number(potNanos) || 0)),
    potSplits,
    bonusNanos,
    totalsNanos,
    nextWindow: emptyHashWindow(),
  };
}

/** Fields every tip / stats / --print-config payload should carry. */
export function bookLawOnTip({
  bits,
  hashrate = 0,
  intervalMs = TARGET_BLOCK_INTERVAL_MS,
} = {}) {
  const nd = networkDifficulty({ bits, hashrate, intervalMs });
  return {
    difficulty: nd.difficulty,
    difficultyBits: nd.difficultyBits,
    expectedHashes: nd.expectedHashes,
    blockIntervalMs: nd.intervalMs,
    blockRewardGnfp: BLOCK_REWARD_GNFP,
    hashBonusGnfp: HASH_BONUS_GNFP,
    hashBonusNanos: HASH_BONUS_NANOS,
    nanosPerGnfp: NANOS_PER_GNFP,
    shareCreditMicro: SHARE_CREDIT_MICRO,
    unitsPerGnfp: UNITS_PER_GNFP,
  };
}

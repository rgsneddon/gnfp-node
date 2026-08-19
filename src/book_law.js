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
/** 1% of the 1 GNFP pot. Book law — pool scripts must not invent another dest. */
export const POOL_FEE_BPS = 100;
export const POOL_FEE_PAYOUT = 'gnfp18ff7e8b2f0ef3e96f598231638aafd5a5abc490c';
/** Target spacing for retarget. Not a mint clock. */
export const TARGET_BLOCK_INTERVAL_MS = 90_000;
export const MIN_DIFFICULTY_BITS = 1;
export const MAX_DIFFICULTY_BITS = 32;
/** Live floor: 2^14 hashes ≈ 90s at ~182 H/s. Never collapse to 1/8-bit on restart. */
export const LIVE_MIN_DIFFICULTY_BITS = 14;
/** Share target sent to miners. Block form uses retarget bits, not this. */
export const SHARE_DIFFICULTY_BITS = LIVE_MIN_DIFFICULTY_BITS;
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
  if (prevRaw >= LIVE_MIN_DIFFICULTY_BITS) return prev;
  return Math.max(LIVE_MIN_DIFFICULTY_BITS, blockBitsFromHashrate(hashrate, target));
}

/** Work proven by one accepted share at those bits. Bonus is per hash, not per share. */
export function hashesProvenByShare(bits = SHARE_DIFFICULTY_BITS) {
  const b = Math.max(
    LIVE_MIN_DIFFICULTY_BITS,
    Math.min(MAX_DIFFICULTY_BITS, Math.floor(Number(bits) || SHARE_DIFFICULTY_BITS)),
  );
  return 2 ** b;
}

/** Frozen consensus identity. A different fingerprint is a different law. */
export const BOOK_LAW_ID = 'gnfp-book-law-1';
/** Bonus credits on each accepted hash commit. Pot share confirms on block found. Not a flag. Not env. */
export const HASH_COMMIT_ON_ACCEPT = 1;
/** One open-window hash row per miner. Not a flag. Not env. */
export const HASH_TX_COLLATE = 1;
/** Hash txs stay unconfirmed until a block forms. Not a flag. Not env. */
export const HASH_TX_CONFIRM_ON_BLOCK = 1;
/** Wallet sends confirm on the same miner-work block. Not a flag. Not env. */
export const USER_TX_CONFIRM_ON_BLOCK = 1;
export const HASH_TX_KIND = 'hash';
export const USER_TX_KIND = 'send';
export const BLOCK_POT_TX_KIND = 'mine';
/** Only proven miner work mints. Sends move existing GNFP. Not a flag. Not env. */
export const MINER_MINT_ONLY = 1;
export function bookLawFingerprint() {
  return [
    BOOK_LAW_ID,
    TARGET_BLOCK_INTERVAL_MS,
    LIVE_MIN_DIFFICULTY_BITS,
    GENESIS_DIFFICULTY_BITS,
    SHARE_DIFFICULTY_BITS,
    HASH_BONUS_NANOS,
    BLOCK_REWARD_GNFP,
    POOL_FEE_BPS,
    hashesProvenByShare(SHARE_DIFFICULTY_BITS),
    PUBLIC_TX_PREVIEW,
    HASH_COMMIT_ON_ACCEPT,
    HASH_TX_COLLATE,
    HASH_TX_CONFIRM_ON_BLOCK,
    USER_TX_CONFIRM_ON_BLOCK,
    MINER_MINT_ONLY,
  ].join(':');
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

/** Coinbase / hash bonus only. A send is never mint. */
export function isMintKind(kind) {
  const k = String(kind || '');
  return k === HASH_TX_KIND || k === BLOCK_POT_TX_KIND;
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
  if (s === 'coinbase' || s.startsWith('coinbase:') || s.startsWith('coinbase')) return 'coinbase';
  if (s === 'miners' || s.startsWith('miners:')) return 'miners';
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

/** Immediate wallet credit when a hash is committed. Same nanos as the bonus. */
export function hashCommitBonusNanos(hashes) {
  return hashBonusNanos(hashes);
}

/**
 * Each accepted share is a real hash transaction (bonus nanos).
 * Unconfirmed until block found. The formed block bundles them
 * (one confirmed row per miner, same total nanos) in one step.
 */
export function hashCommitTx({
  to,
  hashes,
  height,
  id,
  jobId,
  at,
} = {}) {
  const n = Math.max(0, Math.floor(Number(hashes) || 0));
  const nanos = hashCommitBonusNanos(n);
  return {
    id: String(id || `hash-${String(jobId || height || '0')}-${n}`),
    kind: HASH_TX_KIND,
    asset: 'GNFP',
    from: 'coinbase',
    to: String(to || 'miners'),
    amount: nanos / NANOS_PER_GNFP,
    hashes: n,
    nanos,
    confirmed: false,
    height: Number(height) || 0,
    jobId: jobId != null ? String(jobId) : undefined,
    at: Number(at) || undefined,
  };
}

/** Merge open-window hash commits to one row per miner. Immutable collation. */
export function collateHashCommits(txs = []) {
  const by = new Map();
  for (const t of Array.isArray(txs) ? txs : []) {
    const to = String(t?.to || '').trim();
    if (!to) continue;
    const n = Math.max(0, Math.floor(Number(t.hashes) || 0));
    const nanos = t.nanos != null ? Math.max(0, Math.floor(Number(t.nanos) || 0)) : hashCommitBonusNanos(n);
    const prev = by.get(to) || {
      id: `hash-open-${to.slice(0, 8)}`,
      kind: HASH_TX_KIND,
      asset: 'GNFP',
      from: 'coinbase',
      to,
      hashes: 0,
      nanos: 0,
      amount: 0,
      shares: 0,
      confirmed: false,
      height: 0,
      lastAt: 0,
    };
    prev.hashes += n;
    prev.nanos += nanos;
    prev.amount = prev.nanos / NANOS_PER_GNFP;
    prev.shares += Math.max(1, Math.floor(Number(t.shares) || 1));
    prev.height = Number(t.height) || prev.height;
    prev.lastAt = Math.max(Number(prev.lastAt) || 0, Number(t.at) || 0);
    by.set(to, prev);
  }
  return [...by.values()].sort((a, b) => Number(b.lastAt || 0) - Number(a.lastAt || 0));
}

/** Hash txs confirm only when the block forms. */
export function confirmHashTxs(txs = [], height = 0) {
  const h = Number(height) || 0;
  return (Array.isArray(txs) ? txs : []).map((t) => ({
    ...t,
    kind: HASH_TX_KIND,
    confirmed: true,
    height: h || Number(t.height) || 0,
    id: String(t.id || '').replace(/^hash-open-/, 'hash-block-') || `hash-block-${h}`,
  }));
}

/** Block found: collate every open hash commit, then confirm. O(miners), not O(shares). */
export function bundleHashTxsForBlock(commits, height = 0) {
  return confirmHashTxs(collateHashCommits(commits), height);
}

/** Wallet send/receive rows confirm only when miner work forms the block. */
export function confirmUserTxs(txs = [], height = 0) {
  const h = Number(height) || 0;
  return (Array.isArray(txs) ? txs : []).map((t) => ({
    ...t,
    confirmed: true,
    height: h || Number(t.height) || 0,
  }));
}

/** Wallet credit at block form: 1 GNFP pot split only. Bonus already committed. */
export function blockFormWalletNanos(hashCounts, potNanos = BLOCK_REWARD_NANOS) {
  return splitPotByHashes(hashCounts, potNanos);
}

export function poolFeePayout() {
  return POOL_FEE_PAYOUT;
}

export function poolFeeNanos(potNanos = BLOCK_REWARD_NANOS) {
  const pot = Math.max(0, Math.floor(Number(potNanos) || 0));
  return Math.floor((pot * POOL_FEE_BPS) / 10_000);
}

function hashTotalOf(hashCounts) {
  return Object.values(hashCounts || {}).reduce(
    (s, n) => s + Math.max(0, Math.floor(Number(n) || 0)),
    0,
  );
}

/** Sealed coinbase is always 1 GNFP + 1e-9 GNFP per in-window hash. */
export function sealedCoinbaseNanos(hashCounts) {
  return BLOCK_REWARD_NANOS + hashBonusNanos(hashTotalOf(hashCounts));
}

export function sealedCoinbaseGnfp(hashCounts) {
  return sealedCoinbaseNanos(hashCounts) / NANOS_PER_GNFP;
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
    poolFeeBps: POOL_FEE_BPS,
    poolFeePayout: POOL_FEE_PAYOUT,
    nanosPerGnfp: NANOS_PER_GNFP,
    shareCreditMicro: SHARE_CREDIT_MICRO,
    unitsPerGnfp: UNITS_PER_GNFP,
    liveMinDifficultyBits: LIVE_MIN_DIFFICULTY_BITS,
    genesisDifficultyBits: GENESIS_DIFFICULTY_BITS,
    shareDifficultyBits: SHARE_DIFFICULTY_BITS,
    bookLawId: BOOK_LAW_ID,
    bookLawFingerprint: bookLawFingerprint(),
    hashCommitOnAccept: HASH_COMMIT_ON_ACCEPT,
    hashTxCollate: HASH_TX_COLLATE,
    hashTxConfirmOnBlock: HASH_TX_CONFIRM_ON_BLOCK,
    userTxConfirmOnBlock: USER_TX_CONFIRM_ON_BLOCK,
    minerMintOnly: MINER_MINT_ONLY,
    hashTxKind: HASH_TX_KIND,
  };
}

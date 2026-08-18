/**
 * Immutable book law. Every gnfp-node uses these rules.
 * Pool / explorer only report them — they do not invent a second difficulty.
 */
export const UNITS_PER_GNFP = 100_000_000;
export const BLOCK_REWARD_GNFP = 1;
export const BLOCK_REWARD_MICRO = UNITS_PER_GNFP;
/** Per accepted hash, when the book credits dust. 1e-8 GNFP. */
export const SHARE_CREDIT_MICRO = 1;
/** Target spacing for retarget. Not a mint clock. */
export const TARGET_BLOCK_INTERVAL_MS = 90_000;
export const MIN_DIFFICULTY_BITS = 1;
export const MAX_DIFFICULTY_BITS = 32;
/** Live floor: 2^14 hashes ≈ 90s at ~182 H/s. Never collapse to 1/8-bit on restart. */
export const LIVE_MIN_DIFFICULTY_BITS = 14;
/** Unknown hashrate (restart) aims ~90s at a few hundred H/s. */
export const GENESIS_DIFFICULTY_BITS = 15;

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
  if (Number.isFinite(seen) && seen > 0) {
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

/** Fields every tip / stats payload should carry. */
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
    shareCreditMicro: SHARE_CREDIT_MICRO,
    unitsPerGnfp: UNITS_PER_GNFP,
  };
}

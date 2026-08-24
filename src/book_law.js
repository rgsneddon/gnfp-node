/**
 * Immutable book law. Every gnfp-node uses these rules.
 * Pool / explorer only report them — they do not invent a second difficulty.
 */
import { createHash } from 'crypto';
/** Legacy 1e-8 subunit (1 GNFP pot). Too coarse for the 1e-10 hash bonus. */
export const UNITS_PER_GNFP = 100_000_000;
/** Smallest mint unit is 10^{-10} GNFP (name kept; scale is not SI nano). */
export const NANOS_PER_GNFP = 10_000_000_000;
export const BLOCK_REWARD_GNFP = 1;
export const BLOCK_REWARD_MICRO = UNITS_PER_GNFP;
export const BLOCK_REWARD_NANOS = NANOS_PER_GNFP;
/** 0.0000000001 GNFP per in-window hash. Resets every formed block. */
export const HASH_BONUS_NANOS = 1;
export const HASH_BONUS_GNFP = HASH_BONUS_NANOS / NANOS_PER_GNFP;
/** Public amount frame: 10 fractional digits so one hash bonus is visible. */
export const GNFP_FRACTION_DIGITS = 10;

export function formatGnfp(n) {
  const v = Number(n);
  if (!Number.isFinite(v)) return '0';
  if (Math.abs(v - Math.round(v)) < 1e-12) return String(Math.round(v));
  return v.toFixed(GNFP_FRACTION_DIGITS).replace(/0+$/, '').replace(/\.$/, '');
}
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
/**
 * SHA-256 width. 2^32 (~4.29e9) was a fake ceiling that froze live
 * difficulty while hashrate kept climbing, so blocks ran far under 90s.
 * GPU/ASIC still cannot mint: sequential GNFPHash + client/nonce/solution
 * refusals. This only lets honest retarget use the whole hash.
 */
export const MAX_DIFFICULTY_BITS = 256;
/** Live floor: 2^14 hashes ≈ 90s at ~182 H/s. Never collapse to 1/8-bit on restart. */
export const LIVE_MIN_DIFFICULTY_BITS = 14;
/** Share target sent to miners. Block form uses retarget bits, not this. */
export const SHARE_DIFFICULTY_BITS = LIVE_MIN_DIFFICULTY_BITS;
/** Unknown hashrate (restart) aims ~90s at a few hundred H/s. */
export const GENESIS_DIFFICULTY_BITS = 21;

export function clampDifficultyBits(bits) {
  const n = Math.floor(Number(bits) || 0);
  if (Number(bits) === Infinity) return MAX_DIFFICULTY_BITS;
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
  // JS integer mint must stay finite. 2^53-1 saturates; PoW bits may still be 256.
  if (b >= 53) return Number.MAX_SAFE_INTEGER;
  return 2 ** b;
}

/** Frozen consensus identity. A different fingerprint is a different law. */
export const BOOK_LAW_ID = 'gnfp-book-law-1';
/** Hash bonus accumulates on that recipient's path on accept. Wallet output commits at block found. Not a flag. Not env. */
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
/**
 * 0 = do not persist one open-window object per hash (lean collate).
 * Block-found bonus is still sealed into consensus (transactions +
 * hashBonusGnfp on the block). Flip to 1 only at a later coordinated
 * hard fork (may be years away) to require per-hash network commit
 * of every open-window unit before collate.
 *
 * Architecture kept viable (not enacted): hashCommitTx / collateHashCommits /
 * hashWindowCommitment / confirmedRoundRowsFromHashes already produce O(miners)
 * sealed rows from proven hashes. Equal-daemon most-work adopt does not reseal
 * historical blocks, so a later HASH_TX_LIVE=1 cutover can still commit the
 * open window without rewriting spendable balances. Do not flip this pin.
 *
 * Mint law: 1 GNFP pot per formed block, split by in-window work,
 * plus 0.0000000001 GNFP per proven hash to that miner. Not 1 GNFP per miner.
 * Paper: https://zenodo.org/records/22037205
 */
export const HASH_TX_LIVE = 0;
export function bookLawFingerprint() {
  return [
    BOOK_LAW_ID,
    TARGET_BLOCK_INTERVAL_MS,
    LIVE_MIN_DIFFICULTY_BITS,
    GENESIS_DIFFICULTY_BITS,
    SHARE_DIFFICULTY_BITS,
    HASH_BONUS_NANOS,
    NANOS_PER_GNFP,
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
 * In-memory recipient path: add proven hashes onto one row per wallet.
 * Not a public output and not a wallet row. Block found confirms one
 * hash-path tx per recipient (same total nanos).
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

/**
 * Chronoflux continuity commitment of an open hash window.
 * Framework (https://grokipedia.com/page/Chronoflux_framework):
 *   ∇_μ(ρ_t u^μ)=0,  J^μ=ρ_t u^μ,  Q=∫ρ_t dV
 * Each proven hash is a discrete ρ_t sample (HASH_BONUS_NANOS). This
 * root commits collated Q without one JSON object per sample. Block
 * found is G_{μν}=8π(T^{mat}+T^{cf}) closure with
 * T^{cf}_{μν}=(ρ_t+p_t)u_μ u_ν+p_t g_{μν}; the window may then be
 * pruned (hydrodynamic well-posedness: κ,λ,η,ζ>0 — naive per-hash
 * objects are unbounded shear). Same family as flow-cloak continuity
 * root and PERC 1e8 microblocks → one main seal.
 * Not in the live block hash until the later HASH_TX_LIVE cutover.
 * Sneddon 2026, https://zenodo.org/records/22037205
 */
export function hashWindowCommitment(hashCounts = {}) {
  const parts = Object.entries(hashCounts || {})
    .map(([k, v]) => `${String(k)}:${Math.max(0, Math.floor(Number(v) || 0))}`)
    .filter((row) => !row.endsWith(':0'))
    .sort();
  return createHash('sha256').update(`hash-window:v1:${parts.join('|')}`).digest('hex');
}

/**
 * One owner-visible confirmed movement after a tip: pot-share + hash bonus.
 * Used by the live wallet explorer now (any units) and by the future 1e-10 path.
 */
export function ownerRoundRow({
  to,
  amount,
  hashes = 0,
  height = 0,
  at,
  potAmount,
  bonusAmount,
} = {}) {
  const h = Number(height) || 0;
  const dest = String(to || '');
  const tag = createHash('sha256').update(`round:${dest}:${h}`).digest('hex').slice(0, 12);
  return {
    id: `round-${h}-${tag}`,
    kind: BLOCK_POT_TX_KIND,
    asset: 'GNFP',
    from: 'coinbase',
    to: dest,
    amount: Number(amount) || 0,
    hashes: Math.max(0, Math.floor(Number(hashes) || 0)),
    confirmed: true,
    height: h,
    at: Number(at) || undefined,
    potAmount: Number(potAmount) || 0,
    bonusAmount: Number(bonusAmount) || 0,
  };
}

/**
 * Future 1-hash=1-tx seal: one confirmed row per miner whose amount is
 * (share of 1 GNFP pot) + (hashes × 0.0000000001). O(miners), not O(hashes).
 * Not applied by the live DE pool while HASH_TX_LIVE is 0.
 */
export function confirmedRoundRowsFromHashes(hashCounts, {
  potNanos = BLOCK_REWARD_NANOS,
  height = 0,
  at,
} = {}) {
  const counts = hashCounts && typeof hashCounts === 'object' ? hashCounts : {};
  const settled = settleWindowCredits(counts, { potNanos });
  const rows = [];
  for (const [to, total] of Object.entries(settled.totalsNanos || {})) {
    const hashes = Math.max(0, Math.floor(Number(counts[to]) || 0));
    rows.push(ownerRoundRow({
      to,
      amount: (Number(total) || 0) / NANOS_PER_GNFP,
      hashes,
      height,
      at,
      potAmount: (settled.potSplits[to] || 0) / NANOS_PER_GNFP,
      bonusAmount: (settled.bonusNanos[to] || 0) / NANOS_PER_GNFP,
    }));
  }
  return { settled, rows };
}

/** Owner explorer/history: skip unconfirmed hash micros; keep legacy rows. */
export function isOwnerHistoryTx(tx, address) {
  const addr = String(address || '').trim();
  if (!tx || !addr) return false;
  if (String(tx.from || '') !== addr && String(tx.to || '') !== addr) return false;
  if (String(tx.kind || '') === HASH_TX_KIND && tx.confirmed !== true) return false;
  return true;
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

/** Sealed coinbase is always 1 GNFP + 1e-10 GNFP per in-window hash. */
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
 * 1 GNFP pot split by in-window hashes, plus 1e-10 GNFP per hash.
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

/**
 * Join/equal-book check: sealed creditsNanos match settleWindowCredits
 * of the collated bonus window, and amount is 1 GNFP + 1e-10 per hash.
 */
export function sealedRoundAgrees(block) {
  const bonus = block?.bonusNanos && typeof block.bonusNanos === 'object' ? block.bonusNanos : {};
  const hashes = {};
  for (const [k, n] of Object.entries(bonus)) {
    hashes[k] = Math.max(0, Math.floor(Number(n) || 0));
  }
  const settled = settleWindowCredits(hashes);
  for (const [k, want] of Object.entries(settled.totalsNanos || {})) {
    const got = Math.max(0, Math.floor(Number(block?.creditsNanos?.[k]) || 0));
    if (got !== want) return false;
  }
  const amt = Number(block?.amount);
  if (Number.isFinite(amt)) {
    const coinbase = sealedCoinbaseNanos(hashes);
    if (Math.abs(amt * NANOS_PER_GNFP - coinbase) > 1) return false;
  }
  return true;
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
    gnfpFractionDigits: GNFP_FRACTION_DIGITS,
    poolFeeBps: POOL_FEE_BPS,
    poolFeePayout: POOL_FEE_PAYOUT,
    nanosPerGnfp: NANOS_PER_GNFP,
    shareCreditMicro: SHARE_CREDIT_MICRO,
    unitsPerGnfp: UNITS_PER_GNFP,
    liveMinDifficultyBits: LIVE_MIN_DIFFICULTY_BITS,
    maxDifficultyBits: MAX_DIFFICULTY_BITS,
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
    hashTxLive: HASH_TX_LIVE,
  };
}

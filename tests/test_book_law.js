import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  BLOCK_REWARD_GNFP,
  BLOCK_REWARD_NANOS,
  GENESIS_DIFFICULTY_BITS,
  HASH_BONUS_GNFP,
  HASH_BONUS_NANOS,
  NANOS_PER_GNFP,
  POOL_FEE_BPS,
  POOL_FEE_PAYOUT,
  PUBLIC_TX_PREVIEW,
  poolFeeNanos,
  poolFeePayout,
  sealedCoinbaseGnfp,
  sealedCoinbaseNanos,
  looksLikeSecretParty,
  publicTxPreview,
  TARGET_BLOCK_INTERVAL_MS,
  blockBitsFromHashrate,
  bookLawOnTip,
  clampDifficultyBits,
  MAX_DIFFICULTY_BITS,
  canFormBlock,
  emptyHashWindow,
  hashBonusGnfp,
  hashBonusNanos,
  hashesThisRoundOf,
  hashesProvenByShare,
  bookLawFingerprint,
  BOOK_LAW_ID,
  HASH_COMMIT_ON_ACCEPT,
  HASH_TX_COLLATE,
  HASH_TX_CONFIRM_ON_BLOCK,
  HASH_TX_LIVE,
  USER_TX_CONFIRM_ON_BLOCK,
  MINER_MINT_ONLY,
  isMintKind,
  hashCommitTx,
  collateHashCommits,
  bundleHashTxsForBlock,
  confirmedRoundRowsFromHashes,
  hashWindowCommitment,
  isOwnerHistoryTx,
  confirmUserTxs,
  blockFormWalletNanos,
  networkDifficulty,
  noteMinerHashes,
  retargetBits,
  settleWindowCredits,
  sealedRoundAgrees,
} from '../src/book_law.js';
import { tipIdentity } from '../src/book_pull.js';
import { hashBlock, hashMatches, sealBlock } from '../src/chronoflux_chain.js';

test('book law: time never mints; reward and dust are fixed', () => {
  assert.equal(canFormBlock({ blockHashMet: false }), false);
  assert.equal(canFormBlock({ blockHashMet: true }), true);
  assert.equal(BLOCK_REWARD_GNFP, 1);
  assert.equal(HASH_BONUS_GNFP, 0.000000001);
  assert.equal(HASH_BONUS_NANOS, 1);
  assert.equal(NANOS_PER_GNFP, 1_000_000_000);
  assert.equal(TARGET_BLOCK_INTERVAL_MS, 90_000);
  assert.equal(PUBLIC_TX_PREVIEW, 10);
  assert.equal(POOL_FEE_BPS, 100);
  assert.equal(POOL_FEE_PAYOUT, 'gnfp18ff7e8b2f0ef3e96f598231638aafd5a5abc490c');
  assert.equal(poolFeePayout(), POOL_FEE_PAYOUT);
  assert.equal(poolFeeNanos(), 10_000_000);
});

test('book law: sealed coinbase is 1 GNFP plus 1e-9 per hash', () => {
  assert.equal(sealedCoinbaseNanos({}), BLOCK_REWARD_NANOS);
  assert.equal(sealedCoinbaseGnfp({}), 1);
  assert.equal(sealedCoinbaseNanos({ a: 1, b: 3 }), BLOCK_REWARD_NANOS + 4);
  assert.equal(sealedCoinbaseGnfp({ a: 1, b: 3 }), 1 + 4 / NANOS_PER_GNFP);
  assert.equal(hashesProvenByShare(14), 16384);
  assert.equal(retargetBits(0, 31, 90_000, {}), 31);
  assert.equal(BOOK_LAW_ID, 'gnfp-book-law-1');
  assert.equal(bookLawFingerprint(), 'gnfp-book-law-1:90000:14:21:14:1:1:100:16384:10:1:1:1:1:1');
  assert.equal(HASH_COMMIT_ON_ACCEPT, 1);
  assert.equal(HASH_TX_COLLATE, 1);
  assert.equal(HASH_TX_CONFIRM_ON_BLOCK, 1);
  assert.equal(USER_TX_CONFIRM_ON_BLOCK, 1);
  assert.equal(MINER_MINT_ONLY, 1);
  assert.equal(isMintKind('hash'), true);
  assert.equal(isMintKind('mine'), true);
  assert.equal(isMintKind('send'), false);
  assert.equal(isMintKind('receive'), false);
  assert.equal(canFormBlock({ blockHashMet: false }), false);
  assert.equal(canFormBlock({ blockHashMet: true }), true);
  const pendingSend = { id: 's1', kind: 'send', from: 'alice', to: 'bob', amount: 2, confirmed: false };
  const sealedSend = confirmUserTxs([pendingSend], 12);
  assert.equal(sealedSend.length, 1);
  assert.equal(sealedSend[0].confirmed, true);
  assert.equal(sealedSend[0].height, 12);
  assert.equal(sealedSend[0].amount, 2);
  const commit = hashCommitTx({ to: 'gnfp1alice', hashes: 7, jobId: 'j1' });
  assert.equal(commit.kind, 'hash');
  assert.equal(commit.nanos, 7);
  assert.equal(commit.amount, 7 / NANOS_PER_GNFP);
  assert.equal(commit.confirmed, false);
  const many = [];
  for (let i = 0; i < 1000; i += 1) {
    many.push(hashCommitTx({ to: i % 2 ? 'bob' : 'alice', hashes: 14, jobId: `j${i}` }));
  }
  const bundled = bundleHashTxsForBlock(many, 99);
  assert.equal(bundled.length, 2);
  assert.ok(bundled.every((t) => t.confirmed === true && t.height === 99));
  assert.equal(bundled.find((t) => t.to === 'alice').hashes, 14 * 500);
  assert.equal(collateHashCommits(many).length, 2);
  const pot = blockFormWalletNanos({ alice: 7, bob: 3 }, 990);
  assert.equal(pot.alice + pot.bob, 990);
  const tip = bookLawOnTip();
  assert.equal(tip.bookLawFingerprint, bookLawFingerprint());
  assert.equal(tip.liveMinDifficultyBits, 14);
  assert.equal(tip.genesisDifficultyBits, 21);
  assert.equal(tip.blockIntervalMs, 90_000);
  assert.equal(tip.hashBonusGnfp, 1e-9);
  assert.equal(HASH_TX_LIVE, 0);
  assert.equal(tip.hashTxLive, 0);
  const n = 12;
  const future = confirmedRoundRowsFromHashes({ alice: n, bob: 4 }, { height: 50 });
  assert.equal(future.rows.length, 2);
  assert.ok(future.rows.every((t) => t.confirmed === true && t.height === 50 && t.kind === 'mine'));
  const aliceRow = future.rows.find((t) => t.to === 'alice');
  assert.equal(aliceRow.hashes, n);
  assert.equal(aliceRow.bonusAmount, n / NANOS_PER_GNFP);
  assert.equal(aliceRow.amount, future.settled.totalsNanos.alice / NANOS_PER_GNFP);
  assert.equal(aliceRow.amount, aliceRow.potAmount + aliceRow.bonusAmount);
  const manyHash = [];
  for (let i = 0; i < 5000; i += 1) {
    manyHash.push(hashCommitTx({ to: i < 10 ? `m${i}` : 'alice', hashes: 3, jobId: `x${i}` }));
  }
  assert.equal(collateHashCommits(manyHash).length, 11);
  assert.equal(
    isOwnerHistoryTx({ kind: 'hash', confirmed: false, to: 'alice', from: 'coinbase' }, 'alice'),
    false,
  );
  assert.equal(
    isOwnerHistoryTx({ kind: 'mine', confirmed: true, to: 'alice', from: 'coinbase' }, 'alice'),
    true,
  );
  const win = { alice: n, bob: 4 };
  assert.equal(hashWindowCommitment(win), hashWindowCommitment({ bob: 4, alice: n }));
  assert.equal(hashWindowCommitment(win).length, 64);
  const closed = settleWindowCredits(win);
  assert.equal(sealedRoundAgrees({
    amount: sealedCoinbaseGnfp(win),
    bonusNanos: closed.bonusNanos,
    creditsNanos: closed.totalsNanos,
  }), true);
});

test('public tx preview shows amounts and never leaks wallets or IPs', () => {
  const rows = publicTxPreview([
    { id: 'a', kind: 'mine', from: 'coinbase', to: 'gnfp18ff7e8b2f0ef3e96f598231638aafd5a5abc490c', amount: 1.000000001 },
    { id: 'b', kind: 'send', from: '127.0.0.1:1474', to: 'miners', amount: 0.5 },
    { id: 'c', kind: 'mine', from: 'coinbase:de.restoreprivacy.online:1474', to: 'miners', amount: 1 },
  ], 10);
  assert.ok(rows.length >= 1);
  assert.equal(rows[0].from, 'coinbase');
  assert.equal(rows[0].to, 'miners');
  assert.equal(rows[0].amount, 1);
  const blob = JSON.stringify(rows);
  assert.equal(blob.includes('gnfp1'), false);
  assert.equal(blob.includes('127.0.0.1'), false);
  assert.equal(looksLikeSecretParty('gnfp18ff7e8b2f0ef3e96f598231638aafd5a5abc490c'), true);
  assert.equal(looksLikeSecretParty('127.0.0.1:1474'), true);
  assert.equal(looksLikeSecretParty('shear-ab12cd34'), false);
  assert.equal(looksLikeSecretParty('miner-86cf36fa'), false);
  assert.equal(looksLikeSecretParty('coinbase'), false);
});

test('book law: per-hash bonus is 1e-9 GNFP and resets when a block forms', () => {
  assert.equal(canFormBlock({ blockHashMet: false }), false);
  let window = emptyHashWindow();
  window = noteMinerHashes(window, 'alice', 10);
  window = noteMinerHashes(window, 'bob', 4);
  window = noteMinerHashes(window, 'alice', 2);
  window = noteMinerHashes(window, 'eve', 0);
  window = noteMinerHashes(window, 'bad', -3);
  assert.equal(hashesThisRoundOf(window, 'alice'), 12);
  assert.equal(hashesThisRoundOf(window, 'bob'), 4);
  assert.equal(hashesThisRoundOf(window, 'eve'), 0);
  assert.equal(hashBonusNanos(12), 12);
  assert.equal(hashBonusGnfp(12), 12 / NANOS_PER_GNFP);
  const settled = settleWindowCredits(window);
  assert.equal(settled.potNanos, BLOCK_REWARD_NANOS);
  assert.equal(settled.bonusNanos.alice, 12);
  assert.equal(settled.bonusNanos.bob, 4);
  assert.equal(settled.totalsNanos.alice, settled.potSplits.alice + 12);
  assert.equal(settled.totalsNanos.bob, settled.potSplits.bob + 4);
  assert.equal(hashesThisRoundOf(settled.nextWindow, 'alice'), 0);
  assert.equal(hashesThisRoundOf(settled.nextWindow, 'bob'), 0);
  const next = noteMinerHashes(settled.nextWindow, 'alice', 5);
  assert.equal(hashesThisRoundOf(next, 'alice'), 5);
  assert.equal(hashBonusNanos(5), 5);
  assert.equal(hashBonusGnfp(5), 5 / NANOS_PER_GNFP);
});

test('book law: difficulty retargets toward 90s and is not stuck at 60000', () => {
  const idle = networkDifficulty({ hashrate: 0 });
  assert.equal(idle.difficultyBits, GENESIS_DIFFICULTY_BITS);
  assert.equal(GENESIS_DIFFICULTY_BITS, 21);
  assert.equal(idle.difficulty, 2 ** GENESIS_DIFFICULTY_BITS);

  const mid = networkDifficulty({ hashrate: 280 });
  assert.equal(mid.intervalMs, 90_000);
  assert.ok(mid.difficulty !== 60_000, `got ${mid.difficulty}`);
  assert.equal(mid.difficulty, 2 ** mid.difficultyBits);
  assert.ok(mid.difficultyBits >= 14, `bits ${mid.difficultyBits}`);
  const expectedSec = mid.difficulty / 280;
  assert.ok(expectedSec > 45 && expectedSec < 180, `sec ${expectedSec}`);

  const jumped = retargetBits(15, 14, 90_000, { lastBlockIntervalMs: 500 });
  assert.ok(jumped >= 19, `fast 0.5s must raise the hash target, got ${jumped}`);
  const eased = retargetBits(15, jumped, 90_000, { lastBlockIntervalMs: 180_000 });
  assert.ok(eased < jumped, `slow 180s must ease the hash target, ${eased} vs ${jumped}`);
  assert.equal(canFormBlock({ blockHashMet: false, lastBlockIntervalMs: 500_000 }), false);

  const fast = networkDifficulty({ hashrate: 10_000 });
  assert.ok(fast.difficulty > mid.difficulty, `fast=${fast.difficulty} mid=${mid.difficulty}`);
  assert.ok(fast.difficultyBits > mid.difficultyBits);

  assert.equal(blockBitsFromHashrate(280), mid.difficultyBits);
});

test('book law: 4.29e9 (32 bits) is not a ceiling; retarget can use the full hash', () => {
  assert.equal(MAX_DIFFICULTY_BITS, 256);
  assert.equal(clampDifficultyBits(40), 40);
  assert.equal(clampDifficultyBits(256), 256);
  assert.equal(clampDifficultyBits(300), 256);
  assert.equal(retargetBits(0, 32, 90_000, { lastBlockIntervalMs: 250 }), 40);
  const high = networkDifficulty({ bits: 40 });
  assert.equal(high.difficultyBits, 40);
  assert.ok(high.difficulty > 2 ** 32);
  assert.equal(bookLawOnTip().maxDifficultyBits, 256);
});

test('tip identity carries book law; old seals keep their hash', () => {
  const sealed = sealBlock({
    height: 1,
    miner: 'gnfp1test',
    amount: 1,
    foundAt: 1,
    from: 'coinbase',
    to: 'miners',
  });
  const again = hashBlock(sealed);
  assert.equal(again, sealed.hash);
  const withLaw = sealBlock({
    height: 2,
    miner: 'gnfp1test',
    amount: BLOCK_REWARD_GNFP + HASH_BONUS_GNFP,
    blockRewardGnfp: BLOCK_REWARD_GNFP,
    hashBonusGnfp: HASH_BONUS_GNFP,
    difficulty: 12,
    foundAt: 2,
    from: 'coinbase',
    to: 'miners',
  }, sealed.hash);
  assert.equal(withLaw.difficulty, 12);
  assert.equal(hashBlock(withLaw), withLaw.hash);
  assert.equal(hashMatches(withLaw), true);
  assert.equal(hashMatches(sealed), true);
  const tip = tipIdentity({ blocks: [sealed, withLaw] }, { hashrate: 280 });
  assert.equal(tip.blockRewardGnfp, 1);
  assert.ok(tip.difficultyBits >= 1);
  assert.equal(tip.difficulty, bookLawOnTip({ bits: tip.difficultyBits, hashrate: 280 }).difficulty);
});

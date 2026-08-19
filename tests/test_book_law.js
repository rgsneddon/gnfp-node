import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  BLOCK_REWARD_GNFP,
  BLOCK_REWARD_NANOS,
  GENESIS_DIFFICULTY_BITS,
  HASH_BONUS_GNFP,
  HASH_BONUS_NANOS,
  NANOS_PER_GNFP,
  PUBLIC_TX_PREVIEW,
  looksLikeSecretParty,
  publicTxPreview,
  TARGET_BLOCK_INTERVAL_MS,
  blockBitsFromHashrate,
  bookLawOnTip,
  canFormBlock,
  emptyHashWindow,
  hashBonusGnfp,
  hashBonusNanos,
  hashesThisRoundOf,
  networkDifficulty,
  noteMinerHashes,
  retargetBits,
  settleWindowCredits,
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
});

test('public tx preview shows amounts and never leaks wallets or IPs', () => {
  const rows = publicTxPreview([
    { id: 'a', kind: 'mine', from: 'coinbase', to: 'gnfp18ff7e8b2f0ef3e96f598231638aafd5a5abc490c', amount: 1.000000001 },
    { id: 'b', kind: 'send', from: '127.0.0.1:1474', to: 'miners', amount: 0.5 },
    { id: 'c', kind: 'mine', from: 'coinbase', to: 'miners', amount: 1 },
  ], 10);
  assert.ok(rows.length >= 1);
  assert.equal(rows[0].amount, 1);
  const blob = JSON.stringify(rows);
  assert.equal(blob.includes('gnfp1'), false);
  assert.equal(blob.includes('127.0.0.1'), false);
  assert.equal(looksLikeSecretParty('gnfp18ff7e8b2f0ef3e96f598231638aafd5a5abc490c'), true);
  assert.equal(looksLikeSecretParty('shear-ab12cd34'), false);
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

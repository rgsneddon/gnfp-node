import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  BLOCK_REWARD_GNFP,
  GENESIS_DIFFICULTY_BITS,
  SHARE_CREDIT_MICRO,
  TARGET_BLOCK_INTERVAL_MS,
  blockBitsFromHashrate,
  bookLawOnTip,
  canFormBlock,
  networkDifficulty,
} from '../src/book_law.js';
import { tipIdentity } from '../src/book_pull.js';
import { hashBlock, sealBlock } from '../src/chronoflux_chain.js';

test('book law: time never mints; reward and dust are fixed', () => {
  assert.equal(canFormBlock({ blockHashMet: false }), false);
  assert.equal(canFormBlock({ blockHashMet: true }), true);
  assert.equal(BLOCK_REWARD_GNFP, 1);
  assert.equal(SHARE_CREDIT_MICRO, 1);
  assert.equal(TARGET_BLOCK_INTERVAL_MS, 60_000);
});

test('book law: difficulty retargets with hashrate and is not stuck at 60000', () => {
  const idle = networkDifficulty({ hashrate: 0 });
  assert.equal(idle.difficultyBits, GENESIS_DIFFICULTY_BITS);
  assert.equal(idle.difficulty, 2 ** GENESIS_DIFFICULTY_BITS);

  const mid = networkDifficulty({ hashrate: 280 });
  assert.equal(mid.intervalMs, 60_000);
  assert.ok(mid.difficulty !== 60_000, `got ${mid.difficulty}`);
  assert.equal(mid.difficulty, 2 ** mid.difficultyBits);
  assert.ok(mid.difficultyBits >= 8, `bits ${mid.difficultyBits}`);

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
    amount: BLOCK_REWARD_GNFP,
    blockRewardGnfp: BLOCK_REWARD_GNFP,
    difficulty: 12,
    foundAt: 2,
    from: 'coinbase',
    to: 'miners',
  }, sealed.hash);
  assert.equal(withLaw.difficulty, 12);
  const tip = tipIdentity({ blocks: [sealed, withLaw] }, { hashrate: 280 });
  assert.equal(tip.blockRewardGnfp, 1);
  assert.ok(tip.difficultyBits >= 1);
  assert.equal(tip.difficulty, bookLawOnTip({ bits: tip.difficultyBits, hashrate: 280 }).difficulty);
});

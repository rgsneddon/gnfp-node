import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  ensureSealedChain,
  adoptReplicaBook,
  chainWork,
  commonPrefixLength,
  CONFIRMATION_MS,
  GNFP_BOOK,
  isBlockConfirmed,
  isImmutableHold,
  rejectRewrite,
  shouldAdoptRemote,
} from '../src/chronoflux_chain.js';
import { reconstructSpendable, stampLedgerTx, txsFromSealedBlocks } from '../src/gnfp_height_ledger.js';
import { HASH_TX_LIVE } from '../src/book_law.js';
import { applyIncremental, sliceAfter, tipIdentity } from '../src/book_pull.js';

function rows(n, start = 1, miner = 'alice') {
  return Array.from({ length: n }, (_, i) => ({
    height: start + i,
    jobId: `j${start + i}`,
    miner,
    amount: 1,
    foundAt: 1000 + i,
  }));
}

function sealed(n, start = 1, miner = 'alice') {
  return ensureSealedChain(rows(n, start, miner));
}

test('valid hash-linked extension is adopted and local tip matches remote', () => {
  const remote = sealed(4);
  const empty = applyIncremental(null, tipIdentity({ blocks: remote }), remote);
  assert.equal(empty.ok, true);
  assert.equal(tipIdentity(empty.book).tipHash, tipIdentity({ blocks: remote }).tipHash);
  assert.equal(empty.book.blocks.length, 4);

  const extra = ensureSealedChain(rows(6));
  const next = applyIncremental(empty.book, tipIdentity({ blocks: extra }), extra.slice(4));
  assert.equal(next.ok, true);
  assert.equal(next.extended || next.book.blocks.length === 6, true);
  assert.equal(tipIdentity(next.book).height, 6);
  assert.equal(tipIdentity(next.book).tipHash, tipIdentity({ blocks: extra }).tipHash);
});

test('mutated payload is rejected with ok false', () => {
  const good = sealed(3);
  const local = adoptReplicaBook({}, { blocks: good });
  assert.equal(local.ok, true);
  const mutated = good.map((b, i) => (i === 1 ? { ...b, miner: 'eve' } : { ...b }));
  const got = applyIncremental(local.book, tipIdentity({ blocks: mutated }), mutated);
  assert.equal(got.ok, false);
});

test('same-height equal-work competing tip keeps first-seen local', () => {
  const a = sealed(3, 1, 'alice');
  const b = sealed(3, 1, 'bob');
  const local = adoptReplicaBook({}, { blocks: a });
  assert.equal(local.ok, true);
  const fork = applyIncremental(local.book, tipIdentity({ blocks: b }), b);
  assert.equal(fork.ok, true);
  assert.equal(fork.firstSeen || fork.sameTip, true);
  assert.equal(tipIdentity(fork.book).tipHash, tipIdentity({ blocks: a }).tipHash);
  const tipOnly = adoptReplicaBook(local.book, {
    height: 3,
    tip: 3,
    tipHash: tipIdentity({ blocks: b }).tipHash,
  });
  assert.equal(tipOnly.ok, true);
  assert.equal(tipOnly.firstSeen || tipOnly.sameTip, true);
  assert.equal(tipIdentity(tipOnly.book).tipHash, tipIdentity({ blocks: a }).tipHash);
});

test('shorter valid book keeps first-seen local; height-only rollback is rejected', () => {
  const tall = sealed(5);
  const local = adoptReplicaBook({}, { blocks: tall });
  const short = applyIncremental(local.book, tipIdentity({ blocks: tall.slice(0, 2) }), tall.slice(0, 2));
  assert.equal(short.ok, true);
  assert.equal(short.firstSeen || tipIdentity(short.book).height === 5, true);
  assert.equal(tipIdentity(short.book).tipHash, tipIdentity({ blocks: tall }).tipHash);
  const rollback = adoptReplicaBook(local.book, { height: 2, tip: 2, tipHash: 'abcd' });
  assert.equal(rollback.ok, false);
  assert.equal(rollback.reason, 'rollback');
});

test('found sealed block is held immutable after confirm; rewrite rejected', () => {
  const foundAt = Date.now() - CONFIRMATION_MS - 1;
  const chain = ensureSealedChain(rows(1, 10).map((r) => ({ ...r, foundAt })));
  const held = chain[0];
  assert.equal(isImmutableHold(held), true);
  assert.equal(isBlockConfirmed(held, Date.now()), true);
  assert.equal(held.book, GNFP_BOOK.id);
  const rewrite = rejectRewrite(held, { ...held, miner: 'eve', hash: held.hash });
  assert.equal(rewrite.ok, false);
  assert.equal(rewrite.reason, 'immutable');
  const taller = ensureSealedChain(rows(80, 10).map((r, i) => ({ ...r, foundAt: foundAt + i })));
  assert.equal(taller[0].hash, held.hash);
  assert.equal(taller.length, 80);
  assert.equal(isImmutableHold(taller[0]), true);
});

test('foreign book identity is rejected', () => {
  const good = sealed(2);
  const local = adoptReplicaBook({}, { blocks: good, book: GNFP_BOOK.id, coin: 'GNFP' });
  assert.equal(local.ok, true);
  const foreign = adoptReplicaBook(local.book, { book: 'other-book', coin: 'GNFP', height: 2 });
  assert.equal(foreign.ok, false);
  assert.equal(foreign.reason, 'foreign_book');
});

test('more-work competing fork of a shared sealed prefix is adopted', () => {
  const prefix = sealed(2, 1, 'alice');
  const localSuffix = ensureSealedChain([
    ...prefix,
    { height: 3, jobId: 'j3', miner: 'alice', amount: 1, foundAt: 3000 },
  ]);
  const remote = ensureSealedChain([
    ...prefix,
    { height: 3, jobId: 'j3b', miner: 'bob', amount: 1, foundAt: 3001 },
    { height: 4, jobId: 'j4b', miner: 'bob', amount: 1, foundAt: 3002 },
  ]);
  assert.equal(commonPrefixLength(localSuffix, remote), 2);
  assert.equal(chainWork(remote) > chainWork(localSuffix), true);
  assert.equal(shouldAdoptRemote(localSuffix, remote), true);
  const local = adoptReplicaBook({}, { blocks: localSuffix });
  const got = adoptReplicaBook(local.book, { blocks: remote, book: GNFP_BOOK.id, coin: 'GNFP' });
  assert.equal(got.ok, true);
  assert.equal(got.reorg, true);
  assert.equal(got.prefix, 2);
  assert.equal(got.book.blocks.length, 4);
  assert.equal(got.book.blocks[0].hash, prefix[0].hash);
  assert.equal(got.book.blocks[1].hash, prefix[1].hash);
  assert.equal(got.book.blocks[3].hash, remote[3].hash);
});

test('HASH_TX_LIVE stays 0; collate helpers remain for a later cutover', () => {
  assert.equal(HASH_TX_LIVE, 0);
});

test('reconstructed spendable on the sealed prefix is unchanged after a suffix reorg', () => {
  const env = { GNFP_PRIVACY_SALT: 'test-gnfp-privacy-salt' };
  const alice = 'gnfp1aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
  const bob = 'gnfp1bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';
  const prefixRows = [
    {
      height: 1,
      jobId: 'p1',
      miner: alice,
      amount: 20,
      foundAt: 1000,
      transactions: [
        stampLedgerTx({
          id: 'm1', from: 'coinbase', to: alice, amount: 20, kind: 'mine',
        }, { height: 1, epochHash: 'aa'.repeat(32), env }),
      ],
    },
    {
      height: 2,
      jobId: 'p2',
      miner: alice,
      amount: 1,
      foundAt: 1001,
      transactions: [
        stampLedgerTx({
          id: 's1', from: alice, to: bob, amount: 7, kind: 'send',
        }, { height: 2, epochHash: 'bb'.repeat(32), env }),
      ],
    },
  ];
  const prefix = ensureSealedChain(prefixRows);
  const local = ensureSealedChain([
    ...prefix,
    { height: 3, jobId: 'l3', miner: alice, amount: 1, foundAt: 2000 },
  ]);
  const remote = ensureSealedChain([
    ...prefix,
    { height: 3, jobId: 'r3', miner: bob, amount: 1, foundAt: 2001 },
    { height: 4, jobId: 'r4', miner: bob, amount: 1, foundAt: 2002 },
  ]);
  const before = reconstructSpendable(txsFromSealedBlocks(prefix), { address: alice, env });
  const bobBefore = reconstructSpendable(txsFromSealedBlocks(prefix), { address: bob, env });
  assert.equal(before, 13);
  assert.equal(bobBefore, 7);
  const adopted = adoptReplicaBook({ blocks: local }, { blocks: remote, book: GNFP_BOOK.id, coin: 'GNFP' });
  assert.equal(adopted.ok, true);
  const afterPrefix = adopted.book.blocks.slice(0, 2);
  assert.equal(afterPrefix[0].hash, prefix[0].hash);
  assert.equal(afterPrefix[1].hash, prefix[1].hash);
  assert.equal(reconstructSpendable(txsFromSealedBlocks(afterPrefix), { address: alice, env }), before);
  assert.equal(reconstructSpendable(txsFromSealedBlocks(afterPrefix), { address: bob, env }), bobBefore);
  assert.equal(HASH_TX_LIVE, 0);
});

test('sliceAfter is incremental and does not dump the prefix', () => {
  const chain = sealed(10);
  const mid = chain[3];
  const got = sliceAfter(chain, { afterHeight: mid.height, afterHash: mid.hash, limit: 3 });
  assert.equal(got.blocks.length, 3);
  assert.equal(got.blocks[0].height, 5);
  assert.equal(got.more, true);
  const rest = sliceAfter(chain, { afterHeight: 10 });
  assert.equal(rest.blocks.length, 0);
  assert.equal(rest.more, false);
});

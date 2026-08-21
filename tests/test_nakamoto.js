import assert from 'node:assert/strict';
import { test } from 'node:test';
import { spawnSync } from 'node:child_process';
import path from 'path';
import { fileURLToPath } from 'node:url';
import {
  adoptReplicaBook,
  chainWork,
  commonPrefixLength,
  ensureSealedChain,
  GNFP_BOOK,
  shouldAdoptRemote,
} from '../src/chronoflux_chain.js';
import { HASH_TX_LIVE, collateHashCommits, hashCommitTx, hashWindowCommitment } from '../src/book_law.js';
import { reconstructSpendable, stampLedgerTx, txsFromSealedBlocks } from '../src/gnfp_height_ledger.js';
import { parseNodeArgs, VERSION } from '../src/node.js';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

function sealed(n, start = 1, miner = 'alice') {
  return ensureSealedChain(
    Array.from({ length: n }, (_, i) => ({
      height: start + i,
      jobId: `n${start + i}`,
      miner,
      amount: 1,
      foundAt: 5000 + i,
    })),
  );
}

test('nakamoto: more-work competing fork of shared prefix is adopted', () => {
  const prefix = sealed(2, 1, 'keep');
  const local = ensureSealedChain([
    ...prefix,
    { height: 3, jobId: 'l3', miner: 'alice', amount: 1, foundAt: 8000 },
  ]);
  const remote = ensureSealedChain([
    ...prefix,
    { height: 3, jobId: 'r3', miner: 'bob', amount: 1, foundAt: 8001 },
    { height: 4, jobId: 'r4', miner: 'bob', amount: 1, foundAt: 8002 },
  ]);
  assert.equal(commonPrefixLength(local, remote), 2);
  assert.ok(chainWork(remote) > chainWork(local));
  assert.equal(shouldAdoptRemote(local, remote), true);
  const got = adoptReplicaBook(
    { blocks: local, book: GNFP_BOOK.id, coin: 'GNFP' },
    { blocks: remote, book: GNFP_BOOK.id, coin: 'GNFP' },
  );
  assert.equal(got.ok, true);
  assert.equal(got.reorg, true);
  assert.equal(got.book.blocks[1].hash, prefix[1].hash);
  assert.equal(got.book.blocks.at(-1).hash, remote.at(-1).hash);
});

test('nakamoto: equal-work competing tip keeps first-seen local', () => {
  const a = sealed(3, 1, 'alice');
  const b = sealed(3, 1, 'bob');
  const got = adoptReplicaBook(
    { blocks: a, book: GNFP_BOOK.id, coin: 'GNFP' },
    { blocks: b, book: GNFP_BOOK.id, coin: 'GNFP' },
  );
  assert.equal(got.ok, true);
  assert.equal(got.firstSeen, true);
  assert.equal(got.book.blocks[2].hash, a[2].hash);
  assert.equal(shouldAdoptRemote(a, b), false);
});

test('nakamoto: mutated miner, foreign book, rewritten prefix rejected', () => {
  const good = sealed(3);
  const local = adoptReplicaBook({}, { blocks: good, book: GNFP_BOOK.id, coin: 'GNFP' });
  const mutated = good.map((b, i) => (i === 1 ? { ...b, miner: 'eve' } : { ...b }));
  const mut = adoptReplicaBook(local.book, { blocks: mutated, book: GNFP_BOOK.id, coin: 'GNFP' });
  assert.equal(mut.ok, false);
  const foreign = adoptReplicaBook(local.book, { book: 'other-book', coin: 'GNFP', height: 9 });
  assert.equal(foreign.ok, false);
  assert.equal(foreign.reason, 'foreign_book');
  const rewritten = ensureSealedChain([
    { height: 1, jobId: 'x1', miner: 'thief', amount: 99, foundAt: 1 },
    { height: 2, jobId: 'x2', miner: 'thief', amount: 1, foundAt: 2 },
    { height: 3, jobId: 'x3', miner: 'thief', amount: 1, foundAt: 3 },
    { height: 4, jobId: 'x4', miner: 'thief', amount: 1, foundAt: 4 },
  ]);
  assert.equal(good[0].miner, 'alice');
  const tall = sealed(8, 1, 'alice');
  const otherGenesis = ensureSealedChain(
    Array.from({ length: 12 }, (_, i) => ({
      height: i + 1, jobId: `g${i}`, miner: 'thief', amount: 1, foundAt: i,
    })),
  );
  const wipe = adoptReplicaBook(
    { blocks: tall, book: GNFP_BOOK.id, coin: 'GNFP' },
    { blocks: otherGenesis, book: GNFP_BOOK.id, coin: 'GNFP' },
  );
  assert.equal(shouldAdoptRemote(tall, otherGenesis), false);
  assert.equal(wipe.ok, true);
  assert.equal(wipe.firstSeen, true);
  assert.equal(wipe.book.blocks[0].hash, tall[0].hash);
});

test('nakamoto: default entry is equal daemon, hashTxLive 0, chain id unchanged', () => {
  const cfg = parseNodeArgs(['node', 'node.js']);
  assert.equal(cfg.equalNode, true);
  assert.equal(cfg.join, false);
  assert.equal(cfg.book, 'gnfp-germany-book-v1');
  const printed = spawnSync(process.execPath, ['src/node.js', '--print-config'], {
    cwd: root,
    encoding: 'utf8',
  });
  assert.equal(printed.status, 0, printed.stderr);
  const j = JSON.parse(printed.stdout);
  assert.equal(j.version, VERSION);
  assert.equal(j.equalNode, true);
  assert.equal(j.join, false);
  assert.equal(j.hashTxLive, 0);
  assert.equal(j.book, 'gnfp-germany-book-v1');
  assert.match(j.hub, /de\.restoreprivacy\.online:1474/);
});

test('nakamoto: prefix balances survive a later-height suffix reorg', () => {
  const env = { GNFP_PRIVACY_SALT: 'nakamoto-balance-salt' };
  const alice = 'gnfp1aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
  const bob = 'gnfp1bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';
  const prefix = ensureSealedChain([
    {
      height: 1,
      jobId: 'p1',
      miner: alice,
      amount: 20,
      foundAt: 1,
      transactions: [stampLedgerTx({
        id: 'm1', from: 'coinbase', to: alice, amount: 20, kind: 'mine',
      }, { height: 1, env })],
    },
    {
      height: 2,
      jobId: 'p2',
      miner: alice,
      amount: 1,
      foundAt: 2,
      transactions: [stampLedgerTx({
        id: 's1', from: alice, to: bob, amount: 7, kind: 'send',
      }, { height: 2, env })],
    },
  ]);
  const local = ensureSealedChain([
    ...prefix,
    { height: 3, jobId: 'l3', miner: alice, amount: 1, foundAt: 3 },
  ]);
  const remote = ensureSealedChain([
    ...prefix,
    { height: 3, jobId: 'r3', miner: bob, amount: 1, foundAt: 4 },
    { height: 4, jobId: 'r4', miner: bob, amount: 1, foundAt: 5 },
  ]);
  const aliceBefore = reconstructSpendable(txsFromSealedBlocks(prefix), { address: alice, env });
  const bobBefore = reconstructSpendable(txsFromSealedBlocks(prefix), { address: bob, env });
  assert.equal(aliceBefore, 13);
  assert.equal(bobBefore, 7);
  const got = adoptReplicaBook({ blocks: local }, { blocks: remote, book: GNFP_BOOK.id, coin: 'GNFP' });
  assert.equal(got.ok, true);
  const kept = got.book.blocks.slice(0, 2);
  assert.equal(kept[0].hash, prefix[0].hash);
  assert.equal(kept[1].hash, prefix[1].hash);
  assert.equal(reconstructSpendable(txsFromSealedBlocks(kept), { address: alice, env }), aliceBefore);
  assert.equal(reconstructSpendable(txsFromSealedBlocks(kept), { address: bob, env }), bobBefore);
});

test('nakamoto: 1-hash=1-tx stays off but collate architecture remains', () => {
  assert.equal(HASH_TX_LIVE, 0);
  const row = hashCommitTx({ to: 'gnfp1alice', hashes: 8, height: 9, id: 'h1' });
  assert.equal(row.kind, 'hash');
  assert.equal(row.confirmed, false);
  const collated = collateHashCommits([row, hashCommitTx({ to: 'gnfp1alice', hashes: 2, height: 9, id: 'h2' })]);
  assert.equal(collated.length, 1);
  assert.equal(collated[0].hashes, 10);
  const root = hashWindowCommitment({ gnfp1alice: 10 });
  assert.equal(root.length, 64);
});

import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  ensureSealedChain,
  adoptReplicaBook,
  CONFIRMATION_MS,
  GNFP_BOOK,
  isBlockConfirmed,
  isImmutableHold,
  rejectRewrite,
} from '../src/chronoflux_chain.js';
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

test('same-height competing tip is rejected', () => {
  const a = sealed(3, 1, 'alice');
  const b = sealed(3, 1, 'bob');
  const local = adoptReplicaBook({}, { blocks: a });
  assert.equal(local.ok, true);
  const fork = applyIncremental(local.book, tipIdentity({ blocks: b }), b);
  assert.equal(fork.ok, false);
  const tipOnly = adoptReplicaBook(local.book, {
    height: 3,
    tip: 3,
    tipHash: tipIdentity({ blocks: b }).tipHash,
  });
  assert.equal(tipOnly.ok, false);
  assert.equal(tipOnly.reason, 'same_height_fork');
});

test('shorter or rollback book is rejected', () => {
  const tall = sealed(5);
  const local = adoptReplicaBook({}, { blocks: tall });
  const short = applyIncremental(local.book, tipIdentity({ blocks: tall.slice(0, 2) }), tall.slice(0, 2));
  assert.equal(short.ok, false);
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

import assert from 'node:assert/strict';
import { test } from 'node:test';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { ensureSealedChain } from '../src/chronoflux_chain.js';
import { tipIdentity } from '../src/book_pull.js';
import { loadNodeStore, saveNodeStore } from '../src/node_store.js';
import { createBookPullServer, syncOnce } from '../src/node_sync.js';

function sealed(n, start = 1) {
  return ensureSealedChain(
    Array.from({ length: n }, (_, i) => ({
      height: start + i,
      jobId: `job-${start + i}`,
      miner: 'book',
      amount: 1,
      foundAt: 10_000 + i,
    })),
  );
}

function scratchDir() {
  const root = process.env.GROK_GOAL_SCRATCH
    || 'C:\\Users\\rgsne\\AppData\\Local\\Temp\\grok-goal-b8aee1d92285\\implementer';
  const dir = path.join(root, `node-sync-${Date.now()}-${Math.random().toString(16).slice(2)}`);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

test('fixture pull: empty node adopts remote tip then follows an advance and restart', async () => {
  const first = sealed(3);
  const book = createBookPullServer({ blocks: first, emissionBook: true });
  await new Promise((resolve) => book.listen(resolve));
  const port = book.address().port;
  const dataDir = scratchDir();

  const one = await syncOnce({
    hubHost: '127.0.0.1',
    hubStratum: port,
    tls: false,
    dataDir,
  });
  assert.equal(one.ok, true, one.reason);
  assert.equal(tipIdentity(one.book).height, 3);
  assert.equal(tipIdentity(one.book).tipHash, tipIdentity({ blocks: first }).tipHash);

  const taller = sealed(5);
  book.setBlocks(taller);
  const two = await syncOnce({
    hubHost: '127.0.0.1',
    hubStratum: port,
    tls: false,
    dataDir,
  });
  assert.equal(two.ok, true, two.reason);
  assert.equal(tipIdentity(two.book).height, 5);
  assert.equal(tipIdentity(two.book).tipHash, tipIdentity({ blocks: taller }).tipHash);

  const reloaded = loadNodeStore(dataDir);
  assert.ok(reloaded.book);
  assert.equal(tipIdentity(reloaded.book).height, 5);
  assert.notEqual(tipIdentity(reloaded.book).height, 0);

  const again = await syncOnce({
    hubHost: '127.0.0.1',
    hubStratum: port,
    tls: false,
    dataDir,
  });
  assert.equal(again.ok, true);
  assert.equal(again.sameTip || tipIdentity(again.book).height === 5, true);

  await book.close();
});

test('saveNodeStore then loadNodeStore does not reset to height 0', () => {
  const dir = scratchDir();
  const chain = sealed(4);
  saveNodeStore(dir, { coin: 'GNFP', blocks: chain });
  const got = loadNodeStore(dir);
  assert.equal(tipIdentity(got.book).height, 4);
  assert.equal(got.book.blocks.length, 4);
  assert.notEqual(got.book.height, 0);
});

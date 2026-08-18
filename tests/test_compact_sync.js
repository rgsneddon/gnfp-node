import assert from 'node:assert/strict';
import { test } from 'node:test';
import fs from 'fs';
import path from 'path';
import { ensureSealedChain } from '../src/chronoflux_chain.js';
import { tipIdentity } from '../src/book_pull.js';
import {
  getLastSaveMeta,
  loadNodeStore,
  naiveFullArrayBytes,
  storeOnDiskBytes,
} from '../src/node_store.js';
import { createBookPullServer, syncOnce } from '../src/node_sync.js';

const SCRATCH = process.env.GROK_GOAL_SCRATCH
  || 'C:\\Users\\rgsne\\AppData\\Local\\Temp\\grok-goal-c3cedce0a4f4\\implementer';

function sealed(n, start = 1) {
  return ensureSealedChain(
    Array.from({ length: n }, (_, i) => ({
      height: start + i,
      jobId: `tall-${start + i}`,
      miner: 'book',
      amount: 1,
      foundAt: 30_000 + start + i,
    })),
  );
}

function scratchDir() {
  const dir = path.join(SCRATCH, `compact-${Date.now()}-${Math.random().toString(16).slice(2)}`);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

test('tall synthetic chain catch-up is batched, compact, and resumes', async () => {
  const first = sealed(400);
  const book = createBookPullServer({ blocks: first, emissionBook: true });
  await new Promise((resolve) => book.listen(resolve));
  const port = book.address().port;
  const dataDir = scratchDir();
  const t0 = Date.now();
  const one = await syncOnce({
    hubHost: '127.0.0.1',
    hubStratum: port,
    tls: false,
    dataDir,
    batchLimit: 128,
  });
  const elapsed = Date.now() - t0;
  assert.equal(one.ok, true, one.reason);
  assert.equal(tipIdentity(one.book).height, 400);
  assert.equal(tipIdentity(one.book).tipHash, tipIdentity({ blocks: first }).tipHash);
  assert.ok(elapsed < 20_000, `first catch-up too slow: ${elapsed}ms`);

  const diskAfterFirst = storeOnDiskBytes(dataDir);
  const naiveFirst = naiveFullArrayBytes(first);
  const gzPath = path.join(dataDir, 'blocks.jsonl.gz');
  assert.equal(fs.existsSync(gzPath), true, 'compressed book');
  assert.ok(
    diskAfterFirst < naiveFirst,
    `store ${diskAfterFirst} should be < naive ${naiveFirst}`,
  );

  const taller = sealed(600);
  book.setBlocks(taller);
  const two = await syncOnce({
    hubHost: '127.0.0.1',
    hubStratum: port,
    tls: false,
    dataDir,
    batchLimit: 128,
  });
  assert.equal(two.ok, true, two.reason);
  assert.equal(tipIdentity(two.book).height, 600);
  assert.equal(tipIdentity(two.book).tipHash, tipIdentity({ blocks: taller }).tipHash);
  const meta = getLastSaveMeta();
  assert.ok(meta);
  assert.equal(meta.mode, 'append', 'second catch-up must append, not rewrite the book');

  const disk = storeOnDiskBytes(dataDir);
  const naive = naiveFullArrayBytes(taller);
  assert.ok(disk < naive, `store ${disk} should be < naive ${naive}`);

  const reloaded = loadNodeStore(dataDir);
  assert.equal(tipIdentity(reloaded.book).height, 600);
  assert.equal(tipIdentity(reloaded.book).tipHash, tipIdentity({ blocks: taller }).tipHash);
  assert.equal(reloaded.book.blocks.length, 600);

  await book.close();
});

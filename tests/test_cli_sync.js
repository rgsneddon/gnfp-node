import assert from 'node:assert/strict';
import { test } from 'node:test';
import { spawn } from 'node:child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'node:url';
import { ensureSealedChain } from '../src/chronoflux_chain.js';
import { tipIdentity } from '../src/book_pull.js';
import { createBookPullServer } from '../src/node_sync.js';
import { loadNodeStore } from '../src/node_store.js';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

function sealed(n, start = 1) {
  return ensureSealedChain(
    Array.from({ length: n }, (_, i) => ({
      height: start + i,
      jobId: `cli-${start + i}`,
      miner: 'book',
      amount: 1,
      foundAt: 20_000 + i,
    })),
  );
}

function scratchDir() {
  const rootDir = process.env.GROK_GOAL_SCRATCH
    || 'C:\\Users\\rgsne\\AppData\\Local\\Temp\\grok-goal-b8aee1d92285\\implementer';
  const dir = path.join(rootDir, `cli-sync-${Date.now()}-${Math.random().toString(16).slice(2)}`);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

async function waitFor(fn, ms = 8000) {
  const deadline = Date.now() + ms;
  let last;
  while (Date.now() < deadline) {
    last = await fn();
    if (last) return last;
    await new Promise((r) => setTimeout(r, 100));
  }
  return last;
}

test('shipped node.js follows a fixture tip, then an advance, then restart', async () => {
  const first = sealed(3);
  const book = createBookPullServer({ blocks: first, emissionBook: true });
  await new Promise((resolve) => book.listen(resolve));
  const bookPort = book.address().port;
  const dataDir = scratchDir();
  const httpPort = 18000 + Math.floor(Math.random() * 1000);
  const child = spawn(
    process.execPath,
    [
      'src/node.js',
      '--pull', `127.0.0.1:${bookPort}`,
      '--notls',
      '--replica-only',
      '--data-dir', dataDir,
      '--http-port', String(httpPort),
      '--poll-ms', '1000',
    ],
    { cwd: root, stdio: ['ignore', 'pipe', 'pipe'] },
  );
  try {
    const one = await waitFor(async () => {
      try {
        const j = await (await fetch(`http://127.0.0.1:${httpPort}/api/tip`)).json();
        return Number(j.height) === 3 ? j : null;
      } catch {
        return null;
      }
    });
    assert.ok(one, 'first sync tip');
    assert.equal(one.height, 3);
    assert.equal(one.tipHash, tipIdentity({ blocks: first }).tipHash);

    const taller = sealed(5);
    book.setBlocks(taller);
    const two = await waitFor(async () => {
      try {
        const j = await (await fetch(`http://127.0.0.1:${httpPort}/api/tip`)).json();
        return Number(j.height) === 5 ? j : null;
      } catch {
        return null;
      }
    });
    assert.ok(two, 'advanced tip');
    assert.equal(two.tipHash, tipIdentity({ blocks: taller }).tipHash);
  } finally {
    child.kill();
    await new Promise((r) => setTimeout(r, 200));
    await book.close();
  }

  const reloaded = loadNodeStore(dataDir);
  assert.ok(reloaded.book);
  assert.equal(tipIdentity(reloaded.book).height, 5);
  assert.notEqual(tipIdentity(reloaded.book).height, 0);
});

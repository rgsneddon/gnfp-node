import assert from 'node:assert/strict';
import { test } from 'node:test';
import fs from 'fs';
import path from 'path';
import net from 'net';
import { GNFP_BOOK, hashMatches } from '../src/chronoflux_chain.js';
import { hashMeetsJob } from '../src/cpu_pow.js';
import { createEqualBook } from '../src/equal_book.js';
import os from 'os';
import { BLOCK_REWARD_GNFP, HASH_BONUS_GNFP, hashBonusGnfp, hashesProvenByShare } from '../src/book_law.js';

function scratchDir() {
  const dir = path.join(os.tmpdir(), `equal-${Date.now()}-${Math.random().toString(16).slice(2)}`);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function findNonce(job) {
  for (let i = 0; i < 200000; i += 1) {
    const n = i.toString(16).padStart(16, '0');
    if (hashMeetsJob(job, n, '')) return n;
  }
  throw new Error('no nonce');
}

test('lone node settles a miner share and keeps the tip after restart', () => {
  const dir = scratchDir();
  const a = createEqualBook({ dataDir: dir, bits: 14 });
  assert.equal(a.tip().book, GNFP_BOOK.id);
  assert.equal(a.tip().emissionBook, true);
  const job = a.nextJob();
  const nonce = findNonce(job);
  const got = a.submitShare({
    username: 'gnfp1alice.worker',
    nonce,
    jobId: job.jobId,
    client: 'GNFPHash',
  });
  assert.equal(got.accepted, true, got.reason);
  assert.equal(got.sealed.blockRewardGnfp, BLOCK_REWARD_GNFP);
  assert.equal(got.sealed.hashBonusGnfp, HASH_BONUS_GNFP);
  const proven = hashesProvenByShare(14);
  assert.equal(got.sealed.amount, BLOCK_REWARD_GNFP + hashBonusGnfp(proven));
  assert.equal(
    got.sealed.bonusNanos['gnfp1alice.worker'] ?? got.sealed.bonusNanos.gnfp1alice,
    proven,
  );
  assert.equal(hashMatches(got.sealed), true);
  const hash = a.tip().tipHash;
  const b = createEqualBook({ dataDir: dir, bits: 14 });
  assert.equal(b.tip().height, 1);
  assert.equal(b.tip().tipHash, hash);
  assert.notEqual(b.tip().height, 0);
});

test('busy port bind does not throw an uncaught exception', async () => {
  const blocker = net.createServer();
  await new Promise((r) => blocker.listen(0, '0.0.0.0', r));
  const port = blocker.address().port;
  const uncaught = [];
  const onUnc = (err) => { uncaught.push(err); };
  process.on('uncaughtException', onUnc);
  try {
    const book = createEqualBook({ bits: 14 });
    const http = book.listenHttp(port);
    http.listen(() => {});
    await new Promise((r) => setTimeout(r, 200));
    assert.equal(uncaught.length, 0, uncaught[0] && uncaught[0].message);
  } finally {
    process.off('uncaughtException', onUnc);
    await new Promise((r) => blocker.close(r));
  }
});

test('when the peer is gone the lone book still accepts miners', async () => {
  const dir = scratchDir();
  const book = createEqualBook({ dataDir: dir, bits: 14 });
  const http = book.listenHttp(0);
  const stratum = book.listenStratum(0);
  await new Promise((r) => http.listen(r));
  await new Promise((r) => stratum.listen(r));
  const port = stratum.address().port;
  const sock = net.connect(port, '127.0.0.1');
  await new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('stratum timeout')), 8000);
    sock.setEncoding('utf8');
    let buf = '';
    sock.on('data', (chunk) => {
      buf += chunk;
      let idx;
      while ((idx = buf.indexOf('\n')) >= 0) {
        const msg = JSON.parse(buf.slice(0, idx));
        buf = buf.slice(idx + 1);
        if (msg.method === 'job' || msg.input) {
          const nonce = findNonce(msg);
          sock.write(`${JSON.stringify({
            method: 'submit',
            login: 'gnfp1bob.worker',
            nonce,
            jobId: msg.jobId,
            client: 'GNFPHash',
            id: 2,
          })}\n`);
        }
        if (msg.description === 'accepted') {
          clearTimeout(t);
          try { sock.destroy(); } catch { /* closed */ }
          resolve();
        }
      }
    });
    sock.on('connect', () => {
      sock.write(`${JSON.stringify({ method: 'login', login: 'gnfp1bob.worker', threads: 1, id: 1 })}\n`);
    });
  });
  await new Promise((r) => setTimeout(r, 50));
  await stratum.close();
  await http.close();
  assert.equal(book.tip().height >= 1, true);
  assert.equal(book.tip().book, GNFP_BOOK.id);
});

test('equal-book credits hashesProvenByShare, not 1, and stats cannot enlarge the window', () => {
  const book = createEqualBook({ bits: 32 });
  const job = book.nextJob();
  assert.equal(job.difficulty, 14);
  assert.equal(job.blockDifficulty, 32);
  const nonce = findNonce(job);
  const got = book.submitShare({
    username: 'gnfp1alice.worker',
    nonce,
    jobId: job.jobId,
    client: 'GNFPHash',
  });
  assert.equal(got.accepted, true, got.reason);
  assert.equal(got.sealed, undefined);
  assert.equal(got.block?.formed, false);
  const proven = hashesProvenByShare(14);
  const before = book.hashWindowSnapshot();
  const n = Object.values(before).reduce((s, v) => s + Math.max(0, Math.floor(Number(v) || 0)), 0);
  assert.equal(n, proven);
  assert.notEqual(n, 1);
  book.ingestStats({ username: 'gnfp1alice.worker', hashes: 999_999_999 });
  book.ingestStats({ username: 'gnfp1alice.worker', hashes: 2_000_000_000 });
  const after = book.hashWindowSnapshot();
  assert.deepEqual(after, before);
});

test('equal-book formed amount is 1 plus proven hashes times 1e-9', () => {
  const dir = scratchDir();
  const book = createEqualBook({ dataDir: dir, bits: 14 });
  const job = book.nextJob();
  const nonce = findNonce(job);
  const got = book.submitShare({
    username: 'gnfp1carol.worker',
    nonce,
    jobId: job.jobId,
    client: 'GNFPHash',
  });
  assert.equal(got.accepted, true, got.reason);
  assert.equal(got.block.formed, true);
  const proven = hashesProvenByShare(14);
  assert.equal(got.sealed.amount, BLOCK_REWARD_GNFP + hashBonusGnfp(proven));
  assert.equal(got.sealed.amount, 1 + proven / 1e9);
});

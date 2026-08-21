import assert from 'node:assert/strict';
import { test } from 'node:test';
import fs from 'fs';
import path from 'path';
import net from 'net';
import { GNFP_BOOK, hashMatches, hashBlock, adoptReplicaBook } from '../src/chronoflux_chain.js';
import { hashMeetsJob } from '../src/cpu_pow.js';
import { createEqualBook } from '../src/equal_book.js';
import os from 'os';
import { BLOCK_REWARD_GNFP, HASH_BONUS_GNFP, hashBonusGnfp, hashesProvenByShare, sealedRoundAgrees } from '../src/book_law.js';

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
    version: '1.0.4',
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
  assert.equal(got.sealed.difficultyBits, 14);
  assert.equal(got.sealed.difficulty, 2 ** 14);
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
    version: '1.0.4',
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
      sock.write(`${JSON.stringify({
        method: 'login',
        login: 'gnfp1bob.worker',
        threads: 1,
        client: 'GNFPHash',
        version: '1.0.4',
        id: 1,
      })}\n`);
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
    version: '1.0.4',
  });
  assert.equal(got.accepted, true, got.reason);
  assert.equal(got.sealed, undefined);
  assert.equal(got.block?.formed, false);
  const proven = hashesProvenByShare(14);
  assert.equal(got.hashTx.kind, 'hash');
  assert.equal(got.hashTx.nanos, proven);
  assert.equal(got.hashTx.confirmed, false);
  assert.equal(book.minerNanos()['gnfp1alice.worker'], proven);
  const before = book.hashWindowSnapshot();
  const n = Object.values(before).reduce((s, v) => s + Math.max(0, Math.floor(Number(v) || 0)), 0);
  assert.equal(n, proven);
  assert.notEqual(n, 1);
  book.ingestStats({ username: 'gnfp1alice.worker', hashes: 999_999_999 });
  book.ingestStats({ username: 'gnfp1alice.worker', hashes: 2_000_000_000 });
  const after = book.hashWindowSnapshot();
  assert.deepEqual(after, before);
});

test('two equal books converge by most-work; lesser-work side adopts', () => {
  const a = createEqualBook({ bits: 14, dataDir: scratchDir() });
  const b = createEqualBook({ bits: 14, dataDir: scratchDir() });
  const share = (book, name) => {
    const job = book.nextJob();
    const nonce = findNonce(job);
    return book.submitShare({
      username: name,
      nonce,
      jobId: job.jobId,
      client: 'GNFPHash',
      version: '1.0.4',
    });
  };
  const first = share(a, 'gnfp1alice.worker');
  assert.equal(first.accepted, true, first.reason);
  assert.equal(a.tip().height, 1);
  const b1 = share(b, 'gnfp1bob.worker');
  assert.equal(b1.accepted, true, b1.reason);
  const b2 = share(b, 'gnfp1bob.worker');
  assert.equal(b2.accepted, true, b2.reason);
  assert.ok(b.tip().height >= 2, `b height ${b.tip().height}`);
  const got = a.adoptRemote({ ...b.tip(), blocks: b.blocks() });
  assert.equal(got.ok, true, got.reason);
  assert.equal(a.tip().tipHash, b.tip().tipHash);
  assert.equal(a.tip().height, b.tip().height);
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
    version: '1.0.4',
  });
  assert.equal(got.accepted, true, got.reason);
  assert.equal(got.block.formed, true);
  const proven = hashesProvenByShare(14);
  assert.equal(got.sealed.amount, BLOCK_REWARD_GNFP + hashBonusGnfp(proven));
  assert.equal(got.sealed.amount, 1 + proven / 1e9);
  const pot = Number(got.sealed.potSplits['gnfp1carol.worker'] || 0);
  assert.equal(book.minerNanos()['gnfp1carol.worker'], proven + pot);
  assert.ok((got.sealed.transactions || []).some((t) => t.kind === 'hash' && t.confirmed === true));
  assert.ok((got.sealed.transactions || []).some((t) => t.kind === 'mine'));
  const round = (got.sealed.transactions || []).find(
    (t) => t.kind === 'mine' && t.to === 'gnfp1carol.worker' && t.confirmed === true,
  );
  assert.ok(round, 'bonus+pot round row must be sealed');
  assert.equal(round.amount, BLOCK_REWARD_GNFP + hashBonusGnfp(proven));
  assert.equal(round.hashes, proven);
  assert.equal(got.sealed.hashBonusGnfp, HASH_BONUS_GNFP);
  assert.equal(sealedRoundAgrees(got.sealed), true);
});

test('join rejects a tip whose creditsNanos do not match the collated window', () => {
  const book = createEqualBook({ bits: 14 });
  const job = book.nextJob();
  const nonce = findNonce(job);
  const got = book.submitShare({
    username: 'gnfp1eve.worker',
    nonce,
    jobId: job.jobId,
    client: 'GNFPHash',
    version: '1.0.4',
  });
  assert.equal(got.accepted, true, got.reason);
  const honest = got.sealed;
  const ok = adoptReplicaBook({}, { blocks: [honest], book: GNFP_BOOK.id, coin: 'GNFP' });
  assert.equal(ok.ok, true, ok.reason);
  const lie = {
    ...honest,
    creditsNanos: { 'gnfp1eve.worker': 9_000_000_000_000 },
  };
  lie.hash = hashBlock(lie);
  const rejected = adoptReplicaBook({}, { blocks: [lie], book: GNFP_BOOK.id, coin: 'GNFP' });
  assert.equal(rejected.ok, false);
  assert.equal(rejected.reason, 'round_mismatch');
});

test('GNFPHash 1.0.3 and lower commit zero work on the equal book', () => {
  const dir = scratchDir();
  const book = createEqualBook({ dataDir: dir, bits: 14 });
  const job = book.nextJob();
  const nonce = findNonce(job);
  const old = book.submitShare({
    username: 'gnfp1old.worker',
    nonce,
    jobId: job.jobId,
    client: 'GNFPHash',
    version: '1.0.3',
  });
  assert.equal(old.accepted, false);
  assert.equal(old.reason, 'miner_update_required');
  const missing = book.submitShare({
    username: 'gnfp1old.worker',
    nonce,
    jobId: job.jobId,
    client: 'GNFPHash',
  });
  assert.equal(missing.accepted, false);
  const ok = book.submitShare({
    username: 'gnfp1ok.worker',
    nonce,
    jobId: job.jobId,
    client: 'GNFPHash',
    version: '1.0.4',
  });
  assert.equal(ok.accepted, true, ok.reason);
  const stale = book.submitShare({
    username: 'gnfp1ok.worker',
    nonce,
    jobId: 'gnfp-from-previous-connect',
    client: 'GNFPHash',
    version: '1.0.4',
  });
  assert.equal(stale.accepted, false);
  assert.equal(stale.reason, 'stale_job');
});

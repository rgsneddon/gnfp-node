import assert from 'node:assert/strict';
import { test } from 'node:test';
import { hashesProvenByShare, SHARE_DIFFICULTY_BITS } from '../src/book_law.js';
import { shouldAdmitMiner, MIN_MINE_VERSION } from '../src/miner_admit.js';
import { assessThreadHonesty, THREAD_HONEST, THREAD_INFLATE } from '../src/thread_honesty.js';
import { provenHashrate, rollupMinerWorkers } from '../src/miner_rollup.js';
import { createEqualBook } from '../src/equal_book.js';
import { createJoinHttpServer, setReplicaBook } from '../src/gnfp_join_node.js';
import { buildSoloAnnounceBody } from '../src/solo_announce.js';
import { hashMeetsJob } from '../src/cpu_pow.js';

function findNonce(job) {
  for (let i = 0; i < 400000; i += 1) {
    const n = i.toString(16).padStart(16, '0');
    if (hashMeetsJob(job, n, '')) return n;
  }
  throw new Error('no nonce');
}

test('admit: GNFPHash 1.0.4+ only; 1.0.3 and lower commit zero work', () => {
  assert.equal(MIN_MINE_VERSION, '1.0.4');
  assert.equal(shouldAdmitMiner({ client: 'GNFPHash', version: '1.0.4' }).ok, true);
  assert.equal(shouldAdmitMiner({ client: 'GNFPHash', version: '1.0.5' }).ok, true);
  const old = shouldAdmitMiner({ client: 'GNFPHash', version: '1.0.3' });
  assert.equal(old.ok, false);
  assert.equal(old.reason, 'miner_update_required');
  const missing = shouldAdmitMiner({ client: 'GNFPHash' });
  assert.equal(missing.ok, false);
  const book = createEqualBook({ bits: 32 });
  const job = book.nextJob();
  const nonce = findNonce(job);
  const refused = book.submitShare({
    username: 'gnfp1old.worker',
    nonce,
    jobId: job.jobId,
    client: 'GNFPHash',
    version: '1.0.3',
  });
  assert.equal(refused.accepted, false);
  assert.equal(book.acceptedCount(), 0);
  assert.equal(book.liveHashrate(), 0);
});

test('honesty is device-generic: claimed <= deviceCap, 6c/12t/10 is one example', () => {
  const example = assessThreadHonesty({
    claimed: 10,
    cpuCores: 6,
    cpuThreads: 12,
    hashrate: 310_000,
    accepts: 8,
  });
  assert.equal(example.honest, true);
  assert.equal(example.verdict, THREAD_HONEST);

  const fourCore = assessThreadHonesty({
    claimed: 3,
    cpuCores: 4,
    cpuThreads: 8,
    hashrate: 40_000,
    accepts: 8,
  });
  assert.equal(fourCore.honest, true);
  assert.equal(fourCore.verdict, THREAD_HONEST);

  const twoCoreNoSmt = assessThreadHonesty({
    claimed: 2,
    cpuCores: 2,
    hashrate: 8_000,
    accepts: 8,
  });
  assert.equal(twoCoreNoSmt.honest, true);

  const sixteen = assessThreadHonesty({
    claimed: 16,
    cpuCores: 16,
    cpuThreads: 32,
    hashrate: 500_000,
    accepts: 8,
  });
  assert.equal(sixteen.honest, true);

  const inflate = assessThreadHonesty({
    claimed: 40,
    cpuCores: 16,
    cpuThreads: 32,
    hashrate: 22_000,
    accepts: 8,
  });
  assert.equal(inflate.honest, false);
  assert.equal(inflate.verdict, THREAD_INFLATE);

  const farm = assessThreadHonesty({
    claimed: 240,
    cpuCores: 8,
    hashrate: 22 * 16384,
    accepts: 8,
  });
  assert.equal(farm.honest, false);
  assert.equal(farm.verdict, THREAD_INFLATE);
});

test('published H/s is proven hashes, not share-count/s (310 kH/s scale)', () => {
  const proven = hashesProvenByShare(14);
  assert.equal(proven, 16384);
  assert.equal(SHARE_DIFFICULTY_BITS, 14);
  const sharePerSec = provenHashrate({ accepts: 19, shareBits: 14, elapsedMs: 1000 });
  assert.equal(sharePerSec, 19 * 16384);
  assert.ok(sharePerSec > 300_000 && sharePerSec < 320_000);
  assert.notEqual(Math.round(sharePerSec), 19);
  const slowWindow = provenHashrate({ accepts: 64, shareBits: 14, elapsedMs: 72_000 });
  assert.ok(slowWindow > 14_000 && slowWindow < 15_000);
  assert.notEqual(Math.round(slowWindow), 64);
});

test('equal-book liveHashrate uses proven hashes after accepted work', () => {
  const book = createEqualBook({ bits: 32 });
  const job = book.nextJob();
  const nonce = findNonce(job);
  const a = book.submitShare({
    username: 'gnfp1alice.rig',
    nonce,
    jobId: job.jobId,
    client: 'GNFPHash',
    version: '1.0.5',
    threads: 3,
    cpuCores: 4,
    cpuThreads: 8,
  });
  assert.equal(a.accepted, true, a.reason);
  const one = book.liveHashrate();
  assert.ok(one >= 16000, `got ${one}`);
  assert.ok(one !== 1);
  const b = book.submitShare({
    username: 'gnfp1alice.rig',
    nonce,
    jobId: job.jobId,
    client: 'GNFPHash',
    version: '1.0.5',
    threads: 3,
    cpuCores: 4,
    cpuThreads: 8,
  });
  assert.equal(b.accepted, true, b.reason);
  const two = book.liveHashrate();
  assert.ok(two >= 32000, `got ${two}`);
  const hon = book.honesty();
  assert.equal(hon.threads, 3);
  assert.equal(hon.cpuCores, 4);
  assert.equal(hon.cpuThreads, 8);
  assert.notEqual(hon.threads, hon.cpuThreads);
  const net = book.handleApi('/api/network', 'GET', '');
  assert.equal(net.status, 200);
  assert.equal(net.json.threads, 3);
  assert.equal(net.json.cpuThreads, 8);
  assert.equal(net.json.cpuCores, 4);
  assert.ok(net.json.hashrate >= 32000);
});

test('join /api/miner rollup uses utilised threads, not sum of cpuThreads', async () => {
  setReplicaBook({
    minerWorkers: {
      'miner-abcd': [
        {
          tag: 'w1',
          threads: 1,
          claimedThreads: 1,
          cpuThreads: 12,
          cpuCores: 6,
          hashrate: 50_000,
          accepted: 10,
          hashes: 100,
          threadHonesty: 'honest',
          threadsHonest: true,
        },
        {
          tag: 'w2',
          threads: 1,
          claimedThreads: 1,
          cpuThreads: 12,
          cpuCores: 6,
          hashrate: 48_000,
          accepted: 9,
          hashes: 90,
          threadHonesty: 'honest',
          threadsHonest: true,
        },
      ],
    },
  });
  const http = createJoinHttpServer({ port: 0, hubHttp: 'http://127.0.0.1:9/api/tip' });
  await new Promise((r) => http.listen(r));
  try {
    const port = http.address().port;
    const res = await fetch(`http://127.0.0.1:${port}/api/miner/miner-abcd`);
    const json = await res.json();
    assert.equal(res.status, 200);
    assert.equal(json.threads, 2);
    assert.equal(json.claimedThreads, 2);
    assert.notEqual(json.threads, 24);
    assert.equal(json.cpuThreads, 12);
    assert.equal(json.cpuCores, 6);
    assert.equal(json.hashrate, 98_000);
    assert.equal(json.threadHonesty, 'honest');
    const other = rollupMinerWorkers('miner-ef', [
      { claimedThreads: 16, threads: 16, cpuThreads: 32, cpuCores: 16, hashrate: 400_000, threadHonesty: 'honest' },
    ]);
    assert.equal(other.threads, 16);
    assert.equal(other.cpuThreads, 32);
    assert.notEqual(other.threads, 32);
  } finally {
    setReplicaBook(null);
    await http.close();
  }
});

test('join /api/network proxies hub workers so honesty is visible at the join', async () => {
  setReplicaBook({ height: 10, coin: 'GNFP' });
  const http = createJoinHttpServer({
    port: 0,
    hubHttp: 'https://hub.example/api/tip',
    fetchImpl: async (url) => {
      assert.match(String(url), /\/api\/network$/);
      return {
        json: async () => ({
          ok: true,
          coin: 'GNFP',
          hashrate: 400_000,
          workers: [{
            tag: 'miner-zzzz',
            threads: 16,
            claimedThreads: 16,
            cpuThreads: 32,
            cpuCores: 16,
            hashrate: 400_000,
            accepted: 20,
            threadHonesty: 'honest',
            threadsHonest: true,
          }],
        }),
      };
    },
  });
  await new Promise((r) => http.listen(r));
  try {
    const port = http.address().port;
    const net = await (await fetch(`http://127.0.0.1:${port}/api/network`)).json();
    assert.equal(net.emissionBook, false);
    assert.equal(net.hashrate, 400_000);
    assert.equal(net.workers[0].threads, 16);
    assert.equal(net.workers[0].cpuThreads, 32);
    assert.equal(net.workers[0].threadHonesty, 'honest');
    const miner = await (await fetch(`http://127.0.0.1:${port}/api/miner/miner-zzzz`)).json();
    assert.equal(miner.threads, 16);
    assert.equal(miner.cpuThreads, 32);
    assert.notEqual(miner.threads, 32);
    assert.equal(miner.threadHonesty, 'honest');
  } finally {
    setReplicaBook(null);
    await http.close();
  }
});

test('solo announce carries cpuCores, cpuThreads, and threadHonesty', () => {
  const body = buildSoloAnnounceBody({
    host: 'solo-deadbeef.node',
    threads: 10,
    cpuCores: 6,
    cpuThreads: 12,
    threadHonesty: 'honest',
    hashrate: 310_000,
    accepted: 64,
  });
  assert.equal(body.threads, 10);
  assert.equal(body.cpuCores, 6);
  assert.equal(body.cpuThreads, 12);
  assert.equal(body.threadHonesty, 'honest');
  assert.equal(body.hashrate, 310_000);
  const other = buildSoloAnnounceBody({
    host: 'solo-aaaa.node',
    threads: 3,
    cpuCores: 4,
    cpuThreads: 8,
    threadHonesty: 'honest',
  });
  assert.equal(other.threads, 3);
  assert.equal(other.cpuThreads, 8);
});

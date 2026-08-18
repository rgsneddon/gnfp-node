import assert from 'node:assert/strict';
import { test } from 'node:test';
import fs from 'fs';
import path from 'path';
import { hashMeetsJob } from '../src/cpu_pow.js';
import { createEqualBook } from '../src/equal_book.js';
import {
  announceUrls,
  buildSoloAnnounceBody,
  DEFAULT_SOLO_ANNOUNCE_URLS,
  loadOrCreateSoloHost,
  postSoloAnnounce,
} from '../src/solo_announce.js';

function findNonce(job) {
  for (let i = 0; i < 200000; i += 1) {
    const n = i.toString(16).padStart(16, '0');
    if (hashMeetsJob(job, n, '')) return n;
  }
  throw new Error('no nonce');
}

test('solo announce body is role=solo and posts to explorer + book', async () => {
  const body = buildSoloAnnounceBody({
    host: 'solo-deadbeef.node',
    port: 1474,
    threads: 1,
    accepted: 2,
    hashrate: 2,
  });
  assert.equal(body.role, 'solo');
  assert.equal(body.host, 'solo-deadbeef.node');
  assert.equal(body.threads, 1);
  const urls = announceUrls();
  assert.ok(urls.some((u) => u.includes('explorer.restoreprivacy.online')));
  assert.ok(urls.some((u) => u.includes('de.restoreprivacy.online:1474')));
  assert.equal(DEFAULT_SOLO_ANNOUNCE_URLS.length >= 2, true);

  const posted = [];
  const results = await postSoloAnnounce(body, {
    urls,
    fetchImpl: async (url, opts) => {
      posted.push({ url, ...JSON.parse(opts.body) });
      return { status: 200 };
    },
  });
  assert.equal(results.every((r) => r.ok), true);
  assert.equal(posted.length, urls.length);
  assert.ok(posted.every((p) => p.role === 'solo'));
  assert.ok(posted.every((p) => p.host === 'solo-deadbeef.node'));
});

test('local mine-settle posts a solo check-in via the shipped book', async () => {
  const dir = path.join(
    process.env.GROK_GOAL_SCRATCH
      || 'C:\\Users\\rgsne\\AppData\\Local\\Temp\\grok-goal-c3cedce0a4f4\\implementer',
    `solo-${Date.now()}`,
  );
  fs.mkdirSync(dir, { recursive: true });
  const host = loadOrCreateSoloHost(dir);
  assert.match(host, /^solo-[0-9a-f]{8}\.node$/);
  assert.equal(loadOrCreateSoloHost(dir), host);

  const posted = [];
  const book = createEqualBook({
    bits: 1,
    printer: {
      watchingSeeds() {},
      syncStart() {},
      syncProgress() {},
      tipHeight() {},
      blockFound() {},
    },
  });
  book.onShare(() => postSoloAnnounce(
    { host, port: 1474, threads: 1, accepted: book.acceptedCount() },
    {
      urls: ['https://explorer.restoreprivacy.online/api/nodes'],
      fetchImpl: async (_url, opts) => {
        posted.push(JSON.parse(opts.body));
        return { status: 200 };
      },
    },
  ));
  const job = book.nextJob();
  const got = book.submitShare({
    username: 'gnfp18ff7e8b2f0ef3e96f598231638aafd5a5abc490c.win',
    nonce: findNonce(job),
    jobId: job.jobId,
    client: 'GNFPHash',
  });
  assert.equal(got.accepted, true);
  assert.equal(book.acceptedCount(), 1);
  await new Promise((r) => setTimeout(r, 20));
  assert.equal(posted.length, 1);
  assert.equal(posted[0].role, 'solo');
  assert.equal(posted[0].host, host);
});

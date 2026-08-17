import assert from 'node:assert/strict';
import { test } from 'node:test';
import fs from 'fs';
import path from 'path';
import net from 'net';
import { GNFP_BOOK } from '../src/chronoflux_chain.js';
import { hashMeetsJob } from '../src/cpu_pow.js';
import { createEqualBook } from '../src/equal_book.js';

function scratchDir() {
  const root = process.env.GROK_GOAL_SCRATCH
    || 'C:\\Users\\rgsne\\AppData\\Local\\Temp\\grok-goal-4dfbfbe23840\\implementer';
  const dir = path.join(root, `equal-${Date.now()}-${Math.random().toString(16).slice(2)}`);
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
  const a = createEqualBook({ dataDir: dir, bits: 1 });
  assert.equal(a.tip().book, GNFP_BOOK.id);
  assert.equal(a.tip().emissionBook, true);
  const job = a.nextJob();
  const nonce = findNonce(job);
  const got = a.submitShare({
    username: 'gnfp1alice.worker',
    nonce,
    jobId: job.jobId,
    client: 'gnfp-mine',
  });
  assert.equal(got.accepted, true, got.reason);
  assert.equal(a.tip().height, 1);
  const hash = a.tip().tipHash;
  const b = createEqualBook({ dataDir: dir, bits: 1 });
  assert.equal(b.tip().height, 1);
  assert.equal(b.tip().tipHash, hash);
  assert.notEqual(b.tip().height, 0);
});

test('when the peer is gone the lone book still accepts miners', async () => {
  const dir = scratchDir();
  const book = createEqualBook({ dataDir: dir, bits: 1 });
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
            client: 'gnfp-mine',
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

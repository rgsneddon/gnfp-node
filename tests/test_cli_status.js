import assert from 'node:assert/strict';
import { test } from 'node:test';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'path';
import { sealBlock, GENESIS_PREV } from '../src/chronoflux_chain.js';
import { hashMeetsJob } from '../src/cpu_pow.js';
import { createEqualBook } from '../src/equal_book.js';
import {
  HELP_TOPICS,
  createSyncReporter,
  formatBlockFound,
  formatSyncProgress,
  formatSyncTimeout,
  formatTipHeight,
  formatWatchingSeeds,
  isTransientSyncError,
  helpTopicPage,
  renderHelp,
  requestedHelpTopic,
} from '../src/cli_status.js';
import { VERSION } from '../src/node.js';

function findNonce(job) {
  for (let i = 0; i < 200000; i += 1) {
    const n = i.toString(16).padStart(16, '0');
    if (hashMeetsJob(job, n, '')) return n;
  }
  throw new Error('no nonce');
}

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

function helpOut(args) {
  return spawnSync(process.execPath, ['src/node.js', ...args], {
    cwd: root,
    encoding: 'utf8',
  });
}

test('shipped help topics name run, sync, mine, and data location', () => {
  assert.deepEqual([...HELP_TOPICS], ['run', 'sync', 'mine', 'data']);
  const overview = helpOut(['--help']);
  assert.equal(overview.status, 0, overview.stderr);
  assert.match(overview.stdout, /help topics/i);
  assert.match(overview.stdout, /\brun\b/);
  assert.match(overview.stdout, /\bsync\b/);
  assert.match(overview.stdout, /\bmine\b/);
  assert.match(overview.stdout, /data location/i);
  assert.match(overview.stdout, /~\/\.gnfp-node|%USERPROFILE%|data-dir/i);

  for (const topic of HELP_TOPICS) {
    const r = helpOut(['help', topic]);
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, new RegExp(`help ${topic}`));
  }

  const data = helpOut(['--help', 'data']);
  assert.equal(data.status, 0, data.stderr);
  assert.match(data.stdout, /data location/i);
  assert.match(data.stdout, /~\/\.gnfp-node/);
  assert.match(data.stdout, /%USERPROFILE%\\?\.gnfp-node/);
  assert.match(data.stdout, /--data-dir/);

  const mine = helpOut(['help', 'mine']);
  assert.match(mine.stdout, /GNFPHash/);
  assert.match(mine.stdout, /block found/);

  const run = helpOut(['help', 'run']);
  assert.match(run.stdout, /tip-height/);
  assert.match(run.stdout, /watching seeds/);

  const sync = helpOut(['help', 'sync']);
  assert.match(sync.stdout, /de\.restoreprivacy\.online/);
  assert.match(sync.stdout, /sg\.restoreprivacy\.online/);
});

test('requestedHelpTopic and renderHelp cover shipped pages', () => {
  assert.equal(requestedHelpTopic(['node', 'node.js', '--help']), '');
  assert.equal(requestedHelpTopic(['node', 'node.js', 'help', 'mine']), 'mine');
  assert.equal(requestedHelpTopic(['node', 'node.js', '--help', 'data']), 'data');
  assert.equal(requestedHelpTopic(['node', 'node.js', '--notls']), null);
  const page = renderHelp('mine', VERSION);
  assert.match(page, /GNFPHash/);
  assert.match(helpTopicPage('data', VERSION), /blocks\.jsonl\.gz/);
});

test('transient hub_timeout is a retry line, not a fatal sync error', () => {
  assert.equal(isTransientSyncError(new Error('hub_timeout')), true);
  assert.equal(isTransientSyncError(new Error('ECONNRESET')), true);
  assert.equal(isTransientSyncError(new Error('not_a_valid_extension')), false);
  assert.match(formatSyncTimeout({ peer: 'de.restoreprivacy.online:1474' }), /retrying/);
  assert.match(formatSyncTimeout({ peer: 'de.restoreprivacy.online:1474' }), /timeout/);
});

test('sync-in-progress formatter prints local vs network height', () => {
  const line = formatSyncProgress({
    localHeight: 12,
    networkHeight: 300,
    peer: '127.0.0.1:18014',
  });
  assert.match(line, /sync /);
  assert.match(line, /12/);
  assert.match(line, /300/);
  assert.match(line, /127\.0\.0\.1:18014/);
  assert.match(formatWatchingSeeds(), /germany=de\.restoreprivacy\.online:1474/);
  assert.match(formatWatchingSeeds(), /singapore=sg\.restoreprivacy\.online:1474/);
});

test('at-tip advance prints a new tip-height line', () => {
  const lines = [];
  const report = createSyncReporter({
    syncProgress: (ev) => lines.push(formatSyncProgress(ev)),
    tipHeight: (ev) => lines.push(formatTipHeight(ev)),
    watchingSeeds() {},
    syncStart() {},
    blockFound() {},
  });
  report({
    ok: true,
    sameTip: false,
    localHeight: 4,
    networkHeight: 10,
    peer: '127.0.0.1:9',
    book: { height: 4, tipHash: 'aaaa' },
  });
  assert.equal(lines.length, 0, 'behind-tip progress is onProgress, not a tip-height line');
  report({
    ok: true,
    sameTip: true,
    localHeight: 10,
    networkHeight: 10,
    tipHash: 'bbbb',
    book: { height: 10, tipHash: 'bbbb' },
  });
  report({
    ok: true,
    sameTip: true,
    localHeight: 10,
    networkHeight: 10,
    tipHash: 'bbbb',
    book: { height: 10, tipHash: 'bbbb' },
  });
  const tip = lines.find((l) => l.startsWith('tip-height'));
  assert.ok(tip, 'tip-height line');
  assert.match(tip, /tip-height 10/);
  assert.match(tip, /bbbb/);
  assert.equal(lines.filter((l) => l.startsWith('tip-height')).length, 1);
  report({
    ok: true,
    sameTip: true,
    localHeight: 11,
    networkHeight: 11,
    tipHash: 'cccc',
    book: { height: 11, tipHash: 'cccc' },
  });
  assert.equal(lines.filter((l) => l.startsWith('tip-height')).length, 2);
  assert.match(lines.at(-1), /tip-height 11 hash=cccc/);
});

test('block found formatter includes real sealBlock data-stream fields', () => {
  const sealed = sealBlock(
    {
      height: 7,
      jobId: 'job-cli-7',
      miner: 'gnfp1alice.worker',
      amount: 1,
      foundAt: 1_700_000_007,
      from: 'coinbase',
      to: 'miners',
    },
    GENESIS_PREV,
    0,
  );
  const line = formatBlockFound(sealed);
  assert.match(line, /^block found /);
  assert.match(line, new RegExp(String(sealed.height)));
  assert.match(line, new RegExp(sealed.hash));
  assert.match(line, new RegExp(sealed.previousHash));
  assert.match(line, /gnfp1alice\.worker/);
  assert.match(line, /job-cli-7/);
  assert.match(line, /coinbase/);
  assert.match(line, /gnfp-germany-book-v1/);
  assert.match(line, /"amount":1/);
  const payload = JSON.parse(line.slice('block found '.length));
  assert.equal(payload.hash, sealed.hash);
  assert.equal(payload.height, sealed.height);
  assert.equal(payload.previousHash, sealed.previousHash);
  assert.equal(payload.miner, sealed.miner);
  assert.equal(payload.jobId, sealed.jobId);
  assert.equal(payload.foundAt, sealed.foundAt);
  assert.equal(payload.from, sealed.from);
  assert.equal(payload.to, sealed.to);
  assert.equal(payload.book, sealed.book);
  assert.equal(payload.coin, sealed.coin);
});

test('local mine-settle prints block found plus the real sealed data-stream', () => {
  const lines = [];
  const printer = {
    watchingSeeds() {},
    syncStart() {},
    syncProgress() {},
    tipHeight(ev) { lines.push(formatTipHeight(ev)); },
    blockFound(block) { lines.push(formatBlockFound(block)); },
  };
  const book = createEqualBook({ bits: 1, printer });
  const job = book.nextJob();
  const nonce = findNonce(job);
  const got = book.submitShare({
    username: 'gnfp1alice.worker',
    nonce,
    jobId: job.jobId,
    client: 'GNFPHash',
  });
  assert.equal(got.accepted, true, got.reason);
  const found = lines.find((l) => l.startsWith('block found'));
  assert.ok(found, `expected block found, got ${lines.join(' | ')}`);
  const payload = JSON.parse(found.slice('block found '.length));
  assert.equal(payload.hash, got.sealed.hash);
  assert.equal(payload.height, got.sealed.height);
  assert.equal(payload.previousHash, got.sealed.previousHash);
  assert.equal(payload.miner, got.sealed.miner);
  assert.equal(payload.jobId, got.sealed.jobId);
  assert.equal(payload.amount, got.sealed.amount);
  assert.equal(payload.foundAt, got.sealed.foundAt);
  assert.equal(payload.from, got.sealed.from);
  assert.equal(payload.to, got.sealed.to);
  assert.equal(payload.book, got.sealed.book);
  assert.equal(payload.coin, got.sealed.coin);
  const tip = lines.find((l) => l.startsWith('tip-height'));
  assert.ok(tip);
  assert.match(tip, new RegExp(`tip-height ${got.sealed.height}`));
  assert.match(tip, new RegExp(got.sealed.hash));
});

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { spawn } from 'node:child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'node:url';
import { ensureSealedChain } from '../src/chronoflux_chain.js';
import { createBookPullServer } from '../src/node_sync.js';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const SCRATCH = process.env.GROK_GOAL_SCRATCH
  || 'C:\\Users\\rgsne\\AppData\\Local\\Temp\\grok-goal-c3cedce0a4f4\\implementer';

function sealed(n) {
  return ensureSealedChain(
    Array.from({ length: n }, (_, i) => ({
      height: i + 1,
      jobId: `launch-${i + 1}`,
      miner: 'book',
      amount: 1,
      foundAt: 40_000 + i,
    })),
  );
}

function scratchDir(label) {
  const dir = path.join(SCRATCH, `${label}-${Date.now()}-${Math.random().toString(16).slice(2)}`);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function runNode(args, ms = 8000) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, ['src/node.js', ...args], {
      cwd: root,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let out = '';
    const take = (d) => { out += d.toString('utf8'); };
    child.stdout.on('data', take);
    child.stderr.on('data', take);
    const done = (reason) => {
      try { child.kill(); } catch { /* already */ }
      resolve({ out, reason, pid: child.pid });
    };
    const timer = setTimeout(() => done('timeout'), ms);
    const check = () => {
      if (/tip-height\s+\d+/.test(out) && /watching seeds/.test(out) && /sync /.test(out)) {
        clearTimeout(timer);
        setTimeout(() => done('caught-up'), 150);
      }
    };
    child.stdout.on('data', check);
    child.stderr.on('data', check);
    child.on('error', (err) => {
      clearTimeout(timer);
      out += `\nlaunch error: ${err.message}\n`;
      resolve({ out, reason: 'error', pid: child.pid });
    });
  });
}

test('shipped node.js launched twice prints seeds, sync progress, and tip-height', async () => {
  fs.mkdirSync(SCRATCH, { recursive: true });
  const chain = sealed(24);
  const book = createBookPullServer({ blocks: chain, emissionBook: true });
  await new Promise((resolve) => book.listen(resolve));
  const bookPort = book.address().port;
  const logPath = path.join(SCRATCH, 'node-cli.log');
  const chunks = [];
  try {
    for (let i = 1; i <= 2; i += 1) {
      const dataDir = scratchDir(`cli-run-${i}`);
      const httpPort = 19000 + Math.floor(Math.random() * 400) + i;
      const { out, reason } = await runNode([
        '--pull', `127.0.0.1:${bookPort}`,
        '--notls',
        '--replica-only',
        '--data-dir', dataDir,
        '--http-port', String(httpPort),
        '--poll-ms', '1000',
      ], 12000);
      chunks.push(`===== run ${i} reason=${reason} =====\n${out}\n`);
      assert.match(out, /watching seeds/, `run ${i} seeds`);
      assert.match(out, /sync start/, `run ${i} sync start`);
      assert.match(out, /sync \d+\/\d+/, `run ${i} sync progress`);
      assert.match(out, /tip-height \d+/, `run ${i} tip-height`);
    }
  } catch (err) {
    chunks.push(`===== FAIL =====\n${err?.stack || err}\n`);
    throw err;
  } finally {
    fs.writeFileSync(logPath, chunks.join('\n'), 'utf8');
    await book.close();
  }
});

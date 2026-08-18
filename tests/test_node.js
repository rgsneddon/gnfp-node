import assert from 'node:assert/strict';
import { test } from 'node:test';
import { spawn, spawnSync } from 'node:child_process';
import fs from 'fs';
import net from 'net';
import { fileURLToPath } from 'node:url';
import path from 'path';
import { parseNodeArgs, VERSION } from '../src/node.js';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

test('cli help names GNFP join node', () => {
  const r = spawnSync(process.execPath, ['src/node.js', '--help'], {
    cwd: root,
    encoding: 'utf8',
  });
  assert.equal(r.status, 0);
  assert.match(r.stdout, /GNFP/);
  assert.match(r.stdout, /1474/);
  assert.match(r.stdout, /gnfp-node/);
  assert.match(r.stdout, /TLS is the shipped default/);
  assert.match(r.stdout, /Verify-before-adopt/);
  assert.match(r.stdout, /--notls/);
  assert.match(r.stdout, /join from launch/);
  assert.match(r.stdout, /--join/);
});

test('parse args default to Germany book', () => {
  const cfg = parseNodeArgs(['node', 'node.js']);
  assert.equal(cfg.hubHost, 'de.restoreprivacy.online');
  assert.equal(cfg.hubStratum, 1474);
  assert.equal(cfg.tls, true);
  assert.equal(cfg.listenHttp, 8014);
  const printed = spawnSync(process.execPath, ['src/node.js', '--print-config'], {
    cwd: root,
    encoding: 'utf8',
  });
  assert.equal(printed.status, 0);
  const j = JSON.parse(printed.stdout);
  assert.equal(j.coin, 'GNFP');
  assert.equal(j.version, VERSION);
  assert.match(j.hub, /de\.restoreprivacy\.online:1474/);
  assert.equal(j.tls, true);
  assert.match(String(j.hubHttp), /de\.restoreprivacy\.online:1474/);
  assert.equal(j.verifyBeforeAdopt, true);
  assert.equal(j.join, true);
  assert.equal(j.equalNode, false);
  assert.equal(j.emissionBook, false);
  assert.equal(j.role, 'join');
  const equal = parseNodeArgs(['node', 'node.js', '--equal']);
  assert.equal(equal.join, false);
  assert.equal(equal.equalNode, true);
  assert.equal(equal.emissionBook, true);
  const ann = parseNodeArgs([
    'node', 'node.js', '--announce-host', 'mynode.example', '--role', 'pool',
  ]);
  assert.equal(ann.announceHost, 'mynode.example');
  assert.equal(ann.role, 'pool');
  const hijack = parseNodeArgs(['node', 'node.js', '--hub', 'evil.example:9999']);
  assert.equal(hijack.hubHost, 'de.restoreprivacy.online');
  assert.equal(hijack.hubStratum, 1474);
  assert.equal(hijack.book, 'gnfp-germany-book-v1');
  const pulled = parseNodeArgs(['node', 'node.js', '--pull', '127.0.0.1:18014']);
  assert.equal(pulled.hub, 'de.restoreprivacy.online:1474');
  assert.equal(pulled.pullHost, '127.0.0.1');
  assert.equal(pulled.pullPort, 18014);
});

test('shipped node stays running when both ports are already bound', async () => {
  const httpBlock = net.createServer();
  const stratBlock = net.createServer();
  await new Promise((r) => httpBlock.listen(0, '0.0.0.0', r));
  await new Promise((r) => stratBlock.listen(0, '0.0.0.0', r));
  const httpPort = httpBlock.address().port;
  const stratPort = stratBlock.address().port;
  const dataDir = path.join(
    process.env.GROK_GOAL_SCRATCH
      || 'C:\\Users\\rgsne\\AppData\\Local\\Temp\\grok-goal-c3cedce0a4f4\\implementer',
    `stay-${Date.now()}`,
  );
  fs.mkdirSync(dataDir, { recursive: true });
  const child = spawn(
    process.execPath,
    [
      'src/node.js',
      '--notls',
      '--pull', '127.0.0.1:1',
      '--http-port', String(httpPort),
      '--stratum-port', String(stratPort),
      '--data-dir', dataDir,
      '--poll-ms', '1000',
    ],
    { cwd: root, stdio: ['ignore', 'pipe', 'pipe'] },
  );
  let out = '';
  child.stdout.on('data', (d) => { out += d; });
  child.stderr.on('data', (d) => { out += d; });
  try {
    await new Promise((r) => setTimeout(r, 1800));
    assert.equal(child.exitCode, null, `node exited early:\n${out}`);
    assert.equal(child.killed, false);
    assert.match(out, /watching seeds/);
  } finally {
    child.kill();
    await new Promise((r) => httpBlock.close(r));
    await new Promise((r) => stratBlock.close(r));
  }
});

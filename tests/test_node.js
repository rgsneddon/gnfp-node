import assert from 'node:assert/strict';
import { test } from 'node:test';
import { spawnSync } from 'node:child_process';
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
  const ann = parseNodeArgs([
    'node', 'node.js', '--announce-host', 'mynode.example', '--role', 'pool',
  ]);
  assert.equal(ann.announceHost, 'mynode.example');
  assert.equal(ann.role, 'pool');
});

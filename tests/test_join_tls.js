import assert from 'node:assert/strict';
import { test } from 'node:test';
import net from 'net';
import tls from 'tls';
import { createJoinStratumServer } from '../src/gnfp_join_node.js';

test('join stratum is plaintext when tls is off', () => {
  const s = createJoinStratumServer({
    listenStratum: 0,
    tls: false,
    hubHost: '127.0.0.1',
    hubStratum: 1,
  });
  assert.equal(s.tls, false);
});

test('join stratum speaks TLS when certs are passed (still join, not a book)', async () => {
  const { spawnSync } = await import('node:child_process');
  const fs = await import('node:fs');
  const os = await import('node:os');
  const path = await import('node:path');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gnfp-join-tls-'));
  const key = path.join(dir, 'key.pem');
  const cert = path.join(dir, 'cert.pem');
  const openssl = process.platform === 'win32'
    ? 'C:\\Program Files\\Git\\usr\\bin\\openssl.exe'
    : 'openssl';
  const made = spawnSync(openssl, [
    'req', '-x509', '-newkey', 'rsa:2048', '-keyout', key, '-out', cert,
    '-days', '1', '-nodes', '-subj', '/CN=127.0.0.1',
  ], { encoding: 'utf8' });
  if (made.status !== 0 || !fs.existsSync(key) || !fs.existsSync(cert)) {
    return; // openssl not on this host — listen-TLS path still covered on SG
  }
  const tlsOptions = {
    key: fs.readFileSync(key),
    cert: fs.readFileSync(cert),
    requestCert: false,
  };
  const join = createJoinStratumServer({
    listenStratum: 0,
    tls: false,
    tlsOptions,
    hubHost: '127.0.0.1',
    hubStratum: 1,
  });
  assert.equal(join.tls, true);
  await new Promise((r) => join.listen(r));
  const port = join.address().port;
  const ok = await new Promise((resolve, reject) => {
    const sock = tls.connect({
      host: '127.0.0.1',
      port,
      rejectUnauthorized: false,
    });
    sock.on('secureConnect', () => {
      sock.end();
      resolve(true);
    });
    sock.on('error', reject);
    setTimeout(() => reject(new Error('join tls handshake timeout')), 4000);
  });
  assert.equal(ok, true);
  await join.close();
});

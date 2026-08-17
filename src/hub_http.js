/**
 * GET JSON from the Germany book mux on :1474.
 * TLS is the public default; --notls is loopback/plaintext only.
 */
import http from 'http';
import https from 'https';

export function hubBaseUrl({ hubHost, hubStratum, tls } = {}) {
  const host = hubHost || 'de.restoreprivacy.online';
  const port = Number(hubStratum) || 1474;
  const scheme = tls === false ? 'http' : 'https';
  return `${scheme}://${host}:${port}`;
}

export function hubGetJson(url, { timeoutMs = 8000, fetchImpl } = {}) {
  if (typeof fetchImpl === 'function') {
    return Promise.resolve(fetchImpl(url)).then(async (res) => {
      if (res && typeof res.json === 'function') return res.json();
      return res;
    });
  }
  return new Promise((resolve, reject) => {
    let parsed;
    try {
      parsed = new URL(url);
    } catch (err) {
      reject(err);
      return;
    }
    const lib = parsed.protocol === 'http:' ? http : https;
    const req = lib.request(
      {
        hostname: parsed.hostname,
        port: parsed.port || (parsed.protocol === 'https:' ? 443 : 80),
        path: `${parsed.pathname}${parsed.search}`,
        method: 'GET',
        rejectUnauthorized: false,
        timeout: timeoutMs,
        headers: { Accept: 'application/json', Connection: 'close' },
      },
      (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => {
          const raw = Buffer.concat(chunks).toString('utf8');
          try {
            resolve(JSON.parse(raw || '{}'));
          } catch (err) {
            reject(err);
          }
        });
      },
    );
    req.on('error', reject);
    req.on('timeout', () => {
      req.destroy();
      reject(new Error('hub_timeout'));
    });
    req.end();
  });
}

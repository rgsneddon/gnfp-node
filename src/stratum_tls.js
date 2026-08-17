/**
 * Shipped stratum transport defaults to TLS.
 * Plaintext is an explicit local opt-out only (--notls / GNFP_STRATUM_NOTLS=1).
 */
import fs from 'fs';

export function defaultUseTls(argv = process.argv, env = process.env) {
  if (Array.isArray(argv) && argv.includes('--notls')) return false;
  if (String(env?.GNFP_STRATUM_NOTLS || '') === '1') return false;
  return true;
}

export function loadTlsOptions(env = process.env) {
  const keyPath = env.GNFP_TLS_KEY || env.GNFP_STRATUM_TLS_KEY || '';
  const certPath = env.GNFP_TLS_CERT || env.GNFP_STRATUM_TLS_CERT || '';
  if (!keyPath || !certPath || !fs.existsSync(keyPath) || !fs.existsSync(certPath)) {
    return null;
  }
  return {
    key: fs.readFileSync(keyPath),
    cert: fs.readFileSync(certPath),
    requestCert: false,
  };
}

export function defaultPoolTransport(argv = process.argv, env = process.env) {
  const tls = defaultUseTls(argv, env);
  return {
    tls,
    plaintext: !tls,
    scheme: tls ? 'tls' : 'tcp',
    defaultPort: 1474,
    optOut: '--notls',
  };
}

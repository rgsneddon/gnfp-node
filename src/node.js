#!/usr/bin/env node
/**
 * gnfp-node — join the Germany $GNFP book. Not a second chain.
 */
import { startJoinNode, joinConfig } from './gnfp_join_node.js';

export const VERSION = '1.0.1';
export const DEFAULT_HUB = 'de.restoreprivacy.online:1474';

export const HELP = `gnfp-node ${VERSION} — join the $GNFP Germany book

Usage:
  gnfp-node --hub de.restoreprivacy.online:1474

Verify-before-adopt: a replica will not take a mutated or same-height
competing book. TLS is the shipped default.

Options:
  --hub HOST:PORT     book stratum (default ${DEFAULT_HUB})
  --http-port N       local HTTP replica (default 8014)
  --stratum-port N    local stratum relay (default 1474)
  --replica-only      HTTP only, no local stratum
  --announce-host H   public host to register with the book
  --announce-url URL  book announce endpoint
  --role join|pool|solo
  --notls             local plaintext stratum only
  --help
`;

function flag(argv, name, fallback) {
  const i = argv.indexOf(name);
  if (i >= 0 && argv[i + 1] !== undefined) return argv[i + 1];
  return fallback;
}

export function parseNodeArgs(argv = process.argv) {
  const hub = flag(argv, '--hub', DEFAULT_HUB);
  const [hubHost, hubPort] = String(hub).split(':');
  return {
    hub,
    hubHost: hubHost || 'de.restoreprivacy.online',
    hubStratum: Number(hubPort || 1474),
    hubHttp: `https://${hubHost || 'de.restoreprivacy.online'}/api/network`,
    listenHttp: Number(flag(argv, '--http-port', '8014')),
    listenStratum: Number(flag(argv, '--stratum-port', '1474')),
    replicaOnly: argv.includes('--replica-only'),
    announceHost: flag(argv, '--announce-host', process.env.GNFP_ANNOUNCE_HOST || ''),
    announceUrl: flag(
      argv,
      '--announce-url',
      process.env.GNFP_ANNOUNCE_URL || 'https://explorer.restoreprivacy.online/api/nodes',
    ),
    role: flag(argv, '--role', 'join'),
    tls: !argv.includes('--notls'),
  };
}

export function main(argv = process.argv) {
  if (argv.includes('--help') || argv.includes('-h')) {
    process.stdout.write(HELP);
    return 0;
  }
  const cfg = parseNodeArgs(argv);
  if (argv.includes('--print-config')) {
    process.stdout.write(`${JSON.stringify({ ...cfg, coin: 'GNFP', version: VERSION })}\n`);
    return 0;
  }
  console.log(
    `gnfp-node ${VERSION} → hub=${cfg.hubHost}:${cfg.hubStratum} http=${cfg.listenHttp} stratum=${cfg.replicaOnly ? 'off' : cfg.listenStratum}`,
  );
  startJoinNode({ ...joinConfig(), ...cfg });
  if (cfg.announceHost) {
    const beat = () => {
      fetch(cfg.announceUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: cfg.announceHost,
          port: cfg.listenStratum,
          role: cfg.role,
        }),
      }).catch(() => {});
    };
    beat();
    setInterval(beat, 30_000);
  }
  return { cfg };
}

const here = import.meta.url;
if (process.argv[1] && here.endsWith(process.argv[1].replace(/\\/g, '/').split('/').pop())) {
  const code = main(process.argv);
  if (typeof code === 'number') process.exit(code);
}

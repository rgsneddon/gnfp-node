#!/usr/bin/env node
/**
 * gnfp-node — join the Germany $GNFP book. Not a second chain.
 */
import { startJoinNode, joinConfig } from './gnfp_join_node.js';
import { GNFP_BOOK } from './chronoflux_chain.js';
import { hubBaseUrl } from './hub_http.js';
import { defaultDataDir } from './node_store.js';

export const VERSION = '1.0.2';
export const DEFAULT_HUB = GNFP_BOOK.stratum;

export const HELP = `gnfp-node ${VERSION} — join the $GNFP Germany book

Usage:
  gnfp-node

The emission book is hardcoded in the chain as ${GNFP_BOOK.id}
(${GNFP_BOOK.stratum}). It is not an operator flag. --pull only changes
where this process dials (loopback tests). It does not retarget the book.

This process pulls tip + incremental sealed blocks from the master book
on :1474, verify-before-adopt, and keeps following the tip. A found block
is sealed into the chain; after 72s it is confirmed and stays held.
It does not start a second emission book and must not restore 50-GNFP
or 3000 ms blocks.

TLS is the shipped default. --notls is local plaintext only.

Verify-before-adopt: a mutated book, a same-height competing tip, or a
shorter/rollback book is rejected. After restart the node resumes its last
adopted tip (not height 0).

Options:
  --pull HOST:PORT    dial address only (default ${DEFAULT_HUB})
  --http-port N       local HTTP replica (default 8014)
  --stratum-port N    local stratum relay (default 1474)
  --replica-only      HTTP only, no local stratum (sync + serve pull)
  --data-dir PATH     persist adopted tip (default ~/.gnfp-node)
  --poll-ms N         tip poll interval (default 4000)
  --announce-host H   public host to register with the book
  --announce-url URL  book announce endpoint
  --role join|pool|solo
  --notls             local plaintext only (loopback / tests)
  --print-config      JSON config (coin=GNFP, hub, TLS)
  --help
`;

function flag(argv, name, fallback) {
  const i = argv.indexOf(name);
  if (i >= 0 && argv[i + 1] !== undefined) return argv[i + 1];
  return fallback;
}

export function parseNodeArgs(argv = process.argv, env = process.env) {
  const tls = !argv.includes('--notls');
  const pull = flag(argv, '--pull', env.GNFP_PULL || '');
  let pullHost = GNFP_BOOK.host;
  let pullPort = GNFP_BOOK.port;
  if (pull) {
    const [h, p] = String(pull).split(':');
    pullHost = h || pullHost;
    pullPort = Number(p || pullPort);
  }
  const base = hubBaseUrl({ hubHost: pullHost, hubStratum: pullPort, tls });
  return {
    hub: GNFP_BOOK.stratum,
    hubHost: GNFP_BOOK.host,
    hubStratum: GNFP_BOOK.port,
    book: GNFP_BOOK.id,
    pullHost,
    pullPort,
    hubHttp: `${base}/api/tip`,
    listenHttp: Number(flag(argv, '--http-port', '8014')),
    listenStratum: Number(flag(argv, '--stratum-port', '1474')),
    replicaOnly: argv.includes('--replica-only'),
    dataDir: flag(argv, '--data-dir', env.GNFP_NODE_DATA || defaultDataDir(env)),
    pollMs: Number(flag(argv, '--poll-ms', env.GNFP_NODE_POLL_MS || '4000')),
    announceHost: flag(argv, '--announce-host', env.GNFP_ANNOUNCE_HOST || ''),
    announceUrl: flag(
      argv,
      '--announce-url',
      env.GNFP_ANNOUNCE_URL || 'https://explorer.restoreprivacy.online/api/nodes',
    ),
    role: flag(argv, '--role', 'join'),
    tls,
    verifyBeforeAdopt: true,
  };
}

export function main(argv = process.argv) {
  if (argv.includes('--help') || argv.includes('-h')) {
    process.stdout.write(HELP);
    return 0;
  }
  const cfg = parseNodeArgs(argv);
  if (argv.includes('--print-config')) {
    process.stdout.write(`${JSON.stringify({
      ...cfg,
      coin: 'GNFP',
      version: VERSION,
      hub: `${cfg.hubHost}:${cfg.hubStratum}`,
      tls: cfg.tls,
      verifyBeforeAdopt: true,
      emissionBook: false,
    })}\n`);
    return 0;
  }
  console.log(
    `gnfp-node ${VERSION} → hub=${cfg.hubHost}:${cfg.hubStratum} http=${cfg.listenHttp} stratum=${cfg.replicaOnly ? 'off' : cfg.listenStratum}`,
  );
  startJoinNode({
    ...joinConfig(),
    ...cfg,
    hubHost: cfg.pullHost,
    hubStratum: cfg.pullPort,
  });
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

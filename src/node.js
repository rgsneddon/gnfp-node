#!/usr/bin/env node
/**
 * gnfp-node — equal Chronoflux book. Any node can run alone.
 */
import { startJoinNode, joinConfig } from './gnfp_join_node.js';
import { startEqualNode } from './equal_book.js';
import { GNFP_BOOK } from './chronoflux_chain.js';
import { hubBaseUrl } from './hub_http.js';
import { defaultDataDir } from './node_store.js';

export const VERSION = '1.0.5';
export const DEFAULT_HUB = GNFP_BOOK.stratum;

export const HELP = `gnfp-node ${VERSION} — equal $GNFP Chronoflux node

Usage:
  gnfp-node

Every node is a full book of the same chain (${GNFP_BOOK.id}).
Germany (${GNFP_BOOK.stratum}) is a well-known peer, not a required master.
If that peer drops, this node keeps the tip, accepts miners, and
perpetuates the chain. Miners connect here directly.

--replica-only is pull-only (no local stratum, no local settle).
Default is an equal book: local stratum + HTTP + persist.

TLS is the shipped default. --notls is local plaintext only.
Verify-before-adopt still rejects mutated / same-height / rollback books.

Options:
  --peer HOST:PORT    optional peer to sync from (default ${DEFAULT_HUB})
  --pull HOST:PORT    same as --peer (dial only; does not change chain id)
  --http-port N       local HTTP book (default 8014)
  --stratum-port N    local miner stratum / book (default 1474)
  --replica-only      sync/serve only — do not settle locally
  --data-dir PATH     persist the book (default ~/.gnfp-node)
  --poll-ms N         peer poll interval (default 4000)
  --announce-host H   public host to register
  --announce-url URL  announce endpoint
  --role join|pool|solo
  --notls             local plaintext only
  --print-config      JSON (coin=GNFP, equalNode, TLS)
  --help
`;

function flag(argv, name, fallback) {
  const i = argv.indexOf(name);
  if (i >= 0 && argv[i + 1] !== undefined) return argv[i + 1];
  return fallback;
}

export function parseNodeArgs(argv = process.argv, env = process.env) {
  const tls = !argv.includes('--notls');
  const pull = flag(argv, '--peer', flag(argv, '--pull', env.GNFP_PULL || env.GNFP_PEER || ''));
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
    role: flag(argv, '--role', 'book'),
    tlsCert: flag(argv, '--tls-cert', env.GNFP_TLS_CERT || ''),
    tlsKey: flag(argv, '--tls-key', env.GNFP_TLS_KEY || ''),
    tls,
    verifyBeforeAdopt: true,
    equalNode: !argv.includes('--replica-only'),
    emissionBook: !argv.includes('--replica-only'),
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
      equalNode: cfg.equalNode,
      emissionBook: cfg.emissionBook,
    })}\n`);
    return 0;
  }
  console.log(
    `gnfp-node ${VERSION} equal=${cfg.equalNode} peer=${cfg.pullHost}:${cfg.pullPort} http=${cfg.listenHttp} stratum=${cfg.replicaOnly ? 'off' : cfg.listenStratum}`,
  );
  if (cfg.replicaOnly) {
    startJoinNode({
      ...joinConfig(),
      ...cfg,
      hubHost: cfg.pullHost,
      hubStratum: cfg.pullPort,
    });
  } else {
    startEqualNode(cfg);
  }
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

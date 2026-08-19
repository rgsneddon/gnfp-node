#!/usr/bin/env node
/**
 * gnfp-node — join the live Chronoflux book from launch.
 * --equal / --book opts into a local minting book.
 */
import fs from 'fs';
import path from 'path';
import { startJoinNode, joinConfig } from './gnfp_join_node.js';
import { startEqualNode } from './equal_book.js';
import { GNFP_BOOK } from './chronoflux_chain.js';
import { bookLawOnTip } from './book_law.js';
import { hubBaseUrl } from './hub_http.js';
import { defaultDataDir } from './node_store.js';
import {
  createCliPrinter,
  renderHelp,
  requestedHelpTopic,
  SEED_NODES,
} from './cli_status.js';

export const VERSION = '1.1.7';
export const DEFAULT_HUB = GNFP_BOOK.stratum;

export const HELP = renderHelp('', VERSION);

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
    join: !argv.includes('--equal') && !argv.includes('--book') && !argv.includes('--replica-only'),
    dataDir: flag(argv, '--data-dir', env.GNFP_NODE_DATA || defaultDataDir(env)),
    pollMs: Number(flag(argv, '--poll-ms', env.GNFP_NODE_POLL_MS || '4000')),
    announceHost: flag(argv, '--announce-host', env.GNFP_ANNOUNCE_HOST || ''),
    announceUrl: flag(
      argv,
      '--announce-url',
      env.GNFP_ANNOUNCE_URL || 'https://explorer.restoreprivacy.online/api/nodes',
    ),
    role: flag(argv, '--role', 'join'),
    tlsCert: flag(argv, '--tls-cert', env.GNFP_TLS_CERT || ''),
    tlsKey: flag(argv, '--tls-key', env.GNFP_TLS_KEY || ''),
    tls,
    verifyBeforeAdopt: true,
    equalNode: argv.includes('--equal') || argv.includes('--book'),
    emissionBook: argv.includes('--equal') || argv.includes('--book'),
  };
}

export function main(argv = process.argv) {
  const topic = requestedHelpTopic(argv);
  if (topic !== null) {
    process.stdout.write(renderHelp(topic, VERSION));
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
      join: cfg.join,
      equalNode: cfg.equalNode,
      emissionBook: cfg.emissionBook,
      ...bookLawOnTip(),
    })}\n`);
    return 0;
  }
  const printer = cfg.printer || createCliPrinter();
  const peer = `${cfg.pullHost}:${cfg.pullPort}`;
  holdProcessOpen(cfg.dataDir);
  console.log(
    `gnfp-node ${VERSION} join=${cfg.join} equal=${cfg.equalNode} peer=${peer} http=${cfg.listenHttp} stratum=${cfg.replicaOnly ? 'off' : cfg.listenStratum}`,
  );
  printer.watchingSeeds(SEED_NODES);
  printer.syncStart({ peer, localHeight: 0, networkHeight: '?' });
  const live = { ...cfg, printer };
  if (cfg.replicaOnly || cfg.join) {
    startJoinNode({
      ...joinConfig(),
      ...live,
      hubHost: cfg.pullHost,
      hubStratum: cfg.pullPort,
      replicaOnly: cfg.replicaOnly,
    });
  } else {
    startEqualNode(live);
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

function appendRunLog(dataDir, msg) {
  const root = String(dataDir || defaultDataDir());
  try {
    fs.mkdirSync(root, { recursive: true });
    fs.appendFileSync(path.join(root, 'node.log'), `${new Date().toISOString()} ${msg}\n`);
  } catch {
    /* best-effort */
  }
}

/** Keep the CLI process alive even if both binds fail. */
export function holdProcessOpen(dataDir = '') {
  const root = String(dataDir || defaultDataDir());
  try {
    fs.mkdirSync(root, { recursive: true });
    const cliPath = path.join(root, 'cli.log');
    const wrap = (stream) => {
      const orig = stream.write.bind(stream);
      stream.write = (chunk, enc, cb) => {
        try { fs.appendFileSync(cliPath, chunk); } catch { /* ignore */ }
        return orig(chunk, enc, cb);
      };
    };
    wrap(process.stdout);
    wrap(process.stderr);
  } catch { /* ignore */ }
  if (process.stdin && typeof process.stdin.resume === 'function') {
    try { process.stdin.resume(); } catch { /* no tty */ }
  }
  const hold = setInterval(() => {
    appendRunLog(dataDir, `alive pid=${process.pid}`);
  }, 30_000);
  if (typeof hold.ref === 'function') hold.ref();
  appendRunLog(dataDir, `start pid=${process.pid} argv=${process.argv.slice(1).join(' ')}`);
  process.on('beforeExit', (code) => {
    appendRunLog(dataDir, `beforeExit code=${code}`);
  });
  process.on('exit', (code) => {
    appendRunLog(dataDir, `exit code=${code}`);
  });
  return hold;
}

function isDirectRun() {
  const arg = process.argv[1];
  if (!arg) return false;
  const name = String(arg).replace(/\\/g, '/').split('/').pop();
  return import.meta.url.endsWith(name) || import.meta.url.endsWith(`${name}`.replace(/ /g, '%20'));
}

if (isDirectRun()) {
  process.on('uncaughtException', (err) => {
    const text = err && err.stack ? err.stack : String(err);
    console.error(`gnfp-node error: ${text}`);
    appendRunLog(defaultDataDir(), `uncaught ${text}`);
  });
  process.on('unhandledRejection', (err) => {
    const text = err && err.message ? err.message : String(err);
    console.error(`gnfp-node warning: ${text}`);
    appendRunLog(defaultDataDir(), `unhandled ${text}`);
  });
  const code = main(process.argv);
  if (typeof code === 'number') process.exit(code);
}

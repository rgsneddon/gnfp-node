/**
 * Pure CLI help + status line formatters. No sockets, no disk.
 * The live node prints these strings; tests drive the same functions.
 */
import { GNFP_BOOK } from './chronoflux_chain.js';

export const SEED_NODES = Object.freeze([
  Object.freeze({ name: 'germany', host: GNFP_BOOK.host, port: GNFP_BOOK.port }),
  Object.freeze({ name: 'singapore', host: 'sg.restoreprivacy.online', port: 1474 }),
]);

export const HELP_TOPICS = Object.freeze(['run', 'sync', 'mine', 'data']);

export function seedLabel(seed) {
  return `${seed.name}=${seed.host}:${seed.port}`;
}

export function formatWatchingSeeds(seeds = SEED_NODES) {
  const list = Array.isArray(seeds) && seeds.length ? seeds : SEED_NODES;
  return `watching seeds ${list.map(seedLabel).join(' ')}`;
}

export function formatSyncStart({
  peer = '',
  localHeight = 0,
  networkHeight = 0,
} = {}) {
  const net = networkHeight == null || networkHeight === '' ? '?' : networkHeight;
  return `sync start peer=${peer || GNFP_BOOK.stratum} local=${Number(localHeight) || 0} network=${net}`;
}

export function formatSyncProgress({
  localHeight = 0,
  networkHeight = 0,
  peer = '',
} = {}) {
  const local = Number(localHeight) || 0;
  const net = Number(networkHeight) || 0;
  const pct = net > 0 ? Math.min(100, Math.floor((local / net) * 100)) : (local > 0 ? 100 : 0);
  return `sync ${local}/${net} (${pct}%) peer=${peer || GNFP_BOOK.stratum}`;
}

export function formatTipHeight({ height = 0, hash = '' } = {}) {
  return `tip-height ${Number(height) || 0} hash=${hash || ''}`;
}

export function formatSyncTimeout({ peer = '' } = {}) {
  return `sync timeout peer=${peer || GNFP_BOOK.stratum} (retrying)`;
}

export function isTransientSyncError(err) {
  const msg = String(err?.message || err || '');
  return /hub_timeout|timeout|ECONNRESET|ECONNREFUSED|ENOTFOUND|EAI_AGAIN|socket hang up/i.test(msg);
}

/** Full sealed-block data-stream after the `block found` marker. */
export function formatBlockFound(block) {
  const stream = block && typeof block === 'object' ? { ...block } : {};
  return `block found ${JSON.stringify(stream)}`;
}

export function requestedHelpTopic(argv = process.argv) {
  const parts = Array.isArray(argv) ? argv.map(String) : [];
  let i = parts.findIndex((a) => a === 'help' || a === '--help' || a === '-h');
  if (i < 0) return null;
  const next = parts[i + 1];
  if (next && !next.startsWith('-')) return next.toLowerCase();
  return '';
}

export function helpOverview(version = '') {
  const ver = version ? ` ${version}` : '';
  return `gnfp-node${ver} — $GNFP Chronoflux equal daemon

Usage:
  gnfp-node [options]
  gnfp-node help [topic]

Every node syncs the same chain (${GNFP_BOOK.id}).
Germany (${GNFP_BOOK.stratum}) and Singapore are well-known peers, not masters.

Default is an equal daemon: local stratum is this node's book. It validates,
stores, serves miners, and can form blocks under book law. Peers converge by
Nakamoto most-work. --join is opt-in stratum relay into a seed.
--replica-only is pull-only (no local stratum).

TLS is the shipped default. --notls is local plaintext only.
Verify-before-adopt rejects mutated payloads, foreign books, and prefix rewrites.
Equal-work competing tips keep the first-seen local chain.

Help topics (use: gnfp-node help <topic>):
  run     start the node and read live CLI output
  sync    synchronise to the network and watch seed nodes
  mine    point GNFPHash at this node
  data    where the node lives on disk (data location)

Options:
  --peer HOST:PORT    optional peer to sync from (default ${GNFP_BOOK.stratum})
  --pull HOST:PORT    same as --peer (dial only; does not change chain id)
  --http-port N       local HTTP node (default 8014)
  --stratum-port N    local miner stratum / node (default 1474)
  --equal / --book    equal daemon (default from launch)
  --join              opt-in: relay local stratum into a seed
  --replica-only      sync/serve only — do not settle locally
  --data-dir PATH     persist the node (default ~/.gnfp-node)
  --poll-ms N         how often to pull the tip (default 4000)
  --announce-host H   public host to register
  --announce-url URL  announce endpoint
  --role book|join|pool|solo
  --notls             local plaintext only
  --tls-cert PATH     public stratum TLS cert (or GNFP_TLS_CERT)
  --tls-key PATH      public stratum TLS key (or GNFP_TLS_KEY)
  --print-config      JSON (coin=GNFP, join, equalNode, hashTxLive, TLS)
  --help [topic]      this page, or a help topic
`;
}

export function helpTopicPage(topic, version = '') {
  const t = String(topic || '').trim().toLowerCase();
  if (t === 'run') {
    return `gnfp-node help run${version ? ` (${version})` : ''}

Start an equal daemon (local stratum :1474 is this book's miners):

  gnfp-node
  gnfp-node --notls --data-dir .\\my-book

Windows:  pack\\win\\gnfp-node.cmd
Unix:     ./pack/unix/gnfp-node

Needs Node.js 18+. No npm install.

The CLI prints ongoing output:
  1. watching seeds — Germany and Singapore well-known peers
  2. sync start — local height vs network tip-height
  3. sync LOCAL/NETWORK (PCT%) — progress while catching up
  4. tip-height N hash=… — one new line each time the tip advances
  5. local stratum is this book (not a relay)

Leave it running. First sync can take a minute on a tall node; later
restarts resume from the on-disk tip (see: gnfp-node help data).

Watch-only (HTTP, no local miners):

  gnfp-node --replica-only --http-port 8014

Opt-in join relay (stratum into a seed):

  gnfp-node --join
`;
  }
  if (t === 'sync') {
    return `gnfp-node help sync${version ? ` (${version})` : ''}

On start the node watches seed nodes and synchronises to the same
chain (${GNFP_BOOK.id}) as an equal daemon.

Seeds (same chain, not masters):
  germany   ${GNFP_BOOK.stratum}
  singapore sg.restoreprivacy.online:1474

Pull from a seed (or any peer) with batched incremental blocks. Shared
sealed prefix is never rewritten. Competing suffixes resolve by most-work.
A mutated payload or foreign book is rejected (verify-before-adopt).

  gnfp-node --peer de.restoreprivacy.online:1474
  gnfp-node --peer sg.restoreprivacy.online:1474
  gnfp-node --pull 127.0.0.1:1474 --notls

While behind the network tip the CLI prints sync progress as
local vs network height. Once at tip-height it prints a tip-height
line whenever the node advances.

Public peers stay TLS. --notls is local plaintext only.
`;
  }
  if (t === 'mine') {
    return `gnfp-node help mine${version ? ` (${version})` : ''}

This node accepts GNFPHash only. Old gnfp-mine, GPU and ASIC are refused.

Point the official miner at this node (or a public seed):

  git clone https://github.com/rgsneddon/GNFPHash.git
  cd GNFPHash
  node src/miner.js --pool 127.0.0.1:1474 --user gnfp1YOURADDRESS.worker --threads 4 --notls

Public seed (TLS):

  node src/miner.js --pool de.restoreprivacy.online:1474 --user gnfp1YOURADDRESS.worker --threads 4

Use a real gnfp1 address. Local stratum is plaintext unless you pass
--tls-cert / --tls-key (or GNFP_TLS_CERT / GNFP_TLS_KEY).

A miner hashing here is hashing this equal book. --join relays shares
into a seed instead. This node reports to the explorer (POST /api/nodes)
so the explorer can list it.

When a share seals a block this node prints:

  block found {height, hash, previousHash, miner, amount, …}
`;
  }
  if (t === 'data') {
    return `gnfp-node help data${version ? ` (${version})` : ''}

Data location (where the node lives):

  default Unix     ~/.gnfp-node
  default Windows  %USERPROFILE%\\.gnfp-node
  override         --data-dir PATH   or env GNFP_NODE_DATA

Files:
  tip.json           compact tip identity (height, hash, count)
  blocks.jsonl.gz    append-only gzip batches of sealed blocks
  blocks.jsonl       legacy uncompressed fallback (still readable)

The gzip node store is compressed and append-only so a long chain is not
rewritten on every poll. Restart resumes the last tip, not height 0.

  gnfp-node --data-dir D:\\gnfp-book --print-config
`;
  }
  return '';
}

export function renderHelp(topic, version = '') {
  const t = String(topic || '').trim().toLowerCase();
  if (!t || t === 'help' || t === 'topics') return helpOverview(version);
  const page = helpTopicPage(t, version);
  if (!page) {
    return `unknown help topic: ${topic}\n\n${helpOverview(version)}`;
  }
  return page;
}

export function createCliPrinter(write) {
  const emit = typeof write === 'function'
    ? write
    : (line) => {
      process.stdout.write(String(line).endsWith('\n') ? String(line) : `${line}\n`);
    };
  const line = (text) => {
    if (text == null || text === '') return;
    emit(String(text).endsWith('\n') ? String(text) : `${text}\n`);
  };
  return {
    watchingSeeds(seeds) { line(formatWatchingSeeds(seeds)); },
    syncStart(ev) { line(formatSyncStart(ev)); },
    syncProgress(ev) { line(formatSyncProgress(ev)); },
    tipHeight(ev) { line(formatTipHeight(ev)); },
    blockFound(block) { line(formatBlockFound(block)); },
  };
}

/** Dedup tip-height spam. Progress lines come from syncOnce onProgress. */
export function createSyncReporter(printer) {
  const out = printer || createCliPrinter();
  let lastTip = -1;
  return function report(got) {
    if (!got || got.ok === false) return;
    const book = got.book || {};
    const local = Number(
      got.localHeight ?? book.height ?? book.tip ?? book.tipHeight ?? 0,
    ) || 0;
    const net = Number(got.networkHeight ?? local) || 0;
    const hash = String(got.tipHash || book.tipHash || '');
    const atTip = got.sameTip === true || local >= net;
    if (atTip && local !== lastTip) {
      out.tipHeight({ height: local, hash });
      lastTip = local;
    }
  };
}

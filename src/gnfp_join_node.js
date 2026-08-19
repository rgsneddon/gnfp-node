/**
 * Joining GNFP node: local stratum + HTTP tip that cojoin the Germany pool book.
 * Shares accepted here are the same shares the hub pool accepts.
 */
import http from 'http';
import net from 'net';
import tls from 'tls';
import { GNFP_TICKER, listGnfpNodes, buildMinerCommand } from './gnfp_nodes.js';
import { adoptReplicaBook, extractChain, GNFP_BOOK } from './chronoflux_chain.js';
import { parsePullQuery, pullPayload, tipIdentity, wantsIncrementalPull } from './book_pull.js';
import { loadNodeStore, saveNodeStore, defaultDataDir } from './node_store.js';
import { startSyncLoop } from './node_sync.js';
import { defaultUseTls, loadTlsOptions } from './stratum_tls.js';
import { createCliPrinter, createSyncReporter, formatSyncTimeout, isTransientSyncError } from './cli_status.js';
import { loadOrCreateSoloHost, startSoloAnnounceLoop } from './solo_announce.js';

export const DEFAULT_HUB_HOST = GNFP_BOOK.host;
export const DEFAULT_HUB_STRATUM = GNFP_BOOK.port;
export const DEFAULT_HUB_HTTP = `https://${GNFP_BOOK.host}:${GNFP_BOOK.port}/api/tip`;

export function joinConfig(env = process.env, argv = process.argv) {
  const pull = String(env.GNFP_PULL || '').trim();
  let pullHost = GNFP_BOOK.host;
  let pullPort = GNFP_BOOK.port;
  if (pull) {
    const [h, p] = pull.split(':');
    pullHost = h || pullHost;
    pullPort = Number(p || pullPort);
  }
  return {
    hubHost: pullHost,
    hubStratum: pullPort,
    hubHttp: env.GNFP_HUB_HTTP || `https://${pullHost}:${pullPort}/api/tip`,
    book: GNFP_BOOK.id,
    listenStratum: Number(env.GNFP_STRATUM_PORT || 1474),
    listenHttp: Number(env.GNFP_HTTP_PORT || 8014),
    replicaOnly: env.GNFP_REPLICA_ONLY === '1',
    tls: defaultUseTls(argv, env),
    dataDir: env.GNFP_NODE_DATA || defaultDataDir(env),
    pollMs: Number(env.GNFP_NODE_POLL_MS || 4000),
  };
}

let replicaBook = null;

export function setReplicaBook(book) {
  replicaBook = book && typeof book === 'object' ? book : null;
  return replicaBook;
}

export function getReplicaBook() {
  return replicaBook;
}

/** Pipe a miner TCP socket to the single Germany stratum book. */
export function relayStratumSocket(minerSock, { hubHost, hubStratum, tls: useTls } = joinConfig()) {
  const port = Number(hubStratum) || DEFAULT_HUB_STRATUM;
  const hub = useTls
    ? tls.connect({ host: hubHost, port, rejectUnauthorized: false, requestCert: false })
    : net.connect(port, hubHost);
  const drop = () => {
    try { minerSock.destroy(); } catch { /* ignore */ }
    try { hub.destroy(); } catch { /* ignore */ }
  };
  minerSock.on('error', drop);
  hub.on('error', drop);
  minerSock.on('close', drop);
  hub.on('close', drop);
  minerSock.pipe(hub);
  hub.pipe(minerSock);
  return hub;
}

export function createJoinStratumServer(opts = {}) {
  const cfg = { ...joinConfig(), ...opts };
  let miners = 0;
  const onSock = (sock) => {
    miners += 1;
    sock.on('close', () => { miners = Math.max(0, miners - 1); });
    sock.on('error', () => { miners = Math.max(0, miners - 1); });
    relayStratumSocket(sock, cfg);
  };
  const tlsOpts = cfg.tlsOptions
    || (cfg.tls === false ? null : loadTlsOptions(cfg.env || process.env));
  const server = tlsOpts ? tls.createServer(tlsOpts, onSock) : net.createServer(onSock);
  server.on('error', (err) => {
    console.error(`gnfp-node join stratum bind failed :${cfg.listenStratum} — ${err.code || err.message} (CLI keeps running)`);
  });
  return {
    listen: (cb) => server.listen(cfg.listenStratum, '0.0.0.0', cb),
    close: () => new Promise((resolve) => server.close(resolve)),
    address: () => server.address(),
    minerCount: () => miners,
    tls: Boolean(tlsOpts),
    server,
  };
}

export async function fetchHubNetwork(hubHttp = DEFAULT_HUB_HTTP, fetchImpl = fetch) {
  const res = await fetchImpl(hubHttp, { cache: 'no-store' });
  const json = await res.json();
  return json && typeof json === 'object' ? json : {};
}

export function createJoinHttpServer({
  port = 8014,
  hubHttp = DEFAULT_HUB_HTTP,
  fetchImpl = fetch,
} = {}) {
  const server = http.createServer(async (req, res) => {
    const url = String(req.url || '/').split('?')[0];
    const ok = (status, json) => {
      res.writeHead(status, {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
        'Cache-Control': 'no-store',
      });
      res.end(JSON.stringify(json));
    };
    try {
      if ((url === '/api/sync' || url === '/gnfp/api/sync') && req.method === 'POST') {
        const chunks = [];
        req.on('data', (c) => chunks.push(c));
        req.on('end', () => {
          try {
            const book = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
            const adopted = adoptReplicaBook(getReplicaBook(), book);
            if (!adopted.ok) {
              ok(409, { ok: false, reason: adopted.reason, coin: GNFP_TICKER });
              return;
            }
            setReplicaBook(adopted.book);
            const persistDir = process.env.GNFP_NODE_DATA || '';
            if (persistDir) {
              try { saveNodeStore(persistDir, adopted.book); } catch { /* persist best-effort */ }
            }
            ok(200, {
              ok: true,
              coin: GNFP_TICKER,
              synced: true,
              tip: adopted.book.tip ?? adopted.book.height,
              tipHash: tipIdentity(adopted.book).tipHash,
              verifyBeforeAdopt: true,
              emissionBook: false,
            });
          } catch (err) {
            ok(400, { ok: false, reason: 'bad_sync', error: String(err?.message || err) });
          }
        });
        return;
      }
      if (
        url === '/api/headers' ||
        url === '/gnfp/api/headers' ||
        url === '/api/blocks' ||
        url === '/gnfp/api/blocks'
      ) {
        const q = new URL(String(req.url || '/'), 'http://gnfp.local').searchParams;
        const cached = getReplicaBook() || {};
        const chain = extractChain(cached);
        if (url.endsWith('/headers') || url.endsWith('/api/headers')) {
          const got = pullPayload(chain, parsePullQuery(q), { emissionBook: false });
          ok(200, {
            ok: true,
            coin: GNFP_TICKER,
            height: got.height,
            tip: got.tip,
            tipHeight: got.tipHeight,
            tipHash: got.tipHash,
            previousHash: got.previousHash,
            count: got.count,
            more: got.more,
            headers: got.headers,
            verifyBeforeAdopt: true,
            emissionBook: false,
          });
          return;
        }
        if (wantsIncrementalPull(q) || chain.length) {
          ok(200, pullPayload(chain, parsePullQuery(q), { emissionBook: false }));
          return;
        }
      }
      if (url === '/api/nodes' || url === '/gnfp/api/nodes') {
        if (req.method === 'POST') {
          const chunks = [];
          req.on('data', (c) => chunks.push(c));
          req.on('end', async () => {
            try {
              const raw = Buffer.concat(chunks).toString('utf8') || '{}';
              const dest = String(
                process.env.GNFP_ANNOUNCE_URL
                || String(hubHttp || '').replace(/\/api\/network\/?$/, '/api/nodes')
                || 'https://explorer.restoreprivacy.online/api/nodes',
              );
              const res = await fetchImpl(dest, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: raw,
              });
              const json = await res.json();
              ok(res.status || 200, json);
            } catch (err) {
              ok(502, { ok: false, reason: 'announce_forward_failed', error: String(err?.message || err) });
            }
          });
          return;
        }
        ok(200, { ok: true, coin: GNFP_TICKER, nodes: listGnfpNodes() });
        return;
      }
      if (url === '/api/mine-command' || url === '/gnfp/api/mine-command') {
        const q = new URL(String(req.url || '/'), 'http://gnfp.local').searchParams;
        const got = buildMinerCommand({
          address: q.get('address'),
          nodeId: q.get('node') || q.get('nodeId'),
          threads: q.get('threads'),
        });
        ok(got.ok ? 200 : 400, got);
        return;
      }
      const minerMatch = url.match(/^\/(?:gnfp\/)?api\/miner\/([^/]+)$/);
      if (minerMatch) {
        const tag = decodeURIComponent(minerMatch[1]);
        const cached = getReplicaBook() || {};
        const workers = (cached.minerWorkers && cached.minerWorkers[tag]) || [];
        const row = (cached.workers || []).find((w) => w && w.tag === tag);
        const found = workers.length > 0 || Boolean(row);
        const list = workers.length ? workers : row ? [row] : [];
        const sum = (key) => list.reduce((s, w) => s + Number(w[key] || 0), 0);
        ok(found ? 200 : 404, {
          ok: found,
          coin: GNFP_TICKER,
          tag,
          hashrate: sum('hashrate'),
          accepted: sum('accepted'),
          rejected: sum('rejected'),
          threads: sum('threads'),
          hashes: sum('hashes'),
          workers: list,
        });
        return;
      }
      if (url === '/api/other-pools' || url === '/gnfp/api/other-pools') {
        const cached = getReplicaBook() || {};
        ok(200, { ok: true, coin: GNFP_TICKER, pools: cached.otherPools || [] });
        return;
      }
      if (url === '/api/solo' || url === '/gnfp/api/solo') {
        const cached = getReplicaBook() || {};
        ok(200, { ok: true, coin: GNFP_TICKER, miners: cached.soloMiners || [] });
        return;
      }
      if (url === '/api/txs' || url === '/gnfp/api/txs') {
        const cached = getReplicaBook() || {};
        const txs = Array.isArray(cached.txs) ? cached.txs.slice(0, 10) : [];
        ok(200, { ok: true, coin: GNFP_TICKER, txs });
        return;
      }
      if (
        url === '/api/network' ||
        url === '/gnfp/api/network' ||
        url === '/api/stats' ||
        url === '/gnfp/api/stats' ||
        url === '/api/tip' ||
        url === '/gnfp/api/tip'
      ) {
        const cached = getReplicaBook();
        if (url.endsWith('/tip') && cached) {
          ok(200, {
            ...tipIdentity(cached, { emissionBook: false }),
            emissionBook: false,
            replica: true,
          });
          return;
        }
        const book = cached || (await fetchHubNetwork(hubHttp, fetchImpl));
        const ident = cached ? tipIdentity(cached, { emissionBook: false }) : {};
        ok(200, {
          ...book,
          ...ident,
          coin: book.coin || GNFP_TICKER,
          joined: !cached,
          replica: Boolean(cached),
          emissionBook: false,
        });
        return;
      }
      ok(404, { ok: false, reason: 'not_found', coin: GNFP_TICKER });
    } catch (err) {
      ok(502, { ok: false, reason: 'hub_unreachable', error: String(err?.message || err) });
    }
  });
  server.on('error', (err) => {
    console.error(`gnfp-node join http bind failed :${port} — ${err.code || err.message} (CLI keeps running)`);
  });
  return {
    listen: (cb) => server.listen(port, '0.0.0.0', cb),
    close: () => new Promise((resolve) => server.close(resolve)),
    address: () => server.address(),
    server,
  };
}

export function startJoinNode(opts = {}) {
  const cfg = { ...joinConfig(), ...opts };
  const printer = cfg.printer || createCliPrinter();
  if (cfg.dataDir) {
    const loaded = loadNodeStore(cfg.dataDir);
    if (loaded.book) setReplicaBook(loaded.book);
  }
  const httpSrv = createJoinHttpServer({
    port: cfg.listenHttp,
    hubHttp: cfg.hubHttp,
    fetchImpl: opts.fetchImpl,
  });
  httpSrv.listen(() => {
    console.log(`gnfp join http 0.0.0.0:${cfg.listenHttp} hub=${cfg.hubHttp}`);
  });
  let stratum = null;
  if (!cfg.replicaOnly) {
    stratum = createJoinStratumServer(cfg);
    stratum.listen(() => {
      const mode = stratum.tls ? 'tls' : 'tcp';
      console.log(`gnfp join stratum ${mode} 0.0.0.0:${cfg.listenStratum} -> ${cfg.hubHost}:${cfg.hubStratum}`);
    });
  } else {
    console.log('gnfp replica-only HTTP (no stratum)');
  }
  const soloHost = cfg.announceHost || loadOrCreateSoloHost(cfg.dataDir);
  const solo = startSoloAnnounceLoop(
    () => ({
      host: soloHost,
      port: cfg.listenStratum || 1474,
      role: cfg.role || 'join',
      version: cfg.version || '',
      threads: 0,
    }),
    { announceUrl: cfg.announceUrl, fetchImpl: opts.fetchImpl },
  );
  const report = createSyncReporter(printer);
  const sync = startSyncLoop({
    hubHost: cfg.hubHost,
    hubStratum: cfg.hubStratum,
    tls: cfg.tls,
    dataDir: cfg.dataDir,
    fetchImpl: opts.fetchImpl,
    pollMs: cfg.pollMs,
    onProgress: (ev) => printer.syncProgress(ev),
    onAdopt: (got) => {
      if (got.book) setReplicaBook(got.book);
      report(got);
    },
    onError: (err) => {
      const peer = `${cfg.hubHost}:${cfg.hubStratum}`;
      if (isTransientSyncError(err)) {
        console.error(formatSyncTimeout({ peer }));
        return;
      }
      console.error(`sync error peer=${peer} — ${err?.message || err}`);
    },
  });
  return { http: httpSrv, stratum, cfg, sync, solo };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  startJoinNode();
}

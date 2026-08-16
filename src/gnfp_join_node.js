/**
 * Joining GNFP node: local stratum + HTTP tip that cojoin the Germany pool book.
 * Shares accepted here are the same shares the hub pool accepts.
 */
import http from 'http';
import net from 'net';
import { GNFP_TICKER, listGnfpNodes, buildMinerCommand } from './gnfp_nodes.js';

export const DEFAULT_HUB_HOST = 'de.restoreprivacy.online';
export const DEFAULT_HUB_STRATUM = 1474;
export const DEFAULT_HUB_HTTP = 'http://de.restoreprivacy.online:1474/api/network';

export function joinConfig(env = process.env) {
  return {
    hubHost: env.GNFP_HUB_HOST || DEFAULT_HUB_HOST,
    hubStratum: Number(env.GNFP_HUB_STRATUM || DEFAULT_HUB_STRATUM),
    hubHttp: env.GNFP_HUB_HTTP || DEFAULT_HUB_HTTP,
    listenStratum: Number(env.GNFP_STRATUM_PORT || 1474),
    listenHttp: Number(env.GNFP_HTTP_PORT || 8014),
    replicaOnly: env.GNFP_REPLICA_ONLY === '1',
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
export function relayStratumSocket(minerSock, { hubHost, hubStratum } = joinConfig()) {
  const hub = net.connect(Number(hubStratum) || DEFAULT_HUB_STRATUM, hubHost);
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
  const server = net.createServer((sock) => relayStratumSocket(sock, cfg));
  return {
    listen: (cb) => server.listen(cfg.listenStratum, '0.0.0.0', cb),
    close: () => new Promise((resolve) => server.close(resolve)),
    address: () => server.address(),
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
            setReplicaBook(book);
            ok(200, { ok: true, coin: GNFP_TICKER, synced: true, tip: book.tip ?? book.height });
          } catch (err) {
            ok(400, { ok: false, reason: 'bad_sync', error: String(err?.message || err) });
          }
        });
        return;
      }
      if (url === '/api/nodes' || url === '/gnfp/api/nodes') {
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
        const txs = Array.isArray(cached.txs) ? cached.txs.slice(0, 5) : [];
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
        const book = cached || (await fetchHubNetwork(hubHttp, fetchImpl));
        ok(200, { ...book, coin: book.coin || GNFP_TICKER, joined: !cached, replica: Boolean(cached) });
        return;
      }
      ok(404, { ok: false, reason: 'not_found', coin: GNFP_TICKER });
    } catch (err) {
      ok(502, { ok: false, reason: 'hub_unreachable', error: String(err?.message || err) });
    }
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
      console.log(`gnfp join stratum 0.0.0.0:${cfg.listenStratum} -> ${cfg.hubHost}:${cfg.hubStratum}`);
    });
  } else {
    console.log('gnfp replica-only HTTP (no stratum)');
  }
  return { http: httpSrv, stratum, cfg };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  startJoinNode();
}

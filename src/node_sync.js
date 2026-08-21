/**
 * Pull tip + incremental blocks from the master book and verify-before-adopt.
 */
import http from 'http';
import { applyIncremental, CATCHUP_PULL_LIMIT, parsePullQuery, pullPayload, tipIdentity } from './book_pull.js';
import { adoptReplicaBook, extractChain, heightOf } from './chronoflux_chain.js';
import { SEED_NODES } from './cli_status.js';
import { hubBaseUrl, hubGetJson } from './hub_http.js';
import { loadNodeStore, saveNodeStore } from './node_store.js';

async function pullPeerChain(base, { fetchImpl, timeoutMs, batchLimit = CATCHUP_PULL_LIMIT } = {}) {
  const blocks = [];
  let afterHeight = -1;
  let afterHash = '';
  for (let i = 0; i < 10_000; i += 1) {
    const q = new URLSearchParams({
      afterHeight: String(afterHeight),
      afterHash,
      limit: String(batchLimit),
      incremental: '1',
    });
    const pulled = await hubGetJson(`${base}/api/blocks?${q}`, { fetchImpl, timeoutMs });
    const incoming = Array.isArray(pulled?.blocks) ? pulled.blocks : [];
    if (!incoming.length) break;
    blocks.push(...incoming);
    const last = incoming[incoming.length - 1];
    afterHeight = heightOf(last, afterHeight);
    afterHash = String(last?.hash || '');
    if (pulled?.more !== true) break;
  }
  return { ok: blocks.length > 0, blocks };
}

export function localCursor(book, { limit = CATCHUP_PULL_LIMIT } = {}) {
  const chain = extractChain(book);
  const last = chain.at(-1);
  const n = Math.max(1, Math.floor(Number(limit) || CATCHUP_PULL_LIMIT));
  return {
    afterHeight: last ? heightOf(last, -1) : Math.max(-1, Math.floor(Number(book?.height ?? -1))),
    afterHash: last ? String(last.hash || '') : String(book?.tipHash || ''),
    limit: n,
  };
}

export async function syncOnce({
  hubHost,
  hubStratum,
  tls = true,
  book = null,
  dataDir = '',
  fetchImpl,
  timeoutMs = 20_000,
  batchLimit = CATCHUP_PULL_LIMIT,
  onProgress,
} = {}) {
  const local = book || (dataDir ? loadNodeStore(dataDir).book : null);
  const loopback = hubHost === '127.0.0.1' || hubHost === 'localhost';
  const peers = [{ host: hubHost, port: hubStratum }];
  if (!fetchImpl && !loopback) {
    for (const s of SEED_NODES) {
      if (s.host !== hubHost) peers.push({ host: s.host, port: s.port });
    }
  }
  let tip = null;
  let usedHost = hubHost;
  let usedPort = hubStratum;
  let lastErr = null;
  for (const p of peers) {
    try {
      const tryBase = hubBaseUrl({ hubHost: p.host, hubStratum: p.port, tls });
      const got = await hubGetJson(`${tryBase}/api/tip`, { fetchImpl, timeoutMs });
      if (got && typeof got === 'object') {
        tip = got;
        usedHost = p.host;
        usedPort = p.port;
        lastErr = null;
        break;
      }
    } catch (err) {
      lastErr = err;
    }
  }
  const peer = `${usedHost}:${usedPort}`;
  if (!tip || typeof tip !== 'object') {
    if (lastErr) throw lastErr;
    return { ok: false, reason: 'bad_tip', peer };
  }
  const base = hubBaseUrl({ hubHost: usedHost, hubStratum: usedPort, tls });
  const networkHeight = Number(tip.height ?? tip.tip ?? 0) || 0;
  const identOf = (b) => {
    const chain = extractChain(b);
    const last = chain.at(-1);
    return {
      height: last ? heightOf(last, 0) : Number(b?.height ?? b?.tip ?? 0) || 0,
      hash: last ? String(last.hash || '') : String(b?.tipHash || ''),
    };
  };
  let current = local;
  let here = identOf(current);
  const progress = (got) => {
    if (typeof onProgress === 'function') {
      onProgress({
        localHeight: got.height,
        networkHeight,
        peer,
        tipHash: got.hash,
      });
    }
  };
  if (current && here.height === networkHeight && tip.tipHash && here.hash && String(tip.tipHash) === here.hash) {
    return {
      ok: true,
      sameTip: true,
      book: current,
      localHeight: here.height,
      networkHeight,
      tipHash: here.hash,
      peer,
    };
  }
  const maxBatches = 10_000;
  for (let i = 0; i < maxBatches; i += 1) {
    progress(here);
    const cur = localCursor(current, { limit: batchLimit });
    const q = new URLSearchParams({
      afterHeight: String(cur.afterHeight),
      afterHash: cur.afterHash,
      limit: String(cur.limit),
      incremental: '1',
    });
    const pulled = await hubGetJson(`${base}/api/blocks?${q}`, { fetchImpl, timeoutMs });
    const incoming = Array.isArray(pulled?.blocks) ? pulled.blocks : [];
    if (!incoming.length) {
      here = identOf(current);
      const atTip = here.height >= networkHeight
        && (!tip.tipHash || !here.hash || String(tip.tipHash) === here.hash);
      return {
        ok: true,
        sameTip: atTip,
        book: current,
        localHeight: here.height,
        networkHeight,
        tipHash: here.hash,
        peer,
        reason: atTip ? undefined : 'empty_pull',
      };
    }
    const adopted = applyIncremental(current, tip, incoming);
    if (!adopted.ok) {
      const rewind = await pullPeerChain(base, { fetchImpl, timeoutMs, batchLimit });
      if (rewind.ok && rewind.blocks.length) {
        const again = adoptReplicaBook(
          current && typeof current === 'object' ? current : {},
          { ...tip, blocks: rewind.blocks },
        );
        if (again.ok) {
          current = again.book;
          here = identOf(current);
          if (dataDir) saveNodeStore(dataDir, current);
          progress(here);
          return {
            ...again,
            book: current,
            localHeight: here.height,
            networkHeight,
            tipHash: here.hash,
            peer,
          };
        }
      }
      return {
        ...adopted,
        localHeight: here.height,
        networkHeight,
        peer,
      };
    }
    current = adopted.book;
    here = identOf(current);
    if (dataDir) saveNodeStore(dataDir, current);
    const more = pulled?.more === true;
    const atTip = here.height >= networkHeight
      && (!tip.tipHash || String(tip.tipHash) === here.hash);
    if (atTip || !more) {
      progress(here);
      return {
        ...adopted,
        book: current,
        sameTip: atTip,
        localHeight: here.height,
        networkHeight,
        tipHash: here.hash,
        peer,
      };
    }
  }
  return {
    ok: false,
    reason: 'catchup_limit',
    book: current,
    localHeight: here.height,
    networkHeight,
    peer,
  };
}

export function startSyncLoop(opts = {}) {
  const every = Math.max(1000, Number(opts.pollMs) || 4000);
  let stopped = false;
  let busy = false;
  const tick = async () => {
    if (stopped || busy) return;
    busy = true;
    try {
      const got = await syncOnce(opts);
      if (got.ok && opts.onAdopt) opts.onAdopt(got);
    } catch (err) {
      if (opts.onError) opts.onError(err);
    } finally {
      busy = false;
    }
  };
  // Must stay referenced — this is the node's heartbeat. unref() let the
  // process exit as soon as HTTP/stratum bind failed or those servers closed.
  const timer = setInterval(tick, every);
  tick();
  return {
    stop() {
      stopped = true;
      clearInterval(timer);
    },
  };
}

/** Loopback book fixture that serves tip + incremental pull. */
export function createBookPullServer({
  port = 0,
  blocks = [],
  emissionBook = true,
} = {}) {
  let chain = Array.isArray(blocks) ? blocks.slice() : [];
  const send = (res, status, body) => {
    const buf = Buffer.from(JSON.stringify(body));
    res.writeHead(status, {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
      'Cache-Control': 'no-store',
      'Content-Length': buf.length,
    });
    res.end(buf);
  };
  const server = http.createServer((req, res) => {
    const u = new URL(String(req.url || '/'), 'http://127.0.0.1');
    const pathName = u.pathname;
    const q = parsePullQuery(u.searchParams);
    if (pathName === '/api/tip' || pathName === '/gnfp/api/tip') {
      send(res, 200, {
        ...tipIdentity({ blocks: chain }, { emissionBook }),
        emissionBook,
      });
      return;
    }
    if (pathName === '/api/headers' || pathName === '/gnfp/api/headers') {
      const got = pullPayload(chain, q, { emissionBook });
      send(res, 200, {
        ok: got.ok,
        coin: got.coin,
        height: got.height,
        tip: got.tip,
        tipHeight: got.tipHeight,
        tipHash: got.tipHash,
        previousHash: got.previousHash,
        count: got.count,
        more: got.more,
        headers: got.headers,
        verifyBeforeAdopt: true,
        emissionBook,
      });
      return;
    }
    if (pathName === '/api/blocks' || pathName === '/gnfp/api/blocks') {
      send(res, 200, pullPayload(chain, q, { emissionBook }));
      return;
    }
    send(res, 404, { ok: false, reason: 'not_found' });
  });
  return {
    listen: (cb) => server.listen(port, '127.0.0.1', cb),
    close: () => new Promise((resolve) => server.close(resolve)),
    address: () => server.address(),
    setBlocks(next) {
      chain = Array.isArray(next) ? next.slice() : [];
    },
    append(block) {
      chain.push(block);
      return chain;
    },
    blocks: () => chain.slice(),
    server,
  };
}

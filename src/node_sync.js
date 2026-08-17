/**
 * Pull tip + incremental blocks from the master book and verify-before-adopt.
 */
import http from 'http';
import { applyIncremental, parsePullQuery, pullPayload, tipIdentity } from './book_pull.js';
import { extractChain, heightOf } from './chronoflux_chain.js';
import { hubBaseUrl, hubGetJson } from './hub_http.js';
import { loadNodeStore, saveNodeStore } from './node_store.js';

export function localCursor(book) {
  const chain = extractChain(book);
  const last = chain.at(-1);
  return {
    afterHeight: last ? heightOf(last, -1) : Math.max(-1, Math.floor(Number(book?.height ?? -1))),
    afterHash: last ? String(last.hash || '') : String(book?.tipHash || ''),
    limit: 64,
  };
}

export async function syncOnce({
  hubHost,
  hubStratum,
  tls = true,
  book = null,
  dataDir = '',
  fetchImpl,
  timeoutMs = 8000,
} = {}) {
  const local = book || (dataDir ? loadNodeStore(dataDir).book : null);
  const base = hubBaseUrl({ hubHost, hubStratum, tls });
  const tip = await hubGetJson(`${base}/api/tip`, { fetchImpl, timeoutMs });
  if (!tip || typeof tip !== 'object') {
    return { ok: false, reason: 'bad_tip' };
  }
  const cur = localCursor(local);
  const sameHeight = Number(tip.height ?? tip.tip) === Number(local?.height ?? local?.tip);
  const sameHash = tip.tipHash && cur.afterHash && String(tip.tipHash) === cur.afterHash;
  if (local && sameHeight && sameHash) {
    return { ok: true, sameTip: true, book: local };
  }
  const q = new URLSearchParams({
    afterHeight: String(cur.afterHeight),
    afterHash: cur.afterHash,
    limit: String(cur.limit),
    incremental: '1',
  });
  const pulled = await hubGetJson(`${base}/api/blocks?${q}`, { fetchImpl, timeoutMs });
  const incoming = Array.isArray(pulled?.blocks) ? pulled.blocks : [];
  const adopted = applyIncremental(local, tip, incoming);
  if (!adopted.ok) return adopted;
  if (dataDir) saveNodeStore(dataDir, adopted.book);
  return adopted;
}

export function startSyncLoop(opts = {}) {
  const every = Math.max(1000, Number(opts.pollMs) || 4000);
  let stopped = false;
  const tick = async () => {
    if (stopped) return;
    try {
      const got = await syncOnce(opts);
      if (got.ok && opts.onAdopt) opts.onAdopt(got);
    } catch (err) {
      if (opts.onError) opts.onError(err);
    }
  };
  const timer = setInterval(tick, every);
  if (typeof timer.unref === 'function') timer.unref();
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

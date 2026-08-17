/**
 * Equal Chronoflux book: any node can perpetuate the same chain alone.
 * Germany is a well-known peer, not a required master.
 */
import http from 'http';
import net from 'net';
import { GNFP_BOOK, extractChain, heightOf, sealBlock, tipHashOf } from './chronoflux_chain.js';
import { applyIncremental, parsePullQuery, pullPayload, tipIdentity } from './book_pull.js';
import { hashMeetsJob } from './cpu_pow.js';
import { loadNodeStore, saveNodeStore } from './node_store.js';
import { startSyncLoop } from './node_sync.js';

export function startEqualNode(cfg = {}) {
  const book = createEqualBook({ dataDir: cfg.dataDir });
  const httpSrv = book.listenHttp(cfg.listenHttp || 0);
  httpSrv.listen(() => {
    console.log(`gnfp equal-book http 0.0.0.0:${cfg.listenHttp || httpSrv.address()?.port} chain=${GNFP_BOOK.id}`);
  });
  let stratum = null;
  if (!cfg.replicaOnly) {
    stratum = book.listenStratum(cfg.listenStratum || 0);
    stratum.listen(() => {
      console.log(`gnfp equal-book stratum 0.0.0.0:${cfg.listenStratum || stratum.address()?.port} (local book, not a relay)`);
    });
  }
  let sync = null;
  if (cfg.pullHost) {
    sync = startSyncLoop({
      hubHost: cfg.pullHost,
      hubStratum: cfg.pullPort || 1474,
      tls: cfg.tls !== false,
      dataDir: cfg.dataDir,
      pollMs: cfg.pollMs,
      onAdopt: (got) => {
        if (got.ok && got.book) book.adoptRemote(got.book);
      },
      onError: () => {
        /* peer gone — this node stays the live book */
      },
    });
  }
  return { book, http: httpSrv, stratum, sync };
}

export function createEqualBook({ dataDir = '', bits = 1 } = {}) {
  const loaded = dataDir ? loadNodeStore(dataDir).book : null;
  let blocks = extractChain(loaded);
  let height = blocks.length ? heightOf(blocks[blocks.length - 1]) : Number(loaded?.height || 0);
  let jobSeq = 1;
  let job = null;
  const miners = new Set();

  function tip() {
    return {
      ...tipIdentity({ blocks, height, coin: GNFP_BOOK.coin, book: GNFP_BOOK.id }, {
        emissionBook: true,
      }),
      emissionBook: true,
      equalNode: true,
    };
  }

  function persist() {
    if (!dataDir) return;
    saveNodeStore(dataDir, {
      coin: GNFP_BOOK.coin,
      book: GNFP_BOOK.id,
      height,
      tip: height,
      tipHeight: height,
      tipHash: tipHashOf(blocks),
      blocks,
      emissionBook: true,
    });
  }

  function nextJob() {
    const h = height || 0;
    job = {
      jobId: `gnfp-${h}-${jobSeq++}`,
      id: `gnfp-${h}-${jobSeq}`,
      height: h,
      difficulty: bits,
      input: `gnfp-equal-${h}-${jobSeq}`,
      preWork: `gnfp-equal-${h}-${jobSeq}`,
      algorithm: 'gnfp-cpu-v1',
    };
    return job;
  }

  function submitShare({ username = 'anon', nonce = '', jobId = '', client = '' } = {}) {
    const current = job || nextJob();
    if (jobId && String(jobId) !== String(current.jobId) && String(jobId) !== String(current.id)) {
      return { accepted: false, reason: 'stale_job', asset: GNFP_BOOK.coin };
    }
    if (String(client || '') && String(client) !== 'gnfp-mine') {
      return { accepted: false, reason: 'client_refused', asset: GNFP_BOOK.coin };
    }
    if (!hashMeetsJob(current, nonce, '')) {
      return { accepted: false, reason: 'below_target', asset: GNFP_BOOK.coin };
    }
    const prev = blocks.length ? blocks[blocks.length - 1].hash : undefined;
    const nextHeight = height + 1;
    const sealed = sealBlock(
      {
        height: nextHeight,
        jobId: current.jobId,
        miner: String(username || 'anon'),
        amount: 1,
        foundAt: Date.now(),
        from: 'coinbase',
        to: 'miners',
      },
      prev,
      blocks.length,
    );
    blocks.push(sealed);
    height = nextHeight;
    nextJob();
    persist();
    return {
      accepted: true,
      asset: GNFP_BOOK.coin,
      block: { formed: true, height, hash: sealed.hash },
    };
  }

  function adoptRemote(remote, incoming) {
    if (remote && Array.isArray(remote.blocks) && incoming == null) {
      blocks = extractChain(remote);
      height = blocks.length ? heightOf(blocks[blocks.length - 1]) : Number(remote.height || 0);
      persist();
      nextJob();
      return { ok: true, tip: tip(), sameTip: true };
    }
    const got = applyIncremental(
      { blocks, height, book: GNFP_BOOK.id, coin: GNFP_BOOK.coin },
      remote,
      incoming,
    );
    if (!got.ok) return got;
    blocks = extractChain(got.book);
    height = blocks.length ? heightOf(blocks[blocks.length - 1]) : Number(got.book.height || 0);
    persist();
    nextJob();
    return { ...got, tip: tip() };
  }

  function handleApi(url, method, body) {
    const raw = String(url || '/');
    const q = raw.indexOf('?');
    const path = q >= 0 ? raw.slice(0, q) : raw;
    const params = new URLSearchParams(q >= 0 ? raw.slice(q + 1) : '');
    if (path === '/api/tip' || path === '/gnfp/api/tip') {
      return { status: 200, json: tip() };
    }
    if (path === '/api/headers' || path === '/gnfp/api/headers') {
      const got = pullPayload(blocks, parsePullQuery(params), { emissionBook: true });
      return { status: 200, json: { ...got, emissionBook: true, equalNode: true } };
    }
    if (path === '/api/blocks' || path === '/gnfp/api/blocks') {
      return { status: 200, json: pullPayload(blocks, parsePullQuery(params), { emissionBook: true }) };
    }
    if (path === '/api/network' || path === '/api/stats') {
      return {
        status: 200,
        json: {
          ...tip(),
          ticker: GNFP_BOOK.coin,
          blockRewardGnfp: 1,
          miners: miners.size,
        },
      };
    }
    if (path === '/api/job') return { status: 200, json: job || nextJob() };
    if ((path === '/api/submit' || path === '/gnfp/api/submit') && String(method).toUpperCase() === 'POST') {
      const payload = typeof body === 'string' ? JSON.parse(body || '{}') : (body || {});
      const got = submitShare(payload);
      return { status: got.accepted ? 200 : 400, json: got };
    }
    return { status: 404, json: { ok: false, reason: 'not_found', coin: GNFP_BOOK.coin } };
  }

  function listenHttp(port = 0) {
    const server = http.createServer((req, res) => {
      const chunks = [];
      req.on('data', (c) => chunks.push(c));
      req.on('end', () => {
        const raw = Buffer.concat(chunks).toString('utf8');
        const hit = handleApi(req.url || '/', req.method || 'GET', raw);
        const buf = Buffer.from(JSON.stringify(hit.json));
        res.writeHead(hit.status, {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
          'Content-Length': buf.length,
        });
        res.end(buf);
      });
    });
    return {
      listen: (cb) => server.listen(port, '0.0.0.0', cb),
      close: () => new Promise((r) => server.close(r)),
      address: () => server.address(),
      server,
    };
  }

  function listenStratum(port = 0) {
    const server = net.createServer((sock) => {
      miners.add(sock);
      let buf = '';
      const send = (obj) => {
        try { sock.write(`${JSON.stringify(obj)}\n`); } catch { /* drop */ }
      };
      sock.on('data', (chunk) => {
        buf += chunk.toString('utf8');
        let idx;
        while ((idx = buf.indexOf('\n')) >= 0) {
          const line = buf.slice(0, idx).trim();
          buf = buf.slice(idx + 1);
          if (!line) continue;
          let msg;
          try { msg = JSON.parse(line); } catch { continue; }
          const method = String(msg.method || '');
          if (method === 'login') {
            send({ id: msg.id, result: true, description: 'Login Successful', coin: GNFP_BOOK.coin });
            send({ method: 'job', ...nextJob() });
          } else if (method === 'submit') {
            const got = submitShare({
              username: msg.login || msg.user,
              nonce: msg.nonce,
              jobId: msg.jobId || msg.id,
              client: msg.client,
            });
            send({
              id: msg.id,
              result: got.accepted,
              description: got.accepted ? 'accepted' : (got.reason || 'rejected'),
              asset: GNFP_BOOK.coin,
            });
            if (got.accepted) send({ method: 'job', ... (job || nextJob()) });
          } else if (method === 'stats') {
            send({ result: true, coin: GNFP_BOOK.coin });
          }
        }
      });
      sock.on('close', () => miners.delete(sock));
      sock.on('error', () => miners.delete(sock));
    });
    return {
      listen: (cb) => server.listen(port, '0.0.0.0', cb),
      close: () => new Promise((r) => server.close(r)),
      address: () => server.address(),
      server,
    };
  }

  if (!job) nextJob();

  return {
    tip,
    nextJob,
    submitShare,
    adoptRemote,
    handleApi,
    listenHttp,
    listenStratum,
    persist,
    blocks: () => blocks.slice(),
    height: () => height,
  };
}

/**
 * Equal Chronoflux book: any node can perpetuate the same chain alone.
 * Germany is a well-known peer, not a required master.
 */
import fs from 'fs';
import http from 'http';
import net from 'net';
import tls from 'tls';
import { GNFP_BOOK, extractChain, heightOf, sealBlock, tipHashOf } from './chronoflux_chain.js';
import { applyIncremental, parsePullQuery, pullPayload, tipIdentity } from './book_pull.js';
import {
  BLOCK_REWARD_GNFP,
  bookLawOnTip,
  canFormBlock,
  emptyHashWindow,
  noteMinerHashes,
  settleWindowCredits,
  hashesProvenByShare,
  SHARE_DIFFICULTY_BITS,
  LIVE_MIN_DIFFICULTY_BITS,
  GENESIS_DIFFICULTY_BITS,
  TARGET_BLOCK_INTERVAL_MS,
  retargetBits,
  HASH_BONUS_GNFP,
  NANOS_PER_GNFP,
  hashCommitTx,
  bundleHashTxsForBlock,
  blockFormWalletNanos,
} from './book_law.js';
import { hashMeetsJob, gnfpWorkHash, meetsTarget } from './cpu_pow.js';
import { loadNodeStore, saveNodeStore } from './node_store.js';
import { startSyncLoop } from './node_sync.js';
import { createCliPrinter, createSyncReporter, formatSyncTimeout, isTransientSyncError } from './cli_status.js';
import { loadOrCreateSoloHost, startSoloAnnounceLoop } from './solo_announce.js';

export function startEqualNode(cfg = {}) {
  const printer = cfg.printer || createCliPrinter();
  const book = createEqualBook({ dataDir: cfg.dataDir, printer });
  const soloHost = cfg.announceHost || loadOrCreateSoloHost(cfg.dataDir);
  const solo = startSoloAnnounceLoop(
    () => ({
      host: soloHost,
      port: cfg.listenStratum || 1474,
      role: 'solo',
      version: cfg.version || '',
      threads: book.cpuThreadCount(),
      accepted: book.acceptedCount(),
    }),
    {
      announceUrl: cfg.announceUrl,
      fetchImpl: cfg.fetchImpl,
    },
  );
  book.onShare(() => { solo.tick(); });
  const httpSrv = book.listenHttp(cfg.listenHttp || 0);
  httpSrv.listen(() => {
    console.log(`gnfp equal-book http 0.0.0.0:${cfg.listenHttp || httpSrv.address()?.port} chain=${GNFP_BOOK.id}`);
  });
  let stratum = null;
  if (!cfg.replicaOnly) {
    const tlsOpts = loadEqualTls(cfg);
    stratum = book.listenStratum(cfg.listenStratum || 0, tlsOpts);
    stratum.listen(() => {
      const mode = tlsOpts ? 'tls' : 'tcp';
      console.log(`gnfp equal-book stratum ${mode} 0.0.0.0:${cfg.listenStratum || stratum.address()?.port} (local book, not a relay)`);
    });
  }
  let sync = null;
  if (cfg.pullHost) {
    const report = createSyncReporter(printer);
    sync = startSyncLoop({
      hubHost: cfg.pullHost,
      hubStratum: cfg.pullPort || 1474,
      tls: cfg.tls !== false,
      dataDir: cfg.dataDir,
      pollMs: cfg.pollMs,
      onProgress: (ev) => printer.syncProgress(ev),
      onAdopt: (got) => {
        if (got.ok && got.book) book.adoptRemote(got.book);
        report(got);
      },
      onError: (err) => {
        const peer = `${cfg.pullHost}:${cfg.pullPort || 1474}`;
        if (isTransientSyncError(err)) {
          console.error(formatSyncTimeout({ peer }));
          return;
        }
        console.error(`sync error peer=${peer} — ${err?.message || err}`);
      },
    });
  }
  return { book, http: httpSrv, stratum, sync, solo };
}

export function loadEqualTls(cfg = {}) {
  const cert = String(cfg.tlsCert || process.env.GNFP_TLS_CERT || '').trim();
  const key = String(cfg.tlsKey || process.env.GNFP_TLS_KEY || '').trim();
  if (!cert || !key) return null;
  if (!fs.existsSync(cert) || !fs.existsSync(key)) return null;
  return {
    cert: fs.readFileSync(cert),
    key: fs.readFileSync(key),
  };
}

export function createEqualBook({ dataDir = '', bits = 1, printer = null } = {}) {
  const emit = printer || null;
  const shareHooks = [];
  let acceptedCount = 0;
  let hashWindowStart = Date.now();
  let hashWindowCount = 0;
  const loaded = dataDir ? loadNodeStore(dataDir).book : null;
  let blocks = extractChain(loaded);
  let height = blocks.length ? heightOf(blocks[blocks.length - 1]) : Number(loaded?.height || 0);
  let jobSeq = 1;
  let job = null;
  const miners = new Set();
  const minerCpu = new Map();
  let hashWindow = emptyHashWindow();
  const hashMarks = new Map();
  const pendingHashTxs = [];
  const minerNanos = Object.create(null);
  let lastFormedAt = 0;
  let lastBlockBits = GENESIS_DIFFICULTY_BITS;

  function liveHashrate() {
    const dt = Math.max(1, (Date.now() - hashWindowStart) / 1000);
    return hashWindowCount / dt;
  }

  function noteHash() {
    hashWindowCount += 1;
    if (Date.now() - hashWindowStart > 60_000) {
      hashWindowStart = Date.now();
      hashWindowCount = 1;
    }
  }

  function noteCpuThreads(username, raw) {
    if (raw == null || raw === '') return;
    const n = Math.floor(Number(raw));
    if (!Number.isFinite(n) || n < 0) return;
    const key = String(username || '').trim();
    if (!key) return;
    minerCpu.set(key, Math.min(256, n));
  }

  function cpuThreadCount() {
    let sum = 0;
    for (const n of minerCpu.values()) sum += n;
    return sum;
  }

  function creditMiner(username, nanos) {
    const key = String(username || '').trim();
    const add = Math.max(0, Math.floor(Number(nanos) || 0));
    if (!key || add <= 0) return;
    minerNanos[key] = (Number(minerNanos[key]) || 0) + add;
  }

  function shareJobBits() {
    return SHARE_DIFFICULTY_BITS;
  }

  function formBits() {
    const forced = Number(bits);
    if (Number.isFinite(forced) && forced > 0) {
      return Math.max(LIVE_MIN_DIFFICULTY_BITS, Math.floor(forced));
    }
    const interval = lastFormedAt > 0 ? Date.now() - lastFormedAt : 0;
    return retargetBits(liveHashrate(), lastBlockBits, TARGET_BLOCK_INTERVAL_MS, {
      lastBlockIntervalMs: interval || undefined,
    });
  }

  function currentBits() {
    return formBits();
  }

  function tip() {
    return {
      ...tipIdentity({ blocks, height, coin: GNFP_BOOK.coin, book: GNFP_BOOK.id }, {
        emissionBook: true,
        hashrate: liveHashrate(),
        difficultyBits: currentBits(),
      }),
      emissionBook: true,
      equalNode: true,
      ...bookLawOnTip({ bits: currentBits(), hashrate: liveHashrate() }),
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
    const jobBits = shareJobBits();
    job = {
      jobId: `gnfp-${h}-${jobSeq++}`,
      id: `gnfp-${h}-${jobSeq}`,
      height: h,
      difficulty: jobBits,
      blockDifficulty: formBits(),
      input: `gnfp-equal-${h}-${jobSeq}`,
      preWork: `gnfp-equal-${h}-${jobSeq}`,
      algorithm: 'GNFPHash',
    };
    return job;
  }

  function submitShare({ username = 'anon', nonce = '', jobId = '', client = '', threads } = {}) {
    const current = job || nextJob();
    if (jobId && String(jobId) !== String(current.jobId) && String(jobId) !== String(current.id)) {
      return { accepted: false, reason: 'stale_job', asset: GNFP_BOOK.coin };
    }
    if (String(client || '') && String(client) !== 'GNFPHash') {
      return { accepted: false, reason: 'old_miner_refused', asset: GNFP_BOOK.coin };
    }
    if (!hashMeetsJob(current, nonce, '')) {
      return { accepted: false, reason: 'below_target', asset: GNFP_BOOK.coin };
    }
    noteHash();
    const miner = String(username || 'anon');
    noteCpuThreads(miner, threads);
    const shareBits = Math.max(SHARE_DIFFICULTY_BITS, Math.floor(Number(current.difficulty) || SHARE_DIFFICULTY_BITS));
    const proven = hashesProvenByShare(shareBits);
    hashWindow = noteMinerHashes(hashWindow, miner, proven);
    acceptedCount += 1;
    const hashTx = hashCommitTx({
      to: miner,
      hashes: proven,
      height,
      jobId: current.jobId,
    });
    pendingHashTxs.push(hashTx);
    creditMiner(miner, hashTx.nanos);
    const workHash = gnfpWorkHash(current.input || current.preWork, nonce, '');
    const needBits = formBits();
    const blockHashMet = meetsTarget(workHash, needBits);
    if (!canFormBlock({ blockHashMet })) {
      return {
        accepted: true,
        asset: GNFP_BOOK.coin,
        block: { formed: false },
        hashTx,
      };
    }
    const settled = settleWindowCredits(hashWindow);
    for (const [who, nanos] of Object.entries(settled.potSplits || {})) {
      creditMiner(who, nanos);
    }
    hashWindow = settled.nextWindow;
    hashMarks.clear();
    const bonusTotalNanos = Object.values(settled.bonusNanos || {}).reduce(
      (s, n) => s + Math.max(0, Math.floor(Number(n) || 0)),
      0,
    );
    const nextHeight = height + 1;
    const hashTxs = bundleHashTxsForBlock(pendingHashTxs.splice(0, pendingHashTxs.length), nextHeight);
    const prev = blocks.length ? blocks[blocks.length - 1].hash : undefined;
    const sealed = sealBlock(
      {
        height: nextHeight,
        jobId: current.jobId,
        miner,
        amount: BLOCK_REWARD_GNFP + bonusTotalNanos / NANOS_PER_GNFP,
        blockRewardGnfp: BLOCK_REWARD_GNFP,
        hashBonusGnfp: HASH_BONUS_GNFP,
        creditsNanos: settled.totalsNanos,
        bonusNanos: settled.bonusNanos,
        potSplits: settled.potSplits,
        transactions: [
          ...hashTxs.map((t) => ({ ...t, confirmed: true, height: nextHeight })),
          {
            id: `block-${nextHeight}`,
            kind: 'mine',
            from: 'coinbase',
            to: 'miners',
            amount: BLOCK_REWARD_GNFP + bonusTotalNanos / NANOS_PER_GNFP,
            asset: GNFP_BOOK.coin,
          },
        ],
        difficulty: needBits,
        foundAt: Date.now(),
        from: 'coinbase',
        to: 'miners',
      },
      prev,
      blocks.length,
    );
    blocks.push(sealed);
    height = nextHeight;
    lastBlockBits = needBits;
    lastFormedAt = Date.now();
    nextJob();
    persist();
    for (const hook of shareHooks) {
      try { hook(sealed); } catch { /* announce is best-effort */ }
    }
    if (emit) {
      emit.blockFound(sealed);
      emit.tipHeight({ height, hash: sealed.hash });
    }
    return {
      accepted: true,
      asset: GNFP_BOOK.coin,
      block: { formed: true, height, hash: sealed.hash, ...sealed },
      sealed,
      hashTx,
    };
  }

  function adoptRemote(remote, incoming) {
    if (remote && Array.isArray(remote.blocks) && incoming == null) {
      const next = extractChain(remote);
      const nextHeight = next.length ? heightOf(next[next.length - 1]) : Number(remote.height || 0);
      const same = nextHeight === height && tipHashOf(next) === tipHashOf(blocks);
      blocks = next;
      height = nextHeight;
      if (!same) persist();
      nextJob();
      return { ok: true, tip: tip(), sameTip: same };
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
          miners: miners.size,
        },
      };
    }
    if ((path === '/api/sync' || path === '/gnfp/api/sync') && String(method).toUpperCase() === 'POST') {
      const payload = typeof body === 'string' ? JSON.parse(body || '{}') : (body || {});
      const got = adoptRemote(payload, payload.blocks);
      return { status: got.ok ? 200 : 409, json: { ...got, coin: GNFP_BOOK.coin } };
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
        try {
          const raw = Buffer.concat(chunks).toString('utf8');
          const hit = handleApi(req.url || '/', req.method || 'GET', raw);
          const buf = Buffer.from(JSON.stringify(hit.json));
          res.writeHead(hit.status, {
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': '*',
            'Content-Length': buf.length,
          });
          res.end(buf);
        } catch (err) {
          const buf = Buffer.from(JSON.stringify({
            ok: false,
            reason: 'bad_request',
            error: String(err?.message || err),
          }));
          res.writeHead(400, {
            'Content-Type': 'application/json',
            'Content-Length': buf.length,
          });
          res.end(buf);
        }
      });
    });
    server.on('error', (err) => {
      console.error(`gnfp-node http bind failed :${port} — ${err.code || err.message} (CLI keeps running)`);
    });
    return {
      listen: (cb) => server.listen(port, '0.0.0.0', cb),
      close: () => new Promise((r) => server.close(r)),
      address: () => server.address(),
      server,
    };
  }

  function listenStratum(port = 0, tlsOpts = null) {
    const onSock = (sock) => {
      miners.add(sock);
      let who = '';
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
            who = msg.login || msg.user || who;
            noteCpuThreads(who, msg.threads);
            send({ id: msg.id, result: true, description: 'Login Successful', coin: GNFP_BOOK.coin });
            send({ method: 'job', ...nextJob() });
            for (const hook of shareHooks) {
              try { hook(); } catch { /* solo announce */ }
            }
          } else if (method === 'submit') {
            who = msg.login || msg.user || who;
            noteCpuThreads(who, msg.threads);
            const got = submitShare({
              username: who,
              nonce: msg.nonce,
              jobId: msg.jobId || msg.id,
              client: msg.client,
              threads: msg.threads,
            });
            send({
              id: msg.id,
              result: got.accepted,
              description: got.accepted ? 'accepted' : (got.reason || 'rejected'),
              asset: GNFP_BOOK.coin,
            });
            if (got.accepted) send({ method: 'job', ... (job || nextJob()) });
          } else if (method === 'stats') {
            who = msg.login || msg.user || who;
            noteCpuThreads(who, msg.threads);
            ingestStats({
              username: who,
              hashes: msg.hashes,
            });
            send({ result: true, coin: GNFP_BOOK.coin });
          }
        }
      });
      sock.on('close', () => {
        miners.delete(sock);
        if (who) minerCpu.delete(who);
      });
      sock.on('error', () => {
        miners.delete(sock);
        if (who) minerCpu.delete(who);
      });
    };
    const server = tlsOpts ? tls.createServer(tlsOpts, onSock) : net.createServer(onSock);
    server.on('error', (err) => {
      console.error(`gnfp-node stratum bind failed :${port} — ${err.code || err.message} (CLI keeps running)`);
    });
    return {
      listen: (cb) => server.listen(port, '0.0.0.0', cb),
      close: () => new Promise((r) => server.close(r)),
      address: () => server.address(),
      server,
    };
  }

  function ingestStats({ username, hashes } = {}) {
    const who = String(username || '');
    const n = Number(hashes);
    if (who && Number.isFinite(n) && n >= 0) hashMarks.set(who, n);
    return { ok: true, window: { ...hashWindow } };
  }

  function hashWindowSnapshot() {
    return { ...hashWindow };
  }

  if (!job) nextJob();

  return {
    tip,
    nextJob,
    submitShare,
    ingestStats,
    hashWindowSnapshot,
    adoptRemote,
    handleApi,
    listenHttp,
    listenStratum,
    persist,
    blocks: () => blocks.slice(),
    height: () => height,
    minerCount: () => miners.size,
    cpuThreadCount,
    minerNanos: () => ({ ...minerNanos }),
    acceptedCount: () => acceptedCount,
    onShare: (fn) => {
      if (typeof fn === 'function') shareHooks.push(fn);
    },
  };
}

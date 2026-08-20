/**
 * Solo miners on a local join (or equal) node check in to the live book /
 * explorer so the explorer Solo table can list them. No extra node type.
 */
import fs from 'fs';
import os from 'os';
import path from 'path';
import { createHash, randomBytes } from 'crypto';

export const DEFAULT_SOLO_ANNOUNCE_URLS = Object.freeze([
  'https://explorer.restoreprivacy.online/api/nodes',
  'https://de.restoreprivacy.online:1474/api/nodes',
]);

export function soloHostId(seed = '') {
  const raw = String(seed || '').trim() || randomBytes(8).toString('hex');
  const hex = createHash('sha256').update(raw).digest('hex').slice(0, 8);
  return `solo-${hex}.node`;
}

export function loadOrCreateSoloHost(dataDir = '', env = process.env) {
  const forced = String(env.GNFP_ANNOUNCE_HOST || '').trim();
  if (forced) return forced.toLowerCase();
  const root = String(dataDir || '').trim();
  if (!root) return soloHostId(os.hostname());
  const file = path.join(root, 'solo-id.json');
  try {
    if (fs.existsSync(file)) {
      const got = JSON.parse(fs.readFileSync(file, 'utf8'));
      if (got && got.host) return String(got.host).toLowerCase();
    }
  } catch {
    /* rewrite */
  }
  const host = soloHostId(`${os.hostname()}:${root}`);
  try {
    fs.mkdirSync(root, { recursive: true });
    fs.writeFileSync(file, `${JSON.stringify({ host })}\n`);
  } catch {
    /* best-effort persist */
  }
  return host;
}

export function announceUrls(extra = '', env = process.env) {
  const out = [...DEFAULT_SOLO_ANNOUNCE_URLS];
  const more = String(extra || env.GNFP_ANNOUNCE_URL || '').trim();
  if (more && !out.includes(more)) out.unshift(more);
  return out;
}

export function sanitizeNodeVersion(raw) {
  const s = String(raw || '').trim();
  if (!s || s.length > 16) return '';
  if (!/^\d{1,3}(\.\d{1,3}){0,2}$/.test(s)) return '';
  return s;
}

const THREAD_HONESTY = new Set(['honest', 'inflate', 'underreport', 'unknown']);

function clampThreads(raw) {
  const n = Math.floor(Number(raw));
  if (!Number.isFinite(n) || n < 0) return 0;
  return Math.min(256, n);
}

export function buildSoloAnnounceBody({
  host,
  port = 1474,
  role = 'solo',
  version = '',
  hashrate = 0,
  threads = 0,
  accepted = 0,
  label = '',
  cpuCores = 0,
  cpuThreads = 0,
  threadHonesty = '',
} = {}) {
  const allowed = new Set(['join', 'pool', 'solo', 'front', 'book', 'exchange']);
  const r = allowed.has(String(role || '').toLowerCase()) ? String(role).toLowerCase() : 'join';
  const honesty = String(threadHonesty || '').toLowerCase();
  return {
    host: String(host || '').trim().toLowerCase(),
    port: Math.max(1, Math.min(65535, Math.floor(Number(port) || 1474))),
    role: r,
    version: sanitizeNodeVersion(version),
    hashrate: Math.max(0, Number(hashrate) || 0),
    threads: clampThreads(threads),
    accepted: Math.max(0, Math.floor(Number(accepted) || 0)),
    cpuCores: clampThreads(cpuCores),
    cpuThreads: clampThreads(cpuThreads),
    threadHonesty: THREAD_HONESTY.has(honesty) ? honesty : 'unknown',
    label: r === 'solo' ? 'solo' : String(label || r).slice(0, 40),
  };
}

export async function postSoloAnnounce(body, {
  urls = DEFAULT_SOLO_ANNOUNCE_URLS,
  fetchImpl = fetch,
} = {}) {
  const payload = buildSoloAnnounceBody(body);
  if (!payload.host) return [{ ok: false, reason: 'node_host_required' }];
  const list = Array.isArray(urls) && urls.length ? urls : DEFAULT_SOLO_ANNOUNCE_URLS;
  const results = [];
  for (const url of list) {
    try {
      const res = await fetchImpl(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const status = Number(res && res.status) || 0;
      results.push({ ok: status >= 200 && status < 300, url, status });
    } catch (err) {
      results.push({ ok: false, url, error: String(err?.message || err) });
    }
  }
  return results;
}

export function startSoloAnnounceLoop(getBody, opts = {}) {
  const every = Math.max(10_000, Number(opts.intervalMs) || 30_000);
  const urls = announceUrls(opts.announceUrl, opts.env);
  let stopped = false;
  const tick = async () => {
    if (stopped) return;
    const body = typeof getBody === 'function' ? getBody() : getBody;
    if (!body || !body.host) return;
    try {
      await postSoloAnnounce(body, { urls, fetchImpl: opts.fetchImpl });
    } catch {
      /* next beat */
    }
  };
  const timer = setInterval(tick, every);
  tick();
  return {
    tick,
    stop() {
      stopped = true;
      clearInterval(timer);
    },
  };
}

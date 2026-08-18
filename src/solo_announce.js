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

export function buildSoloAnnounceBody({
  host,
  port = 1474,
  hashrate = 0,
  threads = 0,
  accepted = 0,
} = {}) {
  return {
    host: String(host || '').trim().toLowerCase(),
    port: Math.max(1, Math.min(65535, Math.floor(Number(port) || 1474))),
    role: 'solo',
    hashrate: Math.max(0, Number(hashrate) || 0),
    threads: Math.max(0, Math.floor(Number(threads) || 0)),
    accepted: Math.max(0, Math.floor(Number(accepted) || 0)),
    label: 'solo',
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
    if (Number(body.threads || 0) <= 0 && Number(body.accepted || 0) <= 0) return;
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

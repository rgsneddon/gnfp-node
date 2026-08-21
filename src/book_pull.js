/**
 * Incremental book pull: tip identity + headers/blocks after a cursor.
 * Pure functions — no sockets. Used by the Germany book and by gnfp-node.
 */
import {
  adoptReplicaBook,
  extractChain,
  GNFP_BOOK,
  heightOf,
  tipHashOf,
} from './chronoflux_chain.js';
import { bookLawOnTip } from './book_law.js';

export const GNFP_COIN = 'GNFP';
export const DEFAULT_PULL_LIMIT = 256;
export const MAX_PULL_LIMIT = 1024;
export const CATCHUP_PULL_LIMIT = 512;

export function parsePullQuery(params = {}) {
  const get = (key) => {
    if (params && typeof params.get === 'function') return params.get(key);
    return params[key];
  };
  const rawHeight = get('afterHeight');
  const afterHeight = rawHeight == null || rawHeight === '' ? NaN : Number(rawHeight);
  const afterHash = String(get('afterHash') || '').trim();
  let limit = Number(get('limit'));
  if (!Number.isFinite(limit) || limit <= 0) limit = DEFAULT_PULL_LIMIT;
  limit = Math.min(MAX_PULL_LIMIT, Math.max(1, Math.floor(limit)));
  return {
    afterHeight: Number.isFinite(afterHeight) ? Math.floor(afterHeight) : -1,
    afterHash,
    limit,
  };
}

/** Blocks strictly after the cursor. afterHash wins when present and found. */
export function sliceAfter(blocks, query = {}) {
  const chain = Array.isArray(blocks) ? blocks : [];
  const afterHeight = Number(query.afterHeight);
  const afterHash = String(query.afterHash || '').trim();
  const limit = Math.min(
    MAX_PULL_LIMIT,
    Math.max(1, Math.floor(Number(query.limit) || DEFAULT_PULL_LIMIT)),
  );
  let start = 0;
  if (afterHash) {
    const i = chain.findIndex((b) => String(b?.hash || '') === afterHash);
    if (i >= 0) start = i + 1;
    else if (Number.isFinite(afterHeight) && afterHeight >= 0) {
      const j = chain.findIndex((b) => heightOf(b, -1) > afterHeight);
      start = j < 0 ? chain.length : j;
    }
  } else if (Number.isFinite(afterHeight) && afterHeight >= 0) {
    const j = chain.findIndex((b) => heightOf(b, -1) > afterHeight);
    start = j < 0 ? chain.length : j;
  }
  const slice = chain.slice(start, start + limit);
  return {
    blocks: slice,
    start,
    more: start + slice.length < chain.length,
  };
}

export function tipIdentity(book, extra = {}) {
  const chain = extractChain(book);
  const last = chain.length ? chain[chain.length - 1] : null;
  const h = last
    ? heightOf(last, 0)
    : Math.max(0, Math.floor(Number(book?.height ?? book?.tip ?? book?.tipHeight) || 0));
  const bits = extra.difficultyBits ?? last?.difficulty ?? book?.difficultyBits;
  return {
    ok: true,
    coin: extra.coin || book?.coin || GNFP_COIN,
    book: GNFP_BOOK.id,
    height: h,
    tip: h,
    tipHeight: h,
    tipHash: last ? String(last.hash || tipHashOf(chain)) : String(book?.tipHash || ''),
    previousHash: last ? String(last.previousHash || '') : String(book?.previousHash || ''),
    verifyBeforeAdopt: true,
    emissionBook: extra.emissionBook === true,
    ...bookLawOnTip({
      bits,
      hashrate: extra.hashrate ?? book?.hashrate,
    }),
  };
}

export function headerRow(block, index = 0) {
  return {
    height: heightOf(block, index),
    hash: String(block?.hash || ''),
    previousHash: String(block?.previousHash || ''),
  };
}

export function pullPayload(blocks, query = {}, extra = {}) {
  const sliced = sliceAfter(blocks, query);
  const tip = tipIdentity({ ...(extra.tip || {}), blocks }, extra);
  return {
    ...tip,
    count: sliced.blocks.length,
    more: sliced.more,
    blocks: sliced.blocks,
    headers: sliced.blocks.map((b, i) => headerRow(b, i)),
  };
}

/**
 * Apply a remote tip + incremental blocks onto local via verify-before-adopt.
 * Empty incoming with a competing same-height tipHash keeps first-seen local.
 * If incoming does not link from the local tip (competing suffix), try it as
 * its own sealed chain so most-work can reorg.
 */
export function applyIncremental(local, remoteTip, incomingBlocks) {
  const incoming = Array.isArray(incomingBlocks) ? incomingBlocks : [];
  const localChain = extractChain(local);
  const base = local && typeof local === 'object' ? local : {};
  const tip = remoteTip && typeof remoteTip === 'object' ? remoteTip : {};
  if (!incoming.length) {
    return adoptReplicaBook(base, { ...tip });
  }
  const concatenated = localChain.concat(incoming);
  const asExt = adoptReplicaBook(base, { ...tip, blocks: concatenated });
  if (asExt.ok && !asExt.firstSeen) return asExt;
  const asOwn = adoptReplicaBook(base, { ...tip, blocks: incoming });
  if (asOwn.ok) return asOwn;
  return asExt.ok ? asExt : asOwn;
}

export function wantsIncrementalPull(params = {}) {
  const q = parsePullQuery(params);
  return q.afterHeight >= 0 || Boolean(q.afterHash) || String(
    (params && typeof params.get === 'function' ? params.get('incremental') : params.incremental) || '',
  ) === '1';
}

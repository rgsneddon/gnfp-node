/**
 * Persist adopted tip + sealed blocks. Restart resumes the last tip, not 0.
 * blocks.jsonl.gz is append-only gzip members so a long book is not rewritten
 * every poll and stays smaller than a naive JSON array dump.
 */
import fs from 'fs';
import os from 'os';
import path from 'path';
import zlib from 'zlib';
import { extractChain, heightOf, tipHashOf } from './chronoflux_chain.js';
import { GNFP_COIN, tipIdentity } from './book_pull.js';

export function defaultDataDir(env = process.env) {
  return String(env.GNFP_NODE_DATA || '').trim() || path.join(os.homedir(), '.gnfp-node');
}

export function tipPath(dir) {
  return path.join(dir, 'tip.json');
}

export function blocksPath(dir) {
  return path.join(dir, 'blocks.jsonl');
}

export function blocksGzPath(dir) {
  return path.join(dir, 'blocks.jsonl.gz');
}

function parseJsonl(text) {
  const blocks = [];
  for (const line of String(text || '').split('\n')) {
    const row = line.trim();
    if (!row) continue;
    try {
      const block = JSON.parse(row);
      if (block && typeof block === 'object') blocks.push(block);
    } catch {
      /* skip a bad line */
    }
  }
  return blocks;
}

function gzipJsonl(blocks) {
  if (!Array.isArray(blocks) || !blocks.length) return Buffer.alloc(0);
  const body = `${blocks.map((b) => JSON.stringify(b)).join('\n')}\n`;
  return zlib.gzipSync(body, { level: 9 });
}

function readTipMeta(dir) {
  const tPath = tipPath(dir);
  if (!fs.existsSync(tPath)) return {};
  try {
    return JSON.parse(fs.readFileSync(tPath, 'utf8')) || {};
  } catch {
    return {};
  }
}

/** Count already on disk from tip.json — do not reread the whole book. */
export function storedCount(dir) {
  const tip = readTipMeta(dir);
  const n = Number(tip.count);
  if (Number.isFinite(n) && n >= 0) return Math.floor(n);
  return 0;
}

export function storeOnDiskBytes(dir) {
  let n = 0;
  for (const p of [tipPath(dir), blocksGzPath(dir), blocksPath(dir)]) {
    try {
      if (fs.existsSync(p)) n += fs.statSync(p).size;
    } catch {
      /* missing */
    }
  }
  return n;
}

export function naiveFullArrayBytes(blocks) {
  return Buffer.byteLength(JSON.stringify(Array.isArray(blocks) ? blocks : []));
}

let lastSaveMeta = null;
export function getLastSaveMeta() {
  return lastSaveMeta;
}

export function loadNodeStore(dir) {
  const root = String(dir || '');
  if (!root) return { book: null, dir: root };
  const gzPath = blocksGzPath(root);
  const bPath = blocksPath(root);
  let blocks = [];
  if (fs.existsSync(gzPath) && fs.statSync(gzPath).size > 0) {
    try {
      blocks = parseJsonl(zlib.gunzipSync(fs.readFileSync(gzPath)).toString('utf8'));
    } catch {
      blocks = [];
    }
  } else if (fs.existsSync(bPath)) {
    blocks = parseJsonl(fs.readFileSync(bPath, 'utf8'));
  }
  const tip = readTipMeta(root);
  if (!blocks.length && !tip.height && !tip.tip) {
    return { book: null, dir: root };
  }
  const ident = tipIdentity({ ...tip, blocks });
  return {
    dir: root,
    book: {
      ...tip,
      ...ident,
      coin: tip.coin || GNFP_COIN,
      blocks,
    },
  };
}

export function saveNodeStore(dir, book) {
  const root = String(dir || '');
  if (!root || !book || typeof book !== 'object') return null;
  fs.mkdirSync(root, { recursive: true });
  const chain = extractChain(book);
  const ident = tipIdentity({ ...book, blocks: chain });
  const known = storedCount(root);
  const gzPath = blocksGzPath(root);
  let mode = 'tip-only';
  if (known === 0 || !fs.existsSync(gzPath)) {
    const packed = gzipJsonl(chain);
    const tmp = `${gzPath}.tmp`;
    fs.writeFileSync(tmp, packed);
    fs.renameSync(tmp, gzPath);
    mode = 'full';
  } else if (chain.length > known) {
    const extra = gzipJsonl(chain.slice(known));
    if (extra.length) fs.appendFileSync(gzPath, extra);
    mode = 'append';
  }
  const small = {
    coin: book.coin || GNFP_COIN,
    height: ident.height,
    tip: ident.tip,
    tipHeight: ident.tipHeight,
    tipHash: ident.tipHash,
    previousHash: ident.previousHash,
    count: chain.length,
    verifyBeforeAdopt: true,
    emissionBook: false,
    compressed: true,
  };
  const tmp = `${tipPath(root)}.tmp`;
  fs.writeFileSync(tmp, `${JSON.stringify(small)}\n`);
  fs.renameSync(tmp, tipPath(root));
  lastSaveMeta = {
    mode,
    known,
    next: chain.length,
    bytes: storeOnDiskBytes(root),
  };
  return {
    ...small,
    blocks: chain.length,
    lastHeight: heightOf(chain.at(-1) || {}, 0),
    lastHash: tipHashOf(chain),
    save: lastSaveMeta,
  };
}

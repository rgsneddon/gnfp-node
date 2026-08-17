/**
 * Persist adopted tip + sealed blocks. Restart resumes the last tip, not 0.
 * blocks.jsonl is append-only so a long book is not rewritten every poll.
 */
import fs from 'fs';
import os from 'os';
import path from 'path';
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

export function loadNodeStore(dir) {
  const root = String(dir || '');
  if (!root) return { book: null, dir: root };
  const tPath = tipPath(root);
  const bPath = blocksPath(root);
  const blocks = [];
  if (fs.existsSync(bPath)) {
    const text = fs.readFileSync(bPath, 'utf8');
    for (const line of text.split('\n')) {
      const row = line.trim();
      if (!row) continue;
      try {
        const block = JSON.parse(row);
        if (block && typeof block === 'object') blocks.push(block);
      } catch {
        /* skip a bad line */
      }
    }
  }
  let tip = {};
  if (fs.existsSync(tPath)) {
    try {
      tip = JSON.parse(fs.readFileSync(tPath, 'utf8')) || {};
    } catch {
      tip = {};
    }
  }
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
  const small = {
    coin: book.coin || GNFP_COIN,
    height: ident.height,
    tip: ident.tip,
    tipHeight: ident.tipHeight,
    tipHash: ident.tipHash,
    previousHash: ident.previousHash,
    verifyBeforeAdopt: true,
    emissionBook: false,
  };
  const tmp = `${tipPath(root)}.tmp`;
  fs.writeFileSync(tmp, `${JSON.stringify(small)}\n`);
  fs.renameSync(tmp, tipPath(root));

  const bPath = blocksPath(root);
  let known = 0;
  if (fs.existsSync(bPath)) {
    const existing = loadNodeStore(root).book;
    known = extractChain(existing).length;
  }
  if (known === 0) {
    const out = chain.map((b) => JSON.stringify(b)).join('\n');
    const btmp = `${bPath}.tmp`;
    fs.writeFileSync(btmp, out ? `${out}\n` : '');
    fs.renameSync(btmp, bPath);
  } else if (chain.length > known) {
    const extra = chain.slice(known).map((b) => JSON.stringify(b)).join('\n');
    fs.appendFileSync(bPath, extra ? `${extra}\n` : '');
  }
  return { ...small, blocks: chain.length, lastHeight: heightOf(chain.at(-1) || {}, 0), lastHash: tipHashOf(chain) };
}

/**
 * Append-only hash-linked Chronoflux chain.
 * Pure functions: no disk, no sockets.
 *
 * An existing unlinked tip is sealed once from its current rows. Sealing
 * never changes miner, amount, height, or any spendable field — it only
 * adds previousHash + hash so later rewrites can be rejected.
 */
import { createHash } from 'crypto';

export const GENESIS_PREV = '0'.repeat(64);
export const CONFIRMATION_MS = 72_000;

/** Immutable emission book. Not an env, flag, or operator catalog entry. */
export const GNFP_BOOK = Object.freeze({
  coin: 'GNFP',
  id: 'gnfp-germany-book-v1',
  host: 'de.restoreprivacy.online',
  port: 1474,
  stratum: 'de.restoreprivacy.online:1474',
});

export function isCanonicalBook(value) {
  const id = typeof value === 'string'
    ? value
    : (value && typeof value === 'object' ? (value.book || value.bookId || value.id) : '');
  return String(id || '') === GNFP_BOOK.id;
}

export function heightOf(block, fallback = 0) {
  if (!block || typeof block !== 'object') return fallback;
  const n = Number(block.height ?? block.index);
  return Number.isFinite(n) ? n : fallback;
}

export function canonicalBlockPayload(block) {
  const height = heightOf(block, 0);
  const previousHash = String(block?.previousHash || GENESIS_PREV);
  const body = {
    amount: block?.amount ?? block?.treasuryEmitted ?? null,
    book: GNFP_BOOK.id,
    coin: GNFP_BOOK.coin,
    foundAt: block?.foundAt ?? null,
    from: block?.from ?? null,
    height,
    jobId: block?.jobId ?? null,
    miner: block?.miner ?? null,
    previousHash,
    scenarioLabel: block?.scenarioLabel ?? null,
    timestamp: block?.timestamp ?? null,
    to: block?.to ?? null,
    transactions: block?.transactions ?? block?.txs ?? [],
    triggerUsername: block?.triggerUsername ?? null,
  };
  // Only present on seals that recorded book law. Omit on older blocks so
  // their stored hash still matches.
  if (block?.difficulty != null && block.difficulty !== '') {
    body.difficulty = Number(block.difficulty);
  }
  if (block?.blockRewardGnfp != null && block.blockRewardGnfp !== '') {
    body.blockRewardGnfp = Number(block.blockRewardGnfp);
  }
  return JSON.stringify(body);
}

export function hashBlock(block) {
  return createHash('sha256').update(canonicalBlockPayload(block)).digest('hex');
}

/** Pre-book-id seals from the live Germany cutover. */
export function legacyCanonicalPayload(block) {
  const height = heightOf(block, 0);
  const previousHash = String(block?.previousHash || GENESIS_PREV);
  return JSON.stringify({
    amount: block?.amount ?? block?.treasuryEmitted ?? null,
    foundAt: block?.foundAt ?? null,
    from: block?.from ?? null,
    height,
    jobId: block?.jobId ?? null,
    miner: block?.miner ?? null,
    previousHash,
    scenarioLabel: block?.scenarioLabel ?? null,
    timestamp: block?.timestamp ?? null,
    to: block?.to ?? null,
    transactions: block?.transactions ?? block?.txs ?? [],
    triggerUsername: block?.triggerUsername ?? null,
  });
}

export function hashBlockLegacy(block) {
  return createHash('sha256').update(legacyCanonicalPayload(block)).digest('hex');
}

export function hashMatches(block) {
  const got = String(block?.hash || '');
  if (!got) return false;
  return got === hashBlock(block) || got === hashBlockLegacy(block);
}

export function isSealedBlock(block) {
  return Boolean(
    block
    && typeof block === 'object'
    && block.hash
    && block.previousHash
    && String(block.hash).length === 64,
  );
}

export function isBlockConfirmed(block, now = Date.now()) {
  const found = Number(block?.foundAt ?? block?.timestamp ?? 0);
  if (!Number.isFinite(found) || found <= 0) return false;
  return Number(now) - found >= CONFIRMATION_MS;
}

/** A found, sealed block is held forever. Confirmation does not rewrite it. */
export function isImmutableHold(block) {
  return isSealedBlock(block) && String(block.book || '') === GNFP_BOOK.id;
}

export function rejectRewrite(held, candidate) {
  if (!isImmutableHold(held)) return { ok: true };
  if (!candidate || typeof candidate !== 'object') {
    return { ok: false, reason: 'immutable' };
  }
  if (String(held.hash) !== String(candidate.hash || '')) {
    return { ok: false, reason: 'immutable' };
  }
  if (!hashMatches({ ...candidate, hash: held.hash }) || hashBlock(candidate) !== String(held.hash)) {
    if (hashBlock(candidate) !== String(held.hash) && hashBlockLegacy(candidate) !== String(held.hash)) {
      return { ok: false, reason: 'immutable' };
    }
  }
  return { ok: true };
}

export function sealBlock(block, previousHash = GENESIS_PREV, index = 0) {
  const height = heightOf(block, index);
  const sealed = {
    ...block,
    book: GNFP_BOOK.id,
    coin: GNFP_BOOK.coin,
    height,
    index: block?.index ?? height,
    previousHash: String(previousHash || GENESIS_PREV),
  };
  sealed.hash = hashBlock(sealed);
  return sealed;
}

/**
 * One-time seal of current history. Does not alter spendable fields.
 * Already-valid linked chains are returned as copies, not rehashed.
 */
export function ensureSealedChain(blocks) {
  if (!Array.isArray(blocks) || !blocks.length) return [];
  if (blocks.every(isSealedBlock) && verifyChain(blocks).ok) {
    return blocks.map((b) => ({ ...b }));
  }
  let prev = GENESIS_PREV;
  return blocks.map((block, i) => {
    const sealed = sealBlock(block, prev, i);
    prev = sealed.hash;
    return sealed;
  });
}

export function verifyChain(blocks) {
  if (!Array.isArray(blocks)) return { ok: false, reason: 'not_a_chain' };
  if (!blocks.length) return { ok: true, reason: 'empty' };
  let prev = GENESIS_PREV;
  let lastHeight = -Infinity;
  for (let i = 0; i < blocks.length; i += 1) {
    const block = blocks[i];
    if (!block || typeof block !== 'object') {
      return { ok: false, reason: 'bad_block', index: i };
    }
    if (block.book && String(block.book) !== GNFP_BOOK.id) {
      return { ok: false, reason: 'foreign_book', index: i };
    }
    const previousHash = String(block.previousHash || '');
    if (previousHash !== prev) {
      return { ok: false, reason: 'broken_link', index: i };
    }
    if (!hashMatches(block)) {
      return { ok: false, reason: 'hash_mismatch', index: i };
    }
    const h = heightOf(block, i);
    if (h <= lastHeight) {
      return { ok: false, reason: 'height_not_increasing', index: i };
    }
    lastHeight = h;
    prev = block.hash;
  }
  return { ok: true, reason: 'valid', length: blocks.length, tipHash: prev };
}

export function tipHashOf(blocks) {
  if (!Array.isArray(blocks) || !blocks.length) return GENESIS_PREV;
  return String(blocks[blocks.length - 1].hash || GENESIS_PREV);
}

export function sameSealedTip(localBlocks, remoteBlocks) {
  if (!localBlocks?.length || !remoteBlocks?.length) return false;
  if (localBlocks.length !== remoteBlocks.length) return false;
  return tipHashOf(localBlocks) === tipHashOf(remoteBlocks);
}

/**
 * Accept only a valid hash-linked extension of local.
 * Same-height conflicting tip, rewritten sealed prefix, or shorter book → reject.
 */
export function shouldAdoptRemote(localBlocks, remoteBlocks) {
  const remote = Array.isArray(remoteBlocks) ? remoteBlocks : [];
  const local = Array.isArray(localBlocks) ? localBlocks : [];
  const remoteCheck = verifyChain(remote);
  if (!remoteCheck.ok) return false;
  if (!local.length) return remoteCheck.ok;
  const localCheck = verifyChain(local);
  if (!localCheck.ok) return false;
  if (remote.length <= local.length) return false;
  for (let i = 0; i < local.length; i += 1) {
    if (String(local[i].hash) !== String(remote[i].hash)) return false;
    if (heightOf(local[i], i) !== heightOf(remote[i], i)) return false;
  }
  return true;
}

export function extractChain(book) {
  if (!book) return [];
  if (Array.isArray(book)) return book;
  if (Array.isArray(book.blocks)) return book.blocks;
  if (Array.isArray(book.chain)) return book.chain;
  return [];
}

/**
 * Join/pool adopt. A taller book is taken only when it is a verifyChain-valid
 * hash-linked extension (shouldAdoptRemote). A first book is taken only when
 * it seals into a valid chain. Stats-only payloads may refresh the same tip
 * while keeping the local sealed blocks. A previousHash + height with no
 * blocks is not an extension.
 */
function sealedRemoteOrReject(remoteChain) {
  if (!remoteChain.length) return { ok: true, blocks: [] };
  if (!remoteChain.every(isSealedBlock)) {
    return { ok: false, reason: 'unsealed_remote' };
  }
  const check = verifyChain(remoteChain);
  if (!check.ok) return { ok: false, reason: check.reason || 'invalid_chain' };
  return { ok: true, blocks: remoteChain.map((b) => ({ ...b })) };
}

export function adoptReplicaBook(local, remote) {
  if (!remote || typeof remote !== 'object' || Array.isArray(remote)) {
    return { ok: false, reason: 'bad_book' };
  }
  if (remote.book && !isCanonicalBook(remote)) {
    return { ok: false, reason: 'foreign_book' };
  }
  if (remote.coin && String(remote.coin) !== GNFP_BOOK.coin) {
    return { ok: false, reason: 'foreign_book' };
  }
  const remoteChain = extractChain(remote);
  const localChain = extractChain(local);
  const remoteGot = sealedRemoteOrReject(remoteChain);
  if (!remoteGot.ok) return remoteGot;
  const remoteSealed = remoteGot.blocks;
  const localSealed = localChain.length && localChain.every(isSealedBlock)
    ? localChain.map((b) => ({ ...b }))
    : (localChain.length ? ensureSealedChain(localChain) : []);

  if (remoteSealed.length) {
    const check = verifyChain(remoteSealed);
    if (!check.ok) return { ok: false, reason: check.reason || 'invalid_chain' };
    if (!localSealed.length) {
      return { ok: true, book: { ...remote, blocks: remoteSealed }, sealed: true };
    }
    if (shouldAdoptRemote(localSealed, remoteSealed)) {
      return { ok: true, book: { ...remote, blocks: remoteSealed }, extended: true };
    }
    if (sameSealedTip(localSealed, remoteSealed)) {
      return {
        ok: true,
        book: { ...remote, blocks: localSealed },
        sameTip: true,
      };
    }
    return { ok: false, reason: 'not_a_valid_extension' };
  }

  if (!localSealed.length) {
    return { ok: false, reason: 'not_a_chain' };
  }

  const localHeight = Number(
    local?.height ?? local?.tip ?? heightOf(localSealed.at(-1)),
  );
  const remoteHeight = Number(remote.height ?? remote.tip ?? remote.tipHeight);
  const localTipHash = String(local?.tipHash || tipHashOf(localSealed));
  const remoteTipHash = remote.tipHash != null ? String(remote.tipHash) : '';

  if (!Number.isFinite(remoteHeight) || remoteHeight === localHeight) {
    if (
      Number.isFinite(remoteHeight)
      && remoteHeight === localHeight
      && remoteTipHash
      && localTipHash
      && remoteTipHash !== localTipHash
    ) {
      return { ok: false, reason: 'same_height_fork' };
    }
    return { ok: true, book: { ...remote, blocks: localSealed }, sameTip: true };
  }
  if (remoteHeight < localHeight) return { ok: false, reason: 'rollback' };
  return { ok: false, reason: 'not_a_valid_extension' };
}

export function isConflictingRewrite(local, remote) {
  if (!remote || typeof remote !== 'object') return false;
  const remoteChain = extractChain(remote);
  if (!remoteChain.length) {
    const adopted = adoptReplicaBook(local, remote);
    return !adopted.ok;
  }
  const remoteSealed = ensureSealedChain(remoteChain);
  if (!verifyChain(remoteSealed).ok) return true;
  const localSealed = ensureSealedChain(extractChain(local));
  if (!localSealed.length) return false;
  if (remoteSealed.length > localSealed.length) {
    return !shouldAdoptRemote(localSealed, remoteSealed);
  }
  if (remoteSealed.length === localSealed.length) {
    return tipHashOf(remoteSealed) !== tipHashOf(localSealed);
  }
  return false;
}

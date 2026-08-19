/**
 * Public GNFP node catalog, miner CLI builder, and network difficulty.
 * One pool book on Germany. Default stratum is de.restoreprivacy.online:1474.
 * Helsinki mining front is hel.restoreprivacy.online:1474 (not god).
 */

export const GNFP_TICKER = 'GNFP';
export const DEFAULT_GNFP_NODE_ID = 'germany';

export const GNFP_NODES = Object.freeze([
  Object.freeze({
    id: 'germany',
    label: 'Germany (node)',
    host: 'de.restoreprivacy.online',
    port: 1474,
    stratum: 'de.restoreprivacy.online:1474',
    role: 'book',
  }),
  Object.freeze({
    id: 'singapore',
    label: 'Singapore (join)',
    host: 'sg.restoreprivacy.online',
    port: 1474,
    stratum: 'sg.restoreprivacy.online:1474',
    role: 'join',
  }),
  Object.freeze({
    id: 'helsinki',
    label: 'Helsinki (front)',
    host: 'hel.restoreprivacy.online',
    port: 1474,
    stratum: 'hel.restoreprivacy.online:1474',
    role: 'front',
  }),
]);

export function listGnfpNodes() {
  return GNFP_NODES.map((n) => ({ ...n }));
}

export function gnfpNodeById(id) {
  const key = String(id || '').trim().toLowerCase();
  return GNFP_NODES.find((n) => n.id === key) || null;
}

export function isGnfpPayoutAddress(value) {
  return /^gnfp1[0-9a-z]{20,80}$/i.test(String(value || '').trim());
}

/** Viable gnfp-mine line for an address + node. Empty/invalid address emits nothing runnable. */
export function buildMinerCommand({ address, nodeId, threads = 4 } = {}) {
  const addr = String(address || '').trim();
  if (!isGnfpPayoutAddress(addr)) {
    return { ok: false, reason: 'gnfp_address_required', command: '' };
  }
  const requested = String(nodeId || DEFAULT_GNFP_NODE_ID).trim().toLowerCase();
  const node = gnfpNodeById(requested === 'hel' || requested === 'god' ? 'helsinki' : requested);
  if (!node) {
    return { ok: false, reason: 'node_required', command: '' };
  }
  const n = Math.max(1, Math.min(256, Math.floor(Number(threads) || 4)));
  const user = `${addr}.worker`;
  const command = `gnfp-mine --pool ${node.stratum} --user ${user} --threads ${n}`;
  return {
    ok: true,
    command,
    pool: node.stratum,
    user,
    node: { id: node.id, host: node.host, port: node.port, stratum: node.stratum },
  };
}

export {
  networkDifficulty,
  blockBitsFromHashrate,
  targetBlockIntervalMs,
  bookLawOnTip,
} from './book_law.js';

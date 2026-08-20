/**
 * Same height-indexed reconstruct as the book. Node uses this so a
 * tip-synced replica can rebuild an owner's spendable from sealed block
 * txs + gnfp1 + shear at that height's epoch.
 */
import { createHmac } from 'crypto';

export const GENESIS_EPOCH = '0'.repeat(64);
export const SHEAR_PREFIX = 'shear-';

export function shearAtEpoch(identity, epochHash, env = process.env) {
  const raw = String(identity || '').trim();
  if (!raw || raw === 'external') return 'external';
  if (raw.startsWith('coinbase')) return 'coinbase';
  if (raw.startsWith('miners')) return 'miners';
  const salt = String(env?.GNFP_PRIVACY_SALT || '').trim();
  if (!salt) {
    return `${SHEAR_PREFIX}${createHmac('sha256', 'gnfp-node-local')
      .update(`shear:v1:${raw}:${epochHash || GENESIS_EPOCH}`)
      .digest('hex')
      .slice(0, 8)}`;
  }
  const tip = String(epochHash || GENESIS_EPOCH);
  const digest = createHmac('sha256', salt).update(`shear:v1:${raw}:${tip}`).digest('hex');
  return `${SHEAR_PREFIX}${digest.slice(0, 8)}`;
}

export function stampLedgerTx(tx, { height = 0, epochHash = GENESIS_EPOCH, env } = {}) {
  const row = tx && typeof tx === 'object' ? { ...tx } : {};
  const h = Number(row.height);
  row.height = Number.isFinite(h) && h > 0 ? h : Math.max(0, Number(height) || 0);
  row.epochHash = String(row.epochHash || row.previousHash || epochHash || GENESIS_EPOCH);
  row.amount = Number(row.amount) || 0;
  row.from = String(row.from || '');
  row.to = String(row.to || '');
  row.kind = String(row.kind || '');
  row.id = String(row.id || `${row.kind}:${row.height}:${row.to}:${row.amount}`);
  row.shearFrom = row.shearFrom || shearAtEpoch(row.from, row.epochHash, env);
  row.shearTo = row.shearTo || shearAtEpoch(row.to, row.epochHash, env);
  return row;
}

export function ownsLedgerTx(tx, { address, shear, env } = {}) {
  const addr = String(address || '').trim();
  if (!addr || !tx) return false;
  const from = String(tx.from || '');
  const to = String(tx.to || '');
  if (from !== addr && to !== addr) return false;
  const epoch = String(tx.epochHash || tx.previousHash || GENESIS_EPOCH);
  const expected = shearAtEpoch(addr, epoch, env);
  const stored = from === addr ? String(tx.shearFrom || '') : String(tx.shearTo || '');
  const want = String(shear || '').trim();
  if (want) {
    const hit = stored === want
      || expected === want
      || String(tx.shearFrom || '') === want
      || String(tx.shearTo || '') === want;
    if (!hit) return false;
  }
  if (stored && expected) return stored === expected;
  return true;
}

export function reconstructSpendable(txs, { address, shear, env } = {}) {
  const addr = String(address || '').trim();
  if (!addr) return 0;
  const rows = [...(txs || [])].sort((a, b) => {
    const d = (Number(a?.height) || 0) - (Number(b?.height) || 0);
    if (d) return d;
    return String(a?.id || '').localeCompare(String(b?.id || ''));
  });
  let bal = 0;
  for (const tx of rows) {
    if (!ownsLedgerTx(tx, { address: addr, shear, env })) continue;
    const amt = Number(tx.amount) || 0;
    if (String(tx.to || '') === addr) bal += amt;
    if (String(tx.from || '') === addr) bal -= amt;
  }
  return bal;
}

export function txsFromSealedBlocks(blocks = []) {
  const out = [];
  for (const block of blocks || []) {
    const height = Number(block?.height) || 0;
    const epoch = String(block?.hash || block?.tipHash || block?.previousHash || GENESIS_EPOCH);
    const rows = block?.transactions || block?.txs || [];
    if (Array.isArray(rows) && rows.length) {
      for (const tx of rows) {
        out.push(stampLedgerTx({ ...tx, height: tx.height ?? height }, { height, epochHash: epoch }));
      }
      continue;
    }
    const miner = String(block?.miner || '');
    const amount = Number(block?.amount);
    if (miner && Number.isFinite(amount) && amount > 0) {
      out.push(stampLedgerTx({
        id: `block:${height}:${miner}`,
        from: 'coinbase',
        to: miner,
        amount,
        kind: 'mine',
        height,
      }, { height, epochHash: epoch }));
    }
  }
  return out;
}

/**
 * Same 1.0.4 floor as the Germany pool. GNFPHash name alone is not enough.
 */
export const MIN_MINE_VERSION = '1.0.4';
export const REQUIRED_MINE_CLIENT = 'GNFPHash';

export function parseMineVersion(raw) {
  const m = String(raw || '').trim().match(/^(\d+)\.(\d+)\.(\d+)/);
  if (!m) return null;
  return [Number(m[1]), Number(m[2]), Number(m[3])];
}

export function mineVersionAtLeast(raw, min = MIN_MINE_VERSION) {
  const a = parseMineVersion(raw);
  const b = parseMineVersion(min);
  if (!a || !b) return false;
  for (let i = 0; i < 3; i += 1) {
    if (a[i] > b[i]) return true;
    if (a[i] < b[i]) return false;
  }
  return true;
}

export function shouldAdmitMiner({ version, client } = {}) {
  const name = String(client || '').trim();
  if (name && name !== REQUIRED_MINE_CLIENT) {
    return { ok: false, reason: 'old_miner_refused' };
  }
  if (name !== REQUIRED_MINE_CLIENT) {
    return { ok: false, reason: 'miner_update_required' };
  }
  if (!mineVersionAtLeast(version, MIN_MINE_VERSION)) {
    return { ok: false, reason: 'miner_update_required' };
  }
  return { ok: true };
}

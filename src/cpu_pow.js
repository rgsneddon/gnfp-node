/** Same gnfp-cpu-v1 work hash the book and gnfp-mine use. */
import { createHash } from 'crypto';

export const CPU_HASH_ROUNDS = 8;
export const CPU_HASH_PERSONAL = 'gnfp-cpu-v1';

export function gnfpWorkHash(preWork, nonce, solution = '') {
  const pre = String(preWork || '');
  const n = String(nonce || '');
  const sol = String(solution || '');
  let acc = createHash('sha256')
    .update(CPU_HASH_PERSONAL, 'utf8')
    .update(pre, 'utf8')
    .update(n, 'utf8')
    .update(sol, 'utf8')
    .digest();
  for (let i = 0; i < CPU_HASH_ROUNDS; i += 1) {
    acc = createHash('sha256')
      .update(acc)
      .update(String(i))
      .update(pre, 'utf8')
      .update(n, 'utf8')
      .digest();
  }
  return acc.toString('hex');
}

export function meetsTarget(hash, bits) {
  const n = Math.max(0, Math.min(256, Number(bits) || 0));
  if (n === 0) return true;
  const hex = String(hash || '');
  const full = Math.floor(n / 4);
  const rem = n % 4;
  if (hex.length < full + (rem ? 1 : 0)) return false;
  if (full && hex.slice(0, full) !== '0'.repeat(full)) return false;
  if (!rem) return true;
  return parseInt(hex[full] || 'f', 16) < (1 << (4 - rem));
}

export function hashMeetsJob(job, nonce, solution = '') {
  const pre = String(job?.input || job?.preWork || '');
  const bits = Math.max(1, Math.floor(Number(job?.difficulty) || 1));
  return meetsTarget(gnfpWorkHash(pre, nonce, solution), bits);
}

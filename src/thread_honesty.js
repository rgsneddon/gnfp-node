/**
 * Honest thread counts. Device-generic: claimed utilised workers must
 * not exceed deviceCap (cpuThreads if the miner sent it, else cpuCores).
 * 6-core / 12-thread with 10 running is one example, not a global cap.
 */
export const THREAD_HONEST = 'honest';
export const THREAD_INFLATE = 'inflate';
export const THREAD_UNDERREPORT = 'underreport';
export const THREAD_UNKNOWN = 'unknown';
export const MIN_ACCEPTS_TO_JUDGE = 3;
export const THREAD_LIE_FACTOR = 3;
export const THREAD_LIE_DELTA = 4;

export function inferThreadCount({ hashrate, oneThreadHs } = {}) {
  const hs = Math.max(0, Number(hashrate) || 0);
  const one = Number(oneThreadHs);
  if (hs <= 0 || !Number.isFinite(one) || one <= 0) return 0;
  return Math.max(1, Math.round(hs / one));
}

function result({ honest, verdict, claimed, inferred, cpuCores, cpuThreads, reason }) {
  return { honest, verdict, claimed, inferred, cpuCores, cpuThreads, reason };
}

/**
 * Honesty is claimed utilised threads vs the device, not a hardcoded
 * 6/10/12. Work-based inflate only fires when the miner claims more
 * workers than the device, or (old miners with no inventory) far more
 * workers than proven H/s.
 */
export function assessThreadHonesty({
  claimed,
  cpuCores,
  cpuThreads,
  hashrate,
  accepts,
  oneThreadHs,
  oneThreadMinHs,
} = {}) {
  const claim = Math.max(0, Math.floor(Number(claimed) || 0));
  const cores = Math.max(0, Math.floor(Number(cpuCores) || 0));
  const logical = Math.max(0, Math.floor(Number(cpuThreads) || 0));
  const deviceCap = logical > 0 ? logical : cores;
  const hits = Math.max(0, Math.floor(Number(accepts) || 0));
  const slow = Number(oneThreadMinHs ?? oneThreadHs);
  const inferred = inferThreadCount({ hashrate, oneThreadHs: slow });

  if (claim <= 0) {
    return result({
      honest: false,
      verdict: THREAD_UNDERREPORT,
      claimed: claim,
      inferred,
      cpuCores: cores,
      cpuThreads: logical,
      reason: 'threads_hidden',
    });
  }

  if (deviceCap > 0 && claim <= deviceCap) {
    if (
      hits >= MIN_ACCEPTS_TO_JUDGE
      && inferred >= claim * THREAD_LIE_FACTOR
      && inferred - claim >= THREAD_LIE_DELTA
    ) {
      return result({
        honest: false,
        verdict: THREAD_UNDERREPORT,
        claimed: claim,
        inferred,
        cpuCores: cores,
        cpuThreads: logical,
        reason: 'claimed_threads_below_work',
      });
    }
    return result({
      honest: true,
      verdict: hits < MIN_ACCEPTS_TO_JUDGE ? THREAD_UNKNOWN : THREAD_HONEST,
      claimed: claim,
      inferred: inferred || claim,
      cpuCores: cores,
      cpuThreads: logical,
      reason: hits < MIN_ACCEPTS_TO_JUDGE ? 'not_enough_accepts' : 'matches_device_cores',
    });
  }

  if (deviceCap > 0 && claim > deviceCap && claim - deviceCap >= THREAD_LIE_DELTA) {
    return result({
      honest: false,
      verdict: THREAD_INFLATE,
      claimed: claim,
      inferred: inferred || deviceCap,
      cpuCores: cores,
      cpuThreads: logical,
      reason: 'claimed_threads_above_cores',
    });
  }

  if (hits < MIN_ACCEPTS_TO_JUDGE || inferred <= 0) {
    return result({
      honest: true,
      verdict: THREAD_UNKNOWN,
      claimed: claim,
      inferred,
      cpuCores: cores,
      cpuThreads: logical,
      reason: 'not_enough_accepts',
    });
  }

  if (claim >= inferred * THREAD_LIE_FACTOR && claim - inferred >= THREAD_LIE_DELTA) {
    return result({
      honest: false,
      verdict: THREAD_INFLATE,
      claimed: claim,
      inferred,
      cpuCores: cores,
      cpuThreads: logical,
      reason: 'claimed_threads_above_work',
    });
  }
  if (inferred >= claim * THREAD_LIE_FACTOR && inferred - claim >= THREAD_LIE_DELTA) {
    return result({
      honest: false,
      verdict: THREAD_UNDERREPORT,
      claimed: claim,
      inferred,
      cpuCores: cores,
      cpuThreads: logical,
      reason: 'claimed_threads_below_work',
    });
  }
  return result({
    honest: true,
    verdict: THREAD_HONEST,
    claimed: claim,
    inferred,
    cpuCores: cores,
    cpuThreads: logical,
    reason: cores > 0 || logical > 0 ? 'matches_device_cores' : 'matches_accepted_work',
  });
}

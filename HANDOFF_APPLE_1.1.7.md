# Apple handoff — gnfp-node 1.1.7 hash-bonus book law

**From:** Windows (this host)  
**For:** Mac cut of Apple wallet / node / miner packages  
**Date:** 2026-08-19  
**Pin:** gnfp-node **1.1.7** (`rgsneddon/gnfp-node`, commit on `master` that prints `version=1.1.7`)

Windows **did not** build `.app`, IPA, or notarized Apple binaries.

## Book law (consensus — do not reimplement on the pool)

- Formed-block pot: **1 GNFP**
- Hash bonus: **0.000000001 GNFP per hash** a miner submitted in the open block
- Bonus is stored in **nanos** (`1e9` nanos = 1 GNFP). Do not convert to 1e-8 micros — 1, 4, or 9 hashes must still pay, not 0.
- Bonus window **resets on every new block**
- Time never mints
- Old `gnfp-germany-book-v1` seals stay hash-stable; new seals may record `blockRewardGnfp` / `hashBonusGnfp` and amount `1 + N*1e-9`

Source of truth: `src/book_law.js` (`HASH_BONUS_GNFP`, `HASH_BONUS_NANOS`, `settleWindowCredits`, `noteMinerHashes`). Equal book and pool **call** those functions.

## What Mac should cut

1. Pull `rgsneddon/gnfp-node` at **1.1.7** (`git pull` on `master`; `node src/node.js --print-config` must show `"version":"1.1.7"` and `"hashBonusGnfp":1e-9`).
2. Cut Apple node / wallet / miner packages with the **same pin** (version digits **1–9 only** — no `1.0.10+`).
3. Do not invent a second bonus rate in pool or UI scripts.
4. Miner already reports `hashes` on stratum `stats`; no new miner algorithm. Ship GNFPHash **1.0.2** (or current master) only if you need a fresh Apple miner build.

## Non-Apple artifacts (already produced on Windows)

Listed in the implementer scratch `release-artifacts.txt`:

- `gnfp-node-1.1.7-win.zip`
- `gnfp-node-1.1.7-unix.zip`
- `GNFPHash-1.0.2-win.zip`
- `GNFPHash-1.0.2-unix.zip`

Windows did not cut Apple `.app` / IPA. Mac cuts those from this pin.

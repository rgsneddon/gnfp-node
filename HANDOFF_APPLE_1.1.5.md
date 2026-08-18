# Apple handoff — gnfp-node 1.1.5 hash-bonus book law

**From:** Windows (this host)  
**For:** Mac cut of Apple wallet / node / miner packages  
**Date:** 2026-08-19  
**Pin:** gnfp-node **1.1.5** (`rgsneddon/gnfp-node`)

Windows **did not** build `.app`, IPA, or notarized Apple binaries.

## Book law (consensus — do not reimplement on the pool)

- Formed-block pot: **1 GNFP**
- Hash bonus: **0.000000001 GNFP per hash** a miner submitted in the open block
- Bonus window **resets on every new block**
- Time never mints
- Old `gnfp-germany-book-v1` seals stay hash-stable

Source of truth: `src/book_law.js` (`HASH_BONUS_GNFP`, `settleWindowCredits`, `noteMinerHashes`).

## What Mac should cut

1. Pull `rgsneddon/gnfp-node` at **1.1.5** (or the commit that tags it).
2. Cut Apple node/wallet/miner packages with the **same pin** (digits 1–9 only).
3. Do not invent a second bonus rate in pool or UI scripts.
4. Pool HTML already labels miner columns: Blocks found, Orphaned, Hashes this round; tile **Blocks this uptime**.

## Non-Apple artifacts (already produced on Windows)

See the implementer scratch `release-artifacts.txt` next to this handoff listing `pack/win` and `pack/unix` zips.

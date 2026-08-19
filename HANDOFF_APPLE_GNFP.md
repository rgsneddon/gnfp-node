# Mac handoff — all GNFP work from Windows (one file)

**From:** Windows PC (`C:\Users\rgsne`)  
**Date:** 2026-08-19  
**This is the only Mac handoff for this round.** Ignore per-repo `HANDOFF_APPLE_*.md` files unless they contradict this.

Windows **did not** cut `.app`, IPA, notarized Apple binaries, or a Play-signed APK.

---

## Pins (digits 1–9 only)

| part | pin | Windows already shipped | Mac must cut |
|---|---|---|---|
| **gnfp-node** | **1.2.1** | win+unix zips on GitHub `v1.2.1` | **No.** JS only — `node src/node.js`. |
| **gnfp-wallet** | **0.1.4** | Windows zip on GitHub `v0.1.4` | **Yes.** macOS (Developer ID + notarize), iOS IPA, release-signed Android APK. |
| **GNFPHash** | **1.0.2** | existing | **No** unless you already owe an Apple miner rebuild. |

---

## Wallet 0.1.4 (Mac work)

0.1.3 can mint a new gnfp1 or paint **0** after a failed node fetch. 0.1.4 keeps the same address and last-known spendable.

1. `git clone https://github.com/rgsneddon/gnfp-wallet.git && git checkout master`  
   Confirm `kGnfpPackageVersion = '0.1.4'` and `pubspec` `0.1.4+14`.
2. Cut **macOS** + **iOS** for **0.1.4**.
3. Sign **Android APK** as GNFP Wallet. Attach `gnfp-wallet-0.1.4-android.apk` to existing GitHub **`v0.1.4`**.
4. Do **not** reuse the 0.1.3 APK. Do **not** attach 0.0.2 zips to that tag.
5. Linux/Arch wallet zips: Windows did not cut them. Cut on Mac/Linux if you can.

---

## Node 1.2.1 (no Apple binary)

Already at https://github.com/rgsneddon/gnfp-node/releases/tag/v1.2.1

Law (immutable, not env). Fingerprint unchanged:

`gnfp-book-law-1:90000:14:21:14:1:1:100:16384:10:1:1:1:1:1`

- Time never mints. Block found = miner hash meets the node target.
- Only miners mint: coinbase 1 GNFP + 0.000000001 GNFP per proven hash. `send` never mints.
- Proven hashes accumulate on **one in-memory path per recipient wallet**. They are not public outputs and do not stream in the explorer.
- Block found commits **one hash-path tx per recipient** (same total nanos) plus the 1 GNFP pot share.
- Wallet sends confirm on the same miner-work block.
- 90s retarget / live floor 14 / genesis 21.

`--print-config` must show `"version":"1.2.1"` and `"minerMintOnly":1`.

Live DE pool: replica POST is tip-only (no full-chain reseal). Public pages first-paint from `/api/tip`. Hashrates table reads `/api/hashrates` from miner-stats workers, not hash txs.

---

## Already on GitHub

- Node: https://github.com/rgsneddon/gnfp-node/releases/tag/v1.2.1
- Wallet Windows: https://github.com/rgsneddon/gnfp-wallet/releases/tag/v0.1.4 (`gnfp-wallet-0.1.4-windows.zip` only)
- Miner: https://github.com/rgsneddon/GNFPHash/releases/tag/v1.0.2

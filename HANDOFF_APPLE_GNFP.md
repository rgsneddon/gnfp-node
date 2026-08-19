# Mac handoff — all GNFP work from Windows (one file)

**From:** Windows PC (`C:\Users\rgsne`)  
**Date:** 2026-08-19  
**This is the only Mac handoff for this round.** Ignore per-repo `HANDOFF_APPLE_*.md` files unless they contradict this.

Windows **did not** cut `.app`, IPA, notarized Apple binaries, or a Play-signed APK.

---

## Pins (digits 1–9 only)

| part | pin | Windows already shipped | Mac must cut |
|---|---|---|---|
| **gnfp-node** | **1.2.2** | win+unix zips on GitHub `v1.2.2` | **No.** JS only — `node src/node.js`. |
| **gnfp-wallet** | **0.1.4** | Windows zip on GitHub `v0.1.4` | **Yes.** macOS (Developer ID + notarize), iOS IPA, release-signed Android APK. |
| **GNFPHash** | **1.0.2** | existing | **No** unless you already owe an Apple miner rebuild. |

No new node pin after 1.2.2. Live DE pool was patched in place: UI is a 1s snapshot window; GET never walks miners or the chain.

---

## Wallet 0.1.4 (Mac work)

0.1.3 can mint a new gnfp1 or paint **0** after a failed node fetch. 0.1.4 keeps the same address and last-known spendable.

1. `git clone https://github.com/rgsneddon/gnfp-wallet.git && git checkout master`  
   Confirm `kGnfpPackageVersion = '0.1.4'` and `pubspec` `0.1.4+14`.
2. Cut **macOS** + **iOS** for **0.1.4**.
3. Sign **Android APK** as GNFP Wallet. Attach `gnfp-wallet-0.1.4-android.apk` to existing GitHub **`v0.1.4`**.
4. Do **not** reuse the 0.1.3 APK. Do **not** attach 0.0.2 zips to that tag.
5. Linux/Arch wallet zips: Windows did not cut them. Cut on Mac/Linux if you can.
6. User-facing copy says **node**, not book.

---

## Node 1.2.2 (no Apple binary)

https://github.com/rgsneddon/gnfp-node/releases/tag/v1.2.2

Law unchanged. Fingerprint:

`gnfp-book-law-1:90000:14:21:14:1:1:100:16384:10:1:1:1:1:1`

- Time never mints. Block found = miner hash meets the node target.
- Only miners mint: 1 GNFP pot + 0.000000001 GNFP per proven hash. `send` never mints.
- Hash bonus is one in-memory path per recipient; commit on block found.
- `--print-config` must show `"version":"1.2.2"` and `"minerMintOnly":1`.

Live pool (DE) lean window, not a new pin:

- Tables poll **every 1s** against a **ready snapshot**. `/api/stats` `/api/tip` `/api/hashrates` do not compute on GET.
- Snapshot rebuilds every 4s off the request path. One share per event-loop turn (all sockets).
- Wallet persist: balances + last 200 txs. Seed log last 64.
- Observed after restart: tip/stats/hashrates **200 in 2–6 ms** with **6 miners** while CPU is busy hashing. Height advanced. That is share work, not a hung HTTP loop.

---

## Already on GitHub

- Node: https://github.com/rgsneddon/gnfp-node/releases/tag/v1.2.2
- Wallet Windows: https://github.com/rgsneddon/gnfp-wallet/releases/tag/v0.1.4
- Miner: https://github.com/rgsneddon/GNFPHash/releases/tag/v1.0.2
- This file: https://github.com/rgsneddon/gnfp-node/blob/master/HANDOFF_APPLE_GNFP.md

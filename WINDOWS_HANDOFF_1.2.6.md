# Windows pointer — gnfp-node 1.2.6

**Do not use this file as the pin list.** All GNFP client leftover lives in:

**https://github.com/rgsneddon/handoff/blob/main/HANDOFF.md**

Current pin here: **1.2.6**. Source packs (macos/linux tar.gz + windows source zip with `pack\win\gnfp-node.cmd`) ship from the Mac on **the same** `v1.2.6` tag. Miner **GNFPHash 1.0.5** is unchanged. `HASH_TX_LIVE` stays **0**.

## Laptop leftover (optional)

The source zip on the tag is enough for Node 18+ (`node src\node.js` / `pack\win\gnfp-node.cmd`). `--print-config` JSON `version` must be `1.2.6`.

If a native PE layout is still wanted, attach `gnfp-node-1.2.6-windows.zip` **on the same tag** (no `v1.2.6-windows` sibling). Do **not** rebuild 1.2.5.

Join on Singapore must stay concurrent with the DE pool book (`creditsNanos` / `hashWindowCommitment` / round rows). This pin is the join that understands those seals.

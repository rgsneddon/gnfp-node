# Windows pointer — gnfp-node

**Do not use this file as the pin list.** All GNFP leftover lives in:

**https://github.com/rgsneddon/handoff/blob/main/HANDOFF.md**

Current pin here: **1.2.7**. Source packs (macos/linux tar.gz + windows source zip with `pack\win\gnfp-node.cmd`) ship on **the same** `v1.2.7` tag. Miner **GNFPHash 1.0.6** is unchanged. Wallet **0.1.9** is unchanged. `HASH_TX_LIVE` stays **0**. Do **not** rebuild 1.2.6. One pin → one GitHub tag.

Default launch is an **equal daemon** (local stratum is this book). Germany and Singapore are peers, not masters. `--join` is opt-in relay. Competing suffixes resolve by Nakamoto most-work. Existing sealed prefix balances are kept.

## Laptop leftover (optional)

The source zip on the tag is enough for Node 18+ (`node src\node.js` / `pack\win\gnfp-node.cmd`). `--print-config` JSON `version` must be `1.2.7`, `equalNode` true, `join` false, `hashTxLive` 0, `book` `gnfp-germany-book-v1`.

```
pack\win\gnfp-node.cmd --print-config
pack\win\gnfp-node.cmd --notls --data-dir %USERPROFILE%\.gnfp-node
```

If a native PE layout is still wanted, attach it **on the same** `v1.2.7` tag (no `v1.2.7-windows` sibling). Do **not** rebuild 1.2.6.

Singapore and Germany stay concurrent peers of `gnfp-germany-book-v1`. 1-hash=1-tx is **not** enacted.

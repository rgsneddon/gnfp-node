# gnfp-node

Run **your own $GNFP node**. Same chain as everyone else. Join is **on from launch**: local stratum relays miners into the live book. Germany and Singapore are well-known peers, not masters.

**Pin:** `1.1.9`  
**Coin:** GNFP  
**Chain:** `gnfp-germany-book-v1` (immutable)  
**Algo:** **GNFPHash** — old `gnfp-mine`, BeamHash III, GPU and ASIC are refused

Only **miners** mint. A wallet send never creates GNFP. Time never forms a block.

Each proven hash is credited into that miner’s **one open hash transaction** (not a new object per hash). Those rows stay unconfirmed until miner work forms a block; then they confirm as **one row per miner**. Wallet sends confirm on that same block.

| | |
|---|---|
| Wallet **0.1.4** | https://github.com/rgsneddon/gnfp-wallet/releases/tag/v0.1.4 |
| Miner **GNFPHash 1.0.2** | https://github.com/rgsneddon/GNFPHash/releases/tag/v1.0.2 |
| Node **1.1.9** | https://github.com/rgsneddon/gnfp-node/releases/tag/v1.1.9 |
| Pool | https://gnfp.restoreprivacy.online |
| Explorer | https://explorer.restoreprivacy.online |
| Mac handoff (all pins) | [HANDOFF_APPLE_GNFP.md](./HANDOFF_APPLE_GNFP.md) |

## How to run a node

Needs **Node.js 18+**. No `npm install`.

```bash
git clone https://github.com/rgsneddon/gnfp-node.git
cd gnfp-node
node src/node.js
```

Windows:

```bat
git clone https://github.com/rgsneddon/gnfp-node.git
cd gnfp-node
node src\node.js
```

Or `pack\win\gnfp-node.cmd` / `./pack/unix/gnfp-node`.

That starts **join** (the default): local stratum **:1474**, HTTP **:8014**, data in `~/.gnfp-node` (Windows: `%USERPROFILE%\.gnfp-node`). Miners on this node are relayed into the live book — this process does not mint a second chain. The CLI prints **watching seeds**, **sync** progress (`local/network`), then a **tip-height** line whenever the book advances.

### Help topics

```bash
node src/node.js help
node src/node.js help run
node src/node.js help sync
node src/node.js help mine
node src/node.js help data
```

### Check it

```bash
node src/node.js --print-config
curl -sS http://127.0.0.1:8014/api/tip
```

`height` / `tipHash` should match the [explorer](https://explorer.restoreprivacy.online).

## Peers (same book)

| | Host | What |
|---|---|---|
| Germany | `de.restoreprivacy.online:1474` | well-known peer (default) |
| Singapore | `sg.restoreprivacy.online:1474` | join peer, same tip |
| You | `:1474` stratum + `:8014` HTTP | join (default) |

Always pull **:1474**. Public `:8014` is often filtered.

Sync from Singapore instead:

```bash
node src/node.js --peer sg.restoreprivacy.online:1474
```

## Point a miner at it

Use **GNFPHash 1.0.2** and a real `gnfp1` address. Public peers stay TLS. Local stratum is TLS only if you pass a cert/key; otherwise add `--notls` on the miner.

```bash
git clone https://github.com/rgsneddon/GNFPHash.git
cd GNFPHash
git checkout v1.0.2
node src/miner.js --pool de.restoreprivacy.online:1474 --user gnfp1YOURADDRESS.worker --threads 4
```

Local node (plaintext stratum):

```bash
node src/miner.js --pool 127.0.0.1:1474 --user gnfp1YOURADDRESS.worker --threads 4 --notls
```

Or let the [pool page](https://gnfp.restoreprivacy.online) write the line.

## Optional

Watch-only (HTTP, no local miners):

```bash
node src/node.js --replica-only
```

Show up on explorer **Nodes online**:

```bash
node src/node.js --announce-host mynode.example --role join
```

Roles: `join` · `pool` · `solo`.

`--notls` is local plaintext only. Public books stay TLS.

## Flags

```text
--peer HOST:PORT    peer to sync from (default de.restoreprivacy.online:1474)
--pull HOST:PORT    same as --peer (does not change the chain)
--http-port N       local HTTP book (default 8014)
--stratum-port N    local miners (default 1474)
--join              join the live book (default; on from launch)
--equal / --book    local minting book (operator only)
--replica-only      HTTP only — no local stratum
--data-dir PATH     book on disk (default ~/.gnfp-node)
--poll-ms N         how often to pull the tip (default 1000)
--announce-host H   register on the explorer
--role join|pool|solo
--notls             local plaintext only
--tls-cert PATH     public stratum TLS cert (or GNFP_TLS_CERT)
--tls-key PATH      public stratum TLS key (or GNFP_TLS_KEY)
--print-config
--help [topic]      overview, or run / sync / mine / data
```

The book is stored compressed (`tip.json` + append-only `blocks.jsonl.gz`) so a long chain is not rewritten every poll.

## What this is (and is not)

| This node does | This node does not |
|---|---|
| Join the live book from launch (`gnfp-germany-book-v1`) | Mint a second chain (unless `--equal`) |
| Relay **GNFPHash** miners into the live book | Accept leftover `gnfp-mine` / GPU / ASIC |
| Sync a local replica of the same tip | Need Germany online forever to keep the replica |
| Reject a mutated / competing / shorter tip (409) | Let an operator rewrite a sealed height |

## Tests

```bash
node --test tests/*.js
```

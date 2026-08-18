# gnfp-node

Run **your own $GNFP node**. Same chain as everyone else. Germany and Singapore are **equal peers**, not masters. If a peer drops, this node keeps the tip, accepts miners, and continues the book.

**Pin:** `1.0.9`  
**Coin:** GNFP  
**Chain:** `gnfp-germany-book-v1` (immutable)  
**Algo:** **GNFPHash** — old `gnfp-mine`, BeamHash III, GPU and ASIC are refused

| | |
|---|---|
| Wallet **0.1.2** | https://github.com/rgsneddon/gnfp-wallet/releases/tag/v0.1.2 |
| Miner **GNFPHash 1.0.1** | https://github.com/rgsneddon/GNFPHash/releases/tag/v1.0.1 |
| Node **1.0.9** | https://github.com/rgsneddon/gnfp-node |
| Pool | https://gnfp.restoreprivacy.online |
| Explorer | https://explorer.restoreprivacy.online |

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

That starts a full equal book: local stratum **:1474**, HTTP **:8014**, data in `~/.gnfp-node` (Windows: `%USERPROFILE%\.gnfp-node`). The CLI prints **watching seeds**, **sync** progress (`local/network`), then a **tip-height** line whenever the book advances. A miner that seals a block here prints **block found** plus the full sealed block.

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
| Singapore | `sg.restoreprivacy.online:1474` | equal book, same tip |
| You | `:1474` stratum + `:8014` HTTP | your book |

Always pull **:1474**. Public `:8014` is often filtered.

Sync from Singapore instead:

```bash
node src/node.js --peer sg.restoreprivacy.online:1474
```

## Point a miner at it

Use **GNFPHash 1.0.1** and a real `gnfp1` address. Public peers stay TLS. Local stratum is TLS only if you pass a cert/key; otherwise add `--notls` on the miner.

```bash
git clone https://github.com/rgsneddon/GNFPHash.git
cd GNFPHash
git checkout v1.0.1
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
--replica-only      HTTP only — no local stratum
--data-dir PATH     book on disk (default ~/.gnfp-node)
--poll-ms N         how often to pull the tip (default 4000)
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
| Run a full local book of `gnfp-germany-book-v1` | Need Germany online forever |
| Sync from any peer, then continue alone | Start a different chain |
| Accept **GNFPHash** miners on this node | Accept leftover `gnfp-mine` / GPU / ASIC |
| Seal found blocks; confirm after 72s | Let an operator rewrite a sealed height |
| Reject a mutated / competing / shorter tip (409) | Dump the whole book every poll |

## Tests

```bash
node --test tests/*.js
```

# gnfp-node

Run **your own $GNFP node**. Same chain as everyone else. Default is an **equal daemon**: local stratum is this book. Germany and Singapore are well-known **peers**, not masters. `--join` is opt-in relay.

**Pin:** `1.2.7`  
**Coin:** GNFP  
**Chain:** `gnfp-germany-book-v1` (immutable id; competing suffixes resolve by most-work)  
**Algo:** **GNFPHash** — old `gnfp-mine`, BeamHash III, GPU and ASIC are refused  
**Needs:** Node.js **18+** on the PATH. No `npm install`.  
**`HASH_TX_LIVE`:** `0` (1-hash=1-tx is not enacted; collate path stays in book law for a later fork).

Only **miners** mint. A wallet send never creates GNFP. Time never forms a block.

Proven hashes accumulate on **one in-memory path per recipient wallet**. They are not public outputs and do not stream in the explorer. A block found commits **one hash-path tx per recipient** plus the 1 GNFP pot share. Wallet sends confirm on that same block.

| Part | Pin | How-to |
|---|---|---|
| This node | **1.2.7** | [Releases and packages](#releases-and-packages) · [Equal daemon](#how-to-run-the-equal-daemon-default) · [Join relay](#how-to-join-relay-opt-in) |
| Miner **GNFPHash** | **1.0.6** | [Point a miner at this node](#how-to-point-gnfphash-106-at-this-node) · https://github.com/rgsneddon/GNFPHash/releases/tag/v1.0.6 |
| Wallet | **0.1.9** | https://github.com/rgsneddon/gnfp-wallet/releases/tag/v0.1.9 |
| Pool | live | https://gnfp.restoreprivacy.online |
| Explorer | live | https://explorer.restoreprivacy.online |
| GitHub node release | **v1.2.7** | https://github.com/rgsneddon/gnfp-node/releases/tag/v1.2.7 |

Admit floor: **GNFPHash 1.0.4 and above**. 1.0.3 and lower commit **zero work**. Prefer **1.0.5** (device `cpuCores` / `cpuThreads` plus utilised threads).

---

## Releases and packages

Every GitHub **v1.2.7** asset is the same Node 18+ source tree (unix launcher + Windows `.cmd`). There is no native PE / `.app` in this pin. Pick one archive, verify the checksum, unpack, run. Do **not** rebuild 1.2.6.

| Package | File | For |
|---|---|---|
| macOS | `gnfp-node-1.2.7-macos.tar.gz` | macOS with Node.js 18+ |
| Linux | `gnfp-node-1.2.7-linux.tar.gz` | Linux / Arch with Node.js 18+ |
| Windows | `gnfp-node-1.2.7-windows.zip` | Windows with Node.js 18+ (`pack\win\gnfp-node.cmd`) |

Checksums: `SHA256SUMS` next to the assets, or the release notes.

```bash
# example (macOS / Linux)
shasum -a 256 gnfp-node-1.2.7-macos.tar.gz
# must match SHA256SUMS
```

Windows leftover: [WINDOWS_HANDOFF.md](./WINDOWS_HANDOFF.md) and https://github.com/rgsneddon/handoff/blob/main/HANDOFF.md (`WINDOWS_HANDOFF.md` in this repo is a pointer; pin list is only in HANDOFF.md).

---

## How-to: macOS package

1. Install **Node.js 18+** (`node -v`).
2. Download `gnfp-node-1.2.7-macos.tar.gz` from the [v1.2.7 release](https://github.com/rgsneddon/gnfp-node/releases/tag/v1.2.7).
3. Unpack and start the **equal daemon** (default):

```bash
tar xzf gnfp-node-1.2.7-macos.tar.gz
cd gnfp-node-1.2.7
./pack/unix/gnfp-node
```

Same as `node src/node.js`. First run creates `~/.gnfp-node`. Leave the process running: you should see `watching seeds`, then `sync LOCAL/NETWORK`, then `tip-height`.

Help / check:

```bash
./pack/unix/gnfp-node help
./pack/unix/gnfp-node --print-config
curl -sS http://127.0.0.1:8014/api/tip
```

---

## How-to: Linux package

1. Install **Node.js 18+** (`node -v`).
2. Download `gnfp-node-1.2.7-linux.tar.gz` from the [v1.2.7 release](https://github.com/rgsneddon/gnfp-node/releases/tag/v1.2.7).
3. Unpack and start the equal daemon:

```bash
tar xzf gnfp-node-1.2.7-linux.tar.gz
cd gnfp-node-1.2.7
./pack/unix/gnfp-node
```

systemd-style (example — adjust user and paths):

```bash
# ExecStart=/usr/bin/node /opt/gnfp-node/src/node.js --peer de.restoreprivacy.online:1474 --http-port 8014 --stratum-port 1474 --data-dir /var/lib/gnfp-node --role join
```

Public stratum needs TLS certs (`--tls-cert` / `--tls-key` or `GNFP_TLS_CERT` / `GNFP_TLS_KEY`). `--notls` is local plaintext only.

---

## How-to: Windows package

1. Install **Node.js 18+** from https://nodejs.org and confirm `node -v` in `cmd`.
2. Download `gnfp-node-1.2.7-windows.zip` from the [v1.2.7 release](https://github.com/rgsneddon/gnfp-node/releases/tag/v1.2.7).
3. Unzip and start join:

```bat
cd gnfp-node-1.2.7
pack\win\gnfp-node.cmd
```

Same as `node src\node.js`. Data dir is `%USERPROFILE%\.gnfp-node`.

Help / check:

```bat
pack\win\gnfp-node.cmd help
pack\win\gnfp-node.cmd --print-config
curl -sS http://127.0.0.1:8014/api/tip
```

This zip is **source + cmd**, not a native `.exe`. A PE rebuild, if required, is the Windows leftover — do not expect a sibling `v1.2.7-windows` tag.

---

## How-to: run from git

```bash
git clone https://github.com/rgsneddon/gnfp-node.git
cd gnfp-node
git checkout v1.2.7
node src/node.js
```

Windows:

```bat
git clone https://github.com/rgsneddon/gnfp-node.git
cd gnfp-node
git checkout v1.2.7
node src\node.js
```

`--print-config` JSON `version` must be `1.2.7`.

---

## How-to: run the equal daemon (default)

Default launch **is** an equal book. Local stratum is this node's miners. Seeds are peers; the node keeps minting if they go quiet, then adopts a more-work valid peer chain when one appears.

```bash
node src/node.js
# or: ./pack/unix/gnfp-node
```

What you get:

| | |
|---|---|
| Stratum | `:1474` (TLS if certs are set; otherwise plaintext — miners need `--notls`) |
| HTTP | `:8014` (`/api/tip`, `/api/network`, `/api/miner/<tag>`, `/api/sync`, …) |
| Data | `~/.gnfp-node` (Windows: `%USERPROFILE%\.gnfp-node`) |
| Peer | `de.restoreprivacy.online:1474` |

CLI sequence: `watching seeds` → `sync start` → `sync LOCAL/NETWORK (PCT%)` → `tip-height N hash=…`.

Point miners at **this** host:1474 (or keep using the public pool). Join `/api/network` and `/api/miner/<tag>` show the same honesty fields as the book: utilised `threads`, device `cpuCores` / `cpuThreads`, proven H/s, `threadHonesty`.

Sync from Singapore instead:

```bash
node src/node.js --peer sg.restoreprivacy.online:1474
```

Always pull **:1474**. Public `:8014` is often filtered.

Show up on explorer **Nodes online**:

```bash
node src/node.js --announce-host mynode.example --role book
```

---

## How-to: replica-only (watch, no miners)

HTTP replica of the tip. No local stratum.

```bash
node src/node.js --replica-only
curl -sS http://127.0.0.1:8014/api/tip
```

---

## How-to: join relay (opt-in)

`--join` relays local stratum into a seed. It does **not** mint.

```bash
node src/node.js --join
```

## How-to: run an equal / solo node

`--equal` / `--book` is the same as the default equal daemon. Use a separate `--data-dir` for a second local book.

```bash
node src/node.js --equal --data-dir ~/.gnfp-equal
```

This node:

- Accepts **GNFPHash 1.0.4+** only (1.0.3 commits zero work).
- Credits **proven hashes** (`accepts × 2^shareBits`), not share-count/s.
- Stores utilised threads **and** device `cpuCores` / `cpuThreads`.
- Announces to the explorer with `role=solo` plus `cpuCores`, `cpuThreads`, `threadHonesty`.

`/api/network` on an equal node publishes `hashrate`, `threads` (utilised), `cpuCores`, `cpuThreads`, `threadHonesty`, and `workers`.

6-core / 12-thread CPU with `--threads 10` is **one example** of honest reporting, not a global cap.

---

## How-to: point GNFPHash 1.0.6 at this node

Use **GNFPHash 1.0.6** (or at least 1.0.4). 1.0.3 and lower are kicked with `miner_update_required` and credit nothing.

```bash
git clone https://github.com/rgsneddon/GNFPHash.git
cd GNFPHash
git checkout v1.0.6
```

Public peer (TLS):

```bash
node src/miner.js --pool de.restoreprivacy.online:1474 --user gnfp1YOURADDRESS.worker --threads 10
```

Local join/equal on this machine (plaintext stratum unless you passed certs):

```bash
node src/miner.js --pool 127.0.0.1:1474 --user gnfp1YOURADDRESS.worker --threads 10 --notls
```

`--threads N` is **utilised** workers. The miner also reports how many cores/threads the **device** has. Claiming more workers than the device is inflate; running fewer than the device is honest.

Or let the [pool page](https://gnfp.restoreprivacy.online) write the line.

Wallet in-wallet miner: **gnfp-wallet 0.1.6** (same 1.0.5 mine path). There is no standalone iOS/Android miner app.

---

## How-to: check the node

```bash
node src/node.js --print-config
node src/node.js help
node src/node.js help run
node src/node.js help sync
node src/node.js help mine
node src/node.js help data
```

`--print-config` must show `"version": "1.2.7"`, `"equalNode": true`, `"hashTxLive": 0`, `"join": false` (unless you passed `--join`), `"tls": true` unless `--notls`.

```bash
curl -sS http://127.0.0.1:8014/api/tip
curl -sS http://127.0.0.1:8014/api/network
```

`height` / `tipHash` should match the [explorer](https://explorer.restoreprivacy.online).

Join miner rollup (utilised threads, **not** the sum of device `cpuThreads`):

```bash
curl -sS http://127.0.0.1:8014/api/miner/miner-TAG
```

---

## Peers (same chain)

| | Host | What |
|---|---|---|
| Germany | `de.restoreprivacy.online:1474` | well-known peer (default) |
| Singapore | `sg.restoreprivacy.online:1474` | peer, same chain |
| You | `:1474` stratum + `:8014` HTTP | equal daemon (default) |

---

## Honesty (1.2.7)

Equal, join, and solo use the **same** rules as the Germany book:

- **Utilised** `threads` = farm actually running (`--threads` / `farm.running`).
- **Device** `cpuCores` (physical) and `cpuThreads` (logical SMT).
- Honesty: utilised `<=` device cap (`cpuThreads` if the miner sent it, else `cpuCores`).
- Published H/s = **proven hashes** from accepted shares (`accepts × 2^shareBits / elapsed`), not share-count/s.
- Rollup **sums utilised** threads; device threads/cores are **max**, never the sum of `cpuThreads` across workers.

Do not bottleneck cheats to 1 core in this pin.

---

## Flags

```text
--peer HOST:PORT    peer to sync from (default de.restoreprivacy.online:1474)
--pull HOST:PORT    same as --peer (does not change the chain)
--http-port N       local HTTP node (default 8014)
--stratum-port N    local miners (default 1474)
--join              opt-in stratum relay into a seed
--equal / --book    equal daemon (default)
--replica-only      HTTP only — no local stratum
--data-dir PATH     node on disk (default ~/.gnfp-node)
--poll-ms N         how often to pull the tip (default 1000)
--announce-host H   register on the explorer
--role book|join|pool|solo
--notls             local plaintext only
--tls-cert PATH     public stratum TLS cert (or GNFP_TLS_CERT)
--tls-key PATH      public stratum TLS key (or GNFP_TLS_KEY)
--print-config
--help [topic]      overview, or run / sync / mine / data
```

The node is stored compressed (`tip.json` + append-only `blocks.jsonl.gz`) so a long chain is not rewritten every poll.

---

## What this is (and is not)

| This node does | This node does not |
|---|---|
| Run as an equal daemon of `gnfp-germany-book-v1` from launch | Require Germany as a master |
| Serve **GNFPHash 1.0.4+** miners on local stratum | Accept leftover `gnfp-mine` / 1.0.3 / GPU / ASIC |
| Adopt a more-work valid peer chain (shared prefix kept) | Rewrite sealed prefix balances |
| Keep minting if seeds are unreachable | Enact `HASH_TX_LIVE=1` / one JSON object per hash |
| Reject mutated payloads and foreign books | Let an operator rewrite a sealed prefix height |

---

## Tests

```bash
node --test tests/*.js
```

`tests/test_node_align.js` covers admit 1.0.4+, device-generic honesty, proven H/s (not share/s), join utilised-thread rollup, and solo honesty fields.

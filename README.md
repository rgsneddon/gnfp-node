# gnfp-node

Run **your own $GNFP node**. Every node is an **equal Chronoflux book** of the same chain. Germany is a well-known peer, not a required master. If that peer drops, this node keeps the tip, accepts miners, and continues the chain.

**Pin:** `1.0.4`  
**Coin:** GNFP  
**Chain id:** `gnfp-germany-book-v1` (immutable). Hosts are peers.  
TLS default; `--notls` is local plaintext only.

- Explorer: https://explorer.restoreprivacy.online
- Pool: https://gnfp.restoreprivacy.online
- Miner: [gnfp-mine 1.0.9](https://github.com/rgsneddon/gnfp-mine)

## What this is (and is not)

| This node does | This node does not |
|---|---|
| Run a full local book (HTTP + stratum) of chain `gnfp-germany-book-v1` | Require Germany to stay online |
| Sync from any peer, then continue alone if the peer drops | Start a different genesis / 50-GNFP book |
| Accept miners directly on this node | Relay-only to a master |
| Hold found/confirmed blocks as sealed rows | Let an operator rewrite a sealed height |
| Verify-before-adopt on peer updates | Dump the full ~30k-block book every poll |

`--replica-only` is pull-only. Default is an **equal book**.

## Install

Needs **Node.js 18+**.

```bash
git clone https://github.com/rgsneddon/gnfp-node.git
cd gnfp-node
# no npm dependencies
```

Windows pack: `pack\win\gnfp-node.cmd`  
Unix pack: `./pack/unix/gnfp-node`

GitHub Releases: https://github.com/rgsneddon/gnfp-node/releases

## Run your own node

Run a full equal node (local stratum + HTTP + persist):

```bash
node src/node.js
```

TLS is on. Use `--notls` only against a local plaintext loopback. `--pull host:port` is a dial address for tests; it does not retarget the book.

Useful flags:

```text
--pull HOST:PORT    dial address only (default de.restoreprivacy.online:1474)
--http-port N       local HTTP replica / pull (default 8014)
--stratum-port N    local stratum relay (default 1474)
--replica-only      HTTP only — no local stratum
--data-dir PATH     persist adopted tip (default ~/.gnfp-node)
--poll-ms N         how often to pull the tip (default 4000)
--notls             local plaintext only
--print-config      JSON (coin=GNFP, hub, TLS)
--help
```

Example: replica-only observer that other software can query:

```bash
node src/node.js \
  --replica-only \
  --http-port 8014 \
  --data-dir ~/.gnfp-node
```

Public `:8014` on Germany is often filtered. **Always pull `:1474`**, not `https://de…/api/network` on 443/8014.

Check the process:

```bash
node src/node.js --print-config
curl -sS http://127.0.0.1:8014/api/tip
```

`/api/tip` should show the same `height` / `tipHash` as the book. `/api/blocks?afterHeight=N&afterHash=H&limit=64` is the incremental pull.

## How sync works

A found block is sealed into the hash-linked chain at once. After 72 seconds it is confirmed and stays held — it is not dropped, rewritten, or operator-editable.

1. GET `https://de.restoreprivacy.online:1474/api/tip` (TLS; `--notls` uses http).
2. If the local tip already matches `height` + `tipHash`, wait for the next poll.
3. Else GET `/api/blocks?afterHeight=<local>&afterHash=<localTip>&limit=64`.
4. Verify-before-adopt: only a hash-linked extension of the last adopted tip is taken.
5. Persist under `--data-dir` (`tip.json` + append-only `blocks.jsonl`). Restart resumes that tip, not height 0.

A mutated payload, a same-height competing tip, or a shorter/rollback book is rejected (`ok: false` / HTTP 409 on `POST /api/sync`).

## Announce (optional)

Exchanges or other pool operators can check in so explorer **Nodes online** lists them:

```bash
node src/node.js \
  --announce-host mynode.example \
  --role pool
```

Or:

```bash
curl -X POST https://explorer.restoreprivacy.online/api/nodes \
  -H 'content-type: application/json' \
  -d '{"host":"mynode.example","port":1474,"role":"join"}'
```

Roles: `join` (stratum relay), `pool` (you offer GNFP services), `solo`.

## Ports

| Port | Where | What |
|---|---|---|
| **1474** | Germany (`de.restoreprivacy.online`) | Master book seed — stratum + HTTP mux (tip / incremental blocks). TLS in public. |
| **1474** | your host (default) | Optional stratum relay into Germany. Not a second book. |
| **8014** | your host (default) | Local HTTP replica + pull (`/api/tip`, `/api/headers`, `/api/blocks`). |

## Tests

```bash
node --test tests/*.js
```

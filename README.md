# gnfp-node

Join the single $GNFP book in Germany (**gnfp-node 1.0.1**). This process relays stratum and serves a local HTTP replica of the book. It does not start a second chain. Verify-before-adopt: a replica will not take a mutated or same-height competing book.

- Book: `de.restoreprivacy.online:1474` (TLS by default; `--notls` for local plaintext)
- Verify-before-adopt: a replica will not take a mutated or same-height competing book
- Also join via `sg.restoreprivacy.online:1474` or `hel.restoreprivacy.online:1474`
- Pool: https://gnfp.restoreprivacy.online
- Explorer: https://explorer.restoreprivacy.online

## Run

Needs Node.js 18+.

```
node src/node.js --hub de.restoreprivacy.online:1474
# add --notls only for a local plaintext loopback
```

HTTP replica on `0.0.0.0:8014`. Local stratum on `0.0.0.0:1474` (relays to the book).

```
--hub HOST:PORT     Germany book (default de.restoreprivacy.online:1474)
--http-port N       local HTTP (default 8014)
--stratum-port N    local stratum relay (default 1474)
--replica-only      HTTP only, no local stratum
--announce-host H   public host the book should count as online
--announce-url URL  default https://explorer.restoreprivacy.online/api/nodes
--role join|pool|solo
--help
```

Third-party nodes, other pools, and solo miners check in with a POST to `/api/nodes` so explorer **Nodes online** includes them:

```
curl -X POST https://explorer.restoreprivacy.online/api/nodes \
  -H 'content-type: application/json' \
  -d '{"host":"mynode.example","port":1474,"role":"join"}'
```

## Install packs

See GitHub Releases on [rgsneddon/gnfp-node](https://github.com/rgsneddon/gnfp-node/releases).

Windows: `pack\win\gnfp-node.cmd --hub de.restoreprivacy.online:1474`  
Unix: `./pack/unix/gnfp-node --hub de.restoreprivacy.online:1474`

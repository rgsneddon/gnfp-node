# gnfp-node

Join the single $GNFP book in Germany. This process relays stratum and serves a local HTTP replica of the book. It does not start a second chain.

- Book: `de.restoreprivacy.online:1474`
- Also join via `sg.restoreprivacy.online:1474` or `hel.restoreprivacy.online:1474`
- Pool: https://gnfp.restoreprivacy.online
- Explorer: https://explorer.restoreprivacy.online

## Run

Needs Node.js 18+.

```
node src/node.js --hub de.restoreprivacy.online:1474
```

HTTP replica on `0.0.0.0:8014`. Local stratum on `0.0.0.0:1474` (relays to the book).

```
--hub HOST:PORT     Germany book (default de.restoreprivacy.online:1474)
--http-port N       local HTTP (default 8014)
--stratum-port N    local stratum relay (default 1474)
--replica-only      HTTP only, no local stratum
--help
```

## Install packs

See GitHub Releases on [rgsneddon/gnfp-node](https://github.com/rgsneddon/gnfp-node/releases).

Windows: `pack\win\gnfp-node.cmd --hub de.restoreprivacy.online:1474`  
Unix: `./pack/unix/gnfp-node --hub de.restoreprivacy.online:1474`

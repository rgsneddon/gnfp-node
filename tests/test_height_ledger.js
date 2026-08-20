import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  reconstructSpendable,
  stampLedgerTx,
  txsFromSealedBlocks,
} from '../src/gnfp_height_ledger.js';

const env = { GNFP_PRIVACY_SALT: 'test-gnfp-privacy-salt' };

test('node reconstructs owner spendable from sealed block txs with gnfp1 + shear', () => {
  const alice = 'gnfp1aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
  const bob = 'gnfp1bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';
  const blocks = [
    {
      height: 10,
      hash: 'aa'.repeat(32),
      miner: alice,
      amount: 1,
      txs: [
        stampLedgerTx({
          id: 'm1',
          from: 'coinbase',
          to: alice,
          amount: 20,
          kind: 'mine',
        }, { height: 10, epochHash: 'aa'.repeat(32), env }),
      ],
    },
    {
      height: 11,
      hash: 'bb'.repeat(32),
      txs: [
        stampLedgerTx({
          id: 's1',
          from: alice,
          to: bob,
          amount: 7,
          kind: 'send',
        }, { height: 11, epochHash: 'bb'.repeat(32), env }),
      ],
    },
  ];
  const rows = txsFromSealedBlocks(blocks);
  const aliceShear = rows.find((t) => t.to === alice)?.shearTo;
  assert.match(String(aliceShear), /^shear-/);
  assert.equal(reconstructSpendable(rows, { address: alice, env }), 13);
  assert.equal(reconstructSpendable(rows, { address: bob, env }), 7);
  const spoof = stampLedgerTx({
    id: 'spoof',
    from: 'coinbase',
    to: alice,
    amount: 100,
    kind: 'mine',
    shearTo: 'shear-deadbeef',
  }, { height: 12, epochHash: 'cc'.repeat(32), env });
  assert.equal(reconstructSpendable([...rows, spoof], { address: alice, env }), 13);
});

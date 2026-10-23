// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 FutureWebService
/**
 * Batch → chain → bundles. The one place that turns a list of pending records into
 * an anchored Merkle batch and one proof bundle per record. Storage-agnostic: the
 * caller persists whatever it needs (the integration layer stores the paths).
 */

import { bundleSchema, type ProofBundle } from './bundle';
import { leafData, toHex, type ProofKind } from './commit';
import type { ChainAdapter } from './chain/adapter';
import { buildBatch } from './merkle';

export interface PendingRecord {
  kind: ProofKind;
  contentDigest: Uint8Array;
  salt: Uint8Array;
}

export async function anchorBatch(
  records: PendingRecord[],
  adapter: ChainAdapter,
): Promise<{ root: string; bundles: ProofBundle[] }> {
  const batch = await buildBatch(records.map((r) => leafData(r.kind, r.contentDigest, r.salt)));
  const root = toHex(batch.root);
  const receipt = await adapter.anchor(root, batch.leafCount);
  const bundles = records.map((r, i) =>
    bundleSchema.parse({
      v: 1,
      kind: r.kind,
      salt: toHex(r.salt),
      leafIndex: i,
      leafCount: batch.leafCount,
      path: batch.paths[i].map(toHex),
      root,
      anchor: {
        cluster: receipt.cluster,
        signature: receipt.signature,
        slot: receipt.slot,
        blockTime: receipt.blockTime,
      },
      anchorer: receipt.anchorer,
    }),
  );
  return { root, bundles };
}

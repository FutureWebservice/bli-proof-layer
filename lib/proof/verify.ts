// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 FutureWebService
/**
 * Verification core. Pure of any storage: give it a bundle, the file's digest, a
 * ChainAdapter and the published anchorer addresses.
 *
 * Checks (all must pass):
 *   merkle    — digest + salt + path reproduce the bundle's root (offline)
 *   chain     — the anchor transaction exists, succeeded, holds a proof memo
 *   root      — the on-chain root equals the bundle's root (and leaf count)
 *   anchorer  — the transaction was signed by an address we publish. Without this a
 *               Memo transaction proves nothing: anyone can write any memo.
 */

import type { ProofBundle } from './bundle';
import { fromHex, leafData, sha256 } from './commit';
import type { ChainAdapter } from './chain/adapter';
import { verifyInclusion } from './merkle';

export type CheckId = 'merkle' | 'chain' | 'root' | 'anchorer';

export interface VerifyResult {
  /** verified = all checks pass; failed = at least one proves mismatch; unreachable = chain could not be read. */
  status: 'verified' | 'failed' | 'unreachable';
  checks: { id: CheckId; ok: boolean; detail?: string }[];
  /** Unix seconds from the chain; present only when verified. */
  anchoredAt?: number;
  slot?: number;
}

export async function verifyProof(params: {
  bundle: ProofBundle;
  /** SHA-256 of the file (or of the JCS-canonical JSON) being verified. */
  contentDigest: Uint8Array;
  adapter: ChainAdapter;
  /** Anchorer addresses the verifier trusts (published by the operator). */
  trustedAnchorers: readonly string[];
}): Promise<VerifyResult> {
  const { bundle, contentDigest, adapter, trustedAnchorers } = params;
  const checks: VerifyResult['checks'] = [];

  let merkleOk = false;
  try {
    merkleOk = await verifyInclusion({
      leafData: leafData(bundle.kind, contentDigest, fromHex(bundle.salt, 32)),
      index: bundle.leafIndex,
      leafCount: bundle.leafCount,
      path: bundle.path.map((p) => fromHex(p, 32)),
      root: fromHex(bundle.root, 32),
    });
  } catch {
    merkleOk = false;
  }
  checks.push({ id: 'merkle', ok: merkleOk, detail: merkleOk ? undefined : 'file does not match this proof bundle' });

  let obs;
  try {
    obs = await adapter.lookup({ cluster: bundle.anchor.cluster, signature: bundle.anchor.signature });
  } catch (err) {
    checks.push({ id: 'chain', ok: false, detail: `chain unreachable: ${(err as Error).message}` });
    return { status: 'unreachable', checks };
  }
  checks.push({ id: 'chain', ok: obs !== null, detail: obs ? undefined : 'anchor transaction not found or not a valid proof memo' });

  const rootOk = obs !== null && obs.root === bundle.root && obs.leafCount === bundle.leafCount;
  checks.push({ id: 'root', ok: rootOk, detail: rootOk ? undefined : 'on-chain root differs from the bundle' });

  const anchorerOk =
    obs !== null && obs.anchorer === bundle.anchorer && trustedAnchorers.includes(obs.anchorer);
  checks.push({
    id: 'anchorer',
    ok: anchorerOk,
    detail: anchorerOk ? undefined : 'transaction was not signed by a trusted anchorer address',
  });

  const ok = checks.every((c) => c.ok);
  return ok && obs
    ? { status: 'verified', checks, anchoredAt: obs.blockTime, slot: obs.slot }
    : { status: 'failed', checks };
}

/** Convenience: verify raw file bytes. */
export async function verifyFile(
  params: Omit<Parameters<typeof verifyProof>[0], 'contentDigest'> & { bytes: Uint8Array },
): Promise<VerifyResult> {
  return verifyProof({ ...params, contentDigest: await sha256(params.bytes) });
}

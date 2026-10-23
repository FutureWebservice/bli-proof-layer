// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 FutureWebService
/**
 * RFC 6962 / RFC 9162 Merkle tree over SHA-256 (the Certificate Transparency
 * construction): leaf = H(0x00 ‖ data), node = H(0x01 ‖ left ‖ right). The distinct
 * prefixes rule out second-preimage attacks (an inner node can never pass as a
 * leaf). Odd trees are not padded — the left subtree is the largest power of two
 * strictly smaller than n — so no leaf is ever duplicated.
 *
 * Note: an inclusion proof binds a leaf to the root and its index, NOT to the tree size.
 * The size is authenticated by the anchor (the on-chain memo carries root + leafCount)
 * and checked in verify.ts.
 *
 * Inclusion-proof verification follows RFC 9162 §2.1.3.2 and is cross-checked in
 * tests against vectors from an independent implementation.
 */

import { concat, sha256 } from './commit';

const LEAF_PREFIX = new Uint8Array([0x00]);
const NODE_PREFIX = new Uint8Array([0x01]);

export async function hashLeaf(data: Uint8Array): Promise<Uint8Array> {
  return sha256(concat(LEAF_PREFIX, data));
}

async function hashNode(left: Uint8Array, right: Uint8Array): Promise<Uint8Array> {
  return sha256(concat(NODE_PREFIX, left, right));
}

/** Largest power of two strictly smaller than n (n >= 2). */
function split(n: number): number {
  let k = 1;
  while (k * 2 < n) k *= 2;
  return k;
}

/** Merkle tree hash over already-hashed leaves. */
async function mth(leaves: Uint8Array[]): Promise<Uint8Array> {
  if (leaves.length === 1) return leaves[0];
  const k = split(leaves.length);
  return hashNode(await mth(leaves.slice(0, k)), await mth(leaves.slice(k)));
}

async function auditPath(index: number, leaves: Uint8Array[]): Promise<Uint8Array[]> {
  if (leaves.length === 1) return [];
  const k = split(leaves.length);
  return index < k
    ? [...(await auditPath(index, leaves.slice(0, k))), await mth(leaves.slice(k))]
    : [...(await auditPath(index - k, leaves.slice(k))), await mth(leaves.slice(0, k))];
}

export interface MerkleBatch {
  root: Uint8Array;
  leafCount: number;
  /** One inclusion path per input leaf, same order. */
  paths: Uint8Array[][];
}

/** Build a batch from raw leaf data. Empty batches are rejected: never anchor nothing. */
export async function buildBatch(leafDatas: Uint8Array[]): Promise<MerkleBatch> {
  if (leafDatas.length === 0) throw new Error('buildBatch: at least one leaf required');
  const leaves = await Promise.all(leafDatas.map(hashLeaf));
  const paths: Uint8Array[][] = [];
  for (let i = 0; i < leaves.length; i++) paths.push(await auditPath(i, leaves));
  return { root: await mth(leaves), leafCount: leaves.length, paths };
}

const eq = (a: Uint8Array, b: Uint8Array) => a.length === b.length && a.every((v, i) => v === b[i]);

/** RFC 9162 §2.1.3.2: true iff `path` proves leaf `index` of `leafCount` under `root`. */
export async function verifyInclusion(params: {
  leafData: Uint8Array;
  index: number;
  leafCount: number;
  path: Uint8Array[];
  root: Uint8Array;
}): Promise<boolean> {
  const { index, leafCount, path, root } = params;
  if (!Number.isInteger(index) || !Number.isInteger(leafCount) || index < 0 || index >= leafCount) return false;
  let fn = index;
  let sn = leafCount - 1;
  let r = await hashLeaf(params.leafData);
  for (const p of path) {
    if (sn === 0) return false;
    if ((fn & 1) === 1 || fn === sn) {
      r = await hashNode(p, r);
      if ((fn & 1) === 0) {
        while ((fn & 1) === 0 && fn !== 0) {
          fn >>= 1;
          sn >>= 1;
        }
      }
    } else {
      r = await hashNode(r, p);
    }
    fn >>= 1;
    sn >>= 1;
  }
  return sn === 0 && eq(r, root);
}

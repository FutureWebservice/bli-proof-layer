// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 FutureWebService
// @vitest-environment node
import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { buildBatch, verifyInclusion } from '../merkle';
import { fromHex, toHex } from '../commit';
import vectors from './merkle-vectors.json';

const hexes = (a: Uint8Array[]) => a.map(toHex);

describe('RFC 6962 Merkle tree', () => {
  it('matches the Certificate Transparency reference roots for 1–8 leaves', async () => {
    const leaves = vectors.ctLeaves.map((h) => fromHex(h));
    for (const [n, root] of Object.entries(vectors.ctRoots)) {
      const batch = await buildBatch(leaves.slice(0, Number(n)));
      expect(toHex(batch.root), `n=${n}`).toBe(root);
    }
  });

  it('matches roots and audit paths from the independent implementation', async () => {
    for (const c of vectors.cases) {
      const batch = await buildBatch(c.leaves.map((h) => fromHex(h)));
      expect(batch.leafCount).toBe(c.n);
      expect(toHex(batch.root)).toBe(c.root);
      batch.paths.forEach((p, i) => expect(hexes(p)).toEqual(c.paths[i]));
    }
  });

  it('every path verifies', async () => {
    for (const c of vectors.cases) {
      const leaves = c.leaves.map((h) => fromHex(h));
      const root = fromHex(c.root);
      for (let i = 0; i < c.n; i++) {
        const ok = await verifyInclusion({
          leafData: leaves[i], index: i, leafCount: c.n, path: c.paths[i].map((h) => fromHex(h)), root,
        });
        expect(ok, `n=${c.n} i=${i}`).toBe(true);
      }
    }
  });

  it('refuses an empty batch', async () => {
    await expect(buildBatch([])).rejects.toThrow();
  });

  it('rejects out-of-range indices and bad leaf counts', async () => {
    const b = await buildBatch([new Uint8Array([1]), new Uint8Array([2]), new Uint8Array([3])]);
    const base = { leafData: new Uint8Array([1]), path: b.paths[0], root: b.root };
    expect(await verifyInclusion({ ...base, index: 0, leafCount: 3 })).toBe(true);
    expect(await verifyInclusion({ ...base, index: 3, leafCount: 3 })).toBe(false);
    expect(await verifyInclusion({ ...base, index: -1, leafCount: 3 })).toBe(false);
    expect(await verifyInclusion({ ...base, index: 0, leafCount: 0 })).toBe(false);
    expect(await verifyInclusion({ ...base, index: 0, leafCount: 2.5 })).toBe(false);
  });
});

describe('Merkle properties', () => {
  const leafArb = fc.uint8Array({ minLength: 1, maxLength: 70 });

  it('accepts every leaf of any batch; rejects any single-byte tamper', async () => {
    await fc.assert(
      fc.asyncProperty(fc.array(leafArb, { minLength: 1, maxLength: 24 }), fc.nat(), fc.nat(), async (leaves, pick, bit) => {
        const batch = await buildBatch(leaves);
        const i = pick % leaves.length;
        const good = { leafData: leaves[i], index: i, leafCount: batch.leafCount, path: batch.paths[i], root: batch.root };
        expect(await verifyInclusion(good)).toBe(true);

        // flip one bit of the leaf
        const bad = Uint8Array.from(leaves[i]);
        bad[bit % bad.length] ^= 1 << (bit % 8);
        expect(await verifyInclusion({ ...good, leafData: bad })).toBe(false);

        // flip one bit of the root
        const badRoot = Uint8Array.from(batch.root);
        badRoot[bit % 32] ^= 1 << (bit % 8);
        expect(await verifyInclusion({ ...good, root: badRoot })).toBe(false);

        // flip one bit of a path element
        if (batch.paths[i].length > 0) {
          const j = bit % batch.paths[i].length;
          const badPath = batch.paths[i].map((p) => Uint8Array.from(p));
          badPath[j][bit % 32] ^= 1 << (bit % 8);
          expect(await verifyInclusion({ ...good, path: badPath })).toBe(false);
        }

        // a truncated or extended path never verifies
        if (batch.paths[i].length > 0) expect(await verifyInclusion({ ...good, path: batch.paths[i].slice(1) })).toBe(false);
        expect(await verifyInclusion({ ...good, path: [...batch.paths[i], new Uint8Array(32)] })).toBe(false);
      }),
      { numRuns: 60 },
    );
  });

  // The leaf COUNT is deliberately not asserted here: an RFC 6962 inclusion proof binds the
  // leaf to the root and its index, but not the tree size. The size is authenticated by the
  // on-chain memo (`root + leafCount`), which verifyProof compares — see verify.test.ts.
  it('a proof is bound to its index', async () => {
    await fc.assert(
      fc.asyncProperty(fc.array(leafArb, { minLength: 2, maxLength: 20 }), fc.nat(), async (leaves, pick) => {
        const unique = leaves.map((l, k) => Uint8Array.from([k, ...l])); // make leaves distinct
        const batch = await buildBatch(unique);
        const i = pick % unique.length;
        const good = { leafData: unique[i], index: i, leafCount: batch.leafCount, path: batch.paths[i], root: batch.root };
        expect(await verifyInclusion({ ...good, index: (i + 1) % unique.length })).toBe(false);
      }),
      { numRuns: 40 },
    );
  });
});

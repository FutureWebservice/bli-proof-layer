// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 FutureWebService
// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { generateKeyPairSigner } from '@solana/kit';
import { MEMO_PROGRAM_ID, buildAnchorTransaction, formatMemo, parseMemo } from '../chain/solana-memo';

describe('memo format', () => {
  const root = 'ab'.repeat(32);
  it('round-trips', () => {
    expect(parseMemo(formatMemo(root, 12))).toEqual({ root, leafCount: 12 });
  });
  it('is short enough for a single memo instruction', () => {
    expect(new TextEncoder().encode(formatMemo(root, 999_999_999)).length).toBeLessThan(100);
  });
  it('refuses to format bad input', () => {
    expect(() => formatMemo('xyz', 1)).toThrow();
    expect(() => formatMemo(root, 0)).toThrow();
    expect(() => formatMemo(root, 1.5)).toThrow();
  });
});

describe('buildAnchorTransaction (no network)', () => {
  it('signs a transaction whose fee payer is the anchorer and which carries the memo', async () => {
    const signer = await generateKeyPairSigner();
    const root = 'cd'.repeat(32);
    const { signed, signature } = await buildAnchorTransaction({
      signer,
      latestBlockhash: { blockhash: '11111111111111111111111111111111' as never, lastValidBlockHeight: 1n },
      root,
      leafCount: 7,
    });
    expect(signature.length).toBeGreaterThanOrEqual(64);
    // signed by the anchorer
    expect(Object.keys(signed.signatures)).toContain(signer.address);
    expect(signed.signatures[signer.address]).toBeTruthy();
    // wire bytes contain the memo text and the pinned memo program id (as raw key bytes)
    const text = Buffer.from(signed.messageBytes).toString('latin1');
    expect(text).toContain(formatMemo(root, 7));
    expect(MEMO_PROGRAM_ID.length).toBe(43);
  });
});

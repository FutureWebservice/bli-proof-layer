// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 FutureWebService
// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { anchorBatch } from '../anchor';
import { parseBundle, type ProofBundle } from '../bundle';
import { newSalt, sha256, toHex } from '../commit';
import { verifyFile } from '../verify';
import { ACCEPTED_MEMO_PROGRAM_IDS, MEMO_PROGRAM_ID, formatMemo } from '../chain/solana-memo';
import { createMockChain, fakeAddress, fakeSignature, memoTx } from './helpers';

const ANCHORER = fakeAddress(1);
const ATTACKER = fakeAddress(2);
const enc = (s: string) => new TextEncoder().encode(s);

async function setup(files: string[]) {
  const chain = createMockChain(ANCHORER);
  const records = await Promise.all(
    files.map(async (f) => ({ kind: 'disclosure' as const, contentDigest: await sha256(enc(f)), salt: newSalt() })),
  );
  const { bundles } = await anchorBatch(records, chain.adapter);
  return { chain, bundles };
}
const verify = (chain: ReturnType<typeof createMockChain>, bundle: ProofBundle, file: string, trusted = [ANCHORER]) =>
  verifyFile({ bundle, bytes: enc(file), adapter: chain.adapter, trustedAnchorers: trusted });
const failedIds = (r: Awaited<ReturnType<typeof verify>>) => r.checks.filter((c) => !c.ok).map((c) => c.id);

describe('anchor → verify end to end (mock chain, real interpretation code)', () => {
  const files = ['alpha invention', 'beta invention', 'gamma invention', 'delta invention', 'epsilon invention'];

  it('verifies every record of a batch and reports the chain time', async () => {
    const { chain, bundles } = await setup(files);
    for (let i = 0; i < files.length; i++) {
      const r = await verify(chain, bundles[i], files[i]);
      expect(r.status).toBe('verified');
      expect(r.checks.every((c) => c.ok)).toBe(true);
      expect(r.anchoredAt).toBeGreaterThan(1_800_000_000);
    }
  });

  it('survives a JSON round trip of the bundle', async () => {
    const { chain, bundles } = await setup(files);
    const restored = parseBundle(JSON.stringify(bundles[2]));
    expect((await verify(chain, restored, files[2])).status).toBe('verified');
  });

  it('a tampered file fails the merkle check only', async () => {
    const { chain, bundles } = await setup(files);
    const r = await verify(chain, bundles[1], 'beta invention (edited)');
    expect(r.status).toBe('failed');
    expect(failedIds(r)).toEqual(['merkle']);
  });

  it("another record's file does not verify against this bundle", async () => {
    const { chain, bundles } = await setup(files);
    expect(failedIds(await verify(chain, bundles[0], files[1]))).toEqual(['merkle']);
  });

  it('a wrong salt fails', async () => {
    const { chain, bundles } = await setup(files);
    const forged = { ...bundles[0], salt: toHex(newSalt()) };
    expect(failedIds(await verify(chain, forged, files[0]))).toContain('merkle');
  });

  it('a forged root (bundle edited to match a different tree) fails against the chain', async () => {
    const { chain, bundles } = await setup(files);
    const forged = { ...bundles[0], root: '0'.repeat(64) };
    const r = await verify(chain, forged, files[0]);
    expect(r.status).toBe('failed');
    expect(failedIds(r)).toEqual(expect.arrayContaining(['merkle', 'root']));
  });

  it('a lied-about leafCount fails (the count is authenticated by the memo)', async () => {
    const { chain, bundles } = await setup(files);
    const forged = { ...bundles[0], leafCount: bundles[0].leafCount + 1 };
    expect((await verify(chain, forged, files[0])).status).toBe('failed');
  });

  it('REJECTS a fake memo written by someone else (untrusted signer)', async () => {
    const { chain, bundles } = await setup(files);
    // The attacker anchors the very same root with their own key and rewrites the bundle.
    const attackerChain = createMockChain(ATTACKER);
    const receipt = await attackerChain.adapter.anchor(bundles[0].root, bundles[0].leafCount);
    attackerChain.txs.forEach((v, k) => chain.txs.set(k, v));
    const forged = { ...bundles[0], anchor: { ...bundles[0].anchor, signature: receipt.signature }, anchorer: receipt.anchorer };
    const r = await verify(chain, forged, files[0]);
    expect(r.status).toBe('failed');
    expect(failedIds(r)).toEqual(['anchorer']);
  });

  it('REJECTS a bundle claiming a trusted anchorer when the transaction was signed by another', async () => {
    const { chain, bundles } = await setup(files);
    const attacker = createMockChain(ATTACKER);
    const receipt = await attacker.adapter.anchor(bundles[0].root, bundles[0].leafCount);
    attacker.txs.forEach((v, k) => chain.txs.set(k, v));
    const forged = { ...bundles[0], anchor: { ...bundles[0].anchor, signature: receipt.signature } }; // keeps anchorer = ANCHORER
    expect(failedIds(await verify(chain, forged, files[0]))).toEqual(['anchorer']);
  });

  it('an unknown signature is "failed", not "verified"', async () => {
    const { chain, bundles } = await setup(files);
    const forged = { ...bundles[0], anchor: { ...bundles[0].anchor, signature: fakeSignature(200) } };
    const r = await verify(chain, forged, files[0]);
    expect(r.status).toBe('failed');
    expect(failedIds(r)).toContain('chain');
  });

  it('an unreachable chain is reported as such, never as a verdict on the file', async () => {
    const { bundles } = await setup(files);
    const down = { anchor: async () => { throw new Error('x'); }, lookup: async () => { throw new Error('rpc 429'); } };
    const r = await verifyFile({ bundle: bundles[0], bytes: enc(files[0]), adapter: down, trustedAnchorers: [ANCHORER] });
    expect(r.status).toBe('unreachable');
    expect(r.checks.find((c) => c.id === 'merkle')?.ok).toBe(true);
  });

  it('an empty trusted set trusts nothing', async () => {
    const { chain, bundles } = await setup(files);
    expect((await verify(chain, bundles[0], files[0], [])).status).toBe('failed');
  });

  it('ai_trace and disclosure leaves are not interchangeable', async () => {
    const { chain, bundles } = await setup(files);
    expect(failedIds(await verify(chain, { ...bundles[0], kind: 'ai_trace' }, files[0]))).toContain('merkle');
  });
});

describe('bundle schema', () => {
  it('rejects unknown fields, bad hex and out-of-range indices', async () => {
    const { bundles } = await setup(['a', 'b']);
    expect(() => parseBundle({ ...bundles[0], extra: 1 })).toThrow();
    expect(() => parseBundle({ ...bundles[0], root: 'AB' })).toThrow();
    expect(() => parseBundle({ ...bundles[0], leafIndex: 2 })).toThrow();
    expect(() => parseBundle({ ...bundles[0], v: 2 })).toThrow();
    expect(() => parseBundle({ ...bundles[0], anchorer: 'not-an-address' })).toThrow();
    expect(() => parseBundle({ ...bundles[0], anchor: { ...bundles[0].anchor, signature: 'abc' } })).toThrow();
    expect(() => parseBundle({ ...bundles[0], kind: 'nft' })).toThrow();
  });
});

describe('memo interpretation edge cases', () => {
  const root = 'a'.repeat(64);
  const good = formatMemo(root, 3);
  const chainWith = (tx: unknown) => {
    const c = createMockChain(ANCHORER);
    c.txs.set(fakeSignature(77), tx);
    return c.adapter.lookup({ cluster: 'devnet', signature: fakeSignature(77) });
  };

  it('accepts the canonical anchor transaction', async () => {
    expect(await chainWith(memoTx({ feePayer: ANCHORER, memo: good }))).toMatchObject({ root, leafCount: 3, anchorer: ANCHORER });
  });

  it.each([
    ['failed transaction', memoTx({ feePayer: ANCHORER, memo: good, err: { InstructionError: [0, 'x'] } })],
    ['no block time', memoTx({ feePayer: ANCHORER, memo: good, blockTime: null })],
    ['wrong program', memoTx({ feePayer: ANCHORER, memo: good, programId: 'Memo1UhkJRfHyvLMcVucJwxXeuD728EqVDDwQDxFMNo' })],
    ['fee payer did not sign', memoTx({ feePayer: ANCHORER, memo: good, signer: false })],
    ['foreign memo text', memoTx({ feePayer: ANCHORER, memo: 'hello world' })],
    ['uppercase root', memoTx({ feePayer: ANCHORER, memo: `proof/1 ${'A'.repeat(64)} 3` })],
    ['zero leaves', memoTx({ feePayer: ANCHORER, memo: `proof/1 ${root} 0` })],
    ['trailing junk', memoTx({ feePayer: ANCHORER, memo: `${good} extra` })],
    ['two proof memos (ambiguous)', memoTx({ feePayer: ANCHORER, memo: good, extraMemos: [formatMemo('b'.repeat(64), 1)] })],
    ['unparsed memo data', memoTx({ feePayer: ANCHORER, memo: { raw: 1 } })],
    ['garbage', { foo: 1 }],
  ])('rejects: %s', async (_n, tx) => {
    expect(await chainWith(tx)).toBeNull();
  });

  it('ignores a non-proof memo next to exactly one proof memo', async () => {
    expect(await chainWith(memoTx({ feePayer: ANCHORER, memo: good, extraMemos: ['unrelated note'] }))).not.toBeNull();
  });

  it('builds with the library default and accepts exactly the two known memo programs', () => {
    expect(MEMO_PROGRAM_ID).toBe('Memo4c2pN8afCj432Lb7RMVKi9PbQnnW7ewFFaV3oAH'); // seen in the live devnet run
    expect([...ACCEPTED_MEMO_PROGRAM_IDS].sort()).toEqual(
      ['Memo4c2pN8afCj432Lb7RMVKi9PbQnnW7ewFFaV3oAH', 'MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr'].sort(),
    );
  });

  it('accepts the older memo program id too', async () => {
    const obs = await chainWith(memoTx({ feePayer: ANCHORER, memo: good, programId: 'MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr' }));
    expect(obs).not.toBeNull();
  });
});

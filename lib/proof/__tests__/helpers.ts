// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 FutureWebService
import { getBase58Decoder } from '@solana/kit';
import type { AnchorObservation, AnchorReceipt, ChainAdapter } from '../chain/adapter';
import { MEMO_PROGRAM_ID, formatMemo, observeTransaction } from '../chain/solana-memo';

/**
 * In-memory "chain" that behaves like the Solana adapter: it stores jsonParsed-shaped
 * transactions and reads them back through the REAL observeTransaction(), so tests
 * exercise the same interpretation code as production. `anchorer` is whoever signs.
 */
/** Deterministic valid base58 address / signature for fixtures. */
export const fakeAddress = (n: number) => getBase58Decoder().decode(new Uint8Array(32).fill(n));
export const fakeSignature = (n: number) => getBase58Decoder().decode(new Uint8Array(64).fill(n));

export function createMockChain(anchorer: string, opts: { cluster?: 'devnet' | 'localnet' } = {}) {
  const cluster = opts.cluster ?? 'devnet';
  const txs = new Map<string, unknown>();
  let n = 0;
  let slot = 1000;
  const adapter: ChainAdapter = {
    async anchor(root, leafCount): Promise<AnchorReceipt> {
      const signature = fakeSignature(++n);
      txs.set(signature, memoTx({ feePayer: anchorer, memo: formatMemo(root, leafCount), slot: ++slot, blockTime: 1_800_000_000 + n }));
      return { cluster, signature, anchorer, slot, blockTime: 1_800_000_000 + n };
    },
    async lookup({ signature }): Promise<AnchorObservation | null> {
      const raw = txs.get(signature);
      return raw === undefined ? null : observeTransaction(raw);
    },
  };
  return { adapter, txs };
}

export function memoTx(o: {
  feePayer: string;
  memo: string | unknown;
  slot?: number;
  blockTime?: number | null;
  err?: unknown;
  programId?: string;
  signer?: boolean;
  extraMemos?: string[];
}) {
  const ix = (m: unknown) => ({ programId: o.programId ?? MEMO_PROGRAM_ID, parsed: m });
  return {
    slot: o.slot ?? 1,
    blockTime: o.blockTime === undefined ? 1_800_000_000 : o.blockTime,
    meta: { err: o.err ?? null },
    transaction: {
      message: {
        accountKeys: [{ pubkey: o.feePayer, signer: o.signer ?? true }],
        instructions: [ix(o.memo), ...(o.extraMemos ?? []).map(ix)],
      },
    },
  };
}

// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 FutureWebService
/**
 * Solana adapter: anchors a Merkle root as a *signed* Memo-program instruction.
 *
 * Why signed: the Memo program lets anyone write any text, so an unsigned memo
 * proves nothing. We require the instruction to carry the anchorer as a signer
 * and verification pins the transaction's fee payer to a published address.
 *
 * Memo text: `proof/1 <root hex> <leafCount>` (UTF-8, ~80 bytes).
 * Program ids: we BUILD with the default of @solana-program/memo (Memo4c2…) and ACCEPT
 * that one plus the older MemoSq4… deployment. Both were checked as executable programs
 * on devnet and mainnet-beta on 2026-10-20; the first live devnet run showed that the
 * library default is the one that actually appears in transactions. Which of the two
 * programs carried the memo is immaterial to trust — the signer check is what binds it.
 */

import {
  appendTransactionMessageInstruction,
  assertIsTransactionWithBlockhashLifetime,
  createSolanaRpc,
  createSolanaRpcSubscriptions,
  createTransactionMessage,
  getSignatureFromTransaction,
  pipe,
  sendAndConfirmTransactionFactory,
  setTransactionMessageFeePayerSigner,
  setTransactionMessageLifetimeUsingBlockhash,
  signTransactionMessageWithSigners,
  type Blockhash,
  type KeyPairSigner,
} from '@solana/kit';
import { MEMO_PROGRAM_ADDRESS, getAddMemoInstruction } from '@solana-program/memo';
import { z } from 'zod';
import type { Cluster } from '../bundle';
import type { AnchorObservation, AnchorReceipt, ChainAdapter } from './adapter';

export const MEMO_PROGRAM_ID: string = MEMO_PROGRAM_ADDRESS;
export const ACCEPTED_MEMO_PROGRAM_IDS: readonly string[] = [MEMO_PROGRAM_ADDRESS, 'MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr'];
const MEMO_PREFIX = 'proof/1 ';
const MEMO_RE = /^proof\/1 ([0-9a-f]{64}) ([1-9][0-9]{0,8})$/;

export function formatMemo(root: string, leafCount: number): string {
  if (!/^[0-9a-f]{64}$/.test(root)) throw new Error('root must be 32 bytes of lowercase hex');
  if (!Number.isInteger(leafCount) || leafCount < 1) throw new Error('leafCount must be a positive integer');
  return `${MEMO_PREFIX}${root} ${leafCount}`;
}

export function parseMemo(memo: string): { root: string; leafCount: number } | null {
  const m = MEMO_RE.exec(memo);
  return m ? { root: m[1], leafCount: Number(m[2]) } : null;
}

/** Build and sign the anchoring transaction (no network). Exported for tests. */
export async function buildAnchorTransaction(params: {
  signer: KeyPairSigner;
  latestBlockhash: { blockhash: Blockhash; lastValidBlockHeight: bigint };
  root: string;
  leafCount: number;
}) {
  const { signer, latestBlockhash, root, leafCount } = params;
  const message = pipe(
    createTransactionMessage({ version: 0 }),
    (m) => setTransactionMessageFeePayerSigner(signer, m),
    (m) => setTransactionMessageLifetimeUsingBlockhash(latestBlockhash, m),
    (m) => appendTransactionMessageInstruction(getAddMemoInstruction({ memo: formatMemo(root, leafCount), signers: [signer] }), m),
  );
  const signed = await signTransactionMessageWithSigners(message);
  assertIsTransactionWithBlockhashLifetime(signed);
  return { signed, signature: getSignatureFromTransaction(signed) };
}

// Only the fields verification relies on; anything else in the RPC reply is ignored.
const txSchema = z.object({
  slot: z.number(),
  blockTime: z.number().nullable(),
  meta: z.object({ err: z.unknown() }).nullable(),
  transaction: z.object({
    message: z.object({
      accountKeys: z.array(z.object({ pubkey: z.string(), signer: z.boolean() })),
      instructions: z.array(z.object({ programId: z.string(), parsed: z.unknown().optional() })),
    }),
  }),
});

/** Interpret an RPC `jsonParsed` transaction as an anchor, or null if it is not one. */
export function observeTransaction(raw: unknown): AnchorObservation | null {
  const parsed = txSchema.safeParse(raw);
  if (!parsed.success) return null;
  const tx = parsed.data;
  if (tx.meta === null || tx.meta.err !== null || tx.blockTime === null) return null;

  const feePayer = tx.transaction.message.accountKeys[0];
  if (!feePayer || !feePayer.signer) return null;

  // Exactly one proof memo; two would make "which root was anchored" ambiguous.
  const memos = tx.transaction.message.instructions
    .filter((ix) => ACCEPTED_MEMO_PROGRAM_IDS.includes(ix.programId) && typeof ix.parsed === 'string')
    .map((ix) => parseMemo(ix.parsed as string))
    .filter((m): m is NonNullable<typeof m> => m !== null);
  if (memos.length !== 1) return null;

  return { ...memos[0], anchorer: feePayer.pubkey, slot: tx.slot, blockTime: tx.blockTime };
}

const DEFAULT_HTTP: Partial<Record<Cluster, string>> = {
  devnet: 'https://api.devnet.solana.com',
  'mainnet-beta': 'https://api.mainnet-beta.solana.com',
};

export interface SolanaMemoAdapterOptions {
  cluster: Cluster;
  /** HTTP RPC endpoint; defaults to the public endpoint of the cluster. */
  rpcUrl?: string;
  /** Required for anchor(); not needed for lookup(). */
  signer?: KeyPairSigner;
  /** WebSocket RPC endpoint; defaults to rpcUrl with https→wss. */
  rpcSubscriptionsUrl?: string;
}

export function createSolanaMemoAdapter(opts: SolanaMemoAdapterOptions): ChainAdapter {
  const httpUrl = opts.rpcUrl ?? DEFAULT_HTTP[opts.cluster];
  if (!httpUrl) throw new Error(`rpcUrl is required for cluster ${opts.cluster}`);
  const rpc = createSolanaRpc(httpUrl);

  return {
    async anchor(root, leafCount): Promise<AnchorReceipt> {
      if (!opts.signer) throw new Error('anchor() requires a signer');
      const wsUrl = opts.rpcSubscriptionsUrl ?? httpUrl.replace(/^http/, 'ws');
      const rpcSubscriptions = createSolanaRpcSubscriptions(wsUrl);
      const { value: latestBlockhash } = await rpc.getLatestBlockhash().send();
      const { signed, signature } = await buildAnchorTransaction({ signer: opts.signer, latestBlockhash, root, leafCount });
      await sendAndConfirmTransactionFactory({ rpc, rpcSubscriptions })(signed, { commitment: 'finalized' });
      const obs = await this.lookup({ cluster: opts.cluster, signature });
      return {
        cluster: opts.cluster,
        signature,
        anchorer: opts.signer.address,
        slot: obs?.slot,
        blockTime: obs?.blockTime,
      };
    },

    async lookup({ cluster, signature }) {
      if (cluster !== opts.cluster) throw new Error(`adapter is for ${opts.cluster}, bundle is for ${cluster}`);
      const raw = await rpc
        .getTransaction(signature as Parameters<typeof rpc.getTransaction>[0], {
          encoding: 'jsonParsed',
          maxSupportedTransactionVersion: 0,
          commitment: 'finalized',
        })
        .send();
      // JSON-RPC replies `null` for an unknown signature; that is "not found", not an error.
      return raw === null ? null : observeTransaction(JSON.parse(JSON.stringify(raw, (_k, v) => (typeof v === 'bigint' ? Number(v) : v))));
    },
  };
}

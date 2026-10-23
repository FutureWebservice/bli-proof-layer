// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 FutureWebService
/**
 * Proof bundle: the JSON a record's holder keeps. Together with the original
 * file it is everything needed to verify; without the file (or without the salt)
 * it proves nothing, so handing someone the bundle alone discloses nothing.
 */

import { isAddress, isSignature } from '@solana/kit';
import { z } from 'zod';
import { KINDS } from './commit';

export const CLUSTERS = ['mainnet-beta', 'devnet', 'testnet', 'localnet'] as const;
export type Cluster = (typeof CLUSTERS)[number];

const hex32 = z.string().regex(/^[0-9a-f]{64}$/, 'expected 32 bytes of lowercase hex');

export const bundleSchema = z
  .object({
    v: z.literal(1),
    kind: z.enum(KINDS),
    salt: hex32,
    leafIndex: z.number().int().min(0),
    leafCount: z.number().int().min(1),
    /** RFC 6962 audit path, leaf level first. 64 levels is far beyond any real batch. */
    path: z.array(hex32).max(64),
    root: hex32,
    anchor: z.object({
      cluster: z.enum(CLUSTERS),
      /** Transaction signature (base58) of the anchoring transaction. */
      signature: z.string().refine((v): boolean => isSignature(v), 'not a base58 transaction signature'),
      /** Convenience copies; NOT trusted — verification re-reads them from the chain. */
      slot: z.number().int().optional(),
      blockTime: z.number().int().optional(),
    }),
    /** Address that signed the anchor. Must be in the verifier's trusted set. */
    anchorer: z.string().refine((v): boolean => isAddress(v), 'not a base58 address'),
  })
  .strict()
  .refine((b) => b.leafIndex < b.leafCount, { message: 'leafIndex must be < leafCount' });

export type ProofBundle = z.infer<typeof bundleSchema>;

export function parseBundle(input: unknown): ProofBundle {
  return bundleSchema.parse(typeof input === 'string' ? JSON.parse(input) : input);
}

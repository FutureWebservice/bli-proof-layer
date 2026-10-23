// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 FutureWebService
/**
 * The only seam between the proof core and a blockchain. Solana's Memo program is
 * the shipped adapter; any chain that can (1) store a short string authored by a
 * known key and (2) report when, can implement this and the rest of the core is
 * untouched.
 */

import type { Cluster } from '../bundle';

export interface AnchorReceipt {
  cluster: Cluster;
  /** Transaction signature (base58). */
  signature: string;
  /** Address that signed the anchor transaction. */
  anchorer: string;
  slot?: number;
  blockTime?: number;
}

/** What the chain says about an anchor transaction, as read back (never trusted from a bundle). */
export interface AnchorObservation {
  root: string;
  leafCount: number;
  anchorer: string;
  slot: number;
  /** Unix seconds. Validator-estimated block time, second-level accuracy. */
  blockTime: number;
}

export interface ChainAdapter {
  /** Publish `root` (lowercase hex). Resolves once the transaction is finalized. */
  anchor(root: string, leafCount: number): Promise<AnchorReceipt>;
  /**
   * Read an anchor back. Resolves `null` when the transaction does not exist, failed,
   * or does not contain exactly one well-formed proof memo. THROWS when the chain
   * cannot be reached — callers must not confuse "unreachable" with "not anchored".
   */
  lookup(ref: { cluster: Cluster; signature: string }): Promise<AnchorObservation | null>;
}

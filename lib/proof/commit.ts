// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 FutureWebService
/**
 * Commitments: what a record contributes to the Merkle tree.
 *
 *   contentDigest = SHA-256(file bytes)            (or SHA-256(JCS(json)))
 *   leaf data     = kindTag(1) ‖ contentDigest(32) ‖ salt(32)     = 65 bytes
 *
 * The random salt means the on-chain root (and any published path) reveals
 * nothing about a guessable document; only the holder of the proof bundle can
 * prove a record. The kind tag keeps a disclosure from ever being replayed as an
 * AI trace (domain separation).
 */

import { canonicalize } from './canonical';

export const KINDS = ['disclosure', 'ai_trace', 'analysis'] as const;
export type ProofKind = (typeof KINDS)[number];

const KIND_TAG: Record<ProofKind, number> = { disclosure: 1, ai_trace: 2, analysis: 3 };

export const DIGEST_BYTES = 32;
export const SALT_BYTES = 32;

export function toHex(bytes: Uint8Array): string {
  let s = '';
  for (const b of bytes) s += b.toString(16).padStart(2, '0');
  return s;
}

export function fromHex(hex: string, expectedBytes?: number): Uint8Array {
  if (hex.length % 2 !== 0 || !/^[0-9a-f]*$/.test(hex)) throw new Error('invalid lowercase hex');
  if (expectedBytes !== undefined && hex.length !== expectedBytes * 2) {
    throw new Error(`expected ${expectedBytes} bytes of hex`);
  }
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return out;
}

export async function sha256(data: Uint8Array): Promise<Uint8Array> {
  // BufferSource cast: TS 5.9 distinguishes ArrayBuffer/SharedArrayBuffer views.
  return new Uint8Array(await globalThis.crypto.subtle.digest('SHA-256', data as BufferSource));
}

export function concat(...parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

export function newSalt(): Uint8Array {
  return globalThis.crypto.getRandomValues(new Uint8Array(SALT_BYTES));
}

/** Digest of a structured record: SHA-256 over its RFC 8785 canonical form. */
export async function digestOfJson(value: unknown): Promise<Uint8Array> {
  return sha256(new TextEncoder().encode(canonicalize(value)));
}

export function leafData(kind: ProofKind, contentDigest: Uint8Array, salt: Uint8Array): Uint8Array {
  if (contentDigest.length !== DIGEST_BYTES) throw new Error('contentDigest must be 32 bytes');
  if (salt.length !== SALT_BYTES) throw new Error('salt must be 32 bytes');
  return concat(new Uint8Array([KIND_TAG[kind]]), contentDigest, salt);
}

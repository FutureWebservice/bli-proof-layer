# lib/proof — hash-only proof of existence on Solana

Self-contained: imports nothing from the rest of PatentSecure (enforced by `__tests__/boundary.test.ts`), so it can be lifted into its own package. Dependencies: `zod`, `@solana/kit`, `@solana-program/memo`, WebCrypto.

## What it proves — and what it does not

**Proves:** a record with exactly these bytes existed, and was committed by the operator's anchor key, no later than the on-chain time of the anchor transaction.

**Does not prove:**
- **Priority or ownership.** A timestamp is not a priority right, does not replace a patent application, and is not an assignment of rights. Nothing here represents ownership of a patent; there is deliberately no token or NFT.
- **Correctness.** For AI audit trails it proves the trace/result was not changed afterwards — not that the analysis is right or that logging was complete.
- **Legal recognition.** No claim is made that any court or patent office accepts it as evidence. Not legal advice.
- **Precision.** `blockTime` is a validator-estimated Unix time with second-level accuracy.

Only hashes leave the user's machine; file contents are never uploaded or written on-chain. Publishing a hash of a secret invention discloses nothing patent-relevant on its own, but novelty and confidentiality decisions remain the user's.

## Construction

```
contentDigest = SHA-256(file bytes)            | SHA-256(RFC 8785 JCS(json))
leaf data     = kindTag(1) ‖ contentDigest(32) ‖ salt(32)        kind: 1 disclosure, 2 ai_trace, 3 analysis
leaf hash     = SHA-256(0x00 ‖ leaf data)
node hash     = SHA-256(0x01 ‖ left ‖ right)                     RFC 6962 / RFC 9162, no padding
anchor memo   = "proof/1 <root hex> <leafCount>"                  signed Solana Memo-program instruction
```

- The 32-byte random salt makes a guessable document (a short text, a form) unprovable by anyone who does not hold the bundle. Deleting the salt (and record) makes the on-chain entry permanently unlinkable ("crypto-shredding"). This is a design property, not a legal guarantee under GDPR.
- Domain separation by kind tag prevents replaying a disclosure leaf as an AI-trace leaf.
- An inclusion proof binds leaf → root → index, not the tree size. The size is authenticated by the memo (`root` + `leafCount`), which `verifyProof` compares.

## Verification (`verify.ts`)

All four must pass:

| check | meaning |
|---|---|
| `merkle` | file digest + bundle salt + path reproduce the bundle root (offline) |
| `chain` | the anchor transaction exists, succeeded, and contains exactly one well-formed proof memo |
| `root` | on-chain root and leaf count equal the bundle's |
| `anchorer` | the transaction's fee payer **signed** it and is in the verifier's published trusted set |

The `anchorer` check is not optional: the Memo program lets anyone write any text, so without it a stranger could "anchor" any root. If the chain is unreachable the result is `unreachable`, never a verdict on the file.

`ChainAdapter` (`chain/adapter.ts`) is the only chain-specific seam; `chain/solana-memo.ts` is the shipped adapter. Memo program: built with the `@solana-program/memo` default `Memo4c2pN8afCj432Lb7RMVKi9PbQnnW7ewFFaV3oAH`; the older `MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr` is also accepted when verifying. Both checked as executable programs on devnet and mainnet-beta on 2026-10-20. Devnet is not a durable archive; use mainnet-beta for anchors that must outlive resets.

## Proof bundle

```json
{ "v":1, "kind":"disclosure", "salt":"<64 hex>", "leafIndex":0, "leafCount":5,
  "path":["<64 hex>", "…"], "root":"<64 hex>",
  "anchor":{"cluster":"devnet","signature":"<base58>","slot":0,"blockTime":0},
  "anchorer":"<base58 address>" }
```
`slot`/`blockTime` are conveniences and are re-read from the chain, never trusted. The bundle alone proves nothing; keep it together with the original file.

## Tests

`npx vitest --run lib/proof` — RFC 8785 examples; Merkle roots checked against the Certificate Transparency reference roots and an independent Python implementation; property tests (any single-bit tamper of leaf, root or path fails; proofs bound to index); end-to-end anchor→verify on an in-memory chain that goes through the real transaction-interpretation code; forged-signer, forged-root, wrong-salt, unreachable-chain cases; import boundary gate.

CLI (outside-repo key file, throwaway wallet only): `npx tsx scripts/proof-cli.ts keygen|airdrop|anchor|verify`.

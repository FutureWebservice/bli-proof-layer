// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 FutureWebService
/**
 * Proof Layer CLI — keygen / airdrop / anchor / verify against a Solana cluster.
 *
 *   tsx scripts/proof-cli.ts keygen  <keyfile>
 *   tsx scripts/proof-cli.ts airdrop <keyfile> [sol=1]            (devnet only)
 *   tsx scripts/proof-cli.ts anchor  <keyfile> <cluster> <outdir> <file...>
 *   tsx scripts/proof-cli.ts verify  <bundle.json> <file> --trust <addr[,addr…]> [--rpc <url>]
 *
 * The key file holds a throwaway ed25519 seed (hex). It MUST live outside the repo
 * checkout — the script refuses a path under the working directory so a key can
 * never be committed by accident. Diagnostics go to stderr; stdout carries results.
 */

import fs from 'node:fs';
import path from 'node:path';
import {
  airdropFactory,
  createKeyPairSignerFromPrivateKeyBytes,
  createSolanaRpc,
  createSolanaRpcSubscriptions,
  lamports,
} from '@solana/kit';
import { anchorBatch, createSolanaMemoAdapter, fromHex, newSalt, parseBundle, sha256, toHex, verifyFile } from '../lib/proof';
import { CLUSTERS, type Cluster } from '../lib/proof/bundle';

const say = (...a: unknown[]) => console.error(...a);

function assertOutsideRepo(file: string) {
  const abs = path.resolve(file);
  const cwd = process.cwd() + path.sep;
  if (abs.startsWith(cwd)) throw new Error(`key file must be outside the repo (${cwd}); got ${abs}`);
  return abs;
}

async function loadSigner(keyfile: string) {
  const seed = fs.readFileSync(assertOutsideRepo(keyfile), 'utf8').trim();
  return createKeyPairSignerFromPrivateKeyBytes(fromHex(seed, 32));
}

function asCluster(v: string): Cluster {
  if (!(CLUSTERS as readonly string[]).includes(v)) throw new Error(`cluster must be one of ${CLUSTERS.join(', ')}`);
  return v as Cluster;
}

async function main() {
  const [cmd, ...args] = process.argv.slice(2);
  switch (cmd) {
    case 'keygen': {
      const file = assertOutsideRepo(args[0]);
      if (fs.existsSync(file)) throw new Error(`${file} exists; refusing to overwrite`);
      const seed = globalThis.crypto.getRandomValues(new Uint8Array(32));
      fs.writeFileSync(file, toHex(seed) + '\n', { mode: 0o600 });
      process.stdout.write((await createKeyPairSignerFromPrivateKeyBytes(seed)).address + '\n');
      return;
    }
    case 'airdrop': {
      const signer = await loadSigner(args[0]);
      const sol = Number(args[1] ?? '1');
      const rpc = createSolanaRpc('https://api.devnet.solana.com');
      const rpcSubscriptions = createSolanaRpcSubscriptions('wss://api.devnet.solana.com');
      const sig = await airdropFactory({ rpc, rpcSubscriptions })({
        recipientAddress: signer.address,
        lamports: lamports(BigInt(Math.round(sol * 1e9))),
        commitment: 'confirmed',
      });
      process.stdout.write(`${sig}\n`);
      return;
    }
    case 'anchor': {
      const [keyfile, clusterArg, outdir, ...files] = args;
      if (!files.length) throw new Error('no files given');
      const cluster = asCluster(clusterArg);
      const signer = await loadSigner(keyfile);
      const records = await Promise.all(
        files.map(async (f) => ({ kind: 'disclosure' as const, contentDigest: await sha256(fs.readFileSync(f)), salt: newSalt() })),
      );
      say(`anchoring ${records.length} record(s) on ${cluster} as ${signer.address} …`);
      const { root, bundles } = await anchorBatch(records, createSolanaMemoAdapter({ cluster, signer }));
      fs.mkdirSync(outdir, { recursive: true });
      bundles.forEach((b, i) => fs.writeFileSync(path.join(outdir, `${path.basename(files[i])}.proof.json`), JSON.stringify(b, null, 2) + '\n'));
      process.stdout.write(JSON.stringify({ root, signature: bundles[0].anchor.signature, anchorer: signer.address, cluster }) + '\n');
      return;
    }
    case 'verify': {
      const [bundlePath, filePath] = args;
      const flag = (n: string) => args[args.indexOf(n) + 1];
      const trust = args.includes('--trust') ? flag('--trust').split(',') : [];
      const bundle = parseBundle(fs.readFileSync(bundlePath, 'utf8'));
      const adapter = createSolanaMemoAdapter({ cluster: bundle.anchor.cluster, rpcUrl: args.includes('--rpc') ? flag('--rpc') : undefined });
      const result = await verifyFile({ bundle, bytes: fs.readFileSync(filePath), adapter, trustedAnchorers: trust });
      process.stdout.write(JSON.stringify(result, null, 2) + '\n');
      process.exitCode = result.status === 'verified' ? 0 : 1;
      return;
    }
    default:
      throw new Error('usage: proof-cli.ts keygen|airdrop|anchor|verify …');
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(2);
});

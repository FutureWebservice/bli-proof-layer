// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 FutureWebService
import { parseBundle } from '../lib/proof/bundle';
import { createSolanaMemoAdapter } from '../lib/proof/chain/solana-memo';
import { verifyFile } from '../lib/proof/verify';

declare const __TRUSTED__: string;

const el = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const TITLES: Record<string, string> = {
  merkle: 'File matches the proof',
  chain: 'Anchor found on-chain',
  root: 'On-chain root matches the bundle',
  anchorer: 'Signed by a trusted anchorer',
};

el<HTMLTextAreaElement>('trusted').value = __TRUSTED__.split(',').filter(Boolean).join('\n');
el<HTMLInputElement>('bundle-file').addEventListener('change', async (e) => {
  const f = (e.target as HTMLInputElement).files?.[0];
  if (f) el<HTMLTextAreaElement>('bundle').value = await f.text();
});

el('run').addEventListener('click', async () => {
  const verdict = el('verdict');
  const checks = el('checks');
  checks.replaceChildren();
  el('link').replaceChildren();
  const file = el<HTMLInputElement>('file').files?.[0];
  if (!file) return void (verdict.textContent = 'Choose a file first.');
  let bundle;
  try {
    bundle = parseBundle(el<HTMLTextAreaElement>('bundle').value);
  } catch {
    return void (verdict.textContent = 'This is not a valid proof bundle.');
  }
  verdict.textContent = 'Verifying…';
  const trusted = el<HTMLTextAreaElement>('trusted').value.split(/[\s,;]+/).filter(Boolean);
  const result = await verifyFile({
    bundle,
    bytes: new Uint8Array(await file.arrayBuffer()),
    adapter: createSolanaMemoAdapter({ cluster: bundle.anchor.cluster }),
    trustedAnchorers: trusted,
  });
  verdict.textContent =
    result.status === 'verified'
      ? `Verified — this file existed unchanged no later than ${new Date((result.anchoredAt ?? 0) * 1000).toISOString()} (network time).`
      : result.status === 'unreachable'
        ? 'Network unreachable — no verdict about the file is possible. Try again.'
        : 'Not verified — at least one check failed.';
  for (const c of result.checks) {
    const li = document.createElement('li');
    li.className = c.ok ? 'ok' : 'fail';
    li.textContent = `${TITLES[c.id]}${c.ok || !c.detail ? '' : ` — ${c.detail}`}`;
    checks.append(li);
  }
  const a = document.createElement('a');
  const suffix = bundle.anchor.cluster === 'mainnet-beta' ? '' : `?cluster=${bundle.anchor.cluster}`;
  a.href = `https://explorer.solana.com/tx/${bundle.anchor.signature}${suffix}`;
  a.textContent = 'View transaction';
  a.rel = 'noopener noreferrer';
  el('link').append(a);
});

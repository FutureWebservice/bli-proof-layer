// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 FutureWebService
// @vitest-environment node
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * lib/proof must stay extractable into its own package: no import of the rest of
 * PatentSecure (no "@/…", no relative path climbing out of lib/proof), only an
 * explicit allowlist of npm packages and node: builtins.
 */
const ROOT = path.resolve(__dirname, '..');
const ALLOWED = new Set(['zod', '@solana/kit', '@solana-program/memo']);

function files(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    return e.isDirectory() ? (e.name === '__tests__' ? [] : files(p)) : p.endsWith('.ts') ? [p] : [];
  });
}

describe('lib/proof import boundary', () => {
  it('imports only itself, node: builtins and allowlisted packages', () => {
    const bad: string[] = [];
    for (const f of files(ROOT)) {
      const src = fs.readFileSync(f, 'utf8');
      for (const m of src.matchAll(/(?:from|import)\s+['"]([^'"]+)['"]/g)) {
        const spec = m[1];
        if (spec.startsWith('node:') || ALLOWED.has(spec)) continue;
        if (spec.startsWith('.')) {
          const target = path.resolve(path.dirname(f), spec);
          if (target.startsWith(ROOT + path.sep) || target === ROOT) continue;
        }
        bad.push(`${path.relative(ROOT, f)} → ${spec}`);
      }
    }
    expect(bad).toEqual([]);
  });
});

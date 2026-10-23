// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 FutureWebService
// Bundle the static verification page into one self-contained dist/verify.html.
//   TRUSTED_ANCHORERS=addr1,addr2 npm run build:verify   → pre-fills the trusted-anchorer box
import fs from 'node:fs';
import { build } from 'esbuild';

const result = await build({
  entryPoints: ['verify-page/main.ts'],
  bundle: true,
  minify: true,
  format: 'iife',
  platform: 'browser',
  target: 'es2022',
  write: false,
  define: {
    'process.env.NODE_ENV': '"production"',
    __TRUSTED__: JSON.stringify(process.env.TRUSTED_ANCHORERS ?? ''),
  },
});

const js = result.outputFiles[0].text.replaceAll('</script', '<\\/script');
const html = fs.readFileSync('verify-page/index.html', 'utf8').replace('<!--SCRIPT-->', () => `<script>${js}</script>`);
fs.mkdirSync('dist', { recursive: true });
fs.writeFileSync('dist/verify.html', html);
console.error(`wrote dist/verify.html (${(html.length / 1024).toFixed(0)} KiB)`);

// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 FutureWebService
// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { canonicalize } from '../canonical';
import { digestOfJson, fromHex, leafData, sha256, toHex } from '../commit';
import { hashLeaf } from '../merkle';

describe('canonicalize (RFC 8785)', () => {
  it('sorts members by UTF-16 code units (RFC 8785 §3.2.3 example)', () => {
    const input = {
      '€': 'Euro Sign',
      '\r': 'Carriage Return',
      'דּ': 'Hebrew Letter Dalet With Dagesh',
      '1': 'One',
      '😀': 'Emoji: Grinning Face',
      '\u0080': 'Control',
      'ö': 'Latin Small Letter O With Diaeresis',
    };
    // Compare the serialised text: parsing back would reorder integer-like keys ("1").
    const order = ['\r', '1', '\u0080', '\u00f6', '\u20ac', '\ud83d\ude00', '\ufb33'];
    const expected = `{${order.map((k) => `${JSON.stringify(k)}:${JSON.stringify((input as Record<string, string>)[k])}`).join(',')}}`;
    expect(canonicalize(input)).toBe(expected);
  });

  it('serialises numbers like ECMAScript (RFC 8785 §3.2.2.3)', () => {
    expect(canonicalize([0, -0, 4.5, 0.002, 1e21, 1e-7, 9007199254740992])).toBe(
      '[0,0,4.5,0.002,1e+21,1e-7,9007199254740992]',
    );
  });

  it('is order-independent for objects and order-preserving for arrays', () => {
    expect(canonicalize({ b: 1, a: 2 })).toBe(canonicalize({ a: 2, b: 1 }));
    expect(canonicalize([1, 2])).not.toBe(canonicalize([2, 1]));
  });

  it.each([
    ['undefined member', { a: undefined }],
    ['NaN', NaN],
    ['Infinity', Infinity],
    ['bigint', 1n],
    ['Date', new Date()],
    ['lone surrogate', '\ud800'],
    ['function', () => 1],
  ])('refuses to silently alter %s', (_n, v) => {
    expect(() => canonicalize(v)).toThrow();
  });
});

describe('commitment test vectors (computed by an independent Python implementation)', () => {
  const doc = new TextEncoder().encode('Invention disclosure: self-folding widget\n');
  const salt = Uint8Array.from({ length: 32 }, (_, i) => i);

  it('digest → leaf data → leaf hash', async () => {
    const digest = await sha256(doc);
    expect(toHex(digest)).toBe('c18b7666655ae936af3bd38847e8282d0f7e5fcc7b837d4150f041ee6ae36552');
    const data = leafData('disclosure', digest, salt);
    expect(toHex(data)).toBe(
      '01c18b7666655ae936af3bd38847e8282d0f7e5fcc7b837d4150f041ee6ae36552' +
        '000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f',
    );
    expect(toHex(await hashLeaf(data))).toBe('5eb871c9e4791f6cce7cfbc3077c83a4823aa4cf39ed05f2d5a0a9f9fa983886');
  });

  it('JSON digest uses the canonical form', async () => {
    const value = { b: [3, 2, 1], a: { z: 1.5, y: null, x: 'é' }, n: 1e21 };
    expect(canonicalize(value)).toBe('{"a":{"x":"é","y":null,"z":1.5},"b":[3,2,1],"n":1e+21}');
    expect(toHex(await digestOfJson(value))).toBe('473b8286b2a8699424b8e4570b283fab79dd253425002aad0460fe8efb3b2d4c');
  });

  it('domain-separates kinds', async () => {
    const d = await sha256(doc);
    expect(toHex(leafData('disclosure', d, salt))).not.toBe(toHex(leafData('ai_trace', d, salt)));
    expect(toHex(leafData('ai_trace', d, salt))).not.toBe(toHex(leafData('analysis', d, salt)));
  });

  it('rejects wrong-sized inputs and bad hex', () => {
    expect(() => leafData('disclosure', new Uint8Array(31), salt)).toThrow();
    expect(() => leafData('disclosure', new Uint8Array(32), new Uint8Array(5))).toThrow();
    expect(() => fromHex('ABCD')).toThrow();
    expect(() => fromHex('abc')).toThrow();
    expect(() => fromHex('abcd', 3)).toThrow();
  });
});

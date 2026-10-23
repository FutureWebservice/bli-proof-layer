// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 FutureWebService
/**
 * RFC 8785 (JCS) canonical JSON, for hashing structured records (agent traces,
 * analyses) so the same data always yields the same bytes.
 *
 * Deliberately strict: anything JSON cannot represent exactly (undefined,
 * NaN/Infinity, bigint, Date, class instances, lone surrogates) THROWS instead of
 * being silently dropped or coerced — a hash over silently altered data would be
 * an audit trail that lies. Callers convert dates to ISO strings first.
 */

export type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };

function assertWellFormed(s: string): void {
  // String.prototype.isWellFormed is Node 20+/modern browsers; fall back to a scan.
  const wf = (s as unknown as { isWellFormed?: () => boolean }).isWellFormed;
  if (typeof wf === 'function' ? !wf.call(s) : /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/.test(s)) {
    throw new Error('canonicalize: string contains a lone surrogate');
  }
}

export function canonicalize(value: unknown): string {
  if (value === null) return 'null';
  switch (typeof value) {
    case 'boolean':
      return value ? 'true' : 'false';
    case 'number':
      if (!Number.isFinite(value)) throw new Error('canonicalize: non-finite number');
      // ECMAScript Number-to-string is exactly what RFC 8785 §3.2.2.3 prescribes.
      return Object.is(value, -0) ? '0' : String(value);
    case 'string':
      assertWellFormed(value);
      return JSON.stringify(value);
    case 'object': {
      if (Array.isArray(value)) return `[${value.map(canonicalize).join(',')}]`;
      const proto = Object.getPrototypeOf(value);
      if (proto !== Object.prototype && proto !== null) {
        throw new Error('canonicalize: only plain objects are supported');
      }
      // JCS sorts member names by UTF-16 code units — the default string sort.
      const keys = Object.keys(value as object).sort();
      return `{${keys
        .map((k) => {
          assertWellFormed(k);
          return `${JSON.stringify(k)}:${canonicalize((value as Record<string, unknown>)[k])}`;
        })
        .join(',')}}`;
    }
    default:
      throw new Error(`canonicalize: unsupported type ${typeof value}`);
  }
}

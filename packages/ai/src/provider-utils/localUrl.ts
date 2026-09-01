/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Strict, structured allow-list for "local-only" HTTP(S) base URLs used by
 * provider clients that talk to on-host backends (e.g. llama-server,
 * stable-diffusion.cpp HTTP server).
 *
 * Design goals:
 *  - No runtime DNS resolution — judgement is by hostname literal only.
 *  - No substring/prefix heuristics that can be DNS-rebound or spoofed
 *    (`attacker.localhost`, IPv6 strings that merely start with "fc"/"fd",
 *     `localhost.attacker.com`, percent-encoded forms, IDN, underscores …).
 *  - No WHATWG URL canonicalization of the host before validation — the
 *    URL parser silently rewrites non-standard IPv4 spellings
 *    (`0x7f.0.0.1`, `2130706433`, `010.0.0.1`) to canonical dotted-quads,
 *    which would defeat the strict-literal grammar below. We extract the
 *    host from the raw URL string and validate THAT literal.
 *  - Hostname grammar is shrunk to forms that cannot be rebound:
 *      * literal `localhost`
 *      * IPv4 literals in loopback / RFC 1918 / link-local ranges
 *      * IPv6 literals in `::1`, `fc00::/7`, `fe80::/10`, plus IPv4-mapped
 *        forms that decode to an allowed IPv4
 *  - `*.localhost` is intentionally REJECTED (it is the bypass vector that
 *    motivated this module).
 */

/**
 * Parse an IPv6 literal (without surrounding brackets) into its 16-byte
 * binary representation. Returns `null` on any malformed input, on
 * zone-identifier suffixes (`%eth0` etc.), or on IPv4-suffix forms that
 * are not cleanly recognisable.
 *
 * The `::` compression must actually compress one or more zero groups —
 * inputs like `fc00:0:0:0:0:0:0::1` (8 explicit groups *and* a `::`) are
 * structurally invalid and are rejected even though the byte representation
 * they’d round to is otherwise local. Strictness here is defence in depth
 * against any downstream parser that takes a different view of `::`.
 */
export function parseIpv6(host: string): Uint8Array | null {
  if (typeof host !== "string" || host.length === 0) return null;
  // Reject zone IDs (e.g. fe80::1%eth0) — these are interface-scoped and not
  // meaningful at the URL layer, and we don't want to special-case them.
  if (host.includes("%")) return null;
  const lower = host.toLowerCase();

  // Recognise IPv4-suffix forms like ::ffff:127.0.0.1 — the last segment is
  // an IPv4 literal that occupies the last 32 bits.
  let head = lower;
  let ipv4Tail: number[] | null = null;
  const lastColon = lower.lastIndexOf(":");
  if (lastColon !== -1 && lower.slice(lastColon + 1).includes(".")) {
    const tail = lower.slice(lastColon + 1);
    const parts = tail.split(".");
    if (parts.length !== 4) return null;
    const oct = parts.map((p) => (/^(?:0|[1-9]\d{0,2})$/.test(p) ? Number(p) : NaN));
    if (oct.some((n) => !(n >= 0 && n <= 255))) return null;
    ipv4Tail = oct;
    head = lower.slice(0, lastColon);
  }

  // Split on the (single) "::" if present.
  const dblIdx = head.indexOf("::");
  if (dblIdx !== head.lastIndexOf("::")) return null;

  let groups: string[];
  if (dblIdx === -1) {
    groups = head === "" ? [] : head.split(":");
  } else {
    const left = head.slice(0, dblIdx);
    const right = head.slice(dblIdx + 2);
    const leftGroups = left === "" ? [] : left.split(":");
    const rightGroups = right === "" ? [] : right.split(":");
    const totalSlots = ipv4Tail ? 6 : 8;
    const fill = totalSlots - leftGroups.length - rightGroups.length;
    // `::` MUST compress at least one zero group — reject `fill <= 0` so
    // inputs like `fc00:0:0:0:0:0:0::1` (no compression actually needed)
    // do not slip through.
    if (fill <= 0) return null;
    groups = [...leftGroups, ...Array(fill).fill("0"), ...rightGroups];
  }

  const expected = ipv4Tail ? 6 : 8;
  if (groups.length !== expected) return null;

  const bytes = new Uint8Array(16);
  for (let i = 0; i < groups.length; i++) {
    const g = groups[i];
    if (!/^[0-9a-f]{1,4}$/.test(g)) return null;
    const v = parseInt(g, 16);
    bytes[i * 2] = (v >> 8) & 0xff;
    bytes[i * 2 + 1] = v & 0xff;
  }
  if (ipv4Tail) {
    bytes[12] = ipv4Tail[0];
    bytes[13] = ipv4Tail[1];
    bytes[14] = ipv4Tail[2];
    bytes[15] = ipv4Tail[3];
  }
  return bytes;
}

/**
 * Returns true if `host` is a dotted-quad IPv4 literal in a strictly local
 * range: loopback `127.0.0.0/8`, RFC 1918 (`10/8`, `172.16/12`, `192.168/16`),
 * or link-local `169.254/16`. Rejects `0.0.0.0` and `255.255.255.255`,
 * rejects leading zeros (no `010.0.0.1`), and rejects malformed input.
 */
export function isLocalIpv4(host: string): boolean {
  if (typeof host !== "string") return false;
  const parts = host.split(".");
  if (parts.length !== 4) return false;
  const oct: number[] = [];
  for (const p of parts) {
    // Reject leading zeros (octal-looking forms) — accept only "0" or
    // 1-3 digits not starting with 0.
    if (!/^(?:0|[1-9]\d{0,2})$/.test(p)) return false;
    const n = Number(p);
    if (!(n >= 0 && n <= 255)) return false;
    oct.push(n);
  }
  const [a, b] = oct;
  if (oct.every((n) => n === 0)) return false; // reject 0.0.0.0
  if (oct.every((n) => n === 255)) return false; // reject broadcast
  if (a === 127) return true; // loopback
  if (a === 10) return true; // RFC 1918
  if (a === 192 && b === 168) return true; // RFC 1918
  if (a === 172 && b >= 16 && b <= 31) return true; // RFC 1918
  if (a === 169 && b === 254) return true; // link-local
  return false;
}

/**
 * Returns true if `host` is an IPv6 literal (without surrounding brackets)
 * that lies in `::1`, `fc00::/7` (ULA), `fe80::/10` (link-local), or is an
 * IPv4-mapped IPv6 (`::ffff:0:0/96`) whose embedded IPv4 satisfies
 * {@link isLocalIpv4}. Parses structurally — no string-prefix matching.
 */
export function isLocalIpv6(host: string): boolean {
  const bytes = parseIpv6(host);
  if (!bytes) return false;

  // ::1
  let allZeroExceptLast = true;
  for (let i = 0; i < 15; i++) {
    if (bytes[i] !== 0) {
      allZeroExceptLast = false;
      break;
    }
  }
  if (allZeroExceptLast && bytes[15] === 1) return true;

  // ULA fc00::/7
  if ((bytes[0] & 0xfe) === 0xfc) return true;

  // Link-local fe80::/10
  if (bytes[0] === 0xfe && (bytes[1] & 0xc0) === 0x80) return true;

  // IPv4-mapped ::ffff:0:0/96 — decode the embedded IPv4 and re-check.
  let mapped = true;
  for (let i = 0; i < 10; i++) {
    if (bytes[i] !== 0) {
      mapped = false;
      break;
    }
  }
  if (mapped && bytes[10] === 0xff && bytes[11] === 0xff) {
    return isLocalIpv4(`${bytes[12]}.${bytes[13]}.${bytes[14]}.${bytes[15]}`);
  }

  return false;
}

/**
 * Returns true if `host` is a recognised local hostname literal: exactly
 * `localhost`, or an IPv4/IPv6 literal in an allowed local range.
 *
 * IPv6 literals must be passed WITHOUT surrounding brackets (see
 * {@link normalizeLocalHttpUrl}, which strips them before calling this).
 *
 * Rejects everything else, including `*.localhost`, IDN, percent-encoded
 * forms, underscores, and any name that would require DNS resolution.
 */
export function isLocalHostname(host: string): boolean {
  if (typeof host !== "string" || host.length === 0) return false;
  const lower = host.toLowerCase();
  if (lower === "localhost") return true;
  // Strict character class — closes *.localhost, percent-encoded forms,
  // IDN, underscores, and any other DNS-rebindable name. Only IPv4 dotted-
  // quad and IPv6 hex/colon grammars survive this gate. In particular,
  // 'x' is NOT in the class, so `0x7f.0.0.1` is rejected here before the
  // IPv4 parser ever sees it.
  if (!/^[0-9a-f:.]+$/.test(lower)) return false;
  if (lower.includes(":")) return isLocalIpv6(lower);
  if (lower.includes(".")) return isLocalIpv4(lower);
  // Single-token unsigned-integer forms like `2130706433` (canonicalised
  // by WHATWG to 127.0.0.1) are also rejected here — they pass the char
  // class but contain neither `:` nor `.` and so reach this final
  // `return false`.
  return false;
}

/**
 * Returns true if `host` is a dotted-quad IPv4 literal in the loopback range
 * `127.0.0.0/8`. Rejects leading zeros (no `010.0.0.1`) and malformed input.
 * This is a strict subset of {@link isLocalIpv4} — RFC 1918 and link-local
 * (including the `169.254.169.254` cloud-metadata IP) are NOT loopback.
 */
function isLoopbackIpv4(host: string): boolean {
  if (typeof host !== "string") return false;
  const parts = host.split(".");
  if (parts.length !== 4) return false;
  for (const p of parts) {
    // Reject leading zeros (octal-looking forms) — accept only "0" or
    // 1-3 digits not starting with 0.
    if (!/^(?:0|[1-9]\d{0,2})$/.test(p)) return false;
    const n = Number(p);
    if (!(n >= 0 && n <= 255)) return false;
  }
  // 127.0.0.0/8 is loopback in its entirety per RFC 1122.
  return Number(parts[0]) === 127;
}

/**
 * Returns true if `host` is an IPv6 literal (without surrounding brackets)
 * that is loopback: exactly `::1`, or an IPv4-mapped IPv6 (`::ffff:0:0/96`)
 * whose embedded IPv4 lies in `127.0.0.0/8`. Reuses {@link parseIpv6} so the
 * strict IPv6 grammar is shared with {@link isLocalIpv6}. ULA (`fc00::/7`)
 * and link-local (`fe80::/10`) are NOT loopback and return false.
 */
function isLoopbackIpv6(host: string): boolean {
  const bytes = parseIpv6(host);
  if (!bytes) return false;

  // ::1
  let allZeroExceptLast = true;
  for (let i = 0; i < 15; i++) {
    if (bytes[i] !== 0) {
      allZeroExceptLast = false;
      break;
    }
  }
  if (allZeroExceptLast && bytes[15] === 1) return true;

  // IPv4-mapped ::ffff:0:0/96 — decode the embedded IPv4 and require loopback.
  let mapped = true;
  for (let i = 0; i < 10; i++) {
    if (bytes[i] !== 0) {
      mapped = false;
      break;
    }
  }
  if (mapped && bytes[10] === 0xff && bytes[11] === 0xff) {
    return isLoopbackIpv4(`${bytes[12]}.${bytes[13]}.${bytes[14]}.${bytes[15]}`);
  }

  return false;
}

/**
 * Returns true if `host` is a STRICTLY loopback hostname literal — the policy
 * for AI server clients that, by product decision, only ever talk to a server
 * on the same host:
 *   * `localhost` (case-insensitive, optional single trailing dot)
 *   * IPv4 in `127.0.0.0/8`
 *   * IPv6 `::1` and IPv4-mapped loopback (`::ffff:127.x.x.x`)
 *
 * Everything else — RFC 1918, link-local (incl. the `169.254.169.254`
 * cloud-metadata IP), ULA, public, `*.localhost`, IDN, percent-encoded,
 * and unsigned-integer IPv4 spellings — returns false. This is intentionally
 * narrower than {@link isLocalHostname}: it is the initial-URL and
 * redirect-hop gate used by `localOnlyFetch` to close the link-local
 * metadata SSRF vector.
 *
 * IPv6 literals must be passed WITHOUT surrounding brackets.
 */
export function isLoopbackHostname(host: string): boolean {
  if (typeof host !== "string" || host.length === 0) return false;
  const lower = host.toLowerCase();
  // Allow a single trailing dot on `localhost` (FQDN root form) but nothing
  // beyond it — `localhost.` is fine; `evil.localhost` / `localhost..` are not.
  if (lower === "localhost" || lower === "localhost.") return true;
  // Strict character class — same gate as isLocalHostname: only IPv4 dotted-
  // quad and IPv6 hex/colon grammars survive. Closes percent-encoded forms,
  // IDN, underscores, and any other DNS-rebindable name.
  if (!/^[0-9a-f:.]+$/.test(lower)) return false;
  if (lower.includes(":")) return isLoopbackIpv6(lower);
  if (lower.includes(".")) return isLoopbackIpv4(lower);
  // Single-token unsigned-integer forms (e.g. `2130706433`) reach here and
  // are rejected — they contain neither `:` nor `.`.
  return false;
}

/**
 * Extract the literal host substring from `rawUrl` BEFORE the WHATWG URL
 * parser canonicalises it. Returns the host as it appeared in the source
 * (case preserved, brackets stripped for IPv6), or `null` if the URL does
 * not match the basic `scheme://[user[:pw]@]host[:port][/...]` grammar.
 *
 * This is deliberately separate from `new URL().hostname` because the
 * WHATWG parser rewrites:
 *   - `0x7f.0.0.1`  →  `127.0.0.1`
 *   - `2130706433`  →  `127.0.0.1`
 *   - `010.0.0.1`   →  `10.0.0.1` (in lenient runtimes)
 * and any of those rewrites would silently bypass
 * {@link isLocalHostname}'s strict-literal grammar.
 */
export function extractRawHost(rawUrl: string): string | null {
  const m = rawUrl.match(/^[A-Z][A-Z0-9+.-]*:\/\/(?:[^/?#@]*@)?(\[[^\]]+\]|[^:/?#]+)/i);
  if (m === null) return null;
  let host = m[1] ?? "";
  if (host.startsWith("[") && host.endsWith("]")) {
    host = host.slice(1, -1);
  }
  return host;
}

/**
 * Parse `rawUrl`, validate that it targets a strictly-local HTTP(S) endpoint,
 * and return a canonical form with the query string and fragment stripped
 * and any trailing slashes removed from the path.
 *
 * `label` is the human-readable provider tag prepended to thrown errors
 * (e.g. `"LlamaCppServer"`) so callers don't need to wrap.
 *
 * @throws Error if the URL is malformed, not http(s), carries credentials,
 *         or targets a non-local hostname (including non-literal IPv4
 *         spellings that WHATWG would canonicalise to a local literal).
 */
export function normalizeLocalHttpUrl(rawUrl: string, label: string): string {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new Error(`${label}: base URL must be a valid local HTTP(S) URL.`);
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error(`${label}: base URL must be a valid local HTTP(S) URL.`);
  }
  if (url.username || url.password) {
    throw new Error(`${label}: base URL must not include credentials.`);
  }

  // Validate the LITERAL host from rawUrl, not `url.hostname` — the
  // WHATWG parser rewrites non-standard IPv4 spellings (hex, decimal,
  // leading-zero octets) into canonical dotted-quads that would slip
  // past `isLocalHostname`.
  const rawHost = extractRawHost(rawUrl);
  if (rawHost === null || !isLocalHostname(rawHost)) {
    throw new Error(`${label}: base URL must target a local HTTP(S) server (got: ${rawUrl}).`);
  }

  // Strip trailing slashes from the path (but keep a single "/" — handled by
  // collapsing to origin below).
  let pathnameEnd = url.pathname.length;
  while (pathnameEnd > 1 && url.pathname.charCodeAt(pathnameEnd - 1) === 47) {
    pathnameEnd--;
  }
  const pathname = url.pathname.slice(0, pathnameEnd);

  const lowerHost = rawHost.toLowerCase();
  const hostForOutput = lowerHost.includes(":") ? `[${lowerHost}]` : lowerHost;
  const portSuffix = url.port ? `:${url.port}` : "";
  const origin = `${url.protocol}//${hostForOutput}${portSuffix}`;
  return pathname === "/" ? origin : `${origin}${pathname}`;
}

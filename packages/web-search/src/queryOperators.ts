/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Reduces a caller-supplied domain to the bare host (plus any path prefix) that
 * a `site:` operator accepts. A scheme, a `www.` prefix, or a trailing slash
 * would each make the operator match nothing.
 */
function normalizeDomain(domain: string): string {
  let value = domain.trim().toLowerCase();
  value = value.replace(/^[a-z][a-z0-9+.-]*:\/\//, "");
  value = value.replace(/^www\./, "");
  value = value.replace(/\/+$/, "");
  return value;
}

function normalizeAll(domains: readonly string[] | undefined): string[] {
  return (domains ?? []).map(normalizeDomain).filter((d) => d.length > 0);
}

/**
 * Expresses a domain restriction as search-engine query operators, for a
 * provider whose API takes no domain list but whose engine understands `site:`.
 *
 * Several includes are OR-ed inside parentheses: appending them bare would make
 * the engine require every one of them at once, which no result can satisfy.
 */
export function applyDomainOperators(
  query: string,
  includeDomains: readonly string[] | undefined,
  excludeDomains: readonly string[] | undefined
): string {
  const includes = normalizeAll(includeDomains);
  const excludes = normalizeAll(excludeDomains);
  let result = query.trim();
  if (includes.length === 1) {
    result += ` site:${includes[0]}`;
  } else if (includes.length > 1) {
    result += ` (${includes.map((d) => `site:${d}`).join(" OR ")})`;
  }
  for (const domain of excludes) {
    result += ` -site:${domain}`;
  }
  return result;
}

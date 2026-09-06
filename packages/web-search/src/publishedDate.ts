/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Normalizes a provider's publish date onto the ISO-8601 string
 * {@link SearchResult.publishedDate} promises, or `undefined` when it is not a
 * date at all.
 *
 * Several engines report a display string next to (or instead of) a timestamp —
 * "3 days ago", "April 30, 2025". A graph filtering on recency compares with
 * `new Date(...)`, and a display string that does not parse silently becomes an
 * Invalid Date, dropping or keeping every one of that provider's rows depending
 * on which way the comparison runs. An absent date says "unknown" and can be
 * handled; a string that means a date but is not one cannot.
 */
export function toIsoPublishedDate(value: string | undefined): string | undefined {
  if (value === undefined) return undefined;
  const trimmed = value.trim();
  if (trimmed.length === 0) return undefined;
  const parsed = Date.parse(trimmed);
  return Number.isNaN(parsed) ? undefined : new Date(parsed).toISOString();
}

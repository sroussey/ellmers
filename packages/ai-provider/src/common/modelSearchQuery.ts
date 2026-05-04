/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { ModelSearchResultItem } from "@workglow/ai";

/**
 * Normalized search string for model search, or undefined when absent or whitespace-only.
 */
export function normalizedModelSearchQuery(query: string | undefined): string | undefined {
  const t = query?.trim();
  return t ? t.toLowerCase() : undefined;
}

/**
 * Filter static/SDK model rows by optional query (substring match on label, value, or description).
 */
export function filterLabeledModelsByQuery<
  T extends { label: string; value: string; description?: string },
>(models: ReadonlyArray<T>, query: string | undefined): T[] {
  const q = normalizedModelSearchQuery(query);
  if (!q) return [...models];
  return models.filter(
    (m) =>
      m.value.toLowerCase().includes(q) ||
      m.label.toLowerCase().includes(q) ||
      m.description?.toLowerCase().includes(q)
  );
}

/**
 * Filter {@link ModelSearchResultItem} rows by optional query.
 */
export function filterModelSearchResultsByQuery(
  results: ModelSearchResultItem[],
  query: string | undefined
): ModelSearchResultItem[] {
  const q = normalizedModelSearchQuery(query);
  if (!q) return results;
  return results.filter(
    (m) =>
      m.id.toLowerCase().includes(q) ||
      m.label.toLowerCase().includes(q) ||
      m.description.toLowerCase().includes(q)
  );
}

/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

/** Format an array of records as a simple aligned text table. */
export function formatTable(rows: Record<string, string>[], columns: string[]): string {
  if (rows.length === 0) return "(none)";

  const widths = columns.map((col) =>
    Math.max(col.length, ...rows.map((row) => (row[col] ?? "").length))
  );

  const header = columns.map((col, i) => col.padEnd(widths[i])).join("  ");
  const separator = widths.map((w) => "-".repeat(w)).join("  ");
  const body = rows
    .map((row) => columns.map((col, i) => (row[col] ?? "").padEnd(widths[i])).join("  "))
    .join("\n");

  return `${header}\n${separator}\n${body}`;
}

/** Fixed-precision number for table cells; NaN renders as "-". */
export function formatMetric(value: number, digits = 3): string {
  return Number.isNaN(value) ? "-" : value.toFixed(digits);
}

export function formatError(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/** Parse an integer CLI flag, rejecting NaN and out-of-range values loudly. */
export function parseIntFlag(value: string, flag: string, minimum: number): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < minimum) {
    throw new Error(`${flag} must be an integer >= ${minimum} (got "${value}")`);
  }
  return parsed;
}

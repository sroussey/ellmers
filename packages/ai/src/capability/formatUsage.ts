/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { Usage } from "@workglow/task-graph";
import type { CostEstimate } from "./CostEstimate";

/**
 * How much of a {@link Usage} to render. All three levels obey the same
 * underlying rules — unreported renders as nothing, a stated all-zero renders as
 * "cached", and `↑` is always the whole prompt — and differ only in breadth.
 */
export type UsageDetail = "directional" | "cumulative" | "detailed";

const group = (n: number): string => n.toLocaleString("en-US");

const COUNTER_FIELDS = ["input", "output", "cached", "cacheWrite", "reasoning", "total"] as const;

/** True when the provider stated 0 for every counter — a replayed cache hit. */
function isStatedZero(usage: Usage): boolean {
  return COUNTER_FIELDS.every((field) => usage[field] === 0);
}

function hasAnyCounter(usage: Usage): boolean {
  return COUNTER_FIELDS.some((field) => usage[field] !== undefined);
}

/**
 * The whole prompt. `input`, `cached` and `cacheWrite` are disjoint slices of
 * it, so the base-rate bucket alone is not the figure the `↑` arrow claims to
 * be: a warm cache-checkpoint call reports nearly its entire prompt under
 * `cached` and would render `↑3` for an 11k-token prompt.
 *
 * Sums only the counters the provider stated, so a prompt no counter reported
 * stays unreported rather than becoming a synthesized `0`.
 */
function promptTotal(usage: Usage): number | undefined {
  const slices = [usage.input, usage.cached, usage.cacheWrite];
  if (slices.every((slice) => slice === undefined)) return undefined;
  return slices.reduce<number>((sum, slice) => sum + (slice ?? 0), 0);
}

export function formatUsage(usage: Usage | undefined, detail: UsageDetail): string {
  if (!usage || !hasAnyCounter(usage)) return "";
  if (isStatedZero(usage)) return "cached";

  const prompt = promptTotal(usage);
  const up = prompt === undefined ? "" : `↑${group(prompt)}`;
  const down = usage.output === undefined ? "" : `↓${group(usage.output)}`;

  if (detail === "cumulative") return [up, down].filter(Boolean).join(" ");

  if (detail === "directional") {
    const cached = usage.cached === undefined ? "" : `(${group(usage.cached)} cached)`;
    return [up, cached, down].filter(Boolean).join(" ");
  }

  const parts: string[] = [];
  if (up) parts.push(up);
  if (down) parts.push(down);
  if (usage.cached !== undefined) parts.push(`cached ${group(usage.cached)}`);
  if (usage.cacheWrite !== undefined) parts.push(`cache-write ${group(usage.cacheWrite)}`);
  if (usage.reasoning !== undefined) parts.push(`reasoning ${group(usage.reasoning)}`);
  if (usage.total !== undefined) parts.push(`total ${group(usage.total)}`);
  return parts.join(" ");
}

/**
 * Render a cost estimate. A `~` prefix marks an estimate that could not price
 * every counter that was spent, so a partial figure is never mistaken for an
 * exact one.
 */
export function formatCost(estimate: CostEstimate | undefined): string {
  if (!estimate) return "";
  const symbol = estimate.currency === "USD" ? "$" : `${estimate.currency} `;
  const prefix = estimate.unpriced.length > 0 ? "~" : "";
  return `${prefix}${symbol}${estimate.amount.toFixed(4)}`;
}

/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { ModelPricing } from "@workglow/ai";
import { estimateCost, formatCost, formatUsage } from "@workglow/ai";
import type { Usage } from "@workglow/task-graph";
import { mergeUsage } from "@workglow/task-graph";

interface ModelTally {
  rows: number;
  ok: number;
  usage: Usage | undefined;
}

/**
 * Running per-model totals for a sweep, rendered as a small table on stderr.
 *
 * Sums usage across rows because each row is a separate request — unlike a task's
 * cumulative in-run total, these genuinely add up.
 */
export class LiveTally {
  private readonly byModel = new Map<string, ModelTally>();
  private readonly startedAt: number;

  constructor(
    private readonly pricing: (model: string) => ModelPricing | undefined,
    now: number
  ) {
    this.startedAt = now;
  }

  record(model: string, ok: boolean, usage: Usage | undefined): void {
    const tally = this.byModel.get(model) ?? { rows: 0, ok: 0, usage: undefined };
    tally.rows += 1;
    if (ok) tally.ok += 1;
    tally.usage = mergeUsage(tally.usage, usage);
    this.byModel.set(model, tally);
  }

  render(done: number, total: number, now: number): string {
    const elapsedSec = Math.max((now - this.startedAt) / 1000, 0.001);
    const lines = [`[${done}/${total}]`];
    for (const [model, tally] of this.byModel) {
      const tps =
        tally.usage?.output === undefined
          ? ""
          : ` ${Math.round(tally.usage.output / elapsedSec)} tok/s`;
      // Priced at the sweep's start, so a redraw does not restate the same
      // rows at a different rate once a time-of-day discount window opens.
      const cost = tally.usage
        ? formatCost(estimateCost(tally.usage, this.pricing(model), { at: this.startedAt }))
        : "";
      lines.push(
        `  ${model}  ${tally.ok}/${tally.rows} ok  ` +
          `${formatUsage(tally.usage, "detailed")}${tps}${cost ? `  ${cost}` : ""}`
      );
    }
    return lines.join("\n");
  }
}

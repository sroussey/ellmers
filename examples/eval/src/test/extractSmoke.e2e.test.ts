/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { registerAiTasks } from "@workglow/ai";
import { registerAnthropicInline } from "@workglow/anthropic/ai-runtime";
import { registerBaseTasks, registerBuiltInTransforms } from "@workglow/task-graph";
import { EnvCredentialStore, setGlobalCredentialStore } from "@workglow/util";
import { beforeAll, describe, expect, it } from "vitest";
import { runSweep } from "../evals/runner";
import { aggregateResults } from "../report/aggregate";
import { createInMemoryStores } from "../storage";

/**
 * Live end-to-end check of the extraction eval: prose rows with gold entity
 * arrays run through StructuredGenerationTask against a real model and the
 * stored row JSON re-scores into field agreement / recall / precision.
 * Needs ANTHROPIC_API_KEY (hydrated by the repo's test preload when present).
 */
function isCreditExhaustedError(err: unknown): boolean {
  const message = err instanceof Error ? err.message : String(err);
  return /credit balance is too low|insufficient credits|payment required|exceeded your current quota|no credits remaining/i.test(
    message
  );
}

describe.skipIf(!process.env.ANTHROPIC_API_KEY)("live extraction eval", () => {
  beforeAll(async () => {
    registerBaseTasks();
    registerAiTasks();
    registerBuiltInTransforms();
    setGlobalCredentialStore(new EnvCredentialStore());
    await registerAnthropicInline();
  }, 60_000);

  it(
    "extracts entities and scores them against the gold rows",
    { timeout: 300_000 },
    async ({ skip }) => {
      try {
        const stores = await createInMemoryStores();
        const dataset = "x/people";
        const split = "test";
        const rows = [
          {
            text: "Alice Chen is the chief executive officer of Acme. Bob Osei serves as CTO.",
            expected: [
              { name: "Alice Chen", role: "CEO" },
              { name: "Bob Osei", role: "CTO" },
            ],
          },
          {
            text: "The report was authored by Dana Kim, Acme's CFO.",
            expected: [{ name: "Dana Kim", role: "CFO" }],
          },
        ];
        await stores.rows.putBulk(
          rows.map((r, i) => ({ dataset, split, row_index: i, data: JSON.stringify(r) }))
        );
        const stored = (await stores.rows.query({ dataset, split }))!;
        stored.sort((a, b) => a.row_index - b.row_index);

        const runId = await runSweep(stores, stored, {
          kind: "extract",
          dataset,
          split,
          models: ["claude-haiku-4-5"],
          columns: {
            textColumn: "text",
            labelColumn: "label",
            labels: undefined,
            pairColumn: "sentence2",
            scoreColumn: "score",
            expectedColumn: "expected",
            keyField: "name",
            fields: undefined,
            instruction: "Extract every person mentioned in the text.",
          },
          context: { columns: ["text", "expected"], labelNames: {} },
        });

        const results = (await stores.results.query({ run_id: runId })) ?? [];
        expect(results).toHaveLength(2);
        expect(results.filter((r) => r.ok !== 1).map((r) => r.error)).toEqual([]);

        const [report] = aggregateResults("extract", results, { keyField: "name" });
        // Three unambiguous people. This is a plumbing smoke test against a live
        // model, so assert floors rather than exact values: most people found,
        // mostly non-hallucinated rows, and at least one role field agreeing
        // (the model may legitimately expand "CEO" to "Chief Executive Officer").
        expect(report.found).toBeGreaterThanOrEqual(2 / 3);
        expect(report.prec).toBeGreaterThanOrEqual(0.5);
        expect(report.score).toBeGreaterThanOrEqual(1 / 3);
      } catch (err) {
        if (isCreditExhaustedError(err)) {
          skip(
            `skipped: provider out of credits (${err instanceof Error ? err.message : String(err)})`
          );
        }
        throw err;
      }
    }
  );
});

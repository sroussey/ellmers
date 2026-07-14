/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { Command } from "commander";
import { pullDatasetIntoStorage } from "../hf/pullDataset";
import type { EvalStores } from "../storage";
import { formatError, formatTable, parseIntFlag } from "../util";

export function registerDatasetCommand(
  program: Command,
  openStores: () => Promise<EvalStores>
): void {
  const dataset = program
    .command("dataset")
    .description("Pull and inspect HuggingFace datasets stored locally");

  dataset
    .command("pull")
    .argument("<id>", "HuggingFace dataset id (e.g. dair-ai/emotion)")
    .option("--split <split>", "dataset split", "test")
    .option("--config <config>", "dataset config name (defaults to the first config)")
    .option("--limit <n>", "maximum rows to pull", "100")
    .option("--offset <n>", "row offset to start from", "0")
    .description("Fetch dataset rows and store them in the local eval database")
    .action(
      async (
        id: string,
        opts: { split: string; config?: string; limit: string; offset: string }
      ) => {
        const stores = await openStores();
        try {
          const { numRows, source } = await pullDatasetIntoStorage(stores, {
            dataset: id,
            split: opts.split,
            config: opts.config,
            limit: parseIntFlag(opts.limit, "--limit", 1),
            offset: parseIntFlag(opts.offset, "--offset", 0),
          });
          console.log(`stored ${numRows} rows of ${id} [${opts.split}] (via ${source})`);
        } catch (err) {
          console.error(`Error: ${formatError(err)}`);
          process.exitCode = 1;
        }
      }
    );

  dataset
    .command("list")
    .description("List locally stored dataset splits")
    .action(async () => {
      const stores = await openStores();
      const all = (await stores.datasets.getAll()) ?? [];
      const rows = all.map((d) => ({
        dataset: d.dataset,
        split: d.split,
        rows: String(d.num_rows),
        columns: JSON.parse(d.columns).join(","),
        source: d.source,
        fetched: d.fetched_at,
      }));
      console.log(formatTable(rows, ["dataset", "split", "rows", "columns", "source", "fetched"]));
    });

  dataset
    .command("show")
    .argument("<id>", "HuggingFace dataset id")
    .option("--split <split>", "dataset split", "test")
    .option("--limit <n>", "rows to print", "5")
    .description("Print stored rows of a dataset split as JSON lines")
    .action(async (id: string, opts: { split: string; limit: string }) => {
      const stores = await openStores();
      const rows = await stores.rows.query({ dataset: id, split: opts.split });
      if (!rows || rows.length === 0) {
        console.error(`No stored rows for ${id} [${opts.split}] — run \`dataset pull\` first.`);
        process.exitCode = 1;
        return;
      }
      rows.sort((a, b) => a.row_index - b.row_index);
      for (const row of rows.slice(0, Number(opts.limit))) {
        console.log(row.data);
      }
    });
}

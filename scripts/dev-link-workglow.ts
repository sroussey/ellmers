#!/usr/bin/env bun
/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 *
 * Orchestrates local bun-link + use-source for the libs → sec → embarc-data
 * chain. Prefer the parent-folder wrapper: `bun ./dev-link.ts` from workglow/.
 *
 * Env: WORKGLOW_ROOT — parent folder containing libs/, sec/, embarc-data/
 * (defaults to two levels above this file).
 */
import { $ } from "bun";
import path from "node:path";

const root = process.env.WORKGLOW_ROOT
  ? path.resolve(process.env.WORKGLOW_ROOT)
  : path.resolve(import.meta.dir, "../..");

async function run(cwd: string, args: string[]): Promise<void> {
  console.log(`\n==> ${path.basename(cwd)}: bun ${args.join(" ")}`);
  await $`bun ${args}`.cwd(cwd);
}

async function main(): Promise<void> {
  const libs = path.join(root, "libs");
  const sec = path.join(root, "sec");
  const embarcData = path.join(root, "embarc-data");

  await run(libs, ["run", "link-all"]); // link self
  await run(libs, ["run", "use-source"]);

  await run(sec, ["run", "link"]); // link self
  await run(sec, ["run", "link-workglow"]); // link from workglow
  await run(sec, ["run", "use-source"]);

  await run(embarcData, ["run", "link-sec-workglow"]); // link from workglow and sec

  console.log("\n✅ dev-link complete (libs → sec → embarc-data)");
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});

#!/usr/bin/env bun
/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Switch every workspace between source and built code.
 *
 *   bun run use-source            # dist/* re-exports src/* (live source, no rebuild)
 *   bun run use-dist              # remove stubs and rebuild
 *   bun run use-dist --no-build   # remove stubs only
 *
 * `package.json` is never modified: source mode only writes into the gitignored
 * `dist` folder, so `git status` stays clean in either mode.
 */

import { $ } from "bun";
import { basename } from "node:path";
import {
  readPackageManifest,
  removeSourceStubs,
  stubSpecsFor,
  writeSourceStubs,
} from "./lib/sourceStubs";
import { findWorkspaces } from "./lib/util";

async function useSource(workspaces: readonly string[]): Promise<void> {
  let stubbed = 0;
  let packages = 0;

  for (const workspace of workspaces) {
    const manifest = await readPackageManifest(workspace);
    const specs = stubSpecsFor(manifest);
    if (specs.length === 0) continue;

    let written: string[];
    try {
      written = await writeSourceStubs(workspace, specs);
    } catch (error) {
      throw new Error(
        `${manifest.name}: ${error instanceof Error ? error.message : String(error)}`
      );
    }
    console.log(`  ${manifest.name}: ${written.length} stub(s)`);
    stubbed += written.length;
    packages += 1;
  }

  console.log(`\nWrote ${stubbed} stub(s) across ${packages} package(s). Imports now hit src/.`);
}

async function useDist(workspaces: readonly string[], build: boolean): Promise<void> {
  let removed = 0;
  for (const workspace of workspaces) {
    const stubs = await removeSourceStubs(workspace);
    if (stubs.length > 0) {
      console.log(`  ${basename(workspace)}: removed ${stubs.length} stub(s)`);
      removed += stubs.length;
    }
  }

  if (removed === 0) {
    console.log("\nNo stubs found — already in dist mode.");
    return;
  }
  console.log(`\nRemoved ${removed} stub(s).`);

  if (!build) {
    console.log("Skipping rebuild (--no-build): dist is missing its entry files until you build.");
    return;
  }
  console.log("Rebuilding packages...\n");
  await $`bun run build:packages`;
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const build = !args.includes("--no-build");
  const mode = args.find((arg) => !arg.startsWith("--"));

  if (mode !== "source" && mode !== "dist") {
    console.error("Usage: bun run bunsrc-workspace.ts <source|dist> [--no-build]");
    console.error("  source: dist/* re-exports src/* (development)");
    console.error("  dist:   remove stubs and rebuild (committed / published state)");
    process.exit(1);
  }

  // `false`: stub every workspace, including private ones (aws, cloudflare).
  const workspaces = await findWorkspaces(false);
  console.log(`Switching ${workspaces.length} workspaces to ${mode} mode\n`);

  if (mode === "source") {
    await useSource(workspaces);
  } else {
    await useDist(workspaces, build);
  }
}

main().catch((error) => {
  console.error("Fatal error:", error instanceof Error ? error.message : String(error));
  process.exit(1);
});

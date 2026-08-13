/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Resolve every workspace package specifier to its SOURCE file instead of its
 * built bundle, for the whole monorepo at once.
 *
 * Why this exists: `packages/test` reaches everything it exercises by PACKAGE
 * SPECIFIER (`@workglow/ai`), which `exports` resolves to `dist/node.js`. Under
 * v8 coverage that bundle is the file that gets instrumented, so the executed
 * lines are attributed to `packages/ai/dist/node.js` and `packages/ai/src/**`
 * reads as barely covered — a package with a large cross-package suite scores
 * WORSE the more of its behavior lives behind its public entry point. The same
 * split also produces two module identities for one symbol (bundle copy vs.
 * source copy) whenever a suite mixes package and relative imports.
 *
 * The fix is not per-package: node's own `exports` resolution already picks the
 * right conditional target, so this only has to map the resolved
 * `<workspace>/dist/<entry>.js` back to `<workspace>/src/<entry>.ts` — the
 * inverse of what the build emits, and exactly the mapping `use-source` writes
 * its stubs from. Every package, every subpath export, and every package added
 * later is covered with no list to maintain.
 *
 * This is a resolver, not a file mutation: unlike `use-source` it writes
 * nothing into `dist`, so it cannot clobber a build or leave a tree that needs
 * `use-dist` afterwards.
 */

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { Plugin } from "vite";

/** Workspace groups from the root `workspaces` globs. */
export const WORKSPACE_GROUPS = ["packages", "providers", "examples"] as const;

/** Source extensions a dist entry can have come from, in resolution order. */
const SOURCE_EXTENSIONS = [".ts", ".tsx"] as const;

export interface WorkspacePackage {
  /** Package name as published, e.g. `@workglow/util`. */
  readonly name: string;
  /** Absolute workspace directory. */
  readonly dir: string;
}

/**
 * Every workspace package with a name, found by scanning the workspace groups.
 *
 * Deliberately not `scripts/lib/util.ts`'s `findWorkspaces`: that one is
 * Bun-only (`Bun.Glob`), and this module is imported by `vitest.config.ts`,
 * which Vite loads under Node.
 */
export function listWorkspacePackages(root: string): WorkspacePackage[] {
  const found: WorkspacePackage[] = [];
  for (const group of WORKSPACE_GROUPS) {
    let entries: string[];
    try {
      entries = readdirSync(join(root, group));
    } catch {
      continue;
    }
    for (const entry of entries) {
      const dir = join(root, group, entry);
      try {
        const manifest = JSON.parse(readFileSync(join(dir, "package.json"), "utf8")) as {
          name?: unknown;
        };
        if (typeof manifest.name === "string") found.push({ name: manifest.name, dir });
      } catch {
        // Not a package directory (or unreadable manifest) — nothing to map.
      }
    }
  }
  return found.sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * The source file a built entry came from, or `undefined` when there is none.
 *
 * `<pkg>/dist/media-node.js` → `<pkg>/src/media-node.ts`, mirroring
 * {@link import("./sourceStubs").sourceCounterpart}. Returning `undefined` for
 * a dist path with no counterpart is what keeps generated, copied, or
 * non-TypeScript build output (wasm, assets, a `.d.ts`) on the built file.
 */
export function distToSource(id: string): string | undefined {
  const match = /^(?<pkg>.*)\/dist\/(?<entry>.+)\.(?:js|mjs|cjs)$/.exec(id);
  if (!match?.groups) return undefined;
  const { pkg, entry } = match.groups;
  for (const ext of SOURCE_EXTENSIONS) {
    const candidate = `${pkg}/src/${entry}${ext}`;
    if (existsSync(candidate)) return candidate;
  }
  return undefined;
}

/**
 * The workspace package a bare specifier belongs to, or `undefined` when none
 * owns it.
 *
 * Matching is on the package BOUNDARY, not on string prefix: `@workglow/util`
 * owns `@workglow/util/schema` but not a hypothetical `@workglow/utilities`.
 */
export function ownerOf(
  packages: readonly WorkspacePackage[],
  source: string
): WorkspacePackage | undefined {
  return packages.find((pkg) => source === pkg.name || source.startsWith(`${pkg.name}/`));
}

/**
 * The diagnostic for a workspace specifier that resolved to nothing.
 *
 * Worth building by hand because the default is actively misleading: this
 * plugin rewrites the RESULT of resolution, so resolution itself still goes
 * through the package's `exports`, which point at `./dist/*`. With no built
 * entry there, resolution fails before the rewrite can happen and the error
 * blames the manifest, naming neither this plugin nor anything to do about it.
 *
 * `distHasBuiltEntries` is passed in rather than probed here so the message
 * stays a pure function of its inputs. The two branches need opposite
 * responses, which is why they are not one sentence: an empty or absent `dist`
 * means the package has simply never been built, whereas a POPULATED `dist`
 * that still does not carry this entry is the "added an `exports` subpath and
 * did not rebuild" case — where "run build" on its own reads as wrong advice to
 * someone looking at a directory full of bundles.
 */
export function unresolvedWorkspaceMessage(
  source: string,
  owner: WorkspacePackage,
  distHasBuiltEntries: boolean,
  importer: string | undefined
): string {
  const from = importer === undefined ? "" : ` (imported from ${importer})`;
  const remedy = distHasBuiltEntries
    ? `${owner.dir}/dist carries built entries but none for this specifier. A new "exports" ` +
      `subpath was most likely added without rebuilding, so dist is stale rather than absent: ` +
      `re-run \`bun run build\` (or \`bun run use-source\`).`
    : `${owner.dir}/dist is missing or empty — ${owner.name} has never been built in this ` +
      `checkout. Run \`bun run build\`, or \`bun run use-source\` to write source stubs into dist.`;
  return (
    `[workglow:workspace-source] cannot resolve "${source}"${from}. ` +
    `It is owned by the workspace package ${owner.name}. Resolution goes through that ` +
    `package's "exports", which point at ./dist/*, so the built entry has to exist even ` +
    `though this plugin then rewrites it to src. ${remedy}`
  );
}

/**
 * Whether a package's `dist` holds anything at all. `bun run clean` and
 * `use-dist --no-build` both leave the directory in place but empty, which is
 * "never built" rather than "stale".
 */
function hasBuiltEntries(packageDir: string): boolean {
  try {
    return readdirSync(join(packageDir, "dist")).length > 0;
  } catch {
    return false;
  }
}

/**
 * Redirect workspace package imports from `dist` to `src`.
 *
 * Resolution runs normally first (so conditional exports still pick the
 * node/browser/bun target the runtime asked for) and only the RESULT is
 * rewritten. That ordering is the whole trick — replicating condition
 * resolution in an alias table is what a per-package fix would have to do.
 */
export function workspaceSourcePlugin(root: string): Plugin {
  const packages = listWorkspacePackages(root);

  return {
    name: "workglow:workspace-source",
    enforce: "pre",
    async resolveId(source, importer, options) {
      // Bare workspace specifiers only: a relative import already points at
      // source, and resolving every third-party specifier twice would tax the
      // whole run for nothing.
      const owner = ownerOf(packages, source);
      if (owner === undefined) return null;
      const resolved = await this.resolve(source, importer, { ...options, skipSelf: true });
      if (!resolved) {
        // Throwing, not warning: an unresolvable @workglow/* specifier already
        // fails the run a moment later. This only replaces the message.
        throw new Error(
          unresolvedWorkspaceMessage(source, owner, hasBuiltEntries(owner.dir), importer)
        );
      }
      if (resolved.external) return resolved;
      const sourceFile = distToSource(resolved.id);
      return sourceFile === undefined ? resolved : { ...resolved, id: sourceFile };
    },
  };
}

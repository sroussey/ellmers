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
// Extensions required on both: this module is in `vitest.config.ts`'s graph,
// which Vite's native config loader resolves without extension inference.
import { collectBinTargets, collectDistTargets, probeSourceStub } from "./sourceStubs.ts";
import { workspaceGroups } from "./workspaceGroups.ts";

/** Source extensions a dist entry can have come from, in resolution order. */
const SOURCE_EXTENSIONS = [".ts", ".tsx"] as const;

/**
 * What a test run resolves `@workglow/*` specifiers to. `source` is the
 * default; `dist` restores `exports` resolution so the built bundles are what
 * gets exercised.
 */
export const TEST_TARGETS = ["source", "dist"] as const;

export type TestTarget = (typeof TEST_TARGETS)[number];

/**
 * `WORKGLOW_TEST_TARGET` as a value both readers agree on.
 *
 * Every consumer previously compared against the literal `"dist"` and treated
 * anything else as `source`, silently and independently. A workflow edited to
 * `"dist "` or `Dist` therefore turned the dist job into a byte-identical rerun
 * of the source job: green, a full runner slot spent, and zero coverage of the
 * bundles it exists to check. Nothing anywhere said so.
 *
 * Unset and empty mean `source`, since that is the default a caller who set
 * nothing is asking for. Everything else THROWS naming the value: no
 * lowercasing and no prefix matching, because both turn a typo into a silent
 * reinterpretation, which is the failure being fixed rather than a fix for it.
 */
export function resolveTestTarget(raw: string | undefined): TestTarget {
  const value = raw ?? "";
  // Trimmed only to decide "nothing was set"; the comparison below is against
  // the raw value, so `"dist "` is a typo that fails rather than a target.
  if (value.trim() === "") return "source";
  const match = TEST_TARGETS.find((target) => target === value);
  if (match !== undefined) return match;
  throw new Error(
    `WORKGLOW_TEST_TARGET="${raw}" is not a known test target. ` +
      `Expected one of: ${TEST_TARGETS.join(", ")} (or unset for "source").`
  );
}

export interface WorkspacePackage {
  /** Package name as published, e.g. `@workglow/util`. */
  readonly name: string;
  /** Absolute workspace directory. */
  readonly dir: string;
  /**
   * The manifest's `exports` field, verbatim, or `undefined` when it declares
   * none. Read here because the manifest is already parsed — a diagnostic that
   * has to re-read it would be one more thing to keep in step.
   */
  readonly exports: unknown;
  /**
   * The manifest's `bin` field, verbatim, or `undefined` when it declares none.
   *
   * `use-source` stubs `bin` targets too, and two of them are named by no
   * `exports` entry at all (`examples/eval` declares no `exports`; `examples/cli`'s
   * bin is not among its export targets), so a guard reading only `exports`
   * looked straight past them.
   */
  readonly bin: unknown;
  /** Every name this package lists in any dependency block. */
  readonly dependencies: ReadonlySet<string>;
  /**
   * Whether this workspace ships anything to a registry — `false` only for a
   * manifest that opts out with `publishConfig.access: "none"`.
   *
   * Deliberately NOT `private`. `packages/test`, `providers/aws` and
   * `providers/cloudflare` are all `private: true` and all carry real tests
   * whose source belongs in the coverage denominator; `access: "none"` is the
   * narrower statement that a workspace publishes no API at all.
   */
  readonly publishes: boolean;
}

/** Dependency blocks that make a package resolvable from another one. */
const DEPENDENCY_BLOCKS = [
  "dependencies",
  "devDependencies",
  "peerDependencies",
  "optionalDependencies",
] as const;

/** Every package name a manifest declares in any dependency block. */
function declaredDependencies(manifest: Record<string, unknown>): ReadonlySet<string> {
  const names = new Set<string>();
  for (const block of DEPENDENCY_BLOCKS) {
    const value = manifest[block];
    if (typeof value !== "object" || value === null || Array.isArray(value)) continue;
    for (const name of Object.keys(value)) names.add(name);
  }
  return names;
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
  for (const group of workspaceGroups(root)) {
    let entries: string[];
    try {
      entries = readdirSync(join(root, group));
    } catch {
      continue;
    }
    for (const entry of entries) {
      const dir = join(root, group, entry);
      const manifestPath = join(dir, "package.json");
      let manifest: { name?: unknown; exports?: unknown; bin?: unknown; publishConfig?: unknown };
      try {
        manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as typeof manifest;
      } catch (error) {
        // A directory with no manifest is the ordinary case — build output,
        // `.turbo`, an editor scratch folder — and is simply not a package.
        // Anything else (malformed JSON, unreadable file) is a real fault, and
        // swallowing it drops a package from the resolver silently: the plugin
        // then no-ops for that package and its coverage collapses back onto
        // `dist/*`, which is exactly the symptom this module exists to remove.
        if ((error as NodeJS.ErrnoException | null)?.code === "ENOENT") continue;
        throw new Error(`Cannot read workspace manifest ${manifestPath}: ${String(error)}`, {
          cause: error,
        });
      }
      if (typeof manifest.name !== "string") continue;
      const publishConfig = manifest.publishConfig;
      const access =
        typeof publishConfig === "object" && publishConfig !== null
          ? (publishConfig as { access?: unknown }).access
          : undefined;
      found.push({
        name: manifest.name,
        dir,
        exports: manifest.exports,
        bin: manifest.bin,
        dependencies: declaredDependencies(manifest as Record<string, unknown>),
        publishes: access !== "none",
      });
    }
  }
  return found.sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Fail when any package's published dist entry is a `use-source` stub.
 *
 * The `dist` target exists to exercise the BUILT BUNDLES. A stubbed dist
 * re-exports `src`, so every bundle-shaped assertion passes for the wrong
 * reason: `@workglow/ai` and `@workglow/ai/worker` collapse onto one source
 * module, so every cross-entry `instanceof` succeeds trivially and an
 * export-name parity check compares a file with itself. The run stays green and
 * covers nothing.
 *
 * One aggregated error, because a developer who ran `use-source` has stubbed
 * every package: failing on the first would take 41 fix-and-rerun cycles to
 * learn the one fact the message already knows.
 */
export function assertNoSourceStubs(packages: readonly WorkspacePackage[]): void {
  const stubs: string[] = [];
  const unreadable: string[] = [];
  for (const pkg of packages) {
    for (const target of guardedDistTargets(pkg)) {
      const file = join(pkg.dir, target);
      if (!existsSync(file)) continue;
      const probe = probeSourceStub(file);
      if (probe === "stub") stubs.push(file);
      else if (probe === "unreadable") unreadable.push(file);
    }
  }
  if (stubs.length === 0 && unreadable.length === 0) return;

  const sections: string[] = [];
  if (stubs.length > 0) {
    sections.push(
      `${stubs.length} published entr${stubs.length === 1 ? "y is" : "ies are"} a ` +
        `\`use-source\` stub re-exporting src. Every bundle-identity assertion would pass ` +
        `vacuously.\n${stubs.join("\n")}`
    );
  }
  if (unreadable.length > 0) {
    sections.push(
      `${unreadable.length} published entr${unreadable.length === 1 ? "y" : "ies"} could not ` +
        `be read, so ${unreadable.length === 1 ? "it" : "they"} cannot be proved to be a real ` +
        `bundle — and an entry that cannot be proved to be one is not one. Treating it as ` +
        `built is exactly how the vacuous pass this guard exists to prevent gets ` +
        `through.\n${unreadable.join("\n")}`
    );
  }
  throw new Error(
    `WORKGLOW_TEST_TARGET="dist" exercises the built bundles. Run \`bun run use-dist\` to ` +
      `restore the real build.\n\n${sections.join("\n\n")}`
  );
}

/**
 * Every dist entry `use-source` writes a stub into, for guard purposes: the
 * `exports` targets plus any `bin` target they do not already name.
 *
 * Deliberately NOT `stubSpecsFor`, which additionally maps each target to a
 * source counterpart and THROWS for one that is neither `.js` nor `.d.ts`. All
 * 338 dist targets across the 41 manifests are one of those today, but the
 * guard has no use for the mapping and should not acquire a new way to fail
 * during config resolution.
 */
export function guardedDistTargets(pkg: WorkspacePackage): string[] {
  const targets = collectDistTargets(pkg.exports);
  for (const binTarget of collectBinTargets(pkg.bin)) {
    if (!targets.includes(binTarget)) targets.push(binTarget);
  }
  return targets;
}

/** The guard plugin's name, so a test can assert attachment without a literal. */
export const DIST_STUB_GUARD_PLUGIN_NAME = "workglow:dist-stub-guard";

/**
 * {@link assertNoSourceStubs} as a plugin hook rather than a side effect of
 * loading `vitest.config.ts`.
 *
 * That module is ordinarily importable — `scripts/workspaceSource.test.ts`
 * imports it with `WORKGLOW_TEST_TARGET` stubbed to `dist` to check plugin
 * attachment, and `scripts/*.test.ts` is unit-tier — so scanning at module
 * scope made an ordinary `bun run test:vitest:unit` on a `use-source` tree die
 * with advice to run `use-dist`, undoing the no-build dev mode the run never
 * left. Vitest resolves EVERY project's config at startup, so running the
 * assertion in `configResolved` still kills the run before any suite can report
 * a pass over stubs.
 *
 * The verdict is computed once and re-thrown, so one scan of the tree serves
 * every project rather than one per project. Every project still throws, so
 * none can be initialized past a stubbed tree; vitest's own startup
 * `AggregateError` then lists that single Error object once per project it
 * failed to set up, which is its reporting rather than a repeated scan.
 */
export function sourceStubGuardPlugin(packages: readonly WorkspacePackage[]): Plugin {
  let verdict: { error: Error | undefined } | undefined;
  return {
    name: DIST_STUB_GUARD_PLUGIN_NAME,
    enforce: "pre",
    configResolved() {
      if (verdict === undefined) {
        try {
          assertNoSourceStubs(packages);
          verdict = { error: undefined };
        } catch (error) {
          verdict = { error: error instanceof Error ? error : new Error(String(error)) };
        }
      }
      if (verdict.error !== undefined) throw verdict.error;
    },
  };
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

/** Everything the unresolved-specifier diagnostic reasons from. */
export interface UnresolvedWorkspaceContext {
  /** The specifier that resolved to nothing. */
  readonly source: string;
  /** The workspace package that owns {@link source}. */
  readonly owner: WorkspacePackage;
  /** The importing file, when Vite reported one. */
  readonly importer: string | undefined;
  /** The workspace package the importer lives in, or `undefined` outside one. */
  readonly importerPackage: WorkspacePackage | undefined;
  /**
   * Whether {@link importerPackage} lists {@link owner} in any dependency
   * block. `undefined` when the importer is outside a workspace package, where
   * the question does not apply rather than answering "no".
   */
  readonly importerDeclaresDependency: boolean | undefined;
  /** Whether the owner's `exports` declares the subpath the specifier asks for. */
  readonly ownerDeclaresSubpath: boolean;
  /** Whether the owner's `dist` holds anything at all. */
  readonly distHasBuiltEntries: boolean;
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
 * Every input is passed in rather than probed here so the message stays a pure
 * function of its inputs.
 *
 * The causes are RANKED, because resolution fails from the IMPORTER's
 * `node_modules` and only the last two are about the owner's `dist` at all.
 * With `linker = "isolated"` an importer sees only what it declares, so an
 * undeclared workspace dependency — or a subpath the owner's `exports` never
 * published — fails while the owner's `dist` is fully populated. Offering only
 * "never built" or "stale dist" there is confident, wrong advice: rebuilding
 * changes nothing, and the reader is sent to look at a directory that is fine.
 */
export function unresolvedWorkspaceMessage(context: UnresolvedWorkspaceContext): string {
  const {
    source,
    owner,
    importer,
    importerPackage,
    importerDeclaresDependency,
    ownerDeclaresSubpath,
    distHasBuiltEntries,
  } = context;
  const from = importer === undefined ? "" : ` (imported from ${importer})`;

  let remedy: string;
  if (importerDeclaresDependency === false && importerPackage !== undefined) {
    remedy =
      `${importerPackage.name} does not list ${owner.name} in any of its dependency blocks. ` +
      `bunfig sets linker = "isolated", so a workspace package resolves only what it ` +
      `declares: nothing is linked into ${importerPackage.dir}/node_modules for this ` +
      `specifier no matter what ${owner.name} has built. Add ${owner.name} to ` +
      `${importerPackage.name}'s package.json and re-run \`bun i\`.`;
  } else if (!ownerDeclaresSubpath) {
    remedy =
      `${owner.name}'s "exports" does not declare this subpath, so resolution fails at the ` +
      `manifest and never reaches dist. Add the subpath to ${owner.dir}/package.json — this ` +
      `one is missing from the manifest, not from the build output.`;
  } else if (distHasBuiltEntries) {
    remedy =
      `The remaining likely cause: ${owner.dir}/dist carries built entries but none for this ` +
      `specifier. A new "exports" subpath was most likely added without rebuilding, so dist ` +
      `is stale rather than absent: re-run \`bun run build\` (or \`bun run use-source\`).`;
  } else {
    remedy =
      `The remaining likely cause: ${owner.dir}/dist is missing or empty — ${owner.name} has ` +
      `never been built in this checkout. Run \`bun run build\`, or \`bun run use-source\` to ` +
      `write source stubs into dist.`;
  }

  return (
    `[workglow:workspace-source] cannot resolve "${source}"${from}. ` +
    `It is owned by the workspace package ${owner.name}. Resolution goes through that ` +
    `package's "exports", which point at ./dist/*, so the built entry has to exist even ` +
    `though this plugin then rewrites it to src. ${remedy}`
  );
}

/**
 * The workspace package a file belongs to — the DEEPEST directory containing
 * it, so a nested workspace is not attributed to an ancestor.
 */
export function importerPackageOf(
  packages: readonly WorkspacePackage[],
  importer: string | undefined
): WorkspacePackage | undefined {
  if (importer === undefined) return undefined;
  let best: WorkspacePackage | undefined;
  for (const pkg of packages) {
    if (!importer.startsWith(`${pkg.dir}/`)) continue;
    if (best === undefined || pkg.dir.length > best.dir.length) best = pkg;
  }
  return best;
}

/** The `exports` subpath key a specifier asks its owner for (`.`, `./worker`, …). */
export function subpathOf(owner: WorkspacePackage, source: string): string {
  return source === owner.name ? "." : `.${source.slice(owner.name.length)}`;
}

/**
 * Whether an owner's `exports` publishes a subpath.
 *
 * A manifest with no `exports` at all publishes its whole directory, so the
 * question does not apply and the answer is yes — reporting "not exported"
 * there would send the reader to add a field the package deliberately omits.
 */
export function declaresSubpath(owner: WorkspacePackage, subpath: string): boolean {
  const map = owner.exports;
  if (map === undefined || map === null) return true;
  // A string or a bare condition map IS the "." entry and publishes nothing else.
  if (typeof map !== "object" || Array.isArray(map)) return subpath === ".";
  const keys = Object.keys(map as Record<string, unknown>);
  if (!keys.some((key) => key === "." || key.startsWith("./"))) return subpath === ".";
  return keys.some((key) => {
    if (key === subpath) return true;
    const star = key.indexOf("*");
    if (star === -1) return false;
    const prefix = key.slice(0, star);
    const suffix = key.slice(star + 1);
    return (
      subpath.length >= prefix.length + suffix.length &&
      subpath.startsWith(prefix) &&
      subpath.endsWith(suffix)
    );
  });
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

/** The part of a resolution result the rewrite reads. */
export interface WorkspaceResolvedId {
  /** Absolute path (or external id) resolution landed on. */
  readonly id: string;
  /** Externality, when the resolver reported any. */
  readonly external?: boolean | string | undefined;
}

/** The only `this.resolve` option this forwards deliberately. */
export interface WorkspaceResolveOptions {
  readonly skipSelf?: boolean | undefined;
}

/**
 * The one capability {@link resolveWorkspaceSourceId} needs from Vite's plugin
 * context, so the hook body is drivable by a plain object in a test.
 *
 * `resolve` is declared with METHOD syntax on purpose. Under
 * `strictFunctionTypes` a property-syntax function is checked
 * contravariantly in its parameters, and Vite's real `PluginContext.resolve`
 * — whose `importer`/`options` are optional and whose options type is its own
 * — would then need a cast at the one call site that matters. Method syntax
 * keeps parameters bivariant, so `PluginContext` satisfies this interface
 * structurally and the adapter below passes `this` through untouched.
 *
 * Generic in the result so the adapter's return type stays the resolver's own
 * (`ResolvedId`), which is what Vite's `resolveId` hook is declared to return;
 * widening it here would push a cast back into the plugin.
 */
export interface WorkspaceResolveContext<
  TResolved extends WorkspaceResolvedId = WorkspaceResolvedId,
> {
  resolve(
    source: string,
    importer: string | undefined,
    options: WorkspaceResolveOptions
  ): Promise<TResolved | null | undefined>;
}

/**
 * Resolve one specifier, rewriting a workspace package's built entry to its
 * source file.
 *
 * Resolution runs normally first (so conditional exports still pick the
 * node/browser/bun target the runtime asked for) and only the RESULT is
 * rewritten. That ordering is the whole trick — replicating condition
 * resolution in an alias table is what a per-package fix would have to do.
 *
 * Extracted from the plugin so it can be driven directly: the hook is the one
 * function this whole module exists for, and inside a `Plugin` object literal
 * it is reachable only through a Vite build.
 */
export async function resolveWorkspaceSourceId<TResolved extends WorkspaceResolvedId>(
  packages: readonly WorkspacePackage[],
  context: WorkspaceResolveContext<TResolved>,
  source: string,
  importer: string | undefined,
  // Forwarded verbatim (`kind`, `isEntry`, `custom` all steer resolution);
  // only `skipSelf` is this function's own contribution.
  options: object
): Promise<TResolved | null> {
  // Bare workspace specifiers only: a relative import already points at
  // source, and resolving every third-party specifier twice would tax the
  // whole run for nothing.
  const owner = ownerOf(packages, source);
  if (owner === undefined) return null;
  const resolved = await context.resolve(source, importer, { ...options, skipSelf: true });
  if (!resolved) {
    // Throwing, not warning: an unresolvable @workglow/* specifier already
    // fails the run a moment later. This only replaces the message.
    const importerPackage = importerPackageOf(packages, importer);
    throw new Error(
      unresolvedWorkspaceMessage({
        source,
        owner,
        importer,
        importerPackage,
        importerDeclaresDependency: importerPackage?.dependencies.has(owner.name),
        ownerDeclaresSubpath: declaresSubpath(owner, subpathOf(owner, source)),
        distHasBuiltEntries: hasBuiltEntries(owner.dir),
      })
    );
  }
  if (resolved.external) return resolved;
  const sourceFile = distToSource(resolved.id);
  return sourceFile === undefined ? resolved : { ...resolved, id: sourceFile };
}

/** The plugin name, so a test can assert attachment without repeating a literal. */
export const WORKSPACE_SOURCE_PLUGIN_NAME = "workglow:workspace-source";

/**
 * Redirect workspace package imports from `dist` to `src`.
 *
 * A one-line adapter over {@link resolveWorkspaceSourceId}: the package list is
 * read once, and every decision lives in that function.
 *
 * `packages` is accepted so a caller building MANY projects can scan once and
 * share the result. `vitest.config.ts` builds one project per workspace that
 * holds tests and every one needs the plugin attached (projects are standalone
 * Vite configs, so a root-level `plugins` entry never reaches them); scanning
 * per project re-read every workspace manifest once per project at config load,
 * for an answer that cannot differ between them.
 * The plugin holds no per-project state, so one instance serves them all.
 */
export function workspaceSourcePlugin(
  root: string,
  packages: readonly WorkspacePackage[] = listWorkspacePackages(root)
): Plugin {
  return {
    name: WORKSPACE_SOURCE_PLUGIN_NAME,
    enforce: "pre",
    async resolveId(source, importer, options) {
      return resolveWorkspaceSourceId(packages, this, source, importer, options);
    },
  };
}

/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { type ITabularMigrationApplier, type TabularMigrationOp, runBackfill } from "../migrations";
import { type AnyTabularStorage } from "./ITabularStorage";

/**
 * Applier for schemaless tabular backends (InMemory / Shared / FsFolder /
 * HuggingFace). DDL ops are no-ops because records are plain JS objects;
 * `backfill` runs through the storage's normal `getPage`/`put`/`delete`
 * API. Bookkeeping is held in the in-memory `applied` map by default;
 * subclasses (e.g. for FsFolder) may override `persist()` / `load()` to
 * make it durable.
 *
 * `tableExists` is a heuristic: returns true when the storage already
 * holds rows. Combined with the empty `applied` set, this makes a
 * brand-new InMemory storage take the orchestrator's fresh-DB fast path
 * (mark-all-applied without running ops); a storage that was rehydrated
 * from a dump will look like an existing-DB and have its migrations
 * actually run, matching dev/prod parity expectations.
 */
export class InMemoryTabularMigrationApplier implements ITabularMigrationApplier {
  protected applied = new Map<string, Set<number>>();

  constructor(
    protected readonly storage: AnyTabularStorage,
    protected readonly storeName: string
  ) {}

  async ensureBookkeeping(): Promise<void> {
    // Subclasses with durable bookkeeping override to load from disk.
  }

  async appliedVersions(component: string): Promise<Set<number>> {
    return new Set(this.applied.get(component) ?? []);
  }

  async tableExists(): Promise<boolean> {
    return (await this.storage.size()) > 0;
  }

  async markAllApplied(
    component: string,
    versions: ReadonlyArray<{ version: number; description: string | undefined }>
  ): Promise<void> {
    if (versions.length === 0) return;
    let set = this.applied.get(component);
    if (!set) {
      set = new Set();
      this.applied.set(component, set);
    }
    for (const v of versions) set.add(v.version);
    await this.persist();
  }

  async applyMigration(
    component: string,
    version: number,
    _description: string | undefined,
    ops: ReadonlyArray<TabularMigrationOp>,
    onProgress?: (fraction: number) => void
  ): Promise<void> {
    let processed = 0;
    const total = Math.max(ops.length, 1);
    for (const op of ops) {
      if (op.kind === "backfill") {
        await runBackfill(this.storage, op.batchSize ?? 500, op.transform);
      }
      // DDL ops (addColumn / dropColumn / renameColumn / addIndex /
      // dropIndex) are no-ops on schemaless backends.
      processed++;
      onProgress?.(processed / total);
    }
    let set = this.applied.get(component);
    if (!set) {
      set = new Set();
      this.applied.set(component, set);
    }
    set.add(version);
    await this.persist();
  }

  /** Subclasses (e.g. FsFolder) override to flush bookkeeping to disk. */
  protected async persist(): Promise<void> {}
}

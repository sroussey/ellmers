/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type {
  AnyTabularStorage,
  CoveringIndexQueryOptions,
  PageCursor,
  DeleteSearchCriteria,
  ITabularStorage,
  Page,
  PageRequest,
  QueryOptions,
  SearchCriteria,
  TabularChangePayload,
  TabularEventListener,
  TabularEventListeners,
  TabularEventName,
  TabularEventParameters,
  TabularSubscribeOptions,
} from "@workglow/storage";
import { decodeCursor, StorageValidationError } from "@workglow/storage";
import { EventEmitter } from "@workglow/util";
import type { DataPortSchemaObject } from "@workglow/util/schema";

/**
 * Wrapper implementing `ITabularStorage` that delegates to an inner shared
 * storage instance, injecting `kb_id` on writes and filtering by `kb_id` on
 * reads. The outer interface does not include `kb_id` — it is transparent to
 * the `KnowledgeBase` class.
 */
export class ScopedTabularStorage<
  Schema extends DataPortSchemaObject,
  PrimaryKeyNames extends ReadonlyArray<keyof Schema["properties"]>,
  Entity = any,
  PrimaryKey = any,
  InsertType = any,
> implements ITabularStorage<Schema, PrimaryKeyNames, Entity, PrimaryKey, InsertType> {
  protected readonly inner: AnyTabularStorage;
  protected readonly kbId: string;
  protected readonly events = new EventEmitter<TabularEventListeners<PrimaryKey, Entity>>();

  constructor(inner: AnyTabularStorage, kbId: string) {
    this.inner = inner;
    this.kbId = kbId;
  }

  private inject(value: any): any {
    return { ...value, kb_id: this.kbId };
  }

  private strip(entity: any): Entity {
    if (!entity) return entity;
    const { kb_id: _, ...rest } = entity;
    return rest as Entity;
  }

  private stripArray(entities: any[] | undefined): Entity[] | undefined {
    if (!entities) return undefined;
    return entities.map((e) => this.strip(e));
  }

  async put(value: InsertType): Promise<Entity> {
    const result = await this.inner.put(this.inject(value));
    const stripped = this.strip(result);
    this.events.emit("put", stripped);
    return stripped;
  }

  async putBulk(values: InsertType[]): Promise<Entity[]> {
    const injected = values.map((v) => this.inject(v));
    const results = await this.inner.putBulk(injected);
    const stripped = results.map((r: any) => this.strip(r));
    for (const entity of stripped) {
      this.events.emit("put", entity);
    }
    return stripped;
  }

  async get(key: PrimaryKey): Promise<Entity | undefined> {
    const result = await this.inner.get({ ...(key as any), kb_id: this.kbId } as any);
    if (!result) return undefined;
    const stripped = this.strip(result);
    this.events.emit("get", key, stripped);
    return stripped;
  }

  async delete(key: PrimaryKey | Entity): Promise<void> {
    await this.inner.deleteSearch({ ...(key as any), kb_id: this.kbId } as any);
    this.events.emit("delete", key as keyof Entity);
  }

  async getAll(options?: QueryOptions<Entity>): Promise<Entity[] | undefined> {
    const results = await this.inner.query({ kb_id: this.kbId } as any, options as any);
    return this.stripArray(results);
  }

  async deleteAll(): Promise<void> {
    await this.inner.deleteSearch({ kb_id: this.kbId } as any);
    this.events.emit("clearall");
  }

  async size(): Promise<number> {
    return await this.count();
  }

  async count(criteria?: SearchCriteria<Entity>): Promise<number> {
    return await this.inner.count({ ...(criteria as any), kb_id: this.kbId });
  }

  async query(
    criteria: SearchCriteria<Entity>,
    options?: QueryOptions<Entity>
  ): Promise<Entity[] | undefined> {
    const results = await this.inner.query(
      { ...(criteria as any), kb_id: this.kbId },
      options as any
    );
    const stripped = this.stripArray(results);
    this.events.emit("query", criteria as Partial<Entity>, stripped);
    return stripped;
  }

  async deleteSearch(criteria: DeleteSearchCriteria<Entity>): Promise<void> {
    await this.inner.deleteSearch({ ...(criteria as any), kb_id: this.kbId });
  }

  async queryIndex<K extends keyof Entity & string>(
    criteria: SearchCriteria<Entity>,
    options: CoveringIndexQueryOptions<Entity, K>
  ): Promise<Pick<Entity, K>[]> {
    const rows = await this.inner.queryIndex(
      { ...(criteria as any), kb_id: this.kbId } as any,
      options as any
    );
    return (rows as any[]).map((r) => this.strip(r)) as Pick<Entity, K>[];
  }

  async getBulk(offset: number, limit: number): Promise<Entity[] | undefined> {
    const results = await this.inner.query({ kb_id: this.kbId } as any, { offset, limit });
    return this.stripArray(results);
  }

  async getPage(request?: PageRequest<Entity>): Promise<Page<Entity>> {
    // ScopedTabularStorage always paginates the inner store filtered by
    // `kb_id`, so even the no-criteria `getPage` becomes a `queryPage` on
    // the inner storage. The cursor returned by inner is opaque to our
    // callers and round-trips through us unchanged.
    return this.scopedPage(undefined, request);
  }

  async queryPage(
    criteria: SearchCriteria<Entity>,
    request?: PageRequest<Entity>
  ): Promise<Page<Entity>> {
    return this.scopedPage(criteria, request);
  }

  private async scopedPage(
    criteria: SearchCriteria<Entity> | undefined,
    request: PageRequest<Entity> | undefined
  ): Promise<Page<Entity>> {
    if (request?.cursor !== undefined) {
      // Cursors minted by KB-A are structurally identical to cursors minted
      // by KB-B — both encode `kb_id` as part of the inner store's effective
      // ordering. Without an explicit check, a cursor handed across a KB
      // boundary would still be accepted by `inner.queryPage` and produce
      // silently-wrong results: with `[kb_id ASC, id ASC]` ordering, a
      // foreign cursor's keyset (`kb_id > A` OR `kb_id = A AND id > X`)
      // intersected with our `kb_id = self` filter either streams from the
      // wrong starting position or returns an empty page that looks like
      // iteration ended. Decode and verify before forwarding.
      const payload = decodeCursor(request.cursor);
      const kbIndex = payload.n.indexOf("kb_id");
      if (kbIndex >= 0 && payload.c[kbIndex] !== this.kbId) {
        throw new StorageValidationError(
          `Cursor was minted for kb_id="${String(payload.c[kbIndex])}"; this scope is kb_id="${this.kbId}"`
        );
      }
    }
    const scopedCriteria = { ...((criteria ?? {}) as any), kb_id: this.kbId };
    const innerPage = await this.inner.queryPage(scopedCriteria, request as any);
    const items = innerPage.items.map((row: any) => this.strip(row)) as Entity[];
    // Emit `query` for parity with `ScopedTabularStorage.query`. Cache
    // invalidators that listen for tabular reads need to see page reads
    // too; otherwise switching a caller from `query` to `getPage` would
    // silently invalidate their invalidation logic. The emitted criteria
    // is the *user-facing* criteria (without our injected `kb_id`).
    this.events.emit("query", (criteria ?? {}) as Partial<Entity>, items);
    return { items, nextCursor: innerPage.nextCursor };
  }

  async *records(pageSize: number = 100): AsyncGenerator<Entity, void, undefined> {
    if (pageSize <= 0) {
      throw new RangeError(`pageSize must be greater than 0, got ${pageSize}`);
    }
    let cursor: PageCursor | undefined;
    while (true) {
      const page = await this.getPage({ limit: pageSize, cursor });
      for (const entity of page.items) yield entity;
      if (!page.nextCursor || page.items.length === 0) break;
      cursor = page.nextCursor;
    }
  }

  async *pages(pageSize: number = 100): AsyncGenerator<Entity[], void, undefined> {
    if (pageSize <= 0) {
      throw new RangeError(`pageSize must be greater than 0, got ${pageSize}`);
    }
    let cursor: PageCursor | undefined;
    while (true) {
      const page = await this.getPage({ limit: pageSize, cursor });
      if (page.items.length > 0) yield page.items.slice() as Entity[];
      if (!page.nextCursor || page.items.length === 0) break;
      cursor = page.nextCursor;
    }
  }

  // Events — scoped via local emitter; mutation methods emit here after inner ops
  on<Event extends TabularEventName>(
    name: Event,
    fn: TabularEventListener<Event, PrimaryKey, Entity>
  ): void {
    this.events.on(name, fn);
  }

  off<Event extends TabularEventName>(
    name: Event,
    fn: TabularEventListener<Event, PrimaryKey, Entity>
  ): void {
    this.events.off(name, fn);
  }

  emit<Event extends TabularEventName>(
    name: Event,
    ...args: TabularEventParameters<Event, PrimaryKey, Entity>
  ): void {
    this.events.emit(name, ...args);
  }

  once<Event extends TabularEventName>(
    name: Event,
    fn: TabularEventListener<Event, PrimaryKey, Entity>
  ): void {
    this.events.once(name, fn);
  }

  waitOn<Event extends TabularEventName>(
    name: Event
  ): Promise<TabularEventParameters<Event, PrimaryKey, Entity>> {
    return this.events.waitOn(name);
  }

  subscribeToChanges(
    callback: (change: TabularChangePayload<Entity>) => void,
    options?: TabularSubscribeOptions
  ): () => void {
    return this.inner.subscribeToChanges((change: TabularChangePayload<any>) => {
      const newKbId = change.new?.kb_id;
      const oldKbId = change.old?.kb_id;
      if (newKbId !== undefined && newKbId !== this.kbId) return;
      if (oldKbId !== undefined && oldKbId !== this.kbId) return;
      if (newKbId === undefined && oldKbId === undefined) return;
      callback({
        type: change.type,
        ...(change.old ? { old: this.strip(change.old) } : {}),
        ...(change.new ? { new: this.strip(change.new) } : {}),
      } as TabularChangePayload<Entity>);
    }, options);
  }

  withTransaction<T>(fn: (tx: this) => Promise<T>): Promise<T> {
    // Two responsibilities here:
    //  1. Forward the inner's `tx` proxy into `fn`, so writes from the
    //     callback go through the transaction-bound resources rather than
    //     re-entering the public mutex path on the parent (which would
    //     deadlock on single-connection backends, or run on the wrong
    //     connection on real `pg.Pool`).
    //  2. Defer events emitted by the scoped wrapper until the inner
    //     transaction actually commits — Scoped emits on its own emitter
    //     (separate from the inner's `put` events), so the inner's
    //     deferred-event flush does not cover them.
    const deferred: Array<[TabularEventName, unknown[]]> = [];
    return this.inner
      .withTransaction((innerTx: AnyTabularStorage) => {
        const txWrapper = new ScopedTabularStorage<
          Schema,
          PrimaryKeyNames,
          Entity,
          PrimaryKey,
          InsertType
        >(innerTx, this.kbId);
        // Buffer emits on the tx wrapper instead of fanning them out — listeners
        // on the original wrapper see events only after COMMIT. Replace just
        // `emit` rather than the whole emitter so `tx.on/off/once/waitOn` keep
        // delegating to a real EventEmitter (otherwise calling them inside `fn`
        // would throw on a stub object that only implements `emit`).
        const txEmitter = (
          txWrapper as unknown as {
            events: EventEmitter<TabularEventListeners<PrimaryKey, Entity>>;
          }
        ).events;
        txEmitter.emit = ((name: TabularEventName, ...args: unknown[]) => {
          deferred.push([name, args]);
        }) as typeof txEmitter.emit;
        return fn(txWrapper as unknown as this);
      })
      .then((result) => {
        for (const [name, args] of deferred) {
          (this.events.emit as (n: TabularEventName, ...a: unknown[]) => void)(name, ...args);
        }
        return result;
      });
  }

  // Lifecycle — no-op for shared storage
  async setupDatabase(): Promise<void> {
    // No-op: shared storage lifecycle is managed externally
  }

  destroy(): void {
    // No-op: shared storage lifecycle is managed externally
  }

  [Symbol.dispose](): void {
    // No-op
  }

  async [Symbol.asyncDispose](): Promise<void> {
    // No-op
  }
}

/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { EventParameters } from "@workglow/util";
import { DataPortSchemaObject, FromSchema, TypedArraySchemaOptions } from "@workglow/util/schema";
import type { Cursor } from "./Cursor";

export type { Cursor } from "./Cursor";

// Generic type for possible value types in the repository
export type ValueOptionType = string | number | bigint | boolean | null | Uint8Array;

/**
 * Type definitions for tabular repository events
 */
export type TabularEventListeners<PrimaryKey, Entity> = {
  put: (entity: Entity) => void;
  get: (key: PrimaryKey, entity: Entity | undefined) => void;
  query: (key: Partial<Entity>, entities: Entity[] | undefined) => void;
  delete: (key: keyof Entity) => void;
  clearall: () => void;
};

export type TabularEventName = keyof TabularEventListeners<any, any>;
export type TabularEventListener<
  Event extends TabularEventName,
  PrimaryKey,
  Entity,
> = TabularEventListeners<PrimaryKey, Entity>[Event];

export type TabularEventParameters<
  Event extends TabularEventName,
  PrimaryKey,
  Entity,
> = EventParameters<TabularEventListeners<PrimaryKey, Entity>, Event>;

/**
 * Type of change that occurred in the repository
 */
export type TabularChangeType = "INSERT" | "UPDATE" | "DELETE";

/**
 * Payload describing a change to an entity
 */
export interface TabularChangePayload<Entity> {
  readonly type: TabularChangeType;
  readonly old?: Entity;
  readonly new?: Entity;
}

/**
 * Options for subscribing to changes in a tabular repository
 */
export interface TabularSubscribeOptions {
  /** Polling interval in milliseconds (used by implementations that rely on polling) */
  readonly pollingIntervalMs?: number;
}

export type JSONValue =
  | string
  | number
  | boolean
  | null
  | JSONValue[]
  | { [key: string]: JSONValue };

/**
 * Comparison operators for search and deleteSearch operations
 */
export type SearchOperator = "=" | "<" | "<=" | ">" | ">=";

/**
 * A search condition with a value and comparison operator
 */
export interface SearchCondition<T> {
  readonly value: T;
  readonly operator: SearchOperator;
}

/**
 * Criteria for deleteSearch operations supporting multiple columns.
 * Each column can have either a direct value (equality) or a SearchCondition with an operator.
 *
 * @example
 * // Equality match
 * { category: "electronics" }
 *
 * // With operator
 * { createdAt: { value: date, operator: "<" } }
 *
 * // Multiple columns
 * { category: "electronics", createdAt: { value: date, operator: "<" } }
 */
export type DeleteSearchCriteria<Entity> = {
  readonly [K in keyof Entity]?: Entity[K] | SearchCondition<Entity[K]>;
};

export type SearchCriteria<Entity> = DeleteSearchCriteria<Entity>;

export type SortDirection = "ASC" | "DESC";

export interface OrderBy<Entity> {
  readonly column: keyof Entity;
  readonly direction: SortDirection;
}

export interface QueryOptions<Entity> {
  readonly orderBy?: ReadonlyArray<OrderBy<Entity>>;
  readonly limit?: number;
  /**
   * @deprecated Offset-based paging is unstable when rows are inserted or
   * deleted between page fetches (entries can be skipped or duplicated).
   * Use {@link ITabularStorage.getPage} / {@link ITabularStorage.queryPage}
   * with a {@link Cursor} instead.
   *
   * @example
   * ```ts
   * // Before (offset paging):
   * const rows = await storage.getAll({ orderBy, limit: 50, offset: 100 });
   *
   * // After (cursor paging — also stable under concurrent writes):
   * let cursor: Cursor | undefined;
   * for (let i = 0; i < 3; i++) {
   *   const page = await storage.getPage({ orderBy, limit: 50, cursor });
   *   cursor = page.nextCursor;
   *   if (!cursor) break;
   * }
   * const rows = await storage.getPage({ orderBy, limit: 50, cursor });
   * ```
   */
  readonly offset?: number;
}

export interface CoveringIndexQueryOptions<Entity, K extends keyof Entity & string> {
  readonly select: readonly K[];
  readonly orderBy?: ReadonlyArray<OrderBy<Entity>>;
  readonly limit?: number;
  readonly offset?: number;
}

/**
 * Request for a cursor-paginated read.
 *
 * Pagination is keyset-based: the next page resumes after the row encoded
 * in `cursor`, with the primary key acting as the stable tiebreaker.
 * This is stable under concurrent inserts and deletes — unlike offset-based
 * paging, which can skip or duplicate rows when the underlying data
 * shifts between calls.
 *
 * If `orderBy` is omitted, rows are returned in primary-key order ascending.
 * If `orderBy` is provided, the effective ordering is `[...orderBy, ...primaryKey]`
 * so iteration remains deterministic when sort columns contain duplicates.
 */
export interface PageRequest<Entity> {
  readonly orderBy?: ReadonlyArray<OrderBy<Entity>>;
  /** Maximum number of rows to return. Defaults to 100. */
  readonly limit?: number;
  /** Opaque cursor returned by a previous call; omit to start from the beginning. */
  readonly cursor?: Cursor;
}

/**
 * A page of results from a cursor-paginated read.
 *
 * `nextCursor` is `undefined` when there are no more rows to fetch.
 * When `nextCursor` is present, callers should pass it back via
 * {@link PageRequest.cursor} to fetch the next page.
 *
 * **Termination contract.** A defined `nextCursor` does NOT guarantee
 * additional rows exist — concurrent deletes can produce an empty page
 * mid-iteration even though `nextCursor` was set. Loops MUST therefore
 * terminate on either condition, not just on `nextCursor`:
 *
 * ```ts
 * // CORRECT — terminates on both `nextCursor` and empty `items`:
 * let cursor: Cursor | undefined;
 * do {
 *   const page = await storage.getPage({ limit: 100, cursor });
 *   for (const row of page.items) handle(row);
 *   if (page.items.length === 0) break;
 *   cursor = page.nextCursor;
 * } while (cursor);
 *
 * // WRONG — can spin forever if a concurrent delete empties the next page
 * // while leaving rows further along the cursor that get deleted in turn:
 * while (page.nextCursor) { page = await storage.getPage({ cursor: page.nextCursor }); }
 * ```
 *
 * The bundled async generators ({@link ITabularStorage.records},
 * {@link ITabularStorage.pages}) honour this contract; reach for them
 * instead of writing the loop manually.
 */
export interface Page<Entity> {
  readonly items: ReadonlyArray<Entity>;
  readonly nextCursor: Cursor | undefined;
}

/**
 * Type guard to check if a value is a SearchCondition
 */
export function isSearchCondition<T>(value: unknown): value is SearchCondition<T> {
  return (
    typeof value === "object" &&
    value !== null &&
    "value" in value &&
    "operator" in value &&
    typeof (value as SearchCondition<T>).operator === "string"
  );
}

/**
 * Helper type to compute PrimaryKey while deferring Entity resolution.
 * Uses a conditional type to avoid forcing full Entity resolution at class definition time.
 *
 */
export type SimplifyPrimaryKey<
  Entity,
  KeyName extends ReadonlyArray<keyof any>,
> = Entity extends any ? Pick<Entity, Extract<KeyName[number], keyof Entity>> : never;

/**
 * Extracts property names marked as auto-generated from the schema.
 * Properties with `x-auto-generated: true` are considered auto-generated.
 */
export type AutoGeneratedKeys<Schema extends DataPortSchemaObject> = {
  [K in keyof Schema["properties"]]: Schema["properties"][K] extends { "x-auto-generated": true }
    ? K
    : never;
}[keyof Schema["properties"]];

/**
 * Entity type for insertion - auto-generated keys are optional.
 * This allows clients to omit auto-generated keys when inserting entities.
 */
export type InsertEntity<Entity, AutoGenKeys> = Omit<Entity, AutoGenKeys & keyof Entity> &
  Partial<Pick<Entity, AutoGenKeys & keyof Entity>>;

/**
 * Interface defining the contract for tabular storage repositories.
 * Provides a flexible interface for storing and retrieving data with typed
 * primary keys and values, and supports compound keys and partial key lookup.
 *
 * @typeParam Schema - The schema definition for the entity using JSON Schema
 * @typeParam PrimaryKeyNames - Array of property names that form the primary key
 */
export interface ITabularStorage<
  Schema extends DataPortSchemaObject,
  PrimaryKeyNames extends ReadonlyArray<keyof Schema["properties"]>,
  // computed types
  Entity = FromSchema<Schema, TypedArraySchemaOptions>,
  PrimaryKey = SimplifyPrimaryKey<Entity, PrimaryKeyNames>,
  InsertType = InsertEntity<Entity, AutoGeneratedKeys<Schema>>,
> {
  // Core methods
  put(value: InsertType): Promise<Entity>;
  putBulk(values: InsertType[]): Promise<Entity[]>;
  get(key: PrimaryKey): Promise<Entity | undefined>;
  delete(key: PrimaryKey | Entity): Promise<void>;
  getAll(options?: QueryOptions<Entity>): Promise<Entity[] | undefined>;
  deleteAll(): Promise<void>;
  size(): Promise<number>;
  /**
   * Counts rows matching the specified search criteria without requiring
   * callers to load the matching entities.
   *
   * @param criteria - Optional object with column names as keys and values or SearchConditions
   * @returns Count of matching rows
   */
  count(criteria?: SearchCriteria<Entity>): Promise<number>;
  /**
   * Deletes all entries matching the specified search criteria.
   * Supports multiple columns with optional comparison operators.
   *
   * @param criteria - Object with column names as keys and values or SearchConditions
   * @example
   * // Delete by equality
   * await repo.deleteSearch({ category: "electronics" });
   *
   * // Delete with operator
   * await repo.deleteSearch({ createdAt: { value: date, operator: "<" } });
   *
   * // Delete with multiple criteria (AND)
   * await repo.deleteSearch({ category: "electronics", value: { value: 100, operator: "<" } });
   */
  deleteSearch(criteria: DeleteSearchCriteria<Entity>): Promise<void>;

  /**
   * Fetches a page of records from the repository.
   * @param offset - Number of records to skip
   * @param limit - Maximum number of records to return
   * @returns Array of entities or undefined if no records found
   * @deprecated Offset-based paging is unstable under concurrent writes.
   *   Use {@link getPage} for stable, keyset-based pagination.
   */
  getBulk(offset: number, limit: number): Promise<Entity[] | undefined>;

  /**
   * Fetches a page of records using cursor-based (keyset) pagination.
   *
   * Stable under concurrent inserts and deletes: the cursor encodes the
   * last seen primary key so the next page resumes from a precise position
   * rather than a numeric offset that shifts as rows are added or removed.
   *
   * @param request - Optional ordering, limit, and cursor.
   * @returns A {@link Page} with the rows for this page and a `nextCursor`
   *   to use for the next call (or `undefined` when iteration is complete).
   */
  getPage(request?: PageRequest<Entity>): Promise<Page<Entity>>;

  /**
   * Cursor-paginated form of {@link query}.
   *
   * @param criteria - Object with column names as keys and values or SearchConditions
   * @param request - Optional ordering, limit, and cursor.
   */
  queryPage(
    criteria: SearchCriteria<Entity>,
    request?: PageRequest<Entity>
  ): Promise<Page<Entity>>;

  /**
   * Async generator that yields records one at a time.
   * @param pageSize - Number of records to fetch per page (default: 100)
   * @yields Individual entity records
   */
  records(pageSize?: number): AsyncGenerator<Entity, void, undefined>;

  /**
   * Async generator that yields pages of records.
   * @param pageSize - Number of records per page (default: 100)
   * @yields Arrays of entities
   */
  pages(pageSize?: number): AsyncGenerator<Entity[], void, undefined>;

  // Event handling methods
  on<Event extends TabularEventName>(
    name: Event,
    fn: TabularEventListener<Event, PrimaryKey, Entity>
  ): void;
  off<Event extends TabularEventName>(
    name: Event,
    fn: TabularEventListener<Event, PrimaryKey, Entity>
  ): void;
  emit<Event extends TabularEventName>(
    name: Event,
    ...args: TabularEventParameters<Event, PrimaryKey, Entity>
  ): void;
  once<Event extends TabularEventName>(
    name: Event,
    fn: TabularEventListener<Event, PrimaryKey, Entity>
  ): void;
  waitOn<Event extends TabularEventName>(
    name: Event
  ): Promise<TabularEventParameters<Event, PrimaryKey, Entity>>;

  /**
   * Queries entries matching the specified search criteria with optional ordering, limit, and offset.
   * Uses optimized index paths when possible, falls back to full scan otherwise.
   *
   * @param criteria - Object with column names as keys and values or SearchConditions
   * @param options - Optional ordering, limit, and offset options
   * @returns Array of matching entities or undefined if no matches found
   */
  query(
    criteria: SearchCriteria<Entity>,
    options?: QueryOptions<Entity>
  ): Promise<Entity[] | undefined>;

  /**
   * Strict, projected query served entirely by a covering compound index.
   * Throws CoveringIndexMissingError when no registered index can serve
   * (criteria + orderBy + select). Returns Pick<Entity, K>[] — never the heavy fields.
   *
   * @param criteria - equality (and optionally non-equality) filters
   * @param options  - select (required), orderBy, limit, offset
   * @returns array of projected rows (empty array, not undefined, when no matches)
   */
  queryIndex<K extends keyof Entity & string>(
    criteria: SearchCriteria<Entity>,
    options: CoveringIndexQueryOptions<Entity, K>
  ): Promise<Pick<Entity, K>[]>;

  /**
   * Subscribes to changes in the repository (including remote changes).
   * @param callback - Function called when a change occurs
   * @param options - Optional subscription options (e.g., polling interval)
   * @returns Unsubscribe function
   */
  subscribeToChanges(
    callback: (change: TabularChangePayload<Entity>) => void,
    options?: TabularSubscribeOptions
  ): () => void;

  /**
   * Sets up the database/storage for the repository.
   * Must be called before using any other methods (except for in-memory implementations).
   * @returns Promise that resolves when setup is complete
   */
  setupDatabase(): Promise<void>;

  // Destroy the repository and frees up resources.
  destroy(): void;
  [Symbol.dispose](): void;
  [Symbol.asyncDispose](): Promise<void>;
}

export type AnyTabularStorage = Omit<ITabularStorage<any, any, any, any, any>, "queryIndex"> & {
  queryIndex(criteria: any, options: any): Promise<any[]>;
};

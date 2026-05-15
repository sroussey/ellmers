/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { ITabularStorage } from "@workglow/storage";
import type { DataPortSchemaObject } from "@workglow/util/schema";
import type {
  CompoundPrimaryKeyNames,
  CompoundSchema,
} from "../../test/storage-tabular/genericTabularStorageTests";

export const VectorItemPrimaryKeyNames = ["id"] as const;
export const VectorItemSchema = {
  type: "object",
  properties: {
    id: { type: "string" },
    embedding: { type: "array", format: "TypedArray:Float32Array" },
  },
  required: ["id", "embedding"],
  additionalProperties: false,
} as const satisfies DataPortSchemaObject;

/**
 * Closed string-literal union of tabular-storage contract assertions that
 * adapters can mark as known failing. A typo in `expectedFailures` becomes
 * a TS error rather than a silently-ignored entry.
 */
export type TabularStorageContractAssertion =
  | "subscribeToChanges"
  | "vectorColumnFormat"
  | "withTransactionRollback"
  | "countMatchesQuery";

export interface TabularStorageContractOpts {
  readonly name: string;
  readonly skip?: boolean;
  readonly timeout?: number;
  readonly createStorage: () => Promise<
    ITabularStorage<typeof CompoundSchema, typeof CompoundPrimaryKeyNames>
  >;
  readonly capabilities: {
    readonly supportsSubscriptions: boolean;
    readonly supportsVectorColumns: boolean;
    readonly supportsTransactions: boolean;
    /** Whether `query(criteria)` is supported. False for FsFolder etc. */
    readonly supportsQuery: boolean;
  };
  /** Whether this storage uses polling (requires longer waits between steps). */
  readonly usesPolling?: boolean;
  /** Polling interval forwarded to subscribeToChanges for polling-based implementations. */
  readonly pollingIntervalMs?: number;
  /**
   * Required when capabilities.supportsVectorColumns is true. Creates a fresh
   * storage instance typed to VectorItemSchema for the round-trip assertion.
   */
  readonly createVectorStorage?: () => Promise<
    ITabularStorage<typeof VectorItemSchema, typeof VectorItemPrimaryKeyNames>
  >;
  /**
   * Names of contract assertions currently broken in this adapter; each
   * named test wraps with `itExpectFail`. The string-literal union catches
   * typos at compile time.
   */
  readonly expectedFailures?: ReadonlyArray<TabularStorageContractAssertion>;
}

/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { ITabularStorage } from "@workglow/storage";
import type {
  CompoundPrimaryKeyNames,
  CompoundSchema,
} from "../../test/storage-tabular/genericTabularStorageTests";

/**
 * Closed string-literal union of tabular-storage contract assertions that
 * adapters can mark as known failing. A typo in `expectedFailures` becomes
 * a TS error rather than a silently-ignored entry.
 */
export type TabularStorageContractAssertion = "subscribeToChanges";

export interface TabularStorageContractOpts {
  readonly name: string;
  readonly skip?: boolean;
  readonly timeout?: number;
  readonly createStorage: () => Promise<
    ITabularStorage<typeof CompoundSchema, typeof CompoundPrimaryKeyNames>
  >;
  readonly capabilities: {
    readonly supportsSubscriptions: boolean;
  };
  /** Whether this storage uses polling (requires longer waits between steps). */
  readonly usesPolling?: boolean;
  /** Polling interval forwarded to subscribeToChanges for polling-based implementations. */
  readonly pollingIntervalMs?: number;
  /**
   * Names of contract assertions currently broken in this adapter; each
   * named test wraps with `itExpectFail`. The string-literal union catches
   * typos at compile time.
   */
  readonly expectedFailures?: ReadonlyArray<TabularStorageContractAssertion>;
}

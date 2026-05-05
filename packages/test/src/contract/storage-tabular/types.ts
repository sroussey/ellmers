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
import type { VectorPrimaryKeyNames, VectorSchema } from "./fixtures";

export interface TabularStorageContractOpts {
  readonly name: string;
  readonly skip?: boolean;
  readonly timeout: number;
  readonly factory: () => Promise<TabularContractHandle>;
  readonly capabilities: TabularContractCapabilities;
  readonly subscriptions?: TabularSubscriptionOptions;
  /**
   * Names of contract assertions currently broken in this adapter.
   * Each named test is wrapped with itExpectFail.
   *
   * Known names:
   *   "subscribe.fireOncePerWrite"
   *   "subscribe.commitOrder"
   *   "vector.dimensionRoundTrip"
   */
  readonly expectedFailures?: ReadonlyArray<string>;
}

export interface TabularContractCapabilities {
  readonly subscriptions: boolean;
  readonly vectorColumns: boolean;
}

export interface TabularSubscriptionOptions {
  readonly usesPolling?: boolean;
  readonly pollingIntervalMs?: number;
}

export interface TabularContractHandle {
  readonly createCompoundRepo: () => Promise<
    ITabularStorage<typeof CompoundSchema, typeof CompoundPrimaryKeyNames>
  >;
  readonly createVectorRepo?: () => Promise<
    ITabularStorage<typeof VectorSchema, typeof VectorPrimaryKeyNames>
  >;
  readonly dispose: () => Promise<void>;
}

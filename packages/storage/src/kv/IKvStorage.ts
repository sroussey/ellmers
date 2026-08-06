/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { EventParameters } from "@workglow/util";
import type { DataPortSchemaObject } from "@workglow/util/schema";
import type { JSONValue } from "../tabular/ITabularStorage";

export const DefaultKeyValueSchema = {
  type: "object",
  properties: {
    key: { type: "string" },
    value: {},
  },
  additionalProperties: false,
} as const satisfies DataPortSchemaObject;
export const DefaultKeyValueKey = ["key"] as const;

export type KvEventListeners<Key, Value, Combined> = {
  put: (key: Key, value: Value) => void;
  get: (key: Key, value: Value | undefined) => void;
  getBulk: (keys: readonly Key[], results: readonly Combined[]) => void;
  getAll: (results: Combined[] | undefined) => void;
  delete: (key: unknown) => void;
  /**
   * Fired by {@link IKvStorage.deleteAll}. NOTE: the tabular surface emits the
   * same clear-the-store concept under a different name (`clearall`, see
   * {@link TabularEventListeners}). Subscribing at an abstraction boundary that
   * spans both KV and tabular stores must account for both identifiers.
   */
  deleteall: () => void;
};

export type KvEventName = keyof KvEventListeners<any, any, any>;
export type KvEventListener<Event extends KvEventName, Key, Value, Combined> = KvEventListeners<
  Key,
  Value,
  Combined
>[Event];

export type KvEventParameters<Event extends KvEventName, Key, Value, Combined> = EventParameters<
  KvEventListeners<Key, Value, Combined>,
  Event
>;

/**
 * Interface defining the contract for kv storage repositories.
 * Provides a flexible interface for storing and retrieving data with typed
 * primary keys and values, and supports compound keys and partial key lookup.
 *
 * @typeParam Key - Type for the primary key
 * @typeParam Value - Type for the value struct re
 * @typeParam Combined - Combined type of Key & Value
 */
export interface IKvStorage<
  Key extends string = string,
  Value = any,
  Combined = { key: Key; value: Value },
> {
  put(key: Key, value: Value): Promise<void>;
  putBulk(items: Array<{ key: Key; value: Value }>): Promise<void>;
  get(key: Key): Promise<Value | undefined>;
  /**
   * Fetches multiple values by their keys in a single bulk operation.
   *
   * Returns only the records that were found, as `Combined` (key + value)
   * pairs. Result ordering is unspecified. Missing keys produce no entry.
   * Empty input returns `[]` without issuing a backend call.
   */
  getBulk(keys: readonly Key[]): Promise<Combined[]>;
  delete(key: Key): Promise<void>;
  getAll(): Promise<Combined[] | undefined>;
  deleteAll(): Promise<void>;
  size(): Promise<number>;

  getObjectAsIdString(object: JSONValue): Promise<string>;

  on<Event extends KvEventName>(
    name: Event,
    fn: KvEventListener<Event, Key, Value, Combined>
  ): void;
  off<Event extends KvEventName>(
    name: Event,
    fn: KvEventListener<Event, Key, Value, Combined>
  ): void;
  emit<Event extends KvEventName>(
    name: Event,
    ...args: KvEventParameters<Event, Key, Value, Combined>
  ): void;
  once<Event extends KvEventName>(
    name: Event,
    fn: KvEventListener<Event, Key, Value, Combined>
  ): void;
  waitOn<Event extends KvEventName>(
    name: Event
  ): Promise<KvEventParameters<Event, Key, Value, Combined>>;
}

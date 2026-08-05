/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { createServiceToken, EventEmitter, makeFingerprint } from "@workglow/util";
import type { JsonSchema } from "@workglow/util/schema";
import type { JSONValue } from "../tabular/ITabularStorage";
import type {
  IKvStorage,
  KvEventListener,
  KvEventListeners,
  KvEventName,
  KvEventParameters,
} from "./IKvStorage";

export const KV_REPOSITORY = createServiceToken<IKvStorage<any, any, any>>("storage.kvRepository");

/**
 * Abstract base class for key-value storage repositories.
 * Emits {@link KvEventListeners} events for all mutations and reads.
 */
export abstract class KvStorage<
  Key extends string = string,
  Value = any,
  Combined = { key: Key; value: Value },
> implements IKvStorage<Key, Value, Combined> {
  protected events = new EventEmitter<KvEventListeners<Key, Value, Combined>>();

  constructor(
    public keySchema: JsonSchema = { type: "string" },
    public valueSchema: JsonSchema = {}
  ) {}

  abstract put(key: Key, value: Value): Promise<void>;

  abstract putBulk(items: Array<{ key: Key; value: Value }>): Promise<void>;

  abstract get(key: Key): Promise<Value | undefined>;

  /**
   * Retrieves multiple values by their keys in a single bulk operation.
   * Returns only the found records; missing keys produce no entry. The
   * returned `Combined` records carry both key and value so callers can
   * re-align by key.
   */
  abstract getBulk(keys: readonly Key[]): Promise<Combined[]>;

  abstract delete(key: Key): Promise<void>;

  abstract getAll(): Promise<Combined[] | undefined>;

  abstract deleteAll(): Promise<void>;

  abstract size(): Promise<number>;

  public async getObjectAsIdString(object: JSONValue): Promise<string> {
    return await makeFingerprint(object);
  }

  on<Event extends KvEventName>(name: Event, fn: KvEventListener<Event, Key, Value, Combined>) {
    this.events.on(name, fn);
  }

  off<Event extends KvEventName>(name: Event, fn: KvEventListener<Event, Key, Value, Combined>) {
    this.events.off(name, fn);
  }

  once<Event extends KvEventName>(name: Event, fn: KvEventListener<Event, Key, Value, Combined>) {
    this.events.once(name, fn);
  }

  emit<Event extends KvEventName>(
    name: Event,
    ...args: KvEventParameters<Event, Key, Value, Combined>
  ) {
    this.events.emit(name, ...args);
  }

  waitOn<Event extends KvEventName>(
    name: Event
  ): Promise<KvEventParameters<Event, Key, Value, Combined>> {
    return this.events.waitOn(name) as Promise<KvEventParameters<Event, Key, Value, Combined>>;
  }
}

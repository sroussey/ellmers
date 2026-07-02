/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { traced } from "@workglow/util";
import type { JSONValue } from "../tabular/ITabularStorage";
import type { IKvStorage, KvEventListener, KvEventName, KvEventParameters } from "./IKvStorage";

/**
 * Telemetry wrapper for any IKvStorage implementation.
 * Creates spans for all storage operations.
 */
export class TelemetryKvStorage<
  Key extends string = string,
  Value = any,
  Combined = { key: Key; value: Value },
> implements IKvStorage<Key, Value, Combined> {
  constructor(
    private readonly storageName: string,
    private readonly inner: IKvStorage<Key, Value, Combined>
  ) {}

  put(key: Key, value: Value): Promise<void> {
    return traced("workglow.storage.kv.put", this.storageName, () => this.inner.put(key, value));
  }
  putBulk(items: Array<{ key: Key; value: Value }>): Promise<void> {
    return traced("workglow.storage.kv.putBulk", this.storageName, () => this.inner.putBulk(items));
  }
  get(key: Key): Promise<Value | undefined> {
    return traced("workglow.storage.kv.get", this.storageName, () => this.inner.get(key));
  }
  getBulk(keys: readonly Key[]): Promise<Combined[]> {
    return traced("workglow.storage.kv.getBulk", this.storageName, () => this.inner.getBulk(keys));
  }
  delete(key: Key): Promise<void> {
    return traced("workglow.storage.kv.delete", this.storageName, () => this.inner.delete(key));
  }
  getAll(): Promise<Combined[] | undefined> {
    return traced("workglow.storage.kv.getAll", this.storageName, () => this.inner.getAll());
  }
  deleteAll(): Promise<void> {
    return traced("workglow.storage.kv.deleteAll", this.storageName, () => this.inner.deleteAll());
  }
  size(): Promise<number> {
    return traced("workglow.storage.kv.size", this.storageName, () => this.inner.size());
  }
  getObjectAsIdString(object: JSONValue): Promise<string> {
    return this.inner.getObjectAsIdString(object);
  }

  on<Event extends KvEventName>(name: Event, fn: KvEventListener<Event, Key, Value, Combined>) {
    this.inner.on(name, fn);
  }
  off<Event extends KvEventName>(name: Event, fn: KvEventListener<Event, Key, Value, Combined>) {
    this.inner.off(name, fn);
  }
  emit<Event extends KvEventName>(
    name: Event,
    ...args: KvEventParameters<Event, Key, Value, Combined>
  ) {
    this.inner.emit(name, ...args);
  }
  once<Event extends KvEventName>(name: Event, fn: KvEventListener<Event, Key, Value, Combined>) {
    this.inner.once(name, fn);
  }
  waitOn<Event extends KvEventName>(
    name: Event
  ): Promise<KvEventParameters<Event, Key, Value, Combined>> {
    return this.inner.waitOn(name);
  }
}

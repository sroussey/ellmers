/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { BaseTabularStorage } from "../tabular/BaseTabularStorage";
import { DefaultKeyValueKey, DefaultKeyValueSchema } from "./IKvStorage";
import { KvStorage } from "./KvStorage";

/** Schema types that are stored as-is without JSON serialization. */
const PRIMITIVE_SCHEMA_TYPES = new Set(["number", "boolean", "string", "blob"]);

export abstract class KvViaTabularStorage<
  Key extends string = string,
  Value extends any = any,
  Combined = { key: Key; value: Value },
> extends KvStorage<Key, Value, Combined> {
  public abstract tabularRepository: BaseTabularStorage<
    typeof DefaultKeyValueSchema,
    typeof DefaultKeyValueKey
  >;

  private get needsJsonSerialization(): boolean {
    if (this._needsJsonSerialization === undefined) {
      const schemaType =
        typeof this.valueSchema === "object" &&
        this.valueSchema !== null &&
        "type" in this.valueSchema
          ? this.valueSchema.type
          : undefined;
      this._needsJsonSerialization = !PRIMITIVE_SCHEMA_TYPES.has(schemaType as string);
    }
    return this._needsJsonSerialization;
  }
  private _needsJsonSerialization: boolean | undefined;

  /**
   * Deserialize a stored value back to the runtime form. When the schema
   * isn't a primitive we round-trip through JSON; if the stored bytes
   * aren't valid JSON we return them as-is so callers see what's on disk
   * rather than an exception.
   */
  private deserialize(raw: unknown): Value {
    if (this.needsJsonSerialization && typeof raw === "string") {
      try {
        return JSON.parse(raw) as Value;
      } catch {
        return raw as unknown as Value;
      }
    }
    return raw as Value;
  }

  /** Must be called before using any other methods. */
  public async setupDatabase(): Promise<void> {
    await this.tabularRepository.setupDatabase?.();
  }

  public async put(key: Key, value: Value): Promise<void> {
    const storedValue = this.needsJsonSerialization ? (JSON.stringify(value) as Value) : value;
    await this.tabularRepository.put({ key, value: storedValue });
    this.events.emit("put", key, value);
  }

  public async putBulk(items: Array<{ key: Key; value: Value }>): Promise<void> {
    const entities = this.needsJsonSerialization
      ? items.map(({ key, value }) => ({ key, value: JSON.stringify(value) as Value }))
      : items;

    await this.tabularRepository.putBulk(entities);
    for (const { key, value } of items) {
      this.events.emit("put", key, value);
    }
  }

  public async get(key: Key): Promise<Value | undefined> {
    const result = await this.tabularRepository.get({ key });
    if (!result) {
      this.events.emit("get", key, undefined);
      return undefined;
    }
    const value = this.deserialize(result.value);
    this.events.emit("get", key, value);
    return value;
  }

  /**
   * Delegates to the underlying tabular `getBulk` so SQL-backed KV stores
   * (Postgres, SQLite) get push-down for free.
   */
  public async getBulk(keys: readonly Key[]): Promise<Combined[]> {
    if (keys.length === 0) return [];
    const rows = await this.tabularRepository.getBulk(keys.map((key) => ({ key })));
    const combined = rows.map(
      (row) => ({ key: row.key as Key, value: this.deserialize(row.value) }) as Combined
    );
    this.events.emit("getBulk", keys, combined);
    return combined;
  }

  public async delete(key: Key): Promise<void> {
    await this.tabularRepository.delete({ key });
    this.events.emit("delete", key);
  }

  public async getAll(): Promise<Combined[] | undefined> {
    const values = await this.tabularRepository.getAll();
    const results = values
      ? values.map((row) => ({ key: row.key, value: this.deserialize(row.value) }) as Combined)
      : undefined;
    this.events.emit("getAll", results);
    return results;
  }

  public async deleteAll(): Promise<void> {
    await this.tabularRepository.deleteAll();
    this.events.emit("deleteall");
  }

  public async size(): Promise<number> {
    return await this.tabularRepository.size();
  }

  destroy(): void {
    this.tabularRepository.destroy();
  }
}

/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { BaseTabularStorage } from "../tabular/BaseTabularStorage";
import { DefaultKeyValueKey, DefaultKeyValueSchema } from "./IKvStorage";
import { KvStorage } from "./KvStorage";

/**
 * Abstract base class for key-value storage repositories that uses a tabular repository for storage.
 * Has a basic event emitter for listening to repository events.
 *
 * @template Key - The type of the primary key
 * @template Value - The type of the value being stored
 * @template Combined - Combined type of Key & Value
 */
/** Schema types that are stored as-is without JSON serialization */
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

  /** Whether values need JSON serialization (cached from schema) */
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
   * Sets up the database for the repository.
   * Must be called before using any other methods.
   */
  public async setupDatabase(): Promise<void> {
    await this.tabularRepository.setupDatabase?.();
  }

  /**
   * Stores a row in the repository.
   * @param key - The primary key
   * @param value - The value to store
   */
  public async put(key: Key, value: Value): Promise<void> {
    const storedValue = this.needsJsonSerialization ? (JSON.stringify(value) as Value) : value;
    await this.tabularRepository.put({ key, value: storedValue });
    this.events.emit("put", key, value);
  }

  /**
   * Stores multiple rows in the repository in a bulk operation.
   * @param items - Array of key-value pairs to store
   */
  public async putBulk(items: Array<{ key: Key; value: Value }>): Promise<void> {
    const entities = this.needsJsonSerialization
      ? items.map(({ key, value }) => ({ key, value: JSON.stringify(value) as Value }))
      : items;

    await this.tabularRepository.putBulk(entities);
    for (const { key, value } of items) {
      this.events.emit("put", key, value);
    }
  }

  /**
   * Retrieves a value by its key.
   * This is a convenience method that automatically converts simple types to structured format if using default schema.
   *
   * @param key - Primary key to look up (basic key like default schema)
   * @returns The stored value or undefined if not found
   */
  public async get(key: Key): Promise<Value | undefined> {
    const result = await this.tabularRepository.get({ key });
    if (!result) {
      this.events.emit("get", key, undefined);
      return undefined;
    }

    let value: Value;
    if (this.needsJsonSerialization) {
      try {
        value = JSON.parse(result.value as unknown as string) as Value;
      } catch (e) {
        value = result.value as unknown as Value;
      }
    } else {
      value = result.value as unknown as Value;
    }
    this.events.emit("get", key, value);
    return value;
  }

  /**
   * Deletes a row from the repository.
   * @param key - The primary key of the row to delete
   */
  public async delete(key: Key): Promise<void> {
    await this.tabularRepository.delete({ key });
    this.events.emit("delete", key);
  }

  /**
   * Retrieves all rows from the repository.
   * @returns An array of all rows in the repository or undefined if empty
   */
  public async getAll(): Promise<Combined[] | undefined> {
    const values = await this.tabularRepository.getAll();
    const results = values
      ? values.map(
          (value) =>
            ({
              key: value.key,
              value: (() => {
                if (this.needsJsonSerialization && typeof value.value === "string") {
                  try {
                    return JSON.parse(value.value);
                  } catch (e) {
                    return value.value;
                  }
                }
                return value.value;
              })(),
            }) as Combined
        )
      : undefined;
    this.events.emit("getAll", results);
    return results;
  }

  /**
   * Deletes all rows from the repository.
   */
  public async deleteAll(): Promise<void> {
    await this.tabularRepository.deleteAll();
    this.events.emit("deleteall");
  }

  /**
   * Retrieves the number of rows in the repository.
   * @returns The number of rows in the repository
   */
  public async size(): Promise<number> {
    return await this.tabularRepository.size();
  }

  /**
   * Destroys the repository and frees up resources.
   */
  destroy(): void {
    this.tabularRepository.destroy();
  }
}

//    *******************************************************************************
//    *   ELLMERS: Embedding Large Language Model Experiential Retrieval Service    *
//    *                                                                             *
//    *   Copyright Steven Roussey <sroussey@gmail.com>                             *
//    *   Licensed under the Apache License, Version 2.0 (the "License");           *
//    *******************************************************************************

import {
  BaseValueSchema,
  BasePrimaryKeySchema,
  BasicKeyType,
  DefaultValueType,
  DefaultValueSchema,
  DefaultPrimaryKeyType,
  DefaultPrimaryKeySchema,
  KVRepository,
} from "ellmers-core";
import { makeFingerprint } from "../../../util/Misc";

// InMemoryKVRepository is a simple in-memory key-value store that can be used for testing or as a cache

/**
 * A generic in-memory key-value repository implementation.
 * Provides a simple, non-persistent storage solution suitable for testing and caching scenarios.
 *
 * @template Key - The type of the primary key object, must be a record of basic types
 * @template Value - The type of the value object being stored
 * @template PrimaryKeySchema - Schema definition for the primary key
 * @template ValueSchema - Schema definition for the value
 * @template Combined - The combined type of Key & Value
 */
export class InMemoryKVRepository<
  Key extends Record<string, BasicKeyType> = DefaultPrimaryKeyType,
  Value extends Record<string, any> = DefaultValueType,
  PrimaryKeySchema extends BasePrimaryKeySchema = typeof DefaultPrimaryKeySchema,
  ValueSchema extends BaseValueSchema = typeof DefaultValueSchema,
  Combined extends Key & Value = Key & Value
> extends KVRepository<Key, Value, PrimaryKeySchema, ValueSchema, Combined> {
  /** Internal storage using a Map with fingerprint strings as keys */
  values = new Map<string, Combined>();

  /**
   * Creates a new InMemoryKVRepository instance
   * @param primaryKeySchema - Schema defining the structure of primary keys
   * @param valueSchema - Schema defining the structure of values
   * @param searchable - Array of field names that can be searched
   */
  constructor(
    primaryKeySchema: PrimaryKeySchema = DefaultPrimaryKeySchema as PrimaryKeySchema,
    valueSchema: ValueSchema = DefaultValueSchema as ValueSchema,
    searchable: Array<keyof Combined> = []
  ) {
    super(primaryKeySchema, valueSchema, searchable);
  }

  /**
   * Stores a key-value pair in the repository
   * @param key - The primary key object
   * @param value - The value object to store
   * @emits 'put' event with the fingerprint ID when successful
   */
  async putKeyValue(key: Key, value: Value): Promise<void> {
    const id = await makeFingerprint(key);
    this.values.set(id, Object.assign({}, key, value) as Combined);
    this.emit("put", id);
  }

  /**
   * Retrieves a value by its key
   * @param key - The primary key object to look up
   * @returns The value object if found, undefined otherwise
   * @emits 'get' event with the fingerprint ID and value when found
   */
  async getKeyValue(key: Key): Promise<Value | undefined> {
    const id = await makeFingerprint(key);
    const out = this.values.get(id);
    if (out === undefined) {
      return undefined;
    }
    this.emit("get", id, out);
    const { value } = this.separateKeyValueFromCombined(out);
    return value;
  }

  /**
   * Searches for entries matching a partial key-value pair
   * @param key - Partial combined key-value object to search for
   * @returns Array of matching combined objects
   * @throws Error if search criteria contains more than one key
   */
  async search(key: Partial<Combined>): Promise<Combined[] | undefined> {
    const search = Object.keys(key);
    if (search.length !== 1) {
      throw new Error("Search must be a single key");
    }
    this.emit("search", key);
    return Array.from(this.values.entries())
      .filter(([_fingerprint, value]) => value[search[0]] === key[search[0]])
      .map(([_id, value]) => value);
  }

  /**
   * Deletes an entry by its key
   * @param key - The primary key object of the entry to delete
   * @emits 'delete' event with the fingerprint ID when successful
   */
  async deleteKeyValue(key: Key): Promise<void> {
    const id = await makeFingerprint(key);
    this.values.delete(id);
    this.emit("delete", id);
  }

  /**
   * Removes all entries from the repository
   * @emits 'clearall' event when successful
   */
  async deleteAll(): Promise<void> {
    this.values.clear();
    this.emit("clearall");
  }

  /**
   * Returns the number of entries in the repository
   * @returns The total count of stored key-value pairs
   */
  async size(): Promise<number> {
    return this.values.size;
  }
}

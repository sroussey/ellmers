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
} from "ellmers-core";
import { ensureIndexedDbTable, ExpectedIndexDefinition } from "./IndexedDbTable";
import { KVRepository } from "../../../util/base/KVRepository";

/**
 * A key-value repository implementation using IndexedDB for browser-based storage.
 *
 * @template Key - The type of the primary key object
 * @template Value - The type of the value object to be stored
 * @template PrimaryKeySchema - Schema definition for the primary key
 * @template ValueSchema - Schema definition for the value
 * @template Combined - Combined type of Key & Value
 */
export class IndexedDbKVRepository<
  Key extends Record<string, BasicKeyType> = DefaultPrimaryKeyType,
  Value extends Record<string, any> = DefaultValueType,
  PrimaryKeySchema extends BasePrimaryKeySchema = typeof DefaultPrimaryKeySchema,
  ValueSchema extends BaseValueSchema = typeof DefaultValueSchema,
  Combined extends Record<string, any> = Key & Value,
> extends KVRepository<Key, Value, PrimaryKeySchema, ValueSchema, Combined> {
  /** Promise that resolves to the IndexedDB database instance */
  private dbPromise: Promise<IDBDatabase> | undefined;

  /**
   * Creates a new IndexedDB-based key-value repository.
   * @param table - Name of the IndexedDB store to use.
   * @param primaryKeySchema - Schema defining the structure of primary keys.
   * @param valueSchema - Schema defining the structure of values.
   * @param searchable - Array of properties that can be searched.
   */
  constructor(
    public table: string = "kv_store",
    primaryKeySchema: PrimaryKeySchema = DefaultPrimaryKeySchema as PrimaryKeySchema,
    valueSchema: ValueSchema = DefaultValueSchema as ValueSchema,
    protected searchable: Array<keyof Combined> = []
  ) {
    super(primaryKeySchema, valueSchema, searchable);
    const pkColumns = super.primaryKeyColumns() as string[];

    const expectedIndexes: ExpectedIndexDefinition[] = this.searchable
      .filter((field) => !pkColumns.includes(String(field)))
      .map((field) => ({
        name: String(field),
        keyPath: `value.${String(field)}`,
        options: { unique: false },
      }));

    const primaryKey = pkColumns.length === 1 ? pkColumns[0] : pkColumns;

    // Ensure that our table is created/upgraded only if the structure (indexes) has changed.
    this.dbPromise = ensureIndexedDbTable(this.table, primaryKey, expectedIndexes);
  }

  /**
   * Stores a key-value pair in the repository.
   * @param key - The key object.
   * @param value - The value object to store.
   * @emits put - Emitted when the value is successfully stored
   */
  async putKeyValue(key: Key, value: Value): Promise<void> {
    if (!this.dbPromise) throw new Error("Database not initialized");
    const db = await this.dbPromise;
    const record = { ...key, ...value };
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(this.table, "readwrite");
      const store = transaction.objectStore(this.table);
      const request = store.put(record);
      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        this.emit("put", key);
        resolve();
      };
    });
  }

  protected getPrimaryKeyAsOrderedArray(key: Key) {
    return super
      .getPrimaryKeyAsOrderedArray(key)
      .map((value) => (typeof value === "bigint" ? value.toString() : value));
  }

  private getIndexedKey(key: Key): any {
    const keys = super
      .getPrimaryKeyAsOrderedArray(key)
      .map((value) => (typeof value === "bigint" ? value.toString() : value));
    return keys.length === 1 ? keys[0] : keys;
  }

  /**
   * Retrieves a value from the repository by its key.
   * @param key - The key object.
   * @returns The value object or undefined if not found.
   * @emits get - Emitted when the value is successfully retrieved
   */
  async getKeyValue(key: Key): Promise<Value | undefined> {
    if (!this.dbPromise) throw new Error("Database not initialized");
    const db = await this.dbPromise;
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(this.table, "readonly");
      const store = transaction.objectStore(this.table);
      const request = store.get(this.getIndexedKey(key));
      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        this.emit("get", key);
        if (!request.result) {
          resolve(undefined);
          return;
        }
        const { value } = this.separateKeyValueFromCombined(request.result);
        resolve(value);
      };
    });
  }

  /**
   * Returns an array of all entries in the repository.
   * @returns Array of all entries in the repository.
   */
  async getAll(): Promise<Combined[] | undefined> {
    if (!this.dbPromise) throw new Error("Database not initialized");
    const db = await this.dbPromise;
    const transaction = db.transaction(this.table, "readonly");
    const store = transaction.objectStore(this.table);
    const request = store.getAll();
    return new Promise((resolve, reject) => {
      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        const values = request.result;
        resolve(values.length > 0 ? values : undefined);
      };
    });
  }

  /**
   * Searches for records matching the specified partial query.
   * It uses an appropriate index if one exists, or scans all records.
   * @param key - Partial query object.
   * @returns Array of matching records or undefined.
   */
  async search(key: Partial<Combined>): Promise<Combined[] | undefined> {
    if (!this.dbPromise) throw new Error("Database not initialized");
    const queryKeys = Object.keys(key);
    if (queryKeys.length === 0) return undefined;
    const db = await this.dbPromise;
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(this.table, "readonly");
      const store = transaction.objectStore(this.table);
      const searchableKey = queryKeys.find((k) => this.searchable.includes(k as keyof Combined));
      if (searchableKey) {
        try {
          const index = store.index(searchableKey);
          const request = index.getAll(key[searchableKey as keyof Combined]);
          request.onsuccess = () => {
            const results = request.result.filter((item) =>
              Object.entries(key).every(([k, v]) => item[k] === v)
            );
            resolve(results.length > 0 ? results : undefined);
          };
          request.onerror = () => reject(request.error);
          return;
        } catch (err) {
          // Fall back to a full scan
        }
      }
      const getAllRequest = store.getAll();
      getAllRequest.onsuccess = () => {
        let results = getAllRequest.result;
        results = results.filter((item) => Object.entries(key).every(([k, v]) => item[k] === v));
        resolve(results.length > 0 ? results : undefined);
      };
      getAllRequest.onerror = () => reject(getAllRequest.error);
    });
  }

  /**
   * Deletes a key-value pair from the repository.
   * @param key - The key object to delete.
   */
  async deleteKeyValue(key: Key): Promise<void> {
    if (!this.dbPromise) throw new Error("Database not initialized");
    const db = await this.dbPromise;
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(this.table, "readwrite");
      const store = transaction.objectStore(this.table);
      const request = store.delete(this.getIndexedKey(key));
      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        this.emit("delete", key);
        resolve();
      };
    });
  }

  /**
   * Deletes all records from the repository.
   * @emits clearall - Emitted when all values are deleted
   */
  async deleteAll(): Promise<void> {
    if (!this.dbPromise) throw new Error("Database not initialized");
    const db = await this.dbPromise;
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(this.table, "readwrite");
      const store = transaction.objectStore(this.table);
      const request = store.clear();
      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        this.emit("clearall");
        resolve();
      };
    });
  }

  /**
   * Returns the total number of key-value pairs in the repository.
   * @returns Count of stored items.
   */
  async size(): Promise<number> {
    if (!this.dbPromise) throw new Error("Database not initialized");
    const db = await this.dbPromise;
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(this.table, "readonly");
      const store = transaction.objectStore(this.table);
      const request = store.count();
      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve(request.result);
    });
  }
}

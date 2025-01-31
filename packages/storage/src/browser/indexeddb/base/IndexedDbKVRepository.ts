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
import { ensureIndexedDbTable } from "./IndexedDbTable";
import { makeFingerprint } from "../../../util/Misc";

/**
 * A key-value repository implementation using IndexedDB for browser-based storage.
 * This class provides a simple persistent storage solution for web applications
 * without requiring a server component.
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
  Combined extends Record<string, any> = Key & Value
> extends KVRepository<Key, Value, PrimaryKeySchema, ValueSchema, Combined> {
  /** Promise that resolves to the IndexedDB database instance */
  private dbPromise: Promise<IDBDatabase>;

  /**
   * Creates a new IndexedDB-based key-value repository
   * @param table - Name of the IndexedDB store to use
   * @param primaryKeySchema - Schema defining the structure of primary keys
   * @param valueSchema - Schema defining the structure of values
   * @param searchable - Array of properties that can be searched (Note: search not implemented)
   */
  constructor(
    public table: string = "kv_store",
    primaryKeySchema: PrimaryKeySchema = DefaultPrimaryKeySchema as PrimaryKeySchema,
    valueSchema: ValueSchema = DefaultValueSchema as ValueSchema,
    protected searchable: Array<keyof Combined> = []
  ) {
    super(primaryKeySchema, valueSchema, searchable);
    this.dbPromise = ensureIndexedDbTable(this.table, (db) => {
      db.createObjectStore(table, { keyPath: "id" });
    });
  }

  /**
   * Stores a key-value pair in the repository
   * @param key - The key object
   * @param value - The value object to store
   * @emits put - Emitted when the value is successfully stored
   */
  async putKeyValue(key: Key, value: Value): Promise<void> {
    const id = await makeFingerprint(key);
    const db = await this.dbPromise;

    return new Promise((resolve, reject) => {
      const transaction = db.transaction(this.table, "readwrite");
      const store = transaction.objectStore(this.table);
      const request = store.put({ id, value });

      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        this.emit("put", id);
        resolve();
      };
    });
  }

  /**
   * Retrieves a value by its key
   * @param key - The key object to look up
   * @returns The stored value or undefined if not found
   * @emits get - Emitted when a value is retrieved
   */
  async getKeyValue(key: Key): Promise<Value | undefined> {
    const id = await makeFingerprint(key);
    const db = await this.dbPromise;

    return new Promise((resolve, reject) => {
      const transaction = db.transaction(this.table, "readonly");
      const store = transaction.objectStore(this.table);
      const request = store.get(id);

      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        this.emit("get", id);
        if (request.result) {
          resolve(request.result.value);
        } else {
          resolve(undefined);
        }
      };
    });
  }

  /**
   * Returns an array of all entries in the repository
   * @returns Array of all entries in the repository
   */
  async getAll(): Promise<Combined[]| undefined> {
    const db = await this.dbPromise;
    const transaction = db.transaction(this.table, "readonly");
    const store = transaction.objectStore(this.table);
    const request = store.getAll();

    return new Promise((resolve, reject) => {
      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        const values = request.result.map(item => ({ ...item.value, id: item.id }));
        resolve(values.length > 0 ? values : undefined);
      };
    });
  }

  /**
   * Search functionality is not supported in this implementation
   * @throws Error indicating search is not supported
   */
  async search(key: Partial<Combined>): Promise<Combined[] | undefined> {
    throw new Error("Search not supported for IndexedDbKVRepository");
  }

  /**
   * Deletes a key-value pair from the repository
   * @param key - The key object to delete
   * @emits delete - Emitted when a value is deleted
   */
  async deleteKeyValue(key: Key): Promise<void> {
    const id = await makeFingerprint(key);
    const db = await this.dbPromise;

    return new Promise((resolve, reject) => {
      const transaction = db.transaction(this.table, "readwrite");
      const store = transaction.objectStore(this.table);
      const request = store.delete(id);

      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        this.emit("delete", id);
        resolve();
      };
    });
  }

  /**
   * Deletes all key-value pairs from the repository
   * @emits clearall - Emitted when all values are deleted
   */
  async deleteAll(): Promise<void> {
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
   * Returns the total number of key-value pairs in the repository
   * @returns The count of stored items
   */
  async size(): Promise<number> {
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

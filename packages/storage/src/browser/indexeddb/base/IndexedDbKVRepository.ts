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

// IndexedDbKVRepository is a key-value store that uses IndexedDB as the backend for
// simple browser-based examples with no server-side component. It does not support di

export class IndexedDbKVRepository<
  Key extends Record<string, BasicKeyType> = DefaultPrimaryKeyType,
  Value extends Record<string, any> = DefaultValueType,
  PrimaryKeySchema extends BasePrimaryKeySchema = typeof DefaultPrimaryKeySchema,
  ValueSchema extends BaseValueSchema = typeof DefaultValueSchema,
  Combined extends Key & Value = Key & Value
> extends KVRepository<Key, Value, PrimaryKeySchema, ValueSchema, Combined> {
  private dbPromise: Promise<IDBDatabase>;

  constructor(public table: string = "kv_store") {
    super();
    this.dbPromise = ensureIndexedDbTable(this.table, (db) => {
      db.createObjectStore(table, { keyPath: "id" });
    });
  }

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

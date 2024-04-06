//    *******************************************************************************
//    *   ELLMERS: Embedding Large Language Model Experiential Retrieval Service    *
//    *                                                                             *
//    *   Copyright Steven Roussey <sroussey@gmail.com>                             *
//    *   Licensed under the Apache License, Version 2.0 (the "License");           *
//    *******************************************************************************

import { DiscriminatorSchema, KVRepository } from "./KVRepository";
import { makeFingerprint } from "../../util/Misc";
import { ensureIndexedDbTable } from "../../util/IndexedDbTable";

// IndexedDbKVRepository is a key-value store that uses IndexedDB as the backend for
// simple browser-based examples with no server-side component. It does not support di

export class IndexedDbKVRepository<
  Key = string,
  Value = string,
  Discriminator extends DiscriminatorSchema = DiscriminatorSchema,
> extends KVRepository<Key, Value, Discriminator> {
  private dbPromise: Promise<IDBDatabase>;

  constructor(public table: string = "kv_store") {
    super();
    this.dbPromise = ensureIndexedDbTable(this.table, (db) => {
      db.createObjectStore(table, { keyPath: "id" });
    });
  }

  async put(key: Key, value: Value): Promise<void> {
    const id = typeof key === "object" ? await makeFingerprint(key) : String(key);
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

  async get(key: Key): Promise<Value | undefined> {
    const id = typeof key === "object" ? await makeFingerprint(key) : String(key);
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

  async clear(): Promise<void> {
    const db = await this.dbPromise;

    return new Promise((resolve, reject) => {
      const transaction = db.transaction(this.table, "readwrite");
      const store = transaction.objectStore(this.table);
      const request = store.clear();

      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        this.emit("clear");
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

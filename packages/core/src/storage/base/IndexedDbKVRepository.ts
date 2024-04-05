//    *******************************************************************************
//    *   ELLMERS: Embedding Large Language Model Experiential Retrieval Service    *
//    *                                                                             *
//    *   Copyright Steven Roussey <sroussey@gmail.com>                             *
//    *   Licensed under the Apache License, Version 2.0 (the "License");           *
//    *******************************************************************************

import { DiscriminatorSchema, KVRepository } from "./KVRepository";
import { makeFingerprint } from "../../util/Misc";

// IndexedDbKVRepository is a key-value store that uses IndexedDB as the backend for
// simple browser-based examples with no server-side component. It does not support discriminators.

export class IndexedDbKVRepository<
  Key = string,
  Value = string,
  Discriminator extends DiscriminatorSchema = DiscriminatorSchema,
> extends KVRepository<Key, Value, Discriminator> {
  private dbPromise: Promise<IDBDatabase>;

  constructor(
    public dbName: string = "EllmersDB",
    public table: string = "kv_store"
  ) {
    super();
    this.dbPromise = new Promise((resolve, reject) => {
      const openRequest = indexedDB.open(dbName, 1);

      openRequest.onupgradeneeded = () => {
        const db = openRequest.result;
        if (!db.objectStoreNames.contains(this.table)) {
          db.createObjectStore(this.table, { keyPath: "id" });
        }
      };

      openRequest.onerror = () => reject(openRequest.error);
      openRequest.onsuccess = () => resolve(openRequest.result);
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

//    *******************************************************************************
//    *   ELLMERS: Embedding Large Language Model Experiential Retrieval Service    *
//    *                                                                             *
//    *   Copyright Steven Roussey <sroussey@gmail.com>                             *
//    *   Licensed under the Apache License, Version 2.0 (the "License");           *
//    *******************************************************************************

import { nanoid } from "nanoid";
import { Job } from "./base/Job";
import { JobQueue } from "./base/JobQueue";
import { ILimiter } from "./base/ILimiter";
import { makeFingerprint } from "../util/Misc";

// Utility functions for handling common IndexedDB operations
function openDatabase(
  name: string,
  version: number,
  onUpgradeNeeded: (db: IDBDatabase) => void
): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(name, version);
    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result);
    request.onupgradeneeded = () => onUpgradeNeeded(request.result);
  });
}

function transaction(
  db: IDBDatabase,
  storeName: string,
  mode: IDBTransactionMode = "readonly"
): IDBTransaction {
  return db.transaction(storeName, mode);
}

// The IndexedDbQueue class
export class IndexedDbQueue<Input, Output> extends JobQueue<Input, Output> {
  private dbPromise: Promise<IDBDatabase>;

  constructor(
    queue: string,
    limiter: ILimiter,
    waitDurationInMilliseconds: number = 100,
    public version: number = 1
  ) {
    super(queue, limiter, waitDurationInMilliseconds);
    this.dbPromise = openDatabase(this.queue, this.version, (db) => {
      // Create the 'jobs' object store if it doesn't already exist
      let store;
      if (!db.objectStoreNames.contains("jobs")) {
        store = db.createObjectStore("jobs", { keyPath: "id" });
      } else {
        store = transaction(db, "jobs", "versionchange").objectStore("jobs");
      }

      // Index for status, useful for the 'processing' method
      if (!store.indexNames.contains("status")) {
        store.createIndex("status", "status", { unique: false });
      }

      // Compound index for status and runAfter, useful for 'next' method
      if (!store.indexNames.contains("status_runAfter")) {
        store.createIndex("status_runAfter", ["status", "runAfter"], { unique: false });
      }

      // Compound index for taskType, fingerprint, and status, useful for 'outputForInput' method
      if (!store.indexNames.contains("taskType_fingerprint_status")) {
        store.createIndex("taskType_fingerprint_status", ["taskType", "fingerprint", "status"], {
          unique: false,
        });
      }
    });
  }

  async add(job: Job<Input, Output>): Promise<unknown> {
    job.id = job.id ?? nanoid();
    job.queueName = this.queue;
    job.fingerprint = await makeFingerprint(job.input);

    const db = await this.dbPromise;
    const tx = transaction(db, "jobs", "readwrite");
    tx.objectStore("jobs").add(job);
    return new Promise((resolve, reject) => {
      tx.oncomplete = () => resolve(job.id);
      tx.onerror = () => reject(tx.error);
    });
  }

  async get(id: unknown): Promise<Job<Input, Output> | undefined> {
    const db = await this.dbPromise;
    const tx = transaction(db, "jobs", "readonly");
    const request = tx.objectStore("jobs").get(id as string);
    return new Promise((resolve) => {
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => resolve(undefined); // Not found
    });
  }

  async peek(num: number = 100): Promise<Job<Input, Output>[]> {
    const db = await this.dbPromise;
    const tx = transaction(db, "jobs", "readonly");
    const store = tx.objectStore("jobs");
    const index = store.index("status_runAfter");
    const request = index.getAll(IDBKeyRange.only("PENDING"), num);

    return new Promise((resolve) => {
      request.onsuccess = () => resolve(request.result);
    });
  }

  async processing(): Promise<Job<Input, Output>[]> {
    const db = await this.dbPromise;
    const tx = transaction(db, "jobs", "readonly");
    const store = tx.objectStore("jobs");
    const index = store.index("status");
    const request = index.getAll(IDBKeyRange.only("PROCESSING"));

    return new Promise((resolve) => {
      request.onsuccess = () => resolve(request.result);
    });
  }

  async next(): Promise<Job<Input, Output> | undefined> {
    const db = await this.dbPromise;
    const tx = transaction(db, "jobs", "readwrite");
    const store = tx.objectStore("jobs");

    const index = store.index("status_runAfter");
    let cursorRequest = index.openCursor(IDBKeyRange.only("PENDING"), "next");

    return new Promise((resolve) => {
      cursorRequest.onsuccess = (e) => {
        const cursor = (e.target as IDBRequest<IDBCursorWithValue>).result;
        if (cursor) {
          const job = cursor.value;
          job.status = "PROCESSING";
          cursor.update(job);
          resolve(job);
        } else {
          resolve(undefined); // No more jobs
        }
      };
    });
  }

  async size(): Promise<number> {
    const db = await this.dbPromise;
    const tx = transaction(db, "jobs", "readonly");
    const store = tx.objectStore("jobs");
    const request = store.count();

    return new Promise((resolve) => {
      request.onsuccess = () => resolve(request.result);
    });
  }

  async complete(
    id: unknown,
    output: Output | null = null,
    error: string | null = null
  ): Promise<void> {
    const db = await this.dbPromise;
    const tx = transaction(db, "jobs", "readwrite");
    const store = tx.objectStore("jobs");
    const request = store.get(id as string);

    return new Promise((resolve, reject) => {
      request.onsuccess = () => {
        const job = request.result;
        if (!job) {
          reject(new Error(`Job ${id} not found`));
          return;
        }
        job.output = output;
        job.error = error;
        job.status = error ? "FAILED" : "COMPLETED";
        store.put(job);
        resolve();
      };
    });
  }

  async clear(): Promise<void> {
    const db = await this.dbPromise;
    const tx = transaction(db, "jobs", "readwrite");
    const store = tx.objectStore("jobs");
    const request = store.clear();

    return new Promise((resolve, reject) => {
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  }

  async outputForInput(taskType: string, input: Input): Promise<Output | null> {
    const db = await this.dbPromise;
    const tx = transaction(db, "jobs", "readonly");
    const store = tx.objectStore("jobs");

    const fingerprint = await makeFingerprint(input);

    const index = store.index("taskType_fingerprint_status");
    // We use compound key for querying in IndexedDB
    const queryKey = [taskType, fingerprint, "COMPLETED"];
    const request = index.get(queryKey);

    return new Promise((resolve) => {
      request.onsuccess = () => {
        const result = request.result;
        resolve(result ? (result.output ? (JSON.parse(result.output) as Output) : null) : null);
      };
      request.onerror = () => resolve(null); // In case of error, resolve with null
    });
  }
}

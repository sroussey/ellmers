//    *******************************************************************************
//    *   ELLMERS: Embedding Large Language Model Experiential Retrieval Service    *
//    *                                                                             *
//    *   Copyright Steven Roussey <sroussey@gmail.com>                             *
//    *   Licensed under the Apache License, Version 2.0 (the "License");           *
//    *******************************************************************************

import { TaskInput, TaskOutput } from "task";
import { ITaskOutputRepository } from "./ITaskOutputRepository";
import { makeFingerprint } from "../util/Misc";

export class IndexedDbTaskOutputRepository implements ITaskOutputRepository {
  private dbPromise: Promise<IDBDatabase>;

  constructor() {
    this.dbPromise = new Promise((resolve, reject) => {
      const openRequest = indexedDB.open("TaskOutputsDatabase", 1);

      openRequest.onupgradeneeded = () => {
        const db = openRequest.result;
        if (!db.objectStoreNames.contains("outputs")) {
          db.createObjectStore("outputs", { keyPath: "id" });
        }
      };

      openRequest.onerror = () => reject(openRequest.error);
      openRequest.onsuccess = () => resolve(openRequest.result);
    });
  }

  async saveOutput(taskType: string, inputs: TaskInput, output: TaskOutput): Promise<void> {
    const inputsHash = await makeFingerprint(inputs);
    const id = `${taskType}_${inputsHash}`;
    const db = await this.dbPromise;

    return new Promise((resolve, reject) => {
      const transaction = db.transaction("outputs", "readwrite");
      const store = transaction.objectStore("outputs");
      const request = store.put({ id, output });

      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve();
    });
  }

  async getOutput(taskType: string, inputs: TaskInput): Promise<TaskOutput | undefined> {
    const inputsHash = await makeFingerprint(inputs);
    const id = `${taskType}_${inputsHash}`;
    const db = await this.dbPromise;

    return new Promise((resolve, reject) => {
      const transaction = db.transaction("outputs", "readonly");
      const store = transaction.objectStore("outputs");
      const request = store.get(id);

      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        if (request.result) {
          resolve(request.result.output);
        } else {
          resolve(undefined);
        }
      };
    });
  }
}

//    *******************************************************************************
//    *   ELLMERS: Embedding Large Language Model Experiential Retrieval Service    *
//    *                                                                             *
//    *   Copyright Steven Roussey <sroussey@gmail.com>                             *
//    *   Licensed under the Apache License, Version 2.0 (the "License");           *
//    *******************************************************************************

// Since IndexedDb prefers to have the entire schema definded at once and not piecemeal,
// which is not what we need for caches for demos, we have a separate class for IndexedDb
// that simply adds a new database for each table. This will create if it doesn't already
// exist, and increments the version number.

export interface ExpectedIndexDefinition {
  name: string;
  keyPath: string | string[];
  options?: IDBIndexParameters;
}

export function ensureIndexedDbTable(
  tableName: string,
  primaryKey: string | string[],
  expectedIndexes: ExpectedIndexDefinition[] = []
): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const dbRequest = indexedDB.open(tableName);
    dbRequest.onerror = () => {
      reject(dbRequest.error);
    };

    dbRequest.onsuccess = () => {
      const db = dbRequest.result;
      let needsUpgrade = false;
      if (!db.objectStoreNames.contains(tableName)) {
        needsUpgrade = true;
      } else if (expectedIndexes && expectedIndexes.length > 0) {
        // Open a readonly transaction to inspect the store's indexes.
        const transaction = db.transaction(tableName, "readonly");
        const store = transaction.objectStore(tableName);
        for (const expectedIdx of expectedIndexes) {
          if (!store.indexNames.contains(expectedIdx.name)) {
            needsUpgrade = true;
            break;
          } else {
            const existingIdx = store.index(expectedIdx.name);
            // Compare keyPath.
            const expectedKeyPath = Array.isArray(expectedIdx.keyPath)
              ? expectedIdx.keyPath.join(",")
              : String(expectedIdx.keyPath);
            const actualKeyPath = Array.isArray(existingIdx.keyPath)
              ? existingIdx.keyPath.join(",")
              : String(existingIdx.keyPath);
            if (expectedKeyPath !== actualKeyPath) {
              needsUpgrade = true;
              break;
            }
            // Compare the unique flag.
            const expectedUnique = expectedIdx.options?.unique ?? false;
            if (existingIdx.unique !== expectedUnique) {
              needsUpgrade = true;
              break;
            }
            // Compare the multiEntry flag.
            const expectedMultiEntry = expectedIdx.options?.multiEntry ?? false;
            if (existingIdx.multiEntry !== expectedMultiEntry) {
              needsUpgrade = true;
              break;
            }
          }
        }
      }
      if (!needsUpgrade) {
        resolve(db);
        return;
      }
      // Upgrade/creation is needed.
      const currentVersion = db.version;
      db.close();
      const newDbRequest = indexedDB.open(tableName, currentVersion + 1);
      newDbRequest.onupgradeneeded = (event) => {
        const upgradedDb = newDbRequest.result;
        let store: IDBObjectStore;
        if (!upgradedDb.objectStoreNames.contains(tableName)) {
          store = upgradedDb.createObjectStore(tableName, { keyPath: primaryKey });
        } else {
          store = newDbRequest.transaction!.objectStore(tableName);
        }

        for (const expectedIdx of expectedIndexes) {
          if (!store.indexNames.contains(expectedIdx.name)) {
            store.createIndex(expectedIdx.name, expectedIdx.keyPath, expectedIdx.options);
          }
        }
      };
      newDbRequest.onsuccess = () => {
        resolve(newDbRequest.result);
      };
      newDbRequest.onerror = () => {
        reject(newDbRequest.error);
      };
    };
  });
}

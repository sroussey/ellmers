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

export function ensureIndexedDbTable(
  tableName: string,
  tableCreation: (db: IDBDatabase) => void
): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const dbRequest = indexedDB.open(tableName);
    dbRequest.onerror = () => {
      reject(dbRequest.error);
    };
    dbRequest.onsuccess = () => {
      const db = dbRequest.result;
      if (db.objectStoreNames.contains(tableName)) {
        resolve(db); // Table already exists, no further action needed
        return;
      }
      // Need to create the table, requires a version change
      const currentVersion = db.version;
      db.close(); // Close the current connection to upgrade the version
      const newDbRequest = indexedDB.open(tableName, currentVersion + 1);
      newDbRequest.onupgradeneeded = (event) => {
        const db = newDbRequest.result;
        if (!db.objectStoreNames.contains(tableName)) {
          tableCreation(db);
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

/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Opens an IDB connection and wires `onversionchange` so a future schema
 * bump in another tab can close this connection rather than blocking the
 * upgrade indefinitely.
 *
 * Pass `version` + `onUpgradeNeeded` only when the call site is itself
 * running a schema upgrade. Most callers want the no-arg form: open at
 * the database's current version and use it for reads/writes.
 */
export function openIdb(
  dbName: string,
  options: {
    readonly version?: number;
    readonly onUpgradeNeeded?: (event: IDBVersionChangeEvent) => void;
  } = {}
): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(dbName, options.version);
    req.onsuccess = () => {
      const db = req.result;
      db.onversionchange = () => db.close();
      resolve(db);
    };
    req.onupgradeneeded = (ev) => options.onUpgradeNeeded?.(ev);
    req.onerror = () => {
      const err = req.error;
      if (err && err.name === "VersionError") {
        reject(
          new Error(
            `IndexedDB ${dbName} exists at a higher version than ${options.version ?? "current"}`
          )
        );
        return;
      }
      reject(err);
    };
    req.onblocked = () =>
      reject(new Error(`IndexedDB ${dbName} is blocked — close other tabs using this database.`));
  });
}

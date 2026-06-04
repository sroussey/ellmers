/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { deepEqual } from "@workglow/util";
import { openIdb } from "./openIdb";

export interface ExpectedIndexDefinition {
  name: string;
  keyPath: string | string[];
  options?: IDBIndexParameters;
}

export interface MigrationContext {
  db: IDBDatabase;
  transaction: IDBTransaction;
  oldVersion: number;
  newVersion: number;
  tableName: string;
}

export interface DataTransformer {
  (oldData: any): any | Promise<any>;
}

export interface MigrationOptions {
  /** Custom data transformer to apply during migration */
  dataTransformer?: DataTransformer;
  /** Whether to allow destructive operations (delete and recreate). Default: false */
  allowDestructiveMigration?: boolean;
  /** Callback for migration progress/logging */
  onMigrationProgress?: (message: string, progress?: number) => void;
  /** Callback for migration errors (non-fatal warnings) */
  onMigrationWarning?: (message: string, error?: Error) => void;
}

interface SchemaSnapshot {
  version: number;
  primaryKey: string | string[];
  indexes: ExpectedIndexDefinition[];
  recordCount?: number;
  timestamp: number;
}

const METADATA_STORE_NAME = "__schema_metadata__";

async function saveSchemaMetadata(
  db: IDBDatabase,
  tableName: string,
  snapshot: SchemaSnapshot
): Promise<void> {
  return new Promise((resolve, reject) => {
    try {
      const transaction = db.transaction(METADATA_STORE_NAME, "readwrite");
      const store = transaction.objectStore(METADATA_STORE_NAME);
      const request = store.put({ ...snapshot, tableName }, tableName);

      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
      transaction.onerror = () => reject(transaction.error);
    } catch (err) {
      // Metadata store might not exist in old databases
      resolve();
    }
  });
}

function openIndexedDbTable(
  tableName: string,
  version?: number,
  upgradeNeededCallback?: (event: IDBVersionChangeEvent) => void
): Promise<IDBDatabase> {
  return openIdb(tableName, { version, onUpgradeNeeded: upgradeNeededCallback });
}

async function deleteIndexedDbTable(tableName: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const deleteRequest = indexedDB.deleteDatabase(tableName);

    deleteRequest.onsuccess = () => resolve();
    deleteRequest.onerror = () => reject(deleteRequest.error);
    deleteRequest.onblocked = () => {
      reject(
        new Error(`Cannot delete database ${tableName}. Close all other tabs using this database.`)
      );
    };
  });
}

interface SchemaDiff {
  indexesToAdd: ExpectedIndexDefinition[];
  indexesToRemove: string[];
  indexesToModify: ExpectedIndexDefinition[];
  primaryKeyChanged: boolean;
  needsObjectStoreRecreation: boolean;
}

function compareSchemas(
  store: IDBObjectStore,
  expectedPrimaryKey: string | string[],
  expectedIndexes: ExpectedIndexDefinition[]
): SchemaDiff {
  const diff: SchemaDiff = {
    indexesToAdd: [],
    indexesToRemove: [],
    indexesToModify: [],
    primaryKeyChanged: false,
    needsObjectStoreRecreation: false,
  };

  const actualKeyPath = store.keyPath;
  const normalizedExpected = Array.isArray(expectedPrimaryKey)
    ? expectedPrimaryKey
    : expectedPrimaryKey;
  const normalizedActual = Array.isArray(actualKeyPath) ? actualKeyPath : actualKeyPath;

  if (!deepEqual(normalizedExpected, normalizedActual)) {
    diff.primaryKeyChanged = true;
    diff.needsObjectStoreRecreation = true;
    return diff;
  }

  const existingIndexes = new Map<string, IDBIndex>();
  for (let i = 0; i < store.indexNames.length; i++) {
    const indexName = store.indexNames[i];
    existingIndexes.set(indexName, store.index(indexName));
  }

  for (const expectedIdx of expectedIndexes) {
    const existingIdx = existingIndexes.get(expectedIdx.name);

    if (!existingIdx) {
      diff.indexesToAdd.push(expectedIdx);
    } else {
      const expectedKeyPath = Array.isArray(expectedIdx.keyPath)
        ? expectedIdx.keyPath
        : [expectedIdx.keyPath];
      const actualKeyPath = Array.isArray(existingIdx.keyPath)
        ? existingIdx.keyPath
        : [existingIdx.keyPath];

      const keyPathChanged = !deepEqual(expectedKeyPath, actualKeyPath);
      const uniqueChanged = existingIdx.unique !== (expectedIdx.options?.unique ?? false);
      const multiEntryChanged =
        existingIdx.multiEntry !== (expectedIdx.options?.multiEntry ?? false);

      if (keyPathChanged || uniqueChanged || multiEntryChanged) {
        diff.indexesToModify.push(expectedIdx);
      }

      existingIndexes.delete(expectedIdx.name);
    }
  }

  diff.indexesToRemove = Array.from(existingIndexes.keys());

  return diff;
}

async function readAllData(store: IDBObjectStore): Promise<any[]> {
  return new Promise((resolve, reject) => {
    const request = store.getAll();
    request.onsuccess = () => resolve(request.result || []);
    request.onerror = () => reject(request.error);
  });
}

async function performIncrementalMigration(
  db: IDBDatabase,
  tableName: string,
  diff: SchemaDiff,
  options: MigrationOptions = {}
): Promise<IDBDatabase> {
  const currentVersion = db.version;
  const newVersion = currentVersion + 1;

  db.close();

  options.onMigrationProgress?.(
    `Migrating ${tableName} from version ${currentVersion} to ${newVersion}...`,
    0
  );

  return openIndexedDbTable(tableName, newVersion, (event: IDBVersionChangeEvent) => {
    const transaction = (event.target as IDBOpenDBRequest).transaction!;
    const store = transaction.objectStore(tableName);

    for (const indexName of diff.indexesToRemove) {
      options.onMigrationProgress?.(`Removing index: ${indexName}`, 0.2);
      store.deleteIndex(indexName);
    }

    for (const indexDef of diff.indexesToModify) {
      options.onMigrationProgress?.(`Updating index: ${indexDef.name}`, 0.4);
      if (store.indexNames.contains(indexDef.name)) {
        store.deleteIndex(indexDef.name);
      }
      store.createIndex(indexDef.name, indexDef.keyPath, indexDef.options);
    }

    for (const indexDef of diff.indexesToAdd) {
      options.onMigrationProgress?.(`Adding index: ${indexDef.name}`, 0.6);
      store.createIndex(indexDef.name, indexDef.keyPath, indexDef.options);
    }

    options.onMigrationProgress?.(`Migration complete`, 1.0);
  });
}

/** Destructive migration by recreating the object store; needed when the primary key changes. */
async function performDestructiveMigration(
  db: IDBDatabase,
  tableName: string,
  primaryKey: string | string[],
  expectedIndexes: ExpectedIndexDefinition[],
  options: MigrationOptions = {},
  autoIncrement: boolean = false
): Promise<IDBDatabase> {
  if (!options.allowDestructiveMigration) {
    throw new Error(
      `Destructive migration required for ${tableName} but not allowed. ` +
        `Primary key has changed. Set allowDestructiveMigration=true to proceed with data loss, ` +
        `or provide a dataTransformer to migrate data.`
    );
  }

  const currentVersion = db.version;
  const newVersion = currentVersion + 1;

  options.onMigrationProgress?.(
    `Performing destructive migration of ${tableName}. Reading existing data...`,
    0
  );

  let existingData: any[] = [];
  try {
    const transaction = db.transaction(tableName, "readonly");
    const store = transaction.objectStore(tableName);
    existingData = await readAllData(store);
    options.onMigrationProgress?.(`Read ${existingData.length} records`, 0.3);
  } catch (err) {
    options.onMigrationWarning?.(
      `Failed to read existing data during migration: ${err}`,
      err as Error
    );
  }

  db.close();

  if (options.dataTransformer && existingData.length > 0) {
    options.onMigrationProgress?.(`Transforming ${existingData.length} records...`, 0.4);
    try {
      const transformed = [];
      for (let i = 0; i < existingData.length; i++) {
        const record = existingData[i];
        const transformedRecord = await options.dataTransformer(record);
        if (transformedRecord !== undefined && transformedRecord !== null) {
          transformed.push(transformedRecord);
        }
        if (i % 100 === 0) {
          options.onMigrationProgress?.(
            `Transformed ${i}/${existingData.length} records`,
            0.4 + (i / existingData.length) * 0.3
          );
        }
      }
      existingData = transformed;
      options.onMigrationProgress?.(`Transformation complete: ${existingData.length} records`, 0.7);
    } catch (err) {
      options.onMigrationWarning?.(
        `Data transformation failed: ${err}. Some data may be lost.`,
        err as Error
      );
      existingData = [];
    }
  }

  options.onMigrationProgress?.(`Recreating object store...`, 0.75);

  const newDb = await openIndexedDbTable(tableName, newVersion, (event: IDBVersionChangeEvent) => {
    const db = (event.target as IDBOpenDBRequest).result;

    if (db.objectStoreNames.contains(tableName)) {
      db.deleteObjectStore(tableName);
    }

    const store = db.createObjectStore(tableName, { keyPath: primaryKey, autoIncrement });

    for (const idx of expectedIndexes) {
      store.createIndex(idx.name, idx.keyPath, idx.options);
    }

    if (existingData.length > 0) {
      options.onMigrationProgress?.(`Restoring ${existingData.length} records...`, 0.8);

      for (const record of existingData) {
        try {
          store.put(record);
        } catch (err) {
          options.onMigrationWarning?.(`Failed to restore record: ${err}`, err as Error);
        }
      }
    }
  });

  options.onMigrationProgress?.(`Destructive migration complete`, 1.0);

  return newDb;
}

async function createNewDatabase(
  tableName: string,
  primaryKey: string | string[],
  expectedIndexes: ExpectedIndexDefinition[],
  options: MigrationOptions = {},
  autoIncrement: boolean = false
): Promise<IDBDatabase> {
  options.onMigrationProgress?.(`Creating new database: ${tableName}`, 0);

  // Delete existing database if it exists to avoid version conflicts
  try {
    await deleteIndexedDbTable(tableName);
    await new Promise((resolve) => setTimeout(resolve, 50));
  } catch (err) {
    // ignore — database might not exist
  }

  const version = 1;

  const db = await openIndexedDbTable(tableName, version, (event: IDBVersionChangeEvent) => {
    const db = (event.target as IDBOpenDBRequest).result;

    if (!db.objectStoreNames.contains(METADATA_STORE_NAME)) {
      db.createObjectStore(METADATA_STORE_NAME, { keyPath: "tableName" });
    }

    const store = db.createObjectStore(tableName, { keyPath: primaryKey, autoIncrement });

    for (const idx of expectedIndexes) {
      store.createIndex(idx.name, idx.keyPath, idx.options);
    }
  });

  const snapshot: SchemaSnapshot = {
    version: db.version,
    primaryKey,
    indexes: expectedIndexes,
    recordCount: 0,
    timestamp: Date.now(),
  };

  await saveSchemaMetadata(db, tableName, snapshot);

  options.onMigrationProgress?.(`Database created successfully`, 1.0);

  return db;
}

/**
 * Ensures that an IndexedDB table exists with the specified schema.
 * Performs migrations as needed without data loss when possible.
 */
export async function ensureIndexedDbTable(
  tableName: string,
  primaryKey: string | string[],
  expectedIndexes: ExpectedIndexDefinition[] = [],
  options: MigrationOptions = {},
  autoIncrement: boolean = false
): Promise<IDBDatabase> {
  try {
    let db: IDBDatabase;
    let wasJustCreated = false;
    try {
      // Opens at current version if exists, else creates at version 1
      db = await openIndexedDbTable(tableName);

      // indexedDB.open creating a new DB without stores leaves it at version 1
      if (db.version === 1 && !db.objectStoreNames.contains(tableName)) {
        wasJustCreated = true;
        db.close();
      }
    } catch (err: any) {
      options.onMigrationProgress?.(
        `Database ${tableName} does not exist or has version conflict, creating...`,
        0
      );
      return await createNewDatabase(
        tableName,
        primaryKey,
        expectedIndexes,
        options,
        autoIncrement
      );
    }

    // Delete the empty DB and recreate it at version 1 with stores
    if (wasJustCreated) {
      options.onMigrationProgress?.(`Creating new database: ${tableName}`, 0);
      try {
        await deleteIndexedDbTable(tableName);
        await new Promise((resolve) => setTimeout(resolve, 50));
      } catch (err) {
        // ignore
      }

      db = await openIndexedDbTable(tableName, 1, (event: IDBVersionChangeEvent) => {
        const db = (event.target as IDBOpenDBRequest).result;

        if (!db.objectStoreNames.contains(METADATA_STORE_NAME)) {
          db.createObjectStore(METADATA_STORE_NAME, { keyPath: "tableName" });
        }

        const store = db.createObjectStore(tableName, { keyPath: primaryKey, autoIncrement });

        for (const idx of expectedIndexes) {
          store.createIndex(idx.name, idx.keyPath, idx.options);
        }
      });

      const snapshot: SchemaSnapshot = {
        version: db.version,
        primaryKey,
        indexes: expectedIndexes,
        recordCount: 0,
        timestamp: Date.now(),
      };
      await saveSchemaMetadata(db, tableName, snapshot);

      options.onMigrationProgress?.(`Database created successfully`, 1.0);
      return db;
    }

    if (!db.objectStoreNames.contains(METADATA_STORE_NAME)) {
      const currentVersion = db.version;
      db.close();

      db = await openIndexedDbTable(
        tableName,
        currentVersion + 1,
        (event: IDBVersionChangeEvent) => {
          const db = (event.target as IDBOpenDBRequest).result;
          if (!db.objectStoreNames.contains(METADATA_STORE_NAME)) {
            db.createObjectStore(METADATA_STORE_NAME, { keyPath: "tableName" });
          }
        }
      );
    }

    if (!db.objectStoreNames.contains(tableName)) {
      options.onMigrationProgress?.(`Object store ${tableName} does not exist, creating...`, 0);
      db.close();
      return await createNewDatabase(
        tableName,
        primaryKey,
        expectedIndexes,
        options,
        autoIncrement
      );
    }

    const transaction = db.transaction(tableName, "readonly");
    const store = transaction.objectStore(tableName);
    const diff = compareSchemas(store, primaryKey, expectedIndexes);

    await new Promise<void>((resolve) => {
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => resolve();
    });

    const needsMigration =
      diff.indexesToAdd.length > 0 ||
      diff.indexesToRemove.length > 0 ||
      diff.indexesToModify.length > 0 ||
      diff.needsObjectStoreRecreation;

    if (!needsMigration) {
      options.onMigrationProgress?.(`Schema for ${tableName} is up to date`, 1.0);

      // Update metadata to keep timestamp current
      const snapshot: SchemaSnapshot = {
        version: db.version,
        primaryKey,
        indexes: expectedIndexes,
        timestamp: Date.now(),
      };
      await saveSchemaMetadata(db, tableName, snapshot);

      return db;
    }

    if (diff.needsObjectStoreRecreation) {
      options.onMigrationProgress?.(
        `Schema change requires object store recreation for ${tableName}`,
        0
      );
      db = await performDestructiveMigration(
        db,
        tableName,
        primaryKey,
        expectedIndexes,
        options,
        autoIncrement
      );
    } else {
      options.onMigrationProgress?.(`Performing incremental migration for ${tableName}`, 0);
      db = await performIncrementalMigration(db, tableName, diff, options);
    }

    const snapshot: SchemaSnapshot = {
      version: db.version,
      primaryKey,
      indexes: expectedIndexes,
      timestamp: Date.now(),
    };
    await saveSchemaMetadata(db, tableName, snapshot);

    return db;
  } catch (err) {
    options.onMigrationWarning?.(`Migration failed for ${tableName}: ${err}`, err as Error);
    throw err;
  }
}

export async function dropIndexedDbTable(tableName: string): Promise<void> {
  return deleteIndexedDbTable(tableName);
}

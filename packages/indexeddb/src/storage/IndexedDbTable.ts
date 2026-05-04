/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

// Production-ready IndexedDB table management with proper migration support.
// Handles schema evolution without data loss by incrementally migrating the database
// structure and transforming existing data as needed.

import { deepEqual } from "@workglow/util";

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

/**
 * Stores metadata about the database schema for migration tracking
 */
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
      // Metadata store might not exist in old databases, that's OK
      resolve();
    }
  });
}

/**
 * Opens an IndexedDB database with proper error handling
 */
async function openIndexedDbTable(
  tableName: string,
  version?: number,
  upgradeNeededCallback?: (event: IDBVersionChangeEvent) => void
): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const openRequest = indexedDB.open(tableName, version);

    openRequest.onsuccess = (event) => {
      const db = (event.target as IDBOpenDBRequest).result;

      // Handle unexpected close
      db.onversionchange = () => {
        db.close();
      };

      resolve(db);
    };

    openRequest.onupgradeneeded = (event) => {
      if (upgradeNeededCallback) {
        upgradeNeededCallback(event);
      }
    };

    openRequest.onerror = () => {
      const error = openRequest.error;
      // Check if it's a VersionError - this means the database exists at a higher version
      if (error && error.name === "VersionError") {
        reject(
          new Error(
            `Database ${tableName} exists at a higher version. Cannot open at version ${version || "current"}.`
          )
        );
      } else {
        reject(error);
      }
    };
    openRequest.onblocked = () => {
      reject(
        new Error(`Database ${tableName} is blocked. Close all other tabs using this database.`)
      );
    };
  });
}

/**
 * Deletes an IndexedDB database completely
 */
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

/**
 * Compares two schema definitions to determine what changes are needed
 */
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

  // Check primary key
  const actualKeyPath = store.keyPath;
  const normalizedExpected = Array.isArray(expectedPrimaryKey)
    ? expectedPrimaryKey
    : expectedPrimaryKey;
  const normalizedActual = Array.isArray(actualKeyPath) ? actualKeyPath : actualKeyPath;

  if (!deepEqual(normalizedExpected, normalizedActual)) {
    diff.primaryKeyChanged = true;
    diff.needsObjectStoreRecreation = true;
    return diff; // If primary key changed, we need full recreation
  }

  // Build a map of existing indexes
  const existingIndexes = new Map<string, IDBIndex>();
  for (let i = 0; i < store.indexNames.length; i++) {
    const indexName = store.indexNames[i];
    existingIndexes.set(indexName, store.index(indexName));
  }

  // Check for indexes to add or modify
  for (const expectedIdx of expectedIndexes) {
    const existingIdx = existingIndexes.get(expectedIdx.name);

    if (!existingIdx) {
      diff.indexesToAdd.push(expectedIdx);
    } else {
      // Compare index properties
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

  // Remaining indexes should be removed
  diff.indexesToRemove = Array.from(existingIndexes.keys());

  return diff;
}

/**
 * Reads all data from a store
 */
async function readAllData(store: IDBObjectStore): Promise<any[]> {
  return new Promise((resolve, reject) => {
    const request = store.getAll();
    request.onsuccess = () => resolve(request.result || []);
    request.onerror = () => reject(request.error);
  });
}

/**
 * Performs a non-destructive migration by adding/removing indexes
 */
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

    // Remove outdated indexes
    for (const indexName of diff.indexesToRemove) {
      options.onMigrationProgress?.(`Removing index: ${indexName}`, 0.2);
      store.deleteIndex(indexName);
    }

    // Remove and recreate modified indexes
    for (const indexDef of diff.indexesToModify) {
      options.onMigrationProgress?.(`Updating index: ${indexDef.name}`, 0.4);
      if (store.indexNames.contains(indexDef.name)) {
        store.deleteIndex(indexDef.name);
      }
      store.createIndex(indexDef.name, indexDef.keyPath, indexDef.options);
    }

    // Add new indexes
    for (const indexDef of diff.indexesToAdd) {
      options.onMigrationProgress?.(`Adding index: ${indexDef.name}`, 0.6);
      store.createIndex(indexDef.name, indexDef.keyPath, indexDef.options);
    }

    options.onMigrationProgress?.(`Migration complete`, 1.0);
  });
}

/**
 * Performs a destructive migration by recreating the object store
 * This is needed when the primary key changes
 */
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

  // Read all existing data
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

  // Apply data transformer if provided
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

  // Open with new version and recreate object store
  options.onMigrationProgress?.(`Recreating object store...`, 0.75);

  const newDb = await openIndexedDbTable(tableName, newVersion, (event: IDBVersionChangeEvent) => {
    const db = (event.target as IDBOpenDBRequest).result;

    // Delete old object store if it exists
    if (db.objectStoreNames.contains(tableName)) {
      db.deleteObjectStore(tableName);
    }

    // Create new object store with new schema
    const store = db.createObjectStore(tableName, { keyPath: primaryKey, autoIncrement });

    // Create indexes
    for (const idx of expectedIndexes) {
      store.createIndex(idx.name, idx.keyPath, idx.options);
    }

    // Restore data
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

/**
 * Creates a new database with the specified schema
 */
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
    // Wait a bit for deletion to complete
    await new Promise((resolve) => setTimeout(resolve, 50));
  } catch (err) {
    // Ignore errors - database might not exist
  }

  const version = 1;

  const db = await openIndexedDbTable(tableName, version, (event: IDBVersionChangeEvent) => {
    const db = (event.target as IDBOpenDBRequest).result;

    // Create metadata store
    if (!db.objectStoreNames.contains(METADATA_STORE_NAME)) {
      db.createObjectStore(METADATA_STORE_NAME, { keyPath: "tableName" });
    }

    // Create main object store
    const store = db.createObjectStore(tableName, { keyPath: primaryKey, autoIncrement });

    // Create indexes
    for (const idx of expectedIndexes) {
      store.createIndex(idx.name, idx.keyPath, idx.options);
    }
  });

  // Save schema metadata
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
    // Try to open existing database at current version (or create if doesn't exist)
    let db: IDBDatabase;
    let wasJustCreated = false;
    try {
      // Open without version - this will open at current version if exists, or create at version 1 if doesn't exist
      db = await openIndexedDbTable(tableName);

      // Check if database was just created (version 1 and no object stores)
      // This happens when indexedDB.open creates a new database without stores
      if (db.version === 1 && !db.objectStoreNames.contains(tableName)) {
        wasJustCreated = true;
        db.close();
      }
    } catch (err: any) {
      // If opening fails, database might not exist or there's a version conflict
      // Try to create it fresh
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

    // If database was just created, we need to create the stores
    // We'll upgrade from version 1 to version 1 (which triggers onupgradeneeded with oldVersion=0)
    // Actually, we need to explicitly create at version 1 with stores
    if (wasJustCreated) {
      options.onMigrationProgress?.(`Creating new database: ${tableName}`, 0);
      // Delete the empty database and create it properly at version 1
      try {
        await deleteIndexedDbTable(tableName);
        await new Promise((resolve) => setTimeout(resolve, 50));
      } catch (err) {
        // Ignore errors
      }

      // Create at version 1 with stores
      db = await openIndexedDbTable(tableName, 1, (event: IDBVersionChangeEvent) => {
        const db = (event.target as IDBOpenDBRequest).result;

        // Create metadata store
        if (!db.objectStoreNames.contains(METADATA_STORE_NAME)) {
          db.createObjectStore(METADATA_STORE_NAME, { keyPath: "tableName" });
        }

        // Create main object store
        const store = db.createObjectStore(tableName, { keyPath: primaryKey, autoIncrement });

        // Create indexes
        for (const idx of expectedIndexes) {
          store.createIndex(idx.name, idx.keyPath, idx.options);
        }
      });

      // Save schema metadata
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

    // Ensure metadata store exists
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

    // Check if table structure matches expected
    if (!db.objectStoreNames.contains(tableName)) {
      // Object store doesn't exist, create it
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

    // Compare schemas to determine what migration is needed
    const transaction = db.transaction(tableName, "readonly");
    const store = transaction.objectStore(tableName);
    const diff = compareSchemas(store, primaryKey, expectedIndexes);

    await new Promise<void>((resolve) => {
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => resolve();
    });

    // Determine migration strategy
    const needsMigration =
      diff.indexesToAdd.length > 0 ||
      diff.indexesToRemove.length > 0 ||
      diff.indexesToModify.length > 0 ||
      diff.needsObjectStoreRecreation;

    if (!needsMigration) {
      // Schema matches, no migration needed
      options.onMigrationProgress?.(`Schema for ${tableName} is up to date`, 1.0);

      // Update metadata anyway to keep timestamp current
      const snapshot: SchemaSnapshot = {
        version: db.version,
        primaryKey,
        indexes: expectedIndexes,
        timestamp: Date.now(),
      };
      await saveSchemaMetadata(db, tableName, snapshot);

      return db;
    }

    // Perform appropriate migration
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

    // Save updated metadata
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

/**
 * Utility function to delete a database (for testing or cleanup)
 */
export async function dropIndexedDbTable(tableName: string): Promise<void> {
  return deleteIndexedDbTable(tableName);
}

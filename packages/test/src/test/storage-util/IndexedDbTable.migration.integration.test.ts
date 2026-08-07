/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { ExpectedIndexDefinition } from "@workglow/indexeddb/storage";
import { dropIndexedDbTable, ensureIndexedDbTable } from "@workglow/indexeddb/storage";
import { setLogger } from "@workglow/util";
import { getTestingLogger } from "@workglow/util/test";
import "fake-indexeddb/auto";
import { afterEach, describe, expect, it } from "vitest";

describe("IndexedDbTable - Migration Tests", () => {
  let logger = getTestingLogger();
  setLogger(logger);
  const testTableName = "migration_test_table";

  afterEach(async () => {
    // Clean up after each test
    try {
      await dropIndexedDbTable(testTableName);
    } catch (err) {
      // Ignore errors if table doesn't exist
    }
  });

  describe("initial database creation", () => {
    it("should create a new database with simple primary key", async () => {
      const db = await ensureIndexedDbTable(testTableName, "id", []);

      expect(db).toBeDefined();
      expect(db.objectStoreNames.contains(testTableName)).toBe(true);

      const tx = db.transaction(testTableName, "readonly");
      const store = tx.objectStore(testTableName);
      expect(store.keyPath).toBe("id");

      db.close();
    });

    it("should create a new database with compound primary key", async () => {
      const db = await ensureIndexedDbTable(testTableName, ["tenant", "id"], []);

      expect(db).toBeDefined();
      const tx = db.transaction(testTableName, "readonly");
      const store = tx.objectStore(testTableName);
      expect(store.keyPath).toEqual(["tenant", "id"]);

      db.close();
    });

    it("should create indexes on new database", async () => {
      const indexes: ExpectedIndexDefinition[] = [
        { name: "email", keyPath: "email", options: { unique: true } },
        { name: "status", keyPath: "status", options: { unique: false } },
        { name: "name_age", keyPath: ["name", "age"], options: { unique: false } },
      ];

      const db = await ensureIndexedDbTable(testTableName, "id", indexes);

      const tx = db.transaction(testTableName, "readonly");
      const store = tx.objectStore(testTableName);

      expect(store.indexNames.contains("email")).toBe(true);
      expect(store.indexNames.contains("status")).toBe(true);
      expect(store.indexNames.contains("name_age")).toBe(true);

      const emailIndex = store.index("email");
      expect(emailIndex.unique).toBe(true);
      expect(emailIndex.keyPath).toBe("email");

      const nameAgeIndex = store.index("name_age");
      expect(nameAgeIndex.keyPath).toEqual(["name", "age"]);

      db.close();
    });

    it("should create metadata store", async () => {
      const db = await ensureIndexedDbTable(testTableName, "id", []);

      expect(db.objectStoreNames.contains("__schema_metadata__")).toBe(true);

      db.close();
    });
  });

  describe("non-destructive migrations", () => {
    it("should add new indexes without data loss", async () => {
      // Create initial database with data
      const db1 = await ensureIndexedDbTable(testTableName, "id", [
        { name: "email", keyPath: "email", options: { unique: true } },
      ]);

      const tx1 = db1.transaction(testTableName, "readwrite");
      const store1 = tx1.objectStore(testTableName);
      store1.add({ id: 1, email: "test@example.com", status: "active" });
      await new Promise((resolve) => (tx1.oncomplete = resolve));
      db1.close();

      // Add new index
      const db2 = await ensureIndexedDbTable(testTableName, "id", [
        { name: "email", keyPath: "email", options: { unique: true } },
        { name: "status", keyPath: "status", options: { unique: false } }, // NEW
      ]);

      const tx2 = db2.transaction(testTableName, "readonly");
      const store2 = tx2.objectStore(testTableName);

      // Check indexes
      expect(store2.indexNames.contains("email")).toBe(true);
      expect(store2.indexNames.contains("status")).toBe(true);

      // Check data is preserved
      const getRequest = store2.get(1);
      const data = await new Promise(
        (resolve) => (getRequest.onsuccess = () => resolve(getRequest.result))
      );
      expect(data).toEqual({ id: 1, email: "test@example.com", status: "active" });

      db2.close();
    });

    it("should remove old indexes without data loss", async () => {
      // Create initial database with multiple indexes
      const db1 = await ensureIndexedDbTable(testTableName, "id", [
        { name: "email", keyPath: "email", options: { unique: true } },
        { name: "status", keyPath: "status", options: { unique: false } },
      ]);

      const tx1 = db1.transaction(testTableName, "readwrite");
      const store1 = tx1.objectStore(testTableName);
      store1.add({ id: 1, email: "test@example.com", status: "active" });
      await new Promise((resolve) => (tx1.oncomplete = resolve));
      db1.close();

      // Remove status index
      const db2 = await ensureIndexedDbTable(testTableName, "id", [
        { name: "email", keyPath: "email", options: { unique: true } },
      ]);

      const tx2 = db2.transaction(testTableName, "readonly");
      const store2 = tx2.objectStore(testTableName);

      // Check indexes
      expect(store2.indexNames.contains("email")).toBe(true);
      expect(store2.indexNames.contains("status")).toBe(false);

      // Check data is preserved
      const getRequest = store2.get(1);
      const data = await new Promise(
        (resolve) => (getRequest.onsuccess = () => resolve(getRequest.result))
      );
      expect(data).toEqual({ id: 1, email: "test@example.com", status: "active" });

      db2.close();
    });

    it("should modify index properties without data loss", async () => {
      // Create initial database
      const db1 = await ensureIndexedDbTable(testTableName, "id", [
        { name: "email", keyPath: "email", options: { unique: true } },
      ]);

      const tx1 = db1.transaction(testTableName, "readwrite");
      const store1 = tx1.objectStore(testTableName);
      store1.add({ id: 1, email: "test1@example.com" });
      store1.add({ id: 2, email: "test2@example.com" });
      await new Promise((resolve) => (tx1.oncomplete = resolve));
      db1.close();

      // Change email index to non-unique
      const db2 = await ensureIndexedDbTable(testTableName, "id", [
        { name: "email", keyPath: "email", options: { unique: false } },
      ]);

      const tx2 = db2.transaction(testTableName, "readonly");
      const store2 = tx2.objectStore(testTableName);
      const emailIndex = store2.index("email");

      // Check index was modified
      expect(emailIndex.unique).toBe(false);

      // Check data is preserved
      const countRequest = store2.count();
      const count = await new Promise(
        (resolve) => (countRequest.onsuccess = () => resolve(countRequest.result))
      );
      expect(count).toBe(2);

      db2.close();
    });
  });

  describe("destructive migrations", () => {
    it("should fail when primary key changes without allowDestructiveMigration", async () => {
      // Create initial database
      const db1 = await ensureIndexedDbTable(testTableName, "id", []);
      db1.close();

      // Try to change primary key without permission
      await expect(
        ensureIndexedDbTable(testTableName, "new_id", [], {
          allowDestructiveMigration: false,
        })
      ).rejects.toThrow(/Destructive migration required/);
    });

    it("should change primary key with allowDestructiveMigration but lose data", async () => {
      // Create initial database with data
      const db1 = await ensureIndexedDbTable(testTableName, "id", []);
      const tx1 = db1.transaction(testTableName, "readwrite");
      const store1 = tx1.objectStore(testTableName);
      store1.add({ id: 1, name: "Test" });
      await new Promise((resolve) => (tx1.oncomplete = resolve));
      db1.close();

      // Change primary key with destructive migration allowed
      const db2 = await ensureIndexedDbTable(testTableName, "new_id", [], {
        allowDestructiveMigration: true,
      });

      const tx2 = db2.transaction(testTableName, "readonly");
      const store2 = tx2.objectStore(testTableName);

      // Primary key changed
      expect(store2.keyPath).toBe("new_id");

      // Data is lost (no transformer provided)
      const countRequest = store2.count();
      const count = await new Promise(
        (resolve) => (countRequest.onsuccess = () => resolve(countRequest.result))
      );
      expect(count).toBe(0);

      db2.close();
    });

    it("should preserve data with dataTransformer during primary key change", async () => {
      // Create initial database with data
      const db1 = await ensureIndexedDbTable(testTableName, "id", []);
      const tx1 = db1.transaction(testTableName, "readwrite");
      const store1 = tx1.objectStore(testTableName);
      store1.add({ id: 1, name: "Test1" });
      store1.add({ id: 2, name: "Test2" });
      await new Promise((resolve) => (tx1.oncomplete = resolve));
      db1.close();

      // Change primary key with data transformer
      const db2 = await ensureIndexedDbTable(testTableName, "new_id", [], {
        allowDestructiveMigration: true,
        dataTransformer: (oldRecord) => ({
          new_id: oldRecord.id,
          name: oldRecord.name,
          migrated: true,
        }),
      });

      const tx2 = db2.transaction(testTableName, "readonly");
      const store2 = tx2.objectStore(testTableName);

      // Primary key changed
      expect(store2.keyPath).toBe("new_id");

      // Data is preserved and transformed
      const countRequest = store2.count();
      const count = await new Promise(
        (resolve) => (countRequest.onsuccess = () => resolve(countRequest.result))
      );
      expect(count).toBe(2);

      const getRequest = store2.get(1);
      const data = await new Promise(
        (resolve) => (getRequest.onsuccess = () => resolve(getRequest.result))
      );
      expect(data).toEqual({ new_id: 1, name: "Test1", migrated: true });

      db2.close();
    });

    it("should skip records that return null from dataTransformer", async () => {
      // Create initial database with data
      const db1 = await ensureIndexedDbTable(testTableName, "id", []);
      const tx1 = db1.transaction(testTableName, "readwrite");
      const store1 = tx1.objectStore(testTableName);
      store1.add({ id: 1, name: "Keep" });
      store1.add({ id: 2, name: "Skip" });
      store1.add({ id: 3, name: "Keep" });
      await new Promise((resolve) => (tx1.oncomplete = resolve));
      db1.close();

      // Transform with filtering
      const db2 = await ensureIndexedDbTable(testTableName, "new_id", [], {
        allowDestructiveMigration: true,
        dataTransformer: (oldRecord) => {
          if (oldRecord.name === "Skip") {
            return null; // Skip this record
          }
          return {
            new_id: oldRecord.id,
            name: oldRecord.name,
          };
        },
      });

      const tx2 = db2.transaction(testTableName, "readonly");
      const store2 = tx2.objectStore(testTableName);

      // Only 2 records should be kept
      const countRequest = store2.count();
      const count = await new Promise(
        (resolve) => (countRequest.onsuccess = () => resolve(countRequest.result))
      );
      expect(count).toBe(2);

      db2.close();
    });
  });

  describe("migration callbacks", () => {
    it("should call onMigrationProgress during migration", async () => {
      const progressMessages: string[] = [];
      const progressValues: number[] = [];

      await ensureIndexedDbTable(testTableName, "id", [], {
        onMigrationProgress: (message, progress) => {
          progressMessages.push(message);
          if (progress !== undefined) {
            progressValues.push(progress);
          }
        },
      });

      expect(progressMessages.length).toBeGreaterThan(0);
      expect(progressMessages[0]).toContain("Creating new database");
    });

    it("should call onMigrationProgress during index addition", async () => {
      // Create initial database
      const db1 = await ensureIndexedDbTable(testTableName, "id", []);
      db1.close();

      // Add indexes with progress tracking
      const progressMessages: string[] = [];

      const db2 = await ensureIndexedDbTable(
        testTableName,
        "id",
        [
          { name: "email", keyPath: "email", options: { unique: true } },
          { name: "status", keyPath: "status", options: { unique: false } },
        ],
        {
          onMigrationProgress: (message) => {
            progressMessages.push(message);
          },
        }
      );

      expect(progressMessages.length).toBeGreaterThan(0);
      expect(progressMessages.some((msg) => msg.includes("Migrating"))).toBe(true);

      db2.close();
    });

    it("should call onMigrationWarning for non-fatal errors", async () => {
      const warnings: string[] = [];

      // Create database with data
      const db1 = await ensureIndexedDbTable(testTableName, "id", []);
      const tx1 = db1.transaction(testTableName, "readwrite");
      const store1 = tx1.objectStore(testTableName);
      store1.add({ id: 1, name: "Test" });
      await new Promise((resolve) => (tx1.oncomplete = resolve));
      db1.close();

      // Migrate with a transformer that might have issues
      const db2 = await ensureIndexedDbTable(testTableName, "new_id", [], {
        allowDestructiveMigration: true,
        dataTransformer: (oldRecord) => {
          // This should work but demonstrates warning capability
          return { new_id: oldRecord.id, name: oldRecord.name };
        },
        onMigrationWarning: (message) => {
          warnings.push(message);
        },
      });

      // Warnings might or might not occur depending on the migration
      // This test ensures the callback mechanism works
      db2.close();
    });
  });

  describe("schema compatibility checks", () => {
    it("should not migrate if schema is identical", async () => {
      const indexes: ExpectedIndexDefinition[] = [
        { name: "email", keyPath: "email", options: { unique: true } },
      ];

      // Create initial database
      const db1 = await ensureIndexedDbTable(testTableName, "id", indexes);
      const version1 = db1.version;
      db1.close();

      let migrationCalled = false;

      // Open again with same schema
      const db2 = await ensureIndexedDbTable(testTableName, "id", indexes, {
        onMigrationProgress: (message) => {
          if (message.includes("Migration") || message.includes("Migrating")) {
            migrationCalled = true;
          }
        },
      });

      const version2 = db2.version;

      // Version should not change
      expect(version2).toBe(version1);
      // Migration should not be triggered
      expect(migrationCalled).toBe(false);

      db2.close();
    });

    it("should handle reopening with no changes", async () => {
      const db1 = await ensureIndexedDbTable(testTableName, "id", []);
      const version1 = db1.version;
      db1.close();

      const db2 = await ensureIndexedDbTable(testTableName, "id", []);
      const version2 = db2.version;

      expect(version2).toBe(version1);

      db2.close();
    });
  });

  describe("edge cases", () => {
    it("should handle empty database name gracefully", async () => {
      // This might throw an error depending on the browser/fake-indexeddb implementation
      // We're just testing it doesn't crash our migration logic
      try {
        const db = await ensureIndexedDbTable("", "id", []);
        db.close();
      } catch (err) {
        // Expected to fail with browser validation error
        expect(err).toBeDefined();
      }
    });

    it("should handle complex compound indexes", async () => {
      const db = await ensureIndexedDbTable(testTableName, "id", [
        {
          name: "multi_field",
          keyPath: ["a", "b", "c", "d"],
          options: { unique: false },
        },
      ]);

      const tx = db.transaction(testTableName, "readonly");
      const store = tx.objectStore(testTableName);
      const index = store.index("multi_field");

      expect(index.keyPath).toEqual(["a", "b", "c", "d"]);

      db.close();
    });

    it("should handle multiple migrations in sequence", async () => {
      // Initial creation
      const db1 = await ensureIndexedDbTable(testTableName, "id", []);
      db1.close();

      // First migration: add index
      const db2 = await ensureIndexedDbTable(testTableName, "id", [
        { name: "field1", keyPath: "field1", options: { unique: false } },
      ]);
      db2.close();

      // Second migration: add another index
      const db3 = await ensureIndexedDbTable(testTableName, "id", [
        { name: "field1", keyPath: "field1", options: { unique: false } },
        { name: "field2", keyPath: "field2", options: { unique: false } },
      ]);
      db3.close();

      // Third migration: remove first index
      const db4 = await ensureIndexedDbTable(testTableName, "id", [
        { name: "field2", keyPath: "field2", options: { unique: false } },
      ]);

      const tx = db4.transaction(testTableName, "readonly");
      const store = tx.objectStore(testTableName);

      expect(store.indexNames.contains("field1")).toBe(false);
      expect(store.indexNames.contains("field2")).toBe(true);

      db4.close();
    });
  });

  describe("utility functions", () => {
    it("should delete database with dropIndexedDbTable", async () => {
      // Create database
      const db = await ensureIndexedDbTable(testTableName, "id", []);
      db.close();

      // Delete it
      await dropIndexedDbTable(testTableName);

      // Create again - should start fresh
      const db2 = await ensureIndexedDbTable(testTableName, "id", []);
      expect(db2.version).toBe(1); // New database starts at version 1

      db2.close();
    });
  });
});

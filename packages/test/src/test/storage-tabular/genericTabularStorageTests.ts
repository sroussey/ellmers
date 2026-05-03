/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { ITabularStorage } from "@workglow/storage";
import { DataPortSchemaObject, FromSchema } from "@workglow/util/schema";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

export const CompoundPrimaryKeyNames = ["name", "type"] as const;
export const CompoundSchema = {
  type: "object",
  properties: {
    name: { type: "string" },
    type: { type: "string" },
    option: { type: "string" },
    success: { type: "boolean" },
  },
  required: ["name", "type", "option", "success"],
  additionalProperties: false,
} as const satisfies DataPortSchemaObject;

export const SearchPrimaryKeyNames = ["id"] as const;
export const SearchSchema = {
  type: "object",
  properties: {
    id: { type: "string" },
    category: { type: "string" },
    subcategory: { type: "string" },
    kind: { type: "string" },
    value: { type: "number" },
    createdAt: { type: "string", format: "date-time" },
    updatedAt: { type: "string", format: "date-time" },
  },
  required: ["id", "category", "subcategory", "value", "createdAt", "updatedAt"],
  additionalProperties: false,
} as const satisfies DataPortSchemaObject;

export const NullableSearchPrimaryKeyNames = ["id"] as const;
export const NullableSearchSchema = {
  type: "object",
  properties: {
    id: { type: "string" },
    category: { type: "string" },
    subcategory: { type: "string" },
    value: { anyOf: [{ type: "number" }, { type: "null" }] },
    createdAt: { type: "string", format: "date-time" },
    updatedAt: { type: "string", format: "date-time" },
  },
  additionalProperties: false,
} as const satisfies DataPortSchemaObject;

export const AllTypesPrimaryKeyNames = ["id"] as const;
export const AllTypesSchema = {
  type: "object",
  properties: {
    id: { type: "string" },
    textField: { type: "string" },
    numberField: { type: "number" },
    integerField: { type: "integer" },
    booleanField: { type: "boolean" },
    arrayField: { type: "array", items: { type: "string" } },
    objectField: { type: "object", default: {} },
    nestedObjectField: { type: "object", default: {} },
  },
  required: [
    "id",
    "textField",
    "numberField",
    "integerField",
    "booleanField",
    "arrayField",
    "objectField",
    "nestedObjectField",
  ],
  additionalProperties: false,
} as const satisfies DataPortSchemaObject;

export const AutoIncrementPrimaryKeyNames = ["id"] as const;
export const AutoIncrementSchema = {
  type: "object",
  properties: {
    id: { type: "integer", "x-auto-generated": true },
    name: { type: "string" },
    email: { type: "string" },
  },
  required: ["id", "name", "email"],
  additionalProperties: false,
} as const satisfies DataPortSchemaObject;

export const UuidPrimaryKeyNames = ["id"] as const;
export const UuidSchema = {
  type: "object",
  properties: {
    id: { type: "string", "x-auto-generated": true },
    title: { type: "string" },
    content: { type: "string" },
  },
  required: ["id", "title", "content"],
  additionalProperties: false,
} as const satisfies DataPortSchemaObject;

export function runGenericTabularStorageTests(
  createCompoundPkRepository: () => Promise<
    ITabularStorage<typeof CompoundSchema, typeof CompoundPrimaryKeyNames>
  >,
  createSearchableRepository?: () => Promise<
    ITabularStorage<typeof SearchSchema, typeof SearchPrimaryKeyNames>
  >,
  createAllTypesRepository?: () => Promise<
    ITabularStorage<typeof AllTypesSchema, typeof AllTypesPrimaryKeyNames>
  >
) {
  describe("with compound primary keys", () => {
    let repository: ITabularStorage<typeof CompoundSchema, typeof CompoundPrimaryKeyNames>;

    beforeEach(async () => {
      repository = await createCompoundPkRepository();
      await repository.setupDatabase?.();
    });

    afterEach(async () => {
      await repository.deleteAll();
      repository.destroy();
    });

    it("should store and retrieve values for a key", async () => {
      const key = { name: "key1", type: "string1" };
      const entity = { ...key, option: "value1", success: true };
      await repository.put(entity);
      const output = await repository.get(key);

      expect(output?.option).toEqual("value1");
      expect(!!output?.success).toEqual(true);
    });

    it("should get undefined for a key that doesn't exist", async () => {
      const key = { name: "key", type: "string" };
      const output = await repository.get(key);

      expect(output == undefined).toEqual(true);
    });

    it("should store multiple entities using putBulk", async () => {
      const entities = [
        { name: "key1", type: "string1", option: "value1", success: true },
        { name: "key2", type: "string2", option: "value2", success: false },
        { name: "key3", type: "string3", option: "value3", success: true },
      ];

      await repository.putBulk(entities);

      for (const entity of entities) {
        const output = await repository.get({ name: entity.name, type: entity.type });
        expect(output?.option).toEqual(entity.option);
        expect(!!output?.success).toEqual(entity.success);
      }
    });

    it("should handle empty array in putBulk", async () => {
      await repository.putBulk([]);
      // Should not throw an error
    });

    it("should return the entity from put()", async () => {
      const key = { name: "key1", type: "string1" };
      const entity = { ...key, option: "value1", success: true };

      const returned = await repository.put(entity);

      // Verify returned entity matches what was stored
      expect(returned).toBeDefined();
      expect(returned.name).toEqual(entity.name);
      expect(returned.type).toEqual(entity.type);
      expect(returned.option).toEqual(entity.option);
      expect(!!returned.success).toEqual(entity.success);
    });

    it("should return updated entity from put() when upserting", async () => {
      const key = { name: "key1", type: "string1" };
      const entity1 = { ...key, option: "value1", success: true };
      const entity2 = { ...key, option: "value2", success: false };

      // First insert
      const returned1 = await repository.put(entity1);
      expect(returned1.option).toEqual("value1");
      expect(!!returned1.success).toEqual(true);

      // Update via upsert
      const returned2 = await repository.put(entity2);
      expect(returned2.option).toEqual("value2");
      expect(!!returned2.success).toEqual(false);

      // Verify database was updated
      const stored = await repository.get(key);
      expect(stored?.option).toEqual("value2");
      expect(!!stored?.success).toEqual(false);
    });

    it("should return array of entities from putBulk()", async () => {
      const entities = [
        { name: "key1", type: "string1", option: "value1", success: true },
        { name: "key2", type: "string2", option: "value2", success: false },
        { name: "key3", type: "string3", option: "value3", success: true },
      ];

      const returned = await repository.putBulk(entities);

      // Verify returned array matches input
      expect(returned).toBeDefined();
      expect(returned.length).toEqual(3);

      for (let i = 0; i < entities.length; i++) {
        expect(returned[i].name).toEqual(entities[i].name);
        expect(returned[i].type).toEqual(entities[i].type);
        expect(returned[i].option).toEqual(entities[i].option);
        expect(!!returned[i].success).toEqual(entities[i].success);
      }
    });

    it("should return empty array from putBulk() with empty input", async () => {
      const returned = await repository.putBulk([]);

      expect(returned).toBeDefined();
      expect(Array.isArray(returned)).toBe(true);
      expect(returned.length).toEqual(0);
    });
  });

  // Only run compound index tests if createCompoundRepository is provided
  if (createSearchableRepository) {
    describe("with searchable indexes", () => {
      let searchableRepo: ITabularStorage<typeof SearchSchema, typeof SearchPrimaryKeyNames>;

      beforeEach(async () => {
        searchableRepo = await createSearchableRepository();
        await searchableRepo.setupDatabase?.();
      });

      afterEach(async () => {
        await searchableRepo.deleteAll();
        searchableRepo.destroy();
      });

      it("should store and search using compound indexes", async () => {
        // Insert test data
        await searchableRepo.put({
          id: "1",
          category: "electronics",
          subcategory: "phones",
          value: 100,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        });
        await searchableRepo.put({
          id: "2",
          category: "electronics",
          subcategory: "laptops",
          value: 200,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        });
        await searchableRepo.put({
          id: "3",
          category: "books",
          subcategory: "fiction",
          value: 300,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        });
        // Test searching with single column
        const electronicsOnly = await searchableRepo.query({ category: "electronics" });
        expect(electronicsOnly?.length).toBe(2);
        expect(electronicsOnly?.map((item) => item.id).sort()).toEqual(["1", "2"]);

        // Test searching with compound criteria
        const electronicsPhones = await searchableRepo.query({
          category: "electronics",
          subcategory: "phones",
        });
        expect(electronicsPhones?.length).toBe(1);
        expect(electronicsPhones?.[0].id).toBe("1");

        // Test searching with non-existent values
        const nonExistent = await searchableRepo.query({
          category: "electronics",
          subcategory: "tablets",
        });
        expect(nonExistent).toBeUndefined();
      });

      it("should handle searching with multiple criteria in different orders", async () => {
        // Insert test data
        await searchableRepo.put({
          id: "1",
          category: "electronics",
          subcategory: "phones",
          value: 100,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        });
        await searchableRepo.put({
          id: "2",
          category: "electronics",
          subcategory: "phones",
          value: 200,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        });

        // Search with criteria in different orders should work the same
        const search1 = await searchableRepo.query({
          category: "electronics",
          subcategory: "phones",
        });
        const search2 = await searchableRepo.query({
          subcategory: "phones",
          category: "electronics",
        });

        expect(search1?.length).toBe(2);
        expect(search2?.length).toBe(2);
        expect(search1?.map((item) => item.id).sort()).toEqual(["1", "2"]);
        expect(search2?.map((item) => item.id).sort()).toEqual(["1", "2"]);
      });

      it("should handle partial matches with compound indexes", async () => {
        // Insert test data
        await searchableRepo.put({
          id: "1",
          category: "electronics",
          subcategory: "phones",
          value: 100,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        });
        await searchableRepo.put({
          id: "2",
          category: "electronics",
          subcategory: "phones",
          value: 200,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        });
        await searchableRepo.put({
          id: "3",
          category: "electronics",
          subcategory: "laptops",
          value: 300,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        });

        // Search with value field
        const highValue = await searchableRepo.query({ value: 300 });
        expect(highValue?.length).toBe(1);
        expect(highValue?.[0].id).toBe("3");

        // Search with multiple fields including a non-indexed one
        const expensivePhones = await searchableRepo.query({
          subcategory: "phones",
          value: 200,
        });
        expect(expensivePhones?.length).toBe(1);
        expect(expensivePhones?.[0].id).toBe("2");
      });
    });

    describe(`deleteSearch tests`, () => {
      let repository: ITabularStorage<typeof SearchSchema, typeof SearchPrimaryKeyNames>;

      beforeEach(async () => {
        repository = await createSearchableRepository();
        await repository.setupDatabase?.();
      });

      afterEach(async () => {
        await repository.deleteAll();
        repository.destroy();
      });

      it("should delete entries older than a specified date using createdAt", async () => {
        // Create test data with different dates
        const now = new Date();
        const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString();
        const twoDaysAgo = new Date(now.getTime() - 2 * 24 * 60 * 60 * 1000).toISOString();
        const threeDaysAgo = new Date(now.getTime() - 3 * 24 * 60 * 60 * 1000).toISOString();

        // Add test entries
        await repository.put({
          id: "1",
          category: "electronics",
          subcategory: "phones",
          value: 100,
          createdAt: now.toISOString(),
          updatedAt: now.toISOString(),
        });
        await repository.put({
          id: "2",
          category: "electronics",
          subcategory: "phones",
          value: 200,
          createdAt: yesterday,
          updatedAt: yesterday,
        });
        await repository.put({
          id: "3",
          category: "electronics",
          subcategory: "phones",
          value: 300,
          createdAt: twoDaysAgo,
          updatedAt: twoDaysAgo,
        });
        await repository.put({
          id: "4",
          category: "electronics",
          subcategory: "phones",
          value: 400,
          createdAt: threeDaysAgo,
          updatedAt: threeDaysAgo,
        });

        // Verify all entries were added
        expect((await repository.getAll())?.length).toBe(4);

        // Delete entries older than yesterday
        await repository.deleteSearch({ createdAt: { value: yesterday, operator: "<" } });

        // Verify only entries from yesterday and today remain
        const remaining = await repository.getAll();
        expect(remaining?.length).toBe(2);
        expect(remaining?.map((item) => item.id).sort()).toEqual(["1", "2"]);
      });

      it("should delete entries older than a specified date using updatedAt", async () => {
        // Create test data with different dates
        const now = new Date();
        const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString();
        const twoDaysAgo = new Date(now.getTime() - 2 * 24 * 60 * 60 * 1000).toISOString();

        // Add test entries with mixed dates
        await repository.put({
          id: "1",
          category: "electronics",
          subcategory: "phones",
          value: 100,
          createdAt: now.toISOString(),
          updatedAt: now.toISOString(),
        });
        await repository.put({
          id: "2",
          category: "electronics",
          subcategory: "phones",
          value: 200,
          createdAt: twoDaysAgo,
          updatedAt: now.toISOString(),
        });
        await repository.put({
          id: "3",
          category: "electronics",
          subcategory: "phones",
          value: 300,
          createdAt: now.toISOString(),
          updatedAt: twoDaysAgo,
        });
        await repository.put({
          id: "4",
          category: "electronics",
          subcategory: "phones",
          value: 400,
          createdAt: twoDaysAgo,
          updatedAt: twoDaysAgo,
        });

        // Verify all entries were added
        expect((await repository.getAll())?.length).toBe(4);

        // Delete entries with updatedAt older than yesterday
        await repository.deleteSearch({ updatedAt: { value: yesterday, operator: "<" } });

        // Verify only entries with recent updatedAt remain
        const remaining = await repository.getAll();
        expect(remaining?.length).toBe(2);
        expect(remaining?.map((item) => item.id).sort()).toEqual(["1", "2"]);
      });

      it("should handle empty repository gracefully", async () => {
        // Verify repository is empty
        expect(await repository.getAll()).toBeUndefined();

        const result = await repository.deleteSearch({
          createdAt: { value: new Date().toISOString(), operator: "<" },
        });
        expect(result).toBeUndefined();
      });

      it("should not delete entries when none are older than the specified date", async () => {
        // Create test data with recent dates
        const now = new Date();
        const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000);

        // Add test entries
        await repository.put({
          id: "1",
          category: "electronics",
          subcategory: "phones",
          value: 100,
          createdAt: now.toISOString(),
          updatedAt: now.toISOString(),
        });
        await repository.put({
          id: "2",
          category: "electronics",
          subcategory: "phones",
          value: 200,
          createdAt: now.toISOString(),
          updatedAt: yesterday.toISOString(),
        });
        // Try to delete entries older than 3 days ago
        const threeDaysAgo = new Date(now.getTime() - 3 * 24 * 60 * 60 * 1000).toISOString();
        await repository.deleteSearch({ createdAt: { value: threeDaysAgo, operator: "<" } });

        // Verify all entries still exist
        const remaining = await repository.getAll();
        expect(remaining?.length).toBe(2);
      });

      it("should delete entries with < operator", async () => {
        const now = new Date();

        await repository.put({
          id: "1",
          category: "electronics",
          subcategory: "phones",
          value: 100,
          createdAt: now.toISOString(),
          updatedAt: now.toISOString(),
        });
        await repository.put({
          id: "2",
          category: "electronics",
          subcategory: "phones",
          value: 200,
          createdAt: now.toISOString(),
          updatedAt: now.toISOString(),
        });
        await repository.put({
          id: "3",
          category: "electronics",
          subcategory: "phones",
          value: 300,
          createdAt: now.toISOString(),
          updatedAt: now.toISOString(),
        });

        await repository.deleteSearch({ value: { value: 200, operator: "<" } });
        const remaining = await repository.getAll();
        expect(remaining?.length).toBe(2);
        expect(remaining?.map((item) => item.id).sort()).toEqual(["2", "3"]);
      });

      it("should delete entries with <= operator", async () => {
        const now = new Date();

        await repository.put({
          id: "1",
          category: "electronics",
          subcategory: "phones",
          value: 100,
          createdAt: now.toISOString(),
          updatedAt: now.toISOString(),
        });
        await repository.put({
          id: "2",
          category: "electronics",
          subcategory: "phones",
          value: 200,
          createdAt: now.toISOString(),
          updatedAt: now.toISOString(),
        });
        await repository.put({
          id: "3",
          category: "electronics",
          subcategory: "phones",
          value: 300,
          createdAt: now.toISOString(),
          updatedAt: now.toISOString(),
        });

        await repository.deleteSearch({ value: { value: 200, operator: "<=" } });
        const remaining = await repository.getAll();
        expect(remaining?.length).toBe(1);
        expect(remaining?.[0].id).toBe("3");
      });

      it("should delete entries with > operator", async () => {
        const now = new Date();

        await repository.put({
          id: "1",
          category: "electronics",
          subcategory: "phones",
          value: 100,
          createdAt: now.toISOString(),
          updatedAt: now.toISOString(),
        });
        await repository.put({
          id: "2",
          category: "electronics",
          subcategory: "phones",
          value: 200,
          createdAt: now.toISOString(),
          updatedAt: now.toISOString(),
        });
        await repository.put({
          id: "3",
          category: "electronics",
          subcategory: "phones",
          value: 300,
          createdAt: now.toISOString(),
          updatedAt: now.toISOString(),
        });

        await repository.deleteSearch({ value: { value: 200, operator: ">" } });
        const remaining = await repository.getAll();
        expect(remaining?.length).toBe(2);
        expect(remaining?.map((item) => item.id).sort()).toEqual(["1", "2"]);
      });

      it("should delete entries with >= operator", async () => {
        const now = new Date();

        await repository.put({
          id: "1",
          category: "electronics",
          subcategory: "phones",
          value: 100,
          createdAt: now.toISOString(),
          updatedAt: now.toISOString(),
        });
        await repository.put({
          id: "2",
          category: "electronics",
          subcategory: "phones",
          value: 200,
          createdAt: now.toISOString(),
          updatedAt: now.toISOString(),
        });
        await repository.put({
          id: "3",
          category: "electronics",
          subcategory: "phones",
          value: 300,
          createdAt: now.toISOString(),
          updatedAt: now.toISOString(),
        });

        await repository.deleteSearch({ value: { value: 200, operator: ">=" } });
        const remaining = await repository.getAll();
        expect(remaining?.length).toBe(1);
        expect(remaining?.[0].id).toBe("1");
      });

      it("should handle = operator for exact matches", async () => {
        const now = new Date();

        await repository.put({
          id: "1",
          category: "electronics",
          subcategory: "phones",
          value: 100,
          createdAt: now.toISOString(),
          updatedAt: now.toISOString(),
        });
        await repository.put({
          id: "2",
          category: "electronics",
          subcategory: "phones",
          value: 200,
          createdAt: now.toISOString(),
          updatedAt: now.toISOString(),
        });
        await repository.put({
          id: "3",
          category: "electronics",
          subcategory: "phones",
          value: 200,
          createdAt: now.toISOString(),
          updatedAt: now.toISOString(),
        });

        await repository.deleteSearch({ value: 200 });

        const remaining = await repository.getAll();
        expect(remaining?.length).toBe(1);
        expect(remaining?.[0].id).toBe("1");
        expect(remaining?.[0].value).toBe(100);
      });

      it("should correctly handle null/undefined column values in comparisons", async () => {
        const now = new Date();

        await repository.put({
          id: "1",
          category: "electronics",
          subcategory: "phones",
          value: 100,
          createdAt: now.toISOString(),
          updatedAt: now.toISOString(),
        });
        await repository.put({
          id: "2",
          category: "electronics",
          subcategory: "phones",
          value: 200,
          createdAt: now.toISOString(),
          updatedAt: now.toISOString(),
        });
        await repository.put({
          id: "3",
          category: "electronics",
          subcategory: "phones",
          value: 300,
          createdAt: now.toISOString(),
          updatedAt: now.toISOString(),
        });

        await repository.deleteSearch({ value: { value: 200, operator: "<" } });

        const remaining = await repository.getAll();
        expect(remaining?.length).toBe(2);
        expect(remaining?.map((item) => item.id).sort()).toEqual(["2", "3"]);
      });

      it("should delete entries matching multiple criteria", async () => {
        const now = new Date();

        await repository.put({
          id: "1",
          category: "electronics",
          subcategory: "phones",
          value: 100,
          createdAt: now.toISOString(),
          updatedAt: now.toISOString(),
        });
        await repository.put({
          id: "2",
          category: "electronics",
          subcategory: "laptops",
          value: 200,
          createdAt: now.toISOString(),
          updatedAt: now.toISOString(),
        });
        await repository.put({
          id: "3",
          category: "books",
          subcategory: "fiction",
          value: 150,
          createdAt: now.toISOString(),
          updatedAt: now.toISOString(),
        });
        await repository.put({
          id: "4",
          category: "electronics",
          subcategory: "phones",
          value: 300,
          createdAt: now.toISOString(),
          updatedAt: now.toISOString(),
        });

        // Delete electronics with value >= 200
        await repository.deleteSearch({
          category: "electronics",
          value: { value: 200, operator: ">=" },
        });

        const remaining = await repository.getAll();
        expect(remaining?.length).toBe(2);
        expect(remaining?.map((item) => item.id).sort()).toEqual(["1", "3"]);
      });

      it("should delete entries matching multiple equality criteria", async () => {
        const now = new Date();

        await repository.put({
          id: "1",
          category: "electronics",
          subcategory: "phones",
          value: 100,
          createdAt: now.toISOString(),
          updatedAt: now.toISOString(),
        });
        await repository.put({
          id: "2",
          category: "electronics",
          subcategory: "phones",
          value: 200,
          createdAt: now.toISOString(),
          updatedAt: now.toISOString(),
        });
        await repository.put({
          id: "3",
          category: "electronics",
          subcategory: "laptops",
          value: 100,
          createdAt: now.toISOString(),
          updatedAt: now.toISOString(),
        });
        await repository.put({
          id: "4",
          category: "books",
          subcategory: "phones",
          value: 100,
          createdAt: now.toISOString(),
          updatedAt: now.toISOString(),
        });

        // Delete electronics phones
        await repository.deleteSearch({
          category: "electronics",
          subcategory: "phones",
        });

        const remaining = await repository.getAll();
        expect(remaining?.length).toBe(2);
        expect(remaining?.map((item) => item.id).sort()).toEqual(["3", "4"]);
      });
    });

    describe(`query tests`, () => {
      let repository: ITabularStorage<typeof SearchSchema, typeof SearchPrimaryKeyNames>;

      beforeEach(async () => {
        repository = await createSearchableRepository();
        await repository.setupDatabase?.();
      });

      afterEach(async () => {
        await repository.deleteAll();
        repository.destroy();
      });

      it("should return matching entries with equality criteria", async () => {
        const now = new Date().toISOString();
        await repository.put({
          id: "1",
          category: "electronics",
          subcategory: "phones",
          value: 100,
          createdAt: now,
          updatedAt: now,
        });
        await repository.put({
          id: "2",
          category: "books",
          subcategory: "fiction",
          value: 200,
          createdAt: now,
          updatedAt: now,
        });

        const results = await repository.query({ category: "electronics" });
        expect(results?.length).toBe(1);
        expect(results?.[0].id).toBe("1");
      });

      it("should return entries matching comparison operators", async () => {
        const now = new Date().toISOString();
        await repository.put({
          id: "1",
          category: "electronics",
          subcategory: "phones",
          value: 100,
          createdAt: now,
          updatedAt: now,
        });
        await repository.put({
          id: "2",
          category: "electronics",
          subcategory: "laptops",
          value: 200,
          createdAt: now,
          updatedAt: now,
        });
        await repository.put({
          id: "3",
          category: "electronics",
          subcategory: "tablets",
          value: 300,
          createdAt: now,
          updatedAt: now,
        });

        const lessThan = await repository.query({ value: { value: 200, operator: "<" } });
        expect(lessThan?.length).toBe(1);
        expect(lessThan?.[0].id).toBe("1");

        const lessOrEqual = await repository.query({ value: { value: 200, operator: "<=" } });
        expect(lessOrEqual?.length).toBe(2);
        expect(lessOrEqual?.map((r) => r.id).sort()).toEqual(["1", "2"]);

        const greaterThan = await repository.query({ value: { value: 200, operator: ">" } });
        expect(greaterThan?.length).toBe(1);
        expect(greaterThan?.[0].id).toBe("3");

        const greaterOrEqual = await repository.query({
          value: { value: 200, operator: ">=" },
        });
        expect(greaterOrEqual?.length).toBe(2);
        expect(greaterOrEqual?.map((r) => r.id).sort()).toEqual(["2", "3"]);
      });

      it("should order results by ASC", async () => {
        const now = new Date().toISOString();
        await repository.put({
          id: "1",
          category: "a",
          subcategory: "x",
          value: 300,
          createdAt: now,
          updatedAt: now,
        });
        await repository.put({
          id: "2",
          category: "a",
          subcategory: "x",
          value: 100,
          createdAt: now,
          updatedAt: now,
        });
        await repository.put({
          id: "3",
          category: "a",
          subcategory: "x",
          value: 200,
          createdAt: now,
          updatedAt: now,
        });

        const results = await repository.getAll({
          orderBy: [{ column: "value", direction: "ASC" }],
        });
        expect(results?.length).toBe(3);
        expect(results?.map((r) => r.value)).toEqual([100, 200, 300]);
      });

      it("should order results by DESC", async () => {
        const now = new Date().toISOString();
        await repository.put({
          id: "1",
          category: "a",
          subcategory: "x",
          value: 300,
          createdAt: now,
          updatedAt: now,
        });
        await repository.put({
          id: "2",
          category: "a",
          subcategory: "x",
          value: 100,
          createdAt: now,
          updatedAt: now,
        });
        await repository.put({
          id: "3",
          category: "a",
          subcategory: "x",
          value: 200,
          createdAt: now,
          updatedAt: now,
        });

        const results = await repository.getAll({
          orderBy: [{ column: "value", direction: "DESC" }],
        });
        expect(results?.length).toBe(3);
        expect(results?.map((r) => r.value)).toEqual([300, 200, 100]);
      });

      it("should limit results", async () => {
        const now = new Date().toISOString();
        await repository.put({
          id: "1",
          category: "a",
          subcategory: "x",
          value: 100,
          createdAt: now,
          updatedAt: now,
        });
        await repository.put({
          id: "2",
          category: "a",
          subcategory: "x",
          value: 200,
          createdAt: now,
          updatedAt: now,
        });
        await repository.put({
          id: "3",
          category: "a",
          subcategory: "x",
          value: 300,
          createdAt: now,
          updatedAt: now,
        });

        const results = await repository.getAll({
          orderBy: [{ column: "value", direction: "ASC" }],
          limit: 2,
        });
        expect(results?.length).toBe(2);
        expect(results?.map((r) => r.value)).toEqual([100, 200]);
      });

      it("should combine criteria, orderBy, and limit", async () => {
        const now = new Date().toISOString();
        await repository.put({
          id: "1",
          category: "electronics",
          subcategory: "phones",
          value: 100,
          createdAt: now,
          updatedAt: now,
        });
        await repository.put({
          id: "2",
          category: "electronics",
          subcategory: "laptops",
          value: 200,
          createdAt: now,
          updatedAt: now,
        });
        await repository.put({
          id: "3",
          category: "electronics",
          subcategory: "tablets",
          value: 300,
          createdAt: now,
          updatedAt: now,
        });
        await repository.put({
          id: "4",
          category: "books",
          subcategory: "fiction",
          value: 50,
          createdAt: now,
          updatedAt: now,
        });

        const results = await repository.query(
          { category: "electronics" },
          { orderBy: [{ column: "value", direction: "DESC" }], limit: 2 }
        );
        expect(results?.length).toBe(2);
        expect(results?.map((r) => r.value)).toEqual([300, 200]);
      });

      it("should return all entries with getAll and orderBy", async () => {
        const now = new Date().toISOString();
        await repository.put({
          id: "1",
          category: "b",
          subcategory: "x",
          value: 200,
          createdAt: now,
          updatedAt: now,
        });
        await repository.put({
          id: "2",
          category: "a",
          subcategory: "x",
          value: 100,
          createdAt: now,
          updatedAt: now,
        });

        const results = await repository.getAll({
          orderBy: [{ column: "category", direction: "ASC" }],
        });
        expect(results?.length).toBe(2);
        expect(results?.map((r) => r.category)).toEqual(["a", "b"]);
      });

      it("should return undefined when no matches found", async () => {
        const now = new Date().toISOString();
        await repository.put({
          id: "1",
          category: "electronics",
          subcategory: "phones",
          value: 100,
          createdAt: now,
          updatedAt: now,
        });

        const results = await repository.query({ category: "nonexistent" });
        expect(results).toBeUndefined();
      });
    });

    describe("queryIndex (covering-index-only reads)", () => {
      let repository: ITabularStorage<typeof SearchSchema, typeof SearchPrimaryKeyNames>;

      beforeEach(async () => {
        repository = await createSearchableRepository();
        await repository.setupDatabase?.();
      });

      afterEach(async () => {
        await repository.deleteAll();
        repository.destroy();
      });

      it("returns rows projected to only the requested columns", async () => {
        await repository.put({
          id: "1",
          category: "a",
          subcategory: "x",
          value: 10,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        });
        const rows = await repository.queryIndex(
          { category: "a" },
          { select: ["id", "category"] }
        );
        expect(rows).toHaveLength(1);
        expect(Object.keys(rows[0]).sort()).toEqual(["category", "id"]);
      });

      it("throws when no covering index exists for the criteria column", async () => {
        // `kind` is not in any of the registered indexes
        await expect(
          repository.queryIndex({ kind: "premium" } as any, { select: ["id"] })
        ).rejects.toThrow(/CoveringIndexMissingError|No covering index/);
      });

      it("returns empty array (not undefined) for no matches", async () => {
        const rows = await repository.queryIndex(
          { category: "missing" },
          { select: ["id"] }
        );
        expect(rows).toEqual([]);
      });

      it("honors limit and offset", async () => {
        for (let i = 0; i < 5; i++) {
          await repository.put({
            id: String(i),
            category: "a",
            subcategory: String(i),
            value: i,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          });
        }
        const rows = await repository.queryIndex(
          { category: "a" },
          {
            select: ["id", "subcategory"],
            orderBy: [{ column: "subcategory", direction: "ASC" }],
            limit: 2,
            offset: 1,
          }
        );
        expect(rows).toHaveLength(2);
        expect(rows[0].subcategory).toBe("1");
        expect(rows[1].subcategory).toBe("2");
      });
    });

    describe(`count tests`, () => {
      let repository: ITabularStorage<typeof SearchSchema, typeof SearchPrimaryKeyNames>;

      const seed = async () => {
        const now = new Date().toISOString();
        await repository.putBulk([
          {
            id: "1",
            category: "electronics",
            subcategory: "phones",
            kind: "premium",
            value: 100,
            createdAt: now,
            updatedAt: now,
          },
          {
            id: "2",
            category: "electronics",
            subcategory: "phones",
            kind: "budget",
            value: 200,
            createdAt: now,
            updatedAt: now,
          },
          {
            id: "3",
            category: "electronics",
            subcategory: "laptops",
            kind: "premium",
            value: 300,
            createdAt: now,
            updatedAt: now,
          },
          {
            id: "4",
            category: "books",
            subcategory: "fiction",
            kind: "premium",
            value: 400,
            createdAt: now,
            updatedAt: now,
          },
        ]);
      };

      beforeEach(async () => {
        repository = await createSearchableRepository();
        await repository.setupDatabase?.();
      });

      afterEach(async () => {
        await repository.deleteAll();
        repository.destroy();
      });

      it("should return total count with no criteria", async () => {
        await seed();
        expect(await repository.count()).toBe(4);
      });

      it("should match size() with no criteria", async () => {
        await seed();
        expect(await repository.count()).toBe(await repository.size());
      });

      it("should count with equality on single indexed column", async () => {
        await seed();
        expect(await repository.count({ category: "electronics" })).toBe(3);
        expect(await repository.count({ category: "books" })).toBe(1);
      });

      it("should count with equality on a compound index prefix (covered)", async () => {
        await seed();
        expect(await repository.count({ category: "electronics", subcategory: "phones" })).toBe(2);
      });

      it("should count when criteria mixes indexed and non-indexed columns", async () => {
        // `kind` is not in the indexes configured by the IndexedDb test setup,
        // so this exercises the partial-index narrowing path: narrow on
        // `category`, filter `kind` in JS.
        await seed();
        expect(await repository.count({ category: "electronics", kind: "premium" })).toBe(2);
        expect(await repository.count({ category: "electronics", kind: "budget" })).toBe(1);
      });

      it("should count with comparison operators", async () => {
        await seed();
        expect(await repository.count({ value: { value: 200, operator: "<" } })).toBe(1);
        expect(await repository.count({ value: { value: 200, operator: "<=" } })).toBe(2);
        expect(await repository.count({ value: { value: 200, operator: ">" } })).toBe(2);
        expect(await repository.count({ value: { value: 200, operator: ">=" } })).toBe(3);
      });

      it("should return 0 when no rows match", async () => {
        await seed();
        expect(await repository.count({ category: "nonexistent" })).toBe(0);
      });

      it("should return 0 on empty repository", async () => {
        expect(await repository.count({ category: "electronics" })).toBe(0);
      });
    });

    describe("return value tests with timestamps", () => {
      let repository: ITabularStorage<typeof SearchSchema, typeof SearchPrimaryKeyNames>;

      beforeEach(async () => {
        repository = await createSearchableRepository();
        await repository.setupDatabase?.();
      });

      afterEach(async () => {
        await repository.deleteAll();
        repository.destroy();
      });

      it("should return entity with timestamps from put()", async () => {
        const now = new Date().toISOString();
        const entity = {
          id: "1",
          category: "electronics",
          subcategory: "phones",
          value: 100,
          createdAt: now,
          updatedAt: now,
        };

        const returned = await repository.put(entity);

        // Verify all fields are returned
        expect(returned).toBeDefined();
        expect(returned.id).toEqual("1");
        expect(returned.category).toEqual("electronics");
        expect(returned.subcategory).toEqual("phones");
        expect(returned.value).toEqual(100);
        expect(returned.createdAt).toBeDefined();
        expect(returned.updatedAt).toBeDefined();
      });

      it("should return entities with timestamps from putBulk()", async () => {
        const now = new Date().toISOString();
        const entities = [
          {
            id: "1",
            category: "electronics",
            subcategory: "phones",
            value: 100,
            createdAt: now,
            updatedAt: now,
          },
          {
            id: "2",
            category: "books",
            subcategory: "fiction",
            value: 200,
            createdAt: now,
            updatedAt: now,
          },
        ];

        const returned = await repository.putBulk(entities);

        // Verify all entities are returned with all fields
        expect(returned).toBeDefined();
        expect(returned.length).toEqual(2);

        for (let i = 0; i < entities.length; i++) {
          expect(returned[i].id).toEqual(entities[i].id);
          expect(returned[i].category).toEqual(entities[i].category);
          expect(returned[i].subcategory).toEqual(entities[i].subcategory);
          expect(returned[i].value).toEqual(entities[i].value);
          expect(returned[i].createdAt).toBeDefined();
          expect(returned[i].updatedAt).toBeDefined();
        }
      });

      it("should return updated timestamps when upserting", async () => {
        const now = new Date().toISOString();
        const entity1 = {
          id: "1",
          category: "electronics",
          subcategory: "phones",
          value: 100,
          createdAt: now,
          updatedAt: now,
        };

        // First insert
        const returned1 = await repository.put(entity1);
        expect(returned1.value).toEqual(100);

        // Wait a moment to ensure timestamps would differ
        await new Promise((resolve) => setTimeout(resolve, 10));

        // Update with new data
        const later = new Date().toISOString();
        const entity2 = {
          id: "1",
          category: "electronics",
          subcategory: "phones",
          value: 150,
          createdAt: now, // Keep original created time
          updatedAt: later, // New update time
        };

        const returned2 = await repository.put(entity2);
        expect(returned2.value).toEqual(150);
        expect(returned2.updatedAt).toBeDefined();

        // Verify the update persisted
        const stored = await repository.get({ id: "1" });
        expect(stored?.value).toEqual(150);
      });

      it("should return consistent data between put() result and get()", async () => {
        const now = new Date().toISOString();
        const entity = {
          id: "1",
          category: "electronics",
          subcategory: "phones",
          value: 100,
          createdAt: now,
          updatedAt: now,
        };

        const returned = await repository.put(entity);
        const retrieved = await repository.get({ id: "1" });

        // Verify returned and retrieved match
        expect(retrieved).toBeDefined();
        expect(returned.id).toEqual(retrieved!.id);
        expect(returned.category).toEqual(retrieved!.category);
        expect(returned.subcategory).toEqual(retrieved!.subcategory);
        expect(returned.value).toEqual(retrieved!.value);
        expect(returned.createdAt).toEqual(retrieved!.createdAt);
        expect(returned.updatedAt).toEqual(retrieved!.updatedAt);
      });

      it("should return consistent data between putBulk() results and getAll()", async () => {
        const now = new Date().toISOString();
        const entities = [
          {
            id: "1",
            category: "electronics",
            subcategory: "phones",
            value: 100,
            createdAt: now,
            updatedAt: now,
          },
          {
            id: "2",
            category: "books",
            subcategory: "fiction",
            value: 200,
            createdAt: now,
            updatedAt: now,
          },
        ];

        const returned = await repository.putBulk(entities);
        const retrieved = await repository.getAll();

        // Verify returned and retrieved match
        expect(retrieved).toBeDefined();
        expect(returned.length).toEqual(retrieved!.length);

        // Sort both arrays by id for comparison
        const sortedReturned = returned.sort((a, b) => (a.id ?? "").localeCompare(b.id ?? ""));
        const sortedRetrieved = retrieved!.sort((a, b) => (a.id ?? "").localeCompare(b.id ?? ""));

        for (let i = 0; i < sortedReturned.length; i++) {
          expect(sortedReturned[i].id).toEqual(sortedRetrieved[i].id);
          expect(sortedReturned[i].category).toEqual(sortedRetrieved[i].category);
          expect(sortedReturned[i].subcategory).toEqual(sortedRetrieved[i].subcategory);
          expect(sortedReturned[i].value).toEqual(sortedRetrieved[i].value);
          expect(sortedReturned[i].createdAt).toEqual(sortedRetrieved[i].createdAt);
          expect(sortedReturned[i].updatedAt).toEqual(sortedRetrieved[i].updatedAt);
        }
      });
    });
  }

  if (createAllTypesRepository) {
    describe("data type coverage", () => {
      type AllTypesRecord = FromSchema<typeof AllTypesSchema>;
      let repository: ITabularStorage<typeof AllTypesSchema, typeof AllTypesPrimaryKeyNames>;

      beforeEach(async () => {
        repository = await createAllTypesRepository();
        await repository.setupDatabase?.();
      });

      afterEach(async () => {
        await repository.deleteAll();
        repository.destroy();
      });

      it("should store and retrieve all data types correctly", async () => {
        const entity: AllTypesRecord = {
          id: "test-1",
          textField: "Hello, World!",
          numberField: 3.14159,
          integerField: 42,
          booleanField: true,
          arrayField: ["item1", "item2", "item3"],
          objectField: {
            key1: "value1",
            key2: 123,
          },
          nestedObjectField: {
            level1: {
              level2: {
                nested: "value",
                count: 456,
              },
            },
          },
        };

        // Store the entity
        const stored = await repository.put(entity);
        expect(stored).toBeDefined();

        // Retrieve the entity
        const retrieved = await repository.get({ id: "test-1" });
        expect(retrieved).toBeDefined();

        // Verify all data types are preserved correctly
        expect(retrieved?.id).toBe("test-1");
        expect(retrieved?.textField).toBe("Hello, World!");
        expect(retrieved?.numberField).toBe(3.14159);
        expect(retrieved?.integerField).toBe(42);
        expect(retrieved?.booleanField).toBe(true);
        expect(retrieved?.arrayField).toEqual(["item1", "item2", "item3"]);
        expect(retrieved?.objectField).toEqual({
          key1: "value1",
          key2: 123,
        });
        expect(retrieved?.nestedObjectField).toEqual({
          level1: {
            level2: {
              nested: "value",
              count: 456,
            },
          },
        });
      });

      it("should handle boolean false correctly", async () => {
        const entity: AllTypesRecord = {
          id: "test-false",
          textField: "Test",
          numberField: 0,
          integerField: 0,
          booleanField: false,
          arrayField: [],
          objectField: {},
          nestedObjectField: {},
        };

        await repository.put(entity);
        const retrieved = await repository.get({ id: "test-false" });

        expect(retrieved?.booleanField).toBe(false);
        expect(retrieved?.arrayField).toEqual([]);
        expect(retrieved?.objectField).toEqual({});
      });

      it("should handle complex arrays and objects", async () => {
        const entity: AllTypesRecord = {
          id: "test-complex",
          textField: "Complex data",
          numberField: -123.456,
          integerField: -999,
          booleanField: true,
          arrayField: ["string1", "string2", "string with spaces", ""],
          objectField: {
            stringProp: "value",
            numberProp: 789,
            booleanProp: true,
            arrayProp: [1, 2, 3],
            nestedProp: {
              deep: "nested value",
            },
          },
          nestedObjectField: {
            metadata: {
              tags: ["tag1", "tag2"],
              count: 10,
            },
            config: {
              enabled: true,
              threshold: 0.5,
            },
          },
        };

        await repository.put(entity);
        const retrieved = await repository.get({ id: "test-complex" });

        expect(retrieved?.arrayField).toEqual(["string1", "string2", "string with spaces", ""]);
        expect(retrieved?.objectField).toEqual({
          stringProp: "value",
          numberProp: 789,
          booleanProp: true,
          arrayProp: [1, 2, 3],
          nestedProp: {
            deep: "nested value",
          },
        });
        expect(retrieved?.nestedObjectField).toEqual({
          metadata: {
            tags: ["tag1", "tag2"],
            count: 10,
          },
          config: {
            enabled: true,
            threshold: 0.5,
          },
        });
      });

      it("should handle bulk operations with all data types", async () => {
        const entities: AllTypesRecord[] = [
          {
            id: "bulk-1",
            textField: "First",
            numberField: 1.1,
            integerField: 1,
            booleanField: true,
            arrayField: ["a"],
            objectField: { x: 1 },
            nestedObjectField: {},
          },
          {
            id: "bulk-2",
            textField: "Second",
            numberField: 2.2,
            integerField: 2,
            booleanField: false,
            arrayField: ["b", "c"],
            objectField: { y: 2 },
            nestedObjectField: { nested: "value" },
          },
        ];

        await repository.putBulk(entities);

        const retrieved1 = await repository.get({ id: "bulk-1" });
        const retrieved2 = await repository.get({ id: "bulk-2" });

        expect(retrieved1?.booleanField).toBe(true);
        expect(retrieved2?.booleanField).toBe(false);
        expect(retrieved1?.arrayField).toEqual(["a"]);
        expect(retrieved2?.arrayField).toEqual(["b", "c"]);
        expect(retrieved1?.objectField).toEqual({ x: 1 });
        expect(retrieved2?.nestedObjectField).toEqual({ nested: "value" });
      });
    });
  }

  // Iteration methods tests
  describe("iteration methods", () => {
    let repository: ITabularStorage<typeof CompoundSchema, typeof CompoundPrimaryKeyNames>;

    beforeEach(async () => {
      repository = await createCompoundPkRepository();
      await repository.setupDatabase?.();
    });

    afterEach(async () => {
      await repository.deleteAll();
      repository.destroy();
    });

    describe("getBulk", () => {
      it("should return undefined for empty table", async () => {
        const result = await repository.getBulk(0, 10);
        expect(result).toBeUndefined();
      });

      it("should fetch a full page of records", async () => {
        // Insert 5 records
        const entities = [
          { name: "key1", type: "type1", option: "value1", success: true },
          { name: "key2", type: "type2", option: "value2", success: false },
          { name: "key3", type: "type3", option: "value3", success: true },
          { name: "key4", type: "type4", option: "value4", success: false },
          { name: "key5", type: "type5", option: "value5", success: true },
        ];
        await repository.putBulk(entities);

        const result = await repository.getBulk(0, 5);
        expect(result).toBeDefined();
        expect(result!.length).toBe(5);
      });

      it("should fetch a partial page when less records available", async () => {
        // Insert 3 records
        const entities = [
          { name: "key1", type: "type1", option: "value1", success: true },
          { name: "key2", type: "type2", option: "value2", success: false },
          { name: "key3", type: "type3", option: "value3", success: true },
        ];
        await repository.putBulk(entities);

        const result = await repository.getBulk(0, 10);
        expect(result).toBeDefined();
        expect(result!.length).toBe(3);
      });

      it("should handle offset correctly", async () => {
        // Insert 5 records out of order to ensure deterministic pagination
        const entities = [
          { name: "key3", type: "type3", option: "value3", success: true },
          { name: "key1", type: "type1", option: "value1", success: true },
          { name: "key5", type: "type5", option: "value5", success: true },
          { name: "key2", type: "type2", option: "value2", success: false },
          { name: "key4", type: "type4", option: "value4", success: false },
        ];
        await repository.putBulk(entities);

        const result = await repository.getBulk(2, 2);
        expect(result).toBeDefined();
        expect(result!.length).toBe(2);
        // Assuming deterministic ordering by primary key (name, then type),
        // the sorted order is key1, key2, key3, key4, key5.
        // With offset=2 and limit=2, we expect key3 and key4.
        expect(result![0].name).toBe("key3");
        expect(result![0].type).toBe("type3");
        expect(result![1].name).toBe("key4");
        expect(result![1].type).toBe("type4");
      });

      it("should return undefined when offset is beyond end", async () => {
        // Insert 3 records
        const entities = [
          { name: "key1", type: "type1", option: "value1", success: true },
          { name: "key2", type: "type2", option: "value2", success: false },
          { name: "key3", type: "type3", option: "value3", success: true },
        ];
        await repository.putBulk(entities);

        const result = await repository.getBulk(10, 5);
        expect(result).toBeUndefined();
      });

      it("should handle limit of 1", async () => {
        // Insert 3 records
        const entities = [
          { name: "key1", type: "type1", option: "value1", success: true },
          { name: "key2", type: "type2", option: "value2", success: false },
          { name: "key3", type: "type3", option: "value3", success: true },
        ];
        await repository.putBulk(entities);

        const result = await repository.getBulk(0, 1);
        expect(result).toBeDefined();
        expect(result!.length).toBe(1);
      });
    });

    describe("records", () => {
      it("should yield all records one by one", async () => {
        // Insert 5 records
        const entities = [
          { name: "key1", type: "type1", option: "value1", success: true },
          { name: "key2", type: "type2", option: "value2", success: false },
          { name: "key3", type: "type3", option: "value3", success: true },
          { name: "key4", type: "type4", option: "value4", success: false },
          { name: "key5", type: "type5", option: "value5", success: true },
        ];
        await repository.putBulk(entities);

        const collected: any[] = [];
        for await (const record of repository.records(2)) {
          collected.push(record);
        }

        expect(collected.length).toBe(5);
      });

      it("should handle empty table", async () => {
        const collected: any[] = [];
        for await (const record of repository.records()) {
          collected.push(record);
        }

        expect(collected.length).toBe(0);
      });

      it("should use custom page size", async () => {
        // Insert 10 records
        const entities = Array.from({ length: 10 }, (_, i) => ({
          name: `key${i}`,
          type: `type${i}`,
          option: `value${i}`,
          success: i % 2 === 0,
        }));
        await repository.putBulk(entities);

        const collected: any[] = [];
        for await (const record of repository.records(3)) {
          collected.push(record);
        }

        expect(collected.length).toBe(10);
      });

      it("should yield all records with correct properties", async () => {
        // Insert 3 records
        const entities = [
          { name: "key1", type: "type1", option: "value1", success: true },
          { name: "key2", type: "type2", option: "value2", success: false },
          { name: "key3", type: "type3", option: "value3", success: true },
        ];
        await repository.putBulk(entities);

        const collected: any[] = [];
        for await (const record of repository.records()) {
          collected.push(record);
        }

        expect(collected.length).toBe(3);
        // Verify records have expected structure
        for (const record of collected) {
          expect(record).toHaveProperty("name");
          expect(record).toHaveProperty("type");
          expect(record).toHaveProperty("option");
          expect(record).toHaveProperty("success");
        }
      });
    });

    describe("pages", () => {
      it("should yield all pages", async () => {
        // Insert 10 records
        const entities = Array.from({ length: 10 }, (_, i) => ({
          name: `key${i}`,
          type: `type${i}`,
          option: `value${i}`,
          success: i % 2 === 0,
        }));
        await repository.putBulk(entities);

        const pages: any[][] = [];
        for await (const page of repository.pages(3)) {
          pages.push(page);
        }

        // With pageSize=3 and 10 records: 3, 3, 3, 1 = 4 pages
        expect(pages.length).toBe(4);
        expect(pages[0].length).toBe(3);
        expect(pages[1].length).toBe(3);
        expect(pages[2].length).toBe(3);
        expect(pages[3].length).toBe(1);

        // Verify total records
        const totalRecords = pages.reduce((sum, page) => sum + page.length, 0);
        expect(totalRecords).toBe(10);
      });

      it("should handle empty table", async () => {
        const pages: any[][] = [];
        for await (const page of repository.pages(5)) {
          pages.push(page);
        }

        expect(pages.length).toBe(0);
      });

      it("should yield single page when all records fit", async () => {
        // Insert 3 records
        const entities = [
          { name: "key1", type: "type1", option: "value1", success: true },
          { name: "key2", type: "type2", option: "value2", success: false },
          { name: "key3", type: "type3", option: "value3", success: true },
        ];
        await repository.putBulk(entities);

        const pages: any[][] = [];
        for await (const page of repository.pages(10)) {
          pages.push(page);
        }

        expect(pages.length).toBe(1);
        expect(pages[0].length).toBe(3);
      });

      it("should yield exact pages when records divide evenly", async () => {
        // Insert 9 records
        const entities = Array.from({ length: 9 }, (_, i) => ({
          name: `key${i}`,
          type: `type${i}`,
          option: `value${i}`,
          success: i % 2 === 0,
        }));
        await repository.putBulk(entities);

        const pages: any[][] = [];
        for await (const page of repository.pages(3)) {
          pages.push(page);
        }

        // With pageSize=3 and 9 records: 3, 3, 3 = 3 pages
        expect(pages.length).toBe(3);
        expect(pages[0].length).toBe(3);
        expect(pages[1].length).toBe(3);
        expect(pages[2].length).toBe(3);
      });
    });
  });
}

/**
 * Tests for auto-generated keys functionality
 */
export function runAutoGeneratedKeyTests(
  createAutoIncrementRepository: () => Promise<
    ITabularStorage<typeof AutoIncrementSchema, typeof AutoIncrementPrimaryKeyNames>
  >,
  createUuidRepository: () => Promise<
    ITabularStorage<typeof UuidSchema, typeof UuidPrimaryKeyNames>
  >
) {
  describe("Auto-Generated Keys", () => {
    describe("AutoIncrement Strategy", () => {
      let repository: ITabularStorage<
        typeof AutoIncrementSchema,
        typeof AutoIncrementPrimaryKeyNames
      >;

      beforeEach(async () => {
        repository = await createAutoIncrementRepository();
        await repository.setupDatabase?.();
      });

      afterEach(async () => {
        await repository.deleteAll();
        repository.destroy();
      });

      it("should auto-generate integer ID when not provided", async () => {
        const entity = { name: "Test User", email: "test@example.com" };
        const result = await repository.put(entity as any);

        expect(result.id).toBeDefined();
        expect(typeof result.id).toBe("number");
        expect(result.name).toBe("Test User");
        expect(result.email).toBe("test@example.com");
      });

      it("should auto-generate sequential IDs", async () => {
        const entity1 = { name: "User 1", email: "user1@example.com" };
        const entity2 = { name: "User 2", email: "user2@example.com" };
        const entity3 = { name: "User 3", email: "user3@example.com" };

        const result1 = await repository.put(entity1 as any);
        const result2 = await repository.put(entity2 as any);
        const result3 = await repository.put(entity3 as any);

        expect(result1.id).toBeDefined();
        expect(result2.id).toBeDefined();
        expect(result3.id).toBeDefined();

        // IDs should be sequential (though we don't enforce specific values)
        expect(result2.id).toBeGreaterThan(result1.id);
        expect(result3.id).toBeGreaterThan(result2.id);
      });

      it("should handle putBulk with auto-generated IDs", async () => {
        const entities = [
          { name: "Bulk 1", email: "bulk1@example.com" },
          { name: "Bulk 2", email: "bulk2@example.com" },
          { name: "Bulk 3", email: "bulk3@example.com" },
        ];

        const results = await repository.putBulk(entities as any);

        expect(results).toHaveLength(3);
        for (const result of results) {
          expect(result.id).toBeDefined();
          expect(typeof result.id).toBe("number");
        }
      });

      it("should retrieve entity by auto-generated ID", async () => {
        const entity = { name: "Retrievable", email: "retrieve@example.com" };
        const inserted = await repository.put(entity as any);

        const retrieved = await repository.get({ id: inserted.id });

        expect(retrieved).toBeDefined();
        expect(retrieved!.id).toBe(inserted.id);
        expect(retrieved!.name).toBe("Retrievable");
        expect(retrieved!.email).toBe("retrieve@example.com");
      });
    });

    describe("UUID Strategy", () => {
      let repository: ITabularStorage<typeof UuidSchema, typeof UuidPrimaryKeyNames>;

      beforeEach(async () => {
        repository = await createUuidRepository();
        await repository.setupDatabase?.();
      });

      afterEach(async () => {
        await repository.deleteAll();
        repository.destroy();
      });

      it("should auto-generate UUID when not provided", async () => {
        const entity = { title: "Test Doc", content: "Test content" };
        const result = await repository.put(entity as any);

        expect(result.id).toBeDefined();
        expect(typeof result.id).toBe("string");
        expect(result.id.length).toBeGreaterThan(0);
        // UUID v4 format check (loose)
        expect(result.id).toMatch(
          /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
        );
        expect(result.title).toBe("Test Doc");
        expect(result.content).toBe("Test content");
      });

      it("should generate unique UUIDs", async () => {
        const entity1 = { title: "Doc 1", content: "Content 1" };
        const entity2 = { title: "Doc 2", content: "Content 2" };

        const result1 = await repository.put(entity1 as any);
        const result2 = await repository.put(entity2 as any);

        expect(result1.id).toBeDefined();
        expect(result2.id).toBeDefined();
        expect(result1.id).not.toBe(result2.id);
      });

      it("should handle putBulk with auto-generated UUIDs", async () => {
        const entities = [
          { title: "Bulk Doc 1", content: "Bulk content 1" },
          { title: "Bulk Doc 2", content: "Bulk content 2" },
          { title: "Bulk Doc 3", content: "Bulk content 3" },
        ];

        const results = await repository.putBulk(entities as any);

        expect(results).toHaveLength(3);
        const ids = new Set();
        for (const result of results) {
          expect(result.id).toBeDefined();
          expect(typeof result.id).toBe("string");
          ids.add(result.id);
        }
        // All IDs should be unique
        expect(ids.size).toBe(3);
      });

      it("should retrieve entity by auto-generated UUID", async () => {
        const entity = { title: "Retrievable", content: "Can be found" };
        const inserted = await repository.put(entity as any);

        const retrieved = await repository.get({ id: inserted.id });

        expect(retrieved).toBeDefined();
        expect(retrieved!.id).toBe(inserted.id);
        expect(retrieved!.title).toBe("Retrievable");
        expect(retrieved!.content).toBe("Can be found");
      });
    });
  });
}

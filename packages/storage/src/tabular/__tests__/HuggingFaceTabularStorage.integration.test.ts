/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { HuggingFaceTabularStorage } from "@workglow/storage";
import { setLogger } from "@workglow/util";
import type { DataPortSchemaObject } from "@workglow/util/schema";
import { getTestingLogger } from "@workglow/util/test";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

// Mock fetch globally
const mockFetch = vi.fn();
const originalFetch = global.fetch;

describe("HuggingFaceTabularStorage", () => {
  let logger = getTestingLogger();
  setLogger(logger);
  beforeAll(() => {
    global.fetch = mockFetch as any;
  });

  afterAll(() => {
    global.fetch = originalFetch;
  });

  beforeEach(() => {
    mockFetch.mockReset();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe("Constructor and Setup", () => {
    it("should create an instance with user-provided schema", () => {
      const schema: DataPortSchemaObject = {
        type: "object",
        properties: {
          id: { type: "integer" },
          text: { type: "string" },
          label: { type: "integer" },
        },
        required: ["id", "text", "label"],
        additionalProperties: false,
      };

      const storage = new HuggingFaceTabularStorage("test/dataset", "default", "train", schema, [
        "id",
      ] as const);

      expect(storage).toBeDefined();
    });

    it("should use custom baseUrl when provided", async () => {
      const schema: DataPortSchemaObject = {
        type: "object",
        properties: {
          id: { type: "integer" },
          text: { type: "string" },
        },
        required: ["id", "text"],
        additionalProperties: false,
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          features: [{ feature_idx: 0, name: "text", type: { _type: "Value", dtype: "string" } }],
          rows: [{ row_idx: 0, row: { text: "test" }, truncated_cells: [] }],
        }),
      });

      const storage = new HuggingFaceTabularStorage(
        "test/dataset",
        "default",
        "train",
        schema,
        ["id"] as const,
        { baseUrl: "https://custom.example.com" }
      );

      await storage.setupDatabase();

      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining("https://custom.example.com/first-rows"),
        expect.any(Object)
      );
    });

    it("should add authorization header when token is provided", async () => {
      const schema: DataPortSchemaObject = {
        type: "object",
        properties: {
          id: { type: "integer" },
          text: { type: "string" },
        },
        required: ["id", "text"],
        additionalProperties: false,
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          features: [{ feature_idx: 0, name: "text", type: { _type: "Value", dtype: "string" } }],
          rows: [{ row_idx: 0, row: { text: "test" }, truncated_cells: [] }],
        }),
      });

      const storage = new HuggingFaceTabularStorage(
        "test/dataset",
        "default",
        "train",
        schema,
        ["id"] as const,
        { token: "test-token" }
      );

      await storage.setupDatabase();

      expect(mockFetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          headers: expect.objectContaining({
            Authorization: "Bearer test-token",
          }),
        })
      );
    });
  });

  describe("Schema Auto-Detection", () => {
    it("should auto-detect schema from HF features", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          features: [
            { feature_idx: 0, name: "text", type: { _type: "Value", dtype: "string" } },
            { feature_idx: 1, name: "label", type: { _type: "Value", dtype: "int64" } },
          ],
          rows: [{ row_idx: 0, row: { text: "test", label: 1 }, truncated_cells: [] }],
        }),
      });

      const storage = await HuggingFaceTabularStorage.fromDataset(
        "test/dataset",
        "default",
        "train"
      );

      expect(storage).toBeDefined();
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining("/first-rows"),
        expect.any(Object)
      );
    });

    it("should convert HF feature types correctly", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          features: [
            { feature_idx: 0, name: "text", type: { _type: "Value", dtype: "string" } },
            { feature_idx: 1, name: "score", type: { _type: "Value", dtype: "float64" } },
            { feature_idx: 2, name: "count", type: { _type: "Value", dtype: "int32" } },
            { feature_idx: 3, name: "active", type: { _type: "Value", dtype: "bool" } },
            { feature_idx: 4, name: "category", type: { _type: "ClassLabel" } },
          ],
          rows: [
            {
              row_idx: 0,
              row: { text: "test", score: 0.5, count: 10, active: true, category: 0 },
              truncated_cells: [],
            },
          ],
        }),
      });

      const storage = await HuggingFaceTabularStorage.fromDataset(
        "test/dataset",
        "default",
        "train"
      );

      expect(storage).toBeDefined();
    });

    it("should throw error if dataset fetch fails", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 404,
        statusText: "Not Found",
      });

      await expect(
        HuggingFaceTabularStorage.fromDataset("test/nonexistent", "default", "train")
      ).rejects.toThrow("Failed to fetch dataset features");
    });
  });

  describe("Read Operations", () => {
    let storage: HuggingFaceTabularStorage<
      DataPortSchemaObject,
      readonly ["id"],
      { id: number; text: string; label: number },
      { id: number },
      any,
      any
    >;

    beforeEach(() => {
      const schema: DataPortSchemaObject = {
        type: "object",
        properties: {
          id: { type: "integer" },
          text: { type: "string" },
          label: { type: "integer" },
        },
        required: ["id", "text", "label"],
        additionalProperties: false,
      };

      storage = new HuggingFaceTabularStorage(
        "test/dataset",
        "default",
        "train",
        schema,
        ["id"] as const,
        { indexes: [["label"]] }
      );
    });

    it("does not support join, since the filter endpoint has no in-list form", async () => {
      await expect(
        storage.join({ type: "inner", on: [{ left: "id", right: "id" }] }, storage)
      ).rejects.toThrow(/join is not supported/);
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it("should get entity by primary key", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          features: [],
          rows: [{ row_idx: 0, row: { id: 1, text: "test", label: 0 }, truncated_cells: [] }],
          num_rows_total: 1,
          num_rows_per_page: 100,
          partial: false,
        }),
      });

      const result = await storage.get({ id: 1 });

      expect(result).toEqual({ row_idx: 0, id: 1, text: "test", label: 0 });
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining("/filter"),
        expect.any(Object)
      );
    });

    it("should return undefined when entity not found", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          features: [],
          rows: [],
          num_rows_total: 0,
          num_rows_per_page: 100,
          partial: false,
        }),
      });

      const result = await storage.get({ id: 999 });

      expect(result).toBeUndefined();
    });

    it("should get all entities with pagination", async () => {
      // First page
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          features: [],
          rows: Array.from({ length: 100 }, (_, i) => ({
            row_idx: i,
            row: { id: i, text: `text${i}`, label: 0 },
            truncated_cells: [],
          })),
          num_rows_total: 150,
          num_rows_per_page: 100,
          partial: false,
        }),
      });

      // Second page
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          features: [],
          rows: Array.from({ length: 50 }, (_, i) => ({
            row_idx: i + 100,
            row: { id: i + 100, text: `text${i + 100}`, label: 0 },
            truncated_cells: [],
          })),
          num_rows_total: 150,
          num_rows_per_page: 100,
          partial: false,
        }),
      });

      const result = await storage.getAll();

      expect(result).toHaveLength(150);
      expect(mockFetch).toHaveBeenCalledTimes(2);
    });

    it("should get bulk entities with offset and limit", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          features: [],
          rows: Array.from({ length: 10 }, (_, i) => ({
            row_idx: i + 50,
            row: { id: i + 50, text: `text${i + 50}`, label: 0 },
            truncated_cells: [],
          })),
          num_rows_total: 150,
          num_rows_per_page: 100,
          partial: false,
        }),
      });

      const result = await storage.getOffsetPage(50, 10);

      expect(result).toHaveLength(10);
      expect(result![0]).toEqual({ row_idx: 50, id: 50, text: "text50", label: 0 });
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining("offset=50"),
        expect.any(Object)
      );
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining("length=10"),
        expect.any(Object)
      );
    });

    it("should return undefined for getOffsetPage when no entities found", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          features: [],
          rows: [],
          num_rows_total: 0,
          num_rows_per_page: 100,
          partial: false,
        }),
      });

      const result = await storage.getOffsetPage(0, 10);

      expect(result).toBeUndefined();
    });

    it("should cap getOffsetPage limit at 100 (HF max)", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          features: [],
          rows: Array.from({ length: 100 }, (_, i) => ({
            row_idx: i,
            row: { id: i, text: `text${i}`, label: 0 },
            truncated_cells: [],
          })),
          num_rows_total: 150,
          num_rows_per_page: 100,
          partial: false,
        }),
      });

      const result = await storage.getOffsetPage(0, 200);

      expect(result).toHaveLength(100);
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining("length=100"),
        expect.any(Object)
      );
    });

    it("should iterate through records using async generator", async () => {
      // First page
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          features: [],
          rows: Array.from({ length: 100 }, (_, i) => ({
            row_idx: i,
            row: { id: i, text: `text${i}`, label: 0 },
            truncated_cells: [],
          })),
          num_rows_total: 150,
          num_rows_per_page: 100,
          partial: false,
        }),
      });

      // Second page
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          features: [],
          rows: Array.from({ length: 50 }, (_, i) => ({
            row_idx: i + 100,
            row: { id: i + 100, text: `text${i + 100}`, label: 0 },
            truncated_cells: [],
          })),
          num_rows_total: 150,
          num_rows_per_page: 100,
          partial: false,
        }),
      });

      const records: any[] = [];
      for await (const record of storage.records()) {
        records.push(record);
      }

      expect(records).toHaveLength(150);
      expect(records[0]).toEqual({ row_idx: 0, id: 0, text: "text0", label: 0 });
      expect(records[149]).toEqual({ row_idx: 149, id: 149, text: "text149", label: 0 });
    });

    it("should iterate through pages using async generator", async () => {
      // First page
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          features: [],
          rows: Array.from({ length: 100 }, (_, i) => ({
            row_idx: i,
            row: { id: i, text: `text${i}`, label: 0 },
            truncated_cells: [],
          })),
          num_rows_total: 150,
          num_rows_per_page: 100,
          partial: false,
        }),
      });

      // Second page
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          features: [],
          rows: Array.from({ length: 50 }, (_, i) => ({
            row_idx: i + 100,
            row: { id: i + 100, text: `text${i + 100}`, label: 0 },
            truncated_cells: [],
          })),
          num_rows_total: 150,
          num_rows_per_page: 100,
          partial: false,
        }),
      });

      const pages: any[][] = [];
      for await (const page of storage.pages()) {
        pages.push(page);
      }

      expect(pages).toHaveLength(2);
      expect(pages[0]).toHaveLength(100);
      expect(pages[1]).toHaveLength(50);
    });

    it("should search entities by partial key", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          features: [],
          rows: [
            { row_idx: 0, row: { id: 1, text: "test", label: 1 }, truncated_cells: [] },
            { row_idx: 1, row: { id: 2, text: "test2", label: 1 }, truncated_cells: [] },
          ],
          num_rows_total: 2,
          num_rows_per_page: 100,
          partial: false,
        }),
      });

      const result = await storage.query({ label: 1 } as any);

      expect(result).toHaveLength(2);
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining("where=label%3D1"),
        expect.any(Object)
      );
    });

    it("should query entities by non-indexed columns", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          features: [],
          rows: [{ row_idx: 0, row: { id: 1, text: "test", label: 0 }, truncated_cells: [] }],
          num_rows_total: 1,
          num_rows_per_page: 100,
          partial: false,
        }),
      });

      const result = await storage.query({ text: "test" } as any);

      expect(result).toHaveLength(1);
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining("where=text%3D%27test%27"),
        expect.any(Object)
      );
    });

    it("should return undefined when all search values are null or undefined", async () => {
      const result = await storage.query({ label: null } as any);
      expect(result).toBeUndefined();
    });

    it("should get dataset size", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          size: {
            dataset: "test/dataset",
            config: "default",
            split: "train",
            num_bytes_original_files: 1000,
            num_bytes_parquet_files: 500,
            num_bytes_memory: 800,
            num_rows: 100,
            num_columns: 3,
          },
          partial: false,
        }),
      });

      const size = await storage.size();

      expect(size).toBe(100);
      expect(mockFetch).toHaveBeenCalledWith(expect.stringContaining("/size"), expect.any(Object));
    });
  });

  describe("Write Operations (Readonly)", () => {
    let storage: HuggingFaceTabularStorage<
      DataPortSchemaObject,
      readonly ["id"],
      { id: number; text: string },
      { id: number },
      any,
      any
    >;

    beforeEach(() => {
      const schema: DataPortSchemaObject = {
        type: "object",
        properties: {
          id: { type: "integer" },
          text: { type: "string" },
        },
        required: ["id", "text"],
        additionalProperties: false,
      };

      storage = new HuggingFaceTabularStorage("test/dataset", "default", "train", schema, [
        "id",
      ] as const);
    });

    it("should throw error on put", async () => {
      await expect(storage.put({ id: 1, text: "test" } as any)).rejects.toThrow(
        "HuggingFaceTabularStorage is readonly"
      );
    });

    it("should throw error on putBulk", async () => {
      await expect(storage.putBulk([{ id: 1, text: "test" }] as any)).rejects.toThrow(
        "HuggingFaceTabularStorage is readonly"
      );
    });

    it("should throw error on delete", async () => {
      await expect(storage.delete({ id: 1 })).rejects.toThrow(
        "HuggingFaceTabularStorage is readonly"
      );
    });

    it("should throw error on deleteAll", async () => {
      await expect(storage.deleteAll()).rejects.toThrow("HuggingFaceTabularStorage is readonly");
    });

    it("should throw error on deleteSearch", async () => {
      await expect(storage.deleteSearch({ id: 1 } as any)).rejects.toThrow(
        "HuggingFaceTabularStorage is readonly"
      );
    });

    it("should throw error on subscribeToChanges", () => {
      expect(() => storage.subscribeToChanges(() => {})).toThrow(
        "HuggingFaceTabularStorage does not support subscriptions"
      );
    });
  });

  describe("API Integration", () => {
    it("should handle API errors gracefully", async () => {
      const schema: DataPortSchemaObject = {
        type: "object",
        properties: {
          id: { type: "integer" },
        },
        required: ["id"],
        additionalProperties: false,
      };

      const storage: HuggingFaceTabularStorage<
        typeof schema,
        readonly ["id"],
        { id: number },
        { id: number },
        any,
        any
      > = new HuggingFaceTabularStorage("test/dataset", "default", "train", schema, [
        "id",
      ] as const);

      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 500,
        statusText: "Internal Server Error",
      });

      await expect(storage.get({ id: 1 })).rejects.toThrow("HuggingFace API error");
    });

    it("should properly escape string values in WHERE clauses", async () => {
      const schema: DataPortSchemaObject = {
        type: "object",
        properties: {
          id: { type: "string" },
          text: { type: "string" },
        },
        required: ["id", "text"],
        additionalProperties: false,
      };

      const storage: HuggingFaceTabularStorage<
        typeof schema,
        readonly ["id"],
        { id: string; text: string },
        { id: string },
        any,
        any
      > = new HuggingFaceTabularStorage("test/dataset", "default", "train", schema, [
        "id",
      ] as const);

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          features: [],
          rows: [],
          num_rows_total: 0,
          num_rows_per_page: 100,
          partial: false,
        }),
      });

      await storage.get({ id: "test's value" });

      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining("where=id%3D%27test%5C%27s"),
        expect.any(Object)
      );
    });
  });

  describe("Destroy", () => {
    it("should be a no-op", () => {
      const schema: DataPortSchemaObject = {
        type: "object",
        properties: {
          id: { type: "integer" },
        },
        required: ["id"],
        additionalProperties: false,
      };

      const storage = new HuggingFaceTabularStorage("test/dataset", "default", "train", schema, [
        "id",
      ] as const);

      expect(() => storage.destroy()).not.toThrow();
    });
  });
});

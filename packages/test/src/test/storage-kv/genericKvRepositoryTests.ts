/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { DefaultKeyValueSchema, IKvStorage } from "@workglow/storage";
import { FromSchema, JsonSchema } from "@workglow/util/schema";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

export function runGenericKvRepositoryTests(
  createRepository: (keyType: JsonSchema, valueType: JsonSchema) => Promise<IKvStorage<any, any>>
) {
  describe("with default schemas (key and value)", () => {
    let repository: IKvStorage<
      FromSchema<typeof DefaultKeyValueSchema.properties.key>,
      FromSchema<typeof DefaultKeyValueSchema.properties.value>
    >;

    beforeEach(async () => {
      repository = await createRepository({ type: "string" }, {});
      await (repository as any).setupDatabase?.();
    });

    afterEach(async () => {
      await repository.deleteAll();
      await (repository as any).destroy?.();
    });

    it("should store and retrieve values for a key", async () => {
      const key = "key1";
      const value = "value1";
      await repository.put(key, value);
      const output = await repository.get(key);

      expect(output).toEqual(value);
    });

    it("should get undefined for a key that doesn't exist", async () => {
      const key = "key";
      const value = "value";
      await repository.put(key, value);
      const output = await repository.get("not-a-key");

      expect(output == undefined).toEqual(true);
    });

    it("should store multiple values using putBulk", async () => {
      const items = [
        { key: "key1", value: "value1" },
        { key: "key2", value: "value2" },
        { key: "key3", value: "value3" },
      ];

      await repository.putBulk(items);

      for (const item of items) {
        const output = await repository.get(item.key);
        expect(output).toEqual(item.value);
      }
    });

    it("should handle empty array in putBulk", async () => {
      await repository.putBulk([]);
      // Should not throw an error
    });

    it("should emit put, get, delete and deleteall events", async () => {
      const putFn = vi.fn();
      const getFn = vi.fn();
      const deleteFn = vi.fn();
      const deleteAllFn = vi.fn();

      repository.on("put", putFn);
      repository.on("get", getFn);
      repository.on("delete", deleteFn);
      repository.on("deleteall", deleteAllFn);

      await repository.put("k1", "v1");
      expect(putFn).toHaveBeenCalledWith("k1", "v1");

      const value = await repository.get("k1");
      expect(value).toEqual("v1");
      expect(getFn).toHaveBeenCalledWith("k1", "v1");

      await repository.get("missing");
      expect(getFn).toHaveBeenCalledWith("missing", undefined);

      await repository.delete("k1");
      expect(deleteFn).toHaveBeenCalledWith("k1");

      await repository.deleteAll();
      expect(deleteAllFn).toHaveBeenCalled();
    });

    it("should emit a put event for each item in putBulk", async () => {
      const putFn = vi.fn();
      repository.on("put", putFn);

      await repository.putBulk([
        { key: "a", value: "1" },
        { key: "b", value: "2" },
      ]);

      expect(putFn).toHaveBeenCalledTimes(2);
      expect(putFn).toHaveBeenCalledWith("a", "1");
      expect(putFn).toHaveBeenCalledWith("b", "2");
    });
  });

  describe("with json value", () => {
    let repository: IKvStorage<string, { option: string; success: boolean }>;

    beforeEach(async () => {
      repository = (await createRepository(
        { type: "string" },
        {
          type: "object",
          properties: {
            option: { type: "string" },
            success: { type: "boolean" },
          },
          additionalProperties: false,
        }
      )) as IKvStorage<string, { option: string; success: boolean }>;
      await (repository as any).setupDatabase?.();
    });

    afterEach(async () => {
      await repository.deleteAll();
      await (repository as any).destroy?.();
    });

    it("should store and retrieve values for a key", async () => {
      const key = await repository.getObjectAsIdString({ name: "key1", type: "string1" });
      const value = { option: "value1", success: true };
      await repository.put(key, value);
      const output = await repository.get(key);

      expect(output?.option).toEqual("value1");
      expect(!!output?.success).toEqual(true);
    });

    it("should get undefined for a key that doesn't exist", async () => {
      const key = await repository.getObjectAsIdString({ name: "key", type: "string" });
      const output = await repository.get(key);

      expect(output == undefined).toEqual(true);
    });

    it("should store multiple JSON values using putBulk", async () => {
      const items = [
        {
          key: await repository.getObjectAsIdString({ name: "key1", type: "string1" }),
          value: { option: "value1", success: true },
        },
        {
          key: await repository.getObjectAsIdString({ name: "key2", type: "string2" }),
          value: { option: "value2", success: false },
        },
        {
          key: await repository.getObjectAsIdString({ name: "key3", type: "string3" }),
          value: { option: "value3", success: true },
        },
      ];

      await repository.putBulk(items);

      for (const item of items) {
        const output = await repository.get(item.key);
        expect(output?.option).toEqual(item.value.option);
        expect(output?.success).toEqual(item.value.success);
      }
    });
  });
}

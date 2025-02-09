//    *******************************************************************************
//    *   ELLMERS: Embedding Large Language Model Experiential Retrieval Service    *
//    *                                                                             *
//    *   Copyright Steven Roussey <sroussey@gmail.com>                             *
//    *   Licensed under the Apache License, Version 2.0 (the "License");           *
//    *******************************************************************************

import { describe, expect, it, beforeEach } from "bun:test";
import { BaseValueSchema, BasePrimaryKeySchema, IKVRepository } from "ellmers-core";

export type PrimaryKey = {
  name: string;
  type: string;
};
export type Value = {
  option: string;
  success: boolean;
};

export const PrimaryKeySchema: BasePrimaryKeySchema = { name: "string", type: "string" } as const;
export const ValueSchema: BaseValueSchema = { option: "string", success: "boolean" } as const;

export function runGenericKVRepositoryTests(
  createRepository: () => Promise<IKVRepository>,
  createComplexRepository: () => Promise<IKVRepository<PrimaryKey, Value>>
) {
  describe("with default schemas (key and value)", () => {
    let repository: IKVRepository;

    beforeEach(async () => {
      repository = await createRepository();
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
  });

  describe("with complex schemas", () => {
    let repository: IKVRepository<PrimaryKey, Value>;

    beforeEach(async () => {
      repository = await createComplexRepository();
    });

    it("should store and retrieve values for a key", async () => {
      const key = { name: "key1", type: "string1" };
      const value = { option: "value1", success: true };
      await repository.putKeyValue(key, value);
      const output = await repository.getKeyValue(key);

      expect(output?.option).toEqual("value1");
      expect(!!output?.success).toEqual(true);
    });

    it("should get undefined for a key that doesn't exist", async () => {
      const key = { name: "key", type: "string" };
      const output = await repository.getKeyValue(key);

      expect(output == undefined).toEqual(true);
    });
  });
}

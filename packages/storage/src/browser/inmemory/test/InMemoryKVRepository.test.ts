//    *******************************************************************************
//    *   ELLMERS: Embedding Large Language Model Experiential Retrieval Service    *
//    *                                                                             *
//    *   Copyright Steven Roussey <sroussey@gmail.com>                             *
//    *   Licensed under the Apache License, Version 2.0 (the "License");           *
//    *******************************************************************************

import { describe, expect, it, beforeEach } from "bun:test";
import { InMemoryKVRepository } from "../base/InMemoryKVRepository";
import { BaseValueSchema, BasePrimaryKeySchema } from "ellmers-core";

type PrimaryKey = {
  name: string;
  type: string;
};
type Value = {
  option: string;
  success: boolean;
};

export const PrimaryKeySchema: BasePrimaryKeySchema = { name: "string", type: "string" } as const;
export const ValueSchema: BaseValueSchema = { option: "string", success: "boolean" } as const;

describe("InMemoryKVRepository", () => {
  describe("with default schemas (key and value)", () => {
    let repository: InMemoryKVRepository;

    beforeEach(() => {
      repository = new InMemoryKVRepository();
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
    let repository: InMemoryKVRepository<PrimaryKey, Value>;

    beforeEach(() => {
      repository = new InMemoryKVRepository<PrimaryKey, Value>(PrimaryKeySchema, ValueSchema);
    });

    it("should store and retrieve values for a key", async () => {
      const key = { name: "key", type: "string" };
      const value = { option: "value", success: true };
      await repository.put(key, value);
      const output = await repository.getKeyValue(key);

      expect(output?.option).toEqual("value");
      expect(!!output?.success).toEqual(true); // TODO need some conversion to boolean from 1
    });
    it("should get undefined for a key that doesn't exist", async () => {
      const key = { name: "key", type: "string" };
      const output = await repository.get(key);

      expect(output == undefined).toEqual(true);
    });
  });
});

//    *******************************************************************************
//    *   ELLMERS: Embedding Large Language Model Experiential Retrieval Service    *
//    *                                                                             *
//    *   Copyright Steven Roussey <sroussey@gmail.com>                             *
//    *   Licensed under the Apache License, Version 2.0 (the "License");           *
//    *******************************************************************************

import { describe, expect, it, beforeEach, afterEach } from "bun:test";
import { rmdirSync } from "fs";
import { FileKVRepository } from "../base/FileKVRepository";
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

const testDir = ".cache/test/testing";

describe("FileKVRepository", () => {
  let repository: FileKVRepository;
  try {
    rmdirSync(testDir, { recursive: true });
  } catch {}

  beforeEach(() => {
    repository = new FileKVRepository(testDir);
  });
  afterEach(() => {
    repository.deleteAll();
  });

  describe("with default schemas (key and value)", () => {
    let repository: FileKVRepository;

    beforeEach(() => {
      repository = new FileKVRepository(testDir);
    });

    it("should store and retrieve values for a key", async () => {
      const key = "key";
      const value = "value";
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
    let repository: FileKVRepository<PrimaryKey, Value>;

    beforeEach(async () => {
      repository = new FileKVRepository<PrimaryKey, Value>(testDir, PrimaryKeySchema, ValueSchema);
    });
    afterEach(async () => {
      // await repository.deleteAll();
    });

    it("should store and retrieve values for a key", async () => {
      const key = { name: "key", type: "string" };
      const value = { option: "value", success: true };
      await repository.putKeyValue(key, value);
      const output = await repository.getKeyValue(key);

      expect(output?.option).toEqual("value");
      expect(!!output?.success).toEqual(true); // TODO need some conversion to boolean from 1

      await repository.delete(key);

      const output2 = await repository.getKeyValue(key);
      expect(output2 == undefined).toEqual(true);
    });
    it("should get undefined for a key that doesn't exist", async () => {
      const key = { name: "key-unknown", type: "string" };
      const output = await repository.getKeyValue(key);

      expect(output == undefined).toEqual(true);
    });
  });
});

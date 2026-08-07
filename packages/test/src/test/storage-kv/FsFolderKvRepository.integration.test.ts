/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { FsFolderKvStorage, StorageUnsupportedError } from "@workglow/storage";
import { setLogger } from "@workglow/util";
import { getTestingLogger } from "@workglow/util/test";
import { mkdirSync, rmSync } from "fs";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { runGenericKvRepositoryTests } from "./genericKvRepositoryTests";

const testDir = ".cache/test/kv-fs-folder";

describe("FsFolderKvStorage", () => {
  let logger = getTestingLogger();
  setLogger(logger);
  beforeEach(() => {
    try {
      mkdirSync(testDir, { recursive: true });
    } catch {}
  });

  afterEach(async () => {
    try {
      rmSync(testDir, { recursive: true });
    } catch {}
  });

  runGenericKvRepositoryTests(async (keyType, valueType) => {
    // Create a deterministic file extension from the schema type
    const schemaType =
      typeof valueType === "object" && valueType !== null && "type" in valueType
        ? String(valueType.type)
        : "data";
    return new FsFolderKvStorage(
      testDir,
      (key) => `${String(key)}.${schemaType}`,
      keyType,
      valueType
    );
  });

  describe("contract symmetry", () => {
    const makeStore = () => new FsFolderKvStorage(testDir, (key) => `${String(key)}.data`);

    it("delete of a never-written key is an idempotent no-op (swallows ENOENT)", async () => {
      const store = makeStore();
      // Must not reject the way unlink() would on a missing path.
      await expect(store.delete("never-written")).resolves.toBeUndefined();
    });

    it("delete still emits a delete event for a missing key", async () => {
      const store = makeStore();
      let emitted: unknown;
      store.on("delete", (key) => {
        emitted = key;
      });
      await store.delete("missing");
      expect(emitted).toBe("missing");
    });

    it("getAll throws the typed StorageUnsupportedError", async () => {
      const store = makeStore();
      await expect(store.getAll()).rejects.toBeInstanceOf(StorageUnsupportedError);
    });

    it("size throws the typed StorageUnsupportedError", async () => {
      const store = makeStore();
      await expect(store.size()).rejects.toBeInstanceOf(StorageUnsupportedError);
    });
  });
});

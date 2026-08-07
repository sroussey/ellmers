/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { setLogger } from "@workglow/util";
import { compress, decompress } from "@workglow/util/compress";
import { getTestingLogger } from "@workglow/util/test";
import { describe, expect, it } from "vitest";

describe("Compression", () => {
  let logger = getTestingLogger();
  setLogger(logger);
  it("should compress and decompress a JSON object", async () => {
    const sampleObject = {
      name: "Alice",
      age: 30,
      hobbies: ["reading", "gaming", "hiking"],
      active: true,
    };
    const jsonString = JSON.stringify(sampleObject);
    const compressedData = await compress(jsonString, "br");
    const decompressedString = await decompress(compressedData, "br");
    const decompressedObject = JSON.parse(decompressedString);
    expect(JSON.stringify(sampleObject)).toBe(JSON.stringify(decompressedObject));
  });
});

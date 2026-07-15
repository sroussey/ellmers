/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from "vitest";
import { sanitizeHubFilePath, sanitizeHubRepoId } from "../hf/ids";

describe("sanitizeHubRepoId", () => {
  it("accepts canonical and org/name ids unchanged", () => {
    expect(sanitizeHubRepoId("squad")).toBe("squad");
    expect(sanitizeHubRepoId("mteb/stsbenchmark-sts")).toBe("mteb/stsbenchmark-sts");
    expect(sanitizeHubRepoId("onnx-community/Bonsai-8B-ONNX")).toBe(
      "onnx-community/Bonsai-8B-ONNX"
    );
    expect(sanitizeHubRepoId("prism-ml/Bonsai-27B-gguf")).toBe("prism-ml/Bonsai-27B-gguf");
    expect(sanitizeHubRepoId("_underscore/model-v1.0")).toBe("_underscore/model-v1.0");
  });

  it("rejects ids that could redirect the request path", () => {
    expect(() => sanitizeHubRepoId("org/name/../../resolve/main/x")).toThrow(/invalid/);
    expect(() => sanitizeHubRepoId("../etc")).toThrow(/invalid/);
    expect(() => sanitizeHubRepoId("org/..")).toThrow(/invalid/);
    expect(() => sanitizeHubRepoId("org/name?x=1")).toThrow(/invalid/);
    expect(() => sanitizeHubRepoId("org/name#frag")).toThrow(/invalid/);
    expect(() => sanitizeHubRepoId("evil.com@org/name")).toThrow(/invalid/);
    expect(() => sanitizeHubRepoId("")).toThrow(/invalid/);
    expect(() => sanitizeHubRepoId("a//b")).toThrow(/invalid/);
  });
});

describe("sanitizeHubFilePath", () => {
  it("URL-encodes segments while keeping the path structure", () => {
    expect(sanitizeHubFilePath("data/test-00000-of-00001.parquet")).toBe(
      "data/test-00000-of-00001.parquet"
    );
    expect(sanitizeHubFilePath("dir with space/f.jsonl")).toBe("dir%20with%20space/f.jsonl");
  });

  it("rejects traversal and empty segments", () => {
    expect(() => sanitizeHubFilePath("../secrets")).toThrow(/invalid/);
    expect(() => sanitizeHubFilePath("data/../../x")).toThrow(/invalid/);
    expect(() => sanitizeHubFilePath("data//x")).toThrow(/invalid/);
  });
});

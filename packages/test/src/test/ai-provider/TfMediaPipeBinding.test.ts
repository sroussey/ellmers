/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { setLogger } from "@workglow/util";
import { getTestingLogger } from "@workglow/util/test";
import { describe, expect, it } from "vitest";

describe("TfMediaPipeBinding", async () => {
  let logger = getTestingLogger();
  setLogger(logger);
  it("should skip media pipe tests", () => {
    expect(true).toBe(true);
  });
});

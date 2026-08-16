/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from "vitest";
import { AiProvider } from "../AiProvider";

class ProbeProvider extends AiProvider {
  readonly name = "PROBE";
  readonly displayName = "Probe";
  readonly isLocal = false;
  readonly supportsBrowser = true;
  readonly supportsServer = true;
}

describe("AiProvider.effortPolicy", () => {
  it("returns undefined when a provider does not opt in", () => {
    expect(
      new ProbeProvider().effortPolicy({ provider: "PROBE", provider_config: {} })
    ).toBeUndefined();
  });
});

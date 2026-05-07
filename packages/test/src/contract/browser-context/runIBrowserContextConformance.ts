/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe } from "vitest";

import { resolveFixture } from "./fixtures";
import type { IBrowserContextConformanceOpts } from "./types";

export function runIBrowserContextConformance(opts: IBrowserContextConformanceOpts): void {
  describe.skipIf(opts.skip)(`IBrowserContext conformance: ${opts.name}`, () => {
    const fixture = resolveFixture(opts.fixture);

    // Phase 2 wires assertion blocks here. Each block creates its own
    // context via opts.factory() in beforeAll and disposes it in afterAll
    // so block N cannot taint block N+1.
    void fixture;
  });
}

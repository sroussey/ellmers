/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe } from "vitest";

import { capabilityHonestyBlock } from "./assertions/capabilityHonesty";
import { resolveFixture } from "./fixtures";
import type { IBrowserContextConformanceOpts } from "./types";

export function runIBrowserContextConformance(opts: IBrowserContextConformanceOpts): void {
  describe.skipIf(opts.skip)(`IBrowserContext conformance: ${opts.name}`, () => {
    const fixture = resolveFixture(opts.fixture);

    capabilityHonestyBlock(opts, fixture);
    // tabsLifecycleBlock, ariaRoundTripBlock, networkIntrospectionBlock
    // are wired in subsequent tasks.
  });
}

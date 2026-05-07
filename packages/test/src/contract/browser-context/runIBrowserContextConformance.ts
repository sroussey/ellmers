/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe } from "vitest";

import { ariaRoundTripBlock } from "./assertions/ariaRoundTrip";
import { capabilityHonestyBlock } from "./assertions/capabilityHonesty";
import { tabsLifecycleBlock } from "./assertions/tabsLifecycle";
import { resolveFixture } from "./fixtures";
import type { IBrowserContextConformanceOpts } from "./types";

export function runIBrowserContextConformance(opts: IBrowserContextConformanceOpts): void {
  describe.skipIf(opts.skip)(`IBrowserContext conformance: ${opts.name}`, () => {
    const fixture = resolveFixture(opts.fixture);

    capabilityHonestyBlock(opts, fixture);
    tabsLifecycleBlock(opts, fixture);
    ariaRoundTripBlock(opts, fixture);
    // networkIntrospectionBlock is wired in a subsequent task.
  });
}

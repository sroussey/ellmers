/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { afterAll, beforeAll, beforeEach, describe } from "vitest";

import { resolveHumanConformanceFixture } from "./fixtures";
import type {
  HumanConnectorConformanceHandle,
  HumanConnectorConformanceOpts,
} from "./types";

export type { HumanConnectorConformanceOpts } from "./types";
export { MockHumanConnector } from "./MockHumanConnector";

export function runHumanConnectorConformance(opts: HumanConnectorConformanceOpts): void {
  describe.skipIf(opts.skip)(`IHumanConnector conformance: ${opts.name}`, () => {
    let handle: HumanConnectorConformanceHandle | undefined;
    const getHandle = (): HumanConnectorConformanceHandle => {
      if (!handle) throw new Error("conformance handle not initialized");
      return handle;
    };

    beforeAll(async () => {
      handle = await opts.factory();
    }, opts.timeout);

    beforeEach(() => {
      // Each assertion starts from a clean script + received list.
      handle?.script.clear();
    });

    afterAll(async () => {
      if (handle) await handle.dispose();
    });

    const fixture = resolveHumanConformanceFixture(opts.fixture);

    // Assertion blocks wired in subsequent tasks. Until a block is wired in,
    // the suite passes vacuously for that capability — keeping the runner
    // skeleton committable on its own.
    void fixture;
    void getHandle;
  });
}

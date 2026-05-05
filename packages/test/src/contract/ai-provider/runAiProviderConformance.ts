/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { afterAll, beforeAll, describe } from "vitest";

import { capabilityHonestyBlock } from "./assertions/capabilityHonesty";
import { disposeBlock } from "./assertions/dispose";
import { registryCoverageBlock } from "./assertions/registryCoverage";
import { sessionReuseBlock } from "./assertions/sessionReuse";
import { signalHonoringBlock } from "./assertions/signalHonoring";
import { structuredGenerationBlock } from "./assertions/structuredGeneration";
import { textGenerationSmokeBlock } from "./assertions/textGenerationSmoke";
import { toolCallAccumulatorBlock } from "./assertions/toolCallAccumulator";
import { toolCallMultiTurnBlock } from "./assertions/toolCallMultiTurn";
import { resolveFixture } from "./fixtures";
import type { AiProviderConformanceOpts, ConformanceHandle } from "./types";

export function runAiProviderConformance(opts: AiProviderConformanceOpts): void {
  describe.skipIf(opts.skip)(`AiProvider conformance: ${opts.name}`, () => {
    let handle: ConformanceHandle | undefined;
    const getHandle = (): ConformanceHandle => {
      if (!handle) throw new Error("conformance handle not initialized");
      return handle;
    };

    beforeAll(async () => {
      handle = await opts.factory();
      await handle.register();
    }, opts.timeout);

    afterAll(async () => {
      if (handle) await handle.dispose();
    });

    const fixture = resolveFixture(opts.fixture);

    registryCoverageBlock(opts);
    textGenerationSmokeBlock(opts, fixture);
    signalHonoringBlock(opts, fixture);
    toolCallAccumulatorBlock(opts, fixture);
    toolCallMultiTurnBlock(opts, fixture);
    structuredGenerationBlock(opts, fixture);
    sessionReuseBlock(opts, fixture, getHandle);
    capabilityHonestyBlock(opts);
    // dispose runs last; it calls handle.dispose() which must be idempotent.
    disposeBlock(opts, getHandle);
  });
}

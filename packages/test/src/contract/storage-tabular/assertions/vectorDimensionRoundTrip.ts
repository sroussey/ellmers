/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { ITabularStorage } from "@workglow/storage";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { itExpectFail } from "../../itExpectFail";
import { DEFAULT_VECTOR_DIMENSION, VectorPrimaryKeyNames, VectorSchema } from "../fixtures";
import type { TabularContractHandle, TabularStorageContractOpts } from "../types";

// VectorSchema declares `embedding` as `type: "string"` (Postgres requirement
// for vector format detection). Adapters serialize/deserialize between
// Float32Array and the wire format at runtime, but the static FromSchema
// derivation does not currently model this so casts via `unknown` are
// required at the put/get sites. Tracked: extend TypedArraySchemaOptions to
// recognize `type: "string"` + TypedArray:N format.
export function vectorDimensionRoundTripBlock(
  opts: TabularStorageContractOpts,
  getHandle: () => TabularContractHandle
): void {
  const enabled = opts.capabilities.vectorColumns;
  const expectFails = new Set(opts.expectedFailures ?? []);
  const itImpl = expectFails.has("vector.dimensionRoundTrip") ? itExpectFail : it;

  describe.skipIf(!enabled)("Vector column round-trip", () => {
    let repo: ITabularStorage<typeof VectorSchema, typeof VectorPrimaryKeyNames>;

    beforeAll(async () => {
      const handle = getHandle();
      if (!handle.createVectorRepo) {
        throw new Error(
          `${opts.name} declares vectorColumns=true but factory.createVectorRepo is undefined`
        );
      }
      repo = await handle.createVectorRepo();
      await repo.setupDatabase?.();
    }, opts.timeout);

    afterAll(async () => {
      await repo.deleteAll();
      repo.destroy();
    });

    itImpl(
      "Float32Array(384) round-trips preserving instance type and length",
      async () => {
        const embedding = new Float32Array(DEFAULT_VECTOR_DIMENSION);
        for (let i = 0; i < embedding.length; i++) {
          embedding[i] = (i + 1) / 1000;
        }
        await repo.put({ id: "v1", embedding: embedding as unknown as string });

        const fetched = await repo.get({ id: "v1" });
        expect(fetched).toBeDefined();
        const round = fetched!.embedding as unknown as Float32Array;
        expect(round).toBeInstanceOf(Float32Array);
        expect(round.length).toBe(DEFAULT_VECTOR_DIMENSION);
        // Spot-check a few values to confirm element-level fidelity.
        expect(round[0]).toBeCloseTo(0.001, 5);
        expect(round[round.length - 1]).toBeCloseTo(DEFAULT_VECTOR_DIMENSION / 1000, 5);
      },
      opts.timeout
    );
  });
}

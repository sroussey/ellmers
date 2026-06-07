/**
 * @license Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { DataPortSchema } from "@workglow/util/schema";

/** A serialized transform step on a dataflow edge. */
export interface ITransformStep {
  readonly id: string;
  /** Omitted in JSON when the transform has no parameters. */
  readonly params?: Record<string, unknown>;
}

/**
 * A ranked bridge candidate returned by the suggestion engine.
 *
 * The runner/registry do not consume this type; it is exported for builder UI
 * that suggests transform chains to bridge mismatched source/target schemas.
 */
export interface IBridgeCandidate {
  readonly chain: ReadonlyArray<ITransformStep>;
  /** 0..1, min of per-step suggestFromSchemas scores. */
  readonly confidence: number;
  /** Weighted chain length: pick/index = 0.5, others = 1.0, direct match = 0. */
  readonly cost: number;
}

/**
 * A transform definition registered with TransformRegistry.
 * All functions must be pure, deterministic, side-effect free.
 *
 * Transforms apply only to materialised values (full snapshot or finish payload);
 * per-event streaming transforms are out of scope.
 */
export interface ITransformDef<P = unknown> {
  readonly id: string;
  readonly title: string;
  readonly category: string;
  readonly paramsSchema: DataPortSchema | undefined;

  /** Compute the schema that `apply`'s output will match given an input schema. */
  inferOutputSchema(inputSchema: DataPortSchema, params: P): DataPortSchema;

  /** Transform a complete value. May be async. */
  apply(value: unknown, params: P): unknown | Promise<unknown>;

  /**
   * Used by the builder's suggestion engine. Return `{ score, params }` if
   * this transform could bridge source → target, else undefined. Score is 0..1.
   */
  suggestFromSchemas?(
    source: DataPortSchema,
    target: DataPortSchema
  ): { readonly score: number; readonly params: P } | undefined;
}

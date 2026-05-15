/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { AnyVectorStorage, IVectorStorage, VectorSearchOptions } from "@workglow/storage";
import type { DataPortSchemaObject, TypedArray } from "@workglow/util/schema";
import { ScopedTabularStorage } from "./ScopedTabularStorage";

/**
 * Wrapper extending `ScopedTabularStorage` that also implements `IVectorStorage`.
 * Delegates vector search methods to the inner shared vector storage,
 * post-filtering results by `kb_id`.
 */
export class ScopedVectorStorage<
  Metadata extends Record<string, unknown> | undefined,
  Schema extends DataPortSchemaObject,
  Entity = any,
  PrimaryKeyNames extends ReadonlyArray<keyof Schema["properties"]> = ReadonlyArray<
    keyof Schema["properties"]
  >,
>
  extends ScopedTabularStorage<Schema, PrimaryKeyNames, Entity>
  implements IVectorStorage<Metadata, Schema, Entity, PrimaryKeyNames>
{
  protected override readonly inner: AnyVectorStorage;
  private readonly overFetchMultiplier: number;

  constructor(inner: AnyVectorStorage, kbId: string, overFetchMultiplier: number = 3) {
    super(inner, kbId);
    this.inner = inner;
    this.overFetchMultiplier = overFetchMultiplier;
  }

  getVectorDimensions(): number {
    return this.inner.getVectorDimensions();
  }

  private filterAndStrip(
    results: any[],
    topK: number | undefined,
    overfetchLimit: number | undefined
  ): (Entity & { score: number })[] {
    const filtered = results.filter((r: any) => r.kb_id === this.kbId).slice(0, topK);

    // Only warn when cross-KB filtering is likely the culprit: the inner search
    // returned exactly as many results as we requested (overfetch limit) and
    // filtering still left us short of topK.
    if (topK && overfetchLimit && results.length >= overfetchLimit && filtered.length < topK) {
      console.warn(
        `ScopedVectorStorage: search returned ${filtered.length}/${topK} results after ` +
          `kb_id filtering. Consider increasing overFetchMultiplier (currently ${this.overFetchMultiplier}).`
      );
    }

    return filtered.map((r: any) => {
      const { kb_id: _, ...rest } = r;
      return rest as Entity & { score: number };
    });
  }

  async similaritySearch(
    query: TypedArray,
    options?: VectorSearchOptions<Metadata>
  ): Promise<(Entity & { score: number })[]> {
    const overfetchLimit = options?.topK ? options.topK * this.overFetchMultiplier : undefined;
    const results = await this.inner.similaritySearch(query, {
      ...options,
      topK: overfetchLimit,
    } as any);

    return this.filterAndStrip(results, options?.topK, overfetchLimit);
  }
}

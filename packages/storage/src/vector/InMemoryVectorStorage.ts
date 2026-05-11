/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type {
  DataPortSchemaObject,
  FromSchema,
  TypedArray,
  TypedArrayConstructor,
  TypedArraySchemaOptions,
} from "@workglow/util/schema";
import { cosineSimilarity } from "@workglow/util/schema";
import { InMemoryTabularStorage } from "../tabular/InMemoryTabularStorage";
import type { IVectorStorage, VectorSearchOptions } from "./IVectorStorage";
import { getMetadataProperty, getVectorProperty } from "./IVectorStorage";

/**
 * Check if metadata matches filter
 */
function matchesFilter<Metadata>(metadata: Metadata, filter: Partial<Metadata>): boolean {
  for (const [key, value] of Object.entries(filter)) {
    if (metadata[key as keyof Metadata] !== value) {
      return false;
    }
  }
  return true;
}

/**
 * In-memory document chunk vector repository implementation.
 * Extends InMemoryTabularStorage for storage.
 * Suitable for testing and small-scale browser applications.
 * Supports all vector types including quantized formats.
 *
 * @template Metadata - The metadata type for the document chunk
 * @template VectorCtor - Constructor for stored vectors (default {@link typeof Float32Array})
 */
export class InMemoryVectorStorage<
  Schema extends DataPortSchemaObject,
  PrimaryKeyNames extends ReadonlyArray<keyof Schema["properties"]>,
  Metadata extends Record<string, unknown> = Record<string, unknown>,
  Entity = FromSchema<Schema, TypedArraySchemaOptions>,
>
  extends InMemoryTabularStorage<Schema, PrimaryKeyNames, Entity>
  implements IVectorStorage<Metadata, Schema, Entity, PrimaryKeyNames>
{
  private vectorDimensions: number;
  private vectorPropertyName: keyof Entity;
  private metadataPropertyName: keyof Entity | undefined;

  /**
   * Creates a new in-memory document chunk vector repository
   * @param schema - The schema definition for the entity
   * @param primaryKeyNames - Array of property names that form the primary key
   * @param indexes - Array of columns or column arrays to make searchable
   * @param dimensions - The number of dimensions of the vector
   * @param _vectorCtor - TypedArray constructor (unused, for API compatibility)
   */
  constructor(
    schema: Schema,
    primaryKeyNames: PrimaryKeyNames,
    indexes: readonly (keyof NoInfer<Entity> | readonly (keyof NoInfer<Entity>)[])[] = [],
    dimensions: number,
    _vectorCtor: TypedArrayConstructor = Float32Array
  ) {
    super(schema, primaryKeyNames, indexes);

    this.vectorDimensions = dimensions;

    // Cache vector and metadata property names from schema
    const vectorProp = getVectorProperty(schema);
    if (!vectorProp) {
      throw new Error("Schema must have a property with type array and format TypedArray");
    }
    this.vectorPropertyName = vectorProp as keyof Entity;
    this.metadataPropertyName = getMetadataProperty(schema) as keyof Entity | undefined;
  }

  /**
   * Get the vector dimensions
   * @returns The vector dimensions
   */
  getVectorDimensions(): number {
    return this.vectorDimensions;
  }

  async similaritySearch(
    query: TypedArray,
    options: VectorSearchOptions<Record<string, unknown>> = {}
  ) {
    const { topK = 10, filter, scoreThreshold = 0 } = options;
    const results: Array<Entity & { score: number }> = [];

    const allEntities = (await this.getAll()) || [];

    for (const entity of allEntities) {
      const vector = entity[this.vectorPropertyName] as TypedArray;
      const metadata = this.metadataPropertyName
        ? (entity[this.metadataPropertyName] as Metadata)
        : ({} as Metadata);

      // Apply filter if provided
      if (filter && !matchesFilter(metadata, filter)) {
        continue;
      }

      // Calculate similarity
      const score = cosineSimilarity(query, vector);

      // Apply threshold
      if (score < scoreThreshold) {
        continue;
      }

      results.push({
        ...entity,
        score,
      } as Entity & { score: number });
    }

    // Sort by score descending and take top K
    results.sort((a, b) => b.score - a.score);
    const topResults = results.slice(0, topK);

    return topResults;
  }
}

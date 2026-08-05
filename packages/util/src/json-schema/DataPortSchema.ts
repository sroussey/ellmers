/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { JSONSchemaExtension } from "@sroussey/json-schema-to-ts";
import type { JsonSchema, JsonSchemaCustomProps } from "./JsonSchema";

export type DataPortSchemaNonBoolean<
  EXTENSION extends JSONSchemaExtension = JsonSchemaCustomProps,
> = Exclude<JsonSchema<EXTENSION>, boolean>;

/**
 * Narrows to object schemas while preserving all schema properties.
 */
export type DataPortSchemaObject<EXTENSION extends JSONSchemaExtension = JsonSchemaCustomProps> =
  DataPortSchemaNonBoolean<EXTENSION> & {
    readonly type: "object";
    readonly properties: Record<string, DataPortSchemaNonBoolean<EXTENSION>>;
  };

export type PropertySchema = NonNullable<DataPortSchemaObject["properties"]>[string];

export type DataPortSchema<EXTENSION extends JSONSchemaExtension = JsonSchemaCustomProps> =
  boolean | DataPortSchemaObject<EXTENSION>;

/**
 * @license Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { DataPortSchema } from "@workglow/util/schema";
import type { ITransformDef } from "../TransformTypes";

const stringSchema: DataPortSchema = { type: "string" } as DataPortSchema;

export const uppercaseTransform: ITransformDef = {
  id: "uppercase",
  title: "Uppercase",
  category: "String",
  paramsSchema: undefined,
  inferOutputSchema: () => stringSchema,
  apply: (v) => String(v ?? "").toUpperCase(),
};

export const lowercaseTransform: ITransformDef = {
  id: "lowercase",
  title: "Lowercase",
  category: "String",
  paramsSchema: undefined,
  inferOutputSchema: () => stringSchema,
  apply: (v) => String(v ?? "").toLowerCase(),
};

interface TruncateParams {
  readonly max: number;
}

export const truncateTransform: ITransformDef<TruncateParams> = {
  id: "truncate",
  title: "Truncate",
  category: "String",
  paramsSchema: {
    type: "object",
    properties: { max: { type: "integer", minimum: 0 } },
    required: ["max"],
  } as DataPortSchema,
  inferOutputSchema: () => stringSchema,
  apply: (v, { max }) => String(v ?? "").slice(0, max),
};

interface SubstringParams {
  readonly start: number;
  readonly end: number | undefined;
}

export const substringTransform: ITransformDef<SubstringParams> = {
  id: "substring",
  title: "Substring",
  category: "String",
  paramsSchema: {
    type: "object",
    properties: {
      start: { type: "integer" },
      end: { type: "integer" },
    },
    required: ["start"],
  } as DataPortSchema,
  inferOutputSchema: () => stringSchema,
  apply: (v, { start, end }) => String(v ?? "").slice(start, end),
};

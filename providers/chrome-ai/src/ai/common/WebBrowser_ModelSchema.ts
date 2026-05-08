/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { ModelConfigSchema, ModelRecordSchema } from "@workglow/ai/worker";
import { DataPortSchemaObject, FromSchema } from "@workglow/util/worker";
import { WEB_BROWSER } from "./WebBrowser_Constants";

export const WebBrowserModelSchema = {
  type: "object",
  properties: {
    provider: {
      const: WEB_BROWSER,
      description: "Discriminator: Chrome Built-in AI (Gemini Nano).",
    },
    provider_config: {
      type: "object",
      description: "Chrome Built-in AI configuration.",
      properties: {
        summary_type: {
          type: "string",
          enum: ["tl;dr", "key-points", "teaser", "headline"],
          description: "Summarization style (Summarizer API only).",
        },
        summary_length: {
          type: "string",
          enum: ["short", "medium", "long"],
          description: "Desired summary length (Summarizer API only).",
        },
        summary_format: {
          type: "string",
          enum: ["plain-text", "markdown"],
          description: "Output format for summaries (Summarizer API only).",
        },
        rewriter_tone: {
          type: "string",
          enum: ["as-is", "more-formal", "more-casual"],
          description: "Tone for rewriting (Rewriter API only).",
        },
        rewriter_length: {
          type: "string",
          enum: ["as-is", "shorter", "longer"],
          description: "Length adjustment for rewriting (Rewriter API only).",
        },
      },
      required: [],
      additionalProperties: false,
    },
  },
  required: ["provider", "provider_config"],
  additionalProperties: true,
} as const satisfies DataPortSchemaObject;

export const WebBrowserModelRecordSchema = {
  type: "object",
  properties: {
    ...ModelRecordSchema.properties,
    ...WebBrowserModelSchema.properties,
  },
  required: [...ModelRecordSchema.required, ...WebBrowserModelSchema.required],
  additionalProperties: false,
} as const satisfies DataPortSchemaObject;

export type WebBrowserModelRecord = FromSchema<typeof WebBrowserModelRecordSchema>;

export const WebBrowserModelConfigSchema = {
  type: "object",
  properties: {
    ...ModelConfigSchema.properties,
    ...WebBrowserModelSchema.properties,
  },
  required: [...ModelConfigSchema.required, ...WebBrowserModelSchema.required],
  additionalProperties: false,
} as const satisfies DataPortSchemaObject;

export type WebBrowserModelConfig = FromSchema<typeof WebBrowserModelConfigSchema>;

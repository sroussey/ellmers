/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type {
  AiProviderRunFn,
  ModelSearchResultItem,
  ModelSearchTaskInput,
  ModelSearchTaskOutput,
} from "@workglow/ai";
import { normalizedModelSearchQuery } from "../../common/modelSearchQuery";
import { GOOGLE_GEMINI } from "./Gemini_Constants";

interface GeminiModelEntry {
  readonly label: string;
  readonly value: string;
  readonly tasks?: readonly string[];
}

const GEMINI_MODELS: readonly GeminiModelEntry[] = [
  { label: "gemini-3.1-flash", value: "gemini-3.1-flash" },
  { label: "gemini-3.1-pro", value: "gemini-3.1-pro" },
  { label: "gemini-2.5-flash", value: "gemini-2.5-flash" },
  { label: "gemini-2.5-pro", value: "gemini-2.5-pro" },
  { label: "gemini-2.0-flash", value: "gemini-2.0-flash" },
  { label: "gemini-1.5-pro", value: "gemini-1.5-pro" },
  { label: "gemini-1.5-flash", value: "gemini-1.5-flash" },
  // Image-output models
  {
    label: "gemini-2.5-flash-image",
    value: "gemini-2.5-flash-image",
    tasks: ["ImageGenerateTask", "ImageEditTask"],
  },
  {
    label: "imagen-4.0-generate-001",
    value: "imagen-4.0-generate-001",
    tasks: ["ImageGenerateTask"],
  },
];

export const Gemini_ModelSearch: AiProviderRunFn<
  ModelSearchTaskInput,
  ModelSearchTaskOutput
> = async (input) => {
  const q = normalizedModelSearchQuery(input.query);
  const filtered = q
    ? GEMINI_MODELS.filter(
        (m) => m.value.toLowerCase().includes(q) || m.label.toLowerCase().includes(q)
      )
    : GEMINI_MODELS;
  const results: ModelSearchResultItem[] = filtered.map((m) => ({
    id: m.value,
    label: m.label,
    description: "",
    record: {
      model_id: m.value,
      provider: GOOGLE_GEMINI,
      title: m.value,
      description: "",
      tasks: m.tasks ? [...m.tasks] : [],
      provider_config: { model_name: m.value },
      metadata: {},
    },
    raw: m,
  }));
  return { results };
};

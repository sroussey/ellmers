/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type {
  AiProviderStreamFn,
  TextLanguageDetectionTaskInput,
  TextLanguageDetectionTaskOutput,
} from "@workglow/ai";
import { bridgeProgress } from "@workglow/ai";
import { PermanentJobError } from "@workglow/job-queue";
import type { StreamEvent } from "@workglow/task-graph";
import { loadTfmpTasksTextSDK } from "./TFMP_Client";
import { TFMPModelConfig } from "./TFMP_ModelSchema";
import { getModelTask } from "./TFMP_Runtime";

export const TFMP_TextLanguageDetection: AiProviderStreamFn<
  TextLanguageDetectionTaskInput,
  TextLanguageDetectionTaskOutput,
  TFMPModelConfig
> = async function* (
  input,
  model,
  signal
): AsyncIterable<StreamEvent<TextLanguageDetectionTaskOutput>> {
  const maxLanguages = input.maxLanguages === 0 ? -1 : input.maxLanguages;

  const { LanguageDetector } = await loadTfmpTasksTextSDK();
  const textLanguageDetector = yield* bridgeProgress((cb) =>
    getModelTask(
      model!,
      {
        maxLanguages,
      },
      cb,
      signal,
      LanguageDetector
    )
  );
  const result = textLanguageDetector.detect(input.text);

  if (!result.languages?.[0]?.languageCode) {
    throw new PermanentJobError("Failed to detect language: Empty result");
  }

  const languages = result.languages.map((language: any) => ({
    language: language.languageCode,
    score: language.probability,
  }));

  yield { type: "finish", data: { languages } };
};

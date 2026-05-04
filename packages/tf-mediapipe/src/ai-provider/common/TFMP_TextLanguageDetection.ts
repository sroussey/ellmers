/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type {
  AiProviderRunFn,
  TextLanguageDetectionTaskInput,
  TextLanguageDetectionTaskOutput,
} from "@workglow/ai";
import { PermanentJobError } from "@workglow/job-queue";
import { loadTfmpTasksTextSDK } from "./TFMP_Client";
import { TFMPModelConfig } from "./TFMP_ModelSchema";
import { getModelTask } from "./TFMP_Runtime";

export const TFMP_TextLanguageDetection: AiProviderRunFn<
  TextLanguageDetectionTaskInput,
  TextLanguageDetectionTaskOutput,
  TFMPModelConfig
> = async (input, model, onProgress, signal) => {
  const maxLanguages = input.maxLanguages === 0 ? -1 : input.maxLanguages;

  const { LanguageDetector } = await loadTfmpTasksTextSDK();
  const textLanguageDetector = await getModelTask(
    model!,
    {
      maxLanguages,
    },
    onProgress,
    signal,
    LanguageDetector
  );
  const result = textLanguageDetector.detect(input.text);

  if (!result.languages?.[0]?.languageCode) {
    throw new PermanentJobError("Failed to detect language: Empty result");
  }

  const languages = result.languages.map((language: any) => ({
    language: language.languageCode,
    score: language.probability,
  }));

  return {
    languages,
  };
};

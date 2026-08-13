/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { ModelPricing } from "@workglow/ai";
import { useEffect, useState } from "react";
import { lookupModelPricing } from "./lookupModelPricing";

/** Async rate-card lookup for a model id, suitable for render-time cost lines. */
export function useModelPricing(modelId: string | undefined): ModelPricing | undefined {
  const [result, setResult] = useState<{
    readonly modelId: string | undefined;
    readonly pricing: ModelPricing | undefined;
  }>({ modelId, pricing: undefined });

  if (result.modelId !== modelId) {
    setResult({ modelId, pricing: undefined });
  }

  useEffect(() => {
    if (!modelId) return;
    let cancelled = false;
    void lookupModelPricing(modelId).then((next) => {
      if (!cancelled) setResult({ modelId, pricing: next });
    });
    return () => {
      cancelled = true;
    };
  }, [modelId]);

  return result.modelId === modelId ? result.pricing : undefined;
}

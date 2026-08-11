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
  const [pricing, setPricing] = useState<ModelPricing | undefined>(undefined);

  useEffect(() => {
    let cancelled = false;
    if (!modelId) {
      setPricing(undefined);
      return;
    }
    void lookupModelPricing(modelId).then((next) => {
      if (!cancelled) setPricing(next);
    });
    return () => {
      cancelled = true;
    };
  }, [modelId]);

  return pricing;
}

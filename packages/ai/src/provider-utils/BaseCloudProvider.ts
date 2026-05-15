/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { ModelConfig } from "../model/ModelSchema";
import type { AiProvider } from "../provider/AiProvider";
import type {
  AiProviderPreviewRunFn,
  AiProviderRunFnRegistration,
} from "../provider/AiProviderRegistry";

/**
 * Static metadata describing a cloud-backed AI provider.
 *
 * Shared across each provider's worker- and main-thread class shells so the
 * declarations live in one place and only the constructor base differs.
 */
export interface CloudProviderMetadata {
  readonly name: string;
  readonly displayName: string;
  readonly isLocal?: boolean;
  readonly supportsBrowser?: boolean;
}

/**
 * Constructor signature mirroring {@link AiProvider}'s public constructor.
 * Declared structurally so callers can pass either the worker or main-thread
 * `AiProvider` import without forcing this module to import either at runtime.
 */
type AiProviderCtor<TModelConfig extends ModelConfig> = abstract new (
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  promiseRunFns?: readonly AiProviderRunFnRegistration<any, any, TModelConfig>[],
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  previewTasks?: Record<string, AiProviderPreviewRunFn<any, any, TModelConfig>>
) => AiProvider<TModelConfig>;

/**
 * Build a concrete provider class by mixing the shared declarations from
 * {@link CloudProviderMetadata} into a caller-supplied {@link AiProvider} base.
 *
 * Each cloud provider package keeps two thin shells (worker + main-thread)
 * and supplies the appropriate `AiProvider` import to this factory. The
 * generated class implements `name`, `displayName`, `isLocal`, and
 * `supportsBrowser` from the metadata literal; the constructor is inherited
 * unchanged from the base.
 */
export function createCloudProviderClass<TModelConfig extends ModelConfig>(
  Base: AiProviderCtor<TModelConfig>,
  meta: CloudProviderMetadata
) {
  abstract class CloudProvider extends Base {
    readonly name = meta.name;
    readonly displayName = meta.displayName;
    readonly isLocal = meta.isLocal ?? false;
    readonly supportsBrowser = meta.supportsBrowser ?? true;
  }
  return CloudProvider as unknown as new (
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    promiseRunFns?: readonly AiProviderRunFnRegistration<any, any, TModelConfig>[],
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    previewTasks?: Record<string, AiProviderPreviewRunFn<any, any, TModelConfig>>
  ) => AiProvider<TModelConfig> & {
    readonly name: string;
    readonly displayName: string;
    readonly isLocal: boolean;
    readonly supportsBrowser: boolean;
  };
}

/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Coarse shared thinking / reasoning dial on {@link ModelConfig.effort}.
 * Native `provider_config` thinking knobs always win when set.
 */
export const MODEL_EFFORTS = ["none", "low", "medium", "high", "extra", "ultra"] as const;

export type ModelEffort = (typeof MODEL_EFFORTS)[number];

export function isModelEffort(value: unknown): value is ModelEffort {
  return typeof value === "string" && (MODEL_EFFORTS as readonly string[]).includes(value);
}

/**
 * Class-level effort support reported by a provider. `default` is display-only
 * (placeholder text); it is never persisted onto a model record.
 */
export interface ModelEffortPolicy {
  readonly supported: readonly ModelEffort[];
  readonly default: ModelEffort | undefined;
}

export function sanitizeEffortOptions(value: unknown): ModelEffort[] | undefined {
  if (!Array.isArray(value)) return undefined;
  return value.filter(isModelEffort);
}

export function readEffortOptions(model: object): ModelEffort[] | undefined {
  if (!("effort_options" in model)) return undefined;
  const value = (model as { effort_options?: unknown }).effort_options;
  if (!Array.isArray(value)) return undefined;
  return sanitizeEffortOptions(value) ?? [];
}

export function stampEffortOptions<T extends object>(
  record: T,
  policy: ModelEffortPolicy | undefined
): T & { effort_options?: ModelEffort[] } {
  if (policy === undefined) return record;
  return { ...record, effort_options: [...policy.supported] };
}

export function enabledEffortsForModel(
  model: object,
  policy: ModelEffortPolicy | undefined
): readonly ModelEffort[] | undefined {
  const pinned = readEffortOptions(model);
  if (pinned !== undefined) return pinned;
  return policy?.supported;
}

/**
 * Resolves the effort to map onto a provider request, or `undefined` when the
 * coarse dial does not apply. Returning the value rather than a boolean is what
 * lets a call site use it without re-asserting the type. Native
 * `provider_config` knobs always win separately; this only gates the dial.
 */
export function resolveEnabledEffort(
  model: object | undefined,
  policy: ModelEffortPolicy | undefined
): ModelEffort | undefined {
  if (model === undefined) return undefined;
  const effort = (model as { effort?: unknown }).effort;
  if (!isModelEffort(effort)) return undefined;
  const enabled = enabledEffortsForModel(model, policy);
  if (enabled !== undefined && !enabled.includes(effort)) return undefined;
  return effort;
}

export function effortPlaceholder(policy: ModelEffortPolicy | undefined): string {
  return policy?.default !== undefined ? `Default: ${policy.default}` : "Default";
}

/** Every level, no class default — the shape a provider uses to say "unrestricted". */
export const EFFORT_POLICY_ALL = {
  supported: MODEL_EFFORTS,
  default: undefined,
} as const satisfies ModelEffortPolicy;

/** No level at all — the model does not take a reasoning dial. */
export const EFFORT_POLICY_NONE = {
  supported: [],
  default: undefined,
} as const satisfies ModelEffortPolicy;

/** Reads the provider-side model id a policy matches on. Empty when unset. */
export function readModelName(model: object | undefined): string {
  const config = (model as { provider_config?: { model_name?: unknown } } | undefined)
    ?.provider_config;
  return String(config?.model_name ?? "").trim();
}

/** Matches a provider model id. A function covers what a regex cannot express. */
export type EffortIdMatcher = RegExp | ((id: string) => boolean);

export interface EffortPolicyRule {
  readonly when: EffortIdMatcher | readonly EffortIdMatcher[];
  readonly policy: ModelEffortPolicy;
}

export interface EffortPolicySpec {
  /** Evaluated in order; the first rule whose matcher accepts the id wins. */
  readonly rules: readonly EffortPolicyRule[];
  /**
   * Used for an id no rule matched **and** for a model carrying no id at all.
   * One answer for both on purpose: a policy that reads an absent id as
   * permissive and an unrecognized one as restrictive is stating two different
   * things about the same amount of knowledge.
   */
  readonly fallback: ModelEffortPolicy;
}

export type ModelEffortPolicyFn = (model: object | undefined) => ModelEffortPolicy;

function matches(matcher: EffortIdMatcher, id: string): boolean {
  return typeof matcher === "function" ? matcher(id) : matcher.test(id);
}

function toMatchers(
  when: EffortIdMatcher | readonly EffortIdMatcher[]
): readonly EffortIdMatcher[] {
  return when instanceof RegExp || typeof when === "function" ? [when] : when;
}

/**
 * Builds a provider's class-level effort policy from id matchers. Every
 * provider answers the same question — "does this model id take the coarse
 * dial, and what is its default?" — so only the matchers belong to the
 * provider; the lookup, the id read and the fallback rule do not.
 */
export function makeEffortPolicy(spec: EffortPolicySpec): ModelEffortPolicyFn {
  const rules = spec.rules.map((rule) => ({
    matchers: toMatchers(rule.when),
    policy: rule.policy,
  }));
  return (model: object | undefined): ModelEffortPolicy => {
    const id = readModelName(model);
    if (id.length === 0) return spec.fallback;
    for (const rule of rules) {
      if (rule.matchers.some((matcher) => matches(matcher, id))) return rule.policy;
    }
    return spec.fallback;
  };
}

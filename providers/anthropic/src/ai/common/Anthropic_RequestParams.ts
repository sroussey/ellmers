/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { getLogger } from "@workglow/util/worker";
import type { AnthropicModelConfig } from "./Anthropic_ModelSchema";

/**
 * Highest Claude generation that still accepts `temperature` / `top_p`.
 * Newer generations reject them with HTTP 400, which maps to a
 * non-retryable `PermanentJobError`.
 */
export const ANTHROPIC_LAST_SAMPLING_MAJOR = 4;
/** Highest minor within {@link ANTHROPIC_LAST_SAMPLING_MAJOR} that accepts them. */
export const ANTHROPIC_LAST_SAMPLING_MINOR = 6;

/**
 * A numeric id segment this long is a release date (`20250514`), not a minor
 * version. Without this rule `claude-sonnet-4-20250514` parses as minor
 * 20250514 and is wrongly treated as a post-cutoff generation.
 */
const DATE_SEGMENT = /^\d{6,}$/;
const NUMERIC_SEGMENT = /^\d+$/;
const CLAUDE_PREFIX = "claude-";
/** Families that never accepted sampling parameters, whatever their version. */
const REJECTED_FAMILY = /^claude-(?:fable|mythos)(?:$|[-.])/;

interface ParsedAnthropicModelId {
  /** Empty for the bare `claude-2.1` shape, which carries no family name. */
  readonly family: string;
  readonly major: number;
  readonly minor: number | undefined;
}

/**
 * Parses the three id shapes Anthropic has shipped:
 * - modern `claude-<family>-<major>[-<minor>][-<date>]` (`claude-opus-4-8`)
 * - legacy `claude-<major>[-<minor>]-<family>[-<date>]` (`claude-3-5-sonnet-20241022`)
 * - bare `claude-[instant-]<major>[.<minor>]` (`claude-2.1`, `claude-instant-1.2`)
 *
 * Returns `undefined` for anything else, including non-Claude ids.
 */
export function parseAnthropicModelId(id: string): ParsedAnthropicModelId | undefined {
  const normalized = id.trim().toLowerCase();
  if (!normalized.startsWith(CLAUDE_PREFIX)) return undefined;

  let rest = normalized.slice(CLAUDE_PREFIX.length);
  if (rest.length === 0) return undefined;

  if (rest.startsWith("instant-")) rest = rest.slice("instant-".length);
  const bare = /^(\d+)(?:\.(\d+))?$/.exec(rest);
  if (bare) {
    return {
      family: "",
      major: Number(bare[1]),
      minor: bare[2] === undefined ? undefined : Number(bare[2]),
    };
  }

  const segments = rest.split("-").filter((segment) => segment.length > 0);
  if (segments.length < 2) return undefined;

  const isVersionSegment = (segment: string | undefined): boolean =>
    segment !== undefined && NUMERIC_SEGMENT.test(segment) && !DATE_SEGMENT.test(segment);

  // Legacy shape leads with the version: claude-3-5-sonnet-20241022.
  if (isVersionSegment(segments[0])) {
    const major = Number(segments[0]);
    let index = 1;
    let minor: number | undefined;
    if (isVersionSegment(segments[index])) {
      minor = Number(segments[index]);
      index += 1;
    }
    const family = segments[index];
    if (family === undefined || NUMERIC_SEGMENT.test(family)) return undefined;
    return { family, major, minor };
  }

  // Modern shape leads with the family: claude-opus-4-8.
  if (!isVersionSegment(segments[1])) return undefined;
  return {
    family: segments[0]!,
    major: Number(segments[1]),
    minor: isVersionSegment(segments[2]) ? Number(segments[2]) : undefined,
  };
}

interface AnthropicSamplingProviderConfig {
  readonly model_name?: string;
  readonly sampling_params?: "send" | "omit";
}

/**
 * Whether the configured model accepts `temperature` / `top_p`.
 *
 * This is an allow-list of generations known to accept them, not a deny-list
 * of the ones that reject them: an id that does not match a known-accepting
 * shape is treated as rejecting. A wrong `false` changes sampling behavior; a
 * wrong `true` is an unrecoverable 400, so an unrecognized id defaults to
 * omitting. `provider_config.sampling_params` overrides the decision either way.
 */
export function anthropicAcceptsSamplingParams(model: AnthropicModelConfig | undefined): boolean {
  const config = model?.provider_config as AnthropicSamplingProviderConfig | undefined;

  const override = config?.sampling_params;
  if (override === "send") return true;
  if (override === "omit") return false;

  const id = (config?.model_name ?? "").trim().toLowerCase();
  if (REJECTED_FAMILY.test(id)) return false;

  const parsed = parseAnthropicModelId(id);
  if (parsed === undefined) return false;
  if (parsed.major > ANTHROPIC_LAST_SAMPLING_MAJOR) return false;
  // A missing minor means generation `.0` (e.g. `claude-sonnet-4-20250514`),
  // which predates the cutoff — deliberately permissive.
  if (
    parsed.major === ANTHROPIC_LAST_SAMPLING_MAJOR &&
    parsed.minor !== undefined &&
    parsed.minor > ANTHROPIC_LAST_SAMPLING_MINOR
  ) {
    return false;
  }
  return true;
}

interface AnthropicSamplingInput {
  readonly temperature?: number;
  readonly topP?: number;
}

/**
 * Copies the caller's sampling fields onto an Anthropic request body when the
 * model accepts them. On a rejecting model the keys are left absent (rather
 * than set to `undefined`) and a single warning names everything dropped, so
 * the user's setting becoming a no-op is visible without failing the request.
 *
 * Call this after {@link applyAnthropicThinkingParams}: whether the request
 * carries extended thinking decides whether sampling is legal at all.
 */
export function applyAnthropicSamplingParams(
  params: Record<string, unknown>,
  input: AnthropicSamplingInput,
  model: AnthropicModelConfig | undefined
): void {
  const supplied: Array<readonly [wireName: string, value: number]> = [];
  if (input.temperature !== undefined) supplied.push(["temperature", input.temperature]);
  if (input.topP !== undefined) supplied.push(["top_p", input.topP]);
  if (supplied.length === 0) return;

  // Extended thinking (`thinking.type = "enabled"`) rejects sampling parameters.
  // Scoped to "enabled" on purpose: `{type:"adaptive"}` on 4.6+ is the
  // recommended configuration and does accept them. Requires that thinking has
  // already been merged onto `params`.
  const thinking = params.thinking as { type?: string } | undefined;
  if (thinking?.type === "enabled") {
    getLogger().warn("Anthropic extended thinking is on; dropping sampling parameters.", {
      model: model?.provider_config?.model_name ?? "",
      dropped: supplied.map(([wireName]) => wireName),
    });
    return;
  }

  if (anthropicAcceptsSamplingParams(model)) {
    for (const [wireName, value] of supplied) params[wireName] = value;
    return;
  }

  getLogger().warn("Anthropic model rejects sampling parameters; dropping them.", {
    model: model?.provider_config?.model_name ?? "",
    dropped: supplied.map(([wireName]) => wireName),
  });
}

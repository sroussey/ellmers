/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { DataPortSchemaObject } from "@workglow/util/worker";

/**
 * Per-million-token rates for one model.
 *
 * Rates are in USD per 1,000,000 tokens because that is how providers publish
 * them, so a rate card transcribes without arithmetic.
 *
 * `cacheStoragePerHour` prices a provider-side cache billed by token-hours
 * (e.g. Gemini CachedContent) rather than by a one-off write.
 */
export interface ModelPricingBase {
  input?: number;
  output?: number;
  cached?: number;
  cacheWrite?:
    | number
    | {
        cacheWrite5m?: number;
        cacheWrite1h?: number;
      };
  cacheStoragePerHour?: number;
}

/**
 * A rate card that replaces the base one when the prompt falls in a token
 * range, which is how long-context surcharges are published (Anthropic and
 * Gemini both price prompts over 200K tokens differently).
 *
 * Both bounds are inclusive and either may be omitted for an open end. The
 * first tier whose range contains the prompt wins, so tiers are declared in
 * published order and an overlap at the boundary resolves to the earlier one.
 */
export interface ModelUsageTier {
  minInputTokens?: number;
  maxInputTokens?: number;
  pricing: ModelPricingBase;
}

/**
 * A rate card that replaces the base one inside a daily clock window, which is
 * how time-of-day discounts are published (DeepSeek's runs 16:30-00:30 UTC).
 *
 * `start` and `end` are `HH:MM` in **UTC** — providers publish these windows in
 * UTC and a local-time reading would silently misprice by the host's offset.
 * The window is `[start, end)`, and an `end` at or before `start` wraps
 * midnight. The first matching tier wins.
 */
export interface ModelTimingTier {
  /** Inclusive start of the window, `HH:MM` UTC. */
  start: string;
  /** Exclusive end of the window, `HH:MM` UTC. */
  end: string;
  pricing: ModelPricingBase;
}

export interface ModelPricing extends ModelPricingBase {
  currency: string;
  batch?: ModelPricingBase;
  usageTiers?: ModelUsageTier[];
  timingTiers?: ModelTimingTier[];
}

export const FREE_LOCAL_PRICING: ModelPricing = {
  currency: "USD",
  input: 0,
  output: 0,
  cached: 0,
  cacheWrite: 0,
  cacheStoragePerHour: undefined,
};

/**
 * Characters that may precede a table key inside a longer model id: vendor
 * namespaces (`anthropic.claude-…`, `bedrock/claude-…`) and separators.
 */
const KEY_PREFIX_BOUNDARY = new Set(["-", "_", ":", "/", "@", ".", "|"]);

/**
 * Characters that may follow a table key inside a longer model id. `.` is
 * deliberately absent: a dot after a key marks a different point release with
 * its own rate card (`gpt-5.6` is not `gpt-5`), while a dash marks a dated or
 * sized variant of the same one (`gpt-4o-2024-08-06` is `gpt-4o`).
 */
const KEY_SUFFIX_BOUNDARY = new Set(["-", "_", ":", "/", "@"]);

/**
 * Resolve a model id against a provider's static list-pricing table.
 *
 * Exact id wins; otherwise the longest key that appears in the id on both a
 * leading and trailing segment boundary wins. A model the table does not name
 * stays unpriced so cost estimation reports nothing rather than a wrong
 * number borrowed from a sibling.
 *
 * `vendorPrefixes` are stripped (lower-cased, longest first is the caller's
 * responsibility) before matching, so `anthropic/claude-sonnet-5` resolves the
 * same as the bare id.
 */
export function resolveModelPricingFromTable(
  table: Readonly<Record<string, ModelPricing>>,
  modelId: string | undefined,
  vendorPrefixes: readonly string[] = []
): ModelPricing | undefined {
  if (!modelId) return undefined;
  let id = modelId.trim().toLowerCase();
  for (const prefix of vendorPrefixes) {
    if (id.startsWith(prefix)) {
      id = id.slice(prefix.length);
      break;
    }
  }

  // `Object.hasOwn`, not truthiness: a bare index would hand back
  // `Object.prototype.constructor` for a model literally named "constructor".
  if (Object.hasOwn(table, modelId)) return table[modelId];
  if (Object.hasOwn(table, id)) return table[id];

  let best: string | undefined;
  for (const key of Object.keys(table)) {
    if (best !== undefined && key.length <= best.length) continue;
    const at = id.indexOf(key);
    if (at < 0) continue;
    if (at > 0 && !KEY_PREFIX_BOUNDARY.has(id[at - 1]!)) continue;
    const after = id[at + key.length];
    if (after !== undefined && !KEY_SUFFIX_BOUNDARY.has(after)) continue;
    best = key;
  }
  return best === undefined ? undefined : table[best];
}

const MINUTES_PER_HOUR = 60;

/** Minutes past 00:00 for an `HH:MM` clock time, or `undefined` if malformed. */
function parseClockMinutes(value: string): number | undefined {
  const match = /^([01][0-9]|2[0-3]):([0-5][0-9])$/.exec(value);
  if (!match) return undefined;
  return Number(match[1]) * MINUTES_PER_HOUR + Number(match[2]);
}

/**
 * Whether `minutes` past midnight UTC falls in `[start, end)`.
 *
 * An `end` before `start` wraps midnight, which is the normal shape for an
 * off-peak discount. `start === end` is a zero-length window that matches
 * nothing rather than the whole day: a rate card that names the same instant
 * twice states no window, and reading it as "always" would apply a discount
 * around the clock.
 */
function isWithinWindow(minutes: number, start: number, end: number): boolean {
  if (start === end) return false;
  return start < end ? minutes >= start && minutes < end : minutes >= start || minutes < end;
}

function selectUsageTier(
  tiers: readonly ModelUsageTier[] | undefined,
  inputTokens: number | undefined
): ModelUsageTier | undefined {
  if (!tiers || inputTokens === undefined) return undefined;
  return tiers.find(
    (tier) =>
      inputTokens >= (tier.minInputTokens ?? 0) &&
      inputTokens <= (tier.maxInputTokens ?? Number.POSITIVE_INFINITY)
  );
}

function selectTimingTier(
  tiers: readonly ModelTimingTier[] | undefined,
  at: Date | number | undefined
): ModelTimingTier | undefined {
  if (!tiers || tiers.length === 0) return undefined;
  const date = at === undefined ? new Date() : at instanceof Date ? at : new Date(at);
  const minutes = date.getUTCHours() * MINUTES_PER_HOUR + date.getUTCMinutes();
  if (!Number.isFinite(minutes)) return undefined;
  return tiers.find((tier) => {
    const start = parseClockMinutes(tier.start);
    const end = parseClockMinutes(tier.end);
    // A window nobody can parse is skipped, not guessed at: a malformed clock
    // string must never widen or narrow what a discount applies to.
    return start !== undefined && end !== undefined && isWithinWindow(minutes, start, end);
  });
}

/** Fields a tier may restate. `undefined` in the overlay keeps the base rate. */
function overlayRates(base: ModelPricingBase, over: ModelPricingBase): ModelPricingBase {
  return {
    input: over.input ?? base.input,
    output: over.output ?? base.output,
    cached: over.cached ?? base.cached,
    cacheWrite: over.cacheWrite ?? base.cacheWrite,
    cacheStoragePerHour: over.cacheStoragePerHour ?? base.cacheStoragePerHour,
  };
}

export interface EffectiveRateOptions {
  /**
   * Prompt size in tokens, used to pick a {@link ModelUsageTier}. This is the
   * whole prompt — plain, cache-read and cache-written input together — because
   * that is what a provider's context threshold measures. Omitted means no
   * usage tier applies.
   */
  readonly inputTokens?: number;
  /**
   * When the request ran, used to pick a {@link ModelTimingTier}. Defaults to
   * now, which is right for a live run and wrong for a replayed one — pass the
   * request's own instant when pricing after the fact.
   */
  readonly at?: Date | number;
}

/**
 * Collapse a rate card and its tiers into the single set of rates that applies
 * to one request.
 *
 * A matching usage tier is applied first and a matching timing tier second, so
 * a time-of-day discount overrides a long-context surcharge on the fields it
 * restates and leaves the rest alone. Each tier overrides only the fields it
 * declares, so a tier that names `input` and `output` keeps the base
 * `cacheWrite` instead of silently dropping it.
 *
 * `batch` is deliberately not consulted: nothing in the pipeline runs a batch
 * request yet, and a rate that no caller can select would only make estimates
 * disagree with invoices.
 */
export function resolveEffectiveRates(
  pricing: ModelPricing,
  options: EffectiveRateOptions = {}
): ModelPricingBase {
  let rates: ModelPricingBase = {
    input: pricing.input,
    output: pricing.output,
    cached: pricing.cached,
    cacheWrite: pricing.cacheWrite,
    cacheStoragePerHour: pricing.cacheStoragePerHour,
  };

  const usageTier = selectUsageTier(pricing.usageTiers, options.inputTokens);
  if (usageTier) rates = overlayRates(rates, usageTier.pricing);

  const timingTier = selectTimingTier(pricing.timingTiers, options.at);
  if (timingTier) rates = overlayRates(rates, timingTier.pricing);

  return rates;
}

/**
 * The rate properties every card carries, shared by the model's own card and by
 * the nested `batch` and per-tier cards so all four accept the same rates.
 */
const RATE_PROPERTIES = {
  input: {
    type: "number",
    title: "Input Rate",
    description: "USD per 1M input tokens",
    "x-ui-order": 2,
  },
  output: {
    type: "number",
    title: "Output Rate",
    description: "USD per 1M output tokens",
    "x-ui-order": 3,
  },
  cached: {
    type: "number",
    title: "Cached Input Rate",
    description: "USD per 1M cached input tokens",
    "x-ui-order": 4,
  },
  cacheWrite: {
    title: "Cache Write Rate",
    description: "USD per 1M tokens written to cache, or rates by TTL",
    "x-ui-order": 5,
    anyOf: [
      { type: "number", title: "Flat Rate" },
      {
        type: "object",
        title: "Tiered Write Rates",
        properties: {
          cacheWrite5m: { type: "number", title: "Cache Write (5m TTL)" },
          cacheWrite1h: { type: "number", title: "Cache Write (1h TTL)" },
        },
        additionalProperties: false,
      },
    ],
  },
  cacheStoragePerHour: {
    type: "number",
    title: "Cache Storage Per Hour",
    description: "USD per 1M token-hours stored",
    "x-ui-order": 6,
  },
} as const;

/** A nested rate card: the shared rates and nothing else. */
const RATE_CARD_SCHEMA = {
  type: "object",
  properties: RATE_PROPERTIES,
  additionalProperties: false,
} as const;

/** `HH:MM` on a 24-hour clock. */
const CLOCK_TIME_PATTERN = "^([01][0-9]|2[0-3]):[0-5][0-9]$";

/**
 * JSON schema for per-million-token model pricing rates.
 *
 * A model record carries a card only as a deliberate override — a negotiated
 * rate, or a model no provider table names. Absent is the ordinary case, and
 * the provider's own table answers instead: a rate correction there then
 * reaches every model already added, rather than being shadowed by whatever
 * the published rates were on the day the model was added.
 */
export const ModelPricingSchema = {
  type: "object",
  title: "Pricing",
  description: "Per-million-token rates for this model.",
  properties: {
    currency: { type: "string", default: "USD", title: "Currency", "x-ui-order": 1 },
    ...RATE_PROPERTIES,
    batch: {
      ...RATE_CARD_SCHEMA,
      title: "Batch Rates",
      description: "Rates for a batched request. Not yet applied to cost estimates.",
      "x-ui-order": 7,
    },
    usageTiers: {
      type: "array",
      title: "Usage Tiers",
      description: "Rates that replace the base ones for a prompt in a token range.",
      "x-ui-order": 8,
      items: {
        type: "object",
        properties: {
          minInputTokens: { type: "number", title: "Min Input Tokens" },
          maxInputTokens: { type: "number", title: "Max Input Tokens" },
          pricing: { ...RATE_CARD_SCHEMA, title: "Tier Rates" },
        },
        required: ["pricing"],
        additionalProperties: false,
      },
    },
    timingTiers: {
      type: "array",
      title: "Timing Tiers",
      description: "Rates that replace the base ones inside a daily UTC window.",
      "x-ui-order": 9,
      items: {
        type: "object",
        properties: {
          start: {
            type: "string",
            title: "Start (UTC)",
            description: "HH:MM, inclusive",
            pattern: CLOCK_TIME_PATTERN,
          },
          end: {
            type: "string",
            title: "End (UTC)",
            description: "HH:MM, exclusive; before the start to wrap midnight",
            pattern: CLOCK_TIME_PATTERN,
          },
          pricing: { ...RATE_CARD_SCHEMA, title: "Tier Rates" },
        },
        required: ["start", "end", "pricing"],
        additionalProperties: false,
      },
    },
  },
  required: ["currency"],
  additionalProperties: false,
} as const satisfies DataPortSchemaObject;

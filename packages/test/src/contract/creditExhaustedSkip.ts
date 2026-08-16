/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { it as vitestIt } from "vitest";

/**
 * Live provider tests skip (rather than fail) when the account is out of
 * credits. A key being present is not the same as the account being able to
 * pay; HuggingFace / OpenRouter 402s, Anthropic's credit-balance error, and
 * OpenAI's `insufficient_quota` are billing, not product bugs.
 *
 * Rate limits (429 + `rate_limit_exceeded`) are NOT this: those are transient
 * and the existing retry policy handles them.
 */

const BILLING_CODES = new Set([
  "insufficient_quota",
  "billing_hard_limit_reached",
  "insufficient_credits",
]);

const CREDIT_MESSAGE =
  /insufficient credits|not enough credits|no credits remaining|out of credits|credit balance is too low|exceeded[\s\S]{0,80}credits|monthly included credits|payment required|exceeded your current quota|check your plan and billing|billing_hard_limit/i;

export function isCreditExhaustedError(err: unknown): boolean {
  const seen = new Set<unknown>();
  let current: unknown = err;
  while (current !== undefined && current !== null && !seen.has(current)) {
    seen.add(current);
    if (matchesCreditExhaustion(current)) return true;
    current = causeOf(current);
  }
  return false;
}

function matchesCreditExhaustion(err: unknown): boolean {
  if (typeof err === "string") return messageLooksLikeCreditExhaustion(err);

  if (!err || typeof err !== "object") return false;

  const rec = err as Record<string, unknown>;
  const status = numericStatus(rec);
  if (status === 402) return true;

  const code = stringish(rec.code) ?? stringish(nested(rec.error, "code"));
  const type = stringish(rec.type) ?? stringish(nested(rec.error, "type"));
  if (code && BILLING_CODES.has(code)) return true;
  if (type && BILLING_CODES.has(type)) return true;

  const message = [
    stringish(rec.message),
    stringish(nested(rec.error, "message")),
    stringifyUnknown(err),
  ]
    .filter((part): part is string => typeof part === "string")
    .join("\n");
  return messageLooksLikeCreditExhaustion(message);
}

function messageLooksLikeCreditExhaustion(message: string): boolean {
  return (
    CREDIT_MESSAGE.test(message) ||
    /\bHTTP\s*402\b/i.test(message) ||
    /\bstatus(?:\s*code)?\s*[:=]\s*402\b/i.test(message)
  );
}

function numericStatus(rec: Record<string, unknown>): number | undefined {
  for (const key of ["status", "statusCode"] as const) {
    const value = rec[key];
    if (typeof value === "number" && Number.isFinite(value)) return value;
  }
  const nestedStatus = nested(rec.error, "status");
  if (typeof nestedStatus === "number" && Number.isFinite(nestedStatus)) return nestedStatus;
  return undefined;
}

function nested(value: unknown, key: string): unknown {
  if (!value || typeof value !== "object") return undefined;
  return (value as Record<string, unknown>)[key];
}

function stringish(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function stringifyUnknown(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}

function causeOf(err: unknown): unknown {
  if (!err || typeof err !== "object") return undefined;
  return (err as { cause?: unknown }).cause;
}

export function creditSkipNote(err: unknown): string {
  const message = err instanceof Error ? err.message : String(err);
  return `skipped: provider out of credits (${message})`;
}

export async function runWithCreditSkip<T>(
  ctx: { skip: (note?: string) => void },
  fn: () => Promise<T> | T
): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    if (isCreditExhaustedError(err)) {
      ctx.skip(creditSkipNote(err));
      // vitest's skip() is `never` (throws). Mocks used in unit tests return.
      return undefined as T;
    }
    throw err;
  }
}

function wrapFn(fn: (...args: never[]) => unknown): (...args: never[]) => unknown {
  return async function wrapped(this: unknown, ...args: never[]): Promise<unknown> {
    try {
      return await fn.apply(this, args);
    } catch (err) {
      if (!isCreditExhaustedError(err)) throw err;
      const ctx = args[0] as { skip?: (note?: string) => void } | undefined;
      if (ctx && typeof ctx.skip === "function") {
        ctx.skip(creditSkipNote(err));
        return undefined;
      }
      // bun:test has no TestContext.skip; passing is "don't fail the test".
      console.warn(creditSkipNote(err));
      return undefined;
    }
  };
}

function wrapCallable(fn: CallableFunction): CallableFunction {
  return new Proxy(fn, {
    apply(target, thisArg, argArray: unknown[]) {
      const wrapped = argArray.map((arg) =>
        typeof arg === "function" ? wrapFn(arg as never) : arg
      );
      const result = Reflect.apply(target, thisArg, wrapped);
      return typeof result === "function" ? wrapCallable(result) : result;
    },
    get(target, prop, receiver) {
      const value = Reflect.get(target, prop, receiver);
      if (typeof value === "function") {
        return wrapCallable((value as CallableFunction).bind(target));
      }
      return value;
    },
  });
}

/** Drop-in `it` for live provider tests: credit/billing errors skip instead of fail. */
export const it = wrapCallable(vitestIt) as typeof vitestIt;

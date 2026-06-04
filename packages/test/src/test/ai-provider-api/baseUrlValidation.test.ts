/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { validateProviderBaseUrl } from "@workglow/ai/provider-utils";
import { ANTHROPIC_ALLOWED_HOSTS } from "@workglow/anthropic/ai";
import { OPENAI_ALLOWED_HOSTS } from "@workglow/openai/ai";
import { describe, expect, it } from "vitest";

describe("validateProviderBaseUrl (L-MAIN-02)", () => {
  describe("openai vendor", () => {
    const opts = {
      vendor: "openai" as const,
      allowHosts: OPENAI_ALLOWED_HOSTS,
      providerLabel: "OpenAI",
    };

    it("returns undefined for undefined input (SDK default)", () => {
      expect(validateProviderBaseUrl(undefined, opts)).toBeUndefined();
    });

    it("returns undefined for empty / whitespace input", () => {
      expect(validateProviderBaseUrl("", opts)).toBeUndefined();
      expect(validateProviderBaseUrl("   ", opts)).toBeUndefined();
    });

    it("accepts the official OpenAI host", () => {
      const result = validateProviderBaseUrl("https://api.openai.com/v1", opts);
      expect(result).toBeDefined();
      expect(new URL(result!).hostname).toBe("api.openai.com");
    });

    it("accepts any Azure OpenAI subdomain via suffix match", () => {
      const result = validateProviderBaseUrl(
        "https://my-tenant.openai.azure.com/openai/deployments",
        opts
      );
      expect(result).toBeDefined();
      expect(new URL(result!).hostname).toBe("my-tenant.openai.azure.com");
    });

    it("rejects HTTP for non-loopback hosts (prevents cleartext key)", () => {
      expect(() => validateProviderBaseUrl("http://api.openai.com/v1", opts)).toThrow(/https:\/\//);
    });

    it("rejects an unrelated host (prevents key exfiltration)", () => {
      expect(() => validateProviderBaseUrl("https://attacker.example.com/v1", opts)).toThrow(
        /not in the allow-list/
      );
    });

    it("rejects a host that only contains the allow-listed string", () => {
      // Suffix match must anchor at the right edge: an attacker host
      // ending with the legitimate domain (e.g. "evil-api.openai.com.attacker.io")
      // must NOT pass. URL parsing places the rightmost label as the TLD,
      // so hostname.endsWith("api.openai.com") would only match true suffixes.
      expect(() => validateProviderBaseUrl("https://evil-openai.com.attacker.io/v1", opts)).toThrow(
        /not in the allow-list/
      );
    });

    it("rejects an unparseable URL", () => {
      expect(() => validateProviderBaseUrl("not a url", opts)).toThrow(/not a valid URL/);
    });

    it("accepts an arbitrary host when trustedBaseUrl is true", () => {
      const result = validateProviderBaseUrl("https://gateway.example.com/openai/v1", {
        ...opts,
        trustedBaseUrl: true,
      });
      expect(result).toBeDefined();
      expect(new URL(result!).hostname).toBe("gateway.example.com");
    });

    it("still rejects HTTP under trustedBaseUrl (defense in depth)", () => {
      expect(() =>
        validateProviderBaseUrl("http://gateway.example.com/openai/v1", {
          ...opts,
          trustedBaseUrl: true,
        })
      ).toThrow(/https:\/\//);
    });

    it("auto-allows http://localhost without trustedBaseUrl (local-gateway use)", () => {
      const result = validateProviderBaseUrl("http://localhost:8080/v1", opts);
      expect(result).toBeDefined();
      expect(new URL(result!).hostname).toBe("localhost");
    });

    it("auto-allows http://127.0.0.1 without trustedBaseUrl", () => {
      const result = validateProviderBaseUrl("http://127.0.0.1:8080/v1", opts);
      expect(result).toBeDefined();
      expect(new URL(result!).hostname).toBe("127.0.0.1");
    });

    it("auto-allows http://[::1] without trustedBaseUrl", () => {
      const result = validateProviderBaseUrl("http://[::1]:8080/v1", opts);
      expect(result).toBeDefined();
      expect(new URL(result!).hostname).toBe("[::1]");
    });
  });

  describe("anthropic vendor", () => {
    const opts = {
      vendor: "anthropic" as const,
      allowHosts: ANTHROPIC_ALLOWED_HOSTS,
      providerLabel: "Anthropic",
    };

    it("accepts the official Anthropic host", () => {
      const result = validateProviderBaseUrl("https://api.anthropic.com", opts);
      expect(result).toBeDefined();
      expect(new URL(result!).hostname).toBe("api.anthropic.com");
    });

    it("rejects an OpenAI host for Anthropic", () => {
      expect(() => validateProviderBaseUrl("https://api.openai.com/v1", opts)).toThrow(
        /not in the allow-list/
      );
    });

    it("accepts an arbitrary enterprise gateway with trustedBaseUrl", () => {
      const result = validateProviderBaseUrl("https://anthropic.internal.corp/v1", {
        ...opts,
        trustedBaseUrl: true,
      });
      expect(result).toBeDefined();
    });
  });
});

---
"@workglow/ai": patch
"@workglow/openai": patch
"@workglow/anthropic": patch
---

#### ai / openai / anthropic (security, L-MAIN-02)

- Add `validateProviderBaseUrl` to `@workglow/ai/provider-utils`. Cloud
  SDKs send the API key in `Authorization: Bearer` to whatever
  `baseURL` they are constructed with, so an attacker-controlled
  `provider_config.base_url` (marketplace model definitions, workflow
  imports) could exfiltrate the key.
- `OpenAI_Client.getClient` and `Anthropic_Client.getClient` now reject
  any `base_url` whose hostname is not in the per-vendor allow-list
  (`api.openai.com`, `*.openai.azure.com` for OpenAI;
  `api.anthropic.com` for Anthropic) before constructing the SDK
  client. HTTPS is required, except that loopback hostnames
  (`localhost`, `127.0.0.1`, `[::1]`) auto-allow plain HTTP for the
  canonical local-gateway scenario (Ollama / LM Studio / vLLM with
  OpenAI shim) — the user cannot exfiltrate their own key to their
  own machine.
- Add `trustedBaseUrl` (boolean, default `false`, hidden in UI) to both
  provider config schemas. Operators can set it to allow a known-good
  enterprise gateway; the URL must still parse and use HTTPS.

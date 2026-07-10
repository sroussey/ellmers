# @workglow/openrouter

OpenRouter provider for `@workglow/ai`. OpenRouter is a unified gateway to many
model vendors behind an OpenAI-compatible chat API.

Exposes `./ai` (main-thread shell) and `./ai-runtime` (worker / inline runtime),
matching the other cloud providers. Supports the full chat capability set plus
OpenRouter-native controls (provider routing, reasoning, web search, and app
attribution) configured on the model record's `provider_config`.

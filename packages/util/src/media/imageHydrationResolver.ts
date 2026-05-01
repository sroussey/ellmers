/**
 * @copyright
 * Copyright 2026 Steven Roussey
 * All Rights Reserved
 */
import { registerInputResolver } from "../di/InputResolverRegistry";
import { normalizeToImageValue } from "./imageValue";
import type { ServiceRegistry } from "../di/ServiceRegistry";

/**
 * Resolver for `format: "image"` ports. Accepts the cross-boundary wire
 * forms and normalizes to `ImageValue`. Non-string non-recognized shapes
 * pass through (consumers normalize at their boundary).
 */
async function resolveImage(
  id: unknown,
  _format: string,
  _registry: ServiceRegistry,
): Promise<unknown> {
  const normalized = await normalizeToImageValue(id);
  if (normalized !== undefined) return normalized;
  if (typeof id === "string") {
    const preview = id.length > 32 ? `${id.slice(0, 32)}...` : id;
    throw new Error(
      `format:"image" resolver received an unsupported string "${preview}". ` +
        `Only data: URIs are handled. Register a sub-resolver for other schemes.`,
    );
  }
  return id;
}

registerInputResolver("image", resolveImage);

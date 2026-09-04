/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { WebSearchCapabilities, WebSearchRequest } from "./IWebSearchProvider";

/**
 * Request options this provider cannot serve, by input-port name.
 *
 * Empty means the provider can serve the request. `maxResults` is deliberately
 * absent: an over-large value is clamped to the provider's cap rather than
 * refused, because a caller asking for more results than exist is not stating a
 * requirement the way a domain restriction is.
 */
export function unhonorableOptions(
  capabilities: WebSearchCapabilities,
  request: WebSearchRequest
): string[] {
  const gaps: string[] = [];
  const wantsDomains = (request.includeDomains?.length ?? 0) > 0;
  const wantsExcludes = (request.excludeDomains?.length ?? 0) > 0;
  // Exclusion support defaults to inclusion support; a provider states it
  // separately only when the two genuinely differ.
  const excludeSupport = capabilities.excludeDomainFilter ?? capabilities.domainFilter;
  const includeBlocked = wantsDomains && capabilities.domainFilter === false;
  const excludeBlocked = wantsExcludes && excludeSupport === false;
  if (includeBlocked) gaps.push("includeDomains");
  if (excludeBlocked) gaps.push("excludeDomains");
  // Serving each direction alone is not serving both at once. Reported only
  // when neither direction is already refused, so the pair does not restate a
  // gap the caller has been told about.
  if (
    wantsDomains &&
    wantsExcludes &&
    !includeBlocked &&
    !excludeBlocked &&
    capabilities.exclusiveDomainDirections === true
  ) {
    gaps.push("includeDomains with excludeDomains");
  }
  const range = request.dateRange;
  const wantsDates = range !== undefined && (range.start !== undefined || range.end !== undefined);
  if (wantsDates && !capabilities.dateFilter) gaps.push("dateRange");
  if (request.includeAnswer === true && !capabilities.answer) gaps.push("includeAnswer");
  if (request.includeContent === true && !capabilities.content) gaps.push("includeContent");
  return gaps;
}

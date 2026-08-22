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
  if (capabilities.domainFilter === false) {
    if (wantsDomains) gaps.push("includeDomains");
    if (wantsExcludes) gaps.push("excludeDomains");
  }
  const range = request.dateRange;
  const wantsDates = range !== undefined && (range.start !== undefined || range.end !== undefined);
  if (wantsDates && !capabilities.dateFilter) gaps.push("dateRange");
  if (request.includeAnswer === true && !capabilities.answer) gaps.push("includeAnswer");
  if (request.includeContent === true && !capabilities.content) gaps.push("includeContent");
  return gaps;
}

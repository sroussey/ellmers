/**
 * @license
 * Copyright 2026 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { IHumanConnector, IHumanRequest, IHumanResponse } from "@workglow/util";
import { Container, HUMAN_CONNECTOR, resolveHumanConnector, ServiceRegistry } from "@workglow/util";
import { describe, expect, it } from "vitest";

class NoopConnector implements IHumanConnector {
  async send(request: IHumanRequest, _signal: AbortSignal): Promise<IHumanResponse> {
    return { requestId: request.requestId, action: "accept", content: undefined, done: true };
  }
}

function mkContext(registry: ServiceRegistry): { registry: ServiceRegistry } {
  return { registry };
}

describe("resolveHumanConnector", () => {
  it("returns the registered instance when present", () => {
    const container = new Container();
    const registry = new ServiceRegistry(container);
    const connector = new NoopConnector();
    registry.registerInstance(HUMAN_CONNECTOR, connector);
    expect(resolveHumanConnector(mkContext(registry))).toBe(connector);
  });

  it("throws a helpful error when HUMAN_CONNECTOR is not registered", () => {
    const container = new Container();
    const registry = new ServiceRegistry(container);
    expect(() => resolveHumanConnector(mkContext(registry))).toThrowError(
      /HUMAN_CONNECTOR not registered/
    );
  });
});

// original source: https://github.com/SegFaultx64/typescript-graph
// previous fork: https://github.com/sroussey/typescript-graph
// license: MIT

import { serialize, setLogger } from "@workglow/util";
import { Graph, NodeAlreadyExistsError, NodeDoesntExistError } from "@workglow/util/graph";
import { getTestingLogger } from "@workglow/util/test";
import { describe, expect, it } from "vitest";

// Simple synchronous hash (FNV-1a 32-bit) for strings / bytes.
// Non-cryptographic, use only for IDs / maps / cache keys etc.

export type HashInput = string | Uint8Array | ArrayBuffer;

export function hash(input: HashInput): string {
  const bytes = toBytes(input);

  let hash = 0x811c9dc5; // FNV offset basis (32-bit)

  for (let i = 0; i < bytes.length; i++) {
    hash ^= bytes[i];
    hash = (hash * 0x01000193) >>> 0; // FNV prime (32-bit), keep as uint32
  }

  return hash.toString(16).padStart(8, "0");
}

function toBytes(input: HashInput): Uint8Array {
  if (typeof input === "string") {
    if (typeof TextEncoder !== "undefined") {
      return new TextEncoder().encode(input);
    }
    // Fallback: naive UTF-16 -> bytes (Node < v11, some environments)
    const bytes: number[] = [];
    for (let i = 0; i < input.length; i++) {
      const code = input.charCodeAt(i);
      if (code < 0x80) {
        bytes.push(code);
      } else if (code < 0x800) {
        bytes.push(0xc0 | (code >> 6), 0x80 | (code & 0x3f));
      } else {
        bytes.push(0xe0 | (code >> 12), 0x80 | ((code >> 6) & 0x3f), 0x80 | (code & 0x3f));
      }
    }
    return new Uint8Array(bytes);
  }

  if (input instanceof Uint8Array) {
    return input;
  }

  // ArrayBuffer
  return new Uint8Array(input);
}

export const nodeIdentity = (n: any) => hash(serialize(n as Record<string, any>));
export const edgeIdentity = (edge: any, node1Identity: any, node2Identity: any) => {
  const h1 = typeof edge === "object" ? hash(serialize(edge as Record<string, any>)) : "";
  return `${String(node1Identity)}-${String(node2Identity)}-${h1}`;
};

/***
 * Graph test
 */

describe("Graph", () => {
  let logger = getTestingLogger();
  setLogger(logger);
  it("can be instantiated", () => {
    expect(new Graph<Record<string, any>>(nodeIdentity, edgeIdentity)).toBeInstanceOf(Graph);
    expect(
      new Graph<Record<string, any>, Record<string, any>>(nodeIdentity, edgeIdentity)
    ).toBeInstanceOf(Graph);
    expect(
      new Graph<Record<string, any>, Record<string, any>, string, string>(
        nodeIdentity,
        edgeIdentity
      )
    ).toBeInstanceOf(Graph);
  });

  it("can add a node", () => {
    const graph = new Graph<{ a: number; b: string }, undefined, string, string>(
      (node) => nodeIdentity(node),
      (edge, node1Identity, node2Identity) => `${node1Identity}-${node2Identity}-${edge}` as string
    );

    graph.insert({ a: 1, b: "b" });

    expect((graph as any).nodes.size).toBe(1);
    expect((graph as any).adjacency.length).toBe(1);
    expect((graph as any).adjacency[0].length).toBe(1);

    expect(() => {
      graph.insert({ a: 1, b: "b" });
    }).toThrow(NodeAlreadyExistsError);
    expect((graph as any).nodes.size).toBe(1);
    expect((graph as any).adjacency.length).toBe(1);
    expect((graph as any).adjacency[0].length).toBe(1);
  });

  it("can remove a node", () => {
    const graph = new Graph<{ a: number; b: string }>(nodeIdentity, edgeIdentity);

    graph.insert({ a: 1, b: "b" });

    expect((graph as any).nodes.size).toBe(1);
    expect((graph as any).adjacency.length).toBe(1);
    expect((graph as any).adjacency[0].length).toBe(1);

    graph.remove(nodeIdentity({ a: 1, b: "b" }));

    expect((graph as any).nodes.size).toBe(0);
    expect((graph as any).adjacency.length).toBe(0);
  });

  it("can add a node with custom identity function", () => {
    interface NodeType {
      a: number;
      b: string;
    }
    const graph = new Graph<NodeType>((n: NodeType) => n.a.toFixed(2), edgeIdentity);

    graph.insert({ a: 1, b: "b" });

    expect((graph as any).nodes.size).toBe(1);
    expect((graph as any).adjacency.length).toBe(1);
    expect((graph as any).adjacency[0].length).toBe(1);

    expect(() => {
      graph.insert({ a: 1, b: "not b" });
    }).toThrow(NodeAlreadyExistsError);
    expect(() => {
      graph.insert({ a: 1.0007, b: "not b" });
    }).toThrow(NodeAlreadyExistsError);

    expect((graph as any).nodes.size).toBe(1);
    expect((graph as any).adjacency.length).toBe(1);
    expect((graph as any).adjacency[0].length).toBe(1);

    graph.insert({ a: 2, b: "not b" });

    expect((graph as any).nodes.size).toBe(2);
    expect((graph as any).adjacency.length).toBe(2);
    expect((graph as any).adjacency[0].length).toBe(2);
  });

  it("can replace a node", () => {
    const graph = new Graph<{ a: number; b: string }>(nodeIdentity, edgeIdentity);

    graph.insert({ a: 1, b: "b" });
    graph.replace({ a: 1, b: "b" });

    expect(() => {
      graph.replace({ a: 1, b: "c1" });
    }).toThrow(NodeDoesntExistError);
    expect((graph as any).nodes.get(nodeIdentity({ a: 1, b: "c" }))).toBeUndefined();

    expect((graph as any).nodes.size).toBe(1);
    expect((graph as any).adjacency.length).toBe(1);
    expect((graph as any).adjacency[0].length).toBe(1);
    expect((graph as any).nodes.get(nodeIdentity({ a: 1, b: "b" }))).toEqual({
      a: 1,
      b: "b",
    });
  });

  it("can replace a node with custom identity function", () => {
    interface NodeType {
      a: number;
      b: string;
    }
    const graph = new Graph<NodeType>((n: NodeType) => n.a.toFixed(2), edgeIdentity);

    graph.insert({ a: 1, b: "b" });
    graph.replace({ a: 1, b: "not b" });

    expect((graph as any).nodes.size).toBe(1);
    expect((graph as any).adjacency.length).toBe(1);
    expect((graph as any).adjacency[0].length).toBe(1);
    expect((graph as any).nodes.get("1.00")).toBeDefined();
    expect((graph as any).nodes.get("1.00")).toEqual({ a: 1, b: "not b" });

    graph.replace({ a: 1.0007, b: "not b" });

    expect((graph as any).nodes.size).toBe(1);
    expect((graph as any).adjacency.length).toBe(1);
    expect((graph as any).adjacency[0].length).toBe(1);
    expect((graph as any).nodes.get("1.00")).toBeDefined();
    expect((graph as any).nodes.get("1.00")).toEqual({ a: 1.0007, b: "not b" });

    expect(() => {
      graph.replace({ a: 2.5, b: "c" });
    }).toThrow(NodeDoesntExistError);
    expect((graph as any).nodes.get("2.50")).toBeUndefined();
  });

  it("can upsert a node", () => {
    interface NodeType {
      a: number;
      b: string;
    }
    const graph = new Graph<NodeType>((n: NodeType) => n.a.toFixed(2), edgeIdentity);

    graph.insert({ a: 1, b: "b" });
    graph.upsert({ a: 1, b: "not b" });

    expect((graph as any).nodes.size).toBe(1);
    expect((graph as any).adjacency.length).toBe(1);
    expect((graph as any).adjacency[0].length).toBe(1);
    expect((graph as any).nodes.get("1.00")).toBeDefined();
    expect((graph as any).nodes.get("1.00")).toEqual({ a: 1, b: "not b" });

    graph.upsert({ a: 2.5, b: "super not b" });

    expect((graph as any).nodes.size).toBe(2);
    expect((graph as any).adjacency.length).toBe(2);
    expect((graph as any).adjacency[0].length).toBe(2);
    expect((graph as any).nodes.get("2.50")).toBeDefined();
    expect((graph as any).nodes.get("2.50")).toEqual({ a: 2.5, b: "super not b" });
  });

  it("can add an edge", () => {
    interface NodeType {
      a: number;
      b: string;
    }
    const graph = new Graph<NodeType>((n: NodeType) => n.a.toFixed(2), edgeIdentity);

    graph.insert({ a: 1, b: "b" });

    expect(() => {
      graph.addEdge("3.00", "2.00");
    }).toThrow(NodeDoesntExistError);
    expect(() => {
      graph.addEdge("1.00", "2.00");
    }).toThrow(NodeDoesntExistError);
    expect(() => {
      graph.addEdge("2.00", "1.00");
    }).toThrow(NodeDoesntExistError);

    graph.insert({ a: 2, b: "b" });
    graph.insert({ a: 3, b: "b" });
    graph.insert({ a: 4, b: "b" });

    graph.addEdge("1.00", "2.00");
    expect((graph as any).adjacency[0][1]).toBeTruthy();
    expect((graph as any).adjacency[1][0]).toBeFalsy();
    expect((graph as any).adjacency[1][2]).toBeFalsy();

    graph.addEdge("2.00", "1.00");
    expect((graph as any).adjacency[0][1]).toBeTruthy();
    expect((graph as any).adjacency[1][0]).toBeTruthy();
    expect((graph as any).adjacency[1][2]).toBeFalsy();
  });

  it("can remove an edge", () => {
    interface NodeType {
      a: number;
      b: string;
    }
    const graph = new Graph<NodeType>((n: NodeType) => n.a.toFixed(2), edgeIdentity);

    graph.insert({ a: 1, b: "b" });
    graph.insert({ a: 2, b: "b" });
    graph.insert({ a: 3, b: "b" });
    graph.insert({ a: 4, b: "b" });

    graph.addEdge("1.00", "2.00");
    expect((graph as any).adjacency[0][1]).toBeTruthy();
    expect((graph as any).adjacency[1][0]).toBeFalsy();
    expect((graph as any).adjacency[1][2]).toBeFalsy();

    graph.addEdge("2.00", "1.00");
    expect((graph as any).adjacency[0][1]).toBeTruthy();
    expect((graph as any).adjacency[1][0]).toBeTruthy();
    expect((graph as any).adjacency[1][2]).toBeFalsy();

    graph.removeEdge("1.00", "2.00");
    graph.removeEdge("2.00", "1.00");
    expect((graph as any).adjacency[0][1]).toBeFalsy();
    expect((graph as any).adjacency[1][0]).toBeFalsy();
    expect((graph as any).adjacency[1][2]).toBeFalsy();
  });

  it("can deal with multiple edges", () => {
    interface NodeType {
      a: number;
      b: string;
    }
    interface EdgeType {
      c: string;
    }
    const graph = new Graph<NodeType, EdgeType>((n: NodeType) => n.a.toFixed(2), edgeIdentity);

    graph.insert({ a: 1, b: "b" });
    graph.insert({ a: 2, b: "b" });
    graph.insert({ a: 3, b: "b" });
    graph.insert({ a: 4, b: "b" });

    graph.addEdge("1.00", "2.00", { c: "c1" });
    expect((graph as any).adjacency[0][1]).toBeTruthy();
    expect((graph as any).adjacency[1][0]).toBeFalsy();
    expect((graph as any).adjacency[1][2]).toBeFalsy();

    graph.addEdge("2.00", "1.00", { c: "c2" });
    expect((graph as any).adjacency[0][1]).toBeTruthy();
    expect((graph as any).adjacency[1][0]).toBeTruthy();
    expect((graph as any).adjacency[1][2]).toBeFalsy();

    graph.addEdge("2.00", "1.00", { c: "c3" });

    expect((graph.nodeEdges("1.00") as any).length).toBe(3);
    expect((graph.nodeEdges("3.00") as any).length).toBe(0);
    expect((graph.outEdges("2.00") as any).length).toBe(2);
    expect((graph.inEdges("1.00") as any).length).toBe(2);
    expect((graph.inEdges("2.00") as any).length).toBe(1);
    expect((graph.getEdges() as any).length).toBe(3);

    graph.removeEdge("1.00", "2.00");
    graph.removeEdge("2.00", "1.00");
    expect((graph as any).adjacency[0][1]).toBeFalsy();
    expect((graph as any).adjacency[1][0]).toBeFalsy();
    expect((graph as any).adjacency[1][2]).toBeFalsy();
  });

  it("can remove a specific edge by identity", () => {
    interface NodeType {
      a: number;
      b: string;
    }
    interface EdgeType {
      c: string;
    }
    const graph = new Graph<NodeType, EdgeType>((n: NodeType) => n.a.toFixed(2), edgeIdentity);

    graph.insert({ a: 1, b: "b" });
    graph.insert({ a: 2, b: "b" });

    const id1 = graph.addEdge("1.00", "2.00", { c: "c1" });
    const id2 = graph.addEdge("1.00", "2.00", { c: "c2" });
    const id3 = graph.addEdge("1.00", "2.00", { c: "c3" });

    expect(graph.getEdges().length).toBe(3);
    const edgeIds = () => graph.getEdges().map(([n1, n2, e]) => edgeIdentity(e, n1, n2));
    expect(edgeIds().sort()).toEqual([id1, id2, id3].sort());

    // Remove the middle edge by identity
    graph.removeEdge("1.00", "2.00", id2);
    expect(graph.getEdges().length).toBe(2);
    expect(edgeIds().sort()).toEqual([id1, id3].sort());
    expect((graph as any).adjacency[0][1]).toBeTruthy();

    // Remove another edge by identity
    graph.removeEdge("1.00", "2.00", id1);
    expect(graph.getEdges().length).toBe(1);
    expect(edgeIds()).toEqual([id3]);
    expect((graph as any).adjacency[0][1]).toBeTruthy();

    // Remove the last edge — cell should become null
    graph.removeEdge("1.00", "2.00", id3);
    expect(graph.getEdges().length).toBe(0);
    expect(edgeIds()).toEqual([]);
    expect((graph as any).adjacency[0][1]).toBeFalsy();
  });

  it("does not emit edge-removed when no edge matched", () => {
    interface NodeType {
      a: number;
      b: string;
    }
    interface EdgeType {
      c: string;
    }
    const graph = new Graph<NodeType, EdgeType>((n: NodeType) => n.a.toFixed(2), edgeIdentity);

    graph.insert({ a: 1, b: "b" });
    graph.insert({ a: 2, b: "b" });
    graph.addEdge("1.00", "2.00", { c: "c1" });

    const removed: unknown[] = [];
    graph.on("edge-removed", (id) => removed.push(id));

    // No edge with this identity exists between the pair → no event.
    graph.removeEdge("1.00", "2.00", "does-not-exist" as any);
    expect(removed).toEqual([]);
    expect(graph.getEdges().length).toBe(1);
  });

  it("emits edge-removed with real ids when removing all edges of a pair", () => {
    interface NodeType {
      a: number;
      b: string;
    }
    interface EdgeType {
      c: string;
    }
    const graph = new Graph<NodeType, EdgeType>((n: NodeType) => n.a.toFixed(2), edgeIdentity);

    graph.insert({ a: 1, b: "b" });
    graph.insert({ a: 2, b: "b" });
    const id1 = graph.addEdge("1.00", "2.00", { c: "c1" });
    const id2 = graph.addEdge("1.00", "2.00", { c: "c2" });

    const removed: unknown[] = [];
    graph.on("edge-removed", (id) => removed.push(id));

    // Remove-all (no edgeIdentity): one event per removed edge, with real ids
    // (never `undefined` cast to EdgeId).
    graph.removeEdge("1.00", "2.00");
    expect(removed.sort()).toEqual([id1, id2].sort());
    expect(removed).not.toContain(undefined);
    expect(graph.getEdges().length).toBe(0);
  });

  it("can return the nodes", () => {
    interface NodeType {
      a: number;
      b: string;
    }
    const graph = new Graph<NodeType>((n: NodeType) => n.a.toFixed(2), edgeIdentity);

    graph.insert({ a: 1, b: "b" });

    expect(graph.getNodes()).toEqual([{ a: 1, b: "b" }]);

    graph.insert({ a: 2, b: "b" });
    graph.insert({ a: 3, b: "b" });
    graph.insert({ a: 4, b: "b" });

    expect(graph.getNodes()).toContainEqual({ a: 1, b: "b" });
    expect(graph.getNodes()).toContainEqual({ a: 2, b: "b" });
    expect(graph.getNodes()).toContainEqual({ a: 3, b: "b" });
    expect(graph.getNodes()).toContainEqual({ a: 4, b: "b" });
  });

  it("can return the nodes sorted", () => {
    interface NodeType {
      a: number;
      b: string;
    }
    const graph = new Graph<NodeType>((n: NodeType) => n.a.toFixed(2), edgeIdentity);

    graph.insert({ a: 2, b: "b" });
    graph.insert({ a: 4, b: "b" });
    graph.insert({ a: 1, b: "b" });
    graph.insert({ a: 3, b: "b" });

    expect(graph.getNodes((a, b) => a.a - b.a)).toEqual([
      { a: 1, b: "b" },
      { a: 2, b: "b" },
      { a: 3, b: "b" },
      { a: 4, b: "b" },
    ]);
  });

  it("can get a specific node", () => {
    interface NodeType {
      a: number;
      b: string;
    }
    const identityfn = (n: NodeType): string => n.a.toFixed(2);
    const graph = new Graph<NodeType>(identityfn, edgeIdentity);

    const inputToRetrieve = { a: 1, b: "c" };

    graph.insert({ a: 2, b: "b" });
    graph.insert({ a: 4, b: "b" });
    graph.insert(inputToRetrieve);
    graph.insert({ a: 3, b: "b" });

    expect(graph.getNode(identityfn(inputToRetrieve))).toBeDefined();
    expect(graph.getNode(identityfn(inputToRetrieve))).toEqual(inputToRetrieve);
    expect(graph.getNode("nonsense")).toBeUndefined();
  });
});

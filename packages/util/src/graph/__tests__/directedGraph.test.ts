// original source: https://github.com/SegFaultx64/typescript-graph
// previous fork: https://github.com/sroussey/typescript-graph
// license: MIT

import { setLogger } from "@workglow/util";
import { DirectedGraph, NodeDoesntExistError } from "@workglow/util/graph";
import { getTestingLogger } from "@workglow/util/test";
import { describe, expect, it } from "vitest";
import { edgeIdentity, nodeIdentity } from "./graph.test";

/***
 * Directed Graph test
 */

describe("Directed Graph", () => {
  let logger = getTestingLogger();
  setLogger(logger);
  it("can be instantiated", () => {
    expect(new DirectedGraph<Record<string, any>>(nodeIdentity, edgeIdentity)).toBeInstanceOf(
      DirectedGraph
    );
  });

  it("can calculate the indegree of a node", () => {
    interface NodeType {
      name: string;
    }
    const graph = new DirectedGraph<NodeType>((n: NodeType) => n.name, edgeIdentity);

    graph.insert({ name: "A" });
    graph.insert({ name: "B" });
    graph.insert({ name: "C" });

    expect(graph.indegreeOfNode("A")).toBe(0);
    expect(graph.indegreeOfNode("B")).toBe(0);
    expect(graph.indegreeOfNode("C")).toBe(0);
    expect(() => graph.indegreeOfNode("D")).toThrow(NodeDoesntExistError);

    graph.addEdge("A", "B");
    graph.addEdge("B", "C");
    graph.addEdge("A", "C");
    graph.addEdge("C", "A");

    expect(graph.indegreeOfNode("A")).toBe(1);
    expect(graph.indegreeOfNode("B")).toBe(1);
    expect(graph.indegreeOfNode("C")).toBe(2);
  });

  it("can calculate the indegree of a node with multiple edges", () => {
    interface NodeType {
      name: string;
    }
    interface EdgeType {
      label: string;
    }
    const graph = new DirectedGraph<NodeType, EdgeType, string, string>(
      (n: NodeType) => n.name,
      (e: EdgeType, n1: string, n2: string) => `${n1}-${n2}-${e.label}`
    );

    graph.insert({ name: "A" });
    graph.insert({ name: "B" });
    graph.insert({ name: "C" });

    graph.addEdge("A", "B", { label: "e1" });
    graph.addEdge("A", "B", { label: "e2" });
    graph.addEdge("A", "B", { label: "e3" });
    graph.addEdge("C", "B", { label: "e4" });

    expect(graph.indegreeOfNode("A")).toBe(0);
    expect(graph.indegreeOfNode("B")).toBe(4);
    expect(graph.indegreeOfNode("C")).toBe(0);
  });

  it("isAcyclic returns correct result after removing the last edge between a node pair", () => {
    interface NodeType {
      name: string;
    }
    interface EdgeType {
      label: string;
    }
    const graph = new DirectedGraph<NodeType, EdgeType, string, string>(
      (n: NodeType) => n.name,
      (e: EdgeType, n1: string, n2: string) => `${n1}-${n2}-${e.label}`
    );

    graph.insert({ name: "A" });
    graph.insert({ name: "B" });
    graph.insert({ name: "C" });

    graph.addEdge("A", "B", { label: "e1" });
    graph.addEdge("B", "C", { label: "e2" });

    expect(graph.isAcyclic()).toBe(true);

    // Remove the last edge between A->B by identity; adjacency cell must become null, not []
    graph.removeEdge("A", "B", "A-B-e1");

    // Graph is now A  B->C (no edges from A); still acyclic
    expect(graph.isAcyclic()).toBe(true);
    expect(graph.indegreeOfNode("B")).toBe(0);
    expect(graph.indegreeOfNode("C")).toBe(1);
  });

  it("can determine if it is acyclical", () => {
    interface NodeType {
      name: string;
    }
    const graph = new DirectedGraph<NodeType>((n: NodeType) => n.name, edgeIdentity);

    graph.insert({ name: "A" });
    graph.insert({ name: "B" });
    graph.insert({ name: "C" });

    expect(graph.isAcyclic()).toBe(true);

    graph.addEdge("A", "B");

    expect(graph.isAcyclic()).toBe(true);

    graph.addEdge("A", "C");

    expect(graph.isAcyclic()).toBe(true);

    graph.addEdge("C", "A");
    (graph as any).hasCycle = undefined;

    expect(graph.isAcyclic()).toBe(false);

    const graph2 = new DirectedGraph<NodeType>((n: NodeType) => n.name, edgeIdentity);
    graph2.insert({ name: "A" });

    expect(graph2.isAcyclic()).toBe(true);

    graph2.addEdge("A", "A");
    (graph2 as any).hasCycle = undefined;

    expect(graph2.isAcyclic()).toBe(false);

    const graph3 = new DirectedGraph<NodeType>((n: NodeType) => n.name, edgeIdentity);
    graph3.insert({ name: "A" });
    graph3.insert({ name: "B" });
    graph3.insert({ name: "C" });
    graph3.insert({ name: "D" });
    graph3.insert({ name: "E" });

    expect(graph3.isAcyclic()).toBe(true);

    graph3.addEdge("A", "B");

    expect(graph3.isAcyclic()).toBe(true);

    graph3.addEdge("B", "C");

    expect(graph3.isAcyclic()).toBe(true);

    graph3.addEdge("C", "D");

    expect(graph3.isAcyclic()).toBe(true);

    graph3.addEdge("C", "E");

    expect(graph3.isAcyclic()).toBe(true);

    graph3.addEdge("E", "B");
    (graph3 as any).hasCycle = undefined;

    expect(graph3.isAcyclic()).toBe(false);

    graph3.addEdge("E", "C");
    (graph3 as any).hasCycle = undefined;

    expect(graph3.isAcyclic()).toBe(false);

    graph3.addEdge("E", "E");
    (graph3 as any).hasCycle = undefined;

    expect(graph3.isAcyclic()).toBe(false);
  });

  it("can determine if adding an edge would create a cycle", () => {
    interface NodeType {
      name: string;
    }
    const graph = new DirectedGraph<NodeType>((n: NodeType) => n.name, edgeIdentity);

    graph.insert({ name: "A" });
    graph.insert({ name: "B" });
    graph.insert({ name: "C" });

    expect(graph.wouldAddingEdgeCreateCycle("A", "B")).toBe(false);
    expect(graph.wouldAddingEdgeCreateCycle("A", "A")).toBe(true);

    graph.addEdge("A", "B");

    expect(graph.wouldAddingEdgeCreateCycle("B", "C")).toBe(false);
    expect(graph.wouldAddingEdgeCreateCycle("B", "A")).toBe(true);

    graph.addEdge("B", "C");

    expect(graph.wouldAddingEdgeCreateCycle("A", "C")).toBe(false);
    expect(graph.wouldAddingEdgeCreateCycle("C", "A")).toBe(true);
  });

  it("can determine if one node can be reached from another", () => {
    interface NodeType {
      name: string;
    }
    const graph = new DirectedGraph<NodeType>((n: NodeType) => n.name, edgeIdentity);

    graph.insert({ name: "A" });
    graph.insert({ name: "B" });
    graph.insert({ name: "C" });
    graph.insert({ name: "D" });

    expect(graph.canReachFrom("A", "B")).toBe(false);
    expect(graph.canReachFrom("A", "A")).toBe(false);

    graph.addEdge("A", "B");

    expect(graph.canReachFrom("B", "C")).toBe(false);
    expect(graph.canReachFrom("A", "B")).toBe(true);
    expect(graph.canReachFrom("B", "A")).toBe(false);

    graph.addEdge("B", "C");
    graph.addEdge("B", "D");

    expect(graph.canReachFrom("A", "C")).toBe(true);
    expect(graph.canReachFrom("B", "D")).toBe(true);
    expect(graph.canReachFrom("C", "D")).toBe(false);

    expect(graph.canReachFrom("A", "nonexistent" as unknown as string)).toBe(false);
    expect(graph.canReachFrom("nonexistent" as unknown as string, "A")).toBe(false);
  });

  it("canReachFrom terminates on a cyclic graph (no stack overflow)", () => {
    interface NodeType {
      name: string;
    }
    const graph = new DirectedGraph<NodeType>((n: NodeType) => n.name, edgeIdentity);

    graph.insert({ name: "A" });
    graph.insert({ name: "B" });
    graph.insert({ name: "C" });
    graph.insert({ name: "D" });

    // Build a cycle A -> B -> C -> A reachable from A, with D unreachable.
    graph.addEdge("A", "B");
    graph.addEdge("B", "C");
    graph.addEdge("C", "A");

    // Without a visited set this recurses forever and overflows the stack.
    expect(graph.canReachFrom("A", "C")).toBe(true);
    expect(graph.canReachFrom("A", "D")).toBe(false);
    expect(graph.canReachFrom("B", "A")).toBe(true);
  });

  it("canReachFrom handles diamond graphs without exponential re-walking", () => {
    interface NodeType {
      name: string;
    }
    const graph = new DirectedGraph<NodeType>((n: NodeType) => n.name, edgeIdentity);

    graph.insert({ name: "A" });
    graph.insert({ name: "B" });
    graph.insert({ name: "C" });
    graph.insert({ name: "D" });

    // Diamond: A -> B, A -> C, B -> D, C -> D (D shares two paths).
    graph.addEdge("A", "B");
    graph.addEdge("A", "C");
    graph.addEdge("B", "D");
    graph.addEdge("C", "D");

    expect(graph.canReachFrom("A", "D")).toBe(true);
    expect(graph.canReachFrom("D", "A")).toBe(false);
  });

  it("can return a subgraph based on walking from a start node", () => {
    interface NodeType {
      name: string;
    }
    const graph = new DirectedGraph<NodeType>((n: NodeType) => n.name, edgeIdentity);

    graph.insert({ name: "A" });
    graph.insert({ name: "B" });
    graph.insert({ name: "C" });

    const testGraph = new DirectedGraph<NodeType>((n: NodeType) => n.name, edgeIdentity);
    testGraph.insert({ name: "A" });

    expect(graph.getSubGraphStartingFrom("A").getNodes()).toEqual(testGraph.getNodes());

    graph.addEdge("A", "B");
    graph.addEdge("B", "C");

    const subGraph = graph.getSubGraphStartingFrom("A");

    expect(subGraph.getNodes()).toContainEqual({ name: "A" });
    expect(subGraph.getNodes()).toContainEqual({ name: "B" });
    expect(subGraph.getNodes()).toContainEqual({ name: "C" });
    expect(subGraph.canReachFrom("A", "C")).toBe(true);

    graph.insert({ name: "D" });

    const subGraph2 = graph.getSubGraphStartingFrom("A");

    expect(subGraph2.getNodes()).not.toContainEqual({ name: "D" });

    graph.addEdge("B", "D");

    const subGraph3 = graph.getSubGraphStartingFrom("A");

    expect(subGraph3.getNodes()).toContainEqual({ name: "D" });
    expect(subGraph3.canReachFrom("A", "C")).toBe(true);
    expect(subGraph3.canReachFrom("A", "D")).toBe(true);
    expect(subGraph3.canReachFrom("B", "D")).toBe(true);
    expect(subGraph3.canReachFrom("C", "D")).toBe(false);
  });
});

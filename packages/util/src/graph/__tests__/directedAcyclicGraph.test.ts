// original source: https://github.com/SegFaultx64/typescript-graph
// previous fork: https://github.com/sroussey/typescript-graph
// license: MIT

import { setLogger } from "@workglow/util";
import {
  CycleError,
  DirectedAcyclicGraph,
  DirectedGraph,
  NodeDoesntExistError,
} from "@workglow/util/graph";
import { getTestingLogger } from "@workglow/util/test";
import { describe, expect, it } from "vitest";
import { edgeIdentity, nodeIdentity } from "./graph.test";

/***
 * Directed Acyclic Graph test
 */

describe("Directed Acyclic Graph", () => {
  let logger = getTestingLogger();
  setLogger(logger);
  it("can be instantiated", () => {
    expect(
      new DirectedAcyclicGraph<Record<string, unknown>>(nodeIdentity, edgeIdentity)
    ).toBeInstanceOf(DirectedAcyclicGraph);
  });

  it("can be converted from a directed graph", () => {
    interface NodeType {
      name: string;
    }
    const graph = new DirectedGraph<NodeType>((n: NodeType) => n.name, edgeIdentity);

    graph.insert({ name: "A" });
    graph.insert({ name: "B" });
    graph.insert({ name: "C" });

    graph.addEdge("A", "B");
    graph.addEdge("B", "C");
    graph.addEdge("A", "C");

    expect(DirectedAcyclicGraph.fromDirectedGraph(graph)).toBeInstanceOf(DirectedAcyclicGraph);

    graph.addEdge("C", "A");

    expect(() => DirectedAcyclicGraph.fromDirectedGraph(graph)).toThrow(CycleError);
  });

  it("produces a DAG independent of the source graph (no shared backing state)", () => {
    interface NodeType {
      name: string;
    }
    const graph = new DirectedGraph<NodeType>((n: NodeType) => n.name, edgeIdentity);

    graph.insert({ name: "A" });
    graph.insert({ name: "B" });
    graph.addEdge("A", "B");

    const dag = DirectedAcyclicGraph.fromDirectedGraph(graph);

    // Mutating the source graph after conversion must not change the DAG.
    graph.insert({ name: "C" });
    graph.addEdge("B", "C");

    expect(
      dag
        .getNodes()
        .map((n) => n.name)
        .sort()
    ).toEqual(["A", "B"]);
    expect(dag.canReachFrom("A", "C" as unknown as string)).toBe(false);

    // And mutating the DAG must not corrupt the source graph.
    dag.insert({ name: "D" });
    expect(graph.getNodes().map((n) => n.name)).not.toContain("D");
  });

  it("can add an edge only if it wouldn't create a cycle", () => {
    interface NodeType {
      name: string;
    }
    const graph = new DirectedAcyclicGraph<NodeType>((n: NodeType) => n.name, edgeIdentity);

    graph.insert({ name: "A" });
    graph.insert({ name: "B" });
    graph.insert({ name: "C" });

    graph.addEdge("A", "B");
    graph.addEdge("B", "C");
    graph.addEdge("A", "C");
    graph.removeEdge("A", "C");
    graph.addEdge("A", "C");

    expect(() => {
      graph.addEdge("C", "A");
    }).toThrow(CycleError);
  });

  it("addEdge to a missing node throws NodeDoesntExistError (not a TypeError from canReachFrom)", () => {
    interface NodeType {
      name: string;
    }
    const graph = new DirectedAcyclicGraph<NodeType>((n: NodeType) => n.name, edgeIdentity);
    graph.insert({ name: "A" });
    expect(() => graph.addEdge("A", "missing" as unknown as string)).toThrow(NodeDoesntExistError);
    expect(() => graph.addEdge("missing" as unknown as string, "A")).toThrow(NodeDoesntExistError);
  });

  it("can get it's nodes topologically sorted", () => {
    interface NodeType {
      name: string;
    }
    const graph = new DirectedAcyclicGraph<NodeType>((n: NodeType) => n.name, edgeIdentity);

    expect(graph.topologicallySortedNodes()).toEqual([]);

    graph.insert({ name: "A" });
    graph.insert({ name: "B" });
    graph.insert({ name: "C" });

    const topoList1 = graph.topologicallySortedNodes();

    expect(topoList1).toContainEqual({ name: "A" });
    expect(topoList1).toContainEqual({ name: "B" });
    expect(topoList1).toContainEqual({ name: "C" });

    graph.addEdge("A", "C");
    graph.addEdge("C", "B");

    const topoList2 = graph.topologicallySortedNodes();

    expect(topoList2).toEqual([{ name: "A" }, { name: "C" }, { name: "B" }]);

    graph.insert({ name: "D" });
    graph.insert({ name: "E" });

    graph.addEdge("A", "D");
    graph.addEdge("B", "E");

    const topoList3 = graph.topologicallySortedNodes();

    expect(topoList3[0]).toEqual({ name: "A" });
    expect(topoList3[4]).toEqual({ name: "E" });

    expect([{ name: "C" }, { name: "D" }]).toContainEqual(topoList3[1]);
    expect([{ name: "C" }, { name: "D" }]).toContainEqual(topoList3[2]);

    graph.insert({ name: "F" });

    const topoList4 = graph.topologicallySortedNodes();

    expect(topoList4).toContainEqual({ name: "F" });
    expect([{ name: "A" }, { name: "F" }]).toContainEqual(topoList4[0]);
    expect([{ name: "A" }, { name: "F" }]).toContainEqual(topoList4[1]);
  });

  it("can return a subgraph based on walking from a start node", () => {
    interface NodeType {
      name: string;
    }
    const graph = new DirectedAcyclicGraph<NodeType>((n: NodeType) => n.name, edgeIdentity);

    graph.insert({ name: "A" });
    graph.insert({ name: "B" });
    graph.insert({ name: "C" });

    const testGraph = new DirectedAcyclicGraph<NodeType>((n: NodeType) => n.name, edgeIdentity);
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

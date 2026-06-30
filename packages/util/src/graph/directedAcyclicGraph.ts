// original source: https://github.com/SegFaultx64/typescript-graph
// previous fork: https://github.com/sroussey/typescript-graph
// license: MIT

import { DirectedGraph } from "./directedGraph";
import { CycleError, GraphInvariantError } from "./errors";

/**
 * # DirectedAcyclicGraph
 *
 * A DirectedAcyclicGraph is builds on a [[`DirectedGraph`]] but enforces acyclicality. You cannot add an edge to a DirectedAcyclicGraph that would create a cycle.
 *
 * @typeParam Node `Node` is the node type of the graph. Nodes can be anything in all the included examples they are simple objects.
 * @typeParam Edge `Edge` is the edge type of the graph. Edges can be of any type, but must be truethy and by default they are `true` which is a simple boolean.
 * @typeParam NodeId `NodeId` is the identity type of the node, by default it is a `unknown`, though most will use `string` or `number`.
 * @typeParam EdgeId `EdgeId` is the identity type of the edge, by default it is a `unknown`, though most will use `string` or `number`.
 */
export class DirectedAcyclicGraph<
  Node,
  Edge = true,
  NodeId = unknown,
  EdgeId = unknown,
> extends DirectedGraph<Node, Edge, NodeId, EdgeId> {
  private _topologicallySortedNodes?: Node[];

  /**
   * Converts an existing directed graph into a directed acyclic graph.
   * Throws a {@linkcode CycleError} if the graph attempting to be converted contains a cycle.
   * @param graph The source directed graph to convert into a DAG
   */
  static fromDirectedGraph<Node, Edge, NodeId, EdgeId>(
    graph: DirectedGraph<Node, Edge, NodeId, EdgeId>
  ): DirectedAcyclicGraph<Node, Edge, NodeId, EdgeId> {
    if (!graph.isAcyclic()) {
      throw new CycleError("Can't convert that graph to a DAG because it contains a cycle");
    }
    const toRet = new DirectedAcyclicGraph<Node, Edge, NodeId, EdgeId>(
      // @ts-expect-error - graph.nodeIdentity is a function
      graph.nodeIdentity,
      // @ts-expect-error - graph.edgeIdentity is a function
      graph.edgeIdentity
    );

    // Deep-copy the backing state so the resulting DAG is an independent value.
    // Aliasing the source graph's Maps/arrays by reference would let a later
    // mutation of either graph silently corrupt the other (and break the DAG's
    // acyclicity invariant from the outside).
    const sourceNodes = (graph as any).nodes as Map<NodeId, Node>;
    const sourceAdjacency = (graph as any).adjacency as Array<Array<Array<Edge> | null>>;
    const sourceNodeIndexMap = (graph as any).nodeIndexMap as Map<NodeId, number>;

    toRet.nodes = new Map(sourceNodes);
    toRet.nodeIndexMap = new Map(sourceNodeIndexMap);
    toRet.adjacency = sourceAdjacency.map((row) =>
      row.map((cell) => (cell === null ? null : [...cell]))
    );

    return toRet;
  }

  /**
   * Adds an edge to the graph similarly to [[`DirectedGraph.addEdge`]] but maintains correctness of the acyclic graph.
   * Thows a [[`CycleError`]] if adding the requested edge would create a cycle.
   * Adding an edge invalidates the cache of topologically sorted nodes, rather than updating it.
   *
   * @param sourceNodeIdentity The identity string of the node the edge should run from.
   * @param targetNodeIdentity The identity string of the node the edge should run to.
   * @param edge The edge to add to the graph. If not provided it defaults to `true`.
   */
  override addEdge(sourceNodeIdentity: NodeId, targetNodeIdentity: NodeId, edge?: Edge): EdgeId {
    if (edge === undefined) {
      edge = true as Edge;
    }
    if (this.wouldAddingEdgeCreateCycle(sourceNodeIdentity, targetNodeIdentity)) {
      throw new CycleError(
        `Can't add edge from ${String(sourceNodeIdentity)} to ${String(
          targetNodeIdentity
        )} it would create a cycle`
      );
    }

    // Invalidate cache of toposorted nodes
    this._topologicallySortedNodes = undefined;
    // Acyclicity was just validated above; skip the redundant cycle check.
    return this.addEdgeMaintainingCyclicality(sourceNodeIdentity, targetNodeIdentity, edge, true);
  }

  /**
   * Inserts a node into the graph and maintains topologic sort cache by prepending the node
   * (since all newly created nodes have an [[ indegreeOfNode | indegree ]] of zero.)
   *
   * @param node The node to insert
   */
  override insert(node: Node): NodeId {
    if (this._topologicallySortedNodes !== undefined) {
      this._topologicallySortedNodes = [node, ...this._topologicallySortedNodes];
    }

    return super.insert(node);
  }

  /**
   * Topologically sort the nodes using Kahn's algorithm. Uses a cache which means that repeated calls should be O(1) after the first call.
   * Non-cached calls are potentially expensive, Kahn's algorithim is O(|EdgeCount| + |NodeCount|).
   * There may be more than one valid topological sort order for a single graph,
   * so just because two graphs are the same does not mean that order of the resultant arrays will be.
   *
   * @returns An array of nodes sorted by the topological order.
   */
  topologicallySortedNodes(): Node[] {
    if (this._topologicallySortedNodes !== undefined) {
      return this._topologicallySortedNodes;
    }

    const nodeIndices = Array.from(this.nodes.keys());
    const nodeInDegrees = new Map(
      Array.from(this.nodes.keys()).map((n) => [n, this.indegreeOfNode(n)])
    );

    const adjCopy = this.adjacency.map((a) => [...a]);

    const toSearch = Array.from(nodeInDegrees).filter((pair) => pair[1] === 0);

    if (toSearch.length === this.nodes.size) {
      const arrayOfNodes = Array.from(this.nodes.values());
      this._topologicallySortedNodes = arrayOfNodes;
      return arrayOfNodes;
    }

    const toReturn: Node[] = [];

    while (toSearch.length > 0) {
      const n = toSearch.pop();
      if (n === undefined) {
        throw new GraphInvariantError(
          "Kahn's algorithm popped an empty search frontier; toSearch desynced from node set"
        );
      }
      const curNode = this.nodes.get(n[0]);
      if (curNode == null) {
        throw new GraphInvariantError(
          `Zero-indegree node ${String(n[0])} is missing from the node map; node/index bookkeeping desynced`
        );
      }
      toReturn.push(curNode);

      adjCopy[this.getNodeIndex(n[0])]?.forEach((edge, index) => {
        if (edge !== null && edge.length > 0) {
          const edgeCount = edge.length;
          adjCopy[this.getNodeIndex(n[0])][index] = null;
          const target = nodeInDegrees.get(nodeIndices[index]);
          if (target !== undefined) {
            nodeInDegrees.set(nodeIndices[index], target - edgeCount);
            if (target - edgeCount === 0) {
              toSearch.push([nodeIndices[index], 0]);
            }
          } else {
            throw new GraphInvariantError(
              `Edge target ${String(nodeIndices[index])} has no recorded indegree; adjacency/indegree maps desynced`
            );
          }
        }
      });
    }

    // Update cache
    this._topologicallySortedNodes = toReturn;

    // we shouldn't need to account for the error case of there being a cycle because it shouldn't
    // be possible to instantiate this class in a state (or put it in a state) where there is a cycle.

    return toReturn;
  }

  /**
   * Given a starting node this returns a new [[`DirectedA`]] containing all the nodes that can be reached.
   * Throws a [[`NodeDoesntExistError`]] if the start node does not exist.
   *
   * @param startNodeIdentity The string identity of the node from which the subgraph search should start.
   */
  override getSubGraphStartingFrom(
    startNodeIdentity: NodeId
  ): DirectedAcyclicGraph<Node, Edge, NodeId, EdgeId> {
    return DirectedAcyclicGraph.fromDirectedGraph(super.getSubGraphStartingFrom(startNodeIdentity));
  }

  /**
   * Deletes an edge between two nodes in the graph.
   * Throws a [[`NodeDoesNotExistsError`]] if either of the nodes do not exist.
   *
   * @param sourceNodeIdentity The identity of the source node
   * @param targetNodeIdentity The identity of the target node
   * @param edgeIdentity The identity of the edge to be deleted. If not provided, all edges between the two nodes will be deleted.
   */
  override removeEdge(
    sourceNodeIdentity: NodeId,
    targetNodeIdentity: NodeId,
    edgeIdentity?: EdgeId
  ): void {
    super.removeEdge(sourceNodeIdentity, targetNodeIdentity, edgeIdentity);

    // Invalidate the topologically sorted nodes cache
    this._topologicallySortedNodes = undefined;
  }

  /**
   * Deletes a node from the graph, along with any edges associated with it.
   * Throws a [[`NodeDoesNotExistsError`]] if the node does not exist.
   *
   * @param nodeIdentity The identity of the node to be deleted.
   */
  override remove(nodeIdentity: NodeId): void {
    super.remove(nodeIdentity);

    // Invalidate the topologically sorted nodes cache
    this._topologicallySortedNodes = undefined;
  }
}

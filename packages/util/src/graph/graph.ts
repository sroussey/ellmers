// original source: https://github.com/SegFaultx64/typescript-graph
// previous fork: https://github.com/sroussey/typescript-graph
// license: MIT

import { EventEmitter } from "../events/EventEmitter";
import { NodeAlreadyExistsError, NodeDoesntExistError } from "./errors";

/**
 * # Graph
 *
 * A `Graph` is is a simple undirected graph. On it's own it isn't too useful but it forms the basic functionality for the [[`DirectedGraph`]] and [[`DirectedAcyclicGraph`]].
 *
 * ## Creating a Graph
 *
 * You can create a graph to contain any type of node, for example:
 *
 * ```typescript
 * type NodeType = { a: Number, b: string }
 * const graph = new Graph<NodeType>()
 *
 * // Add a node of the defined type
 * const node: string = graph.insert({ a: 10, b: 'string' })
 *
 * // Get the node back
 * const nodeValue: NodeType | undefined = graph.getNode(node);
 * ```
 *
 * ### Defining a custom node identity
 *
 * When you create a graph you likely want to create include a custom `nodeIdentity` function.
 * This function tells the graph how to uniquely identify nodes in a graph,
 * default is to simply use an [[hash]] which means that functionality like [[`replace`]] will not work.
 *
 * ```typescript
 * type NodeType = { count: number, name: string }
 * const graph = new Graph<NodeType>((n) => n.name)
 *
 * // Add a node
 * graph.insert({ count: 5, name: 'node1' })
 * // This will throw an error even though `count` is different because they share a name.
 * graph.insert({ count: 20, name: 'node1' })
 * ```
 *
 * ### Adding an edge
 *
 * Graphs without edges aren't very useful. Inserting edges is done using the node identity string returned by the node identity function.
 *
 * ```typescript
 * const node1: string = graph.insert({ count: 5, name: 'node1' })
 * const node2: string = graph.insert({ count: 20, name: 'node2' })
 *
 * graph.addEdge(node1, node2)
 *
 * // This will throw an error since there is no node with the later name.
 * graph.addEdge(node1, 'not a real node')
 * ```
 *
 * In an undirected graph the order in which you input the node names doesn't matter,
 * but in directed graphs the "from node" comes first and the "to node" will come second.
 *
 * ### Replacing a node
 *
 * If a node already exists you can update it using [[`replace`]]. `nodeIdentity(newNode)` must be equal to `nodeIdentity(oldNode)`.
 *
 * ```typescript
 * const node1: string = graph.insert({ count: 5, name: 'node1' })
 * const node2: string = graph.insert({ count: 20, name: 'node2' })
 *
 * // This will work because the name has not changed.
 * graph.replace({ count: 15, name: 'node1' })
 *
 * // This will not work because the name has changed.
 * graph.replace({ count: 20, name: 'node3' })
 * ```
 *
 * [[`replace`]] will throw a [[`NodeDoesntExistError`]] exception if you are trying to replace a node that is missing from the graph.
 *
 * ### Upsert
 *
 * Often you will want to create a node node if it doesn't exist and update it does. This can be achieved using [[`upsert`]].
 *
 * ```typescript
 * const node1: string = graph.insert({ count: 5, name: 'node1' })
 *
 * // Both of these will work, the first updating node1 and the second creating a node.
 * const node2: string = graph.upsert({ count: 15, name: 'node1' })
 * const node3: string = graph.upsert({ count: 25, name: 'node3' })
 * ```
 *
 * [[`upsert`]] always return the node identity string of the inserted or updated node. At presented there is no way to tell if the node was created or updated.
 *
 * @typeParam Node `Node` is the node type of the graph. Nodes can be anything in all the included examples they are simple objects.
 * @typeParam Edge `Edge` is the edge type of the graph. Edges can be of any type, but must be truethy and by default they are `true` which is a simple boolean.
 * @typeParam NodeId `NodeId` is the identity type of the node, by default it is a `unknown`, though most will use `string` or `number`.
 * @typeParam EdgeId `EdgeId` is the identity type of the edge, by default it is a `unknown`, though most will use `string` or `number`.
 */

export type AdjacencyValue<Edge> = null | Array<Edge>;
export type AdjacencyMatrix<Edge> = Array<Array<AdjacencyValue<Edge>>>;

/**
 * Events that can be emitted by the TaskGraph
 */
export type GraphEvents<NodeId, EdgeId> = keyof GraphEventListeners<NodeId, EdgeId>;

export type GraphEventListeners<NodeId, EdgeId> = {
  "node-added": (node: NodeId) => void;
  "node-removed": (node: NodeId) => void;
  "node-replaced": (node: NodeId) => void;
  "edge-added": (edge: EdgeId) => void;
  "edge-removed": (edge: EdgeId) => void;
  "edge-replaced": (edge: EdgeId) => void;
};

export type GraphEventListener<
  NodeId,
  EdgeId,
  Event extends GraphEvents<NodeId, EdgeId>,
> = GraphEventListeners<NodeId, EdgeId>[Event];

export type GraphEventParameters<
  NodeId,
  EdgeId,
  Event extends GraphEvents<NodeId, EdgeId>,
> = Parameters<GraphEventListeners<NodeId, EdgeId>[Event]>;

export class Graph<Node, Edge = true, NodeId = unknown, EdgeId = unknown> {
  protected nodes: Map<NodeId, Node>;
  protected adjacency: AdjacencyMatrix<Edge>;
  protected nodeIdentity: (t: Node) => NodeId;
  protected edgeIdentity: (t: Edge, n1: NodeId, n2: NodeId) => EdgeId;
  /** O(1) lookup of node identity → adjacency matrix index. */
  protected nodeIndexMap: Map<NodeId, number> = new Map();

  constructor(
    nodeIdentity: (node: Node) => NodeId,
    edgeIdentity: (edge: Edge, node1Identity: NodeId, node2Identit: NodeId) => EdgeId
  ) {
    this.nodes = new Map();
    this.adjacency = [];
    this.nodeIdentity = nodeIdentity;
    this.edgeIdentity = edgeIdentity;
  }

  /** Returns the adjacency matrix index for a node, or -1 if not found. */
  protected getNodeIndex(nodeIdentity: NodeId): number {
    return this.nodeIndexMap.get(nodeIdentity) ?? -1;
  }

  events = new EventEmitter<GraphEventListeners<NodeId, EdgeId>>();
  on<Event extends GraphEvents<NodeId, EdgeId>>(
    name: Event,
    fn: GraphEventListener<NodeId, EdgeId, Event>
  ) {
    this.events.on.call(this.events, name, fn);
  }
  off<Event extends GraphEvents<NodeId, EdgeId>>(
    name: Event,
    fn: GraphEventListener<NodeId, EdgeId, Event>
  ) {
    this.events.off.call(this.events, name, fn);
  }
  emit<Event extends GraphEvents<NodeId, EdgeId>>(
    name: Event,
    ...args: Parameters<GraphEventListener<NodeId, EdgeId, Event>>
  ) {
    this.events.emit<Event>(name, ...args);
  }

  /**
   * Add a node to the graph if it doesn't already exist. If it does, throw a [[`NodeAlreadyExistsError`]].
   *
   * @param node The node to be added
   * @returns A `string` that is the identity of the newly inserted node. This is created by applying the [[constructor | `nodeIdentity`]].
   */
  insert(node: Node): NodeId {
    const id = this.nodeIdentity(node);
    const isOverwrite = this.nodes.has(id);

    if (isOverwrite) {
      throw new NodeAlreadyExistsError(node, this.nodes.get(id), id);
    }

    this.nodeIndexMap.set(id, this.adjacency.length);
    this.nodes.set(id, node);
    // Append a new column (the new node) to every existing row, then push the
    // new node's own row. forEach signals the side-effect intent and avoids the
    // throwaway array that Array.prototype.map would allocate.
    this.adjacency.forEach((adj) => adj.push(null));
    this.adjacency.push(new Array<AdjacencyValue<Edge>>(this.adjacency.length + 1).fill(null));

    this.emit("node-added", id);

    return id;
  }

  /**
   * This replaces an existing node in the graph with an updated version.
   * Throws a [[`NodeDoesNotExistsError`]] if no node with the same identity already exists.
   *
   * __Caveat_:_ The default identity function means that this will never work since if the node changes it will have a different [[`hash`]].
   *
   * @param node The new node that is replacing the old one.
   */
  replace(node: Node): void {
    const id = this.nodeIdentity(node);
    const isOverwrite = this.nodes.has(id);

    if (!isOverwrite) {
      throw new NodeDoesntExistError(id);
    }

    this.nodes.set(id, node);

    this.emit("node-replaced", id);
  }

  /**
   * This essentially combines the behavior of [[`insert`]] and [[`replace`]].
   * If the node doesn't exist, create it. If the node already exists, replace it with the updated version.
   *
   * @param node The node to insert or update
   * @returns The identity string of the node inserted or updated.
   */
  upsert(node: Node): NodeId {
    const id = this.nodeIdentity(node);
    const isOverwrite = this.nodes.has(id);

    this.nodes.set(id, node);

    if (!isOverwrite) {
      this.nodeIndexMap.set(id, this.adjacency.length);
      this.adjacency.forEach((adj) => adj.push(null));
      this.adjacency.push(new Array<AdjacencyValue<Edge>>(this.adjacency.length + 1).fill(null));
      this.emit("node-added", id);
    } else {
      this.emit("node-replaced", id);
    }

    return id;
  }

  /**
   * Create an edge between two nodes in the graph.
   * Throws a [[`NodeDoesNotExistsError`]] if no either of the nodes you are attempting to connect do not exist.
   *
   * @param node1Identity The first node to connect (in [[`DirectedGraph`]]s and [[`DirectedAcyclicGraph`]]s this is the `source` node.)
   * @param node2Identity The second node to connect (in [[`DirectedGraph`]]s and [[`DirectedAcyclicGraph`]]s this is the `target` node)
   * @param edge The edge to be added. By default this is `true` but it can be any type.
   */
  addEdge(node1Identity: NodeId, node2Identity: NodeId, edge?: Edge): EdgeId {
    if (edge === undefined) {
      edge = true as Edge;
    }
    const node1Exists = this.nodes.has(node1Identity);
    const node2Exists = this.nodes.has(node2Identity);

    if (!node1Exists) {
      throw new NodeDoesntExistError(node1Identity);
    }

    if (!node2Exists) {
      throw new NodeDoesntExistError(node2Identity);
    }

    const node1Index = this.getNodeIndex(node1Identity);
    const node2Index = this.getNodeIndex(node2Identity);

    const id = this.edgeIdentity(edge, node1Identity, node2Identity);

    // De-duplicate by edgeIdentity (matching removeEdge), not raw value
    // equality. Using includes() would conflate two edges that are distinct by
    // identity but reference/value-equal, and would prevent a multigraph for
    // the default `true` edge type since every edge value is identical.
    if (this.adjacency[node1Index][node2Index] === null) {
      this.adjacency[node1Index][node2Index] = [edge];
    } else {
      const existing = this.adjacency[node1Index][node2Index]!;
      const alreadyPresent = existing.some(
        (e) => this.edgeIdentity(e, node1Identity, node2Identity) === id
      );
      if (!alreadyPresent) {
        existing.push(edge);
      }
    }

    this.emit("edge-added", id);

    return id;
  }

  /**
   * This simply returns all the nodes stored in the graph
   *
   * @param compareFunc An optional function that indicates the sort order of the returned array
   */
  getNodes(compareFunc?: (a: Node, b: Node) => number): Node[] {
    const temp = Array.from(this.nodes.values());

    if (compareFunc !== undefined) {
      return temp.sort(compareFunc);
    }

    return temp;
  }

  /**
   * Returns a specific node given the node identity returned from the [[`insert`]] function
   */
  getNode(nodeIdentity: NodeId): Node | undefined {
    return this.nodes.get(nodeIdentity);
  }

  /**
   * Returns true if the node exists in the graph.
   */
  hasNode(nodeIdentity: NodeId): boolean {
    return this.nodes.has(nodeIdentity);
  }

  /**
   * Returns all edges in the graph as an array of tuples.
   */
  getEdges(): Array<[node1Identity: NodeId, node2Identity: NodeId, edge: Edge]> {
    const toReturn: Array<[node1Identity: NodeId, node2Identity: NodeId, edge: Edge]> = [];

    const nodeKeys = Array.from(this.nodes.keys());
    this.adjacency.forEach((row, rowIndex) => {
      const node1Identity = nodeKeys[rowIndex];
      if (node1Identity != null) {
        row.forEach((edges, colIndex) => {
          if (edges !== null) {
            const node2Identity = nodeKeys[colIndex];
            if (node2Identity != null) {
              for (const edge of edges) {
                toReturn.push([node1Identity, node2Identity, edge]);
              }
            }
          }
        });
      }
    });

    return toReturn;
  }

  /**
   * Returns the out edges for a specific node.
   */
  outEdges(
    node1Identity: NodeId
  ): Array<[node1Identity: NodeId, node2Identity: NodeId, edge: Edge]> {
    const nodeKeys = Array.from(this.nodes.keys());
    const nodeIndex = this.getNodeIndex(node1Identity);

    const toReturn: Array<[node1Identity: NodeId, node2Identity: NodeId, edge: Edge]> = [];

    this.adjacency[nodeIndex].forEach((edges, colIndex) => {
      if (edges !== null) {
        const node2Identity = nodeKeys[colIndex];
        if (node2Identity != null) {
          for (const edge of edges) {
            toReturn.push([node1Identity, node2Identity, edge]);
          }
        }
      }
    });

    return toReturn;
  }

  /**
   * Returns the in edges for a specific node.
   */
  inEdges(
    node2Identity: NodeId
  ): Array<[node1Identity: NodeId, node2Identity: NodeId, edge: Edge]> {
    const nodeKeys = Array.from(this.nodes.keys());
    const node2Index = this.getNodeIndex(node2Identity);

    const toReturn: Array<[node1Identity: NodeId, node2Identity: NodeId, edge: Edge]> = [];

    this.adjacency.forEach((row, rowIndex) => {
      const node1Identity = nodeKeys[rowIndex];
      const edges = row[node2Index];
      if (edges !== null) {
        for (const edge of edges) {
          toReturn.push([node1Identity, node2Identity, edge]);
        }
      }
    });

    return toReturn;
  }

  /**
   * Returns the edges for a specific node.
   */
  nodeEdges(
    nodeIdentity: NodeId
  ): Array<[node1Identity: NodeId, node2Identity: NodeId, edge: Edge]> {
    return [...this.outEdges(nodeIdentity), ...this.inEdges(nodeIdentity)];
  }

  /**
   * Deletes an edge between two nodes in the graph.
   * Throws a [[`NodeDoesNotExistsError`]] if either of the nodes do not exist.
   *
   * @param node1Identity The identity of the first node (in [[`DirectedGraph`]]s and [[`DirectedAcyclicGraph`]]s this is the `from` node.)
   * @param node2Identity The identity of the second node (in [[`DirectedGraph`]]s and [[`DirectedAcyclicGraph`]]s this is the `to` node)
   * @param edgeIdentity The identity of the edge to be deleted. If not provided, all edges between the two nodes will be deleted.
   */
  removeEdge(node1Identity: NodeId, node2Identity: NodeId, edgeIdentity?: EdgeId): void {
    const node1Exists = this.nodes.has(node1Identity);
    const node2Exists = this.nodes.has(node2Identity);

    if (!node1Exists) {
      throw new NodeDoesntExistError(node1Identity);
    }

    if (!node2Exists) {
      throw new NodeDoesntExistError(node2Identity);
    }

    const node1Index = this.getNodeIndex(node1Identity);
    const node2Index = this.getNodeIndex(node2Identity);

    if (edgeIdentity === undefined) {
      // Remove all edges between the pair. Emit one event per actually-removed
      // edge carrying its real EdgeId, rather than a single event with
      // `undefined` cast to EdgeId (which violates the listener contract).
      const edgeList = this.adjacency[node1Index][node2Index];
      this.adjacency[node1Index][node2Index] = null;
      if (edgeList !== null) {
        for (const edge of edgeList) {
          this.emit("edge-removed", this.edgeIdentity(edge, node1Identity, node2Identity));
        }
      }
    } else {
      // Remove the specific edge matching edgeIdentity from this node pair.
      // Only emit edge-removed if an edge was actually removed.
      const edgeList = this.adjacency[node1Index][node2Index];
      if (edgeList !== null) {
        for (let edgeIndex = 0; edgeIndex < edgeList.length; edgeIndex++) {
          if (
            this.edgeIdentity(edgeList[edgeIndex], node1Identity, node2Identity) === edgeIdentity
          ) {
            edgeList.splice(edgeIndex, 1);
            if (edgeList.length === 0) {
              this.adjacency[node1Index][node2Index] = null;
            }
            this.emit("edge-removed", edgeIdentity);
            break;
          }
        }
      }
    }
  }

  /**
   * Deletes a node from the graph, along with any edges associated with it.
   * Throws a [[`NodeDoesNotExistsError`]] if the node does not exist.
   *
   * @param nodeIdentity The identity of the node to be deleted.
   */
  remove(nodeIdentity: NodeId): void {
    if (!this.nodes.has(nodeIdentity)) {
      throw new NodeDoesntExistError(nodeIdentity);
    }

    // Capture index BEFORE deleting the node — needed to splice the matrix below.
    const nodeIndex = this.getNodeIndex(nodeIdentity);

    this.nodes.delete(nodeIdentity);
    this.nodeIndexMap.delete(nodeIdentity);

    // Decrement indices for all nodes that came after the removed one.
    for (const [id, idx] of this.nodeIndexMap) {
      if (idx > nodeIndex) {
        this.nodeIndexMap.set(id, idx - 1);
      }
    }

    this.adjacency.splice(nodeIndex, 1);
    this.adjacency.forEach((row) => row.splice(nodeIndex, 1));

    this.emit("node-removed", nodeIdentity);
  }

  /**
   * @alias remove
   */
  removeNode(nodeIdentity: NodeId): void {
    return this.remove(nodeIdentity);
  }

  /**
   * @alias insert
   */
  addNode(node: Node): NodeId {
    return this.insert(node);
  }

  /**
   * Add nodes in bulk
   */
  addNodes(nodes: Node[]): NodeId[] {
    return nodes.map((node) => this.insert(node));
  }

  /**
   * Add edges
   * @param edges An array of tuples, each tuple containing the identity of the source node, the identity of the target node, and the edge to add.
   */
  addEdges(
    edges: Array<[node1Identity: NodeId, node2Identity: NodeId, edge?: Edge | undefined]>
  ): EdgeId[] {
    return edges.map(([node1Identity, node2Identity, edge]) =>
      this.addEdge(node1Identity, node2Identity, edge)
    );
  }
}

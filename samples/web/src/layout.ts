import { Edge, Node, Position } from "@xyflow/react";
import { DirectedAcyclicGraph } from "@sroussey/typescript-graph";

type PositionXY = {
  x: number;
  y: number;
};

interface LayoutOptions {
  nodeWidthMin: number;
  nodeHeightMin: number;
  horizontalSpacing: number;
  verticalSpacing: number;
  startTop: number;
  startLeft: number;
}

export class GraphPipelineLayout<T extends Node> implements LayoutOptions {
  protected dataflowDAG: DirectedAcyclicGraph<T, boolean, string, string>;
  protected positions: Map<string, PositionXY> = new Map();
  protected layerHeight: number[] = [];
  public layers: Map<number, T[]> = new Map();
  public nodeWidthMin: number = 190;
  public nodeHeightMin: number = 50;
  public horizontalSpacing = 80; // Horizontal spacing between layers
  public verticalSpacing = 20; // Vertical spacing between nodes within a layer
  public startTop = 50; // Starting position of the top layer
  public startLeft = 50; // Starting position of the left layer

  constructor(options?: Partial<LayoutOptions>) {
    Object.assign(this, options);
  }

  public setGraph(dag: DirectedAcyclicGraph<T, boolean, string, string>) {
    this.dataflowDAG = dag;
    this.layers = new Map();
    this.layerHeight = [];
  }

  public layoutGraph() {
    const sortedNodes = this.dataflowDAG.topologicallySortedNodes();
    this.assignLayers(sortedNodes);
    this.positionNodes();
  }

  public assignLayers(sortedNodes: T[]) {
    this.layers = new Map();
    const nodeToLayer = new Map<string, number>();

    // Initialize layer height for each layer
    this.layerHeight = [];

    sortedNodes.forEach((node, _index) => {
      let maxLayer = -1;

      // Get all incoming edges (dependencies) of the node
      const incomingEdges = this.dataflowDAG.inEdges(node.id).map(([from]) => from);

      incomingEdges.forEach((from) => {
        // Find the layer of the dependency
        const layer = nodeToLayer.get(from);
        if (layer !== undefined) {
          maxLayer = Math.max(maxLayer, layer);
        }
      });

      // Assign the node to the next layer after the maximum layer of its dependencies
      const assignedLayer = maxLayer + 1;
      nodeToLayer.set(node.id, assignedLayer);

      if (!this.layers.has(assignedLayer)) {
        this.layers.set(assignedLayer, []);
        this.layerHeight[assignedLayer] = 0; // Initialize layer height
      }

      this.layers.get(assignedLayer)?.push(node);
    });
  }

  protected positionNodes() {
    let currentX = this.startLeft;
    this.layers.forEach((nodes, layer) => {
      let nodeWidth = this.nodeWidthMin;
      let currentY = this.startTop;
      nodes.forEach((node) => {
        node.position = { x: currentX, y: currentY };

        const nodeHeight = this.getNodeHeight(node);

        // Move Y to the next position for the following node
        currentY += nodeHeight + this.verticalSpacing;
        nodeWidth = Math.max(this.getNodeWidth(node), nodeWidth);

        this.layerHeight[layer] = Math.max(this.layerHeight[layer], currentY);
      });

      // Move X to the next position for the next layer
      currentX += nodeWidth + this.horizontalSpacing;
    });
  }

  public getNodeHeight(node: T): number {
    const baseHeight = node.height || node.measured?.height || this.nodeHeightMin;
    return Math.max(baseHeight, this.nodeHeightMin);
  }

  public getNodeWidth(node: T): number {
    const baseWidth = node.width || node.measured?.width || this.nodeWidthMin;
    return Math.max(baseWidth, this.nodeWidthMin);
  }
}

export class GraphPipelineCenteredLayout<T extends Node> extends GraphPipelineLayout<T> {
  protected positionNodes() {
    super.positionNodes();
    this.layers.forEach((nodes, layer) => {
      let currentY = (this.getMaxLayerHeight() - this.layerHeight[layer]) / 2 + this.startTop; // Start Y for centering

      nodes.forEach((node) => {
        const nodeHeight = this.getNodeHeight(node);

        node.position = {
          x: node.position.x,
          y: currentY,
        };

        currentY += nodeHeight + this.verticalSpacing;
      });
    });
  }

  private getMaxLayerHeight(): number {
    // Return the height of the tallest layer
    return Math.max(...this.layerHeight);
  }
}
const groupBy = <T = any>(items: T[], key: keyof T) =>
  items.reduce(
    (result: Record<string, T[]>, item: T) => ({
      ...result,
      [String(item[key])]: [...(result[String(item[key])] || []), item],
    }),
    {}
  );

export function computeLayout(
  nodes: Node[],
  edges: Edge[],
  layout: GraphPipelineLayout<Node>,
  subFlowLayout?: GraphPipelineLayout<Node>
): Node[] {
  // before we bother with anything, ignore hidden nodes
  nodes = nodes.filter((node) => !node.hidden);

  const subgraphSize = new Map<string, { height: number; width: number }>();
  const subgraphDAG = new DirectedAcyclicGraph<Node, boolean, string, string>((node) => node.id);

  nodes.forEach((node) => {
    subgraphDAG.insert(node);
  });

  nodes.forEach((node) => {
    if (node.parentId) {
      subgraphDAG.addEdge(node.parentId, node.id);
    }
  });

  const subgraphDepthLayout = new GraphPipelineLayout();
  subgraphDepthLayout.setGraph(subgraphDAG);
  const sortedNodes = subgraphDAG.topologicallySortedNodes();
  subgraphDepthLayout.assignLayers(sortedNodes);
  const allgraphs = Array.from(subgraphDepthLayout.layers.values());

  const returnNodes: Node[] = [];
  for (let i = allgraphs.length - 1; i >= 0; i--) {
    const graphs = groupBy<Node>(allgraphs[i], "parentId");
    for (const parentId in graphs) {
      // This loop goes from innermost graph to outermost graph
      // and lays out the nodes in each graph. We do innermost
      // first so that the outer nodes can be positioned based on
      // the size and layout of the inner nodes (the parent needs
      // to expand to fit the children).

      const subgraphNodes = graphs[parentId];

      const dataflowDAG = new DirectedAcyclicGraph<Node, boolean, string, string>(
        (node) => node.id
      );

      subgraphNodes.forEach((node) => {
        dataflowDAG.insert(node);
      });

      edges.forEach((edge) => {
        if (dataflowDAG.hasNode(edge.source) && dataflowDAG.hasNode(edge.target))
          dataflowDAG.addEdge(edge.source, edge.target);
      });
      subgraphNodes.forEach((node) => {
        if (subgraphSize.has(node.id)) {
          const sizes = subgraphSize.get(node.id);
          node.height = sizes.height;
          node.width = sizes.width;
        }
      });
      const last = subgraphNodes[subgraphNodes.length - 1];
      const l = parentId === "undefined" ? layout : subFlowLayout;
      l.setGraph(dataflowDAG);
      l.layoutGraph();

      subgraphSize.set(parentId, {
        width: l.startLeft + (last.position?.x || 0) + l.getNodeWidth(last),
        height: l.startTop / 2 + (last.position?.y || 0) + l.getNodeHeight(last),
      });

      returnNodes.push(...subgraphNodes);
    }
  }

  return returnNodes.reverse().map((node) => ({ ...node }));
}

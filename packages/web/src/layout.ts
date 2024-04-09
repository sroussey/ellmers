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
  protected dag: DirectedAcyclicGraph<T, boolean, string, string>;
  protected positions: Map<string, PositionXY> = new Map();
  protected layerHeight: number[] = [];
  protected layers: Map<number, T[]> = new Map();
  public nodeWidthMin: number = 190;
  public nodeHeightMin: number = 150;
  public horizontalSpacing = 80; // Horizontal spacing between layers
  public verticalSpacing = 20; // Vertical spacing between nodes within a layer
  public startTop = 50; // Starting position of the top layer
  public startLeft = 50; // Starting position of the left layer

  constructor(options?: Partial<LayoutOptions>) {
    Object.assign(this, options);
  }

  public setGraph(dag: DirectedAcyclicGraph<T, boolean, string, string>) {
    this.dag = dag;
    this.positions = new Map();
    this.layers = new Map();
    this.layerHeight = [];
  }

  public layoutGraph() {
    const sortedNodes = this.dag.topologicallySortedNodes();
    this.assignLayers(sortedNodes);
    this.positionNodes();
    // Optionally, you can include edge drawing logic here or handle it separately
  }

  private assignLayers(sortedNodes: T[]) {
    this.layers = new Map();
    const nodeToLayer = new Map<string, number>();

    // Initialize layer height for each layer
    this.layerHeight = [];

    sortedNodes.forEach((node, _index) => {
      let maxLayer = -1;

      // Get all incoming edges (dependencies) of the node
      const incomingEdges = this.dag.inEdges(node.id).map(([from]) => from);

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
        this.positions.set(node.id, {
          x: currentX,
          y: currentY,
        });

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

  protected getNodeHeight(node: T): number {
    return Math.max(node.measured?.height, this.nodeHeightMin);
  }

  protected getNodeWidth(node: T): number {
    return Math.max(node.measured?.width, this.nodeWidthMin);
  }

  public getNodePosition(nodeIdentity: string): PositionXY | undefined {
    return this.positions.get(nodeIdentity);
  }
}

export class GraphPipelineCenteredLayout<T extends Node> extends GraphPipelineLayout<T> {
  protected positionNodes() {
    super.positionNodes();
    this.layers.forEach((nodes, layer) => {
      let currentY = (this.getMaxLayerHeight() - this.layerHeight[layer]) / 2 + this.startTop; // Start Y for centering

      nodes.forEach((node) => {
        const nodeHeight = this.getNodeHeight(node);

        this.positions.set(node.id, {
          x: this.positions.get(node.id)!.x,
          y: currentY,
        });

        currentY += nodeHeight + this.verticalSpacing;
      });
    });
  }

  private getMaxLayerHeight(): number {
    // Return the height of the tallest layer
    return Math.max(...this.layerHeight);
  }
}

export function computeLayout(
  nodes: Node[],
  edges: Edge[],
  layout: GraphPipelineLayout<Node>,
  subFlowLayout?: GraphPipelineLayout<Node>,
  parentId?: string
): Node[] {
  const g = new DirectedAcyclicGraph<Node, boolean, string, string>((node) => node.id);

  nodes = nodes.filter((node) => !node.hidden);

  const topLevelNodes = nodes.filter(
    (node) => node.parentId === undefined || node.parentId === parentId
  );

  topLevelNodes.forEach((node) => {
    g.insert(node);
  });

  edges.forEach((edge) => {
    try {
      g.addEdge(edge.source, edge.target);
    } catch (e) {
      // might be an edge to a hidden node
    }
  });

  layout.setGraph(g);
  layout.layoutGraph();

  const returnNodes: Node[] = topLevelNodes.map((node) => {
    const nodePosition = layout.getNodePosition(node.id)!;

    return {
      ...node,
      targetPosition: Position.Left,
      sourcePosition: Position.Right,
      position: { x: nodePosition.x, y: nodePosition.y },
    };
  });

  for (const node of topLevelNodes) {
    const children = nodes.filter((n) => n.parentId === node.id);

    if (children.length > 0) {
      const childNodes = computeLayout(
        children,
        edges,
        subFlowLayout ?? layout,
        subFlowLayout ?? layout,
        node.id
      );
      returnNodes.push(...childNodes);
    }
  }
  return returnNodes;
}

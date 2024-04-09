import React, { Dispatch, SetStateAction, useCallback, useEffect, useRef } from "react";
import {
  ReactFlow,
  Controls,
  useNodesState,
  useEdgesState,
  Node,
  useNodesInitialized,
  useReactFlow,
  Edge,
} from "@xyflow/react";

import "@xyflow/react/dist/base.css";
import "./RunGraphFlow.css";
import { TurboNodeData, SingleNode, CompoundNode } from "./TurboNode";
import TurboEdge from "./TurboEdge";
import { FiFileText, FiClipboard, FiDownload, FiUpload } from "react-icons/fi";
import {
  Task,
  TaskGraph,
  registerHuggingfaceLocalTasksInMemory,
  registerMediaPipeTfJsLocalInMemory,
} from "ellmers-core/browser";
import { GraphPipelineCenteredLayout, GraphPipelineLayout, computeLayout } from "./layout";

registerHuggingfaceLocalTasksInMemory();
registerMediaPipeTfJsLocalInMemory();

const categoryIcons = {
  "Text Model": <FiFileText />,
  Input: <FiUpload />,
  Output: <FiDownload />,
  Utility: <FiClipboard />,
};

function sortNodes(nodes: Node<TurboNodeData>[]): Node<TurboNodeData>[] {
  // Map to hold nodes grouped by their parent ID
  const parentMap: Map<string | undefined, Node<TurboNodeData>[]> = new Map();

  // Group nodes by parent ID
  nodes.forEach((node) => {
    const parent = node.parentId || "###root###";
    if (!parentMap.has(parent)) {
      parentMap.set(parent, []);
    }
    parentMap.get(parent)?.push(node);
  });

  // Recursive function to get a node and all its descendants
  const appendChildren = (nodeId: string | "###root###"): Node<TurboNodeData>[] => {
    const children = parentMap.get(nodeId) || [];
    const result: Node<TurboNodeData>[] = [];

    children.forEach((child) => {
      // Append the child and its descendants
      result.push(child, ...appendChildren(child.id));
    });

    return result;
  };

  // Start the recursion from the root nodes
  return appendChildren("###root###");
}

function convertGraphToNodes(graph: TaskGraph): Node<TurboNodeData>[] {
  const tasks = graph.getNodes();
  const nodes = tasks.flatMap((node, index) => {
    let n: Node<TurboNodeData>[] = [
      {
        id: node.config.id as string,
        position: { x: 0, y: 0 },
        data: {
          icon: categoryIcons[(node.constructor as any).category],
          title: (node.constructor as any).type,
          subline: node.config.name,
        },
        type: node.isCompound ? "compound" : "single",
      },
    ];
    if (node.isCompound) {
      const subNodes = convertGraphToNodes(node.subGraph).map((n) => {
        return {
          ...n,
          parentId: node.config.id as string,
          extent: "parent",
          selectable: false,
          connectable: false,
        } as Node<TurboNodeData>;
      });
      n = [...n, ...subNodes];
    }
    return n;
  });
  return nodes;
}

function listenToTask(task: Task, setNodes: Dispatch<SetStateAction<Node<TurboNodeData>[]>>) {
  task.on("progress", (progress, progressText) => {
    setNodes((nds) =>
      nds.map((nd) => {
        if (nd.id === task.config.id) {
          return {
            ...nd,
            data: {
              ...nd.data,
              active: true,
              progress,
              progressText,
            },
          };
        }
        return nd;
      })
    );
  });
  task.on("start", () => {
    setNodes((nds) =>
      nds.map((nd) => {
        if (nd.id === task.config.id) {
          return {
            ...nd,
            data: {
              ...nd.data,
              active: true,
              progress: 1,
              progressText: "",
            },
          };
        }
        return nd;
      })
    );
  });
  task.on("complete", () => {
    setNodes((nds) =>
      nds.map((nd) => {
        if (nd.id === task.config.id) {
          return {
            ...nd,
            data: {
              ...nd.data,
              active: false,
              progress: 100,
            },
          };
        }
        return nd;
      })
    );
  });
  task.on("error", () => {
    setNodes((nds) =>
      nds.map((nd) => {
        if (nd.id === task.config.id) {
          return {
            ...nd,
            data: {
              ...nd.data,
              active: false,
              progress: 100,
            },
          };
        }
        return nd;
      })
    );
  });
  if (task.isCompound) {
    listenToGraphNodes(task.subGraph, setNodes);
    task.on("regenerate", () => {
      // console.log("Node regenerated", task.config.id);
      setNodes((nodes: Node<TurboNodeData>[]) => {
        const children = convertGraphToNodes(task.subGraph).map(
          (n) =>
            ({
              ...n,
              parentId: task.config.id as string,
              extent: "parent",
              selectable: false,
              connectable: false,
            }) as Node<TurboNodeData>
        );
        listenToGraphNodes(task.subGraph, setNodes);
        let returnNodes = nodes.filter((n) => n.parentId !== task.config.id); // remove old children
        returnNodes = [...returnNodes, ...children]; // add new children
        returnNodes = sortNodes(returnNodes); // sort all nodes (parent, children, parent, children, ...)
        return returnNodes;
      });
    });
  }
}

function listenToGraphNodes(
  graph: TaskGraph,
  setNodes: Dispatch<SetStateAction<Node<TurboNodeData>[]>>
) {
  const nodes = graph.getNodes();
  for (const node of nodes) {
    listenToTask(node, setNodes);
  }
}

const nodeTypes = {
  single: SingleNode,
  compound: CompoundNode,
};

const edgeTypes = {
  turbo: TurboEdge,
};

const defaultEdgeOptions = {
  type: "turbo",
  markerEnd: "edge-circle",
};

export const RunGraphFlow: React.FC<{
  graph: TaskGraph;
}> = ({ graph }) => {
  const [nodes, setNodes, onNodesChangeTheirs] = useNodesState<Node<TurboNodeData>>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);
  const graphRef = useRef<TaskGraph | null>(null);

  const onNodesChange = useCallback(
    (changes: any) => {
      console.log("Nodes changed", changes);
      onNodesChangeTheirs(changes);
    },
    [onNodesChangeTheirs, nodes, edges]
  );

  const initialized = useNodesInitialized() && !nodes.some((n) => !n.measured);
  const { fitView } = useReactFlow();

  useEffect(() => {
    if (initialized) {
      const computedNodes = computeLayout(
        nodes,
        edges,
        new GraphPipelineCenteredLayout(),
        new GraphPipelineLayout({ startTop: 100, startLeft: 20 })
      ) as Node<TurboNodeData>[];
      const sortedNodes = sortNodes(computedNodes);
      setNodes(
        sortedNodes.map((n) => {
          n.style = { opacity: 1 };
          return n;
        })
      );
      setEdges(
        edges.map((n) => {
          return {
            ...n,
            style: { opacity: 1 },
          };
        })
      );
      setTimeout(() => {
        fitView();
      }, 5);
    }
  }, [initialized]);

  useEffect(() => {
    if (graph !== graphRef.current) {
      graphRef.current = graph;
      const nodes = sortNodes(convertGraphToNodes(graph));
      setNodes(
        nodes.map((n) => {
          return {
            ...n,
            style: { opacity: 0 },
          };
        })
      );

      setEdges(
        graph.getEdges().map(([source, target, edge]) => {
          return {
            id: edge.id,
            source: source as string,
            target: target as string,
            style: { opacity: 0 },
          };
        })
      );
      listenToGraphNodes(graph, setNodes);
    }
  }, [graph]);

  // const onConnect = useCallback(
  //   (params: any) => setEdges((els) => addEdge(params, els)),
  //   [setEdges]
  // );

  return (
    <ReactFlow
      nodes={nodes}
      edges={edges}
      onNodesChange={onNodesChange}
      onEdgesChange={onEdgesChange}
      // onConnect={onConnect}
      // fitView
      nodeTypes={nodeTypes}
      edgeTypes={edgeTypes}
      defaultEdgeOptions={defaultEdgeOptions}
    >
      <Controls showInteractive={false} />

      <svg>
        <defs>
          <linearGradient id="edge-gradient">
            <stop offset="0%" stopColor="#ae53ba" />
            <stop offset="100%" stopColor="#2a8af6" />
          </linearGradient>

          <marker
            id="edge-circle"
            viewBox="-5 -5 10 10"
            refX="0"
            refY="0"
            markerUnits="strokeWidth"
            markerWidth="10"
            markerHeight="10"
            orient="auto"
          >
            <circle stroke="#2a8af6" strokeOpacity="0.75" r="2" cx="0" cy="0" />
          </marker>
        </defs>
      </svg>
    </ReactFlow>
  );
};

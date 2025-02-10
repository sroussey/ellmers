//    *******************************************************************************
//    *   ELLMERS: Embedding Large Language Model Experiential Retrieval Service    *
//    *                                                                             *
//    *   Copyright Steven Roussey <sroussey@gmail.com>                             *
//    *   Licensed under the Apache License, Version 2.0 (the "License");           *
//    *******************************************************************************

import React, { Dispatch, SetStateAction, useEffect, useRef } from "react";
import {
  ReactFlow,
  Controls,
  useNodesState,
  useEdgesState,
  Node,
  useNodesInitialized,
  useReactFlow,
  Edge,
  Position,
} from "@xyflow/react";
import { TurboNodeData, SingleNode, CompoundNode } from "./TurboNode";
import TurboEdge from "./TurboEdge";
import { FiFileText, FiClipboard, FiDownload, FiUpload } from "react-icons/fi";
import { Task, TaskGraph } from "@ellmers/task-graph";
import { GraphPipelineCenteredLayout, GraphPipelineLayout, computeLayout } from "./layout";

import "@xyflow/react/dist/base.css";
import "./RunGraphFlow.css";

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
  const nodes = tasks.flatMap((task, index) => {
    let n: Node<TurboNodeData>[] = [
      {
        id: task.config.id as string,
        position: { x: 0, y: 0 },
        data: {
          icon: categoryIcons[(task.constructor as any).category],
          title: (task.constructor as any).type,
          subline: task.config.name,
        },
        type: task.isCompound ? "compound" : "single",
        selectable: true,
        connectable: false,
        draggable: false,
        sourcePosition: Position.Right,
        targetPosition: Position.Left,
      },
    ];
    if (task.isCompound) {
      const subNodes = convertGraphToNodes(task.subGraph).map((n) => {
        return {
          ...n,
          parentId: task.config.id as string,
          extent: "parent",
        } as Node<TurboNodeData>;
      });
      n = [...n, ...subNodes];
    }
    return n;
  });
  return nodes;
}

function doNodeLayout(
  setNodes: Dispatch<SetStateAction<Node[]>>,
  setEdges: Dispatch<SetStateAction<Edge[]>>
) {
  let edges = [];
  setEdges((es) => {
    edges = es.map((n) => {
      return {
        ...n,
        style: { opacity: 1 },
      };
    });
    setNodes((nodes) => {
      const computedNodes = computeLayout(
        nodes,
        edges,
        new GraphPipelineCenteredLayout<Node<TurboNodeData>>(),
        new GraphPipelineLayout<Node<TurboNodeData>>({ startTop: 100, startLeft: 20 })
      ) as Node<TurboNodeData>[];
      const sortedNodes = sortNodes(computedNodes);
      sortedNodes.map((n) => {
        n.style = { opacity: 1 };
        return n;
      });
      return sortedNodes;
    });
    return edges;
  });
}

function updateNodeData(
  nodeId: unknown,
  newData: Partial<TurboNodeData>,
  setNodes: Dispatch<SetStateAction<Node<TurboNodeData>[]>>
) {
  setNodes((prevNodes) => {
    const newNodes = prevNodes.map((nd) => {
      if (nd.id != nodeId) {
        return nd;
      }
      return {
        ...nd,
        data: {
          ...nd.data,
          ...newData,
        },
      };
    });

    return newNodes;
  });
}

// TODO: unlisten to tasks
function listenToTask(
  task: Task,
  setNodes: Dispatch<SetStateAction<Node<TurboNodeData>[]>>,
  setEdges: Dispatch<SetStateAction<Edge[]>>
) {
  const taskId = task.config.id;
  task.on("start", () => {
    updateNodeData(taskId, { active: true, progress: 1, progressText: "" }, setNodes);
  });
  task.on("complete", () => {
    const progressText = task.runOutputData?.text ?? task.runOutputData?.model;
    updateNodeData(
      taskId,
      {
        active: false,
        progress: 100,
        progressText: Array.isArray(progressText) ? "" : progressText,
      },
      setNodes
    );
  });
  task.on("error", (text) => {
    updateNodeData(
      taskId,
      { active: false, progress: 100, progressText: "Error: " + text },
      setNodes
    );
  });
  task.on("abort", (text) => {
    updateNodeData(taskId, { active: false, progress: 100, progressText: "Aborting" }, setNodes);
  });
  task.on("progress", (progress: number, progressText: string, details: any) => {
    updateNodeData(
      taskId,
      {
        active: true,
        progress,
        progressText: details ? details.file || details.text || details.model : progressText,
      },
      setNodes
    );
  });

  if (task.isCompound) {
    listenToGraphTasks(task.subGraph, setNodes, setEdges);
    task.on("regenerate", () => {
      // console.log("Node regenerated", taskId);
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
        listenToGraphTasks(task.subGraph, setNodes, setEdges);
        let returnNodes = nodes.filter((n) => n.parentId !== task.config.id); // remove old children
        returnNodes = [...returnNodes, ...children]; // add new children
        returnNodes = sortNodes(returnNodes); // sort all nodes (parent, children, parent, children, ...)
        return returnNodes;
      });
    });
  }
}

function listenToGraphTasks(
  graph: TaskGraph,
  setNodes: Dispatch<SetStateAction<Node<TurboNodeData>[]>>,
  setEdges: Dispatch<SetStateAction<Edge[]>>
) {
  const nodes = graph.getNodes();
  for (const node of nodes) {
    listenToTask(node, setNodes, setEdges);
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
  const [nodes, setNodes, onNodesChange] = useNodesState<Node<TurboNodeData>>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);
  const graphRef = useRef<TaskGraph | null>(null);

  const shouldLayout = useNodesInitialized() && !nodes.some((n) => !n.measured);
  const { fitView } = useReactFlow();

  useEffect(() => {
    if (shouldLayout) {
      doNodeLayout(setNodes, setEdges);
      setTimeout(() => {
        fitView();
      }, 5);
    }
  }, [shouldLayout, setNodes, setEdges, fitView]);

  useEffect(() => {
    if (graph !== graphRef.current) {
      graphRef.current = graph;
      console.log("Graph changed", graph);
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
      listenToGraphTasks(graph, setNodes, setEdges);
    }
  }, [graph, setNodes, setEdges, graphRef.current]);

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

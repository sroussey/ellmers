/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import type { Dataflow, TaskGraph, TaskGraphEvents } from "@workglow/task-graph";
import type { Edge, EdgeTypes, Node, NodeTypes } from "@xyflow/react";
import { Controls, ReactFlow, useEdgesState, useNodesState, useReactFlow } from "@xyflow/react";
import type { Dispatch, SetStateAction } from "react";
import React, { useCallback, useEffect, useRef } from "react";
import { computeLayout, GraphPipelineCenteredLayout, GraphPipelineLayout } from "../layout";
import type { DataflowEdgeData } from "./DataflowEdge";
import { DataflowEdge } from "./DataflowEdge";
import type { TaskNodeData } from "./TaskNode";
import { TaskNode } from "./TaskNode";
import { updateNode } from "./util";

import "@xyflow/react/dist/base.css";
import "./RunGraphFlow.css";

// Define node types
const nodeTypes: NodeTypes = {
  task: TaskNode,
};

// Define edge types
const edgeTypes: EdgeTypes = {
  dataflow: DataflowEdge,
};

// Default edge options
const defaultEdgeOptions = {
  type: "dataflow",
  animated: false,
};

function doNodeLayout(
  setNodes: Dispatch<SetStateAction<Node<TaskNodeData>[]>>,
  setEdges: Dispatch<SetStateAction<Edge<DataflowEdgeData>[]>>
) {
  let edges: Edge<DataflowEdgeData>[] = [];
  setEdges((es) => {
    edges = es.map((n) => {
      return {
        ...n,
        style: { opacity: 1 },
      };
    });
    setNodes((nodes) => {
      const computedNodes = computeLayout<Node<TaskNodeData>>(
        nodes,
        edges,
        new GraphPipelineCenteredLayout<Node<TaskNodeData>>(),
        new GraphPipelineLayout<Node<TaskNodeData>>({ startTop: 100, startLeft: 20 })
      );
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

// const categoryIcons = {
//   "Text Model": <FiFileText />,
//   Input: <FiUpload />,
//   Output: <FiDownload />,
//   Utility: <FiClipboard />,
// };

function sortNodes(nodes: Node<TaskNodeData>[]): Node<TaskNodeData>[] {
  // Map to hold nodes grouped by their parent ID
  const parentMap: Map<string | undefined, Node<TaskNodeData>[]> = new Map();

  // Group nodes by parent ID
  nodes.forEach((node) => {
    const parent = node.parentId || "###root###";
    if (!parentMap.has(parent)) {
      parentMap.set(parent, []);
    }
    parentMap.get(parent)?.push(node);
  });

  // Recursive function to get a node and all its descendants
  const appendChildren = (nodeId: string | "###root###"): Node<TaskNodeData>[] => {
    const children = parentMap.get(nodeId) || [];
    const result: Node<TaskNodeData>[] = [];

    children.forEach((child) => {
      // Append the child and its descendants
      result.push(child, ...appendChildren(child.id));
    });

    return result;
  };

  // Start the recursion from the root nodes
  return appendChildren("###root###");
}

export const RunGraphFlow: React.FC<{
  graph: TaskGraph;
}> = ({ graph }) => {
  const [nodes, setNodes, onNodesChange] = useNodesState<Node<TaskNodeData>>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge<DataflowEdgeData>>([]);
  const graphRef = useRef<TaskGraph | null>(null);
  const { fitView } = useReactFlow();

  const buildNodesFromTasks = useCallback(
    (taskGraph: TaskGraph) => {
      const tasks = taskGraph.getTasks();
      const dataFlows = taskGraph.getDataflows();

      const newNodes: Node<TaskNodeData>[] = tasks.map((task) => {
        const type = "task";
        const data: TaskNodeData = { task };

        return {
          id: String(task.id),
          type,
          data,
          position: { x: 0, y: 0 },
        };
      });

      const newEdges: Edge<DataflowEdgeData>[] = dataFlows.map((flow) => ({
        id: flow.id,
        source: String(flow.sourceTaskId),
        target: String(flow.targetTaskId),
        type: "dataflow",
        data: {
          dataflow: flow,
        },
      }));

      setNodes(newNodes);
      setEdges(newEdges);
      doNodeLayout(setNodes, setEdges);
    },
    [setNodes, setEdges]
  );

  const updateEdgeStatus = useCallback(
    (dataflow: Dataflow) => {
      setEdges((currentEdges) => {
        return currentEdges.map((edge) => {
          if (edge.id === dataflow.id) {
            return {
              ...edge,
              data: {
                dataflow,
              },
            };
          }
          return edge;
        });
      });
    },
    [setEdges]
  );

  useEffect(() => {
    if (graph && graph !== graphRef.current) {
      graphRef.current = graph;

      // Build initial nodes
      buildNodesFromTasks(graph);

      const unsubscribes: (() => void)[] = [];
      const statusEvents = ["start", "complete", "error", "disabled", "abort", "reset"] as const;

      // Handle task events
      const tasks = graph.getTasks();
      tasks.forEach((task) => {
        statusEvents.forEach((eventName) => {
          const unsub = task.subscribe(eventName, () => {
            updateNode(setNodes, task);
          });
          unsubscribes.push(unsub);
        });

        // Streaming status: update node when a task starts streaming
        const streamStartUnsub = task.subscribe("stream_start", () => updateNode(setNodes, task));
        unsubscribes.push(streamStartUnsub);

        // Progress events (just node update)
        const progressUnsub = task.subscribe("progress", () => updateNode(setNodes, task));
        unsubscribes.push(progressUnsub);

        // For compound tasks, handle regenerate events
        // if (task instanceof GraphAsTask || task instanceof ArrayTask) {
        //   const regenerateUnsub = task.subscribe("regenerate", () => buildNodesFromTasks(graph));
        //   unsubscribes.push(regenerateUnsub);
        // }
      });

      const dataflows = graph.getDataflows();
      const dataflowEvents = [...statusEvents, "streaming"] as const;
      dataflows.forEach((dataflow) => {
        dataflowEvents.forEach((eventName) => {
          const unsub = dataflow.subscribe(eventName, () => updateEdgeStatus(dataflow));
          unsubscribes.push(unsub);
        });
      });

      // Handle graph structure events
      const graphEvents: TaskGraphEvents[] = ["task_added", "dataflow_added"];
      graphEvents.forEach((eventName) => {
        const unsub = graph.subscribe(eventName, () => buildNodesFromTasks(graph));
        unsubscribes.push(unsub);
      });

      // Clean up subscriptions
      return () => unsubscribes.forEach((unsub) => unsub());
    }
  }, [graph, buildNodesFromTasks, setNodes, updateEdgeStatus]);

  useEffect(() => {
    if (nodes.length > 0) {
      setTimeout(() => fitView({ padding: 0.2 }), 100);
    }
  }, [nodes.length, fitView]);

  return (
    <div className="w-full h-full">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        defaultEdgeOptions={defaultEdgeOptions}
        fitView
      >
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
        <Controls />
      </ReactFlow>
    </div>
  );
};

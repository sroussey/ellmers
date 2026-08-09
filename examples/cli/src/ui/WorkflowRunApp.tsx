/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { formatUsage } from "@workglow/ai";
import type { TaskGraph, Usage } from "@workglow/task-graph";
import { Box, Text } from "ink";
import React, { useEffect, useState } from "react";
import { sortCliTaskLinesForDisplay, startGraphTaskPoll } from "./cliTaskUi";
import { useCliTheme } from "./CliThemeContext";
import { ProgressBar } from "./components/ProgressBar";
import { HumanInteractionHost } from "./HumanInteractionHost";
import { ChatTaskRow } from "./rows/ChatTaskRow";
import { DefaultTaskRow } from "./rows/DefaultTaskRow";
import { pickRenderer } from "./rows/pickRenderer";
import { StreamingTextRow } from "./rows/StreamingTextRow";
import type { CliTaskLine, IterationSlotRow } from "./taskGraphCliSubscriptions";
import { subscribeTaskGraphForCli } from "./taskGraphCliSubscriptions";

interface WorkflowRunAppProps {
  readonly graph: TaskGraph;
  readonly input: Record<string, unknown>;
  readonly config?: Record<string, unknown>;
  /**
   * When set (e.g. from {@link Workflow.run}), runs this instead of `graph.run(input, config)` so
   * abort/output-cache/merge semantics match the Workflow API.
   */
  readonly runExecutor?: () => Promise<unknown>;
  readonly onComplete: (result: unknown) => void;
  readonly onError: (error: Error) => void;
}

export function WorkflowRunApp({
  graph,
  input,
  config,
  runExecutor,
  onComplete,
  onError,
}: WorkflowRunAppProps): React.ReactElement {
  const theme = useCliTheme();
  const bodyColor = theme.level === "advanced" ? theme.fg : undefined;
  const [taskInfos, setTaskInfos] = useState<Map<string, CliTaskLine>>(new Map());
  const [overallProgress, setOverallProgress] = useState<number | undefined>(undefined);
  const [iterationSlots, setIterationSlots] = useState<Map<string, IterationSlotRow[]>>(new Map());
  const [runUsage, setRunUsage] = useState<Usage | undefined>(graph.runUsage);
  useEffect(() => {
    const unsub = subscribeTaskGraphForCli(
      graph,
      setTaskInfos,
      undefined,
      setOverallProgress,
      setIterationSlots
    );
    const onUsage = (total: Usage): void => setRunUsage(total);
    graph.subscribe("graph_usage", onUsage);

    const stopPoll = startGraphTaskPoll(graph, setTaskInfos);

    const runPromise = runExecutor ? runExecutor() : graph.run(input, config);
    runPromise.then((result) => onComplete(result)).catch((err) => onError(err));

    return () => {
      stopPoll();
      unsub();
      graph.off("graph_usage", onUsage);
    };
  }, [graph, onComplete, onError, runExecutor, input, config]);

  const order = new Map(graph.getTasks().map((t, i) => [String(t.id), i]));
  const orderedTasks = sortCliTaskLinesForDisplay(Array.from(taskInfos.values()), order);
  const runUsageLine = formatUsage(runUsage, "directional");

  return (
    <HumanInteractionHost>
      <Box flexDirection="column">
        <Box flexDirection="column">
          {overallProgress !== undefined && (
            <Box flexDirection="row" justifyContent="space-between" width="100%">
              <Text color={bodyColor}>Workflow: </Text>
              <Box flexShrink={0} marginLeft={1}>
                <ProgressBar progress={overallProgress} />
              </Box>
            </Box>
          )}
          {orderedTasks.map((t) => {
            const taskInstance = graph.getTasks().find((x) => String(x.id) === t.id);
            // Every id in orderedTasks comes from graph.getTasks(), so this
            // lookup should always succeed. Skip rendering if the invariant
            // ever breaks rather than masking it with a bogus cast.
            if (!taskInstance) return null;
            const Row = pickRenderer(t.type, taskInstance.outputSchema(), {
              ChatTaskRow,
              StreamingTextRow,
              DefaultTaskRow,
            });
            return (
              <Row
                key={t.id}
                task={taskInstance}
                line={t}
                iterationSlots={iterationSlots.get(t.id)}
              />
            );
          })}
          {runUsageLine ? <Text>{`Tokens ${runUsageLine}`}</Text> : null}
        </Box>
      </Box>
    </HumanInteractionHost>
  );
}

import type { ITask } from "@workglow/task-graph";
import { TaskStatus } from "@workglow/task-graph";
import { ViewportPortal } from "@xyflow/react";
import React, { useState } from "react";
import { DataDialog } from "./DataDialog";

interface TaskDataButtonsProps {
  task: ITask;
}

export const TaskDataButtons: React.FC<TaskDataButtonsProps> = ({ task }) => {
  const [showInputData, setShowInputData] = useState(false);
  const [showOutputData, setShowOutputData] = useState(false);

  const isPending = task.status === TaskStatus.PENDING;
  const buttonBaseClass = "text-xs rounded-sm px-2 py-0.5 transition-colors";
  const buttonEnabledClass = "bg-gray-800 hover:bg-gray-700";
  const buttonDisabledClass = "bg-gray-800 opacity-50 cursor-not-allowed";

  return (
    <>
      <div className="flex gap-2 mt-2">
        <button
          onClick={() => setShowInputData(true)}
          className={`${buttonBaseClass} ${buttonEnabledClass}`}
        >
          Input Data
        </button>
        <button
          onClick={() => setShowOutputData(true)}
          disabled={isPending}
          className={`${buttonBaseClass} ${isPending ? buttonDisabledClass : buttonEnabledClass}`}
        >
          Output Data
        </button>
      </div>

      {showInputData && (
        <ViewportPortal>
          <DataDialog
            isOpen={showInputData}
            onClose={() => setShowInputData(false)}
            title={`Input - ${task.type}`}
            data={task.runInputData}
          />
        </ViewportPortal>
      )}

      {showOutputData && (
        <ViewportPortal>
          <DataDialog
            isOpen={showOutputData}
            onClose={() => setShowOutputData(false)}
            title={`Output - ${task.type}`}
            data={task.runOutputData}
          />
        </ViewportPortal>
      )}
    </>
  );
};

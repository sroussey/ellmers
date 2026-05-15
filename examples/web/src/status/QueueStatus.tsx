/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { JobStatus } from "@workglow/job-queue";
import { getTaskQueueRegistry } from "@workglow/task-graph";
import { useCallback, useEffect, useState } from "react";

export function QueueStatus({ queueType }: { queueType: string }) {
  const registeredQueue = getTaskQueueRegistry().getQueue(queueType);
  const [pending, setPending] = useState<number>(0);
  const [processing, setProcessing] = useState<number>(0);
  const [completed, setCompleted] = useState<number>(0);
  const [errors, setErrors] = useState<number>(0);
  const [disabled, setDisabled] = useState<number>(0);

  useEffect(() => {
    if (!registeredQueue) return;

    const { client } = registeredQueue;

    async function listen() {
      setPending(await client.size(JobStatus.PENDING));
      setProcessing(await client.size(JobStatus.PROCESSING));
      setCompleted(await client.size(JobStatus.COMPLETED));
      setErrors(await client.size(JobStatus.FAILED));
      setDisabled(await client.size(JobStatus.DISABLED));
    }

    client.on("job_start", listen);
    client.on("job_complete", listen);
    client.on("job_error", listen);
    client.on("job_aborting", listen);
    client.on("job_disabled", listen);
    listen();

    return () => {
      client.off("job_start", listen);
      client.off("job_complete", listen);
      client.off("job_error", listen);
      client.off("job_aborting", listen);
      client.off("job_disabled", listen);
    };
  }, [registeredQueue]);

  const clear = useCallback(() => {
    if (!registeredQueue) return;
    registeredQueue.storage.deleteAll();
    setPending(0);
    setProcessing(0);
    setCompleted(0);
    setErrors(0);
    setDisabled(0);
  }, [registeredQueue]);

  if (!registeredQueue) {
    return <span>Queue {queueType} not found</span>;
  }

  return (
    <span>
      <span>
        {(() => {
          const name = registeredQueue.server.queueName;
          const idx = name.lastIndexOf("_");
          const prevIdx = idx > 0 ? name.lastIndexOf("_", idx - 1) : -1;
          return prevIdx !== -1 ? name.substring(prevIdx + 1) : name;
        })()}
      </span>
      : <span title="Errors">{errors}</span> / <span title="Disabled">{disabled}</span>
      <button className="float-right" onClick={clear}>
        Clear
      </button>
    </span>
  );
}

export function QueuesStatus() {
  const registry = getTaskQueueRegistry();
  const [queueKeys, setQueueKeys] = useState<string[]>(() => Array.from(registry.queues.keys()));

  useEffect(() => {
    const onRegistered = () => {
      setQueueKeys(Array.from(registry.queues.keys()));
    };
    registry.emitter.on("queue_registered", onRegistered);
    // Sync in case queues were registered between render and effect
    onRegistered();
    return () => {
      registry.emitter.off("queue_registered", onRegistered);
    };
  }, [registry]);

  return (
    <div>
      <h2>Queue Status</h2>

      {queueKeys.length === 0 ? (
        <div>No active queues (tasks using direct execution)</div>
      ) : (
        queueKeys.map((queueKey) => (
          <div key={queueKey}>
            <QueueStatus queueType={queueKey} />
          </div>
        ))
      )}
    </div>
  );
}

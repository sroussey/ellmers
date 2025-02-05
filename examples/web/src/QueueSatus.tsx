import { JobStatus } from "ellmers-core";
import { getAiProviderRegistry } from "ellmers-ai";
import { useCallback, useEffect, useState } from "react";

export function QueueStatus({ queueType }: { queueType: string }) {
  const queue = getAiProviderRegistry().getQueue(queueType);
  const [pending, setPending] = useState<number>(0);
  const [processing, setProcessing] = useState<number>(0);
  const [completed, setCompleted] = useState<number>(0);
  const [errors, setErrors] = useState<number>(0);

  useEffect(() => {
    async function listen() {
      setPending(await queue.size(JobStatus.PENDING));
      setProcessing(await queue.size(JobStatus.PROCESSING));
      setCompleted(await queue.size(JobStatus.COMPLETED));
      setErrors(await queue.size(JobStatus.FAILED));
    }

    queue.on("job_start", listen);
    queue.on("job_complete", listen);
    queue.on("job_error", listen);

    listen();

    return () => {
      queue.off("job_start", listen);
      queue.off("job_complete", listen);
      queue.off("job_error", listen);
    };
  }, []);

  const clear = useCallback(() => {
    queue.deleteAll();
    setPending(0);
    setProcessing(0);
    setCompleted(0);
    setErrors(0);
  }, [queue]);

  return (
    <span>
      <span>{queue.queue}</span>: <span title="Pending">{pending}</span> /{" "}
      <span title="Processing">{processing}</span> / <span title="Completed">{completed}</span> /{" "}
      <span title="Errors">{errors}</span>
      <button className="float-right" onClick={clear}>
        Clear
      </button>
    </span>
  );
}

export function QueuesStatus() {
  const queues = getAiProviderRegistry().queues;
  const queueKeys = Array.from(queues.keys());

  return (
    <div>
      <h2>Queue Status</h2>

      {queueKeys.map((queueKey, i) => (
        <div key={queueKey}>
          <QueueStatus queueType={queueKey} />
        </div>
      ))}
    </div>
  );
}

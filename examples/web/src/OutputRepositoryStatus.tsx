//    *******************************************************************************
//    *   ELLMERS: Embedding Large Language Model Experiential Retrieval Service    *
//    *                                                                             *
//    *   Copyright Steven Roussey <sroussey@gmail.com>                             *
//    *   Licensed under the Apache License, Version 2.0 (the "License");           *
//    *******************************************************************************

import { TaskOutputRepository } from "@ellmers/task-graph";
import { useCallback, useEffect, useState } from "react";

export function OutputRepositoryStatus({ repository }: { repository: TaskOutputRepository }) {
  const [size, setSize] = useState<number>(0);
  const clear = useCallback(() => {
    repository.clear();
    setSize(0);
  }, []);
  useEffect(() => {
    async function listen() {
      setSize(await repository.size());
    }

    repository.on("output_saved", listen);
    repository.on("output_cleared", listen);

    listen();

    return () => {
      repository.off("output_saved", listen);
      repository.off("output_cleared", listen);
    };
  }, []);

  return (
    <div>
      {repository.type}: {size}
      <button onClick={clear} className="float-right">
        Clear
      </button>
    </div>
  );
}

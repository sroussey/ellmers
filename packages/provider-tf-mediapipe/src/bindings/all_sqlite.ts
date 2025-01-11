// import { registerHuggingfaceLocalTasks } from "./local_hf";
// import { registerMediaPipeTfJsLocalTasks } from "./local_mp";
// import { getProviderRegistry } from "../provider/ProviderRegistry";
// import { ModelProcessorEnum } from "../model/Model";
// import { ConcurrencyLimiter } from "../job/ConcurrencyLimiter";
// import { SqliteJobQueue } from "../job/SqliteJobQueue";
// import { getDatabase } from "../util/db_sqlite";
// import { TaskInput, TaskOutput } from "../task/base/Task";
// import { mkdirSync } from "node:fs";

// mkdirSync("./.cache", { recursive: true });
// const db = getDatabase("./.cache/local.db");

// export async function registerHuggingfaceLocalTasksSqlite() {
//   registerHuggingfaceLocalTasks();
//   const ProviderRegistry = getProviderRegistry();
//   const jobQueue = new SqliteJobQueue<TaskInput, TaskOutput>(
//     db,
//     "local_hf",
//     new ConcurrencyLimiter(1, 10)
//   );
//   ProviderRegistry.registerQueue(ModelProcessorEnum.LOCAL_ONNX_TRANSFORMERJS, jobQueue);
//   jobQueue.start();
// }

// export async function registerMediaPipeTfJsLocalSqlite() {
//   registerMediaPipeTfJsLocalTasks();
//   const ProviderRegistry = getProviderRegistry();
//   const jobQueue = new SqliteJobQueue<TaskInput, TaskOutput>(
//     db,
//     "local_media_pipe",
//     new ConcurrencyLimiter(1, 10)
//   );
//   ProviderRegistry.registerQueue(ModelProcessorEnum.MEDIA_PIPE_TFJS_MODEL, jobQueue);
//   jobQueue.start();
// }

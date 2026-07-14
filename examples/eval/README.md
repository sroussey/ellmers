# Workglow Eval Example

A command-line harness for comparing AI models on Workglow task workflows, using
HuggingFace datasets as ground truth and Workglow storage for every artifact —
dataset rows, eval runs, and per-row results all live in a queryable SQLite
database.

## Overview

The [`@workglow/sec`](https://github.com/workglow-dev/sec) project ships an eval
harness specialized for SEC filing extraction. This example is the
general-purpose version of that idea:

1. **Pull** a dataset split from HuggingFace into tabular storage.
2. **Run** each stored row through a task workflow, once per candidate model.
3. **Score** the stored results and rank the models on quality and latency.

Because every step reads from and writes to `ITabularStorage`, runs are
inspectable and repeatable: re-score without re-running, diff two runs, or point
another tool at the same SQLite file.

## Getting Started

```bash
bun install
bun run build-example

# 1. Pull a dataset split into storage
./dist/workglow-eval.js dataset pull dair-ai/emotion --split test --limit 100
./dist/workglow-eval.js dataset list

# 2. Run an eval workflow across models (per-row workflow × models)
./dist/workglow-eval.js run-classify --dataset dair-ai/emotion --split test \
  --models "onnx-community/LFM2.5-350M-ONNX,claude-haiku-4-5,gpt-5.4-mini"

# 3. Re-score any stored run later
./dist/workglow-eval.js runs
./dist/workglow-eval.js report [run-id] --format json
```

Everything is stored under `~/.workglow/eval` (override with
`WORKGLOW_EVAL_HOME`). Re-pulling a split replaces it; pulling with `--offset`
extends the stored split, so large splits can be paged in incrementally.

## Eval workflows

### `run-classify` — label accuracy

Each row runs a one-task workflow: `StructuredGenerationTask` with an output
schema whose `label` property is an enum of the candidate labels. Any model
with text generation + JSON mode is comparable — local ONNX models and cloud
models compete on the same rows. Scored by accuracy (case/punctuation
insensitive).

Works out of the box with classification datasets such as `dair-ai/emotion` or
`SetFit/sst2`. Integer-coded label columns are mapped through the dataset's
`ClassLabel` names automatically; use `--labels "a,b,c"` when the dataset
doesn't declare them (integer gold labels are then mapped through that list,
in order).

### `run-similarity` — embedding quality

Each row runs a one-task workflow: `TextEmbeddingTask` embeds a sentence pair,
and the cosine similarity of the two vectors is the model's predicted score.
Scored by Pearson/Spearman correlation against the dataset's gold ratings
(correlation is scale-invariant, so 0–5 ratings work as-is).

Works out of the box with `mteb/stsbenchmark-sts`:

```bash
./dist/workglow-eval.js dataset pull mteb/stsbenchmark-sts --split test --limit 200
./dist/workglow-eval.js run-similarity --dataset mteb/stsbenchmark-sts --split test \
  --models "Xenova/all-MiniLM-L6-v2,text-embedding-3-small"
```

## Model ids

Model ids resolve to an inline `ModelConfig` by shape — no model repository
setup needed:

| Shape                                    | Provider                            |
| ---------------------------------------- | ----------------------------------- |
| `claude-*`                               | Anthropic (`ANTHROPIC_API_KEY`)     |
| `gpt-*`, `o<n>*`, `text-embedding-*`     | OpenAI (`OPENAI_API_KEY`)           |
| `gemini-*`                               | Google Gemini (`GEMINI_API_KEY`)    |
| `grok-*`                                 | xAI (`XAI_API_KEY`)                 |
| `org/name` (optionally `org/name:dtype`) | Local HuggingFace Transformers ONNX |

Local models download on first use into the eval home's cache and run in a
worker; no API key required. Embedding dimensions are read from the model's
`config.json` on the hub. Note that small instruct models vary widely in JSON
mode reliability — `onnx-community/LFM2.5-350M-ONNX` (the classify default)
follows the schema; e.g. SmolLM2-360M echoes the schema back instead of an
answer. A model that fails a row is recorded as a failed result (visible in the
report), never a crashed sweep.

## Dataset fetching

`dataset pull` prefers the HuggingFace datasets viewer API
(`datasets-server.huggingface.co/rows`), which provides typed features and
pagination. When that endpoint is unreachable it falls back to downloading the
repo's data files directly from the hub, parsing parquet (including the
`ClassLabel` names embedded in the parquet footer), `jsonl`, `jsonl.gz`,
`ndjson`, and `json`. Set `HF_TOKEN` for gated or private datasets.

## Storage layout

| Table              | Key                         | Contents                              |
| ------------------ | --------------------------- | ------------------------------------- |
| `eval_dataset`     | (dataset, split)            | columns, ClassLabel names, row count  |
| `eval_dataset_row` | (dataset, split, row_index) | raw row JSON                          |
| `eval_run`         | run_id (uuid)               | kind, dataset, models, column options |
| `eval_result`      | (run_id, model, row_index)  | expected/predicted, latency, ok/error |

The same schemas run on any `ITabularStorage` backend — the unit tests exercise
them with `InMemoryTabularStorage`, the CLI uses `SqliteTabularStorage`.

## Tests

```bash
bun run test          # unit tests (scorers, parsers, storage round-trip)
```

`src/test/liveSimilarity.e2e.test.ts` is a live end-to-end check (network +
model download) and is excluded from the default vitest run like the rest of
the repo's `.e2e.test.ts` files.

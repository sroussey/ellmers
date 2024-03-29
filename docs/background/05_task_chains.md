# Tasks and Task Graphs

## Requirements

- We need to have tasks, and some tasks will be chained together as a "strategy" or list of subtasks.
- We need to sometime run tasks in parallel and sometimes in series.
- Tasks can take a long time, so we need to be able to save the state of a task run and resume it later.
- We do NOT need to be able to run tasks in a distributed manner. v1.2 thing
- A task and a task graph (a compound task) should have a similar interface.
- We need progress events.
- Authentication and authorization will be supplied to the task by the task runner.
- convert the task graph to a listr2 task list
- be able to represent in a UI (graph, tree, whatever).
- Have an "editor" graph (coded by the user) and a "runner" graph (run by the system). Inputs might change the run graph.

## Questions

- How do we handle errors?
- How do we handle logging?
- Do we use an eventbus?
- If we use an eventbus, do we use a global one or a local one?

## Task

A task is a single step in the chain where most tasks output will be input for the next task.

Tasks get posted to a job queue and are run by a job queue runner.

## CompoundTask

A compound task is a groups of tasks (in DAG format) that are chained together to look like a single task.

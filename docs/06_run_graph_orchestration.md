# Run Graph Orchestration

## Introduction

We have Tasks (preprammed to do some action), Simple TaskList types (serial of parrallel fixed list of tasks), and Strategies (serial or parallel dynamic list of tasks based on input, but still fixed in kinds of sub tasks). These are all internal and must be defined in code.

When an end user want to build a pipeline, they need to be able to define a list of tasks to run. This is where Graphs come in. The directed acyclic graph (DAG) is more flexible than the trees you can create from TaskList or Strategy.

TaskList and Strategy use a simple graph themselves internally, and when a user strings them together, they attach their subgraphs to main pipeline run graph.

The pipline DAG is defined by the end user and saved in the database (nodes and edges).

## Graph

The graph is a DAG. It is a list of nodes and a list of edges. The nodes are the tasks and the edges are the inputs and outputs of the tasks plus some other instrumetation data.

### Node

- Task
- TaskList
- Strategy

### Edge

- Input
- Output
- Instrumentation
- Events

### Graph Runner

The graph runner is a simple recursive function that takes a graph and a node and runs the node. If the node is a task, it runs the task. If the node is a TaskList or Strategy, it runs the subgraph.

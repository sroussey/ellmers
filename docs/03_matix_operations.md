# Matrix of Operations

No, we are not talking about math. We have a matrix of ideas to test.

## Storage

We need to store the data somewhere. We need to be able to retrieve it quickly, and we need to be able to update it. We need to be able to store the data in a way that is compatible with the retrieval method.

For data:

- [ ] In Memory / Code
- [ ] Local file system
- [ ] SQL Databases
  - [ ] SQLite
  - [ ] PostgreSQL

## Embeddings

We need to create embeddings for the data.

### Models

- [ ] Use a pre-trained model
  - [ ] Local models
    - [ ] ONNX / Huggingface Transformers
    - [ ] MLC
    - [ ] GGUF / Llama.cpp
  - [ ] Online models
    - [ ] OpenAI
    - [ ] Mistral
    - [ ] Replicate
    - [ ] Huggingface
- [ ] Use a model trained on our data

### Instructions:

- [ ] Rewrite the data to make it more useful for retrieval
- [ ] Rewrite the questions to make them more useful for retrieval

## Retrieval

We need to retrieve the data quickly so we need to build and uses indexes:

- [ ] In Memory / Code
- [ ] SQLite VSS
- [ ] PostgreSQL pgvector
- [ ] usearch
- [ ] ElasticSearch
- [ ] Pinecone

The similarity choices can be:

- [ ] Inner Product
- [ ] Cosine Similarity
- [ ] Jaccard Similarity
- [ ] Hamming Distance
- [ ] Levenshtein Distance

## Ranking

We need combine and rank the results.

## Prompting

We need to prompt the LLM with the data in a smart manner. Different approaches may get different results for each LLM, and we need to be able to compare them.

## Testing

We need to test a matrix of choices:
(models) x (instructions) x (retreival similarities) x (rankings) x (promptings).

This can conservatively look like:
(10) x (10) x (5) x (10) x (10) = 50,000 tests.

It will not be difficult to get to a million tests. And that is independent of the data size. So we need to be able to run these tests quickly and cheaply and cache intermediate results.

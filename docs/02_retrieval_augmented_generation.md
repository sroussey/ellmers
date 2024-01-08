# Retrieval Augmented Generation (RAG)

## Introduction

There are many resources about RAG that I won't repeat here. [This one](https://towardsdatascience.com/add-your-own-data-to-an-llm-using-retrieval-augmented-generation-rag-b1958bf56a5a) by Towards Data Science is a good one.

The basic idea is that when a user asks an LLM a question, we first retrieve a set of documents that are relevant to the question. Then we append the data above the question in some fashion, then go use the LLM to generate an answer.

## Retrieval

Retrieving documents implies that they are stored somewhere, so we will need to work on that. Assuming a large corpus, it will need to indexed in some fashion. How to index is based on how to match the query to the documents.

1. The first way is to use an inverted text index (full text search index in MySQL, postgresql, etc). This maps words to documents, and will work well when exact matches are needed. This method has been around a while.

2. The second way is to use a vector index. Here, a word or paragraph or document gets mapped to a vector that embeds the semantic meaning of the text. We compare the query vector to the document vectors and return the closest matches.

3. The third way is to use a knowledge graph. Here, the documents are nodes in a graph, and the edges are the relationships between the documents. The query is a node in the graph, and we traverse the graph to find the closest matches.

Clearly there are a lot of practical details to work out. How do we create these semantic vectors call _embeddings_? Different models will create different and incompatible embeddings, so we need to see which ones work best for our data. And how do we massage the data and the quetions to get the best results? Do we _instruct_ an LLM to rewrite them before making the embeddings?

Retreival and storage can be separe but they might be combined, and what works best for using a cloud service might not be the best for a local app where privacy is imperative.

## Augmentation

We can't just append the documents to the question and expect the LLM to generate a good answer. We need to do some work to make the data more useful.

1. First of all, we need to make sure that the data is relevant to the question after retreival by ranking the results and tossing those that rank poorly.

## Generation

Then we need to _prompt_ the LLM with the data in a smart manner. Different approaches may get different results for each LLM, and we need to be able to compare them.

interface StorageService {
  getDocument(documentId: number): Document;
  getDocumentNode(documentId: number, nodeId: number): DocumentNode;
  getDocumentNodeEmbedding(
    documentId: number,
    nodeId: number,
    instructId: number,
    modelId: number
  ): DocumentNodeEmbedding;
  getModels(): Model[];
  getInstructs(): Instruct[];
}

enum InvokationEventType {
  START,
  STOP,
  EMBEDDING,
  FIRST_TOKEN,
  LAST_TOKEN,
  TOKENS,
  TOKENS_PER_SECOND,
}

interface InvokationEvent {
  type: InvokationEventType;
  instructId: number;
  modelId: number;
  token: string;
  tokens: string[];
  tokensPerSecond: number;
}

interface DocumentInvokationEvent extends InvokationEvent {
  documentId: number;
  nodeId: number;
}

interface PromptInvokationEvent extends InvokationEvent {
  prompt: string;
}

interface EmbeddingService {
  instructId: number;
  modelId: number;
  transform: (document: Document, node: DocumentNode) => DocumentNodeEmbedding;
}

// Configuration for Deno runtime
// env.useBrowserCache = false;
// env.allowLocalModels = false;

// const generateEmbedding = await pipeline(
//   "feature-extraction",
//   "Supabase/gte-small"
// );

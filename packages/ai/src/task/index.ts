/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { TaskRegistry } from "@workglow/task-graph";
import { AiChatTask } from "./AiChatTask";
import { BackgroundRemovalTask } from "./BackgroundRemovalTask";
import { ChunkRetrievalTask } from "./ChunkRetrievalTask";
import { ChunkVectorUpsertTask } from "./ChunkVectorUpsertTask";
import { ContextBuilderTask } from "./ContextBuilderTask";
import { CountTokensTask } from "./CountTokensTask";
import { DocumentEnricherTask } from "./DocumentEnricherTask";
import { DocumentUpsertTask } from "./DocumentUpsertTask";
import { DownloadModelTask } from "./DownloadModelTask";
import { ImageEditTask } from "./generation/ImageEditTask";
import { FaceDetectorTask } from "./FaceDetectorTask";
import { FaceLandmarkerTask } from "./FaceLandmarkerTask";
import { ImageGenerateTask } from "./generation/ImageGenerateTask";
import { GestureRecognizerTask } from "./GestureRecognizerTask";
import { HandLandmarkerTask } from "./HandLandmarkerTask";
import { HierarchicalChunkerTask } from "./HierarchicalChunkerTask";
import { HierarchyJoinTask } from "./HierarchyJoinTask";
import { KbToDocumentsTask } from "./KbToDocumentsTask";
import { ImageClassificationTask } from "./ImageClassificationTask";
import { ImageEmbeddingTask } from "./ImageEmbeddingTask";
import { ImageSegmentationTask } from "./ImageSegmentationTask";
import { ImageToTextTask } from "./ImageToTextTask";
import { ModelInfoTask } from "./ModelInfoTask";
import { ModelSearchTask } from "./ModelSearchTask";
import { ObjectDetectionTask } from "./ObjectDetectionTask";
import { PoseLandmarkerTask } from "./PoseLandmarkerTask";
import { QueryExpanderTask } from "./QueryExpanderTask";
import { RerankerTask } from "./RerankerTask";
import { StructuralParserTask } from "./StructuralParserTask";
import { StructuredGenerationTask } from "./StructuredGenerationTask";
import { TextChunkerTask } from "./TextChunkerTask";
import { TextClassificationTask } from "./TextClassificationTask";
import { TextEmbeddingTask } from "./TextEmbeddingTask";
import { TextFillMaskTask } from "./TextFillMaskTask";
import { TextGenerationTask } from "./TextGenerationTask";
import { TextLanguageDetectionTask } from "./TextLanguageDetectionTask";
import { TextNamedEntityRecognitionTask } from "./TextNamedEntityRecognitionTask";
import { TextQuestionAnswerTask } from "./TextQuestionAnswerTask";
import { TextRewriterTask } from "./TextRewriterTask";
import { TextSummaryTask } from "./TextSummaryTask";
import { TextTranslationTask } from "./TextTranslationTask";
import { ToolCallingTask } from "./ToolCallingTask";
import { TopicSegmenterTask } from "./TopicSegmenterTask";
import { UnloadModelTask } from "./UnloadModelTask";
import { VectorQuantizeTask } from "./VectorQuantizeTask";
import { VectorSimilarityTask } from "./VectorSimilarityTask";

// Register all AI tasks with the TaskRegistry.
// Centralized registration ensures tasks are available for JSON deserialization
// and prevents tree-shaking issues.
export const registerAiTasks = () => {
  const tasks = [
    AiChatTask,
    BackgroundRemovalTask,
    CountTokensTask,
    ContextBuilderTask,
    DocumentEnricherTask,
    DocumentUpsertTask,
    ChunkRetrievalTask,
    ChunkVectorUpsertTask,
    DownloadModelTask,
    ImageEditTask,
    FaceDetectorTask,
    FaceLandmarkerTask,
    ImageGenerateTask,
    GestureRecognizerTask,
    HandLandmarkerTask,
    HierarchicalChunkerTask,
    HierarchyJoinTask,
    KbToDocumentsTask,
    ImageClassificationTask,
    ImageEmbeddingTask,
    ImageSegmentationTask,
    ImageToTextTask,
    ModelInfoTask,
    ModelSearchTask,
    ObjectDetectionTask,
    PoseLandmarkerTask,
    QueryExpanderTask,
    RerankerTask,
    StructuralParserTask,
    StructuredGenerationTask,
    TextChunkerTask,
    TextClassificationTask,
    TextEmbeddingTask,
    TextFillMaskTask,
    TextGenerationTask,
    TextLanguageDetectionTask,
    TextNamedEntityRecognitionTask,
    TextQuestionAnswerTask,
    TextRewriterTask,
    TextSummaryTask,
    TextTranslationTask,
    ToolCallingTask,
    TopicSegmenterTask,
    UnloadModelTask,
    VectorQuantizeTask,
    VectorSimilarityTask,
  ];
  tasks.map(TaskRegistry.registerTask);
  return tasks;
};

export * from "./AiChatTask";
export * from "./ChatMessage";
export * from "./BackgroundRemovalTask";
export * from "./base/AiImageOutputTask";
export * from "./base/AiTask";
export * from "./base/AiTaskSchemas";
export * from "./base/StreamingAiTask";
export * from "./ChunkRetrievalTask";
export * from "./ChunkVectorUpsertTask";
export * from "./ContextBuilderTask";
export * from "./CountTokensTask";
export * from "./DocumentEnricherTask";
export * from "./DocumentUpsertTask";
export * from "./DownloadModelTask";
export * from "./generation/ImageEditTask";
export * from "./FaceDetectorTask";
export * from "./FaceLandmarkerTask";
export * from "./generation/ImageGenerateTask";
export * from "./GestureRecognizerTask";
export * from "./HandLandmarkerTask";
export * from "./HierarchicalChunkerTask";
export * from "./HierarchyJoinTask";
export * from "./KbToDocumentsTask";
export * from "./ImageClassificationTask";
export * from "./ImageEmbeddingTask";
export * from "./ImageSegmentationTask";
export * from "./ImageToTextTask";
export * from "./MessageConversion";
export * from "./ModelInfoTask";
export * from "./ModelSearchTask";
export * from "./ObjectDetectionTask";
export * from "./PoseLandmarkerTask";
export * from "./QueryExpanderTask";
export * from "./RerankerTask";
export * from "./StructuralParserTask";
export * from "./StructuredGenerationTask";
export * from "./TextChunkerTask";
export * from "./TextClassificationTask";
export * from "./TextEmbeddingTask";
export * from "./TextFillMaskTask";
export * from "./TextGenerationTask";
export * from "./TextLanguageDetectionTask";
export * from "./TextNamedEntityRecognitionTask";
export * from "./TextQuestionAnswerTask";
export * from "./TextRewriterTask";
export * from "./TextSummaryTask";
export * from "./TextTranslationTask";
export * from "./ToolCallingTask";
export * from "./ToolCallingUtils";
export * from "./TopicSegmenterTask";
export * from "./UnloadModelTask";
export * from "./VectorQuantizeTask";
export * from "./VectorSimilarityTask";

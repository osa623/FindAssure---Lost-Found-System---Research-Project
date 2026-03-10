import axios from 'axios';
import { Types } from 'mongoose';
import {
  FounderPrefillFeedback,
  IFounderPrefillFeedback,
} from '../models/FounderPrefillFeedback';
import * as imageProcessingService from './imageProcessingService';

const FOUNDER_PREFILL_TIMEOUT_MS = Number.parseInt(
  process.env.FOUNDER_PREFILL_FEEDBACK_TIMEOUT_MS || '4000',
  10
);

export type FounderPrefillFeedbackPayload = {
  foundItemId: string;
  createdBy?: string | null;
  preAnalysisToken: string;
  taskId?: string | null;
  analysisMode?: 'pp1' | 'pp2' | null;
  pythonItemId?: string | null;
  imageCount: number;
  imageUrls: string[];
  predictedCategory?: string | null;
  predictedDescription?: string | null;
  predictedColor?: string | null;
  analysisEvidence?: Record<string, unknown> | null;
  finalCategory: string;
  finalDescription: string;
  categoryChanged: boolean;
  descriptionChanged: boolean;
  acceptedAsIs: boolean;
};

export type FounderPrefillRelayResult = {
  status: string;
  stored: boolean;
  duplicate?: boolean;
  finalExtractedColor?: string | null;
  pipelineAnalyticsVersion?: string | null;
  changeMetrics?: Record<string, unknown> | null;
  comparisonEvidence?: Record<string, unknown> | null;
  multiviewVerification?: Record<string, unknown> | null;
};

const safeErrorMessage = (error: unknown): string => {
  if (axios.isAxiosError(error)) {
    if (error.response) {
      return `HTTP ${error.response.status}`;
    }
    return error.message;
  }

  if (error instanceof Error) {
    return error.message;
  }

  return 'Unknown relay error';
};

export const createFounderPrefillFeedback = async (
  payload: FounderPrefillFeedbackPayload
) => {
  return FounderPrefillFeedback.create({
    foundItemId: new Types.ObjectId(payload.foundItemId),
    ...(payload.createdBy ? { createdBy: new Types.ObjectId(payload.createdBy) } : {}),
    preAnalysisToken: payload.preAnalysisToken,
    taskId: payload.taskId ?? null,
    analysisMode: payload.analysisMode ?? null,
    pythonItemId: payload.pythonItemId ?? null,
    imageCount: payload.imageCount,
    imageUrls: payload.imageUrls,
    predictedCategory: payload.predictedCategory ?? null,
    predictedDescription: payload.predictedDescription ?? null,
    predictedColor: payload.predictedColor ?? null,
    analysisEvidence: payload.analysisEvidence ?? null,
    finalExtractedColor: null,
    finalCategory: payload.finalCategory,
    finalDescription: payload.finalDescription,
    categoryChanged: payload.categoryChanged,
    descriptionChanged: payload.descriptionChanged,
    acceptedAsIs: payload.acceptedAsIs,
    pipelineAnalyticsVersion: null,
    changeMetrics: null,
    comparisonEvidence: null,
    multiviewVerification: null,
    pipelineSyncStatus: 'pending',
    pipelineSyncAttempts: 0,
    pipelineSyncedAt: null,
    pipelineLastError: null,
  });
};

const summarizeRelayMetrics = (
  feedback: IFounderPrefillFeedback,
  relayResult: FounderPrefillRelayResult
) => {
  const changeMetrics = relayResult.changeMetrics || {};
  const multiviewVerification = relayResult.multiviewVerification || {};
  const overallChangePct =
    typeof changeMetrics.overallChangePct === 'number'
      ? Number(changeMetrics.overallChangePct.toFixed(1))
      : null;
  const changedDimensions = Array.isArray(changeMetrics.changedDimensions)
    ? changeMetrics.changedDimensions.join(',')
    : '';
  const usedViews = Array.isArray(multiviewVerification.usedViews)
    ? multiviewVerification.usedViews.join(',')
    : '';
  const droppedReasons = Array.isArray(multiviewVerification.droppedViews)
    ? multiviewVerification.droppedViews
        .map((entry: any) =>
          entry && typeof entry === 'object'
            ? `${entry.viewIndex ?? entry.view_index}:${entry.reason ?? 'dropped'}`
            : null
        )
        .filter(Boolean)
        .join(',')
    : '';
  const failureReasons = Array.isArray(multiviewVerification.failureReasons)
    ? multiviewVerification.failureReasons.slice(0, 3).join(' | ')
    : '';

  console.info(
    '[founder-prefill] relay success eventId=%s mode=%s overallChangePct=%s changedDimensions=%s multiviewPassed=%s usedViews=%s droppedViews=%s reasons=%s',
    feedback._id.toString(),
    feedback.analysisMode ?? 'unknown',
    overallChangePct ?? 'n/a',
    changedDimensions || 'none',
    typeof multiviewVerification.passed === 'boolean' ? String(multiviewVerification.passed) : 'n/a',
    usedViews || 'n/a',
    droppedReasons || 'n/a',
    failureReasons || 'n/a'
  );
};

export const relayFounderPrefillFeedbackEvent = async (
  feedbackId: string
): Promise<FounderPrefillRelayResult | null> => {
  const feedback = await FounderPrefillFeedback.findById(feedbackId);
  if (!feedback) {
    return null;
  }

  try {
    const payload = {
      eventId: feedback._id.toString(),
      foundItemId: feedback.foundItemId.toString(),
      createdBy: feedback.createdBy ? feedback.createdBy.toString() : null,
      preAnalysisToken: feedback.preAnalysisToken,
      taskId: feedback.taskId ?? null,
      analysisMode: feedback.analysisMode ?? null,
      pythonItemId: feedback.pythonItemId ?? null,
      imageCount: feedback.imageCount,
      imageUrls: feedback.imageUrls,
      predictedCategory: feedback.predictedCategory ?? null,
      predictedDescription: feedback.predictedDescription ?? null,
      predictedColor: feedback.predictedColor ?? null,
      analysisEvidence: feedback.analysisEvidence ?? null,
      finalCategory: feedback.finalCategory,
      finalDescription: feedback.finalDescription,
      categoryChanged: feedback.categoryChanged,
      descriptionChanged: feedback.descriptionChanged,
      acceptedAsIs: feedback.acceptedAsIs,
      createdAt: feedback.createdAt.toISOString(),
    };

    const relayPromise =
      imageProcessingService.sendFounderPrefillFeedback(payload) as Promise<FounderPrefillRelayResult>;
    const relayResult = await Promise.race([
      relayPromise,
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error('Founder prefill feedback relay timed out')), Number.isFinite(FOUNDER_PREFILL_TIMEOUT_MS) ? FOUNDER_PREFILL_TIMEOUT_MS : 4000)
      ),
    ]) as FounderPrefillRelayResult;

    await FounderPrefillFeedback.findByIdAndUpdate(feedback._id, {
      $set: {
        finalExtractedColor: relayResult.finalExtractedColor ?? null,
        pipelineAnalyticsVersion: relayResult.pipelineAnalyticsVersion ?? null,
        changeMetrics: relayResult.changeMetrics ?? null,
        comparisonEvidence: relayResult.comparisonEvidence ?? null,
        multiviewVerification: relayResult.multiviewVerification ?? null,
        pipelineSyncStatus: 'synced',
        pipelineSyncedAt: new Date(),
        pipelineLastError: null,
      },
      $inc: {
        pipelineSyncAttempts: 1,
      },
    });

    summarizeRelayMetrics(feedback, relayResult);
    return relayResult;
  } catch (error) {
    await FounderPrefillFeedback.findByIdAndUpdate(feedback._id, {
      $set: {
        pipelineSyncStatus: 'failed',
        pipelineLastError: safeErrorMessage(error),
      },
      $inc: {
        pipelineSyncAttempts: 1,
      },
    });

    console.error(
      'Founder prefill feedback relay failed (non-blocking):',
      safeErrorMessage(error)
    );
    return null;
  }
};

export const replayPendingFounderPrefillFeedback = async (limit = 20): Promise<number> => {
  const pending = await FounderPrefillFeedback.find({
    pipelineSyncStatus: { $in: ['pending', 'failed'] },
  })
    .sort({ createdAt: 1 })
    .limit(limit)
    .select('_id');

  for (const item of pending) {
    await relayFounderPrefillFeedbackEvent(item._id.toString());
  }

  return pending.length;
};

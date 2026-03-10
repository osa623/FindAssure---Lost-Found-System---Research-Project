import fs from 'fs/promises';
import { randomUUID } from 'crypto';
import { Request, Response, NextFunction } from 'express';
import { Types } from 'mongoose';
import { User } from '../models/User';
import { FoundItem } from '../models/FoundItem';
import { FoundItemPreAnalysis } from '../models/FoundItemPreAnalysis';
import * as founderPrefillFeedbackService from '../services/founderPrefillFeedbackService';
import * as itemService from '../services/itemService';
import * as verificationService from '../services/verificationService';
import * as geminiService from '../services/geminiService';
import * as pythonSearchService from '../services/pythonSearchService';
import * as locationMatchService from '../services/locationMatchService';
import * as imageProcessingService from '../services/imageProcessingService';
import { isCloudinaryConfigured, uploadToCloudinary } from '../utils/cloudinary';

const FOUND_ITEM_PLACEHOLDER = 'https://via.placeholder.com/400x400/CCCCCC/666666?text=No+Image';
const PRE_ANALYSIS_TTL_MS = 24 * 60 * 60 * 1000;

type FoundItemAnalysisSnapshot = {
  analysisMode: 'pp1' | 'pp2' | null;
  taskId: string | null;
  pythonItemId: string | null;
  faissId: number | null;
  faissIds: number[];
  detectedCategory: string | null;
  detectedDescription: string | null;
  detailedDescription: string | null;
  detectedColor: string | null;
  ocrText: string | null;
  ocrTextDisplay: string | null;
  categoryDetails: {
    features: string[];
    defects: string[];
    attachments: string[];
  };
  descriptionEvidenceUsed: {
    summary: string[];
    detailed: string[];
  };
  descriptionFiltersApplied: string[];
  vector128: number[];
  pipelineResponse: any;
  searchable: boolean;
};

type RunningPreAnalysisStatus = 'queued' | 'processing';
type TerminalPreAnalysisStatus = 'ok' | 'manual_fallback' | 'failed';
type PreAnalysisStatus = RunningPreAnalysisStatus | TerminalPreAnalysisStatus;

type PreAnalysisResponseBody = {
  status: PreAnalysisStatus;
  taskId?: string;
  preAnalysisToken: string | null;
  analysisMode: 'pp1' | 'pp2' | null;
  imageCount: number;
  analysisPathLabel: string;
  analysisSummary: string;
  retryAfterMs?: number;
  stageKey?: string | null;
  stageLabel?: string | null;
  stageMessage?: string | null;
  detectedCategory: string | null;
  detectedDescription: string | null;
  detailedDescription: string | null;
  detectedColor: string | null;
  ocrText: string | null;
  ocrTextDisplay: string | null;
  categoryDetails: {
    features: string[];
    defects: string[];
    attachments: string[];
  };
  descriptionEvidenceUsed: {
    summary: string[];
    detailed: string[];
  };
  descriptionFiltersApplied: string[];
  searchable: boolean;
  message: string;
};

const parseJsonField = <T>(value: unknown, fieldName: string): T => {
  if (typeof value === 'string') {
    return JSON.parse(value) as T;
  }

  if (value === undefined || value === null) {
    throw new Error(`Missing ${fieldName}`);
  }

  return value as T;
};

const cleanupTempFiles = async (files: Array<Express.Multer.File | undefined>) => {
  await Promise.all(
    files
      .filter((file): file is Express.Multer.File => Boolean(file?.path))
      .map(async (file) => {
        try {
          await fs.unlink(file.path);
        } catch {
          // Best-effort cleanup only.
        }
      })
  );
};

const uploadImageFile = async (
  file: Express.Multer.File,
  folder: string,
  fallbackText: string
): Promise<string> => {
  if (!isCloudinaryConfigured()) {
    return `https://via.placeholder.com/400x400/CCCCCC/666666?text=${encodeURIComponent(fallbackText)}`;
  }

  try {
    const buffer = await fs.readFile(file.path);
    const result = await uploadToCloudinary(buffer, folder);
    return result.secure_url;
  } catch (error) {
    console.error('Cloudinary upload failed, using placeholder fallback:', error);
    return `https://via.placeholder.com/400x400/CCCCCC/666666?text=${encodeURIComponent(fallbackText)}`;
  }
};

const selectAcceptedPP1Detection = (result: any) => {
  const detections = Array.isArray(result) ? result : [result];
  return (
    detections.find((item) =>
      item && ['accepted', 'accepted_degraded'].includes(item.status)
    ) || null
  );
};

const sanitizeFoundItemForOwner = (item: any) => itemService.sanitizeFoundItemForOwner(item);

const buildDefaultAnalysisSnapshot = (): FoundItemAnalysisSnapshot => ({
  analysisMode: null,
  taskId: null,
  pythonItemId: null,
  faissId: null,
  faissIds: [],
  detectedCategory: null,
  detectedDescription: null,
  detailedDescription: null,
  detectedColor: null,
  ocrText: null,
  ocrTextDisplay: null,
  categoryDetails: {
    features: [],
    defects: [],
    attachments: [],
  },
  descriptionEvidenceUsed: {
    summary: [],
    detailed: [],
  },
  descriptionFiltersApplied: [],
  vector128: [],
  pipelineResponse: null,
  searchable: false,
});

const normalizePreAnalysisToken = (value: unknown): string | null => {
  if (typeof value !== 'string') {
    return null;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
};

const normalizeFeedbackText = (value: unknown): string =>
  typeof value === 'string'
    ? value.trim().replace(/\s+/g, ' ').toLowerCase()
    : '';

const trimString = (value: unknown): string | null => {
  if (typeof value !== 'string') {
    return null;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
};

const normalizeStringArray = (value: unknown): string[] => {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((entry) => trimString(entry))
    .filter((entry): entry is string => Boolean(entry));
};

const normalizeCategoryDetails = (value: unknown): FoundItemAnalysisSnapshot['categoryDetails'] => {
  const fallback = {
    features: [],
    defects: [],
    attachments: [],
  };

  if (!value || typeof value !== 'object') {
    return fallback;
  }

  const source = value as Record<string, unknown>;
  return {
    features: normalizeStringArray(source.features),
    defects: normalizeStringArray(source.defects),
    attachments: normalizeStringArray(source.attachments),
  };
};

const normalizeDescriptionEvidenceUsed = (
  value: unknown
): FoundItemAnalysisSnapshot['descriptionEvidenceUsed'] => {
  const fallback = {
    summary: [],
    detailed: [],
  };

  if (!value || typeof value !== 'object') {
    return fallback;
  }

  const source = value as Record<string, unknown>;
  return {
    summary: normalizeStringArray(source.summary),
    detailed: normalizeStringArray(source.detailed),
  };
};

const pickBestText = (...values: unknown[]): string | null => {
  for (const value of values) {
    const trimmed = trimString(value);
    if (trimmed) {
      return trimmed;
    }
  }

  return null;
};

const buildAnalysisPrefillFields = (analysis: FoundItemAnalysisSnapshot) => ({
  detectedCategory: analysis.detectedCategory,
  detectedDescription: pickBestText(
    analysis.detailedDescription,
    analysis.detectedDescription
  ),
  detailedDescription: analysis.detailedDescription,
  detectedColor: analysis.detectedColor,
  ocrText: analysis.ocrText,
  ocrTextDisplay: analysis.ocrTextDisplay,
  categoryDetails: analysis.categoryDetails,
  descriptionEvidenceUsed: analysis.descriptionEvidenceUsed,
  descriptionFiltersApplied: analysis.descriptionFiltersApplied,
  searchable: analysis.searchable,
});

const extractPP1AnalysisDetails = (detection: any) => {
  const raw = detection?.raw && typeof detection.raw === 'object' ? detection.raw : {};

  return {
    detectedDescription: pickBestText(detection?.final_description, detection?.message),
    detailedDescription: pickBestText(
      detection?.detailed_description,
      detection?.final_description,
      detection?.message
    ),
    ocrText: pickBestText(detection?.ocr_text),
    ocrTextDisplay: pickBestText(detection?.ocr_text_display, detection?.ocr_text),
    categoryDetails: normalizeCategoryDetails(detection?.category_details),
    descriptionEvidenceUsed: normalizeDescriptionEvidenceUsed(detection?.description_evidence_used),
    descriptionFiltersApplied: normalizeStringArray(detection?.description_filters_applied),
    caption: pickBestText(detection?.caption, raw?.caption, raw?.caption_primary),
  };
};

const extractPP2AnalysisDetails = (pp2Result: any) => {
  const fused = pp2Result?.fused && typeof pp2Result.fused === 'object' ? pp2Result.fused : {};
  const attributes = fused?.attributes && typeof fused.attributes === 'object' ? fused.attributes : {};
  const mergedOcrTokens = normalizeStringArray(fused?.merged_ocr_tokens);
  const mergedOcrText = mergedOcrTokens.length > 0 ? mergedOcrTokens.join(' ') : null;
  const mergedOcrDisplay = mergedOcrTokens.length > 0 ? mergedOcrTokens.join('\n') : null;
  const preferredDescription = pickBestText(
    fused?.detailed_description,
    fused?.caption
  );

  return {
    detectedDescription: preferredDescription,
    detailedDescription: preferredDescription,
    ocrText: mergedOcrText,
    ocrTextDisplay: mergedOcrDisplay || mergedOcrText,
    categoryDetails: normalizeCategoryDetails({
      features: attributes.features,
      defects: fused?.defects,
      attachments: attributes.attachments,
    }),
    descriptionEvidenceUsed: normalizeDescriptionEvidenceUsed(fused?.description_evidence_used),
    descriptionFiltersApplied: normalizeStringArray(fused?.description_filters_applied),
  };
};

const buildFounderFeedbackAnalysisEvidence = (
  analysis: FoundItemAnalysisSnapshot
): Record<string, unknown> | null => {
  const response = analysis.pipelineResponse;
  if (!response) {
    return null;
  }

  if (analysis.analysisMode === 'pp2') {
    const verification = response?.verification;
    const fused = response?.fused;
    const perView = Array.isArray(response?.per_view)
      ? response.per_view.map((view: any) => ({
          view_index: typeof view?.view_index === 'number' ? view.view_index : null,
          status: trimString(view?.status),
          quality_score:
            typeof view?.quality_score === 'number' ? view.quality_score : null,
          detection: view?.detection
            ? {
                cls_name: trimString(view.detection.cls_name),
                confidence:
                  typeof view.detection.confidence === 'number'
                    ? view.detection.confidence
                    : null,
                selected_by: trimString(view.detection.selected_by),
                outlier_view:
                  typeof view.detection.outlier_view === 'boolean'
                    ? view.detection.outlier_view
                    : null,
              }
            : null,
          extraction: view?.extraction
            ? {
                caption: trimString(view.extraction.caption),
                ocr_text: trimString(view.extraction.ocr_text),
                grounded_features:
                  view.extraction.grounded_features &&
                  typeof view.extraction.grounded_features === 'object'
                    ? view.extraction.grounded_features
                    : {},
              }
            : null,
        }))
      : [];

    return {
      verification: verification
        ? {
            mode: trimString(verification.mode),
            passed:
              typeof verification.passed === 'boolean'
                ? verification.passed
                : null,
            failure_reasons: Array.isArray(verification.failure_reasons)
              ? verification.failure_reasons.map((reason: unknown) => String(reason))
              : [],
            used_views: Array.isArray(verification.used_views)
              ? verification.used_views.filter((value: unknown) => typeof value === 'number')
              : [],
            dropped_views: Array.isArray(verification.dropped_views)
              ? verification.dropped_views
                  .filter((entry: unknown) => entry && typeof entry === 'object')
                  .map((entry: any) => ({
                    view_index:
                      typeof entry.view_index === 'number' ? entry.view_index : null,
                    reason: trimString(entry.reason),
                  }))
              : [],
            cosine_sim_matrix: Array.isArray(verification.cosine_sim_matrix)
              ? verification.cosine_sim_matrix
              : [],
            faiss_sim_matrix: Array.isArray(verification.faiss_sim_matrix)
              ? verification.faiss_sim_matrix
              : [],
            geometric_scores:
              verification.geometric_scores &&
              typeof verification.geometric_scores === 'object'
                ? verification.geometric_scores
                : {},
          }
        : null,
      fused: fused
        ? {
            category: trimString(fused.category),
            color: trimString(fused.color),
            caption: trimString(fused.caption),
            detailed_description: trimString(fused.detailed_description),
            attributes:
              fused.attributes && typeof fused.attributes === 'object'
                ? fused.attributes
                : {},
            defects: Array.isArray(fused.defects) ? fused.defects : [],
            description_evidence_used:
              fused.description_evidence_used &&
              typeof fused.description_evidence_used === 'object'
                ? fused.description_evidence_used
                : {},
          }
        : null,
      per_view: perView,
    };
  }

  const accepted = selectAcceptedPP1Detection(response);
  if (!accepted) {
    return null;
  }

  return {
    pp1: {
      label: trimString(accepted.label),
      color: trimString(accepted.color),
      final_description: trimString(accepted.final_description),
      detailed_description: trimString(accepted.detailed_description),
      ocr_text: trimString(accepted.ocr_text),
      category_details:
        accepted.category_details && typeof accepted.category_details === 'object'
          ? accepted.category_details
          : {},
      raw:
        accepted.raw && typeof accepted.raw === 'object'
          ? accepted.raw
          : {},
    },
  };
};

const getAnalysisPathLabel = (imageCount: number): string =>
  imageCount > 1 ? 'Multi-view analysis' : 'Single photo analysis';

const buildPreAnalysisSummary = (status: TerminalPreAnalysisStatus, imageCount: number): string => {
  if (status === 'ok') {
    return imageCount > 1
      ? 'We prefilled what we could from your photo set. Review before continuing.'
      : 'We prefilled what we could from your photo. Review before continuing.';
  }

  if (status === 'failed') {
    return imageCount > 1
      ? 'We could not finish analyzing this photo set. Continue manually and confirm the details yourself.'
      : 'We could not finish analyzing this photo. Continue manually and confirm the details yourself.';
  }

  return imageCount > 1
    ? 'We could not confidently prefill this item from these photos. Continue manually.'
    : 'We could not confidently prefill this item from this photo. Continue manually.';
};

const buildPreAnalysisResponse = ({
  status,
  taskId,
  imageCount,
  preAnalysisToken = null,
  analysisMode = null,
  retryAfterMs,
  stageKey = null,
  stageLabel = null,
  stageMessage = null,
  detectedCategory = null,
  detectedDescription = null,
  detailedDescription = null,
  detectedColor = null,
  ocrText = null,
  ocrTextDisplay = null,
  categoryDetails = {
    features: [],
    defects: [],
    attachments: [],
  },
  descriptionEvidenceUsed = {
    summary: [],
    detailed: [],
  },
  descriptionFiltersApplied = [],
  searchable = false,
}: {
  status: PreAnalysisStatus;
  taskId?: string;
  imageCount: number;
  preAnalysisToken?: string | null;
  analysisMode?: 'pp1' | 'pp2' | null;
  retryAfterMs?: number;
  stageKey?: string | null;
  stageLabel?: string | null;
  stageMessage?: string | null;
  detectedCategory?: string | null;
  detectedDescription?: string | null;
  detailedDescription?: string | null;
  detectedColor?: string | null;
  ocrText?: string | null;
  ocrTextDisplay?: string | null;
  categoryDetails?: FoundItemAnalysisSnapshot['categoryDetails'];
  descriptionEvidenceUsed?: FoundItemAnalysisSnapshot['descriptionEvidenceUsed'];
  descriptionFiltersApplied?: string[];
  searchable?: boolean;
}): PreAnalysisResponseBody => {
  const terminalStatus =
    status === 'queued' || status === 'processing' ? 'manual_fallback' : status;
  const analysisSummary = buildPreAnalysisSummary(terminalStatus, imageCount);

  return {
    status,
    taskId,
    preAnalysisToken,
    analysisMode,
    imageCount,
    analysisPathLabel: getAnalysisPathLabel(imageCount),
    analysisSummary,
    retryAfterMs,
    stageKey,
    stageLabel,
    stageMessage,
    detectedCategory,
    detectedDescription,
    detailedDescription,
    detectedColor,
    ocrText,
    ocrTextDisplay,
    categoryDetails,
    descriptionEvidenceUsed,
    descriptionFiltersApplied,
    searchable,
    message: stageMessage || analysisSummary,
  };
};

const normalizeAsyncPreAnalysisStatus = (value: unknown): PreAnalysisStatus => {
  switch (value) {
    case 'queued':
    case 'processing':
    case 'manual_fallback':
    case 'failed':
      return value;
    case 'completed':
      return 'ok';
    default:
      return 'failed';
  }
};

const buildPP1AnalysisSnapshot = (pp1Result: any): FoundItemAnalysisSnapshot | null => {
  const detection = selectAcceptedPP1Detection(pp1Result);
  if (!detection) {
    return null;
  }

  const analysis = buildDefaultAnalysisSnapshot();
  analysis.analysisMode = 'pp1';
  analysis.pythonItemId = detection.item_id ?? null;
  analysis.detectedCategory = detection.label ?? null;
  analysis.detectedColor = detection.color ?? null;
  Object.assign(analysis, extractPP1AnalysisDetails(detection));
  analysis.vector128 = Array.isArray(detection.embeddings?.vector_128d)
    ? detection.embeddings.vector_128d
    : [];
  analysis.pipelineResponse = pp1Result;

  return analysis;
};

const buildPP2AnalysisSnapshot = (pp2Result: any): FoundItemAnalysisSnapshot | null => {
  if (!(pp2Result?.verification?.passed === true && pp2Result?.fused)) {
    return null;
  }

  const analysis = buildDefaultAnalysisSnapshot();
  analysis.analysisMode = 'pp2';
  analysis.pythonItemId = pp2Result?.item_id ?? null;
  analysis.detectedCategory = pp2Result.fused.category ?? null;
  analysis.detectedColor = pp2Result.fused.color ?? null;
  Object.assign(analysis, extractPP2AnalysisDetails(pp2Result));
  analysis.faissIds = Array.isArray(pp2Result.faiss_ids)
    ? pp2Result.faiss_ids.filter((id: unknown) => typeof id === 'number')
    : [];
  analysis.faissId = analysis.faissIds[0] ?? null;
  analysis.pipelineResponse = pp2Result;
  analysis.searchable = pp2Result.stored === true;

  return analysis;
};

const storeFoundItemPreAnalysis = async (
  imageCount: number,
  analysis: FoundItemAnalysisSnapshot,
  createdBy?: string,
  taskId?: string | null
): Promise<string | null> => {
  try {
    const token = randomUUID();

    await FoundItemPreAnalysis.create({
      token,
      ...(taskId ? { taskId } : {}),
      ...(createdBy ? { createdBy: new Types.ObjectId(createdBy) } : {}),
      imageCount,
      analysisMode: analysis.analysisMode,
      pythonItemId: analysis.pythonItemId,
      faissId: analysis.faissId,
      faissIds: analysis.faissIds,
      detectedCategory: analysis.detectedCategory,
      detectedDescription: analysis.detectedDescription,
      detailedDescription: analysis.detailedDescription,
      detectedColor: analysis.detectedColor,
      ocrText: analysis.ocrText,
      ocrTextDisplay: analysis.ocrTextDisplay,
      categoryDetails: analysis.categoryDetails,
      descriptionEvidenceUsed: analysis.descriptionEvidenceUsed,
      descriptionFiltersApplied: analysis.descriptionFiltersApplied,
      vector128: analysis.vector128,
      pipelineResponse: analysis.pipelineResponse,
      searchable: analysis.searchable,
      expiresAt: new Date(Date.now() + PRE_ANALYSIS_TTL_MS),
    });

    return token;
  } catch (error) {
    console.error('Failed to persist found-item pre-analysis cache:', error);
    return null;
  }
};

const loadFoundItemPreAnalysisByTaskId = async (
  taskId: string
): Promise<{ token: string; analysis: FoundItemAnalysisSnapshot } | null> => {
  const entry = await FoundItemPreAnalysis.findOne({
    taskId,
    expiresAt: { $gt: new Date() },
  }).lean();

  if (!entry) {
    return null;
  }

  return {
    token: entry.token,
    analysis: {
      analysisMode: entry.analysisMode ?? null,
      taskId: entry.taskId ?? null,
      pythonItemId: entry.pythonItemId ?? null,
      faissId: typeof entry.faissId === 'number' ? entry.faissId : null,
      faissIds: Array.isArray(entry.faissIds)
        ? entry.faissIds.filter((id: unknown) => typeof id === 'number')
        : [],
      detectedCategory: entry.detectedCategory ?? null,
      detectedDescription: entry.detectedDescription ?? null,
      detailedDescription: entry.detailedDescription ?? null,
      detectedColor: entry.detectedColor ?? null,
      ocrText: entry.ocrText ?? null,
      ocrTextDisplay: entry.ocrTextDisplay ?? null,
      categoryDetails: normalizeCategoryDetails(entry.categoryDetails),
      descriptionEvidenceUsed: normalizeDescriptionEvidenceUsed(entry.descriptionEvidenceUsed),
      descriptionFiltersApplied: normalizeStringArray(entry.descriptionFiltersApplied),
      vector128: Array.isArray(entry.vector128)
        ? entry.vector128.filter((value: unknown) => typeof value === 'number')
        : [],
      pipelineResponse: entry.pipelineResponse ?? null,
      searchable: entry.searchable === true,
    },
  };
};

const loadFoundItemPreAnalysis = async (
  token: string
): Promise<FoundItemAnalysisSnapshot | null> => {
  const entry = await FoundItemPreAnalysis.findOne({
    token,
    expiresAt: { $gt: new Date() },
  }).lean();

  if (!entry) {
    return null;
  }

  return {
    analysisMode: entry.analysisMode ?? null,
    taskId: entry.taskId ?? null,
    pythonItemId: entry.pythonItemId ?? null,
    faissId: typeof entry.faissId === 'number' ? entry.faissId : null,
    faissIds: Array.isArray(entry.faissIds)
      ? entry.faissIds.filter((id: unknown) => typeof id === 'number')
      : [],
    detectedCategory: entry.detectedCategory ?? null,
    detectedDescription: entry.detectedDescription ?? null,
    detailedDescription: entry.detailedDescription ?? null,
    detectedColor: entry.detectedColor ?? null,
    ocrText: entry.ocrText ?? null,
    ocrTextDisplay: entry.ocrTextDisplay ?? null,
    categoryDetails: normalizeCategoryDetails(entry.categoryDetails),
    descriptionEvidenceUsed: normalizeDescriptionEvidenceUsed(entry.descriptionEvidenceUsed),
    descriptionFiltersApplied: normalizeStringArray(entry.descriptionFiltersApplied),
    vector128: Array.isArray(entry.vector128)
      ? entry.vector128.filter((value: unknown) => typeof value === 'number')
      : [],
    pipelineResponse: entry.pipelineResponse ?? null,
    searchable: entry.searchable === true,
  };
};

/**
 * Pre-analyze founder images
 * POST /api/items/pre-analyze-found-images
 */
export const preAnalyzeFoundImages = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  const imageFiles = (req.files as Express.Multer.File[]) || [];

  console.log('[PRE-ANALYZE] Received files:', imageFiles.map((f) => ({
    originalname: f.originalname,
    mimetype: f.mimetype,
    size: f.size,
    path: f.path,
  })));

  try {
    if (imageFiles.length < 1 || imageFiles.length > 3) {
      res.status(400).json({ message: 'You must upload between 1 and 3 images' });
      return;
    }

    const tempImagePaths = imageFiles.map((file) => file.path);

    if (tempImagePaths.length === 1) {
      try {
        const pp1Result = await imageProcessingService.analyzePP1(tempImagePaths[0]);
        const detection = selectAcceptedPP1Detection(pp1Result);

        if (detection) {
          const analysis = buildPP1AnalysisSnapshot(pp1Result);

          if (!analysis) {
            const pp1FallbackBody = buildPreAnalysisResponse({
              status: 'manual_fallback',
              imageCount: tempImagePaths.length,
              analysisMode: 'pp1',
            });
            console.log('[PRE-ANALYZE] Response (PP1 no detection):', JSON.stringify(pp1FallbackBody, null, 2));
            res.status(200).json(pp1FallbackBody);
            return;
          }

          if (analysis.pythonItemId && analysis.vector128.length === 128) {
            try {
              const indexResult = await imageProcessingService.indexVector(analysis.vector128, {
                item_id: analysis.pythonItemId,
                source: 'pp1_preanalysis',
                label: analysis.detectedCategory,
                category: analysis.detectedCategory,
              });

              analysis.faissId = typeof indexResult?.faiss_id === 'number' ? indexResult.faiss_id : null;
              analysis.faissIds = analysis.faissId !== null ? [analysis.faissId] : [];
              analysis.searchable = analysis.faissId !== null;
            } catch (indexError: any) {
              console.error(
                'PP1 pre-analysis vector indexing failed (non-fatal):',
                indexError?.message || indexError
              );
            }
          }

          const preAnalysisToken = await storeFoundItemPreAnalysis(
            tempImagePaths.length,
            analysis,
            req.user?.id
          );

          const pp1OkBody = buildPreAnalysisResponse({
            status: 'ok',
            imageCount: tempImagePaths.length,
            preAnalysisToken,
            analysisMode: analysis.analysisMode,
            ...buildAnalysisPrefillFields(analysis),
          });
          console.log('[PRE-ANALYZE] Response (PP1 ok):', JSON.stringify(pp1OkBody, null, 2));
          res.status(200).json(pp1OkBody);
          return;
        }

        const pp1FallbackBody = buildPreAnalysisResponse({
          status: 'manual_fallback',
          imageCount: tempImagePaths.length,
          analysisMode: 'pp1',
        });
        console.log('[PRE-ANALYZE] Response (PP1 no detection):', JSON.stringify(pp1FallbackBody, null, 2));
        res.status(200).json(pp1FallbackBody);
        return;
      } catch (pipelineError: any) {
        const pp1ErrorBody = buildPreAnalysisResponse({
          status: 'manual_fallback',
          imageCount: tempImagePaths.length,
          analysisMode: 'pp1',
        });
        console.log('[PRE-ANALYZE] Response (PP1 pipeline error):', JSON.stringify(pp1ErrorBody, null, 2));
        res.status(200).json(pp1ErrorBody);
        return;
      }
    }

    try {
      const pp2Result = await imageProcessingService.analyzePP2(tempImagePaths);

      if (pp2Result?.verification?.passed === true && pp2Result?.fused) {
        const analysis = buildPP2AnalysisSnapshot(pp2Result);

        if (!analysis) {
          const pp2FallbackBody = buildPreAnalysisResponse({
            status: 'manual_fallback',
            imageCount: tempImagePaths.length,
            analysisMode: 'pp2',
          });
          console.log('[PRE-ANALYZE] Response (PP2 verification failed):', JSON.stringify(pp2FallbackBody, null, 2));
          res.status(200).json(pp2FallbackBody);
          return;
        }

        const preAnalysisToken = await storeFoundItemPreAnalysis(
          tempImagePaths.length,
          analysis,
          req.user?.id
        );

        const pp2OkBody = buildPreAnalysisResponse({
          status: 'ok',
          imageCount: tempImagePaths.length,
          preAnalysisToken,
          analysisMode: analysis.analysisMode,
          ...buildAnalysisPrefillFields(analysis),
        });
        console.log('[PRE-ANALYZE] Response (PP2 ok):', JSON.stringify(pp2OkBody, null, 2));
        res.status(200).json(pp2OkBody);
        return;
      }

      const pp2FallbackBody = buildPreAnalysisResponse({
        status: 'manual_fallback',
        imageCount: tempImagePaths.length,
        analysisMode: 'pp2',
      });
      console.log('[PRE-ANALYZE] Response (PP2 verification failed):', JSON.stringify(pp2FallbackBody, null, 2));
      res.status(200).json(pp2FallbackBody);
    } catch (pipelineError: any) {
      const pp2ErrorBody = buildPreAnalysisResponse({
        status: 'manual_fallback',
        imageCount: tempImagePaths.length,
        analysisMode: 'pp2',
      });
      console.log('[PRE-ANALYZE] Response (PP2 pipeline error):', JSON.stringify(pp2ErrorBody, null, 2));
      res.status(200).json(pp2ErrorBody);
    }
  } catch (error) {
    next(error);
  } finally {
    await cleanupTempFiles(imageFiles);
  }
};

/**
 * Start async founder image pre-analysis
 * POST /api/items/pre-analyze-found-images/start
 */
export const startPreAnalyzeFoundImages = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  const imageFiles = (req.files as Express.Multer.File[]) || [];

  try {
    if (imageFiles.length < 1 || imageFiles.length > 3) {
      res.status(400).json({ message: 'You must upload between 1 and 3 images' });
      return;
    }

    const tempImagePaths = imageFiles.map((file) => file.path);
    const imageCount = tempImagePaths.length;
    const pipelineStart =
      imageCount === 1
        ? await imageProcessingService.startPP1Analyze(tempImagePaths[0])
        : await imageProcessingService.startPP2Analyze(tempImagePaths);

    const status = normalizeAsyncPreAnalysisStatus(pipelineStart?.status);
    const responseBody = buildPreAnalysisResponse({
      status,
      taskId: typeof pipelineStart?.taskId === 'string' ? pipelineStart.taskId : undefined,
      imageCount: typeof pipelineStart?.imageCount === 'number' ? pipelineStart.imageCount : imageCount,
      analysisMode: pipelineStart?.analysisMode === 'pp2' ? 'pp2' : imageCount > 1 ? 'pp2' : 'pp1',
      retryAfterMs:
        typeof pipelineStart?.retryAfterMs === 'number' ? pipelineStart.retryAfterMs : 1000,
      stageKey: typeof pipelineStart?.stageKey === 'string' ? pipelineStart.stageKey : null,
      stageLabel: typeof pipelineStart?.stageLabel === 'string' ? pipelineStart.stageLabel : null,
      stageMessage: typeof pipelineStart?.stageMessage === 'string' ? pipelineStart.stageMessage : null,
    });

    res.status(202).json(responseBody);
  } catch (error) {
    next(error);
  } finally {
    await cleanupTempFiles(imageFiles);
  }
};

/**
 * Get async founder image pre-analysis status
 * GET /api/items/pre-analyze-found-images/status/:taskId
 */
export const getPreAnalyzeFoundImagesStatus = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const { taskId } = req.params;

    if (!taskId) {
      res.status(400).json({ message: 'taskId is required' });
      return;
    }

    const pipelineStatus = await imageProcessingService.getPreAnalysisJobStatus(taskId);
    const imageCount =
      typeof pipelineStatus?.imageCount === 'number' && pipelineStatus.imageCount >= 1
        ? pipelineStatus.imageCount
        : 1;
    const analysisMode: 'pp1' | 'pp2' | null =
      pipelineStatus?.analysisMode === 'pp2' ? 'pp2' : pipelineStatus?.analysisMode === 'pp1' ? 'pp1' : imageCount > 1 ? 'pp2' : 'pp1';
    const normalizedStatus = normalizeAsyncPreAnalysisStatus(pipelineStatus?.status);

    if (normalizedStatus === 'queued' || normalizedStatus === 'processing') {
      res.status(200).json(
        buildPreAnalysisResponse({
          status: normalizedStatus,
          taskId,
          imageCount,
          analysisMode,
          retryAfterMs:
            typeof pipelineStatus?.retryAfterMs === 'number' ? pipelineStatus.retryAfterMs : 1000,
          stageKey: typeof pipelineStatus?.stageKey === 'string' ? pipelineStatus.stageKey : null,
          stageLabel: typeof pipelineStatus?.stageLabel === 'string' ? pipelineStatus.stageLabel : null,
          stageMessage:
            typeof pipelineStatus?.stageMessage === 'string' ? pipelineStatus.stageMessage : null,
        })
      );
      return;
    }

    if (normalizedStatus === 'ok') {
      const cached = await loadFoundItemPreAnalysisByTaskId(taskId);
      if (cached) {
        res.status(200).json(
          buildPreAnalysisResponse({
            status: 'ok',
            taskId,
            imageCount,
            preAnalysisToken: cached.token,
            analysisMode: cached.analysis.analysisMode,
            retryAfterMs:
              typeof pipelineStatus?.retryAfterMs === 'number' ? pipelineStatus.retryAfterMs : 1000,
            ...buildAnalysisPrefillFields(cached.analysis),
          })
        );
        return;
      }

      const rawResult = pipelineStatus?.result;
      const analysis =
        analysisMode === 'pp2'
          ? buildPP2AnalysisSnapshot(rawResult)
          : buildPP1AnalysisSnapshot(rawResult);

      if (!analysis) {
        res.status(200).json(
          buildPreAnalysisResponse({
            status: 'manual_fallback',
            taskId,
            imageCount,
            analysisMode,
            retryAfterMs:
              typeof pipelineStatus?.retryAfterMs === 'number' ? pipelineStatus.retryAfterMs : 1000,
          })
        );
        return;
      }

      if (analysis.analysisMode === 'pp1' && analysis.pythonItemId && analysis.vector128.length === 128) {
        try {
          const indexResult = await imageProcessingService.indexVector(analysis.vector128, {
            item_id: analysis.pythonItemId,
            source: 'pp1_preanalysis',
            label: analysis.detectedCategory,
            category: analysis.detectedCategory,
          });

          analysis.faissId = typeof indexResult?.faiss_id === 'number' ? indexResult.faiss_id : null;
          analysis.faissIds = analysis.faissId !== null ? [analysis.faissId] : [];
          analysis.searchable = analysis.faissId !== null;
        } catch (indexError: any) {
          console.error(
            'PP1 async pre-analysis vector indexing failed (non-fatal):',
            indexError?.message || indexError
          );
        }
      }

      const preAnalysisToken = await storeFoundItemPreAnalysis(
        imageCount,
        analysis,
        req.user?.id,
        taskId
      );

      res.status(200).json(
        buildPreAnalysisResponse({
          status: 'ok',
          taskId,
          imageCount,
          preAnalysisToken,
          analysisMode: analysis.analysisMode,
          retryAfterMs:
            typeof pipelineStatus?.retryAfterMs === 'number' ? pipelineStatus.retryAfterMs : 1000,
          ...buildAnalysisPrefillFields(analysis),
        })
      );
      return;
    }

    if (normalizedStatus === 'manual_fallback') {
      res.status(200).json(
        buildPreAnalysisResponse({
          status: 'manual_fallback',
          taskId,
          imageCount,
          analysisMode,
          retryAfterMs:
            typeof pipelineStatus?.retryAfterMs === 'number' ? pipelineStatus.retryAfterMs : 1000,
        })
      );
      return;
    }

    res.status(200).json(
      buildPreAnalysisResponse({
        status: 'failed',
        taskId,
        imageCount,
        analysisMode,
        retryAfterMs:
          typeof pipelineStatus?.retryAfterMs === 'number' ? pipelineStatus.retryAfterMs : 1000,
      })
    );
  } catch (error) {
    next(error);
  }
};

/**
 * Create a found item
 * POST /api/items/found
 */
export const createFoundItem = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  const imageFiles = (req.files as Express.Multer.File[]) || [];

  try {
    const { category, description } = req.body;
    const preAnalysisToken = normalizePreAnalysisToken(req.body.preAnalysisToken);

    let questions: string[];
    let questionMetadata: any[] = [];
    let founderAnswers: string[];
    let foundLocation: any[];
    let founderContact: any;

    try {
      questions = parseJsonField<string[]>(req.body.questions, 'questions');
      questionMetadata = parseJsonField<any[]>(req.body.questionMetadata || '[]', 'questionMetadata');
      founderAnswers = parseJsonField<string[]>(req.body.founderAnswers, 'founderAnswers');
      foundLocation = parseJsonField<any[]>(req.body.found_location, 'found_location');
      founderContact = parseJsonField<any>(req.body.founderContact, 'founderContact');
    } catch (parseError: any) {
      res.status(400).json({
        message: parseError?.message || 'Invalid multipart payload',
      });
      return;
    }

    if (!category || !description || !questions || !founderAnswers || !foundLocation || !founderContact) {
      res.status(400).json({
        message: 'Required fields: category, description, questions, founderAnswers, found_location, founderContact',
      });
      return;
    }

    if (imageFiles.length < 1 || imageFiles.length > 3) {
      res.status(400).json({ message: 'You must upload between 1 and 3 images' });
      return;
    }

    if (questions.length === 0) {
      res.status(400).json({ message: 'At least one question is required' });
      return;
    }

    if (questions.length !== founderAnswers.length) {
      res.status(400).json({ message: 'Number of answers must match number of questions' });
      return;
    }

    if (questionMetadata.length > 0 && questionMetadata.length !== questions.length) {
      res.status(400).json({ message: 'Question metadata count must match number of questions' });
      return;
    }

    const foundItemId = new Types.ObjectId();
    const analysisSnapshot = buildDefaultAnalysisSnapshot();

    if (preAnalysisToken) {
      const cachedAnalysis = await loadFoundItemPreAnalysis(preAnalysisToken);

      if (cachedAnalysis) {
        analysisSnapshot.analysisMode = cachedAnalysis.analysisMode;
        analysisSnapshot.pythonItemId = cachedAnalysis.pythonItemId;
        analysisSnapshot.faissId = cachedAnalysis.faissId;
        analysisSnapshot.faissIds = cachedAnalysis.faissIds;
        analysisSnapshot.detectedCategory = cachedAnalysis.detectedCategory;
        analysisSnapshot.detectedDescription = cachedAnalysis.detectedDescription;
        analysisSnapshot.detailedDescription = cachedAnalysis.detailedDescription;
        analysisSnapshot.detectedColor = cachedAnalysis.detectedColor;
        analysisSnapshot.ocrText = cachedAnalysis.ocrText;
        analysisSnapshot.ocrTextDisplay = cachedAnalysis.ocrTextDisplay;
        analysisSnapshot.categoryDetails = cachedAnalysis.categoryDetails;
        analysisSnapshot.descriptionEvidenceUsed = cachedAnalysis.descriptionEvidenceUsed;
        analysisSnapshot.descriptionFiltersApplied = cachedAnalysis.descriptionFiltersApplied;
        analysisSnapshot.vector128 = cachedAnalysis.vector128;
        analysisSnapshot.pipelineResponse = cachedAnalysis.pipelineResponse;
        analysisSnapshot.searchable = cachedAnalysis.searchable;
      } else {
        console.warn(`Pre-analysis token missing or expired; saving found item without analysis: ${preAnalysisToken}`);
      }
    }

    const uploadedImageUrls = await Promise.all(
      imageFiles.map((file, index) =>
        uploadImageFile(file, 'findassure/found-items', file.originalname || `found-item-${index + 1}`)
      )
    );

    const foundItem = await itemService.createFoundItem({
      _id: foundItemId,
      imageUrl: uploadedImageUrls[0] || FOUND_ITEM_PLACEHOLDER,
      category,
      description,
      questions,
      questionMetadata,
      founderAnswers,
      found_location: foundLocation,
      founderContact,
      createdBy: req.user?.id,
      analysisMode: analysisSnapshot.analysisMode,
      pythonItemId: analysisSnapshot.pythonItemId,
      faissId: analysisSnapshot.faissId,
      faissIds: analysisSnapshot.faissIds,
      detectedCategory: analysisSnapshot.detectedCategory,
      detectedDescription: analysisSnapshot.detectedDescription,
      detectedColor: analysisSnapshot.detectedColor,
      vector128: analysisSnapshot.vector128,
      pipelineResponse: analysisSnapshot.pipelineResponse,
      searchable: analysisSnapshot.searchable,
    });

    if (preAnalysisToken && analysisSnapshot.analysisMode) {
      const normalizedPredictedCategory = normalizeFeedbackText(analysisSnapshot.detectedCategory);
      const normalizedFinalCategory = normalizeFeedbackText(category);
      const normalizedPredictedDescription = normalizeFeedbackText(analysisSnapshot.detectedDescription);
      const normalizedFinalDescription = normalizeFeedbackText(description);
      const analysisEvidence = buildFounderFeedbackAnalysisEvidence(analysisSnapshot);

      const categoryChanged = normalizedPredictedCategory.length > 0
        ? normalizedPredictedCategory !== normalizedFinalCategory
        : false;
      const descriptionChanged = normalizedPredictedDescription.length > 0
        ? normalizedPredictedDescription !== normalizedFinalDescription
        : false;

      try {
        const feedbackEvent = await founderPrefillFeedbackService.createFounderPrefillFeedback({
          foundItemId: foundItem._id.toString(),
          createdBy: req.user?.id || null,
          preAnalysisToken,
          taskId: analysisSnapshot.taskId,
          analysisMode: analysisSnapshot.analysisMode,
          pythonItemId: analysisSnapshot.pythonItemId,
          imageCount: imageFiles.length,
          imageUrls: uploadedImageUrls,
          predictedCategory: analysisSnapshot.detectedCategory,
          predictedDescription: analysisSnapshot.detectedDescription,
          predictedColor: analysisSnapshot.detectedColor,
          analysisEvidence,
          finalCategory: category,
          finalDescription: description,
          categoryChanged,
          descriptionChanged,
          acceptedAsIs: !categoryChanged && !descriptionChanged,
        });

        void founderPrefillFeedbackService.relayFounderPrefillFeedbackEvent(
          feedbackEvent._id.toString()
        );
      } catch (feedbackError) {
        console.error(
          'Founder prefill feedback logging failed (non-blocking):',
          feedbackError instanceof Error ? feedbackError.message : feedbackError
        );
      }
    }

    res.status(201).json(foundItem);
  } catch (error) {
    next(error);
  } finally {
    await cleanupTempFiles(imageFiles);
  }
};

/**
 * List found items
 * GET /api/items/found
 */
export const listFoundItems = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const { category, status } = req.query;

    const filters: itemService.FoundItemFilters = {};
    if (category) filters.category = category as string;

    if (status) {
      filters.status = status as any;
    }

    const items = await itemService.listFoundItems(filters);
    const filteredItems = status ? items : items.filter((item) => item.status !== 'claimed');
    const itemsForOwner = filteredItems.map((item) => sanitizeFoundItemForOwner(item));

    res.status(200).json(itemsForOwner);
  } catch (error) {
    next(error);
  }
};

/**
 * Get single found item
 * GET /api/items/found/:id
 */
export const getFoundItemById = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const { id } = req.params;
    const isAdmin = req.user?.role === 'admin';

    const item = isAdmin
      ? await itemService.getFoundItemForAdmin(id)
      : await itemService.getFoundItemForOwner(id);

    if (!item) {
      res.status(404).json({ message: 'Found item not found' });
      return;
    }

    res.status(200).json(item);
  } catch (error) {
    next(error);
  }
};

/**
 * Create a lost request
 * POST /api/items/lost
 */
export const createLostRequest = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  const ownerImage = req.file;

  try {
    if (!req.user) {
      res.status(401).json({ message: 'Authentication required' });
      return;
    }

    const { category, description, owner_location, floor_id, hall_name } = req.body;
    const owner_location_confidence_stage = Number(req.body.owner_location_confidence_stage);

    if (!category || !description || !owner_location || Number.isNaN(owner_location_confidence_stage)) {
      res.status(400).json({
        message: 'Category, description, owner_location, and confidence stage are required',
      });
      return;
    }

    if (owner_location_confidence_stage < 1 || owner_location_confidence_stage > 4) {
      res.status(400).json({ message: 'Confidence stage must be 1, 2, 3, or 4' });
      return;
    }

    const [lostRequestResult, pythonSearchResult] = await Promise.allSettled([
      itemService.createLostRequest(req.user.id, {
        category,
        description,
        owner_location,
        floor_id,
        hall_name,
        owner_location_confidence_stage,
      }),
      pythonSearchService.searchLostItemWithPython({
        text: description,
        category,
        limit: 10,
        session_id: req.user.id,
      }),
    ]);

    if (lostRequestResult.status === 'rejected') {
      throw lostRequestResult.reason;
    }

    let lostRequest = lostRequestResult.value;
    let aiSearch: {
      status: 'ok' | 'failed';
      total_matches: number;
      matchedFoundItemIds: string[];
      location_match?: boolean;
      matched_locations?: string[];
      query_id?: string;
      impression_id?: string;
      detail?: string;
    };

    if (pythonSearchResult.status === 'fulfilled') {
      const aiMatchedItems = await itemService.resolveAiMatchesToFoundItems(
        pythonSearchResult.value.matches || []
      );

      const categaryData: locationMatchService.CategoryDataItem[] = aiMatchedItems.map((item) => ({
        id: item.foundItemId,
        description_scrore: item.score,
        found_location: (item.found_location || []).map((loc) => ({
          location: loc.location,
          floor_id: loc.floor_id ?? null,
          hall_name: loc.hall_name ?? null,
        })),
      }));

      let finalMatchedFoundItemIds: string[] = aiMatchedItems.map((item) => item.foundItemId);
      let locationMatchResponse: locationMatchService.FindItemsResponse | null = null;

      if (categaryData.length > 0) {
        try {
          locationMatchResponse = await locationMatchService.findItemsByLocation({
            owner_id: req.user.id,
            categary_name: category,
            categary_data: categaryData,
            description_match_cofidence: 90,
            owner_location,
            floor_id: floor_id ?? null,
            hall_name: hall_name ?? null,
            owner_location_confidence_stage,
          });

          const matchedIdsFromLocation = (locationMatchResponse.matched_item_ids || []).map((id) =>
            String(id)
          );

          if (matchedIdsFromLocation.length > 0) {
            const matchedIdSet = new Set(matchedIdsFromLocation);
            finalMatchedFoundItemIds = finalMatchedFoundItemIds.filter((id) => matchedIdSet.has(id));
          } else {
            finalMatchedFoundItemIds = [];
          }
        } catch (locationErr: any) {
          console.error('Location match step failed:', locationErr?.message || locationErr);
          finalMatchedFoundItemIds = [];
        }
      } else {
        finalMatchedFoundItemIds = [];
      }

      let imageMatchMap: Map<string, number> | null = null;
      let ownerImageUrl: string | null | undefined;

      if (ownerImage) {
        try {
          const imageSearchResult = await imageProcessingService.searchByImage(
            ownerImage.path,
            50,
            0.5,
            category
          );
          const rawImageMatches = Array.isArray(imageSearchResult?.matches)
            ? imageSearchResult.matches.map((match: any) => ({
                item_id: match?.item_id ?? null,
                score: typeof match?.score === 'number' ? Number(match.score) : null,
                vector_hits_count: match?.vector_hits_count ?? null,
              }))
            : [];

          console.log(
            '[IMAGE-MATCH] Raw pipeline matches:',
            JSON.stringify(
              {
                ownerId: req.user.id,
                category,
                matches: rawImageMatches,
              },
              null,
              2
            )
          );

          imageMatchMap = new Map();
          for (const match of imageSearchResult?.matches || []) {
            if (match?.item_id !== undefined && match?.score !== undefined) {
              imageMatchMap.set(String(match.item_id), Number(match.score));
            }
          }

          console.log(
            '[IMAGE-MATCH] Derived image score map:',
            JSON.stringify(Object.fromEntries(imageMatchMap.entries()), null, 2)
          );
        } catch (imageSearchError: any) {
          console.error('Image search failed (non-fatal):', imageSearchError?.message || imageSearchError);
        }

        ownerImageUrl = await uploadImageFile(
          ownerImage,
          'findassure/search-queries',
          ownerImage.originalname || 'owner-search'
        );
      }

      const matchedItems = finalMatchedFoundItemIds.length > 0
        ? await FoundItem.find({ _id: { $in: finalMatchedFoundItemIds } }).lean()
        : [];
      const matchedItemMap = new Map(
        matchedItems.map((item) => [String(item._id), item])
      );

      const results = finalMatchedFoundItemIds
        .map((id) => matchedItemMap.get(id))
        .filter((item): item is NonNullable<typeof item> => Boolean(item))
        .map((item) => {
          const imageScore =
            imageMatchMap && item.pythonItemId
              ? imageMatchMap.get(item.pythonItemId) ?? null
              : null;

          return {
            ...sanitizeFoundItemForOwner(item),
            imageMatch: imageScore !== null ? { score: imageScore } : null,
          };
        });

      console.log(
        '[IMAGE-MATCH] Final matched items returned to app:',
        JSON.stringify(
          results.map((item: any) => ({
            foundItemId: String(item._id),
            category: item.category,
            imageMatchScore: item.imageMatch?.score ?? null,
          })),
          null,
          2
        )
      );

      const imageMatchResults = results
        .filter((item) => item.imageMatch)
        .map((item) => ({
          foundItemId: String(item._id),
          score: item.imageMatch!.score,
        }));

      const updatedLostRequest = await itemService.updateLostRequestSearchResults(
        String(lostRequest._id),
        {
          matchedFoundItemIds: finalMatchedFoundItemIds,
          ownerImageUrl,
          imageMatchResults,
        }
      );
      if (updatedLostRequest) {
        lostRequest = updatedLostRequest;
      }

      aiSearch = {
        status: 'ok',
        total_matches: pythonSearchResult.value.total_matches || 0,
        matchedFoundItemIds: finalMatchedFoundItemIds,
        location_match: Boolean(locationMatchResponse?.location_match),
        matched_locations: locationMatchResponse?.matched_locations || [],
        query_id: pythonSearchResult.value.query_id,
        impression_id: pythonSearchResult.value.impression_id,
      };

      res.status(201).json({
        ...lostRequest.toObject(),
        aiSearch,
        results,
      });
      return;
    }

    aiSearch = {
      status: 'failed',
      total_matches: 0,
      matchedFoundItemIds: [],
      detail:
        pythonSearchResult.reason instanceof Error
          ? pythonSearchResult.reason.message
          : 'Python search failed',
    };

    const updatedLostRequest = await itemService.updateLostRequestSearchResults(
      String(lostRequest._id),
      {
        matchedFoundItemIds: [],
        imageMatchResults: [],
      }
    );
    if (updatedLostRequest) {
      lostRequest = updatedLostRequest;
    }

    res.status(201).json({
      ...lostRequest.toObject(),
      aiSearch,
      results: [],
    });
  } catch (error) {
    next(error);
  } finally {
    await cleanupTempFiles(ownerImage ? [ownerImage] : []);
  }
};

/**
 * Get my lost requests
 * GET /api/items/lost/me
 */
export const getMyLostRequests = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    if (!req.user) {
      res.status(401).json({ message: 'Authentication required' });
      return;
    }

    const requests = await itemService.getLostRequestsByOwner(req.user.id);

    res.status(200).json(requests);
  } catch (error) {
    next(error);
  }
};

/**
 * Create verification
 * POST /api/items/verification
 */
export const createVerification = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    if (!req.user) {
      res.status(401).json({ message: 'Authentication required' });
      return;
    }

    const dataField = req.body.data;

    if (!dataField) {
      res.status(400).json({ message: 'Missing data field in request' });
      return;
    }

    let parsedData;
    try {
      parsedData = typeof dataField === 'string' ? JSON.parse(dataField) : dataField;
    } catch (error) {
      res.status(400).json({ message: 'Invalid JSON in data field' });
      return;
    }

    const { foundItemId, ownerAnswers } = parsedData;

    if (!foundItemId || !ownerAnswers) {
      res.status(400).json({ message: 'foundItemId and ownerAnswers are required' });
      return;
    }

    const files = req.files as Express.Multer.File[];
    const videoFiles = new Map<string, any>();

    if (files && files.length > 0) {
      for (const file of files) {
        videoFiles.set(file.fieldname, {
          buffer: file.buffer,
          originalname: file.originalname,
          mimetype: file.mimetype,
        });
      }
    }

    const verification = await verificationService.createVerification({
      foundItemId,
      ownerId: req.user.id,
      ownerAnswers,
      videoFiles,
    });

    res.status(201).json(verification);
  } catch (error) {
    next(error);
  }
};

/**
 * Request manual ownership review
 * POST /api/items/verification/manual-review
 */
export const requestManualVerificationReview = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    if (!req.user) {
      res.status(401).json({ message: 'Authentication required' });
      return;
    }

    const foundItemId = trimString(req.body?.foundItemId);
    const reason = trimString(req.body?.reason);

    if (!foundItemId || !reason) {
      res.status(400).json({ message: 'foundItemId and reason are required' });
      return;
    }

    if (reason.length < 10) {
      res.status(400).json({ message: 'Please provide a slightly more detailed reason' });
      return;
    }

    await verificationService.requestManualVerificationReview(foundItemId, req.user.id, reason);

    res.status(200).json({
      message: 'Manual review request sent to admin successfully',
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Get verification by ID
 * GET /api/items/verification/:id
 */
export const getVerificationById = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    if (!req.user) {
      res.status(401).json({ message: 'Authentication required' });
      return;
    }

    const { id } = req.params;
    const isAdmin = req.user.role === 'admin';

    const verification = await verificationService.getVerificationById(id, isAdmin);

    if (!verification) {
      res.status(404).json({ message: 'Verification not found' });
      return;
    }

    res.status(200).json(verification);
  } catch (error) {
    next(error);
  }
};

/**
 * Get my verifications
 * GET /api/items/verification/me
 */
export const getMyVerifications = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    if (!req.user) {
      res.status(401).json({ message: 'Authentication required' });
      return;
    }

    const verifications = await verificationService.getVerificationsByOwner(req.user.id);

    res.status(200).json(verifications);
  } catch (error) {
    next(error);
  }
};

/**
 * Generate verification questions using AI
 * POST /api/items/generate-questions
 */
export const generateQuestions = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const { category, description } = req.body;

    if (!category || !description) {
      res.status(400).json({ message: 'Category and description are required' });
      return;
    }

    const questions = await geminiService.generateVerificationQuestions({
      category,
      description,
    });
    const questionMetadata = geminiService.deriveQuestionMetadata(questions);

    const suggestedFounderAnswers = await geminiService.generateSuggestedFounderAnswers({
      category,
      description,
      questions,
    });

    res.status(200).json({ questions, questionMetadata, suggestedFounderAnswers });
  } catch (error) {
    next(error);
  }
};

/**
 * Get multiple found items by IDs (batch)
 * POST /api/items/found/batch
 */
export const getFoundItemsByIds = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const { itemIds } = req.body;

    if (!itemIds || !Array.isArray(itemIds) || itemIds.length === 0) {
      res.status(400).json({ message: 'itemIds array is required' });
      return;
    }

    if (itemIds.length > 50) {
      res.status(400).json({ message: 'Maximum 50 items can be fetched at once' });
      return;
    }

    const items = await itemService.getFoundItemsByIds(itemIds);

    res.status(200).json(items.map((item) => sanitizeFoundItemForOwner(item)));
  } catch (error) {
    next(error);
  }
};

/**
 * Get all users (public endpoint for suggestion system)
 * GET /api/items/users
 */
export const getAllUsersPublic = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const users = await User.find()
      .select('name email role createdAt firebaseUid')
      .sort({ createdAt: -1 });
    res.status(200).json(users);
  } catch (error) {
    next(error);
  }
};

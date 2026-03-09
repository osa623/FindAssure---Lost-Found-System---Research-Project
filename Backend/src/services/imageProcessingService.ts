import axios, { AxiosInstance } from 'axios';
import fs from 'fs';
import FormData from 'form-data';

const PIPELINE_URL = process.env.IMAGE_PIPELINE_URL || 'http://127.0.0.1:8002';
const DEFAULT_TIMEOUT_MS = 300_000;

const parseTimeoutMs = (value: string | undefined): number => {
  const parsed = Number.parseInt(value || '', 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_TIMEOUT_MS;
};

const TIMEOUT_MS = parseTimeoutMs(process.env.IMAGE_PIPELINE_TIMEOUT_MS);

const client: AxiosInstance = axios.create({
  baseURL: PIPELINE_URL,
  timeout: TIMEOUT_MS,
});

const logPipelineError = (operation: string, error: unknown): void => {
  if (axios.isAxiosError(error)) {
    if (error.code === 'ECONNABORTED') {
      console.error(
        `[image-pipeline] ${operation} timed out after ${TIMEOUT_MS}ms while waiting for ${PIPELINE_URL}`
      );
      return;
    }

    if (error.response) {
      console.error(
        `[image-pipeline] ${operation} failed with status ${error.response.status}`,
        error.response.data
      );
      return;
    }

    if (error.request) {
      console.error(
        `[image-pipeline] ${operation} failed without a response`,
        { code: error.code, message: error.message }
      );
      return;
    }

    console.error(
      `[image-pipeline] ${operation} request setup failed`,
      { code: error.code, message: error.message }
    );
    return;
  }

  console.error(`[image-pipeline] ${operation} failed unexpectedly`, error);
};

const withPipelineLogging = async <T>(
  operation: string,
  request: () => Promise<T>
): Promise<T> => {
  try {
    return await request();
  } catch (error) {
    logPipelineError(operation, error);
    throw error;
  }
};

export async function analyzePP1(imagePath: string) {
  const form = new FormData();
  form.append('files', fs.createReadStream(imagePath));

  const { data } = await withPipelineLogging('PP1 analyze', () => client.post('/pp1/analyze', form, {
    headers: form.getHeaders(),
  }));

  return data;
}

export async function startPP1Analyze(imagePath: string) {
  const form = new FormData();
  form.append('files', fs.createReadStream(imagePath));

  const { data } = await withPipelineLogging('PP1 async analyze start', () =>
    client.post('/pp1/analyze_async', form, {
      headers: form.getHeaders(),
    })
  );

  return data;
}

export async function analyzePP2(imagePaths: string[]) {
  const form = new FormData();

  for (const imagePath of imagePaths) {
    form.append('files', fs.createReadStream(imagePath));
  }

  const { data } = await withPipelineLogging('PP2 multi-view analyze', () => client.post('/pp2/analyze_multiview', form, {
    headers: form.getHeaders(),
  }));

  return data;
}

export async function startPP2Analyze(imagePaths: string[]) {
  const form = new FormData();

  for (const imagePath of imagePaths) {
    form.append('files', fs.createReadStream(imagePath));
  }

  const { data } = await withPipelineLogging('PP2 async multi-view analyze start', () =>
    client.post('/pp2/analyze_multiview_async', form, {
      headers: form.getHeaders(),
    })
  );

  return data;
}

export async function getPreAnalysisJobStatus(taskId: string) {
  const { data } = await withPipelineLogging('pre-analysis job status', () =>
    client.get(`/jobs/pre-analysis/${encodeURIComponent(taskId)}`)
  );

  return data;
}

export async function indexVector(
  vector128d: number[],
  metadata: Record<string, unknown>
) {
  const { data } = await withPipelineLogging(
    'FAISS index_vector',
    () => client.post('/search/index_vector', {
      vector_128d: vector128d,
      metadata,
    })
  );

  return data;
}

export async function searchByImage(
  imagePath: string,
  topK: number = 20,
  minScore: number = 0.5,
  category?: string
) {
  const form = new FormData();
  form.append('file', fs.createReadStream(imagePath));
  form.append('top_k', String(topK));
  form.append('min_score', String(minScore));

  if (category) {
    form.append('category', category);
  }

  const { data } = await withPipelineLogging('search by image', () => client.post('/search/by-image', form, {
    headers: form.getHeaders(),
  }));

  return data;
}

export const imagePipelineConfig = {
  baseUrl: PIPELINE_URL,
  timeoutMs: TIMEOUT_MS,
} as const;

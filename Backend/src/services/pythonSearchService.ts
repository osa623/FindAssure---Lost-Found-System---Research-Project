import axios from 'axios';

const PYTHON_SEMANTIC_BACKEND_URL =
  process.env.PYTHON_SEMANTIC_BACKEND_URL ||
  process.env.PYTHON_BACKEND_URL ||
  'http://127.0.0.1:8001';

export interface PythonSearchRequest {
  text: string;
  category?: string;
  limit?: number;
  session_id?: string;
}

export interface PythonSearchMatch {
  id: string;
  description: string;
  category: string;
  score: number;
  reason: string;
}

export interface PythonSearchResponse {
  matches: PythonSearchMatch[];
  total_matches: number;
  inferred_context?: string[];
  query_id?: string;
  impression_id?: string;
  grammar_corrected?: boolean;
  corrected_text?: string | null;
}

export const searchLostItemWithPython = async (
  payload: PythonSearchRequest
): Promise<PythonSearchResponse> => {
  try {
    const response = await axios.post<PythonSearchResponse>(
      `${PYTHON_SEMANTIC_BACKEND_URL}/search`,
      payload,
      {
        headers: {
          'Content-Type': 'application/json',
        },
        timeout: 20000,
      }
    );

    return response.data;
  } catch (error: any) {
    if (error.response) {
      throw new Error(
        `Python search failed: ${error.response.data?.detail || error.response.statusText}`
      );
    }
    if (error.request) {
      throw new Error(
        'Python search service is not responding. Please ensure the semantic Python backend is running.'
      );
    }
    throw new Error(`Python search request failed: ${error.message}`);
  }
};

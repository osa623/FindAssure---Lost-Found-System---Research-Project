import axios from 'axios';
import { BASE_URL, API_CONFIG, HEALTH_CHECK_URL } from '../config/api.config';

const isFormDataPayload = (value: unknown): value is FormData =>
  typeof FormData !== 'undefined' && value instanceof FormData;

const clearContentTypeHeader = (headers: any) => {
  if (!headers) {
    return;
  }

  if (typeof headers.delete === 'function') {
    headers.delete('Content-Type');
    return;
  }

  delete headers['Content-Type'];
  delete headers['content-type'];
};

const setJsonContentTypeHeader = (headers: any) => {
  if (!headers) {
    return;
  }

  if (typeof headers.set === 'function') {
    headers.set('Content-Type', 'application/json');
    return;
  }

  headers['Content-Type'] = 'application/json';
};

const buildRequestUrl = (config?: {
  baseURL?: string;
  url?: string;
}): string | undefined => {
  if (!config?.url) {
    return config?.baseURL;
  }

  if (/^https?:\/\//i.test(config.url)) {
    return config.url;
  }

  return `${config.baseURL || ''}${config.url}`;
};

const axiosClient = axios.create({
  baseURL: BASE_URL,
  headers: {
    'Accept': 'application/json',
  },
  timeout: API_CONFIG.REQUEST_TIMEOUT,
});

type RetryableRequestConfig = {
  _retry?: boolean;
  headers?: any;
};

// Request interceptor to attach auth token
axiosClient.interceptors.request.use(
  (config) => {
    // Token will be set by AuthContext when user logs in
    // Access token from AsyncStorage or global state
    const token = (global as any).authToken;
    if (token) {
      config.headers.Authorization = `Bearer ${token}`;
    }

    if (isFormDataPayload(config.data)) {
      clearContentTypeHeader(config.headers);
    } else if (config.data !== undefined && config.data !== null) {
      setJsonContentTypeHeader(config.headers);
    }

    console.log('HTTP request', {
      method: config.method?.toUpperCase() || 'GET',
      url: buildRequestUrl(config),
      backendHost: API_CONFIG.BACKEND_HOST,
    });

    return config;
  },
  (error) => {
    return Promise.reject(error);
  }
);

// Response interceptor for error handling
axiosClient.interceptors.response.use(
  (response) => response,
  async (error) => {
    const requestUrl = buildRequestUrl(error.config);

    if (error.response) {
      console.error('HTTP response error', {
        method: error.config?.method?.toUpperCase() || 'GET',
        url: requestUrl,
        backendHost: API_CONFIG.BACKEND_HOST,
        status: error.response.status,
        data: error.response.data,
      });
    } else {
      console.error('HTTP network error', {
        method: error.config?.method?.toUpperCase() || 'GET',
        url: requestUrl,
        backendHost: API_CONFIG.BACKEND_HOST,
        healthCheckUrl: HEALTH_CHECK_URL,
        code: error.code,
        message: error.message,
      });
    }

    if (error.response?.status === 401) {
      const originalConfig = (error.config || {}) as RetryableRequestConfig;
      const firebaseUser = (global as any).firebaseUser;

      if (!originalConfig._retry && firebaseUser?.getIdToken) {
        originalConfig._retry = true;
        try {
          const refreshedToken = await firebaseUser.getIdToken(true);
          (global as any).authToken = refreshedToken;
          axiosClient.defaults.headers.common['Authorization'] = `Bearer ${refreshedToken}`;
          if (!originalConfig.headers) {
            originalConfig.headers = {};
          }
          originalConfig.headers.Authorization = `Bearer ${refreshedToken}`;
          console.log('401 recovered by refreshing Firebase token and retrying request');
          return axiosClient(originalConfig as any);
        } catch (refreshError) {
          console.log('Token refresh on 401 failed; user may need to sign in again');
        }
      }

      // Handle unauthorized when retry path is not available or failed
      console.log('Unauthorized - token expired or invalid');
    }
    return Promise.reject(error);
  }
);

export default axiosClient;

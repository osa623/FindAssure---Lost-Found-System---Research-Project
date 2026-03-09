import Constants from 'expo-constants';
import { Platform } from 'react-native';

const DEFAULT_DEVICE_BACKEND_HOST = '172.28.7.70';
const DEFAULT_SIMULATOR_BACKEND_HOST = Platform.OS === 'android' ? '10.0.2.2' : '127.0.0.1';

const trimEnvValue = (value: string | undefined): string | null => {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
};

const configuredBackendHost = trimEnvValue(process.env.EXPO_PUBLIC_BACKEND_HOST);
const configuredSemanticEngineHost = trimEnvValue(process.env.EXPO_PUBLIC_SEMANTIC_ENGINE_HOST);
const isPhysicalDevice = Constants.isDevice ?? true;
const resolvedBackendHost =
  configuredBackendHost || (isPhysicalDevice ? DEFAULT_DEVICE_BACKEND_HOST : DEFAULT_SIMULATOR_BACKEND_HOST);
const resolvedSemanticEngineHost = configuredSemanticEngineHost || resolvedBackendHost;

export const API_CONFIG = {
  BACKEND_HOST: resolvedBackendHost,
  SEMANTIC_ENGINE_HOST: resolvedSemanticEngineHost,
  BACKEND_PORT: 5001,
  AI_BACKEND_PORT: 8001,
  REQUEST_TIMEOUT: 60000,
  IS_PHYSICAL_DEVICE: isPhysicalDevice,
  ENV_BACKEND_HOST: configuredBackendHost,
};

export const API_ORIGIN = `http://${API_CONFIG.BACKEND_HOST}:${API_CONFIG.BACKEND_PORT}`;
export const BASE_URL = `${API_ORIGIN}/api`;
export const HEALTH_CHECK_URL = `${API_ORIGIN}/health`;
export const AI_BACKEND_URL = `http://${API_CONFIG.SEMANTIC_ENGINE_HOST}:${API_CONFIG.AI_BACKEND_PORT}`;

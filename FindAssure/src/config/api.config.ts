/**
 * API Configuration
 * Update the BASE_URL based on your network setup
 */

// Automatically detect the correct API URL based on platform
// For development, update the IP address when it changes

// ⚠️ UPDATE THIS IP ADDRESS TO MATCH YOUR BACKEND SERVER
// Check backend console output for: "📱 Mobile Access: http://YOUR_IP:5001/api"
export const API_CONFIG = {
  // Current backend IP (update this when your network changes)
  BACKEND_IP: '192.168.8.109',
  SEMANTIC_ENGINE_URI: '127.0.0.1',
  BACKEND_PORT: 5001,

  // AI-Powered Semantic Engine (Python FastAPI backend)
  AI_BACKEND_PORT: 8001,
  
  // Timeouts
  REQUEST_TIMEOUT: 60000, // 60 seconds (AI generation can take 5-15 seconds)
  
  // Alternative URLs for different scenarios:
  // Android Emulator: '10.0.2.2'
  // iOS Simulator: 'localhost'
  // Physical Device: Use your computer's local IP
};

// Construct the full API URL
export const BASE_URL = `http://${API_CONFIG.BACKEND_IP}:${API_CONFIG.BACKEND_PORT}/api`;

// Health check URL (for testing connectivity)
export const HEALTH_CHECK_URL = `http://${API_CONFIG.BACKEND_IP}:${API_CONFIG.BACKEND_PORT}/health`;

// AI Semantic Engine URL (Python backend for grammar correction, search, etc.)
export const AI_BACKEND_URL = `http://${API_CONFIG.SEMANTIC_ENGINE_URI}:${API_CONFIG.AI_BACKEND_PORT}`;

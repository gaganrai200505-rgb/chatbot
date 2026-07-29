import axios from 'axios';

// Dynamic API Base URL — supports local PC, LAN IP, and public HTTPS tunnels
const getApiBaseUrl = () => {
  const host = typeof window !== 'undefined' ? window.location.hostname : '127.0.0.1';
  if (host.includes('loca.lt')) {
    return 'https://janseva-api-v1.loca.lt/api';
  }
  if (host === 'localhost' || host === '127.0.0.1') {
    return 'http://127.0.0.1:8000/api';
  }
  return `http://${host}:8000/api`;
};

const API_BASE_URL = getApiBaseUrl();

// Create an Axios instance with JWT interceptor
const api = axios.create({
  baseURL: API_BASE_URL,
});

// Automatically attach JWT token to every request
api.interceptors.request.use((config) => {
  const token = localStorage.getItem('access_token');
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

// Automatic JWT Token Refresh Interceptor on 401 Unauthorized
api.interceptors.response.use(
  (response) => response,
  async (error) => {
    const originalRequest = error.config;
    if (error.response?.status === 401 && !originalRequest._retry) {
      originalRequest._retry = true;
      const refreshToken = localStorage.getItem('refresh_token');
      if (refreshToken) {
        try {
          const res = await axios.post(`${API_BASE_URL}/token/refresh/`, { refresh: refreshToken });
          const newAccess = res.data.access;
          localStorage.setItem('access_token', newAccess);
          originalRequest.headers.Authorization = `Bearer ${newAccess}`;
          return api(originalRequest);
        } catch (refreshErr) {
          console.warn("Token refresh failed. Clearing tokens.");
          localStorage.removeItem('access_token');
          localStorage.removeItem('refresh_token');
        }
      }
    }
    return Promise.reject(error);
  }
);

// -------------------------------------------------------
// Auth API Calls
// -------------------------------------------------------

/** Register a new user */
export const registerUser = async (username, password, email = '') => {
  const response = await api.post('/register/', { username, password, email });
  return response.data;
};

/** Login and get JWT tokens */
export const loginUser = async (username, password) => {
  const response = await api.post('/token/', { username, password });
  const { access, refresh } = response.data;
  // Store tokens in localStorage
  localStorage.setItem('access_token', access);
  localStorage.setItem('refresh_token', refresh);
  return response.data;
};

/** Logout — clear tokens */
export const logoutUser = () => {
  localStorage.removeItem('access_token');
  localStorage.removeItem('refresh_token');
};

// -------------------------------------------------------
// Chat API Calls
// -------------------------------------------------------

/** Send a chat message (requires JWT) */
export const sendChatMessage = async (query, language = '', sessionId = '', selectedState = '', isVoice = false) => {
  try {
    const response = await api.post('/chat/', { query, language, session_id: sessionId, state: selectedState, is_voice: isVoice });
    return response.data;
  } catch (error) {
    console.error("API Error:", error);
    throw new Error(
      error.response?.data?.error ||
      error.response?.data?.detail ||
      "Failed to connect to the server. Make sure the backend is running."
    );
  }
};

/** Fetch chat history (requires JWT) */
export const fetchChatHistory = async () => {
  try {
    const response = await api.get('/history/');
    return response.data;
  } catch (error) {
    console.error("History Error:", error);
    return [];
  }
};

/** Delete a chat session */
export const deleteChatSession = async (sessionId) => {
  try {
    const response = await api.delete(`/session/${sessionId}/`);
    return response.data;
  } catch (error) {
    console.error("Delete Session Error:", error);
    throw error;
  }
};

/** Update a chat session (title, is_pinned) */
export const updateChatSession = async (sessionId, updates) => {
  try {
    const response = await api.patch(`/session/${sessionId}/`, updates);
    return response.data;
  } catch (error) {
    console.error("Update Session Error:", error);
    throw error;
  }
};

/** Evaluate citizen profile for scheme eligibility */
export const checkEligibility = async (profileData) => {
  try {
    const response = await api.post('/check-eligibility/', profileData);
    return response.data;
  } catch (error) {
    console.error("Eligibility Check Error:", error);
    throw error;
  }
};

/** Synthesize speech using backend neural TTS (edge-tts) with max latency cap */
export const fetchTextToSpeechAudio = async (text, language = 'en', timeoutMs = 1800) => {
  try {
    const response = await api.post(
      '/tts/',
      { text, language },
      { 
        responseType: 'blob',
        timeout: timeoutMs
      }
    );
    const audioBlob = new Blob([response.data], { type: 'audio/mpeg' });
    return URL.createObjectURL(audioBlob);
  } catch (error) {
    console.warn("TTS API Error or timeout:", error.message);
    return null;
  }
};

export default api;

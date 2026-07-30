import axios from 'axios';

// Dynamic API Base URL — supports env override, local PC, LAN IP, loca.lt tunnels, Vercel, Netlify, and Render production
const getApiBaseUrl = () => {
  if (import.meta.env.VITE_API_BASE_URL) {
    return import.meta.env.VITE_API_BASE_URL;
  }
  const host = typeof window !== 'undefined' ? window.location.hostname : '127.0.0.1';
  if (host.includes('onrender.com') || host.includes('vercel.app') || host.includes('netlify.app')) {
    return 'https://chatbot-324d.onrender.com/api';
  }
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
          console.warn("Token refresh failed. Logging out user.");
          localStorage.removeItem('access_token');
          localStorage.removeItem('refresh_token');
          localStorage.removeItem('username');
          // Force a page reload to redirect the user to the login screen
          window.location.href = '/';
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

/** Logout — blacklist refresh token and clear local tokens */
export const logoutUser = async () => {
  const refresh = localStorage.getItem('refresh_token');
  if (refresh) {
    try {
      await api.post('/logout/', { refresh });
    } catch (err) {
      console.warn("Logout API notification failed:", err.message);
    }
  }
  localStorage.removeItem('access_token');
  localStorage.removeItem('refresh_token');
};

/** Verify email OTP after registration */
export const verifyOtp = async (username, otp) => {
  const response = await api.post('/verify-otp/', { username, otp });
  return response.data;
};

/** Resend verification OTP */
export const resendOtp = async (username) => {
  const response = await api.post('/resend-otp/', { username });
  return response.data;
};

/** Request a password reset OTP */
export const forgotPassword = async (email) => {
  const response = await api.post('/forgot-password/', { email });
  return response.data;
};

/** Reset password using OTP */
export const resetPassword = async (email, otp, new_password) => {
  const response = await api.post('/reset-password/', { email, otp, new_password });
  return response.data;
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

/** Send a streaming chat message for instant real-time token reception */
export const sendChatMessageStream = async (query, language = '', sessionId = '', selectedState = '', isVoice = false, onChunk, onComplete) => {
  const token = localStorage.getItem('access_token');
  const response = await fetch(`${API_BASE_URL}/chat/`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`
    },
    body: JSON.stringify({
      query,
      language,
      session_id: sessionId,
      state: selectedState,
      is_voice: isVoice,
      stream: true
    })
  });

  if (!response.ok) {
    throw new Error('Streaming failed with status ' + response.status);
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder('utf-8');
  let fullText = '';
  let activeSessionId = sessionId;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    const chunkStr = decoder.decode(value, { stream: true });
    const lines = chunkStr.split('\n');

    for (const line of lines) {
      if (line.startsWith('data: [DONE]')) {
        if (onComplete) onComplete(fullText, activeSessionId);
        return { response: fullText, session_id: activeSessionId };
      }
      if (line.startsWith('data: ')) {
        try {
          const jsonStr = line.slice(6).trim();
          if (!jsonStr) continue;
          const parsed = JSON.parse(jsonStr);
          if (parsed.session_id) activeSessionId = parsed.session_id;
          if (parsed.token) {
            fullText += parsed.token;
            if (onChunk) onChunk(parsed.token, fullText, activeSessionId);
          }
        } catch (e) {}
      }
    }
  }

  if (onComplete) onComplete(fullText, activeSessionId);
  return { response: fullText, session_id: activeSessionId };
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

/** Synthesize speech using backend neural TTS (edge-tts / gTTS) */
export const fetchTextToSpeechAudio = async (text, language = 'en', timeoutMs = 10000) => {
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

    const res = await fetch(`${API_BASE_URL}/tts/`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text, language }),
      signal: controller.signal
    });

    clearTimeout(timeoutId);

    if (!res.ok) {
      console.warn('[TTS Fetch] Server returned status:', res.status);
      return null;
    }
    const blob = await res.blob();
    if (blob.size < 100) return null;
    const url = URL.createObjectURL(blob);
    console.log('[TTS Fetch] Success created blob URL:', url, 'size:', blob.size);
    return url;
  } catch (error) {
    console.warn("[TTS Fetch] Error:", error.message);
    return null;
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// Keep-Alive: prevent Render free-tier server from sleeping.
// Pings GET /api/ping/ every 10 minutes.  No auth needed.
// Started automatically when this module is imported (i.e. on app load).
// ─────────────────────────────────────────────────────────────────────────────
const PING_INTERVAL_MS = 10 * 60 * 1000; // 10 minutes

const pingServer = async () => {
  try {
    // Use a plain fetch so it bypasses the Axios JWT interceptor (no token needed)
    const res = await fetch(`${API_BASE_URL}/ping/`, { method: 'GET', cache: 'no-store' });
    if (res.ok) {
      console.debug('[KeepAlive] Server ping OK ✓');
    } else {
      console.warn('[KeepAlive] Server ping returned', res.status);
    }
  } catch (err) {
    console.warn('[KeepAlive] Ping failed (server may be cold-starting):', err.message);
  }
};

// Ping immediately on load (wakes server if sleeping), then every 10 min
pingServer();
setInterval(pingServer, PING_INTERVAL_MS);

export const keepServerAlive = pingServer; // named export for manual use

export default api;

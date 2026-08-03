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

/**
 * Decode a JWT payload (without verification) to read the `exp` claim.
 * Returns null for malformed tokens.
 */
const decodeJwtExp = (token) => {
  try {
    const payload = token.split('.')[1];
    const padded = payload.replace(/-/g, '+').replace(/_/g, '/');
    const json = decodeURIComponent(
      atob(padded).split('').map(c => '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2)).join('')
    );
    const data = JSON.parse(json);
    return data?.exp ? data.exp * 1000 : null;
  } catch {
    return null;
  }
};

/**
 * Returns a valid access token, transparently refreshing via the refresh
 * token when the current access token is missing or expired.
 * This is used by raw `fetch` calls (SSE stream, TTS blob, STT multipart)
 * which cannot go through the Axios response-interceptor refresh path.
 * Returns null when no token is available (user not logged in).
 */
const getValidAccessToken = async () => {
  const accessToken = localStorage.getItem('access_token');
  const refreshToken = localStorage.getItem('refresh_token');

  // No token at all — not logged in
  if (!accessToken) {
    if (refreshToken) {
      // Access token missing but refresh exists — try to refresh
      try {
        const res = await axios.post(`${API_BASE_URL}/token/refresh/`, { refresh: refreshToken });
        const newAccess = res.data.access;
        localStorage.setItem('access_token', newAccess);
        return newAccess;
      } catch {
        return null;
      }
    }
    return null;
  }

  // Check expiry (add 10s safety margin)
  const expMs = decodeJwtExp(accessToken);
  if (expMs && expMs - 10000 > Date.now()) {
    return accessToken; // still valid
  }

  // Expired (or undecodable) — attempt refresh
  if (!refreshToken) return null;
  try {
    const res = await axios.post(`${API_BASE_URL}/token/refresh/`, { refresh: refreshToken });
    const newAccess = res.data.access;
    localStorage.setItem('access_token', newAccess);
    return newAccess;
  } catch {
    return null;
  }
};

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

/**
 * Send a streaming chat message for instant real-time token reception.
 * Accepts an optional AbortSignal so callers can cancel the in-flight SSE
 * stream (e.g. when the user barges in / interrupts the AI while it is
 * still generating tokens).
 */
export const sendChatMessageStream = async (
  query,
  language = '',
  sessionId = '',
  selectedState = '',
  isVoice = false,
  onChunk,
  onComplete,
  signal = null
) => {
  const token = await getValidAccessToken();
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
    }),
    signal
  });

  if (!response.ok) {
    throw new Error('Streaming failed with status ' + response.status);
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder('utf-8');
  let fullText = '';
  let activeSessionId = sessionId;
  let detectedLang = language;

  let buffer = '';
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() || ''; // Keep incomplete line fragment in buffer

    for (const line of lines) {
      if (line.startsWith('data: [DONE]')) {
        if (onComplete) onComplete(fullText, activeSessionId, detectedLang);
        return { response: fullText, session_id: activeSessionId, detected_lang: detectedLang };
      }
      if (line.startsWith('data: ')) {
        try {
          const jsonStr = line.slice(6).trim();
          if (!jsonStr) continue;
          const parsed = JSON.parse(jsonStr);
          if (parsed.session_id) activeSessionId = parsed.session_id;
          if (parsed.detected_lang) detectedLang = parsed.detected_lang;
          if (parsed.token) {
            fullText += parsed.token;
            if (onChunk) onChunk(parsed.token, fullText, activeSessionId);
          }
        } catch (e) { }
      }
    }
  }

  // Stream ended without [DONE] — only fire onComplete if not aborted
  // (an aborted reader throws, so reaching here means a clean end).
  if (onComplete) onComplete(fullText, activeSessionId, detectedLang);
  return { response: fullText, session_id: activeSessionId, detected_lang: detectedLang };
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

/** Synthesize speech using backend neural TTS (edge-tts / sarvam / gTTS) */
export const fetchTextToSpeechAudio = async (text, language = 'en', timeoutMs = 10000, voiceOpts = {}) => {
  // Inner single-attempt function
  const attempt = async (ms) => {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), ms);
    try {
      const token = await getValidAccessToken();
      const payload = {
        text,
        language,
        gender: voiceOpts.gender || voiceOpts.voice_id || '',
        voice_id: voiceOpts.voice_id || voiceOpts.gender || '',
        provider: voiceOpts.provider || 'edge',
        rate: voiceOpts.rate || '+0%'
      };
      const res = await fetch(`${API_BASE_URL}/tts/`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { 'Authorization': `Bearer ${token}` } : {})
        },
        body: JSON.stringify(payload),
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
      clearTimeout(timeoutId);
      console.warn('[TTS Fetch] Attempt failed:', error.message);
      return null;
    }
  };

  // First attempt with caller-specified timeout
  let url = await attempt(timeoutMs);

  // Retry once with a generous 20s timeout (handles Render cold-start + slow mobile networks)
  if (!url) {
    console.warn('[TTS Fetch] First attempt failed — retrying with 20s timeout (cold-start recovery)...');
    url = await attempt(20000);
  }

  if (!url) console.warn('[TTS Fetch] Both attempts failed — will fall back to WebSpeech');
  return url;
};

/** Send recorded audio blob to Groq Whisper Large V3 for accurate transcription.
 *  Returns transcript string or '' on failure — caller handles fallback to WebSpeech.
 *  Supports all 10 regional Indian languages.
 */
export const sendAudioToGroqSTT = async (audioBlob, lang, externalSignal = null) => {
  try {
    let ext = 'webm';
    if (audioBlob && audioBlob.type) {
      if (audioBlob.type.includes('mp4') || audioBlob.type.includes('aac') || audioBlob.type.includes('m4a')) ext = 'm4a';
      else if (audioBlob.type.includes('wav')) ext = 'wav';
      else if (audioBlob.type.includes('ogg')) ext = 'ogg';
      else if (audioBlob.type.includes('mp3')) ext = 'mp3';
    }
    const formData = new FormData();
    formData.append('audio', audioBlob, `recording.${ext}`);
    formData.append('lang', lang);

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 20000); // 20s max

    if (externalSignal) {
      externalSignal.addEventListener('abort', () => controller.abort());
    }

    const token = await getValidAccessToken();
    const res = await fetch(`${API_BASE_URL}/stt/groq/`, {
      method: 'POST',
      headers: token ? { Authorization: `Bearer ${token}` } : {},
      body: formData,
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (!res.ok) {
      console.warn('[Groq STT] HTTP error:', res.status);
      return '';
    }

    const data = await res.json();
    console.log(`[Groq STT] source=${data.source} text="${(data.text || '').slice(0, 60)}"`);
    return data.text || '';
  } catch (err) {
    console.warn('[Groq STT] Request failed:', err.message);
    return '';
  }
};

/** Fetch Gemini 2.0 Multimodal Live Voice-to-Voice config */
export const fetchGeminiLiveConfig = async () => {
  try {
    const token = await getValidAccessToken();
    const res = await fetch(`${API_BASE_URL}/voice/live-config/`, {
      headers: token ? { 'Authorization': `Bearer ${token}` } : {}
    });
    if (!res.ok) return null;
    return await res.json();
  } catch (err) {
    console.warn('[Gemini Live] Config fetch failed:', err.message);
    return null;
  }
};

/** Tool Search Execution for Gemini 2.0 Live session to query DB facts */
export const executeToolSearch = async (query, state = '') => {
  try {
    const token = await getValidAccessToken();
    const res = await fetch(`${API_BASE_URL}/voice/tool-search/`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { 'Authorization': `Bearer ${token}` } : {})
      },
      body: JSON.stringify({ query, state })
    });
    if (!res.ok) return '';
    const data = await res.json();
    return data.facts || '';
  } catch (err) {
    console.warn('[Tool Search] Execution failed:', err.message);
    return '';
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
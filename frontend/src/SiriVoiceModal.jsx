import React, { useState, useEffect, useRef, useCallback } from 'react';
import { sendChatMessage, sendChatMessageStream, fetchTextToSpeechAudio } from './api';

/* ─────────────────────────────────────────────────────────────────────────
 * Constants & Helpers
 * ───────────────────────────────────────────────────────────────────────── */
const LANG_LOCALE = {
  auto: 'en-IN',
  en: 'en-IN',
  hi: 'hi-IN',
  kn: 'kn-IN',
  ta: 'ta-IN',
  te: 'te-IN',
  mr: 'mr-IN',
  bn: 'bn-IN',
  gu: 'gu-IN',
  ml: 'ml-IN',
  pa: 'pa-IN'
};

const VOICE_LANGUAGES = [
  { code: 'auto', name: 'Auto (Multilingual)', flag: '🌐' },
  { code: 'en',   name: 'English',             flag: '🇮🇳' },
  { code: 'hi',   name: 'हिंदी (Hindi)',         flag: '🇮🇳' },
  { code: 'kn',   name: 'ಕನ್ನಡ (Kannada)',       flag: '🇮🇳' },
  { code: 'ta',   name: 'தமிழ் (Tamil)',         flag: '🇮🇳' },
  { code: 'te',   name: 'తెలుగు (Telugu)',       flag: '🇮🇳' },
  { code: 'mr',   name: 'मराठी (Marathi)',       flag: '🇮🇳' },
  { code: 'bn',   name: 'বাংলা (Bengali)',       flag: '🇮🇳' },
  { code: 'gu',   name: 'ગુજરાતી (Gujarati)',     flag: '🇮🇳' },
  { code: 'ml',   name: 'മലയാളം (Malayalam)',   flag: '🇮🇳' },
  { code: 'pa',   name: 'ਪੰਜਾਬੀ (Punjabi)',       flag: '🇮🇳' },
];

const ChevronDownIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="6 9 12 15 18 9"/>
  </svg>
);

const CheckIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="20 6 9 17 4 12"/>
  </svg>
);

const prepareSpeechText = (text, lang) => {
  if (!text) return '';
  let clean = text
    .replace(/https?:\/\/\S+/g, '')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/\|/g, ' ')
    .replace(/#{1,6}\s?/g, '')
    .replace(/[*_~`]/g, '');
  if (lang === 'kn') {
    clean = clean.replace(/₹\s*([\d,]+)/g, '$1 ರೂಪಾಯಿ').replace(/%/g, ' ಶೇಕಡಾ');
  } else if (lang === 'hi') {
    clean = clean.replace(/₹\s*([\d,]+)/g, '$1 रुपये').replace(/%/g, ' प्रतिशत');
  } else {
    clean = clean.replace(/₹\s*([\d,]+)/g, '$1 Rupees').replace(/%/g, ' percent');
  }
  clean = clean.replace(/\s+/g, ' ').trim();
  return clean;
};

const getRealisticVoice = (langCode) => {
  if (!window.speechSynthesis) return null;
  const voices = window.speechSynthesis.getVoices();
  if (!voices || !voices.length) return null;
  const prefix = (LANG_LOCALE[langCode] || 'en-IN').split('-')[0].toLowerCase();
  const kws = ['microsoft christopher online (natural)', 'microsoft guy online (natural)',
    'microsoft prabhat', 'google us english male', 'google uk english male', 'rishi', 'george', 'natural'];
  for (const kw of kws) {
    const m = voices.find(v => v.name.toLowerCase().includes(kw) &&
      (v.lang.toLowerCase().startsWith(prefix) || prefix === 'en'));
    if (m) return m;
  }
  const lang = voices.filter(v => v.lang.toLowerCase().startsWith(prefix));
  return lang.find(v => v.name.toLowerCase().includes('google')) || lang[0] ||
    voices.find(v => v.lang.startsWith('en')) || voices[0] || null;
};

/* ─────────────────────────────────────────────────────────────────────────
 * EchoGuard — word-level Jaccard similarity + time-window suppression
 *
 * Suppresses microphone input that is likely the mic picking up the AI's
 * own speaker output.  Uses two independent signals:
 *   1. Jaccard word-overlap ≥ 0.55  (robust to partial transcriptions)
 *   2. Time window: only active for 4 s after AI speech ends
 * Both must be true to suppress, keeping false-positive rate near zero.
 * ───────────────────────────────────────────────────────────────────────── */
const echoWindowMs   = 4000;            // 4 s post-speech protection window
let   echoWindowEnd  = 0;              // epoch ms when window expires
let   lastSpokenText = '';             // normalized text of last AI utterance

/** Call this immediately before audio playback starts */
const setEchoSource = (text) => {
  lastSpokenText = (text || '').toLowerCase().replace(/[^\w\s]/g, ' ').replace(/\s+/g, ' ').trim();
  echoWindowEnd  = 0;               // reset; window opens when speech ENDS
};

/** Call this when audio playback finishes (open the guard window) */
const openEchoWindow = () => {
  echoWindowEnd = Date.now() + echoWindowMs;
};

/** Tokenize into a Set of unique words (length ≥ 2) */
const tokenize = (str) => new Set(
  str.toLowerCase().replace(/[^\w\s]/g, ' ').split(/\s+/).filter(w => w.length >= 2)
);

/**
 * Jaccard similarity between two strings.
 * Returns 0.0 – 1.0; values ≥ 0.55 are treated as an echo.
 */
const jaccardSimilarity = (a, b) => {
  const setA = tokenize(a);
  const setB = tokenize(b);
  if (!setA.size || !setB.size) return 0;
  let intersection = 0;
  setA.forEach(w => { if (setB.has(w)) intersection++; });
  return intersection / (setA.size + setB.size - intersection);
};

/**
 * Returns true when `transcript` is almost certainly the AI's own voice
 * leaking back into the microphone.
 */
const isEcho = (transcript) => {
  if (!lastSpokenText || !transcript) return false;
  if (Date.now() > echoWindowEnd) return false;   // outside protection window
  const sim = jaccardSimilarity(lastSpokenText, transcript);
  if (sim >= 0.55) {
    console.log(`[EchoGuard] Suppressed (Jaccard=${sim.toFixed(2)}):`, transcript);
    return true;
  }
  return false;
};

/* ─────────────────────────────────────────────────────────────────────────
 * Voice Suggestions
 * ───────────────────────────────────────────────────────────────────────── */
const VOICE_SUGGESTIONS = {
  en: ['Ayushman Bharat Card?', 'PM Kisan Status?', 'Ration Card?', 'Free Housing?'],
  hi: ['आयुष्मान भारत कार्ड?', 'पीएम किसान स्थिति?', 'राशन कार्ड?'],
  kn: ['ಆಯುಷ್ಮಾನ್ ಭಾರತ್?', 'ಪಿಎಂ ಕಿಸಾನ್?', 'ರಾಷನ್ ಕಾರ್ಡ್?']
};

/* ─────────────────────────────────────────────────────────────────────────
 * Icons
 * ───────────────────────────────────────────────────────────────────────── */
const GeminiStar = () => (
  <svg width="28" height="28" viewBox="0 0 24 24" fill="none">
    <path fillRule="evenodd" clipRule="evenodd"
      d="M12 0C12 6.627 6.627 12 0 12C6.627 12 12 17.373 12 24C12 17.373 17.373 12 24 12C17.373 12 12 6.627 12 0Z"
      fill="url(#vs_grad)" />
    <defs>
      <linearGradient id="vs_grad" x1="0" y1="0" x2="24" y2="24" gradientUnits="userSpaceOnUse">
        <stop stopColor="#4285F4" />
        <stop offset="0.4" stopColor="#9334E6" />
        <stop offset="1" stopColor="#EA4335" />
      </linearGradient>
    </defs>
  </svg>
);

const MicIcon = () => (
  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor"
    strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/>
    <path d="M19 10v2a7 7 0 0 1-14 0v-2"/>
    <line x1="12" y1="19" x2="12" y2="23"/>
    <line x1="8" y1="23" x2="16" y2="23"/>
  </svg>
);

const MicOffIcon = () => (
  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor"
    strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <line x1="1" y1="1" x2="23" y2="23"/>
    <path d="M9 9v3a3 3 0 0 0 5.12 2.12M15 9.34V4a3 3 0 0 0-5.94-.6"/>
    <path d="M17 16.95A7 7 0 0 1 5 12v-2m14 0v2a7 7 0 0 1-.11 1.23"/>
    <line x1="12" y1="19" x2="12" y2="23"/>
    <line x1="8" y1="23" x2="16" y2="23"/>
  </svg>
);

const PhoneOffIcon = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor"
    strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
    <path d="M10.68 13.31a16 16 0 0 0 3.41 2.6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7 2 2 0 0 1 1.72 2v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07"/>
    <path d="M14.5 2.5a10 10 0 0 0-10 10"/>
    <line x1="1" y1="1" x2="23" y2="23"/>
  </svg>
);

const SendIcon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor"
    strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <line x1="22" y1="2" x2="11" y2="13"/>
    <polygon points="22 2 15 22 11 13 2 9 22 2"/>
  </svg>
);

const CloseIcon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor"
    strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <line x1="18" y1="6" x2="6" y2="18"/>
    <line x1="6" y1="6" x2="18" y2="18"/>
  </svg>
);

/* ─────────────────────────────────────────────────────────────────────────
 * ChatGPT Voice Style Minimalist Pulsing Halo Orb Component
 * ───────────────────────────────────────────────────────────────────────── */
const ChatGPTVoiceOrb = ({ mode, onClick }) => (
  <div className={`chatgpt-voice-orb-wrapper mode-${mode}`} onClick={onClick}>
    <div className="chatgpt-aura-glow" />
    <div className="chatgpt-halo-pulse p1" />
    <div className="chatgpt-halo-pulse p2" />
    <div className="chatgpt-halo-pulse p3" />
    
    <div className="chatgpt-core-sphere">
      <div className="chatgpt-inner-swirl" />
    </div>

    <div className="chatgpt-sound-ripples">
      <span className="ripple r1" />
      <span className="ripple r2" />
      <span className="ripple r3" />
    </div>
  </div>
);


/* ─────────────────────────────────────────────────────────────────────────
 * Main Component
 * ───────────────────────────────────────────────────────────────────────── */
const SiriVoiceModal = ({
  isOpen,
  onClose,
  language = 'auto',
  onLanguageChange,
  selectedState = '',
  activeSessionId = '',
  onSessionStarted,
  onMessageSent,
  username = ''
}) => {
  const [currentLanguage, setCurrentLanguage] = useState(language || 'auto');
  const [isLangMenuOpen, setIsLangMenuOpen]   = useState(false);

  const [mode, setMode]           = useState('idle');
  const [userText, setUserText]   = useState('');
  const [interimText, setInterimText] = useState('');
  const [aiText, setAiText]       = useState('');
  const [historyLogs, setHistoryLogs] = useState([]);
  const [isMuted, setIsMuted]     = useState(false);
  const [inputText, setInputText] = useState('');
  const [permError, setPermError] = useState(null);

  // Track session changes to clear logs when starting a new chat
  const prevSessionIdRef = useRef(activeSessionId);
  useEffect(() => {
    if (prevSessionIdRef.current !== activeSessionId) {
      // Only clear logs if we switched from an existing session to a new one.
      // If we went from '' to a new session (because we just started it), keep the logs.
      if (prevSessionIdRef.current && prevSessionIdRef.current !== activeSessionId) {
        setHistoryLogs([]);
        setUserText('');
        setAiText("Hey! I'm listening — ask me about any government scheme.");
      }
      prevSessionIdRef.current = activeSessionId;
    }
  }, [activeSessionId]);

  // Keep refs of current values to avoid stale closures in event listeners
  const activeSessionIdRef = useRef(activeSessionId);
  const currentLanguageRef = useRef(currentLanguage);
  const selectedStateRef = useRef(selectedState);
  useEffect(() => {
    activeSessionIdRef.current = activeSessionId;
    currentLanguageRef.current = currentLanguage;
    selectedStateRef.current = selectedState;
  }, [activeSessionId, currentLanguage, selectedState]);

  // Refs
  const recognitionRef    = useRef(null);
  const isMutedRef        = useRef(false);
  const currentUtterRef   = useRef(null);
  const transcriptEndRef  = useRef(null);
  // IMPORTANT: playbackAudioRef is for dynamic audio playback only (NOT a DOM element)
  const playbackAudioRef  = useRef(null);
  const isProcessingRef   = useRef(false);
  const isSpeakingRef     = useRef(false);
  const lastSpokenTextRef = useRef('');
  const silenceTimerRef   = useRef(null);
  const latestTranscriptRef = useRef('');
  const startListeningRef = useRef(null);

  useEffect(() => {
    if (language) setCurrentLanguage(language);
  }, [language]);

  /* ── Stop audio playback completely ── */
  const stopAudio = useCallback(() => {
    isSpeakingRef.current = false;
    try { if (window.speechSynthesis) window.speechSynthesis.cancel(); } catch {}
    if (playbackAudioRef.current) {
      try { playbackAudioRef.current.pause(); } catch {}
      playbackAudioRef.current.onended = null;
      playbackAudioRef.current.onerror = null;
      playbackAudioRef.current = null;
    }
    currentUtterRef.current = null;
  }, []);

  /* ── Stop speech recognition cleanly ── */
  const stopRecognition = useCallback(() => {
    if (silenceTimerRef.current) {
      clearTimeout(silenceTimerRef.current);
      silenceTimerRef.current = null;
    }
    if (recognitionRef.current) {
      const rec = recognitionRef.current;
      recognitionRef.current = null; // nullify BEFORE abort to prevent onend re-entry
      try {
        rec.onresult = null;
        rec.onerror  = null;
        rec.onend    = null;
        rec.onstart  = null;
        rec.abort();
      } catch {}
    }
  }, []);

  /* ── Speak the full AI answer via Edge-TTS, fallback to WebSpeech ── */
  const speakAnswer = useCallback(async (text, lang) => {
    if (!text || isMutedRef.current) {
      setMode('idle');
      return;
    }

    const cleanText = prepareSpeechText(text, lang);
    if (!cleanText) {
      setMode('idle');
      if (startListeningRef.current) startListeningRef.current();
      return;
    }

    // Stop recognition FIRST, then mark as speaking
    stopRecognition();
    isSpeakingRef.current = true;
    setMode('speaking');
    setEchoSource(cleanText);           // prime EchoGuard with what AI will say
    console.log('[Voice] Speaking answer:', cleanText.slice(0, 60));

    const onSpeechFinished = () => {
      console.log('[Voice] Speech finished — restarting listener in 800ms');
      openEchoWindow();                 // open 4 s suppression window NOW
      currentUtterRef.current = null;
      isSpeakingRef.current = false;
      setTimeout(() => {
        if (!isMutedRef.current && startListeningRef.current) {
          startListeningRef.current();
        } else {
          setMode('idle');
        }
      }, 800);
    };

    // --- PRIMARY: Edge-TTS Neural Audio via backend ---
    let ttsAudioUrl = null;
    try {
      ttsAudioUrl = await fetchTextToSpeechAudio(cleanText, lang, 10000);
    } catch (e) {
      ttsAudioUrl = null;
    }

    if (ttsAudioUrl && !isMutedRef.current) {
      // Create a brand-new Audio object (never reuse DOM element)
      const audio = new Audio();
      playbackAudioRef.current = audio;
      audio.volume = 1.0;
      audio.src = ttsAudioUrl;

      const cleanup = () => {
        URL.revokeObjectURL(ttsAudioUrl);
        if (playbackAudioRef.current === audio) playbackAudioRef.current = null;
        onSpeechFinished();
      };

      audio.onended = cleanup;
      audio.onerror = (err) => {
        console.warn('[Voice] Audio element error:', err);
        cleanup();
      };

      try {
        await audio.play();
        console.log('[Voice] Neural TTS audio playing ✓');
        return; // success — wait for onended
      } catch (playErr) {
        console.warn('[Voice] audio.play() failed:', playErr.message);
        URL.revokeObjectURL(ttsAudioUrl);
        playbackAudioRef.current = null;
        // Fall through to WebSpeech fallback below
      }
    }

    // --- FALLBACK: WebSpeech API ---
    if (window.speechSynthesis && !isMutedRef.current) {
      try { window.speechSynthesis.cancel(); } catch {}

      // Wait for voices to load (first call may have empty voices list)
      const trySpeak = () => {
        const utter = new SpeechSynthesisUtterance(cleanText);
        utter.lang   = LANG_LOCALE[lang] || 'en-IN';
        utter.rate   = 1.0;
        utter.volume = 1.0;
        const voice  = getRealisticVoice(lang);
        if (voice) utter.voice = voice;
        currentUtterRef.current = utter;
        utter.onend   = onSpeechFinished;
        utter.onerror = onSpeechFinished;
        window.speechSynthesis.speak(utter);
      };

      const voices = window.speechSynthesis.getVoices();
      if (voices && voices.length > 0) {
        trySpeak();
      } else {
        window.speechSynthesis.onvoiceschanged = () => {
          window.speechSynthesis.onvoiceschanged = null;
          trySpeak();
        };
        // Safety: if onvoiceschanged never fires, speak with default
        setTimeout(() => {
          if (isSpeakingRef.current && !currentUtterRef.current) trySpeak();
        }, 500);
      }
    } else {
      onSpeechFinished();
    }
  }, [stopRecognition]);

  /* ── Handle a user query ── */
  const handleQuery = useCallback(async (query) => {
    const q = (query || '').trim();
    if (!q || isProcessingRef.current) return;

    isProcessingRef.current = true;
    stopAudio();
    stopRecognition();
    setMode('thinking');
    setUserText(q);
    setAiText('');
    setInterimText('');

    try {
      await sendChatMessageStream(
        q,
        currentLanguageRef.current,
        activeSessionIdRef.current,
        selectedStateRef.current,
        true,
        (chunkToken, accText, newSessionId) => {
          setAiText(accText);
          if (newSessionId && onSessionStarted) onSessionStarted(newSessionId);
        },
        (finalText, finalSessionId) => {
          setAiText(finalText);
          setHistoryLogs(prev => [...prev, { user: q, ai: finalText }]);
          if (onMessageSent) onMessageSent();
          isProcessingRef.current = false;

          if (finalText && !isMutedRef.current) {
            speakAnswer(finalText, currentLanguageRef.current);
          } else {
            setMode('idle');
            if (!isMutedRef.current && startListeningRef.current) {
              startListeningRef.current();
            }
          }
        }
      );
    } catch (err) {
      console.warn('[Voice] Stream failed, trying non-stream:', err.message);
      try {
        const res = await sendChatMessage(q, currentLanguageRef.current, activeSessionIdRef.current, selectedStateRef.current, true);
        const reply = res?.response || res?.answer || 'Sorry, I could not get information about that.';
        if (res?.session_id && onSessionStarted) onSessionStarted(res.session_id);
        if (onMessageSent) onMessageSent();
        setAiText(reply);
        setHistoryLogs(prev => [...prev, { user: q, ai: reply }]);
        isProcessingRef.current = false;
        if (!isMutedRef.current && reply) {
          speakAnswer(reply, currentLanguageRef.current);
        } else {
          setMode('idle');
        }
      } catch (fallbackErr) {
        const errReply = 'Something went wrong. Please try again.';
        setAiText(errReply);
        setHistoryLogs(prev => [...prev, { user: q, ai: errReply }]);
        isProcessingRef.current = false;
        setMode('idle');
      }
    }
  }, [speakAnswer, stopAudio, stopRecognition, onSessionStarted, onMessageSent]);

  /* ── Start speech recognition ── */
  const startListening = useCallback(() => {
    // Don't start listening while speaking or processing
    if (isSpeakingRef.current || isProcessingRef.current || isMutedRef.current) return;

    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) {
      setPermError('Speech recognition not supported in this browser.');
      return;
    }

    // Abort previous recognition if any
    stopRecognition();

    const recognition = new SpeechRecognition();
    recognition.continuous      = true;
    recognition.interimResults  = true;
    recognition.lang            = LANG_LOCALE[currentLanguageRef.current] || 'en-IN';
    recognition.maxAlternatives = 1;

    latestTranscriptRef.current = '';

    recognition.onstart = () => {
      console.log('[Voice] Microphone started — listening');
      setMode('listening');
    };

    recognition.onresult = (e) => {
      // Block input if AI is speaking or processing
      if (isSpeakingRef.current || isProcessingRef.current) return;

      let finalT  = '';
      let interimT = '';
      for (let i = 0; i < e.results.length; ++i) {
        if (e.results[i].isFinal) finalT   += e.results[i][0].transcript;
        else                       interimT += e.results[i][0].transcript;
      }

      const fullText = (finalT || interimT).trim();
      if (fullText) {
        latestTranscriptRef.current = fullText;
        setInterimText(fullText);

        // Auto-submit after 800ms of silence
        if (silenceTimerRef.current) clearTimeout(silenceTimerRef.current);
        silenceTimerRef.current = setTimeout(() => {
          const pending = latestTranscriptRef.current.trim();
          if (!pending || isProcessingRef.current || isSpeakingRef.current) return;

          // EchoGuard — Jaccard similarity + time-window
          if (isEcho(pending)) {
            latestTranscriptRef.current = '';
            setInterimText('');
            return;
          }

          latestTranscriptRef.current = '';
          setInterimText('');
          stopRecognition();
          handleQuery(pending);
        }, 800);
      }

      // Also submit immediately on final result
      if (finalT.trim()) {
        const transcript = finalT.trim();

        // EchoGuard — Jaccard similarity + time-window
        if (isEcho(transcript)) {
          latestTranscriptRef.current = '';
          setInterimText('');
          return;
        }

        latestTranscriptRef.current = '';
        setInterimText('');
        stopRecognition();
        handleQuery(transcript);
      }
    };

    recognition.onend = () => {
      const remaining = latestTranscriptRef.current.trim();
      setInterimText('');
      latestTranscriptRef.current = '';

      if (remaining && !isProcessingRef.current && !isSpeakingRef.current) {
        if (isEcho(remaining)) {
          // suppressed — do nothing
        } else {
          handleQuery(remaining);
          return;
        }
      }

      if (!isProcessingRef.current && !isMutedRef.current && !isSpeakingRef.current) {
        setMode('idle');
      }
    };

    recognition.onerror = (e) => {
      setInterimText('');
      if (e.error !== 'no-speech' && e.error !== 'aborted') {
        console.warn('[Voice] Recognition error:', e.error);
      }
      if (!isSpeakingRef.current && !isProcessingRef.current) {
        setMode('idle');
      }
    };

    recognitionRef.current = recognition;

    // startListeningRef is used by speakAnswer's onSpeechFinished to restart mic
    startListeningRef.current = () => {
      if (isSpeakingRef.current || isProcessingRef.current || isMutedRef.current) return;
      // Create a fresh recognition instance each time to avoid Chrome's one-shot limit
      startListening();
    };

    try {
      recognition.start();
    } catch (err) {
      console.warn('[Voice] Could not start recognition:', err.message);
    }
  }, [handleQuery, stopRecognition]);

  /* ── Unlock browser audio context on first user gesture ── */
  const unlockAudioContext = useCallback(() => {
    try {
      const silentAudio = new Audio('data:audio/wav;base64,UklGRigAAABXQVZFZm10IBIAAAABAAEARKwAAIhYAQACABAAAABkYXRhAgAAAAEA');
      silentAudio.volume = 0.001;
      silentAudio.play().then(() => silentAudio.pause()).catch(() => {});
    } catch {}
    try {
      if (window.speechSynthesis) {
        if (window.speechSynthesis.paused) window.speechSynthesis.resume();
        const u = new SpeechSynthesisUtterance(' ');
        u.volume = 0.001;
        window.speechSynthesis.speak(u);
      }
    } catch {}
  }, []);

  /* ── Lifecycle: open/close ── */
  useEffect(() => {
    if (!isOpen) return;

    unlockAudioContext();
    isProcessingRef.current  = false;
    isSpeakingRef.current    = false;
    isMutedRef.current       = false;
    setIsMuted(false);
    setMode('idle');
    setUserText('');
    setPermError(null);
    latestTranscriptRef.current = '';
    setEchoSource('');

    const displayName = username ? username.split('@')[0].split('.')[0] : '';
    const nameCap = displayName ? displayName.charAt(0).toUpperCase() + displayName.slice(1) : '';
    const greetingText = nameCap
      ? `Hey ${nameCap}! I'm listening — ask me about any government scheme.`
      : "Hey! I'm listening — ask me about any government scheme.";

    setAiText(greetingText);

    if (!activeSessionId) {
      setHistoryLogs([]);
      // Speak the initial greeting automatically
      setTimeout(() => {
        if (!isMutedRef.current) {
          speakAnswer(greetingText, currentLanguage);
        }
      }, 400); // Wait for modal animation to mount
    } else {
      const tryStart = () => startListening();

      if (navigator.mediaDevices?.getUserMedia) {
        navigator.mediaDevices.getUserMedia({ audio: true })
          .then(stream => { stream.getTracks().forEach(t => t.stop()); tryStart(); })
          .catch(() => setPermError('Microphone permission required. Tap 🔒 in browser bar to allow.'));
      } else {
        tryStart();
      }
    }

    return () => {
      stopRecognition();
      stopAudio();
    };
  }, [isOpen]); // eslint-disable-line react-hooks/exhaustive-deps

  /* ── Keyboard shortcut: Escape ── */
  useEffect(() => {
    const handle = (e) => { if (e.key === 'Escape' && isOpen) onClose(); };
    window.addEventListener('keydown', handle);
    return () => window.removeEventListener('keydown', handle);
  }, [isOpen, onClose]);

  /* ── Handlers ── */
  const handleSelectLang = (code) => {
    unlockAudioContext();
    setCurrentLanguage(code);
    setIsLangMenuOpen(false);
    if (onLanguageChange) onLanguageChange(code);
    stopAudio();
    stopRecognition();
    setTimeout(() => {
      if (!isMutedRef.current) startListening();
    }, 200);
  };

  const handleTypedSubmit = (e) => {
    e.preventDefault();
    unlockAudioContext();
    const q = inputText.trim();
    if (!q) return;
    setInputText('');
    handleQuery(q);
  };

  const handleOrbClick = () => {
    unlockAudioContext();
    if (isSpeakingRef.current) {
      // Tap orb to interrupt speech
      stopAudio();
      setMode('idle');
      setTimeout(() => {
        if (!isMutedRef.current) startListening();
      }, 300);
    } else {
      isProcessingRef.current = false;
      if (isMutedRef.current) {
        isMutedRef.current = false;
        setIsMuted(false);
      }
      startListening();
    }
  };

  const toggleMute = () => {
    if (isMuted) {
      setIsMuted(false);
      isMutedRef.current = false;
      stopAudio();
      startListening();
    } else {
      setIsMuted(true);
      isMutedRef.current = true;
      stopAudio();
      stopRecognition();
      setMode('idle');
    }
  };

  if (!isOpen) return null;

  const STATUS = {
    listening: { label: 'Listening',  hint: 'Speak now…' },
    thinking:  { label: 'Thinking',   hint: 'Processing your query…' },
    speaking:  { label: 'Speaking',   hint: 'Tap orb to interrupt' },
    idle:      { label: isMuted ? 'Muted' : 'Ready', hint: isMuted ? 'Tap unmute to speak' : 'Tap mic or speak' },
  };

  const selectedLangObj = VOICE_LANGUAGES.find(l => l.code === currentLanguage) || VOICE_LANGUAGES[0];

  return (
    <div className="gemini-live-screen" onClick={() => { setIsLangMenuOpen(false); onClose(); }}>
      <div className="gemini-live-container" onClick={e => e.stopPropagation()}>

        {/* ── Top Navigation Bar ── */}
        <header className="gemini-live-header">
          <div className="gemini-live-brand">
            <GeminiStar />
            <div className="gemini-live-brand-text">
              <span className="gemini-live-title">JanSeva Live</span>
              <span className="gemini-live-sub">Voice AI Companion</span>
            </div>
          </div>

          {/* Voice Language Selector Dropdown */}
          <div className="voice-lang-dropdown-wrapper" onClick={e => e.stopPropagation()}>
            <button
              className="voice-lang-select-btn"
              onClick={(e) => { e.stopPropagation(); setIsLangMenuOpen(o => !o); }}
              aria-label="Select Voice Assistant Language"
            >
              <span className="lang-flag">{selectedLangObj.flag}</span>
              <span className="lang-name">{selectedLangObj.name}</span>
              <ChevronDownIcon />
            </button>

            {isLangMenuOpen && (
              <div className="voice-lang-menu" onClick={e => e.stopPropagation()}>
                {VOICE_LANGUAGES.map((l) => (
                  <button
                    key={l.code}
                    className={`voice-lang-menu-item ${currentLanguage === l.code ? 'active' : ''}`}
                    onClick={(e) => { e.stopPropagation(); handleSelectLang(l.code); }}
                  >
                    <span className="item-flag">{l.flag}</span>
                    <span className="item-name">{l.name}</span>
                    {currentLanguage === l.code && <CheckIcon />}
                  </button>
                ))}
              </div>
            )}
          </div>

          <div className="gemini-live-status-badge" data-mode={mode}>
            <span className="gemini-live-dot" />
            <span className="gemini-live-status-text">{STATUS[mode].label}</span>
          </div>

          <button className="gemini-live-close-btn" onClick={onClose} aria-label="Close JanSeva Live">
            <CloseIcon />
          </button>
        </header>

        {/* ── Main Center Stage (ChatGPT Voice Style Pulsing Halo Orb) ── */}
        <main className="gemini-live-stage">
          <ChatGPTVoiceOrb mode={mode} onClick={handleOrbClick} />
          
          <div className="gemini-live-hint-text">{STATUS[mode].hint}</div>

          {/* Quick Voice Suggestion Chips */}
          {(mode === 'idle' || mode === 'listening') && historyLogs.length === 0 && !userText && !interimText && (
            <div className="voice-suggestion-chips">
              {(VOICE_SUGGESTIONS[currentLanguage] || VOICE_SUGGESTIONS['en']).map((suggestion, idx) => (
                <button
                  key={idx}
                  className="voice-chip-btn"
                  onClick={() => { unlockAudioContext(); handleQuery(suggestion); }}
                >
                  <span className="chip-icon">⚡</span>
                  <span>{suggestion}</span>
                </button>
              ))}
            </div>
          )}

          {/* ── Persistent Live Transcript & Response Display Card ── */}
          {(historyLogs.length > 0 || userText || interimText || aiText) && (
            <div className="gemini-live-captions">
              {historyLogs.map((log, idx) => (
                <React.Fragment key={idx}>
                  <div className="caption-bubble user-caption">
                    <span className="caption-speaker">You</span>
                    <span className="caption-text">{log.user}</span>
                  </div>
                  <div className="caption-bubble ai-caption">
                    <span className="caption-speaker">JanSeva AI</span>
                    <span className="caption-text">{log.ai}</span>
                  </div>
                </React.Fragment>
              ))}

              {/* Active Live Turn */}
              {mode === 'thinking' && !aiText && (
                <div className="caption-bubble user-caption">
                  <span className="caption-speaker">You</span>
                  <span className="caption-text">{userText}</span>
                </div>
              )}
              {interimText && (
                <div className="caption-bubble user-caption">
                  <span className="caption-speaker">You</span>
                  <span className="caption-text">
                    {interimText}
                    <span className="live-typing-indicator">…</span>
                  </span>
                </div>
              )}
              {aiText && (!historyLogs.length || historyLogs[historyLogs.length - 1]?.ai !== aiText) && (
                <div className="caption-bubble ai-caption">
                  <span className="caption-speaker">JanSeva AI</span>
                  <span className="caption-text">{aiText}</span>
                </div>
              )}
              <div ref={transcriptEndRef} />
            </div>
          )}

          {/* ── Permission Error ── */}
          {permError && <div className="gemini-live-error">⚠️ {permError}</div>}
        </main>

        {/* ── Bottom Floating Control Toolbar ── */}
        <footer className="gemini-live-toolbar">
          <button
            className={`toolbar-btn mute-btn ${isMuted ? 'is-muted' : ''}`}
            onClick={toggleMute}
            aria-label={isMuted ? 'Unmute microphone' : 'Mute microphone'}
          >
            {isMuted ? <MicOffIcon /> : <MicIcon />}
            <span>{isMuted ? 'Unmute' : 'Mute'}</span>
          </button>
          <button className="toolbar-btn end-btn" onClick={onClose} aria-label="End session">
            <PhoneOffIcon />
            <span>End Live</span>
          </button>
        </footer>

      </div>
    </div>
  );

};

export default SiriVoiceModal;

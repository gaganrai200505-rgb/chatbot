import React, { useState, useEffect, useRef, useCallback } from 'react';
import { sendChatMessage, sendChatMessageStream, fetchTextToSpeechAudio, sendAudioToGroqSTT } from './api';
import { GeminiLiveSession } from './geminiLiveWebSocket';

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

const REGIONAL_GREETINGS = {
  en: "Hey! I'm listening — ask me about any government scheme.",
  hi: "नमस्ते! मैं आपकी बात सुन रहा हूँ — किसी भी सरकारी योजना के बारे में पूछें।",
  kn: "ನಮಸ್ಕಾರ! — ಯಾವುದೇ ಸರ್ಕಾರಿ ಯೋಜನೆಯ ಬಗ್ಗೆ ನನ್ನನ್ನು ಕೇಳಿ.",
  ta: "வணக்கம்! நான் கேட்கிறேன் — எந்த அரசு திட்டத்தைப் பற்றியும் என்னிடம் கேளுங்கள்.",
  te: "నమస్కారం! నేను వింటున్నాను — ఏదైనా ప్రభుత్వ పథకం గురించి నన్ను అడగండి.",
  mr: "नमस्कार! मी ऐकत आहे — कोणत्याही सरकारी योजनेबद्दल मला विचारा.",
  bn: "নমস্কার! আমি শুনছি — যেকোনো সরকারি প্রকল্প সম্পর্কে আমাকে জিজ্ঞাসা করুন।",
  gu: "નમસ્તે! હું સાંભળી રહ્યો છું — મને કોઈપણ સરકારી યોજના વિશે પૂછો.",
  ml: "നമസ്കാരം! ഞാൻ കേൾക്കുന്നു — ഏത് സർക്കാർ പദ്ധതിയെക്കുറിച്ചും എന്നോട് ചോദിക്കൂ.",
  pa: "ਸਤਿ ਸ਼੍ਰੀ ਅਕਾਲ! ਮੈਂ ਸੁਣ ਰਿਹਾ ਹਾਂ — ਮੈਨੂੰ ਕਿਸੇ ਵੀ ਸਰਕਾਰੀ ਯੋਜਨਾ ਬਾਰੇ ਪੁੱਛੋ।",
  auto: "Hey! I'm listening — ask me about any government scheme."
};

const getGreetingText = (lang, uname) => {
  const base = REGIONAL_GREETINGS[lang] || REGIONAL_GREETINGS['en'];
  if (lang === 'en' && uname) {
    const displayName = uname.split('@')[0].split('.')[0];
    const nameCap = displayName ? displayName.charAt(0).toUpperCase() + displayName.slice(1) : '';
    return nameCap ? `Hey ${nameCap}! I'm listening — ask me about any government scheme.` : base;
  }
  return base;
};

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
const echoWindowMs   = 4000;            // 4s post-speech protection window (matches VOICE_TRANSFORMATION_STRATEGY.md)
let   echoWindowEnd  = 0;               // epoch ms when window expires
let   lastSpokenText = '';              // normalized text of last AI utterance

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
 * Returns 0.0 – 1.0; values ≥ 0.55 are treated as an echo (matches strategy
 * doc §1.1 and the Jaccard comment above, not the stale 0.85 constant).
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
    console.log(`[EchoGuard] Suppressed echo duplicate (Jaccard=${sim.toFixed(2)}):`, transcript);
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

const PlusIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor"
    strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
    <line x1="12" y1="5" x2="12" y2="19"/>
    <line x1="5" y1="12" x2="19" y2="12"/>
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
  username = '',
  onNewChat
}) => {
  const [currentLanguage, setCurrentLanguage] = useState(language || 'auto');
  const [isLangMenuOpen, setIsLangMenuOpen]   = useState(false);
  const [voiceGender, setVoiceGender]         = useState('female');

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
  // MediaRecorder refs — used by the Groq Whisper STT path
  const mediaRecorderRef  = useRef(null);
  const audioChunksRef    = useRef([]);
  const vadTimerRef       = useRef(null);   // voice-activity-detection silence timer
  const vadAnalyserRef    = useRef(null);   // AudioContext analyser node
  const vadStreamRef      = useRef(null);   // mic MediaStream kept alive during recording
  const bargeInTimerRef   = useRef(null);   // voice barge-in timer
  const bargeInStreamRef  = useRef(null);   // mic stream active while AI is replying
  const speakingSafetyTimerRef = useRef(null); // safety timer to unlock listening state
  const liveSessionRef    = useRef(null);   // Gemini 2.0 Multimodal Live WebSocket session
  const globalAbortControllerRef = useRef(null); // global AbortController for in-flight requests
  const [isLiveActive, setIsLiveActive] = useState(false);

  useEffect(() => {
    if (language) setCurrentLanguage(language);
  }, [language]);

  /* ── Stop audio playback completely ── */
  const stopAudio = useCallback(() => {
    isSpeakingRef.current = false;
    if (liveSessionRef.current) {
      try { liveSessionRef.current.stopAudioPlayback(); } catch {}
    }
    if (globalAbortControllerRef.current) {
      try { globalAbortControllerRef.current.abort(); } catch {}
      globalAbortControllerRef.current = null;
    }
    if (speakingSafetyTimerRef.current) { clearTimeout(speakingSafetyTimerRef.current); speakingSafetyTimerRef.current = null; }
    if (bargeInTimerRef.current) { clearTimeout(bargeInTimerRef.current); bargeInTimerRef.current = null; }
    if (bargeInStreamRef.current) {
      try { bargeInStreamRef.current.getTracks().forEach(t => t.stop()); } catch {}
      bargeInStreamRef.current = null;
    }
    try { if (window.speechSynthesis) window.speechSynthesis.cancel(); } catch {}
    if (playbackAudioRef.current) {
      try {
        playbackAudioRef.current.pause();
        playbackAudioRef.current.currentTime = 0;
        playbackAudioRef.current.src = '';
      } catch {}
      playbackAudioRef.current.onended = null;
      playbackAudioRef.current.onerror = null;
      playbackAudioRef.current = null;
    }
    currentUtterRef.current = null;
    // Also stop any active Groq MediaRecorder session
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
      try { mediaRecorderRef.current.stop(); } catch {}
      mediaRecorderRef.current = null;
    }
    if (vadTimerRef.current) { clearTimeout(vadTimerRef.current); vadTimerRef.current = null; }
  }, []);

  /* ── Get Echo-Cancelled Microphone Stream ── */
  const getEchoCancelledStream = useCallback(async () => {
    try {
      return await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        }
      });
    } catch (e) {
      return await navigator.mediaDevices.getUserMedia({ audio: true });
    }
  }, []);

  /* ── Hands-free Voice Barge-In: mic listener active while AI is speaking ── */
  const startBargeInMicListener = useCallback(() => {
    if (isMutedRef.current || !navigator.mediaDevices?.getUserMedia) return;

    const startTime = Date.now();
    const GRACE_PERIOD_MS = 150; // 150ms initial playback grace period

    getEchoCancelledStream()
      .then(stream => {
        if (!isSpeakingRef.current) {
          stream.getTracks().forEach(t => t.stop());
          return;
        }

        bargeInStreamRef.current = stream;
        try {
          const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
          const source   = audioCtx.createMediaStreamSource(stream);
          const analyser = audioCtx.createAnalyser();
          analyser.fftSize = 512;
          source.connect(analyser);

          const dataArray = new Uint8Array(analyser.frequencyBinCount);
          let userSpeechSpikes = 0;

          const checkBargeIn = () => {
            if (!isSpeakingRef.current) {
              stream.getTracks().forEach(t => t.stop());
              try { audioCtx.close(); } catch {}
              return;
            }

            if (Date.now() - startTime < GRACE_PERIOD_MS) {
              bargeInTimerRef.current = setTimeout(checkBargeIn, 50);
              return;
            }

            analyser.getByteFrequencyData(dataArray);
            let maxVal = 0;
            let sum = 0;
            let sqSum = 0;
            for (let i = 0; i < dataArray.length; i++) {
              const v = dataArray[i];
              if (v > maxVal) maxVal = v;
              sum += v;
              sqSum += v * v;
            }
            const avg = sum / dataArray.length;
            const rms = Math.sqrt(sqSum / dataArray.length);

            // User Vocal Power Threshold: Ignore speaker output bleed (< 60 peak), trigger ONLY on genuine user speech (> 75 peak)
            if (maxVal >= 75 || rms >= 28) {
              userSpeechSpikes++;
              if (userSpeechSpikes >= 2) {
                console.log(`[VoiceBargeIn] User voice interrupted AI! rms=${rms.toFixed(1)}, maxVal=${maxVal}`);
                stopAudio();
                stream.getTracks().forEach(t => t.stop());
                try { audioCtx.close(); } catch {}
                isSpeakingRef.current = false;
                isProcessingRef.current = false;
                setMode('listening');
                if (startListeningRef.current) startListeningRef.current();
                return;
              }
            } else {
              userSpeechSpikes = 0;
            }

            bargeInTimerRef.current = setTimeout(checkBargeIn, 40); // 40ms high-frequency polling for instant response
          };

          checkBargeIn();
        } catch (e) {
          console.warn('[BargeIn] AudioContext setup failed:', e.message);
        }
      })
      .catch(() => {});
  }, [stopAudio, getEchoCancelledStream]);

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

  /* ── Stop MediaRecorder + VAD cleanly (Groq STT path) ── */
  const stopMediaRecorder = useCallback(() => {
    if (vadTimerRef.current) { clearTimeout(vadTimerRef.current); vadTimerRef.current = null; }
    if (vadAnalyserRef.current) { try { vadAnalyserRef.current.disconnect(); } catch {} vadAnalyserRef.current = null; }
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
      try { mediaRecorderRef.current.stop(); } catch {}
    }
    mediaRecorderRef.current = null;
    audioChunksRef.current = [];
    if (vadStreamRef.current) {
      try { vadStreamRef.current.getTracks().forEach(t => t.stop()); } catch {}
      vadStreamRef.current = null;
    }
  }, []);

  /* ── Speak the full AI answer via Edge-TTS, fallback to WebSpeech ── */
  const speakAnswer = useCallback(async (text, lang, isGreeting = false) => {
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

    // Only activate barge-in for AI answer turns, NOT during the initial system greeting
    if (!isGreeting) {
      startBargeInMicListener();
    }

    console.log(`[Voice] Speaking answer (isGreeting=${isGreeting}):`, cleanText.slice(0, 60));

    if (speakingSafetyTimerRef.current) clearTimeout(speakingSafetyTimerRef.current);
    speakingSafetyTimerRef.current = setTimeout(() => {
      if (isSpeakingRef.current) {
        console.warn('[Voice] Speech safety timeout — resetting speaking state');
        isSpeakingRef.current = false;
        if (!isMutedRef.current) {
          setMode('listening');
          if (startListeningRef.current) startListeningRef.current();
        }
      }
    }, 10000);

    const onSpeechFinished = () => {
      console.log('[Voice] Speech finished — re-opening mic instantly (0ms delay)');
      if (speakingSafetyTimerRef.current) { clearTimeout(speakingSafetyTimerRef.current); speakingSafetyTimerRef.current = null; }
      openEchoWindow();                 // open 4 s suppression window NOW
      currentUtterRef.current = null;
      isSpeakingRef.current = false;
      if (!isMutedRef.current) {
        setMode('listening');
        if (startListeningRef.current) startListeningRef.current();
      } else {
        setMode('idle');
      }
    };

    // --- PRIMARY: Edge-TTS Neural Audio via backend ---
    // Truncate to 600 chars max for voice — keeps synthesis fast on mobile networks.
    // The full text is already displayed on-screen; the voice only needs the key content.
    const voiceText = cleanText.length > 600
      ? cleanText.slice(0, 597) + '...'
      : cleanText;
    let ttsAudioUrl = null;
    try {
      const ttsTimeout = isGreeting ? 2500 : 10000;
      ttsAudioUrl = await fetchTextToSpeechAudio(voiceText, lang, ttsTimeout, { gender: voiceGender });
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
        URL.revokeObjectURL(ttsAudioUrl);
        if (playbackAudioRef.current === audio) playbackAudioRef.current = null;
        // On decode/playback failure, still open the echo window and release
        // the speaking state so the mic re-opens instead of being stuck until
        // the 10s safety timer.
        onSpeechFinished();
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
    // Create a fresh AbortController for this query so barge-in toggles
    // (stopAudio) can cancel the in-flight SSE stream instead of allowing
    // stale tokens to overwrite newer conversation turns.
    const queryAbortController = new AbortController();
    globalAbortControllerRef.current = queryAbortController;
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
        (finalText, finalSessionId, detectedLang) => {
          setAiText(finalText);
          setHistoryLogs(prev => [...prev, { user: q, ai: finalText }]);
          if (onMessageSent) onMessageSent();
          isProcessingRef.current = false;

          // Instant Mid-Call Language Switcher: update language to match user's spoken language
          let speakLang = currentLanguageRef.current;
          if (detectedLang && detectedLang !== currentLanguageRef.current) {
            currentLanguageRef.current = detectedLang;
            speakLang = detectedLang;
            if (onLanguageChange) onLanguageChange(detectedLang);
          }

          if (finalText && !isMutedRef.current) {
            speakAnswer(finalText, speakLang);
          } else {
            setMode('idle');
            if (!isMutedRef.current && startListeningRef.current) {
              startListeningRef.current();
            }
          }
          if (globalAbortControllerRef.current === queryAbortController) {
            globalAbortControllerRef.current = null;
          }
        },
        queryAbortController.signal
      );
    } catch (err) {
      // User triggered barge-in / tap-to-interrupt: the stream was intentionally
      // aborted via the AbortController. Do NOT fall through to the non-streaming
      // path — that would duplicate the query and overlap with the new user turn.
      if (err?.name === 'AbortError' || err?.code === 20) {
        console.log('[Voice] Stream aborted (barge-in/interrupt) — skipping fallback');
        if (globalAbortControllerRef.current === queryAbortController) {
          globalAbortControllerRef.current = null;
        }
        isProcessingRef.current = false;
        return;
      }
      console.warn('[Voice] Stream failed, trying non-stream:', err.message);
      if (globalAbortControllerRef.current === queryAbortController) {
        globalAbortControllerRef.current = null;
      }
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

  /* ── Languages routed to Groq Whisper ── */
  const GROQ_STT_LANGS = new Set(['en', 'hi', 'mr', 'kn', 'ta', 'te', 'bn', 'gu', 'ml', 'pa', 'auto']);

  /* ── Start speech recognition ── */
  const startListening = useCallback(() => {
    // Don't start Groq listening if speaking, processing, muted, or if Gemini Live is active
    if (isSpeakingRef.current || isProcessingRef.current || isMutedRef.current || liveSessionRef.current?.isConnected) return;

    const lang = currentLanguageRef.current || 'en';

    /* ─── PATH A: Groq Whisper via MediaRecorder (en / hi / mr / auto) ─── */
    if (GROQ_STT_LANGS.has(lang)) {
      stopRecognition();
      stopMediaRecorder();
      audioChunksRef.current = [];

      getEchoCancelledStream()
        .then(stream => {
          if (isSpeakingRef.current || isProcessingRef.current || isMutedRef.current) {
            stream.getTracks().forEach(t => t.stop());
            return;
          }

          vadStreamRef.current = stream;
          setMode('listening');

          // ── MediaRecorder: collect audio in 250 ms slices ──
          const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
            ? 'audio/webm;codecs=opus'
            : MediaRecorder.isTypeSupported('audio/webm')
            ? 'audio/webm'
            : MediaRecorder.isTypeSupported('audio/mp4')
            ? 'audio/mp4'
            : MediaRecorder.isTypeSupported('audio/aac')
            ? 'audio/aac'
            : '';
          const recorder = mimeType ? new MediaRecorder(stream, { mimeType }) : new MediaRecorder(stream);
          mediaRecorderRef.current = recorder;

          recorder.ondataavailable = e => {
            if (e.data && e.data.size > 0) audioChunksRef.current.push(e.data);
          };

          recorder.onstop = async () => {
            const chunks = audioChunksRef.current.slice();
            audioChunksRef.current = [];
            if (isSpeakingRef.current || isProcessingRef.current) return;
            if (chunks.length === 0) return;

            const blob = new Blob(chunks, { type: mimeType });
            if (blob.size < 500) return; // too short — ignore

            setInterimText('🎙️ Processing...');

            // Send to Groq Whisper
            const transcript = await sendAudioToGroqSTT(blob, lang);

            if (transcript && transcript.trim()) {
              // EchoGuard check
              if (isEcho(transcript.trim())) {
                setInterimText('');
                if (!isMutedRef.current && startListeningRef.current) startListeningRef.current();
                return;
              }
              setInterimText('');
              handleQuery(transcript.trim());
            } else {
              // Groq returned empty → fall back to Web Speech API for 1 attempt
              console.warn('[Groq STT] Empty transcript — falling back to WebSpeech');
              setInterimText('');
              startWebSpeechFallback();
            }
          };

          recorder.start(250); // 250 ms slices for responsive VAD

          // ── VAD: silence detection via AudioContext analyser ──
          try {
            const audioCtx  = new (window.AudioContext || window.webkitAudioContext)();
            const source    = audioCtx.createMediaStreamSource(stream);
            const analyser  = audioCtx.createAnalyser();
            analyser.fftSize = 512;
            source.connect(analyser);
            vadAnalyserRef.current = analyser;

            const dataArray   = new Uint8Array(analyser.frequencyBinCount);
            const SILENCE_MS  = 1200; // 1.2s quiet after speaking to submit
            let   speechDetected = false;
            let   silenceStart   = null;
            let   ambientSum     = 0;
            let   ambientCount   = 0;
            let   ambientFloor   = 2.0;
            const sampleStartTime = Date.now();

            const checkVAD = () => {
              if (!mediaRecorderRef.current || mediaRecorderRef.current.state === 'inactive') return;
              if (isSpeakingRef.current || isProcessingRef.current) return;

              analyser.getByteFrequencyData(dataArray);
              let maxVal = 0;
              let sum = 0;
              for (let i = 0; i < dataArray.length; i++) {
                if (dataArray[i] > maxVal) maxVal = dataArray[i];
                sum += dataArray[i];
              }
              const avg = sum / dataArray.length;

              // Sample ambient noise floor during first 200ms
              if (Date.now() - sampleStartTime < 200) {
                ambientSum += avg;
                ambientCount++;
                ambientFloor = Math.max(2.0, ambientSum / (ambientCount || 1));
                vadTimerRef.current = setTimeout(checkVAD, 40);
                return;
              }

              const dynamicSpeechThreshold = Math.max(7, ambientFloor * 2.2);

              // Dynamic Adaptive VAD (calibrated to current room noise floor)
              if (maxVal >= dynamicSpeechThreshold || avg >= ambientFloor * 1.5) {
                speechDetected = true;
                silenceStart   = null; // User actively speaking!
              } else if (speechDetected) {
                // User spoke and has now stopped
                if (!silenceStart) silenceStart = Date.now();
                if (Date.now() - silenceStart >= SILENCE_MS) {
                  // Speech segment completed — stop recording & send audio
                  if (mediaRecorderRef.current && mediaRecorderRef.current.state === 'recording') {
                    console.log(`[VAD] Speech segment complete (ambientFloor=${ambientFloor.toFixed(1)}) — auto-submitting`);
                    mediaRecorderRef.current.stop();
                    vadStreamRef.current?.getTracks().forEach(t => t.stop());
                  }
                  return; // stop polling
                }
              }

              vadTimerRef.current = setTimeout(checkVAD, 70);
            };

            checkVAD();
          } catch (vadErr) {
            console.warn('[VAD] AudioContext error:', vadErr.message);
          }

          // Safety: hard 12-second max recording cutoff for longer queries
          setTimeout(() => {
            if (mediaRecorderRef.current && mediaRecorderRef.current.state === 'recording') {
              console.log('[VAD] 12s max recording limit reached — submitting audio');
              mediaRecorderRef.current.stop();
              vadStreamRef.current?.getTracks().forEach(t => t.stop());
            }
          }, 12000);
        })
        .catch(err => {
          console.warn('[Groq STT] Mic access denied:', err.message);
          setPermError('Microphone permission required. Tap 🔒 in browser bar to allow.');
        });

      // Register restart ref so speakAnswer can re-open the mic after TTS
      startListeningRef.current = () => {
        if (isSpeakingRef.current || isProcessingRef.current || isMutedRef.current) return;
        startListening();
      };
      return; // Groq path handled
    }

    /* ─── PATH B: Web Speech API (kn / ta / te / bn / gu / pa — Phase 2 pending) ─── */
    startWebSpeechFallback();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [handleQuery, stopRecognition, stopMediaRecorder]);

  /* ── Web Speech API recognition — fallback + non-Groq languages ── */
  const startWebSpeechFallback = useCallback(() => {
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
      console.log('[Voice] WebSpeech fallback started — listening');
      setMode('listening');
    };

    recognition.onresult = (e) => {
      if (isSpeakingRef.current) {
        console.log('[WebSpeech] Voice barge-in triggered! Stopping AI audio playback.');
        stopAudio();
        isSpeakingRef.current = false;
        setMode('listening');
      }
      if (isProcessingRef.current) return;

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

        if (silenceTimerRef.current) clearTimeout(silenceTimerRef.current);
        silenceTimerRef.current = setTimeout(() => {
          const pending = latestTranscriptRef.current.trim();
          if (!pending || isProcessingRef.current || isSpeakingRef.current) return;
          if (isEcho(pending)) { latestTranscriptRef.current = ''; setInterimText(''); return; }
          latestTranscriptRef.current = '';
          setInterimText('');
          stopRecognition();
          handleQuery(pending);
        }, 1200); // increased from 800ms → more complete sentences
      }

      if (finalT.trim()) {
        const transcript = finalT.trim();
        if (isEcho(transcript)) { latestTranscriptRef.current = ''; setInterimText(''); return; }
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
        if (!isEcho(remaining)) { handleQuery(remaining); return; }
      }
      if (!isProcessingRef.current && !isMutedRef.current && !isSpeakingRef.current) setMode('idle');
    };

    recognition.onerror = (e) => {
      setInterimText('');
      if (e.error !== 'no-speech' && e.error !== 'aborted') {
        console.warn('[Voice] WebSpeech error:', e.error);
      }
      if (!isSpeakingRef.current && !isProcessingRef.current) setMode('idle');
    };

    recognitionRef.current = recognition;
    startListeningRef.current = () => {
      if (isSpeakingRef.current || isProcessingRef.current || isMutedRef.current) return;
      startListening();
    };

    try { recognition.start(); }
    catch (err) { console.warn('[Voice] Could not start WebSpeech:', err.message); }
  // eslint-disable-next-line react-hooks/exhaustive-deps
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
    setInterimText('');
    setPermError(null);
    latestTranscriptRef.current = '';
    setEchoSource('');

    // Pre-warm the backend so the first TTS call never hits a cold Render server.
    // Fire-and-forget — no await, no error handling needed.
    try {
      fetch(`${import.meta.env.VITE_API_BASE_URL || (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1' ? 'http://127.0.0.1:8000/api' : 'https://chatbot-324d.onrender.com/api')}/ping/`, {
        method: 'GET', cache: 'no-store'
      }).catch(() => {});
    } catch {}

    const greetingText = getGreetingText(currentLanguage, username);
    setAiText(greetingText);
    if (!activeSessionId) setHistoryLogs([]);

    // Initialize Gemini 2.5 Multimodal Live Session
    const session = new GeminiLiveSession({
      voiceGender: voiceGender,
      currentLanguage: currentLanguage,
      onSpeechStart: () => {
        isSpeakingRef.current = true;
        setInterimText('');
        setMode('speaking');
      },
      onSpeechEnd: () => {
        isSpeakingRef.current = false;
        if (!isMutedRef.current) setMode('listening');
      },
      onTextChunk: (text) => {
        setInterimText('');
        // Clean out any internal meta-thought markers if present
        const cleanChunk = (text || '').replace(/\*\*[^*]+\*\*/g, '').replace(/Initiating Search[^\n.]*/gi, '');
        if (cleanChunk) setAiText(prev => prev + cleanChunk);
      },
      onToolCall: () => {
        // Do NOT display internal background process logs in UI
      },
      onError: (err) => {
        console.warn('[GeminiLive] Error event:', err);
      },
      onClose: () => setIsLiveActive(false),
      onMicError: (msg) => {
        console.warn('[GeminiLive] Mic error:', msg);
        setPermError('Microphone permission required. Tap 🔒 in browser bar to allow.');
        setIsLiveActive(false);
      }
    });

    setMode('thinking');

    // Connect directly to Gemini 2.5 Multimodal Live API via WebSocket
    session.connect().then(connected => {
      if (connected && isOpen) {
        console.log('[GeminiLive] Native Voice-to-Voice active ✓');
        liveSessionRef.current = session;
        setIsLiveActive(true);
        setMode('listening');
        session.startMicStreaming();
      } else {
        console.warn('[GeminiLive] Native Voice-to-Voice connection failed');
        liveSessionRef.current = null;
        setIsLiveActive(false);
        setPermError('Failed to connect to Gemini 2.5 Live Voice Service. Check your GEMINI_API_KEY.');
        setMode('idle');
      }
    });

    return () => {
      if (liveSessionRef.current) {
        liveSessionRef.current.disconnect();
        liveSessionRef.current = null;
      }
      stopRecognition();
      stopMediaRecorder();
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
    setCurrentLanguage(code);
    currentLanguageRef.current = code;
    setIsLangMenuOpen(false);
    if (onLanguageChange) onLanguageChange(code);
    stopAudio();
    stopRecognition();
    const newGreeting = getGreetingText(code, username);
    setAiText(newGreeting);
    if (liveSessionRef.current) {
      // Re-send setup with new language to Gemini Live session
      try { liveSessionRef.current.sendSetup(liveSessionRef.current.config?.model || 'gemini-2.5-flash-native-audio-latest'); } catch {}
    }
  };

  const handleTypedSubmit = (e) => {
    e.preventDefault();
    unlockAudioContext();
    const q = inputText.trim();
    if (!q) return;
    setInputText('');
    if (liveSessionRef.current && liveSessionRef.current.isConnected) {
      // Direct text input over Gemini Live WebSocket realtimeInput
      setUserText(q);
      setMode('thinking');
      setAiText('');
      try {
        liveSessionRef.current.ws.send(JSON.stringify({
          realtimeInput: { text: q }
        }));
      } catch {}
    } else {
      handleQuery(q);
    }
  };

  const handleCardClick = (suggestion) => {
    unlockAudioContext();
    const q = (suggestion || '').trim();
    if (!q) return;

    if (liveSessionRef.current && liveSessionRef.current.isConnected) {
      // Direct input over Gemini Live WebSocket realtimeInput
      setUserText(q);
      setMode('thinking');
      setAiText('');
      try {
        liveSessionRef.current.ws.send(JSON.stringify({
          realtimeInput: { text: q }
        }));
      } catch (err) {
        console.warn('[GeminiLive] Failed to send card query:', err);
      }
    } else {
      handleQuery(q);
    }
  };

  const handleOrbClick = () => {
    unlockAudioContext();
    if (isSpeakingRef.current) {
      // Tap orb to barge in / interrupt speech instantly
      stopAudio();
      isSpeakingRef.current = false;
      isProcessingRef.current = false;
      setMode('listening');
    } else {
      isProcessingRef.current = false;
      if (isMutedRef.current) {
        isMutedRef.current = false;
        setIsMuted(false);
      }
      setMode('listening');
    }
  };

  const toggleMute = () => {
    if (isMuted) {
      setIsMuted(false);
      isMutedRef.current = false;
      stopAudio();
      setMode('listening');
    } else {
      setIsMuted(true);
      isMutedRef.current = true;
      stopAudio();
      stopRecognition();
      setMode('idle');
    }
  };

  const handleEndCall = useCallback(() => {
    console.log('[Voice] End Call clicked — stopping all audio playback immediately');
    if (liveSessionRef.current) {
      liveSessionRef.current.disconnect();
      liveSessionRef.current = null;
    }
    setIsLiveActive(false);
    isMutedRef.current = true;
    isSpeakingRef.current = false;
    isProcessingRef.current = false;
    if (speakingSafetyTimerRef.current) { clearTimeout(speakingSafetyTimerRef.current); speakingSafetyTimerRef.current = null; }
    stopAudio();
    stopRecognition();
    stopMediaRecorder();
    if (playbackAudioRef.current) {
      try {
        playbackAudioRef.current.pause();
        playbackAudioRef.current.currentTime = 0;
        playbackAudioRef.current.src = '';
      } catch {}
      playbackAudioRef.current = null;
    }
    try { if (window.speechSynthesis) window.speechSynthesis.cancel(); } catch {}
    onClose();
  }, [stopAudio, stopRecognition, stopMediaRecorder, onClose]);

  if (!isOpen) return null;

  const STATUS = {
    listening: { label: 'Listening',  hint: 'Speak now…' },
    thinking:  { label: 'Thinking',   hint: 'Processing your query…' },
    speaking:  { label: 'Speaking',   hint: 'Tap orb to interrupt' },
    idle:      { label: isMuted ? 'Muted' : 'Ready', hint: isMuted ? 'Tap unmute to speak' : 'Tap mic or speak' },
  };

  const selectedLangObj = VOICE_LANGUAGES.find(l => l.code === currentLanguage) || VOICE_LANGUAGES[0];

  return (
    <div className="gemini-live-screen" onClick={() => { setIsLangMenuOpen(false); handleEndCall(); }}>
      <div
        className="gemini-live-container"
        onClick={e => {
          e.stopPropagation();
          if (isSpeakingRef.current) {
            console.log('[ScreenBargeIn] User tapped screen while AI speaking — interrupting audio!');
            stopAudio();
            isSpeakingRef.current = false;
            isProcessingRef.current = false;
            setMode('listening');
            if (!isMutedRef.current) startListening();
          }
        }}
      >

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

          <div className="voice-header-actions">
            <button 
              className="gemini-live-home-btn" 
              onClick={() => {
                handleEndCall();
                if (onNewChat) onNewChat();
              }}
              title="Return to Home / New Chat"
              aria-label="Home / New Chat"
            >
              <PlusIcon />
              <span className="live-btn-label">New Chat</span>
            </button>
            <button className="gemini-live-close-btn" onClick={onClose} aria-label="Close JanSeva Live" title="Close Voice Mode">
              <CloseIcon />
            </button>
          </div>
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
                  onClick={() => handleCardClick(suggestion)}
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
          <button className="toolbar-btn end-btn" onClick={handleEndCall} aria-label="End session">
            <PhoneOffIcon />
            <span>End Live</span>
          </button>
        </footer>

      </div>
    </div>
  );

};

export default SiriVoiceModal;

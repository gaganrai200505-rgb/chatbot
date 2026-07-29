import React, { useState, useEffect, useRef, useCallback } from 'react';
import { sendChatMessage, fetchTextToSpeechAudio } from './api';

const LANG_LOCALE = { auto: 'en-IN', en: 'en-IN', hi: 'hi-IN', kn: 'kn-IN' };

/** Detect mobile browsers (Android + iOS) — Web Speech API is unreliable on mobile after async ops */
const isMobileBrowser = () => {
  if (typeof navigator === 'undefined') return false;
  return /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
};

/** Helper to find the best Realistic Gemini / Siri / Natural Neural voice for TTS */
const getRealisticVoice = (langCode) => {
  if (!window.speechSynthesis) return null;
  const voices = window.speechSynthesis.getVoices();
  if (!voices || voices.length === 0) return null;

  const targetPrefix = (LANG_LOCALE[langCode] || 'en-IN').split('-')[0].toLowerCase();

  // Priority ranking for realistic Male Neural voices (ChatGPT Onyx / Cove style)
  const preferredKeywords = [
    'microsoft christopher online (natural)',
    'microsoft guy online (natural)',
    'microsoft prabhat',
    'microsoft madhur',
    'microsoft gagan',
    'google us english male',
    'google uk english male',
    'rishi',
    'george',
    'alex',
    'guy',
    'male',
    'natural'
  ];

  // 1. Search for realistic neural voices matching locale
  for (const kw of preferredKeywords) {
    const match = voices.find(
      (v) => v.name.toLowerCase().includes(kw) && (v.lang.toLowerCase().includes(targetPrefix) || targetPrefix === 'en')
    );
    if (match) return match;
  }

  // 2. Filter by language prefix
  const langVoices = voices.filter((v) => v.lang.toLowerCase().startsWith(targetPrefix));
  
  // Prefer Google/Online high quality voices
  const googleVoice = langVoices.find((v) => v.name.toLowerCase().includes('google') || v.name.toLowerCase().includes('online'));
  if (googleVoice) return googleVoice;

  return langVoices[0] || voices.find((v) => v.lang.startsWith('en')) || voices[0] || null;
};

const SendIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none"
    stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <line x1="22" y1="2" x2="11" y2="13"/>
    <polygon points="22 2 15 22 11 13 2 9 22 2"/>
  </svg>
);

const CloseIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none"
    stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
    <line x1="18" y1="6" x2="6" y2="18"/>
    <line x1="6" y1="6" x2="18" y2="18"/>
  </svg>
);

const sanitizeForSpeech = (text, lang) => {
  if (!text) return '';
  let clean = text;

  // Remove URLs, Markdown formatting, headers, table pipes
  clean = clean.replace(/https?:\/\/\S+/g, '');
  clean = clean.replace(/\[([^\]]+)\]\([^)]+\)/g, '$1');
  clean = clean.replace(/\|/g, ' ');
  clean = clean.replace(/#{1,6}\s?/g, '');
  clean = clean.replace(/[*_~`]/g, '');

  // Normalize symbols to natural spoken words per language
  if (lang === 'kn') {
    clean = clean.replace(/₹\s*([\d,]+)/g, '$1 ರೂಪಾಯಿ');
    clean = clean.replace(/Rs\.?\s*([\d,]+)/gi, '$1 ರೂಪಾಯಿ');
    clean = clean.replace(/INR\s*([\d,]+)/gi, '$1 ರೂಪಾಯಿ');
    clean = clean.replace(/%/g, ' ಶೇಕಡಾ');
    clean = clean.replace(/(\d+)\s*-\s*(\d+)/g, '$1 ರಿಂದ $2');
  } else if (lang === 'hi') {
    clean = clean.replace(/₹\s*([\d,]+)/g, '$1 रुपये');
    clean = clean.replace(/Rs\.?\s*([\d,]+)/gi, '$1 रुपये');
    clean = clean.replace(/INR\s*([\d,]+)/gi, '$1 रुपये');
    clean = clean.replace(/%/g, ' प्रतिशत');
    clean = clean.replace(/(\d+)\s*-\s*(\d+)/g, '$1 से $2');
  } else {
    clean = clean.replace(/₹\s*([\d,]+)/g, '$1 Rupees');
    clean = clean.replace(/Rs\.?\s*([\d,]+)/gi, '$1 Rupees');
    clean = clean.replace(/%/g, ' percent');
    clean = clean.replace(/(\d+)\s*-\s*(\d+)/g, '$1 to $2');
  }

  return clean.replace(/\s+/g, ' ').trim();
};

/** Helper to detect if a mic transcript is feedback/echo from the AI's own audio speaker output */
const isSpeakerEcho = (transcript, aiText) => {
  if (!transcript || !aiText) return false;
  const cleanT = transcript.toLowerCase().replace(/[^\w\s]/g, '').trim();
  const cleanAI = aiText.toLowerCase().replace(/[^\w\s]/g, '').trim();
  if (!cleanT || !cleanAI) return false;

  // 1. Direct substring match (mic transcript is contained within AI spoken response)
  if (cleanAI.includes(cleanT)) return true;

  // 2. Word-overlap ratio (if > 40% of words match AI text, it's AI speaker echo)
  const tWords = cleanT.split(/\s+/).filter((w) => w.length > 2);
  if (tWords.length === 0) return false;

  let matchCount = 0;
  for (const word of tWords) {
    if (cleanAI.includes(word)) {
      matchCount++;
    }
  }

  return (matchCount / tWords.length) >= 0.40;
};

const SiriVoiceModal = ({ isOpen, onClose, language = 'en', selectedState = '', activeSessionId = '', onSessionStarted, onMessageSent }) => {
  // Mode: 'listening' | 'thinking' | 'speaking' | 'idle'
  const [mode, setMode] = useState('idle');
  const [userTranscript, setUserTranscript] = useState('');
  const [manualInput, setManualInput] = useState('');
  const [aiResponseText, setAiResponseText] = useState('');
  const [micPermissionError, setMicPermissionError] = useState(null);
  const isMobile = isMobileBrowser();

  const recognitionRef = useRef(null);
  const currentSessionIdRef = useRef(activeSessionId);
  const silenceTimerRef = useRef(null);
  const transcriptBoxRef = useRef(null);
  // Pre-created Audio element — kept alive so mobile browsers allow .play() after async ops
  const persistentAudioRef = useRef(new Audio());
  // Track if audio context has been unlocked by a user gesture
  const audioUnlockedRef = useRef(false);

  useEffect(() => {
    currentSessionIdRef.current = activeSessionId;
  }, [activeSessionId]);

  // Pre-warm WebSpeech Voices on mount
  useEffect(() => {
    if (window.speechSynthesis) {
      window.speechSynthesis.getVoices();
      window.speechSynthesis.onvoiceschanged = () => {
        window.speechSynthesis.getVoices();
      };
    }
  }, []);

  // Auto-scroll transcript box when messages update
  useEffect(() => {
    if (transcriptBoxRef.current) {
      transcriptBoxRef.current.scrollTop = transcriptBoxRef.current.scrollHeight;
    }
  }, [userTranscript, aiResponseText, mode]);

  // ESC key to close modal
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.key === 'Escape' && isOpen) {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  const audioRef = useRef(null);
  const isQueryExecutingRef = useRef(false);
  const isThinkingRef = useRef(false);
  const isOpenRef = useRef(isOpen);
  const startRecognitionRef = useRef(null);

  useEffect(() => {
    isOpenRef.current = isOpen;
  }, [isOpen]);

  // Unlock audio on first user interaction (required for iOS Safari autoplay)
  useEffect(() => {
    const unlock = () => {
      if (audioUnlockedRef.current) return;
      audioUnlockedRef.current = true;
      const a = persistentAudioRef.current;
      // Play a 0-length silent buffer to "unlock" audio on iOS
      a.src = 'data:audio/wav;base64,UklGRigAAABXQVZFZm10IBIAAAABAAEARKwAAIhYAQACABAAAABkYXRhAgAAAAEA';
      a.volume = 0;
      a.play().catch(() => {});
    };
    document.addEventListener('touchstart', unlock, { once: true, passive: true });
    document.addEventListener('click', unlock, { once: true });
    return () => {
      document.removeEventListener('touchstart', unlock);
      document.removeEventListener('click', unlock);
    };
  }, []);

  // Stop all active audio streams (both HTML5 Audio and WebSpeech API)
  const stopAllPlayback = useCallback(() => {
    const a = persistentAudioRef.current;
    try {
      a.pause();
      a.src = '';
    } catch (e) {}
    audioRef.current = null;
    if (window.speechSynthesis) {
      try { window.speechSynthesis.cancel(); } catch (e) {}
    }
  }, []);

  const fallbackWebSpeech = useCallback((cleanText) => {
    stopAllPlayback();
    if (!isOpenRef.current || !window.speechSynthesis) {
      setMode('listening');
      isThinkingRef.current = false;
      isQueryExecutingRef.current = false;
      return;
    }
    setMode('speaking');

    const utterance = new SpeechSynthesisUtterance(cleanText);
    const chosenVoice = getRealisticVoice(language);
    if (chosenVoice) utterance.voice = chosenVoice;
    utterance.lang = LANG_LOCALE[language] || 'en-IN';
    utterance.rate = 0.97;
    utterance.pitch = 1.05;

    utterance.onstart = () => {
      // ACTIVE BARGE-IN: Start mic listening as soon as fallback speech begins!
      isThinkingRef.current = false;
      if (isOpenRef.current) {
        startRecognitionRef.current?.();
      }
    };

    utterance.onend = () => {
      stopAllPlayback();
      isThinkingRef.current = false;
      isQueryExecutingRef.current = false;
      setUserTranscript('');
      setManualInput('');
      setMode('listening');
      startRecognitionRef.current?.();
    };

    utterance.onerror = () => {
      stopAllPlayback();
      isThinkingRef.current = false;
      isQueryExecutingRef.current = false;
      setUserTranscript('');
      setManualInput('');
      setMode('listening');
      startRecognitionRef.current?.();
    };

    window.speechSynthesis.speak(utterance);
  }, [language, stopAllPlayback]);

  /** Play audio blob URL using the persistent Audio element (survives mobile autoplay restrictions) */
  const playAudioUrl = useCallback(async (audioUrl) => {
    const audio = persistentAudioRef.current;
    audioRef.current = audio;

    audio.src = audioUrl;
    audio.volume = 1;

    audio.onplay = () => {
      isThinkingRef.current = false;
      if (isOpenRef.current) startRecognitionRef.current?.();
    };
    audio.onended = () => {
      URL.revokeObjectURL(audioUrl);
      audioRef.current = null;
      isThinkingRef.current = false;
      isQueryExecutingRef.current = false;
      setUserTranscript('');
      setManualInput('');
      setMode('listening');
      startRecognitionRef.current?.();
    };
    audio.onerror = () => {
      URL.revokeObjectURL(audioUrl);
      audioRef.current = null;
      isThinkingRef.current = false;
      isQueryExecutingRef.current = false;
      setUserTranscript('');
      setManualInput('');
      setMode('listening');
      startRecognitionRef.current?.();
    };

    try {
      await audio.play();
    } catch (e) {
      console.warn('[TTS] audio.play() was blocked:', e.message);
      // Final fallback: web speech
      fallbackWebSpeech(audio._cleanText || '');
    }
  }, [fallbackWebSpeech]);

  // High-Quality Neural TTS:
  //  - Mobile: backend edge-tts (neural, multilingual) via persistent Audio element
  //  - Desktop: browser WebSpeech API (instant, no latency)
  const speakSiriResponse = useCallback(async (text) => {
    const cleanText = sanitizeForSpeech(text, language);
    if (!cleanText || !isOpenRef.current) {
      setMode('listening');
      isQueryExecutingRef.current = false;
      return;
    }

    stopAllPlayback();
    setMode('speaking');

    if (isMobile) {
      // ── MOBILE PATH: Use backend neural TTS (edge-tts) ──
      // Mobile browsers block SpeechSynthesis.speak() after async operations.
      // Backend TTS via persistent Audio element works reliably on Android/iOS.
      try {
        const audioUrl = await fetchTextToSpeechAudio(cleanText, language, 8000);
        if (!isOpenRef.current) {
          if (audioUrl) URL.revokeObjectURL(audioUrl);
          stopAllPlayback();
          return;
        }
        if (audioUrl) {
          persistentAudioRef.current._cleanText = cleanText; // store for fallback
          await playAudioUrl(audioUrl);
          return;
        }
      } catch (e) {
        console.warn('[TTS Mobile] Backend TTS failed, trying WebSpeech:', e.message);
      }
      // Mobile fallback: attempt WebSpeech (may be silently blocked)
      fallbackWebSpeech(cleanText);
      return;
    }

    // ── DESKTOP PATH: Instant browser WebSpeech API (< 100ms latency) ──
    if (window.speechSynthesis) {
      fallbackWebSpeech(cleanText);
      return;
    }

    // Desktop fallback: backend TTS
    try {
      const audioUrl = await fetchTextToSpeechAudio(cleanText, language, 1800);
      if (!isOpenRef.current) {
        if (audioUrl) URL.revokeObjectURL(audioUrl);
        stopAllPlayback();
        return;
      }
      if (audioUrl) {
        await playAudioUrl(audioUrl);
        return;
      }
    } catch (e) {
      console.warn('[TTS Desktop] Backend TTS failed:', e.message);
    }

    setMode('listening');
    isQueryExecutingRef.current = false;
  }, [language, isMobile, stopAllPlayback, fallbackWebSpeech, playAudioUrl]);

  // Send User Query to Backend AI (Protected against duplicate concurrent execution)
  const handleUserQuery = useCallback(async (spokenQuery) => {
    const textToSend = (spokenQuery || manualInput || userTranscript).trim();
    if (!textToSend || textToSend.length < 2) return;

    // Lock execution synchronously — reject concurrent duplicate triggers
    if (isQueryExecutingRef.current) {
      console.log("[Voice] Skipping duplicate query trigger while query in progress.");
      return;
    }
    isQueryExecutingRef.current = true;
    isThinkingRef.current = true;

    // Stop recognition & existing audio immediately
    if (silenceTimerRef.current) clearTimeout(silenceTimerRef.current);
    if (recognitionRef.current) {
      try { recognitionRef.current.abort(); } catch (e) {}
    }
    stopAllPlayback();

    setUserTranscript(textToSend);
    setManualInput('');
    setMode('thinking');
    setAiResponseText('Just a sec...');

    try {
      const activeId = currentSessionIdRef.current || '';
      const result = await sendChatMessage(textToSend, language, activeId, selectedState, true);

      if (!currentSessionIdRef.current && result.session_id) {
        currentSessionIdRef.current = result.session_id;
        if (onSessionStarted) onSessionStarted(result.session_id);
      }

      if (onMessageSent) onMessageSent();

      const responseText = result.response || "I couldn't find a matching scheme response.";
      setAiResponseText(responseText);

      // Backend API call complete: release thinking state so recognition can restart
      isThinkingRef.current = false;
      isQueryExecutingRef.current = false;

      speakSiriResponse(responseText);
    } catch (err) {
      console.error("[Voice API Error]:", err);
      const errText = err.message || "Failed to connect to the server. Please check backend connection.";
      setAiResponseText(errText);
      isThinkingRef.current = false;
      isQueryExecutingRef.current = false;
      speakSiriResponse(errText);
    }
  }, [manualInput, userTranscript, language, selectedState, onSessionStarted, onMessageSent, speakSiriResponse, stopAllPlayback]);

  // Start Speech Recognition cleanly with adaptive silence grasping
  const startRecognition = useCallback(() => {
    if (!isOpenRef.current) return;

    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) {
      setMicPermissionError("Speech recognition is not supported in this browser. You can type below.");
      return;
    }

    try {
      if (recognitionRef.current) {
        try { recognitionRef.current.abort(); } catch (e) {}
        recognitionRef.current = null;
      }

      const recognition = new SR();
      recognition.lang = LANG_LOCALE[language] || 'en-US';
      recognition.interimResults = true;
      recognition.continuous = false;

      recognition.onstart = () => {
        setMicPermissionError(null);
      };

      recognition.onresult = (e) => {
        let fullTranscript = '';
        let hasFinalResult = false;

        for (let i = 0; i < e.results.length; ++i) {
          fullTranscript += e.results[i][0].transcript + ' ';
          if (e.results[i].isFinal) {
            hasFinalResult = true;
          }
        }

        const cleanTranscript = fullTranscript.trim();

        if (cleanTranscript) {
          const isAudioPlaying = (audioRef.current && !audioRef.current.paused) || (window.speechSynthesis && window.speechSynthesis.speaking);

          // ACOUSTIC ECHO SUPPRESSION: Ignore mic input if it's the AI's own speaker output!
          if (isAudioPlaying && isSpeakerEcho(cleanTranscript, aiResponseText)) {
            console.log("[Voice] Filtered out AI speaker echo from microphone input.");
            return;
          }

          // Genuine User Barge-In Interruption! Cut assistant audio immediately!
          if (isAudioPlaying) {
            console.log("[Voice Barge-In] User interrupted assistant speech! Cutting audio playback immediately.");
            stopAllPlayback();
            isQueryExecutingRef.current = false;
            setMode('listening');
          }

          setUserTranscript(cleanTranscript);
          setManualInput(cleanTranscript);

          if (silenceTimerRef.current) clearTimeout(silenceTimerRef.current);

          // Dynamic silence window: 200ms on final result, 450ms for interim
          const silenceDelay = hasFinalResult ? 200 : (cleanTranscript.length < 15 ? 550 : 450);

          silenceTimerRef.current = setTimeout(() => {
            try { recognition.stop(); } catch (err) {}
            handleUserQuery(cleanTranscript);
          }, silenceDelay);
        }
      };

      recognition.onerror = (e) => {
        console.warn("[Voice] Speech recognition error:", e.error);
        if (e.error === 'not-allowed' || e.error === 'service-not-allowed') {
          setMicPermissionError("Microphone access is blocked. Click the lock 🔒 icon in your browser address bar to allow microphone access.");
        } else if (e.error === 'audio-capture') {
          setMicPermissionError("No microphone detected or microphone is in use by another app.");
        } else if (e.error === 'no-speech') {
          // Normal silence, will auto-restart in onend
        } else if (e.error === 'network') {
          console.warn("[Voice] Network hiccup with speech recognition service.");
        }
      };

      recognition.onend = () => {
        recognitionRef.current = null;
        if (isOpenRef.current && !isThinkingRef.current) {
          setTimeout(() => {
            if (isOpenRef.current && !isThinkingRef.current) {
              startRecognitionRef.current?.();
            }
          }, 100);
        }
      };

      recognitionRef.current = recognition;
      recognition.start();
    } catch (err) {
      console.warn("SpeechRecognition start exception:", err);
    }
  }, [language, stopAllPlayback, handleUserQuery, aiResponseText]);

  useEffect(() => {
    startRecognitionRef.current = startRecognition;
  }, [startRecognition]);

  // Open / Close Lifecycle with explicit microphone permission request
  useEffect(() => {
    if (isOpen) {
      setUserTranscript('');
      setManualInput('');
      setAiResponseText('Hey there! I\'m listening — go ahead and ask me about any government scheme.');
      setMode('listening');
      setMicPermissionError(null);

      // Request browser microphone hardware permission explicitly
      if (navigator.mediaDevices && navigator.mediaDevices.getUserMedia) {
        navigator.mediaDevices.getUserMedia({ audio: true })
          .then((stream) => {
            stream.getTracks().forEach((t) => t.stop());
            setMicPermissionError(null);
            startRecognition();
          })
          .catch((err) => {
            console.warn("getUserMedia permission error:", err);
            setMicPermissionError("Microphone access is blocked or no microphone hardware was detected. Please click the lock 🔒 icon in your browser address bar to allow microphone access.");
          });
      } else {
        startRecognition();
      }
    } else {
      stopAllPlayback();
      isQueryExecutingRef.current = false;
      isThinkingRef.current = false;
      if (recognitionRef.current) {
        try { recognitionRef.current.abort(); } catch (e) {}
      }
      if (silenceTimerRef.current) clearTimeout(silenceTimerRef.current);
      setMode('idle');
    }

    return () => {
      stopAllPlayback();
      isQueryExecutingRef.current = false;
      isThinkingRef.current = false;
      if (recognitionRef.current) {
        try { recognitionRef.current.abort(); } catch (e) {}
      }
      if (silenceTimerRef.current) clearTimeout(silenceTimerRef.current);
    };
  }, [isOpen]);

  if (!isOpen) return null;

  return (
    <div className="siri-modal-backdrop" onClick={onClose}>
      <div className="siri-modal-card" onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div className="siri-header">
          <div className="siri-badge">
            <span className="siri-dot" />
            <span>JanSeva AI — Voice Mode ({language.toUpperCase()})</span>
          </div>
          <button className="siri-close-btn" onClick={onClose} title="Close Voice Mode (Esc)">
            <CloseIcon />
          </button>
        </div>

        {/* Central Siri 3D Glowing Orb Visualizer */}
        <div
          className="siri-orb-container"
          title={mode === 'speaking' ? "Tap to interrupt assistant speech" : "Listening to your voice..."}
          onClick={() => {
            if (mode === 'speaking') {
              stopAllPlayback();
              isQueryExecutingRef.current = false;
              setMode('listening');
            }
          }}
        >
          <div className={`siri-orb-glow ${mode}`} />
          <div className={`siri-orb ${mode}`}>
            <div className="siri-orb-core" />
            <div className="siri-orb-ring ring-1" />
            <div className="siri-orb-ring ring-2" />
            <div className="siri-orb-ring ring-3" />
          </div>
        </div>

        {/* Voice Status Indicator */}
        <div className="siri-status-text">
          {mode === 'listening' && "🎙️ Listening..."}
          {mode === 'thinking' && "💭 Just a sec..."}
          {mode === 'speaking' && "🔊 Speaking (Tap orb to interrupt)..."}
        </div>

        {/* Permission Banner Error */}
        {micPermissionError && (
          <div className="siri-error-banner">
            ⚠️ {micPermissionError}
          </div>
        )}

        {/* Live Conversation Transcript */}
        <div className="siri-transcript-box" ref={transcriptBoxRef}>
          {userTranscript && (
            <div className="siri-user-bubble">
              <span className="label">You:</span> "{userTranscript}"
            </div>
          )}
          {aiResponseText && (
            <div className="siri-ai-bubble">
              <span className="label">JanSeva AI:</span> {aiResponseText}
            </div>
          )}
        </div>

        {/* Fallback Text Input & Send */}
        <form
          className="siri-input-form"
          onSubmit={(e) => {
            e.preventDefault();
            handleUserQuery(manualInput);
          }}
        >
          <input
            type="text"
            className="siri-text-input"
            placeholder="Or type your question here..."
            value={manualInput}
            onChange={(e) => setManualInput(e.target.value)}
          />
          <button type="submit" className="siri-send-btn" disabled={!manualInput.trim()}>
            <SendIcon />
          </button>
        </form>

        {/* Footer Action — End Call */}
        <div className="siri-actions">
          <button className="siri-action-btn end-call" onClick={onClose}>
            End Voice Call
          </button>
        </div>
      </div>
    </div>
  );
};

export default SiriVoiceModal;

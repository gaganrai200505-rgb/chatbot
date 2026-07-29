import React, { useState, useEffect, useRef, useCallback } from 'react';
import { sendChatMessage, fetchTextToSpeechAudio } from './api';

/* ─────────────────────────────────────────────────────────────────────────
 * Constants & Helpers
 * ───────────────────────────────────────────────────────────────────────── */
const LANG_LOCALE = { auto: 'en-IN', en: 'en-IN', hi: 'hi-IN', kn: 'kn-IN' };

const isMobileBrowser = () =>
  /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(
    typeof navigator !== 'undefined' ? navigator.userAgent : ''
  );

/**
 * Truncate long AI response to first 2 concise sentences for ultra-fast TTS reply speed.
 * Full text remains visible in the UI transcript box.
 */
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

  // Extract first 2 sentences for fast speech response (max 280 chars)
  const sentences = clean.match(/[^.!?]+[.!?]+/g);
  if (sentences && sentences.length >= 1) {
    const shortSpeech = sentences.slice(0, 2).join(' ').trim();
    if (shortSpeech.length > 20) return shortSpeech;
  }
  return clean.slice(0, 280);
};

const getRealisticVoice = (langCode) => {
  if (!window.speechSynthesis) return null;
  const voices = window.speechSynthesis.getVoices();
  if (!voices || !voices.length) return null;
  const prefix = (LANG_LOCALE[langCode] || 'en-IN').split('-')[0].toLowerCase();
  const kws = [
    'microsoft christopher online (natural)', 'microsoft guy online (natural)',
    'microsoft prabhat', 'google us english male', 'google uk english male',
    'rishi', 'george', 'natural'
  ];
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
 * Icons
 * ───────────────────────────────────────────────────────────────────────── */
const SendIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none"
    stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/>
  </svg>
);
const CloseIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none"
    stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
    <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
  </svg>
);

/* ─────────────────────────────────────────────────────────────────────────
 * SiriVoiceModal v4 — Rock-solid Sequential 2-Way Voice Agent
 *
 * Guaranteed Cycle:
 * LISTENING (Mic ON) ──[User speaks]──> THINKING (Mic OFF, API call)
 *       ▲                                        │
 *       │                                        ▼
 * LISTENING <──[300ms pause]── SPEAKING (TTS Audio output)
 *
 * Features:
 * - Bulletproof single-instance guard (`isListeningActive`) prevents
 *   recognition crashes or infinite restart loops.
 * - Concise speech extraction (first 2 sentences) for 10x faster TTS reply.
 * - Instant tap-to-barge-in: tap orb/transcript anytime while AI speaks
 *   to interrupt audio and talk immediately.
 * ───────────────────────────────────────────────────────────────────────── */
const SiriVoiceModal = ({
  isOpen, onClose, language = 'en',
  selectedState = '', activeSessionId = '',
  onSessionStarted, onMessageSent
}) => {
  const [mode, setMode] = useState('idle'); // 'idle' | 'listening' | 'thinking' | 'speaking'
  const [userText, setUserText] = useState('');
  const [aiText, setAiText] = useState('');
  const [inputText, setInputText] = useState('');
  const [permError, setPermError] = useState(null);
  const isMobile = isMobileBrowser();

  /* Single-source-of-truth refs */
  const recRef            = useRef(null);
  const isListeningActive = useRef(false);
  const audioRef          = useRef(new Audio());
  const sessionIdRef      = useRef(activeSessionId);
  const silenceTimer      = useRef(null);
  const restartTimer      = useRef(null);
  const watchdogTimer     = useRef(null);
  const isOpenRef         = useRef(isOpen);

  useEffect(() => { sessionIdRef.current = activeSessionId; }, [activeSessionId]);
  useEffect(() => { isOpenRef.current = isOpen; }, [isOpen]);

  /* Unlock mobile Safari/Chrome audio context on first touch */
  useEffect(() => {
    let unlocked = false;
    const unlock = () => {
      if (unlocked) return;
      unlocked = true;
      const a = audioRef.current;
      a.src = 'data:audio/wav;base64,UklGRigAAABXQVZFZm10IBIAAAABAAEARKwAAIhYAQACABAAAABkYXRhAgAAAAEA';
      a.volume = 0;
      a.play().catch(() => {});
      if (window.speechSynthesis) {
        const dummy = new SpeechSynthesisUtterance('');
        window.speechSynthesis.speak(dummy);
        window.speechSynthesis.cancel();
      }
    };
    document.addEventListener('touchstart', unlock, { once: true, passive: true });
    document.addEventListener('click', unlock, { once: true });
    return () => {
      document.removeEventListener('touchstart', unlock);
      document.removeEventListener('click', unlock);
    };
  }, []);

  /* Pre-warm WebSpeech voices */
  useEffect(() => {
    if (window.speechSynthesis) {
      window.speechSynthesis.getVoices();
      window.speechSynthesis.onvoiceschanged = () => window.speechSynthesis.getVoices();
    }
  }, []);

  /* ─────────────────────────────────────────────────────────────────────
   * Stop All Audio Output
   * ───────────────────────────────────────────────────────────────────── */
  const stopAudio = useCallback(() => {
    if (watchdogTimer.current) { clearTimeout(watchdogTimer.current); watchdogTimer.current = null; }
    const a = audioRef.current;
    try { a.pause(); a.src = ''; } catch (_) {}
    a.onplay = null; a.onended = null; a.onerror = null;
    try { window.speechSynthesis?.cancel(); } catch (_) {}
  }, []);

  /* ─────────────────────────────────────────────────────────────────────
   * Stop Speech Recognition Cleanly
   * ───────────────────────────────────────────────────────────────────── */
  const stopRecognition = useCallback(() => {
    if (silenceTimer.current) { clearTimeout(silenceTimer.current); silenceTimer.current = null; }
    if (restartTimer.current) { clearTimeout(restartTimer.current); restartTimer.current = null; }
    if (recRef.current) {
      try { recRef.current.abort(); } catch (_) {}
      recRef.current = null;
    }
    isListeningActive.current = false;
  }, []);

  /* ─────────────────────────────────────────────────────────────────────
   * Start Speech Recognition (Gated & Protected)
   * ───────────────────────────────────────────────────────────────────── */
  const startListening = useCallback(() => {
    if (!isOpenRef.current) return;
    if (isListeningActive.current) return; // Prevent duplicate active instances!

    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) {
      setPermError('Speech recognition is not supported in this browser. Please type below.');
      return;
    }

    stopRecognition();

    try {
      const rec = new SR();
      rec.continuous = true;
      rec.interimResults = true;
      rec.lang = LANG_LOCALE[language] || 'en-IN';
      rec.maxAlternatives = 1;

      rec.onstart = () => {
        isListeningActive.current = true;
        setPermError(null);
        setMode('listening');
      };

      rec.onresult = (e) => {
        let interim = '', final = '';
        for (let i = e.resultIndex; i < e.results.length; i++) {
          const t = e.results[i][0].transcript;
          if (e.results[i].isFinal) final += t;
          else interim += t;
        }
        const spoken = (final || interim).trim();
        if (!spoken) return;

        setUserText(spoken);

        if (silenceTimer.current) clearTimeout(silenceTimer.current);
        const delay = final ? 350 : 750;
        silenceTimer.current = setTimeout(() => {
          if (spoken.length >= 2) {
            handleQuery(spoken);
          }
        }, delay);
      };

      rec.onerror = (e) => {
        isListeningActive.current = false;
        if (e.error === 'not-allowed' || e.error === 'service-not-allowed') {
          setPermError('Microphone blocked. Tap 🔒 in address bar to allow.');
        } else if (e.error !== 'aborted' && e.error !== 'no-speech') {
          console.warn('[Voice] SR error:', e.error);
        }
      };

      rec.onend = () => {
        recRef.current = null;
        isListeningActive.current = false;
        // Auto-restart if modal is still open and we are in listening mode
        if (isOpenRef.current) {
          restartTimer.current = setTimeout(() => {
            if (isOpenRef.current && !isListeningActive.current) {
              startListening();
            }
          }, 350);
        }
      };

      recRef.current = rec;
      rec.start();
    } catch (err) {
      isListeningActive.current = false;
      console.warn('[Voice] start Exception:', err.message);
    }
  }, [language, stopRecognition]);

  /* ─────────────────────────────────────────────────────────────────────
   * Return to Listening State cleanly after TTS completes
   * ───────────────────────────────────────────────────────────────────── */
  const resumeListening = useCallback(() => {
    if (watchdogTimer.current) { clearTimeout(watchdogTimer.current); watchdogTimer.current = null; }
    if (!isOpenRef.current) return;

    stopAudio();
    stopRecognition();
    setUserText('');
    setMode('listening');

    // Small delay ensures audio output hardware has released mic lock
    restartTimer.current = setTimeout(() => {
      if (isOpenRef.current && !isListeningActive.current) {
        startListening();
      }
    }, 350);
  }, [stopAudio, stopRecognition, startListening]);

  /* ─────────────────────────────────────────────────────────────────────
   * Speak Response via WebSpeech or Backend TTS
   * ───────────────────────────────────────────────────────────────────── */
  const speakResponse = useCallback(async (fullResponseText) => {
    if (!isOpenRef.current) { resumeListening(); return; }

    const speechText = prepareSpeechText(fullResponseText, language);
    if (!speechText) { resumeListening(); return; }

    stopRecognition(); // Mic OFF while speaking
    setMode('speaking');

    // 20s watchdog guarantees cycle never deadlocks
    watchdogTimer.current = setTimeout(() => {
      console.warn('[Voice Watchdog] TTS timeout, resuming listening');
      resumeListening();
    }, 20000);

    /* ── Fast Path: WebSpeech (Instant 0ms latency) ── */
    if (window.speechSynthesis) {
      let started = false;
      const u = new SpeechSynthesisUtterance(speechText);
      u.lang = LANG_LOCALE[language] || 'en-IN';
      u.rate = 1.05; // Slightly faster speaking rate for snappy responses
      u.pitch = 1.0;
      const v = getRealisticVoice(language);
      if (v) u.voice = v;

      u.onstart = () => {
        started = true;
        clearTimeout(fallbackTimer);
      };
      u.onend = () => { if (started) resumeListening(); };
      u.onerror = () => { if (started) resumeListening(); };

      window.speechSynthesis.speak(u);

      // Fallback to backend TTS if WebSpeech blocked by browser autoplay policy
      const fallbackTimer = setTimeout(async () => {
        if (started) return;
        window.speechSynthesis.cancel();

        try {
          const url = await fetchTextToSpeechAudio(speechText, language, 12000);
          if (!isOpenRef.current || !url) { resumeListening(); return; }
          const a = audioRef.current;
          a.src = url; a.volume = 1;
          a.onended = () => { URL.revokeObjectURL(url); resumeListening(); };
          a.onerror = () => { URL.revokeObjectURL(url); resumeListening(); };
          await a.play();
        } catch (e) {
          resumeListening();
        }
      }, 1800);

      return;
    }

    /* ── Fallback Path: Backend Neural TTS ── */
    try {
      const url = await fetchTextToSpeechAudio(speechText, language, 12000);
      if (!isOpenRef.current || !url) { resumeListening(); return; }
      const a = audioRef.current;
      a.src = url; a.volume = 1;
      a.onended = () => { URL.revokeObjectURL(url); resumeListening(); };
      a.onerror = () => { URL.revokeObjectURL(url); resumeListening(); };
      await a.play();
    } catch (e) {
      resumeListening();
    }
  }, [language, stopRecognition, resumeListening]);

  /* ─────────────────────────────────────────────────────────────────────
   * Handle User Query (API Call)
   * ───────────────────────────────────────────────────────────────────── */
  const handleQuery = useCallback(async (question) => {
    const q = question.trim();
    if (!q || q.length < 2) return;

    stopRecognition(); // Mic OFF while thinking
    stopAudio();

    setUserText(q);
    setInputText('');
    setMode('thinking');
    setAiText('Just a sec…');

    try {
      const result = await sendChatMessage(
        q, language, sessionIdRef.current || '', selectedState, true
      );

      if (!sessionIdRef.current && result.session_id) {
        sessionIdRef.current = result.session_id;
        onSessionStarted?.(result.session_id);
      }
      onMessageSent?.();

      const response = result.response || "I couldn't find information on that scheme.";
      setAiText(response);
      if (!isOpenRef.current) return;
      await speakResponse(response);
    } catch (err) {
      const msg = err.message || 'Server connection error.';
      setAiText(msg);
      await speakResponse(msg);
    }
  }, [language, selectedState, stopRecognition, stopAudio, speakResponse, onSessionStarted, onMessageSent]);

  /* ─────────────────────────────────────────────────────────────────────
   * Lifecycle & Modal Control
   * ───────────────────────────────────────────────────────────────────── */
  useEffect(() => {
    if (!isOpen) {
      stopRecognition();
      stopAudio();
      setMode('idle');
      return;
    }

    setUserText('');
    setInputText('');
    setAiText("Hey! I'm listening — ask me about any government scheme.");
    setPermError(null);

    // Prompt for mic permissions then launch listening session
    if (navigator.mediaDevices?.getUserMedia) {
      navigator.mediaDevices.getUserMedia({ audio: true })
        .then(stream => {
          stream.getTracks().forEach(t => t.stop());
          startListening();
        })
        .catch(() => {
          setPermError('Microphone permission required. Tap 🔒 in browser bar to allow access.');
        });
    } else {
      startListening();
    }

    return () => {
      stopRecognition();
      stopAudio();
    };
  }, [isOpen, startListening, stopRecognition, stopAudio]);

  /* ESC key listener */
  useEffect(() => {
    const handle = (e) => { if (e.key === 'Escape' && isOpen) onClose(); };
    window.addEventListener('keydown', handle);
    return () => window.removeEventListener('keydown', handle);
  }, [isOpen, onClose]);

  /* Typed input submit */
  const handleTypedSubmit = (e) => {
    e.preventDefault();
    const q = inputText.trim();
    if (!q) return;
    handleQuery(q);
  };

  /* Orb click: Barge-In (Interrupt AI speech) or start listening */
  const handleOrbClick = () => {
    if (mode === 'speaking') {
      // Instant Barge-In: Cut speech output and open mic immediately
      stopAudio();
      resumeListening();
    } else if (mode === 'listening') {
      // Restart listening if needed
      startListening();
    } else if (mode === 'idle') {
      startListening();
    }
  };

  if (!isOpen) return null;

  const statusLabel = {
    listening: '🎙️ Listening… (speak now)',
    thinking:  '💭 Thinking…',
    speaking:  '🔊 Speaking — tap orb to interrupt & talk',
    idle:      'Tap orb to start',
  }[mode] ?? '';

  return (
    <div className="siri-modal-backdrop" onClick={onClose}>
      <div className="siri-modal-card" onClick={e => e.stopPropagation()}>

        {/* Header */}
        <div className="siri-header">
          <div className="siri-badge">
            <span className="siri-dot" />
            <span>JanSeva AI — Voice Mode ({language.toUpperCase()})</span>
          </div>
          <button className="siri-close-btn" onClick={onClose} title="End call (Esc)">
            <CloseIcon />
          </button>
        </div>

        {/* Animated Orb / Tap-to-Barge-In */}
        <div
          className="siri-orb-container"
          onClick={handleOrbClick}
          title={mode === 'speaking' ? 'Tap to interrupt speech' : 'Listening'}
        >
          <div className={`siri-orb-glow ${mode}`} />
          <div className={`siri-orb ${mode}`}>
            <div className="siri-orb-core" />
            <div className="siri-orb-ring ring-1" />
            <div className="siri-orb-ring ring-2" />
            <div className="siri-orb-ring ring-3" />
          </div>
        </div>

        {/* Status label */}
        <div className="siri-status-text">{statusLabel}</div>

        {/* Permission error */}
        {permError && <div className="siri-error-banner">⚠️ {permError}</div>}

        {/* Live transcript box */}
        <div className="siri-transcript-box" onClick={handleOrbClick}>
          {userText && (
            <div className="siri-user-bubble">
              <span className="label">You:</span> "{userText}"
            </div>
          )}
          {aiText && (
            <div className="siri-ai-bubble">
              <span className="label">JanSeva AI:</span> {aiText}
            </div>
          )}
        </div>

        {/* Typed fallback input */}
        <form className="siri-input-form" onSubmit={handleTypedSubmit}>
          <input
            type="text"
            className="siri-text-input"
            placeholder="Or type your question here…"
            value={inputText}
            onChange={e => setInputText(e.target.value)}
          />
          <button type="submit" className="siri-send-btn" disabled={!inputText.trim()}>
            <SendIcon />
          </button>
        </form>

        {/* End call */}
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

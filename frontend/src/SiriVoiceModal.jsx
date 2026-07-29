import React, { useState, useEffect, useRef, useCallback } from 'react';
import { sendChatMessage, fetchTextToSpeechAudio } from './api';

/* ─────────────────────────────────────────────────────────────────────────────
 * Constants & helpers
 * ───────────────────────────────────────────────────────────────────────────── */

const LANG_LOCALE = { auto: 'en-IN', en: 'en-IN', hi: 'hi-IN', kn: 'kn-IN' };

const isMobileBrowser = () =>
  /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(
    typeof navigator !== 'undefined' ? navigator.userAgent : ''
  );

const sanitizeForSpeech = (text, lang) => {
  if (!text) return '';
  let c = text
    .replace(/https?:\/\/\S+/g, '')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/\|/g, ' ')
    .replace(/#{1,6}\s?/g, '')
    .replace(/[*_~`]/g, '');
  if (lang === 'kn') {
    c = c.replace(/₹\s*([\d,]+)/g, '$1 ರೂಪಾಯಿ').replace(/%/g, ' ಶೇಕಡಾ');
  } else if (lang === 'hi') {
    c = c.replace(/₹\s*([\d,]+)/g, '$1 रुपये').replace(/%/g, ' प्रतिशत');
  } else {
    c = c.replace(/₹\s*([\d,]+)/g, '$1 Rupees').replace(/%/g, ' percent');
  }
  return c.replace(/\s+/g, ' ').trim();
};

/** True if mic transcript is likely speaker echo of the AI's own voice */
const isSpeakerEcho = (transcript, aiText) => {
  if (!transcript || !aiText) return false;
  const t = transcript.toLowerCase().replace(/[^\w\s]/g, '').trim();
  const a = aiText.toLowerCase().replace(/[^\w\s]/g, '').trim();
  if (!t || !a) return false;
  if (a.includes(t)) return true;
  const words = t.split(/\s+/).filter(w => w.length > 2);
  if (!words.length) return false;
  return words.filter(w => a.includes(w)).length / words.length >= 0.4;
};

const getRealisticVoice = (langCode) => {
  if (!window.speechSynthesis) return null;
  const voices = window.speechSynthesis.getVoices();
  if (!voices.length) return null;
  const prefix = (LANG_LOCALE[langCode] || 'en-IN').split('-')[0].toLowerCase();
  const kws = ['microsoft christopher online (natural)', 'microsoft guy online (natural)',
    'microsoft prabhat', 'microsoft madhur', 'google us english male',
    'google uk english male', 'rishi', 'george', 'alex', 'natural'];
  for (const kw of kws) {
    const m = voices.find(v => v.name.toLowerCase().includes(kw) &&
      (v.lang.toLowerCase().startsWith(prefix) || prefix === 'en'));
    if (m) return m;
  }
  const lang = voices.filter(v => v.lang.toLowerCase().startsWith(prefix));
  return lang.find(v => v.name.toLowerCase().includes('google')) || lang[0] ||
    voices.find(v => v.lang.startsWith('en')) || voices[0] || null;
};

/* ─────────────────────────────────────────────────────────────────────────────
 * Micro icon components
 * ───────────────────────────────────────────────────────────────────────────── */
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

/* ─────────────────────────────────────────────────────────────────────────────
 * SiriVoiceModal — Claude-style always-on 2-way voice agent
 *
 * Conversation loop:
 *   LISTENING → user speaks → THINKING (AI API) → SPEAKING (TTS) → LISTENING
 *
 * On mobile: recognition is paused during TTS (hardware mic/speaker conflict).
 *            Recognition resumes 500ms after audio ends.
 * On desktop: recognition runs continuously even during WebSpeech TTS.
 * ───────────────────────────────────────────────────────────────────────────── */
const SiriVoiceModal = ({
  isOpen, onClose, language = 'en',
  selectedState = '', activeSessionId = '',
  onSessionStarted, onMessageSent
}) => {
  /* UI state */
  const [mode, setMode] = useState('idle');       // 'idle'|'listening'|'thinking'|'speaking'
  const [userText, setUserText] = useState('');   // what user said (interim + final)
  const [aiText, setAiText] = useState('');       // AI response text displayed
  const [inputText, setInputText] = useState(''); // typed fallback input
  const [permError, setPermError] = useState(null);
  const isMobile = isMobileBrowser();

  /* Refs — all mutable state that must NOT trigger re-renders */
  const recRef = useRef(null);             // SpeechRecognition instance
  const audioRef = useRef(new Audio());    // persistent Audio element (mobile TTS)
  const sessionIdRef = useRef(activeSessionId);
  const silenceTimer = useRef(null);
  const restartTimer = useRef(null);
  const isBusy = useRef(false);           // true while thinking OR speaking
  const isPlayingAudio = useRef(false);   // true while TTS audio is playing
  const aiTextRef = useRef('');           // mirror of aiText for echo detection in callbacks
  const isOpenRef = useRef(isOpen);

  useEffect(() => { sessionIdRef.current = activeSessionId; }, [activeSessionId]);
  useEffect(() => { isOpenRef.current = isOpen; }, [isOpen]);
  useEffect(() => { aiTextRef.current = aiText; }, [aiText]);

  /* ── Audio unlock (iOS Safari requires user gesture before first play) ── */
  useEffect(() => {
    let unlocked = false;
    const unlock = () => {
      if (unlocked) return;
      unlocked = true;
      const a = audioRef.current;
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

  /* ── Pre-warm WebSpeech voices on desktop ── */
  useEffect(() => {
    if (window.speechSynthesis) {
      window.speechSynthesis.getVoices();
      window.speechSynthesis.onvoiceschanged = () => window.speechSynthesis.getVoices();
    }
  }, []);

  /* ─────────────────────────────────────────────────────────────────────────
   * stopAudio — immediately cuts all TTS output
   * ───────────────────────────────────────────────────────────────────────── */
  const stopAudio = useCallback(() => {
    isPlayingAudio.current = false;
    const a = audioRef.current;
    try { a.pause(); a.src = ''; } catch (_) {}
    a.onplay = null; a.onended = null; a.onerror = null;
    if (window.speechSynthesis) {
      try { window.speechSynthesis.cancel(); } catch (_) {}
    }
  }, []);

  /* ─────────────────────────────────────────────────────────────────────────
   * stopRecognition — abort any active recognition
   * ───────────────────────────────────────────────────────────────────────── */
  const stopRecognition = useCallback(() => {
    if (silenceTimer.current) { clearTimeout(silenceTimer.current); silenceTimer.current = null; }
    if (restartTimer.current) { clearTimeout(restartTimer.current); restartTimer.current = null; }
    if (recRef.current) {
      try { recRef.current.abort(); } catch (_) {}
      recRef.current = null;
    }
  }, []);

  /* ─────────────────────────────────────────────────────────────────────────
   * handleQuery — send user question to AI, play TTS response, loop back
   * ───────────────────────────────────────────────────────────────────────── */
  const startListening = useCallback(() => {}, []); // forward ref — defined below

  const handleQuery = useCallback(async (question) => {
    const q = question.trim();
    if (!q || q.length < 2 || isBusy.current) return;

    isBusy.current = true;
    stopRecognition();
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
      aiTextRef.current = response;

      if (!isOpenRef.current) { isBusy.current = false; return; }

      /* ── Speak the response ── */
      await speakResponse(response);

    } catch (err) {
      const msg = err.message || 'Server connection failed.';
      setAiText(msg);
      aiTextRef.current = msg;
      await speakResponse(msg);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [language, selectedState, stopAudio, stopRecognition]);

  /* ─────────────────────────────────────────────────────────────────────────
   * speakResponse — TTS then auto-resume listening
   * Mobile: backend edge-tts via persistent Audio element
   * Desktop: browser WebSpeech API
   * ───────────────────────────────────────────────────────────────────────── */
  const speakResponse = useCallback(async (text) => {
    if (!isOpenRef.current) { isBusy.current = false; return; }

    const clean = sanitizeForSpeech(text, language);
    setMode('speaking');
    isPlayingAudio.current = true;

    const resumeListening = () => {
      if (!isOpenRef.current) return;
      isBusy.current = false;
      isPlayingAudio.current = false;
      setMode('listening');
      setUserText('');
      // Give audio hardware time to switch from playback to capture on mobile
      const delay = isMobile ? 500 : 100;
      restartTimer.current = setTimeout(() => {
        if (isOpenRef.current && !isBusy.current) {
          startListeningRef.current?.();
        }
      }, delay);
    };

    /* ── MOBILE: backend neural TTS ── */
    if (isMobile) {
      if (!clean) { resumeListening(); return; }
      try {
        const url = await fetchTextToSpeechAudio(clean, language, 15000);
        if (!isOpenRef.current) { if (url) URL.revokeObjectURL(url); isBusy.current = false; return; }
        if (url) {
          const a = audioRef.current;
          a.src = url;
          a.volume = 1;
          a.onended = () => { URL.revokeObjectURL(url); resumeListening(); };
          a.onerror = () => { URL.revokeObjectURL(url); resumeListening(); };
          a.onplay = null;
          try {
            await a.play();
            return;
          } catch (e) {
            console.warn('[TTS] play() blocked:', e.message);
            URL.revokeObjectURL(url);
          }
        }
      } catch (e) {
        console.warn('[TTS Mobile] failed:', e.message);
      }
      // Mobile fallback: WebSpeech (may be silent but at least resumes listening)
      if (!clean || !window.speechSynthesis) { resumeListening(); return; }
      const u = new SpeechSynthesisUtterance(clean);
      u.lang = LANG_LOCALE[language] || 'en-IN';
      const v = getRealisticVoice(language);
      if (v) u.voice = v;
      u.onend = resumeListening;
      u.onerror = resumeListening;
      window.speechSynthesis.speak(u);
      return;
    }

    /* ── DESKTOP: WebSpeech API ── */
    if (!clean || !window.speechSynthesis) { resumeListening(); return; }
    const u = new SpeechSynthesisUtterance(clean);
    u.lang = LANG_LOCALE[language] || 'en-IN';
    u.rate = 0.97; u.pitch = 1.05;
    const v = getRealisticVoice(language);
    if (v) u.voice = v;

    // On desktop, recognition can run alongside WebSpeech (echo cancellation handles it)
    u.onstart = () => {
      if (isOpenRef.current && !isMobile) startListeningRef.current?.();
    };
    u.onend = resumeListening;
    u.onerror = resumeListening;
    window.speechSynthesis.speak(u);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [language, isMobile]);

  /* ─────────────────────────────────────────────────────────────────────────
   * startListening — create & start a continuous SpeechRecognition session
   *
   * continuous = true  → browser keeps session alive; no repeated start/stop loops
   * interimResults = true → see user's words in real-time
   *
   * Auto-restarts on unexpected onend (60-second Chrome timeout, network drop)
   * ───────────────────────────────────────────────────────────────────────── */
  const startListeningFn = useCallback(() => {
    if (!isOpenRef.current || isBusy.current || isPlayingAudio.current) return;

    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) {
      setPermError('Speech recognition is not supported in this browser. Please type your question below.');
      return;
    }

    // Clean up previous instance
    if (recRef.current) {
      try { recRef.current.abort(); } catch (_) {}
      recRef.current = null;
    }

    const rec = new SR();
    rec.continuous = true;        // ← key for Claude-style always-on listening
    rec.interimResults = true;    // ← real-time transcript display
    rec.lang = LANG_LOCALE[language] || 'en-IN';

    rec.onstart = () => {
      setPermError(null);
      setMode('listening');
    };

    rec.onresult = (e) => {
      if (isBusy.current) return; // processing or speaking — ignore input

      let interim = '', final = '';
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const t = e.results[i][0].transcript;
        if (e.results[i].isFinal) final += t;
        else interim += t;
      }

      const spoken = (final || interim).trim();
      if (!spoken) return;

      // ── Barge-in: user speaks while AI is talking ──
      if (isPlayingAudio.current || window.speechSynthesis?.speaking) {
        // If it's echo of what AI just said, ignore
        if (isSpeakerEcho(spoken, aiTextRef.current)) return;
        // Genuine barge-in → cut AI speech immediately
        stopAudio();
        isPlayingAudio.current = false;
        isBusy.current = false;
      }

      // Show live transcript
      setUserText(spoken);

      // Reset silence timer on every result
      if (silenceTimer.current) clearTimeout(silenceTimer.current);

      // Fire query after silence: 500ms after final result, 900ms after interim
      const delay = final ? 500 : 900;
      silenceTimer.current = setTimeout(() => {
        if (!isBusy.current && spoken.length >= 2) {
          handleQuery(spoken);
        }
      }, delay);
    };

    rec.onerror = (e) => {
      if (e.error === 'not-allowed' || e.error === 'service-not-allowed') {
        setPermError('Microphone access is blocked. Tap the lock 🔒 in your browser bar to allow it.');
      } else if (e.error === 'audio-capture') {
        // Mic busy (e.g. just after speaker audio) — will retry in onend
        console.warn('[Voice] audio-capture: mic busy, will retry');
      } else if (e.error === 'aborted') {
        // Normal — we called abort() ourselves
      } else if (e.error === 'no-speech') {
        // Fine — silence, auto-continues
      } else {
        console.warn('[Voice] recognition error:', e.error);
      }
    };

    rec.onend = () => {
      recRef.current = null;
      // Auto-restart the session (handles Chrome's 60s mobile timeout, network drops)
      if (isOpenRef.current && !isBusy.current && !isPlayingAudio.current) {
        restartTimer.current = setTimeout(() => {
          if (isOpenRef.current && !isBusy.current && !isPlayingAudio.current) {
            startListeningRef.current?.();
          }
        }, 400);
      }
    };

    recRef.current = rec;
    try { rec.start(); } catch (err) {
      console.warn('[Voice] start() failed:', err.message);
    }
  }, [language, stopAudio, handleQuery]);

  /* Keep a stable ref to startListeningFn so callbacks can call latest version */
  const startListeningRef = useRef(startListeningFn);
  useEffect(() => { startListeningRef.current = startListeningFn; }, [startListeningFn]);

  /* ─────────────────────────────────────────────────────────────────────────
   * Modal open / close lifecycle
   * ───────────────────────────────────────────────────────────────────────── */
  useEffect(() => {
    if (!isOpen) {
      stopRecognition();
      stopAudio();
      isBusy.current = false;
      isPlayingAudio.current = false;
      setMode('idle');
      return;
    }

    // Reset state
    setUserText('');
    setInputText('');
    setAiText('Hey! I\'m listening — ask me about any government scheme.');
    setPermError(null);
    isBusy.current = false;
    isPlayingAudio.current = false;
    setMode('listening');

    // Request mic permission, then start listening
    if (navigator.mediaDevices?.getUserMedia) {
      navigator.mediaDevices.getUserMedia({ audio: true })
        .then(stream => {
          stream.getTracks().forEach(t => t.stop());
          startListeningRef.current?.();
        })
        .catch(err => {
          console.warn('[Voice] getUserMedia error:', err);
          setPermError('Microphone access is required. Tap the lock icon in your browser bar to allow it.');
        });
    } else {
      startListeningRef.current?.();
    }

    return () => {
      stopRecognition();
      stopAudio();
      isBusy.current = false;
      isPlayingAudio.current = false;
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen]);

  /* ESC key to close */
  useEffect(() => {
    const handle = (e) => { if (e.key === 'Escape' && isOpen) onClose(); };
    window.addEventListener('keydown', handle);
    return () => window.removeEventListener('keydown', handle);
  }, [isOpen, onClose]);

  /* ── Typed input submit ── */
  const handleTypedSubmit = (e) => {
    e.preventDefault();
    const q = inputText.trim();
    if (!q) return;
    stopRecognition();
    handleQuery(q);
  };

  /* ── Orb click: barge-in or manual start ── */
  const handleOrbClick = () => {
    if (mode === 'speaking') {
      // Barge-in: cut AI speech, go back to listening
      stopAudio();
      isBusy.current = false;
      setMode('listening');
      startListeningRef.current?.();
    } else if (mode === 'idle') {
      startListeningRef.current?.();
    }
  };

  if (!isOpen) return null;

  const statusLabel = {
    listening: '🎙️ Listening…',
    thinking:  '💭 Thinking…',
    speaking:  '🔊 Speaking  —  tap orb to interrupt',
    idle:      'Tap the orb to start',
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

        {/* Animated Orb */}
        <div
          className="siri-orb-container"
          title={mode === 'speaking' ? 'Tap to interrupt' : 'Listening…'}
          onClick={handleOrbClick}
        >
          <div className={`siri-orb-glow ${mode}`} />
          <div className={`siri-orb ${mode}`}>
            <div className="siri-orb-core" />
            <div className="siri-orb-ring ring-1" />
            <div className="siri-orb-ring ring-2" />
            <div className="siri-orb-ring ring-3" />
          </div>
        </div>

        {/* Status */}
        <div className="siri-status-text">{statusLabel}</div>

        {/* Permission error */}
        {permError && (
          <div className="siri-error-banner">⚠️ {permError}</div>
        )}

        {/* Live conversation transcript */}
        <div className="siri-transcript-box">
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

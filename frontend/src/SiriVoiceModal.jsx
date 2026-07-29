import React, { useState, useEffect, useRef, useCallback } from 'react';
import { sendChatMessage, fetchTextToSpeechAudio } from './api';

/* ─────────────────────────────────────────────────────────────────────────
 * Constants & helpers
 * ───────────────────────────────────────────────────────────────────────── */
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
  return c.replace(/\s+/g, ' ').trim().slice(0, 800); // cap TTS length
};

/** Returns true if the mic transcript is likely echo of the AI's own speaker */
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
 * SiriVoiceModal v3 — Claude-style always-on 2-way voice agent
 *
 * FIXED BUGS vs v2:
 *  1. Barge-in: onresult checks isAudioPlaying BEFORE isBusy guard.
 *     Previously isBusy=true caused early return, so barge-in was never reached.
 *  2. Loop: startListeningFn no longer blocks on isBusy/isPlayingAudio.
 *     Previously it returned immediately when called during TTS, killing the loop.
 *  3. Loop: 25s watchdog in speakResponse guarantees resumeListening always fires.
 *  4. Speed: WebSpeech tried first (instant). Backend TTS only if WS blocked (2.5s).
 * ───────────────────────────────────────────────────────────────────────── */
const SiriVoiceModal = ({
  isOpen, onClose, language = 'en',
  selectedState = '', activeSessionId = '',
  onSessionStarted, onMessageSent
}) => {
  const [mode, setMode] = useState('idle');
  const [userText, setUserText] = useState('');
  const [aiText, setAiText] = useState('');
  const [inputText, setInputText] = useState('');
  const [permError, setPermError] = useState(null);
  const isMobile = isMobileBrowser();

  /* Stable refs — never cause re-renders */
  const recRef       = useRef(null);
  const audioRef     = useRef(new Audio());
  const sessionIdRef = useRef(activeSessionId);
  const silenceTimer = useRef(null);
  const restartTimer = useRef(null);
  const watchdogRef  = useRef(null);
  const isBusy       = useRef(false);   // true while calling AI API
  const isPlaying    = useRef(false);   // true while TTS audio is playing
  const aiTextRef    = useRef('');
  const isOpenRef    = useRef(isOpen);
  const startListeningRef = useRef(null); // forward ref

  useEffect(() => { sessionIdRef.current = activeSessionId; }, [activeSessionId]);
  useEffect(() => { isOpenRef.current = isOpen; }, [isOpen]);
  useEffect(() => { aiTextRef.current = aiText; }, [aiText]);

  /* ── Unlock audio context on first touch (iOS Safari requirement) ── */
  useEffect(() => {
    let unlocked = false;
    const unlock = () => {
      if (unlocked) return;
      unlocked = true;
      const a = audioRef.current;
      a.src = 'data:audio/wav;base64,UklGRigAAABXQVZFZm10IBIAAAABAAEARKwAAIhYAQACABAAAABkYXRhAgAAAAEA';
      a.volume = 0;
      a.play().catch(() => {});
      // Pre-warm speechSynthesis so async calls work on mobile
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

  /* Pre-warm voice list on desktop */
  useEffect(() => {
    if (window.speechSynthesis) {
      window.speechSynthesis.getVoices();
      window.speechSynthesis.onvoiceschanged = () => window.speechSynthesis.getVoices();
    }
  }, []);

  /* ─────────────────────────────────────────────────────────────────────
   * stopAudio — cut all TTS output immediately
   * ───────────────────────────────────────────────────────────────────── */
  const stopAudio = useCallback(() => {
    isPlaying.current = false;
    if (watchdogRef.current) { clearTimeout(watchdogRef.current); watchdogRef.current = null; }
    const a = audioRef.current;
    try { a.pause(); a.src = ''; } catch (_) {}
    a.onplay = null; a.onended = null; a.onerror = null;
    try { window.speechSynthesis?.cancel(); } catch (_) {}
  }, []);

  /* ─────────────────────────────────────────────────────────────────────
   * stopRecognition — abort active mic session
   * ───────────────────────────────────────────────────────────────────── */
  const stopRecognition = useCallback(() => {
    if (silenceTimer.current) { clearTimeout(silenceTimer.current); silenceTimer.current = null; }
    if (restartTimer.current) { clearTimeout(restartTimer.current); restartTimer.current = null; }
    if (recRef.current) {
      try { recRef.current.abort(); } catch (_) {}
      recRef.current = null;
    }
  }, []);

  /* ─────────────────────────────────────────────────────────────────────
   * resumeListening — called after TTS ends; restarts the mic loop
   * ───────────────────────────────────────────────────────────────────── */
  const resumeListening = useCallback(() => {
    if (watchdogRef.current) { clearTimeout(watchdogRef.current); watchdogRef.current = null; }
    if (!isOpenRef.current) return;
    isBusy.current = false;
    isPlaying.current = false;
    setMode('listening');
    setUserText('');
    // Give mobile hardware time to switch from speaker to mic
    const delay = isMobile ? 600 : 150;
    restartTimer.current = setTimeout(() => {
      if (isOpenRef.current) startListeningRef.current?.();
    }, delay);
  }, [isMobile]);

  /* ─────────────────────────────────────────────────────────────────────
   * speakResponse — TTS output, then auto-resume listening
   *
   * SPEED STRATEGY:
   *   1. Try WebSpeech first (instant, 0ms latency) on ALL platforms
   *   2. WebSpeech has 2.5s to fire onstart — if it doesn't, cancel and
   *      fall back to backend neural TTS (5-15s but better quality)
   *
   * WATCHDOG: 25s maximum — guarantees resumeListening() always fires
   *   even if both TTS paths fail silently (e.g. blocked autoplay).
   * ───────────────────────────────────────────────────────────────────── */
  const speakResponse = useCallback(async (text) => {
    if (!isOpenRef.current) { resumeListening(); return; }
    const clean = sanitizeForSpeech(text, language);
    if (!clean) { resumeListening(); return; }

    setMode('speaking');
    isPlaying.current = true;

    // Safety watchdog: force resumeListening after 25s no matter what
    watchdogRef.current = setTimeout(() => {
      console.warn('[Voice Watchdog] TTS timed out, forcing loop continuation');
      stopAudio();
      resumeListening();
    }, 25000);

    /* ── Fast path: Try WebSpeech (instant) ── */
    if (window.speechSynthesis) {
      let wsStarted = false;
      const u = new SpeechSynthesisUtterance(clean);
      u.lang = LANG_LOCALE[language] || 'en-IN';
      u.rate = 0.97; u.pitch = 1.05;
      const v = getRealisticVoice(language);
      if (v) u.voice = v;

      u.onstart = () => {
        wsStarted = true;
        clearTimeout(wsFallbackTimer);
        // On desktop: start listening for barge-in as soon as AI starts speaking
        if (!isMobile) startListeningRef.current?.();
      };
      u.onend = () => { if (wsStarted) resumeListening(); };
      u.onerror = (e) => {
        if (wsStarted) resumeListening();
        // if not started, fallback timer handles it
      };

      window.speechSynthesis.speak(u);

      // If WebSpeech hasn't started within 2.5s (blocked by autoplay policy on mobile),
      // cancel it and fall back to backend neural TTS
      const wsFallbackTimer = setTimeout(async () => {
        if (wsStarted) return; // WebSpeech is working fine
        console.warn('[Voice] WebSpeech blocked, falling back to backend TTS');
        window.speechSynthesis.cancel();

        /* ── Slow path: Backend neural TTS (better quality, ~5-15s) ── */
        try {
          const url = await fetchTextToSpeechAudio(clean, language, 15000);
          if (!isOpenRef.current) { if (url) URL.revokeObjectURL(url); resumeListening(); return; }
          if (!url) { resumeListening(); return; }

          const a = audioRef.current;
          a.src = url; a.volume = 1;
          a.onplay = null;
          a.onended = () => { URL.revokeObjectURL(url); resumeListening(); };
          a.onerror = () => { URL.revokeObjectURL(url); resumeListening(); };
          try { await a.play(); }
          catch (e) { console.warn('[TTS] play() blocked:', e.message); resumeListening(); }
        } catch (e) {
          console.warn('[TTS Backend] failed:', e.message);
          resumeListening();
        }
      }, 2500);

      return;
    }

    /* ── No WebSpeech at all: direct backend TTS ── */
    try {
      const url = await fetchTextToSpeechAudio(clean, language, 15000);
      if (!isOpenRef.current) { if (url) URL.revokeObjectURL(url); resumeListening(); return; }
      if (!url) { resumeListening(); return; }

      const a = audioRef.current;
      a.src = url; a.volume = 1;
      a.onplay = null;
      a.onended = () => { URL.revokeObjectURL(url); resumeListening(); };
      a.onerror = () => { URL.revokeObjectURL(url); resumeListening(); };
      try { await a.play(); }
      catch (e) { resumeListening(); }
    } catch (e) {
      resumeListening();
    }
  }, [language, isMobile, stopAudio, resumeListening]);

  /* ─────────────────────────────────────────────────────────────────────
   * handleQuery — send question to AI, speak response
   * ───────────────────────────────────────────────────────────────────── */
  const handleQuery = useCallback(async (question) => {
    const q = question.trim();
    if (!q || q.length < 2) return;
    if (isBusy.current) return;

    isBusy.current = true;
    if (silenceTimer.current) { clearTimeout(silenceTimer.current); silenceTimer.current = null; }
    stopAudio();
    // Stop recognition during API call (not during TTS — we need it for barge-in)
    stopRecognition();

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
      const response = result.response || "Sorry, I couldn't find information on that.";
      setAiText(response);
      aiTextRef.current = response;
      if (!isOpenRef.current) { isBusy.current = false; return; }
      await speakResponse(response);
    } catch (err) {
      const msg = err.message || 'Server connection failed.';
      setAiText(msg);
      aiTextRef.current = msg;
      await speakResponse(msg);
    }
  }, [language, selectedState, stopAudio, stopRecognition, speakResponse,
      onSessionStarted, onMessageSent]);

  /* ─────────────────────────────────────────────────────────────────────
   * startListeningFn — create / restart a continuous recognition session
   *
   * KEY FIX: No longer blocks on isBusy or isPlaying.
   *   This allows recognition to run alongside TTS for barge-in detection.
   *   The onresult handler safely ignores non-barge-in results when busy.
   * ───────────────────────────────────────────────────────────────────── */
  const startListeningFn = useCallback(() => {
    if (!isOpenRef.current) return;

    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) {
      setPermError('Speech recognition is not supported. Please type below.');
      return;
    }

    // Clean up previous instance
    if (recRef.current) {
      try { recRef.current.abort(); } catch (_) {}
      recRef.current = null;
    }

    const rec = new SR();
    rec.continuous = true;
    rec.interimResults = true;
    rec.lang = LANG_LOCALE[language] || 'en-IN';
    rec.maxAlternatives = 1;

    rec.onstart = () => {
      setPermError(null);
      if (!isBusy.current && !isPlaying.current) setMode('listening');
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

      /* ── BARGE-IN CHECK: runs even when isBusy=true ──────────────────
       * This is the key fix. Previously `if (isBusy.current) return`
       * was at the top, so this code was NEVER reached during TTS.
       * ────────────────────────────────────────────────────────────────── */
      const aiSpeaking = isPlaying.current || window.speechSynthesis?.speaking;
      if (aiSpeaking) {
        // Filter out AI speaker echo picked up by mic
        if (isSpeakerEcho(spoken, aiTextRef.current)) return;
        // Genuine barge-in: user interrupting AI speech
        console.log('[Voice Barge-In] User interrupted AI. Cutting audio.');
        stopAudio();
        isPlaying.current = false;
        isBusy.current = false;
      }

      // If still processing an API call (not playing TTS), don't queue another query
      if (isBusy.current) return;

      // Show live transcript
      setUserText(spoken);
      if (!isBusy.current && !aiSpeaking) setMode('listening');

      // Fire query after silence
      if (silenceTimer.current) clearTimeout(silenceTimer.current);
      const delay = final ? 400 : 850;
      silenceTimer.current = setTimeout(() => {
        if (!isBusy.current && spoken.length >= 2) {
          handleQuery(spoken);
        }
      }, delay);
    };

    rec.onerror = (e) => {
      if (e.error === 'not-allowed' || e.error === 'service-not-allowed') {
        setPermError('Microphone blocked. Tap 🔒 in your browser bar to allow access.');
      } else if (e.error === 'audio-capture') {
        // Mic busy (usually during mobile playback) — onend will retry
        console.warn('[Voice] Mic busy (audio-capture), will retry after delay');
      } else if (e.error === 'aborted' || e.error === 'no-speech') {
        // Normal — no action needed
      } else {
        console.warn('[Voice] Recognition error:', e.error);
      }
    };

    rec.onend = () => {
      recRef.current = null;
      // Auto-restart session (handles Chrome's 60s mobile timeout and network drops)
      // NOTE: We restart even during TTS (isPlaying=true) for barge-in detection
      //       on desktop. On mobile, audio-capture errors will occur but that's OK —
      //       they're silently handled above and trigger another onend → retry.
      restartTimer.current = setTimeout(() => {
        if (isOpenRef.current) startListeningRef.current?.();
      }, 400);
    };

    recRef.current = rec;
    try { rec.start(); } catch (err) {
      console.warn('[Voice] start() failed:', err.message);
    }
  }, [language, stopAudio, handleQuery]);

  // Keep ref always pointing to latest version
  useEffect(() => { startListeningRef.current = startListeningFn; }, [startListeningFn]);

  /* ─────────────────────────────────────────────────────────────────────
   * Modal open/close lifecycle
   * ───────────────────────────────────────────────────────────────────── */
  useEffect(() => {
    if (!isOpen) {
      stopRecognition();
      stopAudio();
      isBusy.current = false;
      isPlaying.current = false;
      setMode('idle');
      return;
    }

    setUserText('');
    setInputText('');
    setAiText("Hey! I'm listening — ask me about any government scheme.");
    setPermError(null);
    isBusy.current = false;
    isPlaying.current = false;
    setMode('listening');

    // Request mic permission, then start
    if (navigator.mediaDevices?.getUserMedia) {
      navigator.mediaDevices.getUserMedia({ audio: true })
        .then(stream => {
          stream.getTracks().forEach(t => t.stop());
          startListeningRef.current?.();
        })
        .catch(() => {
          setPermError('Microphone access required. Tap 🔒 in your browser bar to allow it.');
        });
    } else {
      startListeningRef.current?.();
    }

    return () => {
      stopRecognition();
      stopAudio();
      isBusy.current = false;
      isPlaying.current = false;
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen]);

  /* ESC key to close */
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
    stopRecognition();
    handleQuery(q);
  };

  /* Orb click: barge-in while speaking, or manual start */
  const handleOrbClick = () => {
    if (mode === 'speaking') {
      stopAudio();
      isBusy.current = false;
      isPlaying.current = false;
      setMode('listening');
      startListeningRef.current?.();
    } else if (mode === 'idle' || mode === 'listening') {
      startListeningRef.current?.();
    }
  };

  if (!isOpen) return null;

  const statusLabel = {
    listening: '🎙️ Listening…',
    thinking:  '💭 Thinking…',
    speaking:  '🔊 Speaking  —  speak or tap orb to interrupt',
    idle:      'Tap the orb to start',
  }[mode] ?? '';

  return (
    <div className="siri-modal-backdrop" onClick={onClose}>
      <div className="siri-modal-card" onClick={e => e.stopPropagation()}>

        {/* Header */}
        <div className="siri-header">
          <div className="siri-badge">
            <span className="siri-dot" />
            <span>JanSeva AI — Voice Mode</span>
          </div>
          <button className="siri-close-btn" onClick={onClose} title="End call (Esc)">
            <CloseIcon />
          </button>
        </div>

        {/* Animated Orb */}
        <div className="siri-orb-container" onClick={handleOrbClick}
          title={mode === 'speaking' ? 'Tap to interrupt' : 'Tap to start'}>
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

        {/* Typed fallback */}
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

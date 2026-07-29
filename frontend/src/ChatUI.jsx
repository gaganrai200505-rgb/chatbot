import React, { useState, useRef, useEffect, useCallback } from 'react';
import { sendChatMessage, fetchChatHistory, fetchTextToSpeechAudio } from './api';

/* ──────────────────────────────────────────────────────────────────────────
 * Icon helpers
 * ────────────────────────────────────────────────────────────────────────── */
const BotIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none"
    stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
  </svg>
);

const SendIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none"
    stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
    <line x1="22" y1="2" x2="11" y2="13"/>
    <polygon points="22 2 15 22 11 13 2 9 22 2"/>
  </svg>
);

const KbIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none"
    stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M4 19.5v-15A2.5 2.5 0 0 1 6.5 2H20v20H6.5a2.5 2.5 0 0 1 0-5H20"/>
  </svg>
);

const WebIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none"
    stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="12" r="10"/>
    <line x1="2" y1="12" x2="22" y2="12"/>
    <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/>
  </svg>
);

const MicIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none"
    stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/>
    <path d="M19 10v2a7 7 0 0 1-14 0v-2"/>
    <line x1="12" y1="19" x2="12" y2="23"/>
    <line x1="8" y1="23" x2="16" y2="23"/>
  </svg>
);

const StopIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor">
    <rect x="6" y="6" width="12" height="12" rx="2"/>
  </svg>
);

const CopyIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none"
    stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <rect x="9" y="9" width="13" height="13" rx="2" ry="2"/>
    <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>
  </svg>
);

const CheckIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none"
    stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="20 6 9 17 4 12"/>
  </svg>
);

const WhatsAppIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor">
    <path d="M.057 24l1.687-6.163c-1.041-1.804-1.588-3.849-1.587-5.946.003-6.556 5.338-11.891 11.893-11.891 3.181.001 6.167 1.24 8.413 3.488 2.245 2.248 3.481 5.236 3.48 8.414-.003 6.557-5.338 11.892-11.893 11.892-1.99-.001-3.951-.5-5.688-1.448l-6.305 1.654zm6.597-3.807c1.676.995 3.276 1.591 5.392 1.592 5.448 0 9.886-4.434 9.889-9.885.002-5.462-4.415-9.89-9.881-9.892-5.452 0-9.887 4.434-9.889 9.884-.001 2.225.651 3.891 1.746 5.634l-.999 3.648 3.742-.981z"/>
  </svg>
);

const StopAudioIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none"
    stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"></polygon>
    <line x1="23" y1="9" x2="17" y2="15"></line>
    <line x1="17" y1="9" x2="23" y2="15"></line>
  </svg>
);

/* ──────────────────────────────────────────────────────────────────────────
 * Language code → BCP-47 locale for SpeechRecognition
 * ────────────────────────────────────────────────────────────────────────── */
const LANG_LOCALE = { en: 'en-IN', hi: 'hi-IN', kn: 'kn-IN' };

/* ──────────────────────────────────────────────────────────────────────────
 * Text-to-Speech (TTS) Engine
 * ────────────────────────────────────────────────────────────────────────── */
const sanitizeForSpeech = (text, lang) => {
  if (!text) return '';
  let clean = text;

  // 1. Remove URLs, Markdown formatting, headers, table pipes
  clean = clean.replace(/https?:\/\/\S+/g, '');
  clean = clean.replace(/\[([^\]]+)\]\([^)]+\)/g, '$1');
  clean = clean.replace(/\|/g, ' ');
  clean = clean.replace(/#{1,6}\s?/g, '');
  clean = clean.replace(/[*_~`]/g, '');

  // 2. Normalize symbols to natural spoken words per language
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

let activeChatAudio = null;

const speakText = async (text, lang, onStart, onEnd) => {
  if (activeChatAudio) {
    activeChatAudio.pause();
    activeChatAudio = null;
  }
  if (window.speechSynthesis) {
    window.speechSynthesis.cancel();
  }

  const cleanText = sanitizeForSpeech(text, lang);
  if (!cleanText) return;

  try {
    const audioUrl = await fetchTextToSpeechAudio(cleanText, lang);
    if (audioUrl) {
      const audio = new Audio(audioUrl);
      activeChatAudio = audio;

      audio.onplay = () => { if (onStart) onStart(); };
      audio.onended = () => {
        URL.revokeObjectURL(audioUrl);
        activeChatAudio = null;
        if (onEnd) onEnd();
      };
      audio.onerror = () => {
        URL.revokeObjectURL(audioUrl);
        activeChatAudio = null;
        if (onEnd) onEnd();
      };

      await audio.play();
      return;
    }
  } catch (e) {
    console.warn("Neural TTS error in ChatUI:", e);
  }

  // WebSpeech API Fallback
  if (!window.speechSynthesis) return;
  const utterance = new SpeechSynthesisUtterance(cleanText);
  utterance.lang = LANG_LOCALE[lang] || 'en-IN';
  utterance.onstart = () => { if (onStart) onStart(); };
  utterance.onend = () => { if (onEnd) onEnd(); };
  utterance.onerror = () => { if (onEnd) onEnd(); };
  window.speechSynthesis.speak(utterance);
};

/* ──────────────────────────────────────────────────────────────────────────
 * useVoiceInput — wraps Web Speech API SpeechRecognition
 * ────────────────────────────────────────────────────────────────────────── */
const useVoiceInput = (language, onResult) => {
  const [isListening, setIsListening] = useState(false);
  const [supported, setSupported] = useState(false);
  const recognitionRef = useRef(null);

  useEffect(() => {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    setSupported(!!SR);
  }, []);

  const startListening = useCallback(() => {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) return;

    const recognition = new SR();
    recognition.lang = LANG_LOCALE[language] || 'en-IN';
    recognition.interimResults = true;
    recognition.continuous = true; // Stay open until user stops
    recognitionRef.current = recognition;

    recognition.onstart = () => setIsListening(true);
    recognition.onerror = () => setIsListening(false);
    recognition.onend = () => setIsListening(false);

    recognition.onresult = (e) => {
      let finalTranscript = '';
      let interimTranscript = '';
      
      for (let i = e.resultIndex; i < e.results.length; ++i) {
        if (e.results[i].isFinal) {
          finalTranscript += e.results[i][0].transcript;
        } else {
          interimTranscript += e.results[i][0].transcript;
        }
      }
      
      const combined = (finalTranscript + interimTranscript).trim();
      if (combined) {
        onResult(combined, false);
      }
    };

    recognition.start();
  }, [language, onResult]);

  const stopListening = useCallback((submitNow = false) => {
    recognitionRef.current?.stop();
    setIsListening(false);
    if (submitNow) {
      onResult(null, true);
    }
  }, [onResult]);

  return { isListening, supported, startListening, stopListening };
};

const getWelcomeMessage = (lang) => {
  const texts = {
    en: 'Hello! I can help you find information about Indian Government Schemes such as PM Kisan, Ayushman Bharat, Ration Card, and more. How can I assist you today?',
    hi: 'नमस्ते! मैं भारतीय सरकारी योजनाओं के बारे में जानकारी खोजने में आपकी मदद कर सकता हूँ। मैं आपकी कैसे सहायता कर सकता हूँ?',
    kn: 'ನಮಸ್ಕಾರ! ಭಾರತ ಸರ್ಕಾರದ ಯೋಜನೆಗಳ ಬಗ್ಗೆ ಮಾಹಿತಿ ಹುಡುಕಲು ನಾನು ನಿಮಗೆ ಸಹಾಯ ಮಾಡಬಲ್ಲೆ. ನಾನು ನಿಮಗೆ ಹೇಗೆ ಸಹಾಯ ಮಾಡಲಿ?',
  };
  return { id: 'welcome', sender: 'bot', text: texts[lang] || texts.en, source: null };
};

/* ──────────────────────────────────────────────────────────────────────────
 * Suggestion prompts for welcome screen
 * ────────────────────────────────────────────────────────────────────────── */
const SUGGESTIONS = [
  { title: 'Ayushman Bharat', desc: 'How do I apply and get my health card?', prompt: 'How do I apply for Ayushman Bharat and get my health insurance card?' },
  { title: 'PM Kisan Status', desc: 'Check my latest installment transfer', prompt: 'How can I check my PM Kisan payment status and latest installment?' },
  { title: 'Ration Card', desc: 'Add family members or update address', prompt: 'How do I update my ration card to add family members or change address?' },
  { title: 'Digital Education', desc: 'Free courses and certification schemes', prompt: 'What are the government schemes available for free digital education and certifications?' },
];

/* ──────────────────────────────────────────────────────────────────────────
 * Markdown-lite renderer with Portal Action Buttons
 * ────────────────────────────────────────────────────────────────────────── */
const parseLinksAndBold = (str) => {
  // Regex to match Markdown links [Label](url) OR standalone URLs
  const linkRegex = /\[([^\]]+)\]\((https?:\/\/[^\s\)]+)\)|(https?:\/\/[^\s\)]+|[a-zA-Z0-9.-]+\.gov\.in[^\s\)]*)/g;
  
  const tokens = [];
  let lastIndex = 0;
  let match;

  const renderBold = (textSegment, keyPrefix) => {
    const parts = textSegment.split('**');
    return parts.map((part, j) =>
      j % 2 === 1 ? <strong key={`${keyPrefix}-b-${j}`}>{part}</strong> : part
    );
  };

  while ((match = linkRegex.exec(str)) !== null) {
    if (match.index > lastIndex) {
      tokens.push(renderBold(str.substring(lastIndex, match.index), `txt-${lastIndex}`));
    }

    if (match[1] && match[2]) {
      // Markdown link: [label](url)
      const label = match[1];
      let url = match[2];
      if (!url.startsWith('http')) url = 'https://' + url;

      const isPortalBtn = url.includes('.gov.in') || label.toLowerCase().includes('apply') || label.toLowerCase().includes('portal') || label.toLowerCase().includes('official');

      if (isPortalBtn) {
        tokens.push(
          <a
            key={`link-${match.index}`}
            href={url}
            target="_blank"
            rel="noopener noreferrer"
            className="portal-cta-button"
          >
            <span className="portal-cta-icon">🏛️</span>
            <span className="portal-cta-label">{label}</span>
            <span className="portal-cta-badge">Official Portal ↗</span>
          </a>
        );
      } else {
        tokens.push(
          <a
            key={`link-${match.index}`}
            href={url}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-gov-link"
          >
            {label} ↗
          </a>
        );
      }
    } else if (match[3]) {
      // Plain URL match (e.g. pmkisan.gov.in)
      let url = match[3];
      const displayUrl = url;
      if (!url.startsWith('http')) url = 'https://' + url;

      tokens.push(
        <a
          key={`link-${match.index}`}
          href={url}
          target="_blank"
          rel="noopener noreferrer"
          className="portal-cta-button"
        >
          <span className="portal-cta-icon">🌐</span>
          <span className="portal-cta-label">{displayUrl}</span>
          <span className="portal-cta-badge">Official Portal ↗</span>
        </a>
      );
    }

    lastIndex = linkRegex.lastIndex;
  }

  if (lastIndex < str.length) {
    tokens.push(renderBold(str.substring(lastIndex), `txt-${lastIndex}`));
  }

  return tokens;
};

const renderText = (text) => {
  const lines = text.split('\n');
  const elements = [];
  let listItems = [];

  const flushList = (key) => {
    if (listItems.length) {
      elements.push(<ul key={`ul-${key}`}>{listItems}</ul>);
      listItems = [];
    }
  };

  lines.forEach((line, i) => {
    const isBullet = /^[\-\*]\s/.test(line.trim());

    if (isBullet) {
      listItems.push(<li key={i}>{parseLinksAndBold(line.replace(/^[\-\*]\s/, ''))}</li>);
    } else {
      flushList(i);
      if (line.trim() === '') {
        if (elements.length) elements.push(<br key={`br-${i}`} />);
      } else {
        elements.push(<p key={i}>{parseLinksAndBold(line)}</p>);
      }
    }
  });

  flushList('end');
  return elements;
};


/* ──────────────────────────────────────────────────────────────────────────
 * ChatUI Component
 * ────────────────────────────────────────────────────────────────────────── */
const ChatUI = ({ sessionId, initialMessages = [], onSessionStarted, language, selectedState, username, onMessageSent }) => {
  const [messages, setMessages] = useState(initialMessages);
  const [inputText, setInputText] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const chatEndRef = useRef(null);
  const textareaRef = useRef(null);
  const isVoiceSubmitRef = useRef(false); // Tracks if the current submission was via voice
  const currentSessionIdRef = useRef(sessionId);

  const [copiedMsgId, setCopiedMsgId] = useState(null);

  const handleCopyMessage = (text, id) => {
    navigator.clipboard.writeText(text);
    setCopiedMsgId(id);
    setTimeout(() => setCopiedMsgId(null), 2000);
  };

  useEffect(() => {
    currentSessionIdRef.current = sessionId;
    setMessages(initialMessages || []);
  }, [sessionId, initialMessages]);

  /* Stop speech manually */
  const handleStopSpeech = useCallback(() => {
    if (window.speechSynthesis) window.speechSynthesis.cancel();
    setIsSpeaking(false);
  }, []);

  /* Send message */
  const handleSend = useCallback(async (queryOverride) => {
    const query = (typeof queryOverride === 'string' ? queryOverride : inputText).trim();
    if (!query || isLoading) return;

    // Check if voice was used and immediately reset the flag
    const wasVoice = isVoiceSubmitRef.current;
    isVoiceSubmitRef.current = false;

    const userMsg = { id: Date.now(), sender: 'user', text: query };
    setMessages((prev) => [...prev, userMsg]);
    setInputText('');
    setIsLoading(true);

    // Stop any currently playing audio from previous messages
    handleStopSpeech();

    try {
      const activeId = currentSessionIdRef.current || '';
      const result = await sendChatMessage(query, language, activeId, selectedState);
      
      // If this was a new chat, inform parent of the new session_id created by backend
      if (!currentSessionIdRef.current && result.session_id) {
        currentSessionIdRef.current = result.session_id;
        if (onSessionStarted) onSessionStarted(result.session_id);
      }

      setMessages((prev) => [
        ...prev,
        { id: Date.now() + 1, sender: 'bot', text: result.response, source: result.source },
      ]);
      
      // Notify parent to refresh sidebar history
      if (onMessageSent) onMessageSent();
    } catch (err) {
      setMessages((prev) => [
        ...prev,
        { id: Date.now() + 1, sender: 'bot', text: err.message || 'An error occurred.', source: 'error' },
      ]);
    } finally {
      setIsLoading(false);
    }
  }, [inputText, isLoading, language, selectedState, onMessageSent, onSessionStarted, handleStopSpeech]);

  /* Voice input */
  const handleTranscript = useCallback((text, shouldSubmit) => {
    if (text !== null) {
      setInputText(text);
    }
    
    if (shouldSubmit) {
      isVoiceSubmitRef.current = true;
      setTimeout(() => {
        const sendBtn = document.querySelector('.send-btn');
        if (sendBtn && !sendBtn.disabled) sendBtn.click();
      }, 50);
    }
  }, []);

  const {
    isListening,
    supported: voiceSupported,
    startListening,
    stopListening,
  } = useVoiceInput(language, handleTranscript);

  const hasMessages = messages.length > 0;

  /* Auto-scroll */
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, isLoading]);

  /* Auto-resize textarea */
  useEffect(() => {
    const ta = textareaRef.current;
    if (!ta) return;
    ta.style.height = 'auto';
    ta.style.height = Math.min(ta.scrollHeight, 200) + 'px';
  }, [inputText]);



  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const placeholder =
    language === 'hi' ? 'अपना प्रश्न यहाँ लिखें...' :
    language === 'kn' ? 'ನಿಮ್ಮ ಪ್ರಶ್ನೆಯನ್ನು ಇಲ್ಲಿ ಟೈಪ್ ಮಾಡಿ...' :
    'Ask about any government scheme...';

  const userInitial = username ? username.charAt(0).toUpperCase() : 'U';

  return (
    <>
      {/* ── Chat messages OR welcome state ── */}
      <div className="chat-area">
        {!hasMessages ? (
          /* Welcome / empty state */
          <div className="welcome-state">
            <div className="welcome-icon">
              <BotIcon />
            </div>
            <h2 className="welcome-heading">JanSeva AI</h2>
            <p className="welcome-sub">
              Ask about PM Kisan, Ayushman Bharat, Ration Card, and other citizen services.
            </p>

            <div className="suggestions-grid">
              {SUGGESTIONS.map((s) => (
                <button
                  key={s.title}
                  className="suggestion-card"
                  onClick={() => handleSend(s.prompt)}
                >
                  <div className="suggestion-card-title">{s.title}</div>
                  <div className="suggestion-card-desc">{s.desc}</div>
                </button>
              ))}
            </div>
          </div>
        ) : (
          /* Message thread */
          <div className="messages-container">
            {messages.map((msg) => (
              <div
                key={msg.id}
                className={`message-row ${msg.sender === 'user' ? 'user-row' : 'bot-row'}`}
              >
                {/* Avatar */}
                <div className={`msg-avatar ${msg.sender === 'user' ? 'user-avatar' : 'bot-avatar'}`}>
                  {msg.sender === 'user' ? userInitial : <BotIcon />}
                </div>

                {/* Content */}
                <div className="msg-content">
                  {msg.sender === 'user' ? (
                    <div className="user-bubble">{msg.text}</div>
                  ) : (
                    <>
                      <div className="bot-text">{renderText(msg.text)}</div>
                      <div className="bot-msg-actions">
                        <button
                          className="msg-action-btn"
                          title="Copy response to clipboard"
                          onClick={() => handleCopyMessage(msg.text, msg.id)}
                        >
                          {copiedMsgId === msg.id ? <CheckIcon /> : <CopyIcon />}
                          <span>{copiedMsgId === msg.id ? 'Copied' : 'Copy'}</span>
                        </button>

                        <a
                          className="msg-action-btn whatsapp-btn"
                          title="Share via WhatsApp"
                          href={`https://api.whatsapp.com/send?text=${encodeURIComponent(msg.text)}`}
                          target="_blank"
                          rel="noopener noreferrer"
                        >
                          <WhatsAppIcon />
                          <span>Share</span>
                        </a>
                      </div>
                    </>
                  )}
                </div>
              </div>
            ))}

            {/* Typing indicator */}
            {isLoading && (
              <div className="typing-row">
                <div className="msg-avatar bot-avatar"><BotIcon /></div>
                <div className="typing-bubble">
                  <div className="typing-dot" />
                  <div className="typing-dot" />
                  <div className="typing-dot" />
                </div>
              </div>
            )}

            <div ref={chatEndRef} />
          </div>
        )}
      </div>

      {/* ── Input area ── */}
      <div className="input-section">
        <div className="input-wrapper">
          <div className="input-box">
            <textarea
              ref={textareaRef}
              className="chat-textarea"
              rows={1}
              value={inputText}
              onChange={(e) => setInputText(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder={isListening ? '🎙 Listening...' : placeholder}
              disabled={isLoading}
              aria-label="Message input"
            />
            {/* Mic button — only shown if browser supports SpeechRecognition */}
            {voiceSupported && !isSpeaking && (
              <button
                type="button"
                className={`mic-btn ${isListening ? 'listening' : ''}`}
                onClick={() => isListening ? stopListening(true) : startListening()}
                disabled={isLoading}
                aria-label={isListening ? 'Stop recording' : 'Start voice input'}
                title={isListening ? 'Stop & Send' : 'Voice input'}
              >
                {isListening ? <StopIcon /> : <MicIcon />}
              </button>
            )}

            {/* Stop Audio button — only shown if the AI is currently talking */}
            {isSpeaking && (
              <button
                type="button"
                className="mic-btn"
                onClick={handleStopSpeech}
                aria-label="Stop audio"
                title="Stop audio"
                style={{ color: '#ef4444' }}
              >
                <StopAudioIcon />
              </button>
            )}
            <button
              className="send-btn"
              onClick={() => handleSend()}
              disabled={!inputText.trim() || isLoading}
              aria-label="Send message"
            >
              <SendIcon />
            </button>
          </div>
          <p className="input-disclaimer">
            JanSeva AI may make mistakes. Verify important info with official sources.
          </p>
        </div>
      </div>
    </>
  );
};

export default ChatUI;

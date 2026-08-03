import React, { useState, useRef, useEffect, useCallback } from 'react';
import { sendChatMessage, fetchChatHistory, fetchTextToSpeechAudio } from './api';

/* ──────────────────────────────────────────────────────────────────────────
 * Icon helpers
 * ────────────────────────────────────────────────────────────────────────── */
const GeminiSparkleIcon = ({ size = 20 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
    <path fillRule="evenodd" clipRule="evenodd" d="M12 0C12 6.62742 6.62742 12 0 12C6.62742 12 12 17.3726 12 24C12 17.3726 17.3726 12 24 12C17.3726 12 12 6.62742 12 0Z" fill="url(#gemini_sparkle_grad_chat)" />
    <defs>
      <linearGradient id="gemini_sparkle_grad_chat" x1="0" y1="0" x2="24" y2="24" gradientUnits="userSpaceOnUse">
        <stop stopColor="#4285F4" />
        <stop offset="0.33" stopColor="#9334E6" />
        <stop offset="0.66" stopColor="#EA4335" />
        <stop offset="1" stopColor="#24C1E0" />
      </linearGradient>
    </defs>
  </svg>
);

const CivicEmblemIcon = ({ size = 24 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M3 21h18"/>
    <path d="M5 21V7l7-4 7 4v14"/>
    <path d="M9 10a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v11H9V10z"/>
  </svg>
);

const BotIcon = () => <CivicEmblemIcon size={18} />;

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
  { title: 'Ayushman Bharat', desc: 'How do I apply for ₹5 Lakh health insurance card?', prompt: 'How do I apply for Ayushman Bharat and get my health insurance card?', icon: '🏥', badge: 'Popular Healthcare', featured: true },
  { title: 'PM Kisan Installment', desc: 'Check latest 2026 payment transfer status', prompt: 'How can I check my PM Kisan payment status and latest installment?', icon: '🌾', badge: 'Agriculture Grant' },
  { title: 'Ration Card Update', desc: 'Add family members or transfer address', prompt: 'How do I update my ration card to add family members or change address?', icon: '📄', badge: 'Essential Welfare' },
  { title: 'Digital Education', desc: 'Free skill courses & student certifications', prompt: 'What are the government schemes available for free digital education and certifications?', icon: '🎓', badge: 'Education' },
];


const RECOMMENDED_SCHEMES = [
  {
    title: 'PM Kisan Samman Nidhi',
    category: 'Agriculture',
    benefit: '₹6,000 / year direct transfer',
    prompt: 'Tell me about PM Kisan Samman Nidhi eligibility and application deadline 2026',
    bgImg: '/agriculture_bg.png',
  },
  {
    title: 'Ayushman Bharat (PM-JAY)',
    category: 'Healthcare',
    benefit: '₹5 Lakh health cover / family',
    prompt: 'How can I apply for Ayushman Bharat Golden Card and check hospital list?',
    bgImg: '/healthcare_bg.png',
  },
  {
    title: 'PM Awas Yojana (PMAY)',
    category: 'Housing',
    benefit: 'Up to ₹1.2 Lakh housing subsidy',
    prompt: 'What are the eligibility rules and latest date for PM Awas Yojana rural housing subsidy?',
    bgImg: '/solar_bg.png',
  },
  {
    title: 'National Scholarship Portal',
    category: 'Education',
    benefit: 'Tuition & stipend support',
    prompt: 'What NSP post-matric scholarships are active right now for students?',
    bgImg: '/education_bg.png',
  },
  {
    title: 'PM Mudra Yojana',
    category: 'Business',
    benefit: 'Collateral-free loan up to ₹10 Lakh',
    prompt: 'How to get Mudra Shishu or Kishor loan for micro business setup?',
    bgImg: '/healthcare_bg.png',
  },
  {
    title: 'Sukanya Samriddhi Yojana',
    category: 'Welfare',
    benefit: '8.2% interest tax-free savings',
    prompt: 'Explain Sukanya Samriddhi account opening rules and tax benefits for girl child',
    bgImg: '/education_bg.png',
  },
  {
    title: 'PM SVANidhi',
    category: 'Micro-Credit',
    benefit: 'Working capital loan up to ₹50k',
    prompt: 'How street vendors can get digital cashback and PM SVANidhi loans',
    bgImg: '/solar_bg.png',
  },
];

const TRENDING_NEW_SCHEMES = [
  {
    title: 'PM Surya Ghar: Muft Bijli Yojana',
    subtitle: '300 Units Free Electricity + ₹78,000 Subsidy',
    desc: 'Get rooftop solar panels installed on your home with 60% central government subsidy.',
    prompt: 'How to apply for PM Surya Ghar Muft Bijli Yojana solar rooftop subsidy and eligibility?',
    bgImg: '/solar_bg.png',
  },
  {
    title: 'PM Vishwakarma Yojana',
    subtitle: '₹3 Lakh Loan @ 5% + ₹15,000 Toolkit Voucher',
    desc: 'Financial support, advanced skill training, and modern tools for traditional artisans & craftspeople.',
    prompt: 'Who qualifies for PM Vishwakarma scheme and how to claim ₹15,000 toolkit voucher?',
    bgImg: '/education_bg.png',
  },
  {
    title: 'Lakhpati Didi Scheme',
    subtitle: 'Micro-Credit & Skill Training for Women',
    desc: 'Entrepreneurship training in LED bulb manufacturing, drone operation, and tailoring for SHG women.',
    prompt: 'How rural SHG women can join Lakhpati Didi scheme to start a small business?',
    bgImg: '/agriculture_bg.png',
  },
  {
    title: 'PM-PRANAM Scheme',
    subtitle: 'Bio-Fertilizers & Soil Health Grants',
    desc: 'State government incentive grants for farmers adopting organic and sustainable agriculture.',
    prompt: 'What are the benefits and application process for PM PRANAM organic farming subsidy?',
    bgImg: '/agriculture_bg.png',
  },
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
      let url = match[2].trim().replace(/[.,;:]+$/, '');
      if (!url.startsWith('http')) url = 'https://' + url;

      const isPortalBtn = url.includes('.gov.in') || url.includes('.nic.in') || url.includes('.in') || label.toLowerCase().includes('apply') || label.toLowerCase().includes('portal') || label.toLowerCase().includes('official') || label.toLowerCase().includes('register');

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
      // Plain URL match (e.g. pmkisan.gov.in or https://beneficiary.nha.gov.in)
      let url = match[3].trim().replace(/[.,;:]+$/, '');
      const displayDomain = url.replace(/^https?:\/\//, '').split('/')[0];
      if (!url.startsWith('http')) url = 'https://' + url;

      tokens.push(
        <a
          key={`link-${match.index}`}
          href={url}
          target="_blank"
          rel="noopener noreferrer"
          className="portal-cta-button"
        >
          <span className="portal-cta-icon">🏛️</span>
          <span className="portal-cta-label">Apply on {displayDomain}</span>
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
  const [trendingSchemes, setTrendingSchemes] = useState(TRENDING_NEW_SCHEMES);

  useEffect(() => {
    // Fetch live automatically updated 2026 government schemes from backend endpoint
    fetch('/api/trending-schemes/')
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (data && Array.isArray(data) && data.length > 0) {
          setTrendingSchemes(data);
        }
      })
      .catch((err) => console.log('[ChatUI] Dynamic schemes fetch fallback:', err));
  }, []);

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
          /* Welcome / empty state — Human-Centric Bespoke Style */
          <div className="welcome-state">
            <div className="welcome-trust-pill">
              <span className="trust-dot"></span>
              <span>🇮🇳 Official Indian Public Welfare Portal • Direct Benefit Transfer (DBT) Verified</span>
            </div>

            <div className="welcome-icon civic-hero-icon">
              <CivicEmblemIcon size={44} />
            </div>

            <h2 className="welcome-heading">
              <span className="civic-heading-text">Namaste, {username || 'Citizen'}</span>
            </h2>
            <p className="welcome-sub">
              Search verified central & state government schemes, application deadlines, and eligibility criteria.
            </p>



            {/* ── Recommended Schemes Carousel ── */}
            <div className="recommended-schemes-section">
              <div className="recommended-schemes-header">
                <div className="recommended-title">
                  <span>Recommended Schemes</span>
                </div>
                <span style={{ fontSize: '0.72rem', color: '#94a3b8' }}>Hover to pause • Tap to select</span>
              </div>

              <div className="recommended-marquee-container">
                <div className="recommended-marquee-track">
                  {/* Render list twice for seamless 360 infinite loop */}
                  {[...RECOMMENDED_SCHEMES, ...RECOMMENDED_SCHEMES].map((scheme, idx) => (
                    <div
                      key={`${scheme.title}-${idx}`}
                      className="recommended-scheme-card"
                      style={{
                        backgroundImage: `linear-gradient(180deg, rgba(7, 13, 24, 0.25) 0%, rgba(7, 13, 24, 0.75) 100%), url(${scheme.bgImg})`,
                        backgroundSize: 'cover',
                        backgroundPosition: 'center',
                      }}
                      onClick={() => handleSend(scheme.prompt)}
                    >
                      <div>
                        <span className="rec-card-category">{scheme.category}</span>
                        <div className="rec-card-title">{scheme.title}</div>
                      </div>
                      <div className="rec-card-benefit">
                        <span>{scheme.benefit}</span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            {/* ── Trending & Key Schemes Section ── */}
            <div className="trending-schemes-section">
              <div className="trending-section-header">
                <h3 className="trending-title">Key Government Initiatives</h3>
                <p className="trending-subtitle">Featured subsidies and central welfare assistance</p>
              </div>

              <div className="trending-cards-grid">
                {trendingSchemes.map((scheme) => (
                  <div

                    key={scheme.title}
                    className="trending-scheme-card"
                    style={{
                      backgroundImage: `linear-gradient(180deg, rgba(7, 13, 24, 0.25) 0%, rgba(7, 13, 24, 0.82) 100%), url(${scheme.bgImg})`,
                      backgroundSize: 'cover',
                      backgroundPosition: 'center',
                    }}
                    onClick={() => handleSend(scheme.prompt)}
                  >

                    <div>
                      <h4 className="trending-card-title">{scheme.title}</h4>
                      <div className="trending-card-sub">{scheme.subtitle}</div>
                      <p className="trending-card-desc">{scheme.desc}</p>
                    </div>
                    <div className="trending-card-action">
                      <span>Explore Scheme Details →</span>
                    </div>
                  </div>
                ))}
              </div>
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

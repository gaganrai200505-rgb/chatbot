import React, { useState, useEffect, useRef, useCallback } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './AuthContext';
import AuthForms from './AuthForms';
import ChatUI from './ChatUI';
import { fetchChatHistory, deleteChatSession, updateChatSession } from './api';

import EligibilityModal from './EligibilityModal';
import SiriVoiceModal from './SiriVoiceModal';

const GeminiSparkleIcon = ({ size = 20 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
    <path fillRule="evenodd" clipRule="evenodd" d="M12 0C12 6.62742 6.62742 12 0 12C6.62742 12 12 17.3726 12 24C12 17.3726 17.3726 12 24 12C17.3726 12 12 6.62742 12 0Z" fill="url(#gemini_sparkle_grad)" />
    <defs>
      <linearGradient id="gemini_sparkle_grad" x1="0" y1="0" x2="24" y2="24" gradientUnits="userSpaceOnUse">
        <stop stopColor="#4285F4" />
        <stop offset="0.33" stopColor="#9334E6" />
        <stop offset="0.66" stopColor="#EA4335" />
        <stop offset="1" stopColor="#24C1E0" />
      </linearGradient>
    </defs>
  </svg>
);

const MicIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none"
    stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3z"/>
    <path d="M19 10v2a7 7 0 0 1-14 0v-2"/>
    <line x1="12" y1="19" x2="12" y2="22"/>
  </svg>
);

const TargetIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none"
    stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="12" r="10"/>
    <circle cx="12" cy="12" r="6"/>
    <circle cx="12" cy="12" r="2"/>
  </svg>
);
const MapPinIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none"
    stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/>
    <circle cx="12" cy="10" r="3"/>
  </svg>
);

const ChevronDownIcon = ({ className = '' }) => (
  <svg className={className} xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none"
    stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="6 9 12 15 18 9"/>
  </svg>
);

const SearchIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none"
    stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="11" cy="11" r="8"/>
    <line x1="21" y1="21" x2="16.65" y2="16.65"/>
  </svg>
);

const CheckIconSmall = () => (
  <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none"
    stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="20 6 9 17 4 12"/>
  </svg>
);

const CustomDropdown = ({ options, value, onChange, icon, title, searchable = false, isState = false }) => {
  const [isOpen, setIsOpen] = useState(false);
  const [search, setSearch] = useState('');
  const dropdownRef = useRef(null);

  useEffect(() => {
    const handleClickOutside = (e) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target)) {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const filteredOptions = options.filter(opt => {
    const text = typeof opt === 'string' ? opt : opt.label;
    return text.toLowerCase().includes(search.toLowerCase());
  });

  const selectedLabel = typeof options[0] === 'string'
    ? value
    : (options.find(o => o.value === value)?.label || value);

  const shortLabel = isState && selectedLabel.length > 12
    ? selectedLabel.split(' ').slice(0, 2).join(' ')
    : selectedLabel;

  return (
    <div className={`custom-dropdown-container ${isState ? 'state-dropdown' : ''}`} ref={dropdownRef} title={title}>
      <button
        type="button"
        className={`custom-dropdown-trigger ${isOpen ? 'active' : ''}`}
        onClick={() => setIsOpen(!isOpen)}
      >
        {icon}
        <span className="dropdown-selected-text desktop-label">{selectedLabel}</span>
        <span className="dropdown-selected-text mobile-label">{shortLabel}</span>
        <ChevronDownIcon className={`chevron-icon ${isOpen ? 'open' : ''}`} />
      </button>

      {isOpen && (
        <>
          {/* Mobile dimmed backdrop */}
          <div className="dropdown-mobile-backdrop" onClick={() => { setIsOpen(false); setSearch(''); }} />

          <div className="custom-dropdown-menu">
            {/* Mobile sheet header with drag handle */}
            <div className="mobile-sheet-header">
              <div className="mobile-sheet-drag-handle" />
              <div className="mobile-sheet-title">
                {isState ? '📍 Select State / Region' : '🌐 Select Language'}
              </div>
            </div>

            {searchable && (
              <div className="dropdown-search-box">
                <SearchIcon />
                <input
                  type="text"
                  className="dropdown-search-input"
                  placeholder="Search state..."
                  value={search}
                  onChange={e => setSearch(e.target.value)}
                  autoFocus
                  onClick={e => e.stopPropagation()}
                />
                {search && (
                  <button className="clear-search-btn" onClick={() => setSearch('')}>✕</button>
                )}
              </div>
            )}

            <div className="dropdown-options-list">
            {filteredOptions.map((opt) => {
              const val = typeof opt === 'string' ? opt : opt.value;
              const lbl = typeof opt === 'string' ? opt : opt.label;
              const isSelected = val === value;

              return (
                <div
                  key={val}
                  className={`dropdown-option-item ${isSelected ? 'selected' : ''}`}
                  onClick={() => {
                    onChange(val);
                    setIsOpen(false);
                    setSearch('');
                  }}
                >
                  <span className="option-label">{lbl}</span>
                  {isSelected && <CheckIconSmall />}
                </div>
              );
            })}
            {filteredOptions.length === 0 && (
              <div className="dropdown-no-results">No match found</div>
            )}
          </div>
        </div>
        </>
      )}
    </div>
  );
};

const INDIAN_STATES_AND_UTS = [
  "All India / Central Govt",
  "Andhra Pradesh", "Arunachal Pradesh", "Assam", "Bihar", "Chhattisgarh", 
  "Goa", "Gujarat", "Haryana", "Himachal Pradesh", "Jharkhand", "Karnataka", 
  "Kerala", "Madhya Pradesh", "Maharashtra", "Manipur", "Meghalaya", "Mizoram", 
  "Nagaland", "Odisha", "Punjab", "Rajasthan", "Sikkim", "Tamil Nadu", 
  "Telangana", "Tripura", "Uttar Pradesh", "Uttarakhand", "West Bengal",
  "Andaman & Nicobar Islands", "Chandigarh", "Dadra & Nagar Haveli and Daman & Diu", 
  "Delhi (NCT)", "Jammu & Kashmir", "Ladakh", "Lakshadweep", "Puducherry"
];

const PlusIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none"
    stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
    <line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
  </svg>
);

const ChatIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none"
    stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
  </svg>
);

const BotLogoIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none"
    stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
  </svg>
);

const LogoutIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none"
    stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/>
    <polyline points="16 17 21 12 16 7"/>
    <line x1="21" y1="12" x2="9" y2="12"/>
  </svg>
);

const GlobeIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none"
    stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="12" r="10"/>
    <path d="M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20"/>
    <path d="M2 12h20"/>
  </svg>
);

const MenuIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none"
    stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <line x1="3" y1="6" x2="21" y2="6"/>
    <line x1="3" y1="12" x2="21" y2="12"/>
    <line x1="3" y1="18" x2="21" y2="18"/>
  </svg>
);

const PinIcon = ({ pinned }) => (
  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill={pinned ? "currentColor" : "none"}
    stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <line x1="12" y1="17" x2="12" y2="22"/>
    <path d="M5 17h14l-1.5-6H6.5L5 17z"/>
    <path d="M9 11V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v7"/>
  </svg>
);

const EditIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none"
    stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
    <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
  </svg>
);

const TrashIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none"
    stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="3 6 5 6 21 6"/>
    <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
  </svg>
);

const CheckIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none"
    stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="20 6 9 17 4 12"/>
  </svg>
);

/* ──────────────────────────────────────────────────────────────────────────
 * Protected Route
 * ────────────────────────────────────────────────────────────────────────── */
const ProtectedRoute = ({ children }) => {
  const { isAuthenticated } = useAuth();
  return isAuthenticated ? children : <Navigate to="/login" replace />;
};

/* Process flat message history into distinct session threads */
const processChatSessions = (rawMessages) => {
  const sessionMap = new Map();
  
  rawMessages.forEach((msg) => {
    const sId = msg.session_id || `session_legacy_${msg.id}`;
    if (!sessionMap.has(sId)) {
      sessionMap.set(sId, {
        id: sId,
        title: msg.session_title || msg.query, // Custom title or first question
        is_pinned: Boolean(msg.is_pinned),
        timestamp: new Date(msg.timestamp),
        messages: []
      });
    }
    const session = sessionMap.get(sId);
    session.messages.push({ id: `q-${msg.id}`, sender: 'user', text: msg.query });
    session.messages.push({ id: `r-${msg.id}`, sender: 'bot', text: msg.response, source: msg.source });
  });

  const sessionsList = Array.from(sessionMap.values()).reverse(); // Newest sessions on top
  return sessionsList;
};

/* Group sessions by Pinned status and Date label */
const groupSessionsByDate = (sessionsList) => {
  const groups = {};
  const pinned = [];
  const unpinned = [];

  sessionsList.forEach((session) => {
    if (session.is_pinned) {
      pinned.push(session);
    } else {
      unpinned.push(session);
    }
  });

  if (pinned.length > 0) {
    groups['Pinned'] = pinned;
  }

  const now = new Date();
  unpinned.forEach((session) => {
    const diffDays = Math.floor((now - session.timestamp) / (1000 * 60 * 60 * 24));
    const label =
      diffDays === 0 ? 'Today' :
      diffDays === 1 ? 'Yesterday' :
      diffDays < 7  ? 'This Week' : 'Older';
    if (!groups[label]) groups[label] = [];
    groups[label].push(session);
  });

  return groups;
};

/* ──────────────────────────────────────────────────────────────────────────
 * Main Chat Page
 * ────────────────────────────────────────────────────────────────────────── */
const ChatPage = () => {
  const { user, logout } = useAuth();
  const [language, setLanguage] = useState('auto');
  const [selectedState, setSelectedState] = useState('All India / Central Govt');
  const [sidebarOpen, setSidebarOpen] = useState(() => window.innerWidth > 768);
  const [activeSessionId, setActiveSessionId] = useState(null);
  const [sessions, setSessions] = useState([]);
  const [historyVersion, setHistoryVersion] = useState(0);
  const [editingSessionId, setEditingSessionId] = useState(null);
  const [editingTitle, setEditingTitle] = useState('');
  const [isWizardOpen, setIsWizardOpen] = useState(false);
  const [isSiriOpen, setIsSiriOpen] = useState(false);

  const userInitial = user?.username ? user.username.charAt(0).toUpperCase() : 'U';

  // Load chat sessions from backend
  const loadHistory = useCallback(async () => {
    const rawMsgs = await fetchChatHistory();
    const parsedSessions = processChatSessions(rawMsgs);
    setSessions(parsedSessions);
  }, []);

  useEffect(() => {
    loadHistory();
  }, [loadHistory, historyVersion]);

  const handleMessageSent = useCallback(() => {
    setHistoryVersion((v) => v + 1);
  }, []);

  const handleNewChat = () => {
    setActiveSessionId(null);
    setSidebarOpen(false);
  };

  // Delete chat session handler with optimistic state update
  const handleDeleteSession = async (e, sessionId) => {
    e.stopPropagation();
    if (window.confirm("Are you sure you want to delete this conversation?")) {
      // Optimistically update UI state immediately
      setSessions((prev) => prev.filter((s) => s.id !== sessionId));
      if (activeSessionId === sessionId) {
        setActiveSessionId(null);
      }

      try {
        await deleteChatSession(sessionId);
      } catch (err) {
        console.error("Delete error:", err);
      }
    }
  };

  // Toggle pin chat session handler
  const handleTogglePin = async (e, session) => {
    e.stopPropagation();
    const newPinned = !session.is_pinned;
    setSessions((prev) =>
      prev.map((s) => (s.id === session.id ? { ...s, is_pinned: newPinned } : s))
    );
    try {
      await updateChatSession(session.id, { is_pinned: newPinned });
    } catch (err) {
      console.error("Pin toggle failed", err);
    }
  };

  // Rename session start
  const handleStartRename = (e, session) => {
    e.stopPropagation();
    setEditingSessionId(session.id);
    setEditingTitle(session.title);
  };

  // Save renamed session title
  const handleSaveRename = async (sessionId) => {
    if (editingTitle.trim()) {
      const newTitle = editingTitle.trim();
      setSessions((prev) =>
        prev.map((s) => (s.id === sessionId ? { ...s, title: newTitle } : s))
      );
      try {
        await updateChatSession(sessionId, { title: newTitle });
      } catch (err) {
        console.error("Rename failed", err);
      }
    }
    setEditingSessionId(null);
  };

  const historyGroups = groupSessionsByDate(sessions);
  const activeSession = sessions.find((s) => s.id === activeSessionId);
  const activeMessages = activeSession ? activeSession.messages : [];

  return (
    <div className="app-shell">
      <aside className={`sidebar ${sidebarOpen ? 'open' : ''}`}>
        <div className="sidebar-top">
          <div className="sidebar-brandmark">
            <div className="sidebar-logo-icon">
              <GeminiSparkleIcon size={22} />
            </div>
            <span className="sidebar-app-name">JanSeva AI</span>
            <button
              className="sidebar-close-btn"
              onClick={() => setSidebarOpen(false)}
              aria-label="Close menu"
              title="Close menu"
            >
              ✕
            </button>
          </div>

          {/* New chat button */}
          <button className="new-chat-btn" onClick={handleNewChat} id="new-chat-btn">
            <PlusIcon />
            New Chat
          </button>
        </div>

        {/* History */}
        <nav className="sidebar-history" aria-label="Chat history">
          {Object.keys(historyGroups).length === 0 ? (
            <p className="history-empty">No conversations yet.</p>
          ) : (
            Object.entries(historyGroups).map(([group, groupSessions]) => (
              <div key={group}>
                <div className="history-group-label">{group}</div>
                {groupSessions.map((session) => (
                  <div
                    key={session.id}
                    className={`history-item ${activeSessionId === session.id ? 'active' : ''}`}
                    onClick={() => {
                      setActiveSessionId(session.id);
                      // Auto-close sidebar on mobile after selecting a chat
                      if (window.innerWidth <= 768) setSidebarOpen(false);
                    }}
                  >
                    <ChatIcon />
                    
                    {editingSessionId === session.id ? (
                      <input
                        className="rename-input"
                        type="text"
                        value={editingTitle}
                        onChange={(e) => setEditingTitle(e.target.value)}
                        onBlur={() => handleSaveRename(session.id)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') handleSaveRename(session.id);
                          if (e.key === 'Escape') setEditingSessionId(null);
                        }}
                        autoFocus
                        onClick={(e) => e.stopPropagation()}
                      />
                    ) : (
                      <span className="history-item-text">{session.title}</span>
                    )}

                    {/* Action buttons (Pin, Edit, Delete) */}
                    <div className="history-actions">
                      <button
                        className={`action-btn ${session.is_pinned ? 'pinned' : ''}`}
                        title={session.is_pinned ? "Unpin" : "Pin"}
                        onClick={(e) => handleTogglePin(e, session)}
                      >
                        <PinIcon pinned={session.is_pinned} />
                      </button>

                      {editingSessionId === session.id ? (
                        <button
                          className="action-btn save"
                          title="Save"
                          onClick={(e) => {
                            e.stopPropagation();
                            handleSaveRename(session.id);
                          }}
                        >
                          <CheckIcon />
                        </button>
                      ) : (
                        <button
                          className="action-btn"
                          title="Rename"
                          onClick={(e) => handleStartRename(e, session)}
                        >
                          <EditIcon />
                        </button>
                      )}

                      <button
                        className="action-btn delete"
                        title="Delete"
                        onClick={(e) => handleDeleteSession(e, session.id)}
                      >
                        <TrashIcon />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            ))
          )}
        </nav>

        {/* User profile */}
        <div className="sidebar-footer">
          <div className="user-profile">
            <div className="user-avatar">{userInitial}</div>
            <div className="user-info">
              <div className="user-name">{user?.username}</div>
              <div className="user-role">Citizen Portal</div>
            </div>
            <button
              className="logout-btn"
              onClick={logout}
              title="Sign out"
              aria-label="Sign out"
            >
              <LogoutIcon />
            </button>
          </div>
        </div>
      </aside>

      {/* ── MOBILE SIDEBAR BACKDROP ── */}
      {sidebarOpen && (
        <div
          className="sidebar-backdrop"
          onClick={() => setSidebarOpen(false)}
          aria-hidden="true"
        />
      )}

      {/* ── MAIN CONTENT ── */}
      <main className="main-content">
        {/* Top bar */}
        <header className="topbar">
          <div className="topbar-left">
            <button
              className="sidebar-toggle"
              onClick={() => setSidebarOpen((o) => !o)}
              aria-label="Toggle sidebar"
            >
              <MenuIcon />
            </button>

            {/* Direct 1-tap New Chat button for Mobile & Quick Access */}
            <button
              className="topbar-new-chat-btn"
              onClick={handleNewChat}
              title="Start New Chat"
              aria-label="New Chat"
            >
              <PlusIcon />
              <span className="topbar-new-chat-label">New Chat</span>
            </button>

            <span className="model-badge">JanSeva AI</span>
          </div>

          <div className="topbar-right">
            {/* Siri Voice Mode Call Trigger */}
            <button
              className="siri-trigger-btn"
              onClick={() => setIsSiriOpen(true)}
              title="Start Siri Voice-to-Voice Conversation"
            >
              <MicIcon />
              <span>Voice Mode</span>
            </button>

            {/* State Filter Selector */}
            <CustomDropdown
              options={INDIAN_STATES_AND_UTS}
              value={selectedState}
              onChange={setSelectedState}
              icon={<MapPinIcon />}
              title="Filter schemes by State or Central Govt"
              searchable={true}
              isState={true}
            />

            {/* Language Selector */}
            <CustomDropdown
              options={[
                { value: 'auto', label: 'Auto (Multilingual)' },
                { value: 'en',   label: 'English' },
                { value: 'hi',   label: 'हिंदी (Hindi)' },
                { value: 'kn',   label: 'ಕನ್ನಡ (Kannada)' },
                { value: 'ta',   label: 'தமிழ் (Tamil)' },
                { value: 'te',   label: 'తెలుగు (Telugu)' },
                { value: 'mr',   label: 'मराठी (Marathi)' },
                { value: 'bn',   label: 'বাংলা (Bengali)' },
                { value: 'gu',   label: 'ગુજરાતી (Gujarati)' },
                { value: 'ml',   label: 'മലയാളം (Malayalam)' },
                { value: 'pa',   label: 'ਪੰਜਾਬੀ (Punjabi)' },
              ]}
              value={language}
              onChange={setLanguage}
              icon={<GlobeIcon />}
              title="Select language"
              searchable={false}
              isState={false}
            />
          </div>
        </header>

        {/* ChatUI renders chat-area + input-section */}
        <ChatUI
          key={activeSessionId || 'new'}
          sessionId={activeSessionId}
          initialMessages={activeMessages}
          onSessionStarted={(newId) => setActiveSessionId(newId)}
          language={language}
          selectedState={selectedState}
          username={user?.username}
          onMessageSent={handleMessageSent}
        />

        {/* Siri Continuous Voice-to-Voice Assistant Modal */}
        <SiriVoiceModal
          isOpen={isSiriOpen}
          onClose={() => setIsSiriOpen(false)}
          language={language}
          onLanguageChange={(newLang) => setLanguage(newLang)}
          selectedState={selectedState}
          activeSessionId={activeSessionId}
          onSessionStarted={(newId) => setActiveSessionId(newId)}
          onMessageSent={handleMessageSent}
          username={user?.username}
        />
      </main>
    </div>
  );
};

/* ──────────────────────────────────────────────────────────────────────────
 * Auth redirect helper
 * ────────────────────────────────────────────────────────────────────────── */
const AuthRedirect = () => {
  const { isAuthenticated } = useAuth();
  return isAuthenticated ? <Navigate to="/" replace /> : <AuthForms />;
};

/* ──────────────────────────────────────────────────────────────────────────
 * Root App
 * ────────────────────────────────────────────────────────────────────────── */
function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/login" element={<AuthRedirect />} />
          <Route
            path="/"
            element={
              <ProtectedRoute>
                <ChatPage />
              </ProtectedRoute>
            }
          />
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  );
}

export default App;

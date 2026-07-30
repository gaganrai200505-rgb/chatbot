import React, { useState, useRef, useEffect } from 'react';
import { registerUser, loginUser, verifyOtp, resendOtp, forgotPassword, resetPassword } from './api';
import { useAuth } from './AuthContext';

/* ─── Icons ──────────────────────────────────────────────────────── */
const EyeIcon = ({ open }) => open ? (
  <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24"
    fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94"/>
    <path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19"/>
    <line x1="1" y1="1" x2="23" y2="23"/>
  </svg>
) : (
  <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24"
    fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/>
    <circle cx="12" cy="12" r="3"/>
  </svg>
);

const AlertIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24"
    fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
    style={{ flexShrink: 0, marginTop: '2px' }}>
    <circle cx="12" cy="12" r="10"/>
    <line x1="12" y1="8" x2="12" y2="12"/>
    <line x1="12" y1="16" x2="12.01" y2="16"/>
  </svg>
);

const SuccessIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24"
    fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
    style={{ flexShrink: 0, marginTop: '2px' }}>
    <circle cx="12" cy="12" r="10"/>
    <polyline points="9 12 11 14 15 10"/>
  </svg>
);

/* ─── 6-box OTP input ────────────────────────────────────────────── */
const OtpInput = ({ value, onChange }) => {
  const inputs = useRef([]);
  const digits = (value.padEnd(6, ' ')).slice(0, 6).split('');

  const handleKey = (e, idx) => {
    if (e.key === 'Backspace') {
      const next = [...digits];
      next[idx] = ' ';
      onChange(next.join('').trimEnd());
      if (idx > 0) inputs.current[idx - 1]?.focus();
    } else if (/^\d$/.test(e.key)) {
      const next = [...digits];
      next[idx] = e.key;
      onChange(next.join('').trimEnd());
      if (idx < 5) inputs.current[idx + 1]?.focus();
    }
    e.preventDefault();
  };

  return (
    <div style={{ display: 'flex', gap: '8px', justifyContent: 'center', margin: '8px 0' }}>
      {digits.map((d, i) => (
        <input key={i} ref={el => inputs.current[i] = el}
          type="text" inputMode="numeric" maxLength={1}
          value={d.trim()} onChange={() => {}} onKeyDown={e => handleKey(e, i)}
          onFocus={e => e.target.select()}
          style={{
            width: '44px', height: '52px', textAlign: 'center',
            fontSize: '1.4rem', fontWeight: '700',
            background: 'rgba(255,255,255,0.08)',
            border: d.trim() ? '2px solid rgba(99,179,237,0.8)' : '2px solid rgba(255,255,255,0.2)',
            borderRadius: '10px', color: '#fff', outline: 'none',
            caretColor: 'transparent', transition: 'border-color 0.2s',
          }}
        />
      ))}
    </div>
  );
};

/* ─── Countdown timer hook ───────────────────────────────────────── */
const useCountdown = (initial = 60) => {
  const [left, setLeft] = useState(initial);
  useEffect(() => {
    if (left <= 0) return;
    const t = setTimeout(() => setLeft(l => l - 1), 1000);
    return () => clearTimeout(t);
  }, [left]);
  return [left, (s = initial) => setLeft(s)];
};

/* ─── Message box ────────────────────────────────────────────────── */
const MsgBox = ({ msg, isError = true }) => msg ? (
  <div className="auth-error" role="alert"
    style={!isError ? { background: 'rgba(72,187,120,0.15)', borderColor: 'rgba(72,187,120,0.4)' } : {}}>
    {isError ? <AlertIcon /> : <SuccessIcon />}
    <span>{msg}</span>
  </div>
) : null;

/* ─── Main Component ─────────────────────────────────────────────── */
const AuthForms = () => {
  const { login } = useAuth();

  const [step, setStep]           = useState('login');
  const [username, setUsername]   = useState('');
  const [password, setPassword]   = useState('');
  const [email, setEmail]         = useState('');
  const [showPass, setShowPass]   = useState(false);
  const [otp, setOtp]             = useState('');
  const [newPass, setNewPass]     = useState('');
  const [showNewPass, setShowNewPass] = useState(false);
  const [error, setError]         = useState('');
  const [success, setSuccess]     = useState('');
  const [loading, setLoading]     = useState(false);
  const [countdown, resetCountdown] = useCountdown(60);

  const clear = () => { setError(''); setSuccess(''); };
  const goTo  = (s) => { clear(); setStep(s); };

  const extractError = (err) => {
    const data = err.response?.data;
    if (typeof data === 'string' && data.trim().startsWith('<')) return 'Server error. Please try again.';
    if (data?.error) return data.error;
    if (data && typeof data === 'object') return Object.values(data).flat().join(' ');
    return err.message || 'Something went wrong.';
  };

  const handleLogin = async (e) => {
    e.preventDefault(); clear(); setLoading(true);
    try { await loginUser(username, password); login(username); }
    catch (err) { setError(extractError(err)); }
    finally { setLoading(false); }
  };

  const handleSignup = async (e) => {
    e.preventDefault(); clear(); setLoading(true);
    try { await registerUser(username, password, email); setOtp(''); resetCountdown(60); setStep('verify-otp'); }
    catch (err) { setError(extractError(err)); }
    finally { setLoading(false); }
  };

  const handleVerifyOtp = async (e) => {
    e.preventDefault();
    const code = otp.replace(/\s/g, '');
    if (code.length < 6) { setError('Please enter all 6 digits.'); return; }
    clear(); setLoading(true);
    try {
      await verifyOtp(username, code);
      setSuccess('Email verified! Signing you in…');
      await loginUser(username, password);
      login(username);
    }
    catch (err) { setError(extractError(err)); }
    finally { setLoading(false); }
  };

  const handleResendVerify = async () => {
    if (countdown > 0) return;
    clear(); setLoading(true);
    try { await resendOtp(username); setSuccess('New OTP sent! Check your email.'); resetCountdown(60); }
    catch (err) { setError(extractError(err)); }
    finally { setLoading(false); }
  };

  const handleForgotEmail = async (e) => {
    e.preventDefault(); clear(); setLoading(true);
    try {
      await forgotPassword(email);
      setSuccess('If your email is registered, a reset code has been sent.');
      setOtp(''); resetCountdown(60); setStep('forgot-otp');
    }
    catch (err) { setError(extractError(err)); }
    finally { setLoading(false); }
  };

  const handleResetPass = async (e) => {
    e.preventDefault();
    const code = otp.replace(/\s/g, '');
    if (code.length < 6) { setError('Please enter all 6 digits.'); return; }
    clear(); setLoading(true);
    try {
      await resetPassword(email, code, newPass);
      setSuccess('Password reset! Redirecting to Sign In…');
      setTimeout(() => { goTo('login'); setOtp(''); setNewPass(''); }, 2000);
    }
    catch (err) { setError(extractError(err)); }
    finally { setLoading(false); }
  };

  const resendBtn = (handler) => (
    <p style={{ marginTop: '12px', fontSize: '0.8rem', color: 'rgba(255,255,255,0.45)', textAlign: 'center' }}>
      Didn't receive it?{' '}
      <button onClick={handler} disabled={countdown > 0 || loading}
        style={{ background: 'none', border: 'none', fontSize: '0.8rem',
          cursor: countdown > 0 ? 'default' : 'pointer',
          color: countdown > 0 ? 'rgba(255,255,255,0.25)' : 'rgba(99,179,237,0.85)' }}>
        {countdown > 0 ? `Resend in ${countdown}s` : 'Resend Code'}
      </button>
    </p>
  );

  return (
    <div className="auth-page">
      <div className="auth-orb auth-orb-1" />
      <div className="auth-orb auth-orb-2" />
      <div className="auth-orb auth-orb-3" />
      <div className="auth-card">

        {/* Logo */}
        <div className="auth-logo">
          <div className="auth-logo-icon">
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none"
              stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
            </svg>
          </div>
          <h1 className="auth-app-name">JanSeva AI</h1>
          <p className="auth-subtitle">Your Government Schemes Assistant</p>
        </div>

        {/* ── Sign In ── */}
        {step === 'login' && (<>
          <div className="auth-tabs" role="tablist">
            <button role="tab" aria-selected className="auth-tab active" id="tab-login">Sign In</button>
            <button role="tab" className="auth-tab" id="tab-signup" onClick={() => goTo('signup')}>Sign Up</button>
          </div>
          <form onSubmit={handleLogin} className="auth-form" noValidate>
            <div className="auth-field">
              <label htmlFor="l-user">Username</label>
              <input id="l-user" type="text" className="auth-input" value={username}
                onChange={e => setUsername(e.target.value)} placeholder="Enter your username"
                required autoFocus autoComplete="username" />
            </div>
            <div className="auth-field">
              <label htmlFor="l-pass">Password</label>
              <div className="auth-input-wrap">
                <input id="l-pass" type={showPass ? 'text' : 'password'} className="auth-input"
                  value={password} onChange={e => setPassword(e.target.value)}
                  placeholder="Enter your password" required autoComplete="current-password" />
                <button type="button" className="auth-eye-btn" onClick={() => setShowPass(!showPass)}>
                  <EyeIcon open={showPass} />
                </button>
              </div>
            </div>
            <button type="button" onClick={() => goTo('forgot-email')}
              style={{ background: 'none', border: 'none', color: 'rgba(99,179,237,0.85)', fontSize: '0.8rem',
                cursor: 'pointer', textAlign: 'right', width: '100%', marginTop: '-4px', marginBottom: '4px' }}>
              Forgot password?
            </button>
            <MsgBox msg={error} isError />
            <MsgBox msg={success} isError={false} />
            <button type="submit" className="auth-submit" disabled={loading}>
              {loading ? <span className="auth-spinner" /> : 'Sign In'}
            </button>
          </form>
          <p className="auth-footer">Don't have an account? <button className="auth-switch" onClick={() => goTo('signup')}>Sign Up</button></p>
        </>)}

        {/* ── Sign Up ── */}
        {step === 'signup' && (<>
          <div className="auth-tabs" role="tablist">
            <button role="tab" className="auth-tab" id="tab-login-s" onClick={() => goTo('login')}>Sign In</button>
            <button role="tab" aria-selected className="auth-tab active" id="tab-signup-s">Sign Up</button>
          </div>
          <form onSubmit={handleSignup} className="auth-form" noValidate>
            <div className="auth-field">
              <label htmlFor="su-user">Username</label>
              <input id="su-user" type="text" className="auth-input" value={username}
                onChange={e => setUsername(e.target.value)} placeholder="Choose a username"
                required autoFocus autoComplete="username" />
            </div>
            <div className="auth-field">
              <label htmlFor="su-email">
                Email <span style={{ color: 'rgba(255,255,255,0.45)', fontSize: '0.75rem' }}>(required for verification)</span>
              </label>
              <input id="su-email" type="email" className="auth-input" value={email}
                onChange={e => setEmail(e.target.value)} placeholder="your@email.com"
                required autoComplete="email" />
            </div>
            <div className="auth-field">
              <label htmlFor="su-pass">Password</label>
              <div className="auth-input-wrap">
                <input id="su-pass" type={showPass ? 'text' : 'password'} className="auth-input"
                  value={password} onChange={e => setPassword(e.target.value)}
                  placeholder="Min. 8 characters" required minLength={8} autoComplete="new-password" />
                <button type="button" className="auth-eye-btn" onClick={() => setShowPass(!showPass)}>
                  <EyeIcon open={showPass} />
                </button>
              </div>
              <p style={{ fontSize: '0.75rem', color: 'rgba(255,255,255,0.4)', marginTop: '4px' }}>
                Min. 8 characters. Avoid common words.
              </p>
            </div>
            <MsgBox msg={error} isError />
            <button type="submit" className="auth-submit" disabled={loading}>
              {loading ? <span className="auth-spinner" /> : 'Create Account'}
            </button>
          </form>
          <p className="auth-footer">Already have an account? <button className="auth-switch" onClick={() => goTo('login')}>Sign In</button></p>
        </>)}

        {/* ── Email Verification OTP ── */}
        {step === 'verify-otp' && (
          <div style={{ textAlign: 'center' }}>
            <div style={{ fontSize: '2.5rem', marginBottom: '8px' }}>📧</div>
            <h2 style={{ color: '#fff', fontWeight: '700', marginBottom: '6px' }}>Verify your email</h2>
            <p style={{ color: 'rgba(255,255,255,0.55)', fontSize: '0.875rem', marginBottom: '20px' }}>
              A 6-digit code was sent to{' '}
              <strong style={{ color: 'rgba(99,179,237,0.9)' }}>{email}</strong>
            </p>
            <form onSubmit={handleVerifyOtp} className="auth-form" noValidate>
              <OtpInput value={otp} onChange={setOtp} />
              <p style={{ fontSize: '0.75rem', color: 'rgba(255,255,255,0.35)', margin: '8px 0 16px' }}>
                Code expires in 10 minutes
              </p>
              <MsgBox msg={error} isError />
              <MsgBox msg={success} isError={false} />
              <button type="submit" className="auth-submit"
                disabled={loading || otp.replace(/\s/g, '').length < 6}>
                {loading ? <span className="auth-spinner" /> : 'Verify Email'}
              </button>
            </form>
            {resendBtn(handleResendVerify)}
            <button onClick={() => goTo('signup')}
              style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'rgba(255,255,255,0.35)',
                fontSize: '0.75rem', marginTop: '8px', display: 'block', margin: '8px auto 0' }}>
              ← Back to Sign Up
            </button>
          </div>
        )}

        {/* ── Forgot Password: Enter Email ── */}
        {step === 'forgot-email' && (
          <div>
            <button onClick={() => goTo('login')}
              style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'rgba(255,255,255,0.45)',
                fontSize: '0.8rem', marginBottom: '12px' }}>
              ← Back to Sign In
            </button>
            <h2 style={{ color: '#fff', fontWeight: '700', marginBottom: '6px' }}>Forgot Password?</h2>
            <p style={{ color: 'rgba(255,255,255,0.55)', fontSize: '0.875rem', marginBottom: '20px' }}>
              Enter your registered email and we'll send you a reset code.
            </p>
            <form onSubmit={handleForgotEmail} className="auth-form" noValidate>
              <div className="auth-field">
                <label htmlFor="fp-email">Email Address</label>
                <input id="fp-email" type="email" className="auth-input" value={email}
                  onChange={e => setEmail(e.target.value)} placeholder="your@email.com"
                  required autoFocus autoComplete="email" />
              </div>
              <MsgBox msg={error} isError />
              <MsgBox msg={success} isError={false} />
              <button type="submit" className="auth-submit" disabled={loading}>
                {loading ? <span className="auth-spinner" /> : 'Send Reset Code'}
              </button>
            </form>
          </div>
        )}

        {/* ── Forgot Password: Enter OTP + New Password ── */}
        {step === 'forgot-otp' && (
          <div>
            <div style={{ fontSize: '2.5rem', textAlign: 'center', marginBottom: '8px' }}>🔒</div>
            <h2 style={{ color: '#fff', fontWeight: '700', marginBottom: '6px', textAlign: 'center' }}>Reset Password</h2>
            <p style={{ color: 'rgba(255,255,255,0.55)', fontSize: '0.875rem', marginBottom: '20px', textAlign: 'center' }}>
              Enter the code sent to <strong style={{ color: 'rgba(99,179,237,0.9)' }}>{email}</strong>
            </p>
            <form onSubmit={handleResetPass} className="auth-form" noValidate>
              <OtpInput value={otp} onChange={setOtp} />
              <div className="auth-field" style={{ marginTop: '16px' }}>
                <label htmlFor="rp-pass">New Password</label>
                <div className="auth-input-wrap">
                  <input id="rp-pass" type={showNewPass ? 'text' : 'password'} className="auth-input"
                    value={newPass} onChange={e => setNewPass(e.target.value)}
                    placeholder="Min. 8 characters" required minLength={8} autoComplete="new-password" />
                  <button type="button" className="auth-eye-btn" onClick={() => setShowNewPass(!showNewPass)}>
                    <EyeIcon open={showNewPass} />
                  </button>
                </div>
              </div>
              <MsgBox msg={error} isError />
              <MsgBox msg={success} isError={false} />
              <button type="submit" className="auth-submit"
                disabled={loading || otp.replace(/\s/g, '').length < 6 || newPass.length < 8}>
                {loading ? <span className="auth-spinner" /> : 'Reset Password'}
              </button>
            </form>
            {resendBtn(handleForgotEmail)}
          </div>
        )}

      </div>
    </div>
  );
};

export default AuthForms;

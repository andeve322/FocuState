import React, { useState } from 'react';
import { motion } from 'framer-motion';
import { Mail, Lock, AlertTriangle, Loader } from 'lucide-react';
import { registerUser, loginUser, loginWithGoogle, checkUsernameAvailability, setUsername, resendVerificationEmail, getCurrentUser, getUserProfile, logoutUser } from './firebase';

export default function AuthModal({ onAuthSuccess, onClose }) {
  const [isLogin, setIsLogin] = useState(true);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [username, setUsernameInput] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [verificationPending, setVerificationPending] = useState(false);
  const [resendMessage, setResendMessage] = useState('');
  const [chooseUsernameMode, setChooseUsernameMode] = useState(false);
  const [chosenUsername, setChosenUsername] = useState('');
  const [usernameChecking, setUsernameChecking] = useState(false);
  const [usernameError, setUsernameError] = useState('');
  const [stayLoggedIn, setStayLoggedIn] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    if (!email || !password || (!isLogin && !username)) {
      setError('Please fill in all fields');
      setLoading(false);
      return;
    }

    try {
      let result;
      if (isLogin) {
        result = await loginUser(email, password);
      } else {
        // Check username availability first
        const avail = await checkUsernameAvailability(username);
        if (!avail.success || !avail.available) {
          setError(avail.error || 'Username is taken');
          setLoading(false);
          return;
        }
        result = await registerUser(email, password, username);
      }

        if (result.success) {
          if (!isLogin) {
            // If registration sent a verification email, require verification before proceeding.
            if (result.emailSent) {
              setVerificationPending(true);
              setError('Verification email sent — please check your inbox and confirm your email before clicking "I verified".');
              setLoading(false);
              return;
            }

            // If email verification could not be sent, attempt to set the username (best-effort)
            const setResult = await setUsername(result.user.uid, username);
            if (!setResult.success) {
              setError(setResult.error || 'Failed to set username');
              setLoading(false);
              return;
            }
          }
          onAuthSuccess(result.user, stayLoggedIn);
          onClose();
        } else {
          setError(result.error);
        }
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleGoogleLogin = async () => {
    setError('');
    setLoading(true);
    try {
      const result = await loginWithGoogle();
      if (result.success) {
        // If the user exists in Firestore and already has a username, proceed.
        try {
          const profile = await getUserProfile(result.user.uid);
          const hasUsername = profile && profile.success && profile.data && profile.data.username;
          if (hasUsername) {
            onAuthSuccess(result.user, stayLoggedIn);
            onClose();
            return;
          }
        } catch (e) {
          // If profile fetch fails, fall back to showing username modal
          console.warn('Could not load profile after Google login:', e);
        }

        // No username set: prompt the user to choose one
        setChooseUsernameMode(true);
        setChosenUsername('');
        setUsernameError('');
        setLoading(false);
        return;
      } else {
        setError(result.error);
      }
    } catch (err) {
      setError(err.message);
    } finally {
      if (!chooseUsernameMode) setLoading(false);
    }
  };

  const handleChooseUsername = async (e) => {
    e && e.preventDefault && e.preventDefault();
    setUsernameError('');
    if (!chosenUsername || chosenUsername.trim().length < 3) {
      setUsernameError('Enter a username (3-20 characters)');
      return;
    }
    setUsernameChecking(true);
    try {
      const avail = await checkUsernameAvailability(chosenUsername.trim());
      if (!avail.success || !avail.available) {
        setUsernameError(avail.error || 'Username is not available');
        setUsernameChecking(false);
        return;
      }

      // Reserve username server-side
      const cur = getCurrentUser();
      if (!cur) {
        setUsernameError('No authenticated user found. Please try logging in again.');
        setUsernameChecking(false);
        return;
      }
      const setResult = await setUsername(cur.uid, chosenUsername.trim());
      if (!setResult.success) {
        setUsernameError(setResult.error || 'Failed to set username');
        setUsernameChecking(false);
        return;
      }

      // Success: finish auth flow
      onAuthSuccess(cur, stayLoggedIn);
      onClose();
    } catch (err) {
      setUsernameError(err.message || 'Failed to set username');
    } finally {
      setUsernameChecking(false);
    }
  };

  const handleCancelChooseUsername = async () => {
    // Sign out the temporary Google session to force the user to login again
    try { await logoutUser(); } catch (e) {}
    setChooseUsernameMode(false);
    setChosenUsername('');
    setUsernameError('');
    setError('Sign in cancelled');
  };

  const handleIVerified = async () => {
    setError('');
    setResendMessage('');
    setLoading(true);
    try {
      const loginResult = await loginUser(email, password);
      if (!loginResult.success) {
        setError(loginResult.error || 'Failed to sign in — please try logging in manually');
        setLoading(false);
        return;
      }
      // Ensure latest user state
      const cur = getCurrentUser();
      if (cur && typeof cur.reload === 'function') await cur.reload();
      const verified = (cur && cur.emailVerified) || (loginResult.user && loginResult.user.emailVerified);
      if (!verified) {
        setError('Email not yet verified. Please check your inbox or click "Resend verification email".');
        setLoading(false);
        return;
      }
      // Verified — set username and continue
      const setResult = await setUsername(loginResult.user.uid, username);
      if (!setResult.success) {
        setError(setResult.error || 'Failed to set username after verification');
        setLoading(false);
        return;
      }
      onAuthSuccess(loginResult.user, stayLoggedIn);
      onClose();
    } catch (err) {
      setError(err.message || 'Verification check failed');
    } finally {
      setLoading(false);
    }
  };

  const handleResend = async () => {
    setError('');
    setResendMessage('');
    setLoading(true);
    try {
      const r = await resendVerificationEmail(email, password);
      if (r.success) {
        setResendMessage('Verification email resent — check your inbox.');
      } else {
        setError(r.error || 'Failed to resend verification email');
      }
    } catch (err) {
      setError(err.message || 'Failed to resend verification email');
    } finally {
      setLoading(false);
    }
  };

  // If we're in the Google choose-username flow, render a minimal modal
  if (chooseUsernameMode) {
    return (
      <div className="modal-overlay">
        <motion.div
          initial={{ opacity: 0, scale: 0.9, y: 20 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.9, y: 20 }}
          transition={{ type: "spring", stiffness: 300, damping: 25 }}
          className="modal-content auth-modal"
          style={{
            maxWidth: '420px',
            backgroundColor: '#ffffff',
            borderRadius: '20px',
            padding: '32px',
            boxShadow: '0 20px 60px rgba(0, 0, 0, 0.15)',
            border: 'none'
          }}
        >
          <h2 style={{ marginBottom: '18px', textAlign: 'center', fontSize: '1.5rem', fontWeight: '700', color: '#5356d1ff' }}>Choose a username</h2>

          <div style={{ marginTop: '6px', padding: '6px' }}>
            <input
              type="text"
              value={chosenUsername}
              onChange={(e) => setChosenUsername(e.target.value)}
              placeholder="username"
              style={{ width: '100%', padding: '12px', borderRadius: 10, border: '1.5px solid #e5e7eb', fontSize: '0.95rem' }}
              disabled={usernameChecking}
            />
            {usernameError && <div style={{ color: '#b91c1c', marginTop: 8 }}>{usernameError}</div>}

            <div style={{ display: 'flex', gap: 10, marginTop: 14 }}>
              <button onClick={handleChooseUsername} disabled={usernameChecking} style={{ flex: 1, padding: '10px 12px', borderRadius: 8, background: '#10b981', color: 'white', border: 'none', fontWeight: 600 }}>{usernameChecking ? 'Checking…' : 'Continue'}</button>
              <button onClick={async () => { await handleCancelChooseUsername(); onClose(); }} disabled={usernameChecking} style={{ flex: 1, padding: '10px 12px', borderRadius: 8, background: '#fff', color: '#374151', border: '1px solid #e5e7eb' }}>Cancel</button>
            </div>
          </div>

          
        </motion.div>
      </div>
    );
  }

  return (
    <div className="modal-overlay">
      <motion.div
        initial={{ opacity: 0, scale: 0.9, y: 20 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.9, y: 20 }}
        transition={{ type: "spring", stiffness: 300, damping: 25 }}
        className="modal-content auth-modal"
        style={{
          maxWidth: '420px',
          backgroundColor: '#ffffff',
          borderRadius: '20px',
          padding: '40px',
          boxShadow: '0 20px 60px rgba(0, 0, 0, 0.15)',
          border: 'none'
        }}
      >
        <h2 style={{ 
          marginBottom: '30px', 
          textAlign: 'center',
          fontSize: '1.8rem',
          fontWeight: '700',
          color: '#5356d1ff'
        }}>
          {isLogin ? 'Welcome Back.' : 'Get Started.'}
        </h2>

        {verificationPending ? (
          <div style={{ padding: '10px 6px', textAlign: 'center' }}>
            <h3 style={{ marginTop: 0, marginBottom: 8 }}>Verification email sent</h3>
            <p style={{ margin: 0, color: '#6b7280' }}>We've sent a confirmation to <strong>{email}</strong>. After you confirm your email, click the button below.</p>
            {resendMessage && <div style={{ marginTop: 10, color: '#064e3b' }}>{resendMessage}</div>}
            <div style={{ display: 'flex', gap: '10px', justifyContent: 'center', marginTop: '16px' }}>
              <button onClick={handleIVerified} disabled={loading} style={{ padding: '10px 14px', borderRadius: 8, border: 'none', background: '#10b981', color: 'white', fontWeight: 600, cursor: loading ? 'not-allowed' : 'pointer' }}>I verified — Continue</button>
              <button onClick={handleResend} disabled={loading} style={{ padding: '10px 14px', borderRadius: 8, border: '1px solid #e5e7eb', background: 'white', color: '#374151', fontWeight: 600, cursor: loading ? 'not-allowed' : 'pointer' }}>Resend verification email</button>
            </div>
            <div style={{ marginTop: 12 }}>
              <button onClick={() => { setVerificationPending(false); setError(''); }} style={{ background: 'none', border: 'none', color: '#6366f1', cursor: 'pointer' }}>Cancel</button>
            </div>
          </div>
        ) : (
          <form onSubmit={handleSubmit}>


        {/* Close Button */}
          <div style={{ marginBottom: '20px' }}>
            <label style={{ 
              display: 'flex', 
              alignItems: 'center', 
              gap: '8px', 
              marginBottom: '8px', 
              fontSize: '0.95rem',
              fontWeight: '500',
              color: '#374151'
            }}>
              <Mail size={18} color="#6366f1" />
              Email
            </label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="your@email.com"
              style={{
                width: '100%',
                padding: '12px 14px',
                borderRadius: '10px',
                border: '1.5px solid #e5e7eb',
                fontSize: '0.95rem',
                fontFamily: 'inherit',
                transition: 'all 0.2s',
                outline: 'none',
                backgroundColor: '#f9fafb'
              }}
              onFocus={(e) => {
                e.target.style.borderColor = '#6366f1';
                e.target.style.backgroundColor = '#ffffff';
              }}
              onBlur={(e) => {
                e.target.style.borderColor = '#e5e7eb';
                e.target.style.backgroundColor = '#f9fafb';
              }}
              disabled={loading}
            />
          </div>

          {/* Password Input */}
          <div style={{ marginBottom: '20px' }}>
            <label style={{ 
              display: 'flex', 
              alignItems: 'center', 
              gap: '8px', 
              marginBottom: '8px', 
              fontSize: '0.95rem',
              fontWeight: '500',
              color: '#374151'
            }}>
              <Lock size={18} color="#6366f1" />
              Password
            </label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
              style={{
                width: '100%',
                padding: '12px 14px',
                borderRadius: '10px',
                border: '1.5px solid #e5e7eb',
                fontSize: '0.95rem',
                fontFamily: 'inherit',
                transition: 'all 0.2s',
                outline: 'none',
                backgroundColor: '#f9fafb'
              }}
              onFocus={(e) => {
                e.target.style.borderColor = '#6366f1';
                e.target.style.backgroundColor = '#ffffff';
              }}
              onBlur={(e) => {
                e.target.style.borderColor = '#e5e7eb';
                e.target.style.backgroundColor = '#f9fafb';
              }}
              disabled={loading}
            />
          </div>

          {/* Username Input (Signup only) */}
          {!isLogin && (
            <div style={{ marginBottom: '20px' }}>
              <label style={{ 
                display: 'flex', 
                alignItems: 'center', 
                gap: '8px', 
                marginBottom: '8px', 
                fontSize: '0.95rem',
                fontWeight: '500',
                color: '#374151'
              }}>
                Username
              </label>
              <input
                type="text"
                value={username}
                onChange={(e) => setUsernameInput(e.target.value)}
                placeholder="yourname"
                style={{
                  width: '100%',
                  padding: '12px 14px',
                  borderRadius: '10px',
                  border: '1.5px solid #e5e7eb',
                  fontSize: '0.95rem',
                  fontFamily: 'inherit',
                  transition: 'all 0.2s',
                  outline: 'none',
                  backgroundColor: '#f9fafb'
                }}
                onFocus={(e) => {
                  e.target.style.borderColor = '#6366f1';
                  e.target.style.backgroundColor = '#ffffff';
                }}
                onBlur={(e) => {
                  e.target.style.borderColor = '#e5e7eb';
                  e.target.style.backgroundColor = '#f9fafb';
                }}
                disabled={loading}
              />
              <div style={{ marginTop: '6px', fontSize: '0.8rem', color: '#6b7280' }}>
                6-20 characters, 
              </div>
            </div>
          )}

          {/* Error Message */}
          {error && (
            <motion.div 
              initial={{ opacity: 0, y: -10 }}
              animate={{ opacity: 1, y: 0 }}
              style={{
                marginBottom: '20px',
                padding: '12px 14px',
                borderRadius: '10px',
                backgroundColor: '#fecaca',
                display: 'flex',
                gap: '10px',
                alignItems: 'flex-start',
                fontSize: '0.9rem',
                color: '#991b1b',
                border: '1px solid #fca5a5'
              }}
            >
              <AlertTriangle size={18} style={{ flexShrink: 0, marginTop: '2px' }} />
              <span>{error}</span>
            </motion.div>
          )}

          {/* Stay Logged In Checkbox */}
          <div style={{ marginBottom: '25px', display: 'flex', alignItems: 'center', gap: '10px' }}>
            <input
              type="checkbox"
              id="stayLoggedIn"
              checked={stayLoggedIn}
              onChange={(e) => setStayLoggedIn(e.target.checked)}
              disabled={loading}
              style={{
                cursor: loading ? 'not-allowed' : 'pointer',
                width: '18px',
                height: '18px',
                accentColor: '#6366f1'
              }}
            />
            <label 
              htmlFor="stayLoggedIn"
              style={{ 
                fontSize: '0.95rem', 
                color: '#6b7280',
                cursor: loading ? 'not-allowed' : 'pointer',
                userSelect: 'none'
              }}
            >
              Keep me signed in
            </label>
          </div>

          {/* Submit Button */}
          <motion.button
            type="submit"
            disabled={loading}
            whileHover={!loading ? { scale: 1.02 } : {}}
            whileTap={!loading ? { scale: 0.98 } : {}}
            style={{
              width: '100%',
              padding: '12px 16px',
              borderRadius: '10px',
              backgroundColor: '#6366f1',
              color: 'white',
              border: 'none',
              fontSize: '0.95rem',
              fontWeight: '600',
              cursor: loading ? 'not-allowed' : 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '8px',
              transition: 'all 0.2s',
              opacity: loading ? 0.7 : 1
            }}
          >
            {loading && <Loader size={18} style={{ animation: 'spin 1s linear infinite' }} />}
            {isLogin ? 'Login' : 'Sign Up'}
          </motion.button>
        </form>
        )}

        {/* Social Login Divider */}
        <div style={{
          display: 'flex',
          alignItems: 'center',
          margin: '25px 0',
          gap: '10px'
        }}>
          <div style={{ flex: 1, height: '1px', backgroundColor: '#e5e7eb' }}></div>
          <span style={{ fontSize: '0.85rem', color: '#9ca3af', fontWeight: '500' }}>or continue with</span>
          <div style={{ flex: 1, height: '1px', backgroundColor: '#e5e7eb' }}></div>
        </div>

        {/* Social Login Buttons */}
        <div style={{
          display: 'grid',
          gridTemplateColumns: '1fr',
          gap: '12px',
          marginBottom: '20px'
        }}>
          {/* Google Login */}
          <motion.button
            onClick={handleGoogleLogin}
            disabled={loading}
            whileHover={!loading ? { scale: 1.02 } : {}}
            whileTap={!loading ? { scale: 0.98 } : {}}
            style={{
              padding: '12px 16px',
              borderRadius: '10px',
              backgroundColor: '#ffffff',
              border: '1.5px solid #e5e7eb',
              fontSize: '0.95rem',
              fontWeight: '500',
              cursor: loading ? 'not-allowed' : 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '10px',
              transition: 'all 0.2s',
              opacity: loading ? 0.6 : 1,
              color: '#374151'
            }}
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
              <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/>
              <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
              <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/>
              <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
            </svg>
            Google
          </motion.button>
        </div>

        {/* If we're in choose-username flow, show a small inline chooser */}
        {chooseUsernameMode && (
          <div style={{ marginTop: '18px', padding: '12px', borderRadius: 10, background: '#f8fafc' }}>
            <div style={{ marginBottom: 8, fontWeight: 600 }}>Choose a username</div>
            <div style={{ marginBottom: 8 }}>
              <input
                type="text"
                value={chosenUsername}
                onChange={(e) => setChosenUsername(e.target.value)}
                placeholder="username"
                style={{ width: '100%', padding: '10px', borderRadius: 8, border: '1px solid #e5e7eb' }}
                disabled={usernameChecking}
              />
            </div>
            {usernameError && <div style={{ color: '#b91c1c', marginBottom: 8 }}>{usernameError}</div>}
            <div style={{ display: 'flex', gap: 10 }}>
              <button onClick={handleChooseUsername} disabled={usernameChecking} style={{ flex: 1, padding: '10px 12px', borderRadius: 8, background: '#10b981', color: 'white', border: 'none' }}>{usernameChecking ? 'Checking…' : 'Continue'}</button>
              <button onClick={handleCancelChooseUsername} disabled={usernameChecking} style={{ flex: 1, padding: '10px 12px', borderRadius: 8, background: '#fff', color: '#374151', border: '1px solid #e5e7eb' }}>Cancel</button>
            </div>
          </div>
        )}

        {/* Toggle Login/Signup */}
        {!chooseUsernameMode && (
          <div style={{ marginTop: '20px', textAlign: 'center', fontSize: '0.95rem', color: '#6b7280' }}>
            {isLogin ? "Don't have an account? " : "Already have an account? "}
            <motion.button
              onClick={() => {
                setIsLogin(!isLogin);
                setError('');
                setEmail('');
                setPassword('');
              }}
              whileHover={{ scale: 1.05 }}
              whileTap={{ scale: 0.95 }}
              style={{
                background: 'none',
                border: 'none',
                color: '#6366f1',
                cursor: 'pointer',
                textDecoration: 'underline',
                fontSize: '0.95rem',
                fontWeight: '600'
              }}
              disabled={loading}
            >
              {isLogin ? 'Sign Up' : 'Login'}
            </motion.button>
          </div>
        )}

        
        <motion.button
          onClick={onClose}
          whileHover={{ scale: 1.02 }}
          whileTap={{ scale: 0.98 }}
          style={{
            marginTop: '20px',
            width: '100%',
            padding: '10px 16px',
            borderRadius: '10px',
            backgroundColor: '#f3f4f6',
            color: '#6b7280',
            border: 'none',
            fontSize: '0.9rem',
            fontWeight: '500',
            cursor: 'pointer',
            transition: 'all 0.2s'
          }}
        >
          Close
        </motion.button>

        <style>{`
          @keyframes spin {
            from { transform: rotate(0deg); }
            to { transform: rotate(360deg); }
          }
        `}</style>
      </motion.div>
    </div>
  );
}

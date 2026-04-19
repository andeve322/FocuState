import React, { useState, useEffect, useRef } from 'react';
import { getFirestore, doc, onSnapshot, getDoc } from 'firebase/firestore';
import { motion } from 'framer-motion';
import { User, LogOut, RotateCcw, AlertTriangle, CheckCircle, Loader, Copy, Check, Cloud, Trophy } from 'lucide-react';
import { Settings as SettingsIcon, Trash2 } from 'lucide-react';
import { sendPasswordResetEmail } from 'firebase/auth';
import { auth, deleteAllUserData, requestAccountDeletion } from './firebase';

export default function UserArea({ user, username, usernameLoading, onUpdateUsername, onLogout, autoSyncEnabled, setAutoSyncEnabled, leaderboardOptIn, setLeaderboardOptIn, flowTier }) {
  const [showDropdown, setShowDropdown] = useState(false);
  const [showReset, setShowReset] = useState(false);
  const [storageUsageBytes, setStorageUsageBytes] = useState(0);
  const [storageQuotaBytes, setStorageQuotaBytes] = useState(null);
  const [pendingLocalIncrement, setPendingLocalIncrement] = useState(0);
  const [resetLoading, setResetLoading] = useState(false);
  const [resetMessage, setResetMessage] = useState('');
  const [resetError, setResetError] = useState('');
  const [showSettings, setShowSettings] = useState(false);
  
  const [deleteLoading, setDeleteLoading] = useState(false);
  const [deleteError, setDeleteError] = useState('');
  const [deletionJobId, setDeletionJobId] = useState(null);
  const [deletionJobStatus, setDeletionJobStatus] = useState(null);
  const [copiedUID, setCopiedUID] = useState(false);
  const [desiredUsername, setDesiredUsername] = useState(username || '');
  const [usernameStatus, setUsernameStatus] = useState('');
  const [usernameError, setUsernameError] = useState('');
  const [usernameSaving, setUsernameSaving] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [deleteConfirmText, setDeleteConfirmText] = useState('');

  useEffect(() => {
    // Listen for optimistic client-side increments after successful uploads
    const handler = (e) => {
      try {
        const detail = e && e.detail ? e.detail : null;
        if (!detail || !user) return;
        const { uid, delta } = detail;
        if (uid !== user.uid) return;
        const add = Number(delta) || 0;
        if (add <= 0) return;
        // Add temporarily to displayed usage; server will correct when finalize runs
        setPendingLocalIncrement(p => p + add);
        // Auto-expire this optimistic addition after 90 seconds to avoid long-lived drift
        setTimeout(() => setPendingLocalIncrement(p => Math.max(0, p - add)), 90 * 1000);
      } catch (err) { console.warn('localStorageIncrement handler error', err); }
    };
    if (typeof window !== 'undefined') window.addEventListener('localStorageIncrement', handler);
    return () => { if (typeof window !== 'undefined') window.removeEventListener('localStorageIncrement', handler); };
  }, [user]);

  useEffect(() => {
    setDesiredUsername(username || '');
  }, [username]);

  // Listen for deletion job status when a jobId is present
  useEffect(() => {
    if (!deletionJobId) return;
    const db = getFirestore();
    const jobRef = doc(db, 'deletionJobs', deletionJobId);
    const unsub = onSnapshot(jobRef, (snap) => {
      if (!snap.exists()) return;
      const data = snap.data();
      setDeletionJobStatus(data.status || null);
    }, (err) => {
      console.warn('deletion job snapshot error', err);
    });
    return () => unsub();
  }, [deletionJobId]);

  const handleSaveUsername = async () => {
    if (!onUpdateUsername) return;
    setUsernameStatus('');
    setUsernameError('');
    setUsernameSaving(true);
    const result = await onUpdateUsername(desiredUsername);
    setUsernameSaving(false);
    if (result.success) {
      setUsernameStatus('Updated');
    } else {
      setUsernameError(result.error || 'Could not update');
    }
  };

  // Derived displayed usage includes any optimistic local increments
  const displayedStorageUsage = storageUsageBytes + (pendingLocalIncrement || 0);

  const handlePasswordReset = async () => {
    setResetError('');
    setResetMessage('');
    setResetLoading(true);

    try {
      await sendPasswordResetEmail(auth, user.email);
      setResetMessage(`Password reset email sent to ${user.email}`);
      setTimeout(() => {
        setShowReset(false);
        setResetMessage('');
      }, 3000);
    } catch (error) {
      setResetError(error.message || 'Failed to send reset email');
    } finally {
      setResetLoading(false);
    }
  };

  const handleCopyUID = async () => {
    try {
      await navigator.clipboard.writeText(user.uid);
      setCopiedUID(true);
      setTimeout(() => setCopiedUID(false), 2000);
    } catch (error) {
      console.error('Failed to copy UID:', error);
    }
  };

  if (showReset) {
    return (
      <motion.div
        className="modal-overlay"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        onClick={() => { setShowReset(false); setResetMessage(''); setResetError(''); }}
        style={{ zIndex: 1200 }}
      >
        <motion.div
          onClick={(e) => e.stopPropagation()}
          initial={{ scale: 0.95, y: 10, opacity: 0 }}
          animate={{ scale: 1, y: 0, opacity: 1 }}
          exit={{ scale: 0.95, y: 10, opacity: 0 }}
          transition={{ type: 'spring', damping: 25, stiffness: 300 }}
          style={{
            width: 'min(92%, 480px)',
            borderRadius: '16px',
            overflow: 'hidden',
            boxShadow: '0 30px 80px rgba(2,6,23,0.18)'
          }}
        >
          <div style={{
            background: 'linear-gradient(135deg, #4f46e5 0%, #6366f1 100%)',
            padding: '18px 20px',
            display: 'flex',
            alignItems: 'center',
            gap: '12px',
            color: 'white'
          }}>
            <div style={{
              width: '52px',
              height: '52px',
              borderRadius: '12px',
              background: 'rgba(255,255,255,0.12)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center'
            }}>
              <RotateCcw size={26} />
            </div>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: '1.1rem', fontWeight: 800 }}>Password Recovery</div>
              <div style={{ fontSize: '0.9rem', opacity: 0.9, marginTop: '4px' }}>We will send a link to reset your password.</div>
            </div>
            <button
              onClick={() => { setShowReset(false); setResetMessage(''); setResetError(''); }}
              style={{ background: 'transparent', border: 'none', color: 'white', cursor: 'pointer', padding: '6px' }}
              aria-label="Close"
            >
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M6 6L18 18M6 18L18 6" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg>
            </button>
          </div>

          <div style={{ background: 'white', padding: '22px 22px 26px 22px' }}>
            <p style={{ margin: 0, fontSize: '0.95rem', color: '#374151', marginBottom: '12px' }}>
              We'll send a password reset link to the email address associated with your account:
            </p>

            <div style={{
              marginTop: '10px',
              padding: '12px',
              borderRadius: '10px',
              backgroundColor: '#f8fafc',
              border: '1px solid #e6eefc',
              fontSize: '0.95rem',
              color: '#0f172a',
              wordBreak: 'break-all'
            }}>
              {user && user.email}
            </div>

            {resetMessage && (
              <motion.div initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }} style={{ marginTop: '14px', padding: '12px', borderRadius: '10px', backgroundColor: '#ecfdf5', color: '#065f46', display: 'flex', gap: '10px', alignItems: 'center' }}>
                <CheckCircle size={18} />
                <div style={{ fontSize: '0.9rem' }}>{resetMessage}</div>
              </motion.div>
            )}

            {resetError && (
              <div style={{ marginTop: '14px', padding: '12px', borderRadius: '10px', backgroundColor: '#fff1f2', color: '#8b1d1d', display: 'flex', gap: '10px', alignItems: 'center' }}>
                <AlertTriangle size={18} />
                <div style={{ fontSize: '0.9rem' }}>{resetError}</div>
              </div>
            )}

            <div style={{ display: 'flex', gap: '12px', marginTop: '18px' }}>
              <button
                onClick={() => { setShowReset(false); setResetMessage(''); setResetError(''); }}
                disabled={resetLoading}
                style={{
                  flex: 1,
                  padding: '12px 14px',
                  borderRadius: '10px',
                  border: '1px solid #e6eefc',
                  background: 'white',
                  color: '#475569',
                  fontWeight: 700,
                  cursor: resetLoading ? 'not-allowed' : 'pointer'
                }}
              >
                Cancel
              </button>
              <button
                onClick={handlePasswordReset}
                disabled={resetLoading}
                style={{
                  flex: 1,
                  padding: '12px 14px',
                  borderRadius: '10px',
                  border: 'none',
                  background: resetLoading ? '#a78bfa' : 'linear-gradient(90deg,#6366f1,#8b5cf6)',
                  backgroundColor: resetLoading ? '#a78bfa' : undefined,
                  color: 'white',
                  fontWeight: 800,
                  cursor: resetLoading ? 'not-allowed' : 'pointer'
                }}
              >
                {resetLoading ? <Loader size={16} style={{ animation: 'spin 1s linear infinite' }} /> : 'Send Reset Email'}
              </button>
            </div>
          </div>

          <style>{`
            @keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
          `}</style>
        </motion.div>
      </motion.div>
    );
  }

  

  if (showDeleteConfirm) {
    const canConfirm = deleteConfirmText.trim() === 'YES' && !deleteLoading;
    return (
      <motion.div 
        onClick={() => { setShowDeleteConfirm(false); setDeleteConfirmText(''); setDeleteError(''); }}
        initial={{ opacity: 0 }} 
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        style={{
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          backgroundColor: 'rgba(0, 0, 0, 0.4)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          zIndex: 1000,
          backdropFilter: 'blur(4px)'
        }}
      >
        <motion.div
          onClick={(e) => e.stopPropagation()}
          initial={{ scale: 0.85, opacity: 0, y: 20 }}
          animate={{ scale: 1, opacity: 1, y: 0 }}
          exit={{ scale: 0.85, opacity: 0, y: 20 }}
          transition={{ type: 'spring', damping: 25, stiffness: 300 }}
          style={{
            backgroundColor: 'white',
            borderRadius: '16px',
            padding: '28px',
            maxWidth: '420px',
            width: '90%',
            boxShadow: '0 20px 60px rgba(0, 0, 0, 0.15)',
            border: '1px solid #e5e7eb'
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '14px', marginBottom: '20px' }}>
            <div style={{
              width: '48px',
              height: '48px',
              background: 'linear-gradient(135deg, #fee2e2 0%, #fecaca 100%)',
              borderRadius: '12px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: '#dc2626',
              flexShrink: 0
            }}>
              <AlertTriangle size={26} />
            </div>
            <h2 style={{ margin: 0, fontSize: '1.35rem', fontWeight: '700', color: '#1f2937' }}>
              Delete Account?
            </h2>
          </div>
          <p style={{
            margin: '0 0 20px 0',
            fontSize: '0.95rem',
            color: '#6b7280',
            lineHeight: '1.6',
            letterSpacing: '-0.2px'
          }}>
            This action <strong style={{ color: '#1f2937' }}>cannot be undone</strong>. All your documents, flashcards, study data, and files will be permanently deleted.
          </p>
          <div style={{
            background: 'linear-gradient(135deg, #fef2f2 0%, #fef2f2 100%)',
            border: '1px solid #fecaca',
            borderRadius: '10px',
            padding: '14px',
            marginBottom: '18px',
            fontSize: '0.85rem',
            color: '#7f1d1d',
            lineHeight: '1.5',
            fontWeight: '500'
          }}>
            Type <span style={{ 
              background: 'white', 
              padding: '2px 6px', 
              borderRadius: '4px', 
              fontFamily: 'monospace',
              fontWeight: '600',
              color: '#dc2626'
            }}>YES</span> to confirm deletion:
          </div>
          <input
            value={deleteConfirmText}
            onChange={(e) => setDeleteConfirmText(e.target.value.toUpperCase())}
            disabled={deleteLoading}
            placeholder="Type YES"
            style={{
              width: '100%',
              padding: '11px 14px',
              borderRadius: '8px',
              border: deleteConfirmText === 'YES' ? '2px solid #10b981' : '1px solid #e5e7eb',
              fontSize: '0.9rem',
              marginBottom: '16px',
              fontWeight: '500',
              boxSizing: 'border-box',
              fontFamily: 'monospace',
              transition: 'all 0.2s ease',
              background: deleteConfirmText === 'YES' ? '#f0fdf4' : 'white',
              color: '#1f2937',
              outline: 'none'
            }}
            onFocus={(e) => !deleteLoading && (e.currentTarget.style.borderColor = '#10b981')}
            onBlur={(e) => (e.currentTarget.style.borderColor = deleteConfirmText === 'YES' ? '#10b981' : '#e5e7eb')}
          />
          {deleteError && (
            <motion.div 
              initial={{ opacity: 0, y: -10 }}
              animate={{ opacity: 1, y: 0 }}
              style={{
                marginBottom: '16px',
                padding: '12px 14px',
                borderRadius: '8px',
                backgroundColor: '#fee2e2',
                border: '1px solid #fecaca',
                display: 'flex',
                gap: '10px',
                alignItems: 'flex-start',
                color: '#dc2626',
                fontSize: '0.85rem'
              }}
            >
              <AlertTriangle size={18} style={{ flexShrink: 0, marginTop: '1px' }} />
              <span style={{ lineHeight: '1.5' }}>{deleteError}</span>
            </motion.div>
          )}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', marginTop: '20px' }}>
            <button
              onClick={() => { setShowDeleteConfirm(false); setDeleteConfirmText(''); setDeleteError(''); }}
              disabled={deleteLoading}
              style={{
                padding: '12px 16px',
                borderRadius: '8px',
                backgroundColor: 'white',
                color: '#6b7280',
                border: '1px solid #e5e7eb',
                fontSize: '0.9rem',
                fontWeight: '500',
                cursor: deleteLoading ? 'not-allowed' : 'pointer',
                transition: 'all 0.2s ease',
                opacity: deleteLoading ? 0.6 : 1
              }}
              onMouseEnter={(e) => {
                if (!deleteLoading) {
                  e.currentTarget.style.backgroundColor = '#f9fafb';
                  e.currentTarget.style.borderColor = '#d1d5db';
                }
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.backgroundColor = 'white';
                e.currentTarget.style.borderColor = '#e5e7eb';
              }}
            >
              Cancel
            </button>
            <button
                onClick={async () => {
                if (!canConfirm) return;
                setDeleteError('');
                setDeleteLoading(true);
                try {
                  // Enqueue deletion job via callable; backend worker will process it.
                  const res = await requestAccountDeletion();
                  if (!res.success) throw new Error(res.error || 'Failed to enqueue deletion');
                  const jobId = res.jobId || null;
                  console.log('Deletion enqueued, jobId=', jobId);
                  // Local sign-out and UI cleanup. Keep jobId so UI can show status if needed.
                  setDeletionJobId(jobId);
                  setDeleteLoading(false);
                  setShowDeleteConfirm(false);
                  setDeleteConfirmText('');
                  onLogout && onLogout();
                } catch (err) {
                  console.error('Delete profile failed:', err);
                  setDeleteError(err.message || 'Failed to delete profile');
                  setDeleteLoading(false);
                }
              }}
              disabled={!canConfirm}
              style={{
                padding: '12px 16px',
                borderRadius: '8px',
                backgroundColor: canConfirm ? '#ef4444' : '#fecaca',
                color: 'white',
                border: 'none',
                fontSize: '0.9rem',
                fontWeight: '600',
                cursor: canConfirm ? 'pointer' : 'not-allowed',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '8px',
                transition: 'all 0.2s ease',
                opacity: deleteLoading ? 0.8 : 1
              }}
              onMouseEnter={(e) => {
                if (canConfirm && !deleteLoading) {
                  e.currentTarget.style.backgroundColor = '#dc2626';
                }
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.backgroundColor = canConfirm ? '#ef4444' : '#fecaca';
              }}
            >
              {deleteLoading ? (
                <motion.span
                  animate={{ rotate: 360 }}
                  transition={{ duration: 1, repeat: Infinity, ease: 'linear' }}
                >
                  ⏳
                </motion.span>
              ) : (
                <>
                  <Trash2 size={16} /> Delete
                </>
              )}
            </button>
          </div>
        </motion.div>
      </motion.div>
    );
  }

  return (
    <div style={{ position: 'relative' }}>
      <motion.button 
        className="user-area-btn"
        whileHover={{ scale: 1.05 }}
        whileTap={{ scale: 0.95 }}
        style={{
          position: 'fixed',
          top: '20px',
          right: '20px',
          padding: '12px 16px',
          borderRadius: '8px',
          backgroundColor: '#10b981',
          color: 'white',
          border: 'none',
          cursor: 'pointer',
          fontSize: '0.9rem',
          fontWeight: '500',
          zIndex: 100,
          display: 'flex',
          alignItems: 'center',
          gap: '8px',
          maxWidth: '200px',
          overflow: 'hidden'
        }}
        onClick={() => setShowDropdown(!showDropdown)}
      >
        <User size={18} style={{ flexShrink: 0 }} />
        <span style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {username || user.email.split('@')[0]}
        </span>
      </motion.button>

      {/* Deletion job banner (shows when a deletion job was enqueued) */}
      {deletionJobId && (
        <div style={{ position: 'fixed', top: '68px', right: '20px', zIndex: 110, minWidth: '220px', borderRadius: 8, padding: '8px 12px', display: 'flex', alignItems: 'center', gap: 8, boxShadow: '0 8px 20px rgba(2,6,23,0.08)' }}>
          <div style={{ flex: 1, fontSize: '0.88rem', color: '#111827' }}>
            <div style={{ fontWeight: 700 }}>
              {deletionJobStatus ? `Account deletion: ${deletionJobStatus}` : 'Account deletion requested'}
            </div>
            <div style={{ fontSize: '0.78rem', color: '#6b7280', marginTop: 4, wordBreak: 'break-all' }}>Job: {deletionJobId}</div>
          </div>
          <button
            onClick={() => { try { navigator.clipboard.writeText(deletionJobId); } catch (e) { /* ignore */ } }}
            title="Copy job id"
            style={{ border: 'none', background: 'transparent', cursor: 'pointer', color: '#6b7280', padding: '6px' }}
          >
            Copy
          </button>
        </div>
      )}

      {/* Dropdown Menu */}
      {showDropdown && (
        <motion.div
          initial={{ opacity: 0, y: -10 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -10 }}
          transition={{ duration: 0.2 }}
          style={{
            position: 'fixed',
            top: '60px',
            right: '20px',
            borderRadius: '8px',
            backgroundColor: 'white',
            boxShadow: '0 4px 12px rgba(0, 0, 0, 0.15)',
            minWidth: '200px',
            zIndex: 101,
            overflow: 'hidden'
          }}
          onClick={(e) => e.stopPropagation()}
        >
          {/* Email Display */}
          <div style={{
            padding: '12px 16px',
            borderBottom: '1px solid #e5e7eb',
            fontSize: '0.85rem',
            color: '#6b7280',
          }}>
            <div style={{ fontWeight: '600', color: '#374151', marginBottom: '4px' }}>Username</div>
            <div style={{ fontSize: '0.95rem', color: '#111827', fontWeight: '600' }}>{username || '—'}</div>
          </div>

          {/* Storage Usage Display removed per request */}

          {/* Header Actions */}
          <div style={{
            padding: '12px 16px',
            borderBottom: '1px solid #e5e7eb',
            display: 'flex',
            alignItems: 'center',
            gap: '8px'
          }}>
            <button
              onClick={() => setShowSettings(!showSettings)}
              style={{
                padding: '8px 10px',
                borderRadius: '6px',
                border: '1px solid #e5e7eb',
                backgroundColor: showSettings ? '#eef2ff' : 'white',
                color: '#374151',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: '6px',
                fontSize: '0.85rem',
                fontWeight: 500
              }}
            >
              <SettingsIcon size={14} /> Settings
            </button>
          </div>

          {/* Settings Section */}
          {showSettings && (
            <div>
              {/* Username Change */}
              <div style={{
                padding: '12px 16px',
                borderBottom: '1px solid #e5e7eb',
                fontSize: '0.85rem',
                color: '#6b7280',
              }}>
                <div style={{ fontWeight: '600', color: '#374151', marginBottom: '6px' }}>Change Username</div>
                <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                  <input
                    value={desiredUsername}
                    onChange={(e) => setDesiredUsername(e.target.value)}
                    disabled={usernameSaving || usernameLoading}
                    style={{
                      flex: 1,
                      padding: '8px 10px',
                      borderRadius: '6px',
                      border: '1px solid #e5e7eb',
                      fontSize: '0.9rem'
                    }}
                    placeholder="new username"
                  />
                  <button
                    onClick={handleSaveUsername}
                    disabled={usernameSaving || usernameLoading}
                    style={{
                      padding: '8px 12px',
                      borderRadius: '6px',
                      border: 'none',
                      backgroundColor: usernameSaving || usernameLoading ? '#d1d5db' : '#6366f1',
                      color: 'white',
                      cursor: usernameSaving || usernameLoading ? 'not-allowed' : 'pointer'
                    }}
                  >
                    {usernameSaving || usernameLoading ? 'Saving...' : 'Save'}
                  </button>
                </div>
                <div style={{ marginTop: '6px', fontSize: '0.78rem', color: '#6b7280' }}>
                  3-20 chars, letters/numbers/._- only.
                </div>
                {usernameStatus && <div style={{ marginTop: '6px', fontSize: '0.8rem', color: '#10b981' }}>{usernameStatus}</div>}
                {usernameError && <div style={{ marginTop: '6px', fontSize: '0.8rem', color: '#dc2626' }}>{usernameError}</div>}
              </div>

              {/* Email Display */}
              <div style={{
                padding: '12px 16px',
                borderBottom: '1px solid #e5e7eb',
                fontSize: '0.85rem',
                color: '#6b7280',
              }}>
                <div style={{ fontWeight: '600', color: '#374151', marginBottom: '4px' }}>Email</div>
                <div style={{ wordBreak: 'break-all' }}>{user.email}</div>
              </div>

              {/* User ID Display - Clickable to Copy */}
              <button
                onClick={handleCopyUID}
                style={{
                  width: '100%',
                  padding: '12px 16px',
                  borderBottom: '1px solid #e5e7eb',
                  backgroundColor: copiedUID ? '#ecfdf5' : 'transparent',
                  border: 'none',
                  fontSize: '0.85rem',
                  color: '#6b7280',
                  cursor: 'pointer',
                  transition: 'background-color 0.2s',
                  textAlign: 'left'
                }}
                onMouseEnter={(e) => !copiedUID && (e.currentTarget.style.backgroundColor = '#f9fafb')}
                onMouseLeave={(e) => !copiedUID && (e.currentTarget.style.backgroundColor = 'transparent')}
              >
                <div style={{ fontWeight: '600', color: '#374151', marginBottom: '4px', display: 'flex', alignItems: 'center', gap: '8px' }}>
                  User ID
                  {copiedUID && <Check size={14} style={{ color: '#059669' }} />}
                </div>
                <div style={{ fontFamily: 'monospace', fontSize: '0.75rem', wordBreak: 'break-all', display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <span>{user.uid}</span>
                  <Copy size={12} style={{ flexShrink: 0, color: copiedUID ? '#059669' : '#9ca3af' }} />
                </div>
                {copiedUID && (
                  <div style={{ fontSize: '0.75rem', color: '#059669', marginTop: '4px' }}>Copied to clipboard!</div>
                )}
              </button>

              {/* Password Recovery Button */}
              <button
                onClick={() => setShowReset(true)}
                style={{
                  width: '100%',
                  padding: '12px 16px',
                  borderBottom: '1px solid #e5e7eb',
                  backgroundColor: 'transparent',
                  border: 'none',
                  color: '#3b82f6',
                  fontSize: '0.9rem',
                  fontWeight: '500',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '8px',
                  transition: 'background-color 0.2s'
                }}
                onMouseEnter={(e) => e.currentTarget.style.backgroundColor = '#f3f4f6'}
                onMouseLeave={(e) => e.currentTarget.style.backgroundColor = 'transparent'}
              >
                <RotateCcw size={16} />
                Change Password
              </button>

              

              {/* Danger Zone: Delete Profile and Data */}
              <button
                  onClick={() => { setDeleteError(''); setDeleteConfirmText(''); setShowDeleteConfirm(true); }}
                disabled={deleteLoading}
                style={{
                  width: '100%',
                  padding: '12px 16px',
                  borderBottom: '1px solid #e5e7eb',
                  backgroundColor: deleteLoading ? '#fee2e2' : 'transparent',
                  border: 'none',
                  color: '#ef4444',
                  fontSize: '0.9rem',
                  fontWeight: '500',
                  cursor: deleteLoading ? 'not-allowed' : 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '8px',
                  transition: 'background-color 0.2s'
                }}
                title="Delete profile and all data"
                onMouseEnter={(e) => !deleteLoading && (e.currentTarget.style.backgroundColor = '#fee2e2')}
                onMouseLeave={(e) => e.currentTarget.style.backgroundColor = 'transparent'}
              >
                <Trash2 size={16} />
                {deleteLoading ? 'Deleting…' : 'Delete Profile & Data'}
              </button>
            </div>
          )}




          {/* Logout Button */}
          

          <button
            onClick={onLogout}
            style={{
              width: '100%',
              padding: '12px 16px',
              backgroundColor: 'transparent',
              border: 'none',
              color: '#ef4444',
              fontSize: '0.9rem',
              fontWeight: '500',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
              transition: 'background-color 0.2s'
            }}
            onMouseEnter={(e) => e.currentTarget.style.backgroundColor = '#fee2e2'}
            onMouseLeave={(e) => e.currentTarget.style.backgroundColor = 'transparent'}
          >
            <LogOut size={16} />
            Logout
          </button>
        </motion.div>
      )}

      {/* Backdrop to close menu */}
      {showDropdown && (
        <div
          style={{
            position: 'fixed',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            zIndex: 50
          }}
          onClick={() => setShowDropdown(false)}
        />
      )}
    </div>
  );
}

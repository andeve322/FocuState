
// --- IMPORTS & INITIALIZATION ---
const admin = require('firebase-admin');
const functions = require('firebase-functions'); // v1 API for Gen 1 callable
const { onRequest, onCall } = require('firebase-functions/v2/https');
const { onObjectFinalized, onObjectDeleted } = require('firebase-functions/v2/storage');
const stripe = require('stripe');

admin.initializeApp();
const stripeSecret = process.env.STRIPE_SECRET_KEY;
const stripeClient = stripe(stripeSecret);

function setCors(res) {
  res.set('Access-Control-Allow-Origin', '*');
  res.set('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.set('Access-Control-Allow-Headers', 'Content-Type, Authorization');
}

/**
 * HTTP endpoint to force-resync a user's subscription from Stripe.
 * POST body: none. Caller must supply Authorization: Bearer <Firebase ID Token>
 * The function will lookup the user's stripeSubscriptionId and refresh
 * `subscriptionStatus`, `current_period_end`, and `next_billing_date` (if available)
 * on the user's Firestore doc and mirror into `settings/preferences`.
 */
exports.resyncSubscription = onRequest({ region: 'us-central1' }, async (req, res) => {
  setCors(res);
  if (req.method === 'OPTIONS') { res.status(204).send(''); return; }
  if (req.method !== 'POST') { res.status(405).send('Method Not Allowed'); return; }

  const authHeader = req.get('Authorization') || '';
  const match = authHeader.match(/Bearer\s+(.*)/i);
  if (!match) { res.status(401).json({ error: 'Missing Authorization header' }); return; }
  const idToken = match[1];

  let uid;
  try { const decoded = await admin.auth().verifyIdToken(idToken); uid = decoded.uid; } catch (err) { console.error('resyncSubscription: invalid id token', err); res.status(401).json({ error: 'Invalid ID token' }); return; }

  try {
    const db = admin.firestore();
    const userRef = db.doc(`users/${uid}`);
    const userSnap = await userRef.get();
    if (!userSnap.exists) { res.status(404).json({ error: 'User not found' }); return; }
    const userData = userSnap.data() || {};
    const subscriptionId = userData.stripeSubscriptionId || userData.stripeSubscriptionID || null;
    if (!subscriptionId) { res.status(400).json({ error: 'No subscription id on user' }); return; }

    // Retrieve subscription from Stripe
    const sub = await stripeClient.subscriptions.retrieve(subscriptionId);
    const cancelAt = !!sub.cancel_at_period_end;
    const storedStatus = (cancelAt && sub.status === 'active') ? 'canceling' : sub.status;

    const update = {
      subscriptionStatus: storedStatus,
      cancel_at_period_end: cancelAt,
      stripeSubscriptionId: sub.id,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    };
    if (sub.current_period_end) update.current_period_end = admin.firestore.Timestamp.fromMillis(sub.current_period_end * 1000);

    // Try to fetch the upcoming invoice to surface next_billing_date
    // Try to fetch the upcoming invoice to surface a next billing date and
    // prefer that value for the stored `current_period_end` so the client
    // matches the Stripe Customer Portal's next billing date.
    try {
      const upcoming = await stripeClient.invoices.retrieveUpcoming({ subscription: sub.id });
      if (upcoming && upcoming.next_payment_attempt) {
        const ts = admin.firestore.Timestamp.fromMillis(upcoming.next_payment_attempt * 1000);
        update.next_billing_date = ts;
        // Overwrite current_period_end with the upcoming invoice attempt
        // so the app shows the same date as the Stripe portal.
        update.current_period_end = ts;
      }
    } catch (err) {
      console.warn('Could not retrieve upcoming invoice for subscription in checkout handler:', err && err.message ? err.message : err);
    }

    await userRef.set(update, { merge: true });

    // Mirror into preferences
    try {
      const prefs = {
        subscriptionStatus: update.subscriptionStatus,
        cancel_at_period_end: update.cancel_at_period_end,
        stripeSubscriptionId: update.stripeSubscriptionId,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      };
      if (update.current_period_end) prefs.current_period_end = update.current_period_end;
      if (update.next_billing_date) prefs.next_billing_date = update.next_billing_date;
      await db.doc(`users/${uid}/settings/preferences`).set(prefs, { merge: true });
    } catch (e) { console.warn('resyncSubscription: could not mirror to preferences', e && e.message ? e.message : e); }

    res.json({ success: true, updated: update });
  } catch (err) {
    console.error('resyncSubscription failed:', err);
    res.status(500).json({ error: err.message || 'Failed to resync subscription' });
  }
});

/**
 * Firestore trigger: keep BreakSnake leaderboard in sync with per-user highScore
 * When users/{uid}/game/snake is created/updated/deleted, upsert/delete
 * the document at leaderboards/snake/entries/{uid} so the leaderboard is authoritative.
 */
exports.syncSnakeHighScoreToLeaderboard = functions.firestore.document('users/{uid}/game/snake').onWrite(async (change, context) => {
  const uid = context.params.uid;
  const db = admin.firestore();
  try {
    // If deleted, remove leaderboard entry
    if (!change.after.exists) {
      await db.doc(`leaderboards/snake/entries/${uid}`).delete().catch(() => {});
      console.log('syncSnakeHighScoreToLeaderboard: deleted leaderboard entry for', uid);
      return null;
    }

    const newData = change.after.data() || {};
    const highScore = Number(newData.highScore) || 0;

    // If no meaningful score, ensure no leaderboard entry exists
    if (!highScore || highScore <= 0) {
      await db.doc(`leaderboards/snake/entries/${uid}`).delete().catch(() => {});
      console.log('syncSnakeHighScoreToLeaderboard: removed empty score for', uid);
      return null;
    }

    // Fetch username (best-effort) from user profile
    let username = null;
    try {
      const userSnap = await db.doc(`users/${uid}`).get();
      if (userSnap.exists) {
        const u = userSnap.data() || {};
        username = u.username || (u.email ? u.email.split('@')[0] : null);
      }
    } catch (e) {
      console.warn('syncSnakeHighScoreToLeaderboard: could not load user profile for', uid, e && e.message);
    }

    // Upsert leaderboard entry
    const entryRef = db.doc(`leaderboards/snake/entries/${uid}`);
    await entryRef.set({ username: username || 'user', score: highScore, updatedAt: admin.firestore.FieldValue.serverTimestamp() }, { merge: true });
    console.log('syncSnakeHighScoreToLeaderboard: upserted', uid, highScore);
    return null;
  } catch (err) {
    console.error('syncSnakeHighScoreToLeaderboard failed for', uid, err);
    return null;
  }
});

/**
 * Firestore trigger: keep Focus weekly/monthly leaderboards in sync with
 * per-user `dailyRecords` stored on `users/{uid}.dailyRecords`.
 * This runs with admin privileges and respects the user's leaderboard opt-in
 * preference located at `users/{uid}/settings/preferences.leaderboardOptIn`.
 */
exports.syncFocusRecordsToLeaderboard = functions.firestore.document('users/{uid}').onWrite(async (change, context) => {
  const uid = context.params.uid;
  const db = admin.firestore();
  try {
    const after = change.after.exists ? change.after.data() || {} : {};

    // Load user's opt-in preference (Flow users only). If explicitly opted-out, remove entries.
    let optIn = false;
    try {
      const prefSnap = await db.doc(`users/${uid}/settings/preferences`).get();
      optIn = prefSnap.exists ? !!prefSnap.data().leaderboardOptIn : false;
    } catch (e) {
      console.warn('syncFocusRecordsToLeaderboard: failed to load opt-in for', uid, e && e.message);
    }

    // Parse dailyRecords (stored as JSON string in client)
    let daily = {};
    if (after && after.dailyRecords) {
      try { daily = JSON.parse(after.dailyRecords) || {}; } catch (e) { daily = {}; }
    }

    // Helper: compute day-key string for a Date object
    const toKey = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;

    // Compute week start (match client: week starting Saturday)
    const now = new Date();
    const weekStart = new Date(now);
    const daysSinceSaturday = (now.getDay() + 1) % 7; // Saturday is day 6
    weekStart.setDate(weekStart.getDate() - daysSinceSaturday);
    weekStart.setHours(0,0,0,0);
    const weekKey = weekStart.toISOString();

    // Compute month start
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    monthStart.setHours(0,0,0,0);
    const monthKey = monthStart.toISOString();

    // Sum helper that supports numeric or object entries
    const getDayTotal = (entry) => {
      if (entry == null) return 0;
      if (typeof entry === 'object') {
        if (typeof entry.total === 'number') return entry.total;
        const by = entry.byTag || {};
        return Object.values(by).reduce((s, v) => s + (Number(v) || 0), 0);
      }
      return Number(entry) || 0;
    };

    // Compute weekly and monthly totals from daily map
    let weeklyTotal = 0;
    let monthlyTotal = 0;
    for (const [dateKey, val] of Object.entries(daily || {})) {
      try {
        if (dateKey >= toKey(weekStart)) weeklyTotal += getDayTotal(val);
        if (dateKey >= toKey(monthStart)) monthlyTotal += getDayTotal(val);
      } catch (e) { /* ignore malformed entries */ }
    }

    // Decide whether to upsert or remove leaderboard entries
    const username = (after && (after.username || (after.email ? after.email.split('@')[0] : null))) || 'user';

    const weeklyRef = db.doc(`leaderboards/focus_weekly/entries/${uid}`);
    const monthlyRef = db.doc(`leaderboards/focus_monthly/entries/${uid}`);

    if (!optIn) {
      // User opted out or preference missing: remove any existing entries
      await weeklyRef.delete().catch(() => {});
      await monthlyRef.delete().catch(() => {});
      console.log('syncFocusRecordsToLeaderboard: removed entries for opted-out user', uid);
      return null;
    }

    // Upsert weekly entry if minutes > 0, otherwise delete
    if (weeklyTotal > 0) {
      await weeklyRef.set({ username, minutes: weeklyTotal, periodType: 'weekly', periodStart: weekKey, updatedAt: admin.firestore.FieldValue.serverTimestamp() }, { merge: true });
    } else {
      await weeklyRef.delete().catch(() => {});
    }

    // Upsert monthly entry
    if (monthlyTotal > 0) {
      await monthlyRef.set({ username, minutes: monthlyTotal, periodType: 'monthly', periodStart: monthKey, updatedAt: admin.firestore.FieldValue.serverTimestamp() }, { merge: true });
    } else {
      await monthlyRef.delete().catch(() => {});
    }

    // ALSO: sync BreakSnake per-user high score (best-effort).
    try {
      const snakeRef = db.doc(`users/${uid}/game/snake`);
      const snakeSnap = await snakeRef.get();
      if (!snakeSnap.exists) {
        // remove leaderboard entry if no snake doc
        await db.doc(`leaderboards/snake/entries/${uid}`).delete().catch(() => {});
      } else {
        const snakeData = snakeSnap.data() || {};
        const highScore = Number(snakeData.highScore) || 0;
        if (!highScore || highScore <= 0) {
          await db.doc(`leaderboards/snake/entries/${uid}`).delete().catch(() => {});
        } else {
          // fetch username if not present already
          let usernameSnake = username;
          try {
            const userSnap = await db.doc(`users/${uid}`).get();
            if (userSnap.exists) {
              const u = userSnap.data() || {};
              usernameSnake = u.username || (u.email ? u.email.split('@')[0] : usernameSnake || 'user');
            }
          } catch (e) {
            // ignore
          }
          await db.doc(`leaderboards/snake/entries/${uid}`).set({ username: usernameSnake || 'user', score: highScore, updatedAt: admin.firestore.FieldValue.serverTimestamp() }, { merge: true });
        }
      }
    } catch (e) {
      console.warn('syncFocusRecordsToLeaderboard: failed to sync snake score for', uid, e && e.message);
    }

    console.log('syncFocusRecordsToLeaderboard: synced', uid, { weeklyTotal, monthlyTotal, optIn });
    return null;
  } catch (err) {
    console.error('syncFocusRecordsToLeaderboard failed for', uid, err);
    return null;
  }
});

// HTTP endpoint that verifies the ID token and enqueues a deletion job.
// This is provided as a CORS-friendly fallback for browsers when callables
// experience context/auth population issues.
exports.enqueueAccountDeletionHttp = onRequest({ region: 'us-central1' }, async (req, res) => {
  try {
    setCors(res);
    if (req.method === 'OPTIONS') return res.status(204).send('');
    if (req.method !== 'POST') return res.status(405).send('Method Not Allowed');

    const authHeader = req.get('Authorization') || req.get('authorization') || '';
    const match = authHeader.match(/^Bearer\s+(.+)$/i);
    if (!match) {
      console.warn('enqueueAccountDeletionHttp: missing Authorization header');
      return res.status(401).json({ success: false, error: 'Authentication required' });
    }
    const idToken = match[1];

    let decoded;
    try {
      decoded = await admin.auth().verifyIdToken(idToken);
    } catch (err) {
      console.warn('enqueueAccountDeletionHttp: token verify failed', err && err.message);
      return res.status(401).json({ success: false, error: 'Authentication required' });
    }

    const requesterUid = decoded.uid;
    const db = admin.firestore();
    try {
      const jobRef = await db.collection('deletionJobs').add({
        uid: requesterUid,
        requestedBy: requesterUid,
        requestedAt: admin.firestore.FieldValue.serverTimestamp(),
        status: 'pending'
      });
      console.log('Enqueued deletion job (http)', jobRef.id, 'for uid', requesterUid);
      return res.status(200).json({ success: true, jobId: jobRef.id });
    } catch (err) {
      console.error('enqueueAccountDeletionHttp: failed to enqueue job', err);
      return res.status(500).json({ success: false, error: 'Failed to enqueue deletion job' });
    }
  } catch (err) {
    console.error('enqueueAccountDeletionHttp: unexpected error', err);
    return res.status(500).json({ success: false, error: 'Internal error' });
  }
});

/**
 * Enqueue account deletion job (callable)
 * Writes a `deletionJobs/{jobId}` document with { uid, requestedBy, requestedAt, status }
 * Returns the jobId so the client can display a pending state.
 */
exports.enqueueAccountDeletion = onCall({ region: 'us-central1' }, async (data, context) => {
  try { console.log('enqueueAccountDeletion invoked; context.auth=', JSON.stringify(context && context.auth ? context.auth : null)); } catch (e) {}

  if (!context || !context.auth || !context.auth.uid) {
    console.warn('enqueueAccountDeletion: missing auth in context');
    throw new functions.https.HttpsError('unauthenticated', 'Authentication required');
  }

  const requesterUid = context.auth.uid;
  const db = admin.firestore();

  try {
    const jobRef = await db.collection('deletionJobs').add({
      uid: requesterUid,
      requestedBy: requesterUid,
      requestedAt: admin.firestore.FieldValue.serverTimestamp(),
      status: 'pending'
    });

    console.log('Enqueued deletion job', jobRef.id, 'for uid', requesterUid);
    return { success: true, jobId: jobRef.id };
  } catch (err) {
    console.error('Failed to enqueue deletion job for', requesterUid, err);
    return { success: false, error: err.message || 'Failed to enqueue deletion job' };
  }
});


/**
 * Worker: process deletion job when a document is created under `deletionJobs/{jobId}`.
 * Performs similar cleanup as deleteAccountV2 but runs asynchronously and updates job.status.
 */
exports.processDeletionJob = functions.firestore.document('deletionJobs/{jobId}').onCreate(async (snap, ctx) => {
  const job = snap.data();
  const jobId = ctx.params.jobId;
  if (!job || !job.uid) {
    console.warn('processDeletionJob: invalid job data', jobId, job);
    await snap.ref.update({ status: 'failed', error: 'Invalid job data' }).catch(() => {});
    return null;
  }

  const uid = job.uid;
  const db = admin.firestore();
  const jobRef = snap.ref;

  try {
    await jobRef.update({ status: 'processing', startedAt: admin.firestore.FieldValue.serverTimestamp() });

    // Load user profile
    const userRef = db.doc(`users/${uid}`);
    const userSnap = await userRef.get();
    const userData = userSnap.exists ? userSnap.data() : {};

    // Delete known subcollections (paginated approach could be added for large datasets)
    const subcollections = ['documents', 'flashcards', 'settings', 'game'];
    for (const sub of subcollections) {
      try {
        const colRef = db.collection(`users/${uid}/${sub}`);
        const snapCol = await colRef.get();
        const deletes = snapCol.docs.map(d => d.ref.delete().catch(e => { console.warn('subcollection delete failed', sub, d.id, e); }));
        await Promise.all(deletes);
      } catch (e) {
        console.warn('Error cleaning subcollection', sub, e);
      }
    }

    // Remove username mapping
    try {
      const usernameLower = userData && userData.usernameLower;
      if (usernameLower) await db.doc(`usernames/${usernameLower}`).delete().catch(() => {});
    } catch (e) { console.warn('Failed to remove username mapping', uid, e); }

    // Remove leaderboard entries
    try {
      const leaderboardPaths = [
        `leaderboards/focus_weekly/entries/${uid}`,
        `leaderboards/focus_monthly/entries/${uid}`,
        `leaderboards/snake/entries/${uid}`
      ];
      for (const p of leaderboardPaths) await db.doc(p).delete().catch(() => {});
    } catch (e) { console.warn('Failed leaderboard cleanup', uid, e); }

    // Delete user doc
    try { await userRef.delete().catch(() => {}); } catch (e) { console.warn('User doc delete failed', uid, e); }

    // Delete storage files under users/{uid}/
    try {
      const bucket = admin.storage().bucket();
      await bucket.deleteFiles({ prefix: `users/${uid}/` });
    } catch (e) { console.warn('Storage delete failed for', uid, e); }

    // Revoke tokens and delete auth user
    try {
      await admin.auth().revokeRefreshTokens(uid).catch((e) => { console.warn('revokeRefreshTokens failed', e); });
      await new Promise((res) => setTimeout(res, 1000));
      await admin.auth().deleteUser(uid).catch((e) => { console.warn('deleteUser failed', e); });
    } catch (e) { console.warn('Auth deletion failed for', uid, e); }

    // Tombstone
    try { await db.doc(`deletedUsers/${uid}`).set({ deletedAt: admin.firestore.FieldValue.serverTimestamp(), email: userData && userData.email ? userData.email : null }); } catch (e) { console.warn('Tombstone failed', uid, e); }
    try { const emailLower = userData && userData.email ? userData.email.toLowerCase() : null; if (emailLower) await db.doc(`deletedUsersByEmail/${emailLower}`).set({ uid, deletedAt: admin.firestore.FieldValue.serverTimestamp() }); } catch (e) { console.warn('Email tombstone failed', uid, e); }

    await jobRef.update({ status: 'completed', completedAt: admin.firestore.FieldValue.serverTimestamp() }).catch(() => {});
    console.log('Deletion job completed', jobId, 'for uid', uid);
    return null;
  } catch (err) {
    console.error('Deletion job failed', jobId, err);
    await jobRef.update({ status: 'failed', error: err.message || String(err), failedAt: admin.firestore.FieldValue.serverTimestamp() }).catch(() => {});
    return null;
  }
});

// --- GEN 1 CALLABLE FUNCTION: DELETE USER ACCOUNT ---
exports.deleteUserAccount = functions.https.onCall(async (data, context) => {
  // Debug: log auth context for troubleshooting 403/unauthenticated issues
  try { console.log('deleteUserAccount invoked; context.auth=', JSON.stringify(context && context.auth ? context.auth : null)); } catch (e) { console.log('deleteUserAccount auth log failed', e); }

  if (!context || !context.auth || !context.auth.uid) {
    console.warn('deleteUserAccount: missing auth in context', { contextAuth: context && context.auth });
    throw new functions.https.HttpsError('unauthenticated', 'Authentication required');
  }
  const uid = context.auth.uid;
  const db = admin.firestore();
  const userRef = db.doc(`users/${uid}`);
  try {
    // Delete known subcollections under users/{uid}
    const subcollections = ['documents', 'flashcards', 'settings', 'game'];
    for (const sub of subcollections) {
      const colRef = db.collection(`users/${uid}/${sub}`);
      const snap = await colRef.get();
      const deletes = snap.docs.map(d => d.ref.delete().catch(() => {}));
      await Promise.all(deletes);
    }
    // Remove username mapping if present
    try {
      const userSnap2 = await userRef.get();
      const userData2 = userSnap2.exists ? userSnap2.data() : {};
      const usernameLower = userData2 && userData2.usernameLower;
      if (usernameLower) {
        await db.doc(`usernames/${usernameLower}`).delete().catch(() => {});
      }
    } catch (e) {
      console.warn('deleteUserAccount: failed to remove username mapping', e && e.message);
    }

    // Delete the user root document
    await userRef.delete().catch(() => {});
    // Delete all files under users/{uid} in Storage
    try {
      const bucket = admin.storage().bucket();
      await bucket.deleteFiles({ prefix: `users/${uid}/` });
    } catch (e) {}
    // Delete the Firebase Authentication user record
    try {
      await admin.auth().deleteUser(uid);
    } catch (e) {}
    return { success: true };
  } catch (err) {
    return { success: false, error: err.message || 'Failed to delete account' };
  }
});

/**
 * Storage finalize trigger: enforce per-user storage quotas.
 * - Path: users/{uid}/pdfs/{folderId}/{fileName}
 * - Atomically updates `users/{uid}.storageUsageBytes` or deletes the object
 *   if the new usage would exceed `users/{uid}.storageQuotaBytes`.
 */
exports.enforceUserStorageQuota = onObjectFinalized({ region: 'us-central1' }, async (event) => {
  const object = event.data;
  try {
    const fullPath = object && object.name ? object.name : null;
    if (!fullPath) return null;

    // Only enforce for objects stored under the `users/{uid}/...` prefix
    const m = fullPath.match(/^users\/([^\/]+)\/(.+)$/);
    if (!m) return null;

    const uid = m[1];
    const fileSize = Number(object.size || 0);
    const db = admin.firestore();
    const userRef = db.doc(`users/${uid}`);

    await db.runTransaction(async (tx) => {
      const snap = await tx.get(userRef);
      const data = snap.exists ? snap.data() : {};
      const currentUsage = typeof data.storageUsageBytes === 'number' ? data.storageUsageBytes : 0;
      const quota = typeof data.storageQuotaBytes === 'number'
        ? data.storageQuotaBytes
        : (data.flowTier === 'flow' ? 2 * 1024 * 1024 * 1024 : 50 * 1024 * 1024);

      // Determine whether we've already recorded metadata for this file
      const fileDocId = Buffer.from(fullPath).toString('base64').replace(/\//g, '_');
      const metaRef = db.doc(`users/${uid}/storageFiles/${fileDocId}`);
      const metaSnap = await tx.get(metaRef);

      if (metaSnap.exists) {
        // Already processed this file (idempotent). Ensure storageUsageBytes is at least currentUsage and skip.
        console.log(`enforceUserStorageQuota: metadata exists for ${fullPath}, skipping increment`);
        tx.set(userRef, { storageUsageBytes: currentUsage }, { merge: true });
        return;
      }

      const newUsage = currentUsage + fileSize;

      if (newUsage > quota) {
        // Over quota: attempt to delete the newly uploaded object and record enforcement
        try {
          const bucket = admin.storage().bucket(object.bucket);
          await bucket.file(fullPath).delete();
        } catch (delErr) {
          console.error('Failed to delete over-quota file:', fullPath, delErr);
        }

        tx.set(userRef, {
          lastQuotaEnforcement: {
            timestamp: admin.firestore.FieldValue.serverTimestamp(),
            file: fullPath,
            size: fileSize,
            previousUsage: currentUsage,
            quota
          }
        }, { merge: true });

        console.log(`Enforced quota for user ${uid}: deleted ${fullPath} (${fileSize} bytes)`);
      } else {
        // Accept upload and increment usage
        tx.set(userRef, { storageUsageBytes: newUsage }, { merge: true });
        console.log(`Incremented storage usage for ${uid}: +${fileSize} => ${newUsage}`);

        // Record metadata for this uploaded file so deletes can adjust usage
        try {
          const metaRefPath = `users/${uid}/storageFiles/${fileDocId}`;
          tx.set(db.doc(metaRefPath), {
            path: fullPath,
            size: fileSize,
            uploadedAt: admin.firestore.FieldValue.serverTimestamp()
          }, { merge: true });
        } catch (metaErr) {
          console.warn('Could not write storage file metadata for', fullPath, metaErr && metaErr.message);
        }
      }
    });

    return null;
  } catch (err) {
    console.error('Error in enforceUserStorageQuota:', err);
    return null;
  }
});

/**
 * Storage delete trigger: decrement per-user storageUsageBytes when objects
 * under `users/{uid}/...` are removed. Skips decrement if the deletion was
 * performed by the quota-enforcement path (which records `lastQuotaEnforcement`).
 */
exports.handleUserObjectDeleted = onObjectDeleted({ region: 'us-central1' }, async (event) => {
  const object = event.data;
  try {
    const fullPath = object && object.name ? object.name : null;
    if (!fullPath) return null;

    // Only care about user-scoped objects
    const m = fullPath.match(/^users\/([^\/]+)\/(.+)$/);
    if (!m) return null;

    const uid = m[1];
    const fileSize = Number(object.size || 0);
    const db = admin.firestore();
    const userRef = db.doc(`users/${uid}`);

    // Read user doc to check for a recent quota-enforcement entry for this file.
    const userSnap = await userRef.get();
    if (!userSnap.exists) {
      console.log('handleUserObjectDeleted: user doc missing, skipping usage update for', fullPath);
      return null;
    }
    const data = userSnap.data() || {};

    const lastEnf = data.lastQuotaEnforcement || null;
    if (lastEnf && lastEnf.file === fullPath) {
      // If the finalize trigger already deleted this because of quota, it recorded
      // lastQuotaEnforcement. In that case we should NOT decrement usage because
      // the enforce flow never incremented storageUsageBytes for the rejected file.
      const ts = lastEnf.timestamp || null;
      // Allow a small window (5 minutes) to match the enforcement record.
      if (!ts || (ts && ((Date.now() - ts.toMillis ? ts.toMillis() : 0) < (5 * 60 * 1000)))) {
        console.log('handleUserObjectDeleted: deletion matches recent quota enforcement; skipping decrement for', fullPath);
        return null;
      }
    }

    // If size unknown, attempt to read file metadata we wrote at finalize time
    let actualSize = fileSize;
    if (!actualSize || actualSize <= 0) {
      try {
        const fileDocId = Buffer.from(fullPath).toString('base64').replace(/\//g, '_');
        const metaRef = db.doc(`users/${uid}/storageFiles/${fileDocId}`);
        const metaSnap = await metaRef.get();
        if (metaSnap.exists) {
          const meta = metaSnap.data() || {};
          actualSize = Number(meta.size || 0);
          // Remove metadata doc now that the file is deleted
          try { await metaRef.delete(); } catch (e) { console.warn('Could not delete storageFiles meta doc', fileDocId, e && e.message); }
        }
      } catch (metaErr) {
        console.warn('Error reading storage file metadata for', fullPath, metaErr && metaErr.message);
      }
    }

    if (!actualSize || actualSize <= 0) {
      // Still unknown — skip to avoid corrupting accounting.
      console.log('handleUserObjectDeleted: unknown file size for', fullPath, '- skipping decrement');
      return null;
    }

    // Atomically decrement storageUsageBytes but never go below 0
    await db.runTransaction(async (tx) => {
      const s = await tx.get(userRef);
      const current = s.exists ? (s.data().storageUsageBytes || 0) : 0;
      const next = Math.max(0, current - actualSize);
      tx.set(userRef, { storageUsageBytes: next }, { merge: true });
      console.log(`handleUserObjectDeleted: decremented usage for ${uid} by ${actualSize} => ${current} -> ${next}`);
    });

    return null;
  } catch (err) {
    console.error('Error in handleUserObjectDeleted:', err);
    return null;
  }
});

/**
 * HTTP admin/self endpoint: reconcile a user's storage state.
 * - Lists objects under `users/{uid}/` in the Storage bucket
 * - Rebuilds `users/{uid}/storageFiles/{id}` metadata docs
 * - Computes total size and writes `users/{uid}.storageUsageBytes`
 * Request: POST { uid?: string }
 * Authorization: Bearer <ID_TOKEN> (caller must be the same uid or an admin)
 */
exports.reconcileUserStorage = onRequest({ region: 'us-central1' }, async (req, res) => {
  try {
    setCors(res);
    if (req.method === 'OPTIONS') return res.status(204).send('');
    if (req.method !== 'POST') return res.status(405).send('Method Not Allowed');

    const authHeader = req.get('Authorization') || req.get('authorization') || '';
    const match = authHeader.match(/^Bearer\s+(.+)$/i);
    if (!match) return res.status(401).json({ success: false, error: 'Missing Authorization header' });
    const idToken = match[1];

    let caller;
    try {
      caller = await admin.auth().verifyIdToken(idToken);
    } catch (err) {
      console.warn('reconcileUserStorage: token verify failed', err && err.message);
      return res.status(401).json({ success: false, error: 'Invalid token' });
    }

    const requestedUid = (req.body && req.body.uid) ? String(req.body.uid) : caller.uid;
    // Allow only self-reconcile unless caller has admin claim
    const isAdmin = caller && caller.admin === true;
    if (requestedUid !== caller.uid && !isAdmin) {
      return res.status(403).json({ success: false, error: 'Forbidden' });
    }

    const bucket = admin.storage().bucket();
    const db = admin.firestore();
    let options = { prefix: `users/${requestedUid}/` };
    let totalBytes = 0;
    let fileCount = 0;
    const metaWrites = [];

    // Iterate over files with pagination
    do {
      const [files, nextQuery] = await bucket.getFiles(options);
      for (const f of files) {
        const name = f.name;
        let meta = f.metadata || null;
        if (!meta) {
          try { const mres = await f.getMetadata(); meta = mres[0]; } catch (e) { meta = {}; }
        }
        const size = Number((meta && meta.size) || 0);
        totalBytes += size;
        fileCount += 1;

        const fileDocId = Buffer.from(name).toString('base64').replace(/\//g, '_');
        const docRef = db.doc(`users/${requestedUid}/storageFiles/${fileDocId}`);
        metaWrites.push({ ref: docRef, data: { path: name, size, uploadedAt: meta && meta.timeCreated ? admin.firestore.Timestamp.fromDate(new Date(meta.timeCreated)) : admin.firestore.FieldValue.serverTimestamp() } });
      }
      options = nextQuery || null;
    } while (options && options.pageToken);

    // Commit metadata writes in batches (max 500 ops)
    const chunkSize = 400;
    for (let i = 0; i < metaWrites.length; i += chunkSize) {
      const batch = db.batch();
      const slice = metaWrites.slice(i, i + chunkSize);
      for (const w of slice) batch.set(w.ref, w.data, { merge: true });
      await batch.commit();
    }

    // Update user's storageUsageBytes
    const userRef = db.doc(`users/${requestedUid}`);
    await userRef.set({ storageUsageBytes: totalBytes }, { merge: true });

    return res.status(200).json({ success: true, uid: requestedUid, totalBytes, fileCount });
  } catch (err) {
    console.error('reconcileUserStorage: error', err);
    return res.status(500).json({ success: false, error: err.message || 'Internal error' });
  }
});
/**
 * Webhook handler for Stripe events
 * Listens for checkout.session.completed and payment_intent.succeeded events
 * Updates user subscription tier in Firestore upon successful payment
 */
exports.handleStripeWebhook = onRequest({ region: 'us-central1' }, async (req, res) => {
  if (req.method !== 'POST') {
    res.status(405).send('Method Not Allowed');
    return;
  }

  // Stripe requires the raw request body for signature verification. Gen2
  // functions should provide `req.rawBody`. Fall back to a Buffer from the
  // parsed body if not available (signature verification will likely fail in
  // that case unless the body wasn't parsed/modified).
  const signature = req.headers['stripe-signature'];
  const bodyBuffer = req.rawBody || (req.body ? Buffer.from(JSON.stringify(req.body)) : Buffer.from(''));
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

  if (!signature || !webhookSecret) {
    console.error('Missing stripe-signature header or webhook secret');
    res.status(400).send('Missing Stripe signature or webhook secret');
    return;
  }

  let event;

  try {
    event = stripeClient.webhooks.constructEvent(bodyBuffer, signature, webhookSecret);
  } catch (err) {
    console.error(`Webhook signature verification failed: ${err.message}`);
    res.status(400).send(`Webhook Error: ${err.message}`);
    return;
  }

  try {
    // Simple idempotency: record processed event, skip if already present
    const db = admin.firestore();
    const eventRef = db.doc(`stripeWebhookEvents/${event.id}`);
    try {
      await eventRef.create({ type: event.type, receivedAt: admin.firestore.FieldValue.serverTimestamp() });
    } catch (e) {
      console.log(`Event ${event.id} already processed, skipping.`);
      res.status(200).json({ received: true });
      return;
    }

    switch (event.type) {
      case 'checkout.session.completed':
        await handleCheckoutSessionCompleted(event.data.object);
        break;

      case 'customer.subscription.updated':
        await handleSubscriptionUpdated(event.data.object);
        break;

      case 'customer.subscription.deleted':
        await handleSubscriptionDeleted(event.data.object);
        break;

      default:
        console.log(`Unhandled event type: ${event.type}`);
    }

    res.status(200).json({ received: true });
  } catch (error) {
    console.error('Error processing webhook:', error);
    res.status(500).send('Internal Server Error');
  }
});

/**
 * Handle successful checkout session
 * Updates user's subscription tier to 'paid' in Firestore
 */
async function handleCheckoutSessionCompleted(session) {
  console.log('Checkout session completed:', session.id);
  const db = admin.firestore();

  // Determine user id from client_reference_id or subscription metadata
  let userId = session.client_reference_id || (session.metadata && session.metadata.firebaseUid);

  // If we still don't have a uid, try to find by customer id
  if (!userId && session.customer) {
    const userQuery = await db.collection('users').where('stripeCustomerId', '==', session.customer).limit(1).get();
    if (!userQuery.empty) userId = userQuery.docs[0].id;
  }

  if (!userId) {
    console.warn('Could not determine Firebase UID for session', session.id);
    return;
  }

  try {
    // Retrieve subscription details if available to capture period end and status
    let subscriptionData = {};
    if (session.subscription) {
      try {
        const sub = await stripeClient.subscriptions.retrieve(session.subscription);
        subscriptionData = {
          stripeSubscriptionId: sub.id,
          subscriptionStatus: sub.status,
          current_period_end: sub.current_period_end ? admin.firestore.Timestamp.fromMillis(sub.current_period_end * 1000) : null,
        };
        // Try to get upcoming invoice to surface an explicit next billing date.
        // If present, prefer the upcoming invoice's next_payment_attempt as the
        // authoritative `current_period_end` so the client matches Stripe portal.
        try {
          const upcoming = await stripeClient.invoices.retrieveUpcoming({ subscription: sub.id });
          if (upcoming && upcoming.next_payment_attempt) {
            const ts = admin.firestore.Timestamp.fromMillis(upcoming.next_payment_attempt * 1000);
            subscriptionData.next_billing_date = ts;
            subscriptionData.current_period_end = ts;
          }
        } catch (err) {
          console.warn('Could not retrieve upcoming invoice for subscription in checkout handler:', err && err.message ? err.message : err);
        }
      } catch (err) {
        console.warn('Could not retrieve subscription details:', err.message);
        subscriptionData = { stripeSubscriptionId: session.subscription };
      }
    }

    const update = Object.assign(
      {
        flowTier: 'flow',
        stripeCustomerId: session.customer || null,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      },
      subscriptionData
    );

    await db.doc(`users/${userId}`).set(update, { merge: true });

    // Also update the preferences subdocument used by the client UI (mirror fields)
    try {
      const prefs = {
        flowTier: update.flowTier,
        subscriptionStatus: update.subscriptionStatus || null,
        stripeSubscriptionId: update.stripeSubscriptionId || null,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      };
      if (update.current_period_end) prefs.current_period_end = update.current_period_end;
      if (update.next_billing_date) prefs.next_billing_date = update.next_billing_date;
      await db.doc(`users/${userId}/settings/preferences`).set(prefs, { merge: true });
    } catch (e) {
      console.warn('Could not update preferences subdocument:', e && e.message ? e.message : e);
    }

    console.log(`Successfully updated user ${userId} to flow tier`);
  } catch (error) {
    console.error(`Error updating user ${userId}:`, error);
    throw error;
  }
}

/**
 * Callable function to delete a user's account and all associated data.
 * This runs with admin privileges and will remove Firestore data, Storage files
 * under `users/{uid}`, username mapping, leaderboard entries, and the Auth user.
 * Only callable by an authenticated user to delete their own account.
 */
exports.deleteAccountV2 = onCall({ region: 'us-central1' }, async (data, context) => {
  // Debug: log auth context to help identify why clients receive 403
  try { console.log('deleteAccountV2 invoked; context.auth=', JSON.stringify(context && context.auth ? context.auth : null)); } catch (e) { console.log('deleteAccountV2 auth log failed', e); }

  if (!context || !context.auth || !context.auth.uid) {
    console.warn('deleteAccountV2: missing auth in context', { contextAuth: context && context.auth });
    throw new functions.https.HttpsError('unauthenticated', 'Authentication required');
  }

  const uid = context.auth.uid;
  console.log('deleteAccount called for uid=', uid);
  const db = admin.firestore();
  const userRef = db.doc(`users/${uid}`);

  try {
    // Load user profile to capture metadata for cleanup
    const userSnap = await userRef.get();
    const userData = userSnap.exists ? userSnap.data() : {};

    // Delete known subcollections under users/{uid}
    const subcollections = ['documents', 'flashcards', 'settings', 'game'];
    for (const sub of subcollections) {
      const colRef = db.collection(`users/${uid}/${sub}`);
      const snap = await colRef.get();
      const deletes = snap.docs.map(d => d.ref.delete().catch(() => {}));
      await Promise.all(deletes);
    }

    // Remove username mapping if present
    try {
      const usernameLower = userData && userData.usernameLower;
      if (usernameLower) {
        await db.doc(`usernames/${usernameLower}`).delete().catch(() => {});
      }
    } catch (e) {
      console.warn('Failed to remove username mapping for', uid, e.message || e);
    }

    // Remove leaderboard entries if present
    try {
      const leaderboardPaths = [
        `leaderboards/focus_weekly/entries/${uid}`,
        `leaderboards/focus_monthly/entries/${uid}`,
        `leaderboards/snake/entries/${uid}`
      ];
      for (const p of leaderboardPaths) {
        await db.doc(p).delete().catch(() => {});
      }
    } catch (e) {
      console.warn('Failed to remove leaderboard entries for', uid, e.message || e);
    }

    // Delete the user root document
    try {
      await userRef.delete().catch(() => {});
    } catch (e) {
      console.warn('Failed to delete user document for', uid, e.message || e);
    }

    // Delete all files under users/{uid} in Storage
    try {
      const bucket = admin.storage().bucket();
      await bucket.deleteFiles({ prefix: `users/${uid}/` });
    } catch (e) {
      console.warn('Failed to delete storage files for', uid, e.message || e);
    }

    // Revoke refresh tokens so existing sessions are invalidated, then
    // delete the Firebase Authentication user record. Revoking tokens first
    // ensures that client SDKs will no longer be able to refresh expired ID
    // tokens and helps avoid short-term re-login with cached credentials.
    try {
      await admin.auth().revokeRefreshTokens(uid).catch((e) => { console.warn('revokeRefreshTokens failed', e); });
      // Small delay to let revocation propagate
      await new Promise((res) => setTimeout(res, 1000));
      await admin.auth().deleteUser(uid);
    } catch (e) {
      console.warn('Failed to revoke tokens or delete auth user for', uid, e.message || e);
    }

    // Record a tombstone so we can optionally block immediate re-creation
    // or audit deletions. This does not by itself prevent sign-up; to block
    // re-creation you'd add a `beforeCreate` / `beforeSignIn` blocking
    // function that consults `deletedUsers/{uid}` or `deletedUsersByEmail/{email}`.
    try {
      await db.doc(`deletedUsers/${uid}`).set({ deletedAt: admin.firestore.FieldValue.serverTimestamp(), email: userData && userData.email ? userData.email : null });
    } catch (e) {
      console.warn('Failed to write deletedUsers tombstone for', uid, e.message || e);
    }
    // Also write a by-email tombstone to help prevent immediate re-creation.
    try {
      const emailLower = userData && userData.email ? userData.email.toLowerCase() : null;
      if (emailLower) {
        await db.doc(`deletedUsersByEmail/${emailLower}`).set({ uid, deletedAt: admin.firestore.FieldValue.serverTimestamp() });
      }
    } catch (e) {
      console.warn('Failed to write deletedUsersByEmail tombstone for', uid, e.message || e);
    }

    return { success: true };
  } catch (err) {
    console.error('deleteAccount callable failed for', uid, err);
    // Return structured error details instead of throwing to make debugging
    // easier for the client. The client helper will surface the message.
    return { success: false, error: err.message || 'Failed to delete account' };
  }
});

// HTTP endpoint wrapper that performs the same deletion but supports CORS
// and can be called from browser via fetch with Authorization: Bearer <idToken>.
exports.deleteAccountHttpV2 = onRequest({ region: 'us-central1' }, async (req, res) => {
  setCors(res);
  if (req.method === 'OPTIONS') {
    res.status(204).send('');
    return;
  }

  if (req.method !== 'POST') {
    res.status(405).json({ success: false, error: 'Method Not Allowed' });
    return;
  }

  const authHeader = req.get('Authorization') || '';
  const match = authHeader.match(/Bearer\s+(.*)/i);
  if (!match) {
    res.status(401).json({ success: false, error: 'Missing Authorization header' });
    return;
  }

  const idToken = match[1];
  let uid;
  try {
    const decoded = await admin.auth().verifyIdToken(idToken);
    uid = decoded.uid;
  } catch (err) {
    console.error('deleteAccountHttp: invalid id token', err);
    res.status(401).json({ success: false, error: 'Invalid ID token' });
    return;
  }

  // Delegate to the callable implementation by constructing a fake context.
  try {
    // Reuse the same logic as deleteAccount: call the function implementation
    // by invoking the core deletion steps inline here (copying the logic).
    const db = admin.firestore();
    const userRef = db.doc(`users/${uid}`);

    // Load user profile
    const userSnap = await userRef.get();
    const userData = userSnap.exists ? userSnap.data() : {};

    // Delete known subcollections
    const subcollections = ['documents', 'flashcards', 'settings', 'game'];
    for (const sub of subcollections) {
      const colRef = db.collection(`users/${uid}/${sub}`);
      const snap = await colRef.get();
      const deletes = snap.docs.map(d => d.ref.delete().catch(() => {}));
      await Promise.all(deletes);
    }

    // Remove username mapping
    try {
      const usernameLower = userData && userData.usernameLower;
      if (usernameLower) {
        await db.doc(`usernames/${usernameLower}`).delete().catch(() => {});
      }
    } catch (e) { console.warn('deleteAccountHttp: username map removal failed', e); }

    // Remove leaderboard entries
    try {
      const leaderboardPaths = [
        `leaderboards/focus_weekly/entries/${uid}`,
        `leaderboards/focus_monthly/entries/${uid}`,
        `leaderboards/snake/entries/${uid}`
      ];
      for (const p of leaderboardPaths) await db.doc(p).delete().catch(() => {});
    } catch (e) { console.warn('deleteAccountHttp: leaderboard deletion failed', e); }

    // Delete user doc
    try { await userRef.delete().catch(() => {}); } catch (e) { console.warn('deleteAccountHttp: user doc delete failed', e); }

    // Delete storage files
    try { const bucket = admin.storage().bucket(); await bucket.deleteFiles({ prefix: `users/${uid}/` }); } catch (e) { console.warn('deleteAccountHttp: storage delete failed', e); }

    // Revoke tokens and delete auth user
    try {
      await admin.auth().revokeRefreshTokens(uid).catch((e) => { console.warn('revokeRefreshTokens failed', e); });
      await new Promise((res) => setTimeout(res, 1000));
      await admin.auth().deleteUser(uid);
    } catch (e) { console.warn('deleteAccountHttp: auth deletion failed', e); }

    // Tombstones
    try { await db.doc(`deletedUsers/${uid}`).set({ deletedAt: admin.firestore.FieldValue.serverTimestamp(), email: userData && userData.email ? userData.email : null }); } catch (e) { console.warn('deleteAccountHttp: tombstone failed', e); }
    try { const emailLower = userData && userData.email ? userData.email.toLowerCase() : null; if (emailLower) await db.doc(`deletedUsersByEmail/${emailLower}`).set({ uid, deletedAt: admin.firestore.FieldValue.serverTimestamp() }); } catch (e) { console.warn('deleteAccountHttp: email tombstone failed', e); }

    res.status(200).json({ success: true });
  } catch (err) {
    console.error('deleteAccountHttp failed for uid=', uid, err);
    res.status(500).json({ success: false, error: err.message || 'Failed to delete account' });
  }
});

/**
 * Handle subscription updated event
 * Maintains sync if subscription is still active
 */
async function handleSubscriptionUpdated(subscription) {
  console.log('Subscription updated:', subscription.id);
  const customerId = subscription.customer;
  const db = admin.firestore();

  try {
    // Find user by Stripe customer ID in users collection
    const userQuery = await db.collection('users').where('stripeCustomerId', '==', customerId).limit(1).get();

    if (userQuery.empty) {
      console.warn(`No user found for customer ${customerId}`);
      return;
    }

    const userDoc = userQuery.docs[0];
    const status = subscription.status;

    // Update tier based on subscription status
    const tier = (status === 'active' || status === 'trialing') ? 'flow' : 'light';

    const update = {
      flowTier: tier,
      subscriptionStatus: status,
      stripeSubscriptionId: subscription.id,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    };

    if (subscription.current_period_end) {
      update.current_period_end = admin.firestore.Timestamp.fromMillis(subscription.current_period_end * 1000);
    }
    // Attempt to record an explicit next billing date from the upcoming invoice
    // and prefer that value for current_period_end so the client mirrors
    // the Stripe portal's next billing date.
    try {
      const upcoming = await stripeClient.invoices.retrieveUpcoming({ subscription: subscription.id });
      if (upcoming && upcoming.next_payment_attempt) {
        const ts = admin.firestore.Timestamp.fromMillis(upcoming.next_payment_attempt * 1000);
        update.next_billing_date = ts;
        update.current_period_end = ts;
      }
    } catch (err) {
      // Not fatal — just log and continue
      console.warn('Could not retrieve upcoming invoice for subscription update:', err && err.message ? err.message : err);
    }

    await userDoc.ref.set(update, { merge: true });

    console.log(`Updated subscription for user to tier: ${tier} (status: ${status})`);
  } catch (error) {
    console.error('Error updating subscription:', error);
    throw error;
  }
}

/**
 * Handle subscription deleted event
 * Downgrades user to free tier if subscription is cancelled
 */
async function handleSubscriptionDeleted(subscription) {
  console.log('Subscription deleted:', subscription.id);
  const customerId = subscription.customer;
  const db = admin.firestore();

  try {
    // Find user by Stripe customer ID in users collection
    const userQuery = await db.collection('users').where('stripeCustomerId', '==', customerId).limit(1).get();

    if (userQuery.empty) {
      console.warn(`No user found for customer ${customerId}`);
      return;
    }

    const userDoc = userQuery.docs[0];

    // Downgrade to light tier
    const update = {
      flowTier: 'light',
      subscriptionStatus: 'canceled',
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    };

    await userDoc.ref.set(update, { merge: true });

    console.log(`Downgraded user to light tier after subscription cancellation`);
  } catch (error) {
    console.error('Error handling subscription deletion:', error);
    throw error;
  }
}

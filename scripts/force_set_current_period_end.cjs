#!/usr/bin/env node
/*
Force-update `current_period_end` for users in Firestore.

Usage (dry-run):
  node scripts/force_set_current_period_end.cjs --date 2026-01-22T00:00:00Z --limit 100

Apply changes:
  node scripts/force_set_current_period_end.cjs --date 2026-01-22T00:00:00Z --apply --limit 100

Options:
  --date        ISO 8601 date string OR integer milliseconds since epoch
  --ts          milliseconds since epoch (alternative to --date)
  --uids        comma-separated list of user IDs to update (overrides --all)
  --all         update all users (default behaviour when no --uids)
  --limit       batch size per page (default 500)
  --apply       actually write changes (dry-run otherwise)
  --reason      short string describing why override is applied

Caveats:
- This only changes Firestore; it does NOT change Stripe subscription state.
- Use with caution: changing expiry dates may grant access beyond paid period.
- Consider setting an audit field `subscription_override` when applying.
*/

const admin = require('firebase-admin');
const fs = require('fs');
const path = require('path');
const { argv } = require('yargs')
  .option('date', { type: 'string', description: 'ISO date string or ms timestamp' })
  .option('ts', { type: 'number', description: 'Milliseconds since epoch' })
  .option('uids', { type: 'string', description: 'Comma-separated user ids' })
  .option('all', { type: 'boolean', description: 'Update all users', default: false })
  .option('limit', { type: 'number', description: 'Page size', default: 500 })
  .option('apply', { type: 'boolean', description: 'Write changes', default: false })
  .option('reason', { type: 'string', description: 'Reason for override', default: 'admin-forced-update' })
  .help();

const APPLY = !!argv.apply;
const LIMIT = Number(argv.limit) || 500;
const REASON = argv.reason || 'admin-forced-update';

let ts = null;
if (argv.ts) ts = Number(argv.ts);
else if (argv.date) {
  const asNum = Number(argv.date);
  if (!Number.isNaN(asNum)) ts = asNum;
  else {
    const d = new Date(argv.date);
    if (!isNaN(d.getTime())) ts = d.getTime();
  }
}

if (!ts) {
  console.error('Missing or invalid --date/--ts parameter. Provide ISO date or milliseconds.');
  process.exit(1);
}

// Initialize Admin SDK
try {
  if (!process.env.GOOGLE_APPLICATION_CREDENTIALS) {
    const candidate = path.join(__dirname, '..', 'serviceAccountKey.json');
    if (fs.existsSync(candidate)) process.env.GOOGLE_APPLICATION_CREDENTIALS = candidate;
  }
  admin.initializeApp({ credential: admin.credential.applicationDefault() });
} catch (err) {
  console.error('Failed to initialize Firebase Admin:', err);
  process.exit(1);
}

const db = admin.firestore();
const targetUids = argv.uids ? argv.uids.split(',').map(s => s.trim()).filter(Boolean) : null;
const doAll = argv.all || !targetUids;

const tsTimestamp = admin.firestore.Timestamp.fromMillis(ts);

async function updateUser(uid) {
  const userRef = db.doc(`users/${uid}`);
  const userSnap = await userRef.get();
  if (!userSnap.exists) return { uid, skipped: true, reason: 'not found' };
  const update = {
    current_period_end: tsTimestamp,
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    subscription_override: { by: 'admin-script', reason: REASON, at: admin.firestore.FieldValue.serverTimestamp() },
  };
  if (APPLY) {
    await userRef.set(update, { merge: true });
    try {
      await db.doc(`users/${uid}/settings/preferences`).set({ current_period_end: tsTimestamp, updatedAt: admin.firestore.FieldValue.serverTimestamp(), subscription_override: update.subscription_override }, { merge: true });
    } catch (e) {
      // continue; warn
      console.warn(uid, 'failed to mirror prefs:', e && e.message ? e.message : e);
    }
    return { uid, applied: true };
  } else {
    return { uid, wouldApply: true };
  }
}

async function runForAll() {
  let lastId = null;
  let total = 0;
  while (true) {
    let q = db.collection('users').orderBy('__name__').limit(LIMIT);
    if (lastId) q = q.startAfter(lastId);
    const snap = await q.get();
    if (snap.empty) break;
    const docs = snap.docs;
    for (const d of docs) {
      const res = await updateUser(d.id);
      total++;
      console.log(res);
    }
    lastId = docs[docs.length - 1].id;
    if (docs.length < LIMIT) break;
  }
  console.log('Done. processed', total);
}

(async () => {
  try {
    if (targetUids && targetUids.length > 0) {
      for (const uid of targetUids) {
        const r = await updateUser(uid);
        console.log(r);
      }
    } else if (doAll) {
      await runForAll();
    } else {
      console.error('Nothing to do. Provide --uids or --all.');
    }
    process.exit(0);
  } catch (e) {
    console.error('Fatal:', e && e.message ? e.message : e);
    process.exit(2);
  }
})();

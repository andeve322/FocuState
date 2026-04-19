/*
One-time migration script: copy existing `subscriptionTier` -> `flowTier` where flowTier is missing.

Usage (recommended):
1. Ensure you have admin Firebase credentials (service account) and have set GOOGLE_APPLICATION_CREDENTIALS
   or pass the path to the service account below.
2. Run locally from project root:
   node functions_deploy/migrations/migrate_subscription_to_flow.js

Notes:
- The script is idempotent: it only writes when `preferences.flowTier` is missing and `preferences.subscriptionTier` exists.
- By default it will perform updates (no dry-run). To preview changes first, set DRY_RUN=true environment variable.
- Always backup your Firestore (export) before running migrations in production.
*/

const admin = require('firebase-admin');
const path = require('path');

// Optional: set SERVICE_ACCOUNT_PATH env var to the service account JSON path
const serviceAccountPath = process.env.SERVICE_ACCOUNT_PATH || process.env.GOOGLE_APPLICATION_CREDENTIALS;

if (!admin.apps.length) {
  if (serviceAccountPath) {
    const key = require(path.resolve(serviceAccountPath));
    admin.initializeApp({ credential: admin.credential.cert(key) });
  } else {
    // Try to initialize default credentials
    admin.initializeApp();
  }
}

const db = admin.firestore();
const DRY_RUN = process.env.DRY_RUN === 'true' || false;

async function migrate() {
  console.log('Starting migration: subscriptionTier -> flowTier');
  console.log('DRY_RUN:', DRY_RUN);

  const usersRef = db.collection('users');
  const snapshot = await usersRef.get();
  console.log(`Found ${snapshot.size} user documents`);

  let updated = 0;
  let skipped = 0;
  let errors = 0;

  for (const doc of snapshot.docs) {
    const data = doc.data() || {};
    const prefs = (data.settings && data.settings.preferences) || {};

    const hasFlowTier = prefs.hasOwnProperty('flowTier');
    const hasSubscription = prefs.hasOwnProperty('subscriptionTier');

    if (hasFlowTier) {
      skipped++;
      continue; // already migrated
    }

    if (!hasSubscription) {
      skipped++;
      continue; // nothing to migrate
    }

    const subscriptionTier = prefs.subscriptionTier; // 'free' | 'paid'
    const mappedFlowTier = subscriptionTier === 'paid' ? 'flow' : 'light';

    console.log(`User ${doc.id}: subscriptionTier='${subscriptionTier}' -> flowTier='${mappedFlowTier}'`);

    if (DRY_RUN) {
      updated++;
      continue;
    }

    try {
      const updateData = {
        'settings.preferences.flowTier': mappedFlowTier,
        // optionally remove old field - remove or comment out if you prefer to keep it
        // 'settings.preferences.subscriptionTier': admin.firestore.FieldValue.delete(),
      };

      await usersRef.doc(doc.id).set(updateData, { merge: true });
      updated++;
    } catch (err) {
      console.error('Error updating user', doc.id, err);
      errors++;
    }
  }

  console.log(`Migration complete. updated=${updated} skipped=${skipped} errors=${errors}`);
}

migrate().then(() => process.exit(0)).catch(err => {
  console.error('Migration failed', err);
  process.exit(1);
});

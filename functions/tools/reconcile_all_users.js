#!/usr/bin/env node
/**
 * Reconcile storage usage for all users.
 * Run from the `functions/` directory so it picks up the functions package dependencies:
 *
 *   cd functions
 *   node tools/reconcile_all_users.js [--dry-run] [--limit N]
 *
 * Options:
 *   --dry-run   : don't write metadata or update user docs, just print stats
 *   --limit N   : process at most N users (useful for testing)
 *
 * The script:
 * - enumerates Firebase Authentication users
 * - lists objects under `users/{uid}/` in the default Storage bucket
 * - writes metadata documents at `users/{uid}/storageFiles/{base64Path}`
 * - computes total bytes and updates `users/{uid}.storageUsageBytes`
 *
 * WARNING: This can be slow and cost network/Firestore ops for many users.
 */

const admin = require('firebase-admin');
const path = require('path');
const fs = require('fs');

const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const limitArgIndex = args.indexOf('--limit');
const limit = limitArgIndex >= 0 && args[limitArgIndex + 1] ? parseInt(args[limitArgIndex + 1], 10) : null;

// Initialize using default service account in the environment or the local serviceAccountKey.json
let serviceAccountPath = path.join(__dirname, '..', '..', 'serviceAccountKey.json');
let serviceAccount = null;
if (fs.existsSync(serviceAccountPath)) {
  serviceAccount = require(serviceAccountPath);
}

if (serviceAccount) {
  admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
} else {
  // Fall back to application default credentials (gcloud/CI)
  admin.initializeApp();
}

const db = admin.firestore();
const bucket = admin.storage().bucket();

const BATCH_SIZE = 400; // Firestore batch write chunk size

async function listAllAuthUsers(processFn) {
  let nextPageToken = undefined;
  let processed = 0;
  do {
    const listResult = await admin.auth().listUsers(1000, nextPageToken);
    for (const userRecord of listResult.users) {
      if (limit && processed >= limit) return processed;
      await processFn(userRecord);
      processed++;
    }
    nextPageToken = listResult.pageToken;
  } while (nextPageToken);
  return processed;
}

async function reconcileUser(userRecord) {
  const uid = userRecord.uid;
  console.log('\n=== Reconciling', uid, userRecord.email || '(no email)');

  const prefix = `users/${uid}/`;
  let options = { prefix };
  let totalBytes = 0;
  let fileCount = 0;
  const metaWrites = [];

  // iterate files with pagination
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
      const docRef = db.doc(`users/${uid}/storageFiles/${fileDocId}`);
      metaWrites.push({ ref: docRef, data: { path: name, size: size, uploadedAt: meta && meta.timeCreated ? admin.firestore.Timestamp.fromDate(new Date(meta.timeCreated)) : admin.firestore.FieldValue.serverTimestamp() } });
    }
    options = nextQuery || null;
  } while (options && options.pageToken);

  console.log(`Found ${fileCount} files, total ${totalBytes} bytes`);

  if (dryRun) {
    console.log('Dry run - not writing metadata or updating user doc');
    return { uid, fileCount, totalBytes, wrote: false };
  }

  // Write metadata in batches
  for (let i = 0; i < metaWrites.length; i += BATCH_SIZE) {
    const batch = db.batch();
    const slice = metaWrites.slice(i, i + BATCH_SIZE);
    for (const w of slice) batch.set(w.ref, w.data, { merge: true });
    await batch.commit();
  }

  // Update user doc
  const userRef = db.doc(`users/${uid}`);
  await userRef.set({ storageUsageBytes: totalBytes }, { merge: true });

  console.log(`Wrote metadata (${metaWrites.length}) and set storageUsageBytes=${totalBytes}`);
  return { uid, fileCount, totalBytes, wrote: true };
}

(async () => {
  try {
    console.log('Starting reconciliation for all users', dryRun ? '(dry run)' : '');
    let processed = 0;
    const results = [];
    await listAllAuthUsers(async (userRecord) => {
      const res = await reconcileUser(userRecord);
      results.push(res);
      processed++;
      // small delay to avoid bursting too fast to Storage/Firestore
      await new Promise(r => setTimeout(r, 250));
    });
    console.log('Reconciliation complete. Processed users:', processed);

    // Print summary
    let totalUsers = results.length;
    let totalFiles = results.reduce((s, r) => s + (r.fileCount || 0), 0);
    let totalBytes = results.reduce((s, r) => s + (r.totalBytes || 0), 0);
    console.log(`Summary: users=${totalUsers}, files=${totalFiles}, bytes=${totalBytes}`);
    process.exit(0);
  } catch (err) {
    console.error('Fatal error during reconciliation:', err);
    process.exit(1);
  }
})();

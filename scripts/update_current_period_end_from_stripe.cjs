#!/usr/bin/env node
/*
CommonJS copy of update_current_period_end_from_stripe.js so it can be
executed when the repository `package.json` sets "type": "module".
Run this with plain `node scripts/update_current_period_end_from_stripe.cjs`.
*/

const admin = require('firebase-admin');
const Stripe = require('stripe');
const fs = require('fs');
const path = require('path');
const { argv } = require('yargs')
  .option('apply', { type: 'boolean', description: 'Write updates to Firestore', default: false })
  .option('limit', { type: 'number', description: 'Max users per batch (pagination size)', default: 500 })
  .option('concurrency', { type: 'number', description: 'Parallel Stripe calls', default: 5 })
  .option('startAfter', { type: 'string', description: 'Start after this document ID (for resuming)', default: null })
  .option('intervalMs', { type: 'number', description: 'Delay between batches (ms)', default: 500 })
  .help();

const APPLY = !!argv.apply;
const LIMIT = Number(argv.limit) || 500;
const CONCURRENCY = Math.max(1, Number(argv.concurrency) || 5);
const START_AFTER = argv.startAfter || null;
const INTERVAL_MS = Number(argv.intervalMs) || 500;

if (!process.env.STRIPE_SECRET_KEY) {
  console.error('Missing STRIPE_SECRET_KEY environment variable. Aborting.');
  process.exit(1);
}

// Initialize Firebase Admin
try {
  if (!process.env.GOOGLE_APPLICATION_CREDENTIALS) {
    const candidate = path.join(__dirname, '..', 'serviceAccountKey.json');
    if (fs.existsSync(candidate)) process.env.GOOGLE_APPLICATION_CREDENTIALS = candidate;
  }
  admin.initializeApp({
    credential: admin.credential.applicationDefault(),
  });
} catch (err) {
  console.error('Failed to initialize Firebase Admin:', err);
  process.exit(1);
}

const db = admin.firestore();
const stripe = Stripe(process.env.STRIPE_SECRET_KEY);

const sleep = (ms) => new Promise((res) => setTimeout(res, ms));

async function processBatch(startAfterId) {
  let q = db.collection('users').orderBy('__name__').limit(LIMIT);
  if (startAfterId) q = q.startAfter(startAfterId);
  const snap = await q.get();
  if (snap.empty) return { docs: [], lastId: null };
  const docs = snap.docs;
  const lastId = docs[docs.length - 1].id;

  console.log(`Fetched ${docs.length} users (startAfter=${startAfterId || '<start>'})`);

  let idx = 0;
  const results = [];
  async function worker() {
    while (idx < docs.length) {
      const i = idx++;
      const doc = docs[i];
      const userData = doc.data() || {};
      const userId = doc.id;

      try {
        const subscriptionId = userData.stripeSubscriptionId || userData.stripeSubscriptionID || null;
        if (!subscriptionId) {
          results.push({ userId, skipped: true, reason: 'no subscription id' });
          continue;
        }

        let nextAttempt = null;
        try {
          const upcoming = await stripe.invoices.retrieveUpcoming({ subscription: subscriptionId });
          if (upcoming && upcoming.next_payment_attempt) nextAttempt = upcoming.next_payment_attempt * 1000;
        } catch (e) {
          console.warn(userId, 'retrieveUpcoming err:', e && e.message ? e.message : e);
        }

        if (!nextAttempt) {
          try {
            const sub = await stripe.subscriptions.retrieve(subscriptionId);
            if (sub && sub.current_period_end) nextAttempt = sub.current_period_end * 1000;
          } catch (e) {
            console.warn(userId, 'subscriptions.retrieve err:', e && e.message ? e.message : e);
          }
        }

        if (!nextAttempt) {
          results.push({ userId, skipped: true, reason: 'no date from stripe' });
          continue;
        }

        const ts = admin.firestore.Timestamp.fromMillis(nextAttempt);
        const update = {
          current_period_end: ts,
          next_billing_date: ts,
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        };

        if (APPLY) {
          await doc.ref.set(update, { merge: true });
          try {
            await db.doc(`users/${userId}/settings/preferences`).set({ current_period_end: ts, next_billing_date: ts, updatedAt: admin.firestore.FieldValue.serverTimestamp() }, { merge: true });
          } catch (e) {
            console.warn(userId, 'failed to mirror prefs:', e && e.message ? e.message : e);
          }
          results.push({ userId, applied: true, ts });
        } else {
          results.push({ userId, wouldApply: true, ts });
        }
      } catch (err) {
        console.error('Error processing user', userId, err && err.message ? err.message : err);
        results.push({ userId, error: err && err.message ? err.message : String(err) });
      }
    }
  }

  const workers = Array(Math.min(CONCURRENCY, docs.length)).fill().map(() => worker());
  await Promise.all(workers);

  return { docs: results, lastId };
}

(async function main() {
  console.log('Starting backfill script. APPLY=', APPLY, 'LIMIT=', LIMIT, 'CONCURRENCY=', CONCURRENCY);
  let lastId = START_AFTER;
  let total = 0;
  let applied = 0;
  let skipped = 0;
  let errored = 0;

  try {
    while (true) {
      const { docs, lastId: newLast } = await processBatch(lastId);
      if (!docs || docs.length === 0) {
        console.log('No more users to process.');
        break;
      }

      for (const r of docs) {
        total++;
        if (r.applied) applied++;
        if (r.wouldApply) applied++;
        if (r.skipped) skipped++;
        if (r.error) errored++;
      }

      lastId = newLast;

      console.log(`Batch done. total=${total} applied=${applied} skipped=${skipped} errored=${errored} lastId=${lastId}`);

      if (docs.length < LIMIT) break;

      await sleep(INTERVAL_MS);
    }

    console.log('Finished. totals:', { total, applied, skipped, errored });
    process.exit(0);
  } catch (err) {
    console.error('Fatal error:', err && err.message ? err.message : err);
    process.exit(2);
  }
})();

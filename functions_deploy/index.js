const admin = require('firebase-admin');
const functions = require('firebase-functions');
const { onRequest } = require('firebase-functions/v2/https');
const stripe = require('stripe');

// Initialize Firebase Admin
admin.initializeApp();

// Lazy-initialize Stripe client to avoid crashing the container at startup
// Note: Cloud Functions Gen2 no longer supports `functions.config()`. Use
// environment variables (set via the console, gcloud, or Secrets Manager) such
// as STRIPE_SECRET_KEY, STRIPE_PRICE_ID, STRIPE_SUCCESS_URL, STRIPE_CANCEL_URL,
// STRIPE_WEBHOOK_SECRET.
function getStripeClient() {
  const stripeSecret = process.env.STRIPE_SECRET_KEY;
  if (!stripeSecret) {
    console.warn('Stripe secret not configured (please set STRIPE_SECRET_KEY env var). Stripe calls will fail until configured.');
    // Return a thin stub that throws on usage to provide clearer errors later
    return new Proxy({}, {
      get() {
        return () => { throw new Error('Stripe secret not configured (STRIPE_SECRET_KEY)'); };
      }
    });
  }
  return stripe(stripeSecret);
}

// Helper to send basic CORS headers for browser requests
function setCors(res) {
  res.set('Access-Control-Allow-Origin', '*');
  res.set('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.set('Access-Control-Allow-Headers', 'Content-Type, Authorization');
}

// Lightweight health check for Cloud Run / local testing
exports.healthCheck = onRequest({ region: 'us-central1' }, (req, res) => {
  res.status(200).json({ status: 'ok' });
});

// If there is a sibling `functions` directory (used during local development
// and by the repository), merge any additional exports found there so that
// deployment uses the single `functions_deploy` entrypoint configured in
// `firebase.json` while still including locally-edited functions.
try {
  // require the sibling functions folder and copy any exports not already
  // present into this module's exports. This allows iterating on
  // `functions/index.js` while keeping `functions_deploy` as the deploy
  // source.
  const extra = require('../functions');
  if (extra && typeof extra === 'object') {
    Object.keys(extra).forEach((k) => {
      if (!(k in exports)) exports[k] = extra[k];
    });
  }
} catch (e) {
  // Not fatal; log for visibility in function logs if it happens at runtime.
  // During deploy-time this file is parsed; swallow errors to avoid breaking
  // other functions when the sibling folder is missing.
  try { console.warn('No sibling functions module to merge:', e && e.message); } catch (_) {}
}

/**
 * Runtime endpoint that returns public Stripe config (publishable key + price id)
 * The publishable key is safe to expose to the browser and can be rotated without rebuilding.
 */
exports.getStripeConfig = onRequest({ region: 'us-central1' }, (req, res) => {
  // Allow simple CORS for browser fetches from your site
  res.set('Access-Control-Allow-Origin', '*');
  res.set('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.set('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.status(204).send('');
    return;
  }

  const publishableKey = process.env.STRIPE_PUBLISHABLE_KEY || process.env.VITE_STRIPE_PUBLIC_KEY || '';
  const priceId = process.env.STRIPE_PRICE_ID || '';

  res.json({ publishableKey, priceId });
});

/**
 * Create a Checkout Session for a logged-in user
 * Expects Authorization: Bearer <Firebase ID Token>
 * Body: { priceId?: string }
 */
exports.createCheckoutSession = onRequest({ region: 'us-central1' }, async (req, res) => {
  setCors(res);

  if (req.method === 'OPTIONS') {
    res.status(204).send('');
    return;
  }

  if (req.method !== 'POST') {
    res.status(405).send('Method Not Allowed');
    return;
  }

  const authHeader = req.get('Authorization') || '';
  const match = authHeader.match(/Bearer\s+(.*)/i);
  if (!match) {
    res.status(401).json({ error: 'Missing Authorization header' });
    return;
  }

  const idToken = match[1];
  let uid;
  try {
    const decoded = await admin.auth().verifyIdToken(idToken);
    uid = decoded.uid;
  } catch (err) {
    console.error('Error verifying ID token:', err);
    res.status(401).json({ error: 'Invalid ID token' });
    return;
  }

  const db = admin.firestore();
  const userRef = db.doc(`users/${uid}`);
  const userSnap = await userRef.get();
  const userData = userSnap.exists ? userSnap.data() : {};

  // Determine price id: prefer request body, fallback to env var
  const { priceId } = req.body || {};
  const usedPriceId = priceId || process.env.STRIPE_PRICE_ID;
  if (!usedPriceId) {
    res.status(400).json({ error: 'Missing priceId and no default configured' });
    return;
  }

    try {
    let stripeCustomerId = userData && userData.stripeCustomerId;
    const stripeClient = getStripeClient();

    if (stripeCustomerId) {
      // Defensive: ensure the stored customer exists in the live account.
      // If it was created in test mode, Stripe will return a resource_missing error
      // when using a live key. In that case, create a new live customer and persist it.
      try {
        await stripeClient.customers.retrieve(stripeCustomerId);
      } catch (err) {
        const isResourceMissing = (err && (err.code === 'resource_missing' || (err.raw && err.raw.code === 'resource_missing')));
        if (isResourceMissing) {
          console.log('Stored stripeCustomerId not found in live account; creating new customer');
          const customer = await stripeClient.customers.create({
            metadata: { firebaseUid: uid },
            email: (userData && userData.email) || undefined,
          });
          stripeCustomerId = customer.id;
          await userRef.set({ stripeCustomerId }, { merge: true });
        } else {
          // rethrow other errors
          throw err;
        }
      }
    }

    if (!stripeCustomerId) {
      // Create a new Stripe customer and persist
      const customer = await stripeClient.customers.create({
        metadata: { firebaseUid: uid },
        email: (userData && userData.email) || undefined,
      });
      stripeCustomerId = customer.id;
      await userRef.set({ stripeCustomerId }, { merge: true });
    }

      const successUrl = process.env.STRIPE_SUCCESS_URL || 'https://focustate.app/success';
      const cancelUrl = process.env.STRIPE_CANCEL_URL || 'https://focustate.app/cancel';

      // Allow optional trial days via request body or environment variable
      const defaultTrial = process.env.STRIPE_TRIAL_DAYS ? Number(process.env.STRIPE_TRIAL_DAYS) : null;
      const requestedTrial = (req.body && (req.body.trialDays || req.body.trial_days)) ? Number(req.body.trialDays || req.body.trial_days) : null;
      const trialDays = Number.isFinite(requestedTrial) ? requestedTrial : defaultTrial;

      const subscriptionData = { metadata: { firebaseUid: uid } };
      if (Number.isFinite(trialDays) && trialDays > 0) subscriptionData.trial_period_days = trialDays;

      // Allow callers to provide a payment method configuration (pmc_...)
      // via the request body. Fall back to an environment variable or the
      // supplied default pmc if present.
      const requestedPmc = (req.body && req.body.payment_method_configuration) || process.env.STRIPE_PMC || 'pmc_1Sctkx1kOBQDTi78QCXH8weW';

      const sessionParams = {
        mode: 'subscription',
        // Use automatic_payment_methods so Stripe enables any supported payment
        // methods for the session (wallets, cards, PayPal where available).
        automatic_payment_methods: { enabled: true },
        line_items: [{ price: usedPriceId, quantity: 1 }],
        customer: stripeCustomerId,
        client_reference_id: uid,
        success_url: successUrl + '?session_id={CHECKOUT_SESSION_ID}',
        cancel_url: cancelUrl,
        subscription_data: subscriptionData,
        allow_promotion_codes: true,
      };

      if (requestedPmc) {
        sessionParams.payment_method_configuration = requestedPmc;
      }

      const session = await stripeClient.checkout.sessions.create(sessionParams);

    // Log session info so we can debug client redirect issues (temporary)
    try {
      console.log('Created Stripe Checkout session', { id: session.id, url: session.url });
    } catch (e) {
      // ignore logging errors
    }

    res.json({ url: session.url, id: session.id });
  } catch (error) {
    console.error('Error creating checkout session:', error);
    res.status(500).json({ error: 'Unable to create checkout session' });
  }
});

/**
 * Get Checkout Session details (secure)
 * Query: ?sessionId={CHECKOUT_SESSION_ID}
 * Requires Authorization: Bearer <Firebase ID Token>
 */
exports.getCheckoutSession = onRequest({ region: 'us-central1' }, async (req, res) => {
  setCors(res);

  if (req.method === 'OPTIONS') {
    res.status(204).send('');
    return;
  }

  if (req.method !== 'GET') {
    res.status(405).send('Method Not Allowed');
    return;
  }

  const sessionId = req.query.sessionId;
  if (!sessionId) {
    res.status(400).json({ error: 'Missing sessionId query parameter' });
    return;
  }

  const authHeader = req.get('Authorization') || '';
  const match = authHeader.match(/Bearer\s+(.*)/i);
  if (!match) {
    res.status(401).json({ error: 'Missing Authorization header' });
    return;
  }

  const idToken = match[1];
  let uid;
  try {
    const decoded = await admin.auth().verifyIdToken(idToken);
    uid = decoded.uid;
  } catch (err) {
    console.error('Error verifying ID token:', err);
    res.status(401).json({ error: 'Invalid ID token' });
    return;
  }

  try {
    const stripeClient = getStripeClient();
    const session = await stripeClient.checkout.sessions.retrieve(sessionId);
    if (!session) {
      res.status(404).json({ error: 'Session not found' });
      return;
    }

    // Ensure the session belongs to this user (client_reference_id or metadata)
    const sessionUid = session.client_reference_id || (session.metadata && session.metadata.firebaseUid);
    if (sessionUid && sessionUid !== uid) {
      res.status(403).json({ error: 'Session does not belong to authenticated user' });
      return;
    }

    // Retrieve subscription details if present
    let subscription = null;
    if (session.subscription) {
      try {
        subscription = await stripeClient.subscriptions.retrieve(session.subscription);
      } catch (err) {
        console.warn('Could not retrieve subscription for session:', err.message);
      }
    }

    res.json({ session, subscription });
  } catch (err) {
    console.error('Error retrieving checkout session:', err);
    res.status(500).json({ error: 'Failed to retrieve session' });
  }
});

/**
 * Cancel or schedule cancellation for a user's subscription
 * Body: { immediate?: boolean }
 */
exports.cancelSubscription = onRequest({ region: 'us-central1' }, async (req, res) => {
  setCors(res);

  if (req.method === 'OPTIONS') {
    res.status(204).send('');
    return;
  }

  if (req.method !== 'POST') {
    res.status(405).send('Method Not Allowed');
    return;
  }

  const authHeader = req.get('Authorization') || '';
  const match = authHeader.match(/Bearer\s+(.*)/i);
  if (!match) {
    res.status(401).json({ error: 'Missing Authorization header' });
    return;
  }

  const idToken = match[1];
  let uid;
  try {
    const decoded = await admin.auth().verifyIdToken(idToken);
    uid = decoded.uid;
  } catch (err) {
    console.error('Error verifying ID token for cancelSubscription:', err);
    res.status(401).json({ error: 'Invalid ID token' });
    return;
  }

  const db = admin.firestore();
  const userRef = db.doc(`users/${uid}`);
  const userSnap = await userRef.get();
  if (!userSnap.exists) {
    res.status(404).json({ error: 'User not found' });
    return;
  }
  const userData = userSnap.data() || {};

  const { immediate } = req.body || {};
  const subscriptionId = userData.stripeSubscriptionId;
  if (!subscriptionId) {
    res.status(400).json({ error: 'No subscription found for user' });
    return;
  }

  try {
    const stripeClient = getStripeClient();
    if (immediate) {
      // Cancel immediately
      const deleted = await stripeClient.subscriptions.del(subscriptionId);

      const update = {
        flowTier: 'light',
        subscriptionStatus: 'canceled',
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      };

      await userRef.set(update, { merge: true });
      // mirror to prefs
      try {
        await db.doc(`users/${uid}/settings/preferences`).set({ flowTier: 'light', subscriptionStatus: 'canceled', updatedAt: admin.firestore.FieldValue.serverTimestamp() }, { merge: true });
      } catch (e) {
        console.warn('Could not update preferences after immediate cancel:', e.message);
      }

      res.json({ success: true, canceled: true, subscription: deleted });
      return;
    } else {
      // Schedule cancellation at period end
      const updated = await stripeClient.subscriptions.update(subscriptionId, { cancel_at_period_end: true });

      const cancelAt = !!updated.cancel_at_period_end;
      const storedStatus = (cancelAt && updated.status === 'active') ? 'canceling' : updated.status;

      const update = {
        subscriptionStatus: storedStatus,
        cancel_at_period_end: cancelAt,
        current_period_end: updated.current_period_end ? admin.firestore.Timestamp.fromMillis(updated.current_period_end * 1000) : null,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      };
      // Try to fetch upcoming invoice to populate next_billing_date for client parity with Stripe portal
      // and prefer that value for `current_period_end` so the client shows the
      // same next billing date as the Stripe portal.
      try {
        const stripeClient = getStripeClient();
        const upcoming = await stripeClient.invoices.retrieveUpcoming({ subscription: subscriptionId });
        if (upcoming && upcoming.next_payment_attempt) {
          const ts = admin.firestore.Timestamp.fromMillis(upcoming.next_payment_attempt * 1000);
          update.next_billing_date = ts;
          update.current_period_end = ts;
        }
      } catch (err) {
        console.warn('Could not retrieve upcoming invoice during schedule-cancel flow:', err && err.message ? err.message : err);
      }

      await userRef.set(update, { merge: true });
      try {
        const prefs = {
          subscriptionStatus: update.subscriptionStatus,
          cancel_at_period_end: update.cancel_at_period_end,
          current_period_end: update.current_period_end || null,
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        };
          if (update.next_billing_date) prefs.next_billing_date = update.next_billing_date;
        await db.doc(`users/${uid}/settings/preferences`).set(prefs, { merge: true });
      } catch (e) {
        console.warn('Could not update preferences after scheduled cancel:', e.message);
      }

      res.json({ success: true, canceledAtPeriodEnd: true, subscription: updated });
      return;
    }
  } catch (error) {
    console.error('Error cancelling subscription:', error);
    res.status(500).json({ error: 'Failed to cancel subscription' });
  }
});

/**
 * Create a Stripe Billing Portal session for the authenticated user
 * Response: { url }
 */
exports.createBillingPortalSession = onRequest({ region: 'us-central1' }, async (req, res) => {
  setCors(res);

  if (req.method === 'OPTIONS') {
    res.status(204).send('');
    return;
  }

  if (req.method !== 'POST') {
    res.status(405).send('Method Not Allowed');
    return;
  }

  const authHeader = req.get('Authorization') || '';
  const match = authHeader.match(/Bearer\s+(.*)/i);
  if (!match) {
    res.status(401).json({ error: 'Missing Authorization header' });
    return;
  }

  const idToken = match[1];
  let uid;
  try {
    const decoded = await admin.auth().verifyIdToken(idToken);
    uid = decoded.uid;
  } catch (err) {
    console.error('Error verifying ID token for createBillingPortalSession:', err);
    res.status(401).json({ error: 'Invalid ID token' });
    return;
  }

  const db = admin.firestore();
  const userRef = db.doc(`users/${uid}`);
  const userSnap = await userRef.get();
  if (!userSnap.exists) {
    res.status(404).json({ error: 'User not found' });
    return;
  }
  const userData = userSnap.data() || {};

  const stripeCustomerId = userData.stripeCustomerId;
  try {
    let stripeCustomerId = userData.stripeCustomerId;
    const stripeClient = getStripeClient();

    if (stripeCustomerId) {
      // Defensive: ensure stored customer exists in the live Stripe account.
      // If it was created in test mode, a live key will get resource_missing.
      try {
        await stripeClient.customers.retrieve(stripeCustomerId);
      } catch (err) {
        const isResourceMissing = (err && (err.code === 'resource_missing' || (err.raw && err.raw.code === 'resource_missing')));
        if (isResourceMissing) {
          console.log('Stored stripeCustomerId not found in live account; creating new customer for billing portal');
          const customer = await stripeClient.customers.create({
            metadata: { firebaseUid: uid },
            email: (userData && userData.email) || undefined,
          });
          stripeCustomerId = customer.id;
          await userRef.set({ stripeCustomerId }, { merge: true });
        } else {
          throw err;
        }
      }
    }

    if (!stripeCustomerId) {
      // Create a new Stripe customer if none exists yet
      const customer = await stripeClient.customers.create({
        metadata: { firebaseUid: uid },
        email: (userData && userData.email) || undefined,
      });
      stripeCustomerId = customer.id;
      await userRef.set({ stripeCustomerId }, { merge: true });
    }

    const returnUrl = process.env.STRIPE_PORTAL_RETURN_URL || process.env.STRIPE_SUCCESS_URL || 'https://focustate.app';
    const session = await stripeClient.billingPortal.sessions.create({ customer: stripeCustomerId, return_url: returnUrl });
    res.json({ url: session.url });
  } catch (err) {
    console.error('Error creating billing portal session:', err);
    res.status(500).json({ error: 'Failed to create billing portal session' });
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
  const contentType = req.headers['content-type'] || req.headers['Content-Type'];
  const rawPresent = !!req.rawBody;
  // Provide informative logging to help debug signature mismatches (common
  // causes: body was parsed/modified before verification, or webhook secret
  // configured in Stripe does not match the one in the function env).
  console.log('handleStripeWebhook invoked', {
    hasStripeSignature: !!signature,
    contentType: contentType || null,
    hasRawBody: rawPresent,
    bodyType: typeof req.body,
  });

  const bodyBuffer = req.rawBody || (req.body ? Buffer.from(JSON.stringify(req.body)) : Buffer.from(''));
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

  if (!signature || !webhookSecret) {
    console.error('Missing stripe-signature header or webhook secret', { hasHeader: !!signature, hasEnv: !!webhookSecret });
    res.status(400).send('Missing Stripe signature or webhook secret');
    return;
  }

  let event;

  try {
    const stripeClient = getStripeClient();
    event = stripeClient.webhooks.constructEvent(bodyBuffer, signature, webhookSecret);
  } catch (err) {
    console.error(`Webhook signature verification failed: ${err.message}`, {
      signaturePresent: !!signature,
      rawBodyLength: bodyBuffer ? bodyBuffer.length : 0,
      rawBodyAvailable: rawPresent,
    });
    // Give a slightly more actionable message back to Stripe's dashboard
    // so the delivery status shows helpful information for debugging.
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

async function handleCheckoutSessionCompleted(session) {
  console.log('Checkout session completed:', session.id);
  const db = admin.firestore();

  let userId = session.client_reference_id || (session.metadata && session.metadata.firebaseUid);

  if (!userId && session.customer) {
    const userQuery = await db.collection('users').where('stripeCustomerId', '==', session.customer).limit(1).get();
    if (!userQuery.empty) userId = userQuery.docs[0].id;
  }

  if (!userId) {
    console.warn('Could not determine Firebase UID for session', session.id);
    return;
  }

  try {
    let subscriptionData = {};
    if (session.subscription) {
      try {
        const stripeClient = getStripeClient();
        const sub = await stripeClient.subscriptions.retrieve(session.subscription);
        const cancelAt = !!sub.cancel_at_period_end;
        const derivedStatus = (cancelAt && sub.status === 'active') ? 'canceling' : sub.status;
        subscriptionData = {
          stripeSubscriptionId: sub.id,
          subscriptionStatus: derivedStatus,
          cancel_at_period_end: cancelAt,
          current_period_end: sub.current_period_end ? admin.firestore.Timestamp.fromMillis(sub.current_period_end * 1000) : null,
        };
        // Try to pull upcoming invoice to write a next billing date matching Stripe's portal
        // and prefer that value for `current_period_end` so clients and portal match.
        try {
          const upcoming = await stripeClient.invoices.retrieveUpcoming({ subscription: sub.id });
          if (upcoming && upcoming.next_payment_attempt) {
            const ts = admin.firestore.Timestamp.fromMillis(upcoming.next_payment_attempt * 1000);
            subscriptionData.next_billing_date = ts;
            subscriptionData.current_period_end = ts;
          }
        } catch (err) {
          console.warn('Could not retrieve upcoming invoice during checkout session handling:', err && err.message ? err.message : err);
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

    // Update top-level user doc
    await db.doc(`users/${userId}`).set(update, { merge: true });

    // Also update the preferences subdocument used by the client UI
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
      console.warn('Could not update preferences subdocument:', e.message);
    }

    console.log(`Successfully updated user ${userId} to flow tier`);
  } catch (error) {
    console.error(`Error updating user ${userId}:`, error);
    throw error;
  }
}

async function handleSubscriptionUpdated(subscription) {
  console.log('Subscription updated:', subscription.id);
  const customerId = subscription.customer;
  const db = admin.firestore();

  try {
    const userQuery = await db.collection('users').where('stripeCustomerId', '==', customerId).limit(1).get();

    if (userQuery.empty) {
      console.warn(`No user found for customer ${customerId}`);
      return;
    }

    const userDoc = userQuery.docs[0];
    const status = subscription.status;
    const cancelAt = !!subscription.cancel_at_period_end;

    // If Stripe reports the subscription is active but scheduled to cancel,
    // surface a 'canceling' status for clearer client UI.
    const storedStatus = (cancelAt && status === 'active') ? 'canceling' : status;

    const tier = (status === 'active' || status === 'trialing') ? 'flow' : 'light';

    const update = {
      flowTier: tier,
      subscriptionStatus: storedStatus,
      cancel_at_period_end: cancelAt,
      stripeSubscriptionId: subscription.id,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    };

    if (subscription.current_period_end) {
      update.current_period_end = admin.firestore.Timestamp.fromMillis(subscription.current_period_end * 1000);
    }
    // Attempt to record a next_billing_date from the upcoming invoice (preferred source for portal date)
    // and prefer that value for `current_period_end` so the client matches the portal.
    try {
      const stripeClient = getStripeClient();
      const upcoming = await stripeClient.invoices.retrieveUpcoming({ subscription: subscription.id });
      if (upcoming && upcoming.next_payment_attempt) {
        const ts = admin.firestore.Timestamp.fromMillis(upcoming.next_payment_attempt * 1000);
        update.next_billing_date = ts;
        update.current_period_end = ts;
      }
    } catch (err) {
      console.warn('Could not retrieve upcoming invoice for subscription update (deploy):', err && err.message ? err.message : err);
    }

    await userDoc.ref.set(update, { merge: true });

    // Mirror into preferences subdocument for client compatibility
    try {
      const prefs = {
        flowTier: update.flowTier,
        subscriptionStatus: update.subscriptionStatus,
        cancel_at_period_end: update.cancel_at_period_end,
        stripeSubscriptionId: update.stripeSubscriptionId,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      };
      if (update.current_period_end) prefs.current_period_end = update.current_period_end;
      if (update.next_billing_date) prefs.next_billing_date = update.next_billing_date;
      await userDoc.ref.collection('settings').doc('preferences').set(prefs, { merge: true });
    } catch (e) {
      console.warn('Could not mirror subscription update to preferences:', e.message);
    }

    console.log(`Updated subscription for user to tier: ${tier} (status: ${status})`);
  } catch (error) {
    console.error('Error updating subscription:', error);
    throw error;
  }
}

async function handleSubscriptionDeleted(subscription) {
  console.log('Subscription deleted:', subscription.id);
  const customerId = subscription.customer;
  const db = admin.firestore();

  try {
    const userQuery = await db.collection('users').where('stripeCustomerId', '==', customerId).limit(1).get();

    if (userQuery.empty) {
      console.warn(`No user found for customer ${customerId}`);
      return;
    }

    const userDoc = userQuery.docs[0];

    const update = {
      flowTier: 'light',
      subscriptionStatus: 'canceled',
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    };

    await userDoc.ref.set(update, { merge: true });

    // Mirror into preferences subdocument for client compatibility
    try {
      const prefs = {
        flowTier: update.flowTier,
        subscriptionStatus: update.subscriptionStatus,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      };
      await userDoc.ref.collection('settings').doc('preferences').set(prefs, { merge: true });
    } catch (e) {
      console.warn('Could not mirror subscription deletion to preferences:', e.message);
    }

    console.log(`Downgraded user to light tier after subscription cancellation`);
  } catch (error) {
    console.error('Error handling subscription deletion:', error);
    throw error;
  }
}

/**
 * Immediate account deletion HTTP endpoint (CORS-friendly)
 * Body: none. Requires Authorization: Bearer <Firebase ID Token>
 * NOTE: This performs destructive deletion of Firestore docs, Storage files,
 * and the Firebase Auth user record. Use with caution.
 */
exports.deleteAccountNow = onRequest({ region: 'us-central1' }, async (req, res) => {
  setCors(res);
  if (req.method === 'OPTIONS') {
    res.status(204).send('');
    return;
  }
  if (req.method !== 'POST') {
    res.status(405).send('Method Not Allowed');
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
    console.error('deleteAccountNow: invalid id token', err);
    res.status(401).json({ success: false, error: 'Invalid ID token' });
    return;
  }

  const db = admin.firestore();
  const userRef = db.doc(`users/${uid}`);

  try {
    // Delete common subcollections
    const subcollections = ['documents', 'flashcards', 'settings', 'game'];
    for (const sub of subcollections) {
      try {
        const colSnap = await db.collection(`users/${uid}/${sub}`).get();
        const deletes = colSnap.docs.map(d => d.ref.delete().catch(() => {}));
        await Promise.all(deletes);
      } catch (e) {
        console.warn('deleteAccountNow: failed to clear subcollection', sub, e && e.message);
      }
    }

    // Remove username mapping if present
    try {
      const userSnap = await userRef.get();
      const data = userSnap.exists ? userSnap.data() : {};
      const usernameLower = data && data.usernameLower;
      if (usernameLower) await db.doc(`usernames/${usernameLower}`).delete().catch(() => {});
    } catch (e) {
      console.warn('deleteAccountNow: failed to remove username mapping', e && e.message);
    }

    // Delete user root doc
    try { await userRef.delete().catch(() => {}); } catch (e) { /* ignore */ }

    // Delete storage files under users/{uid}/
    try {
      const bucket = admin.storage().bucket();
      await bucket.deleteFiles({ prefix: `users/${uid}/` });
    } catch (e) {
      console.warn('deleteAccountNow: storage deletion failed', e && e.message);
    }

    // Revoke refresh tokens and delete auth user
    try {
      await admin.auth().revokeRefreshTokens(uid).catch((e) => { console.warn('revokeRefreshTokens failed', e && e.message); });
      // small delay to allow revocation to propagate
      await new Promise((r) => setTimeout(r, 1000));
      await admin.auth().deleteUser(uid);
    } catch (e) {
      console.warn('deleteAccountNow: failed to delete auth user', e && e.message);
    }

    // Tombstone record for audit
    try { await db.doc(`deletedUsers/${uid}`).set({ deletedAt: admin.firestore.FieldValue.serverTimestamp() }, { merge: true }); } catch (e) { /* ignore */ }

    res.json({ success: true });
    return;
  } catch (err) {
    console.error('deleteAccountNow: unexpected error', err);
    res.status(500).json({ success: false, error: 'Failed to delete account' });
    return;
  }
});

# Stripe + Firebase Functions — Deployment & Testing Checklist

This document describes how to configure, test, and deploy the Stripe Checkout + webhook integration implemented in `functions/index.js`.

Prerequisites
- Node.js and npm installed
- Firebase CLI installed and authenticated (`npm i -g firebase-tools`)
- Stripe CLI installed and authenticated (`brew install stripe` or follow Stripe docs)
- Your Stripe test keys and webhook secret available

1) Configure Firebase Functions secrets (recommended)

Use `functions.config()` to store stripe secrets securely for functions:

```bash
firebase functions:config:set \
  stripe.secret="sk_test_..." \
  stripe.webhook_secret="whsec_..." \
  stripe.price_id="price_..." \
  stripe.success_url="https://your-app.example.com/success" \
  stripe.cancel_url="https://your-app.example.com/cancel"
```

After setting config, redeploy functions or run the emulator.

2) Local testing with Firebase emulators + Stripe CLI

- Start Firebase emulators (functions and firestore):

```bash
firebase emulators:start --only functions,firestore,auth
```

- In a separate terminal, forward Stripe events to your local webhook. Replace `<PROJECT>` with your Firebase project id and adjust region/URL if different. Example local URL for functions emulator:

```
LOCAL_URL=http://localhost:5001/<PROJECT>/us-central1/handleStripeWebhook
stripe listen --forward-to "$LOCAL_URL"
```

- In another terminal (or the same once listen is running), trigger test events:

```
stripe trigger checkout.session.completed
stripe trigger customer.subscription.deleted
```

These `stripe trigger` commands will emit example events to the Stripe CLI, which forwards them to your `handleStripeWebhook` function.

3) Smoke-test script

See `functions/smoke_test.sh` — a small helper that starts `stripe listen` (forwarding to your function URL), triggers two test events, then stops the listener. Edit `FUNCTION_URL` at the top or pass it via env.

4) Deploying to production

- Once tested, deploy functions:

```bash
firebase.deploy --only functions
```

- Register the deployed webhook URL in Stripe Dashboard (or use the Stripe CLI to create a webhook endpoint). Use the URL of `handleStripeWebhook` (e.g., `https://us-central1-<PROJECT>.cloudfunctions.net/handleStripeWebhook`). Copy the webhook secret and set it in `functions.config()` or your environment variables for production.

5) Verifying Firestore updates

- After a successful test event, check the user document at `users/{uid}` for the following fields that the webhook sets/updates:
  - `flowTier`: `flow` or `light`
  - `stripeCustomerId`
  - `stripeSubscriptionId`
  - `subscriptionStatus`
  - `current_period_end` (Firestore Timestamp)

6) Notes and troubleshooting
- If your webhook handler returns 4xx due to signature verification, ensure you are using the correct webhook secret (test vs live) and using the raw request body (the emulator and functions are already set up to provide `req.rawBody`).
- Use test mode keys when testing. Never commit secrets to the repository.
- For production, use the live Stripe keys and webhook secret from the Stripe Dashboard and configure them with `firebase functions:config:set` or your cloud provider secrets manager.

Frontend live key deploy
---------------------------------
To make the frontend use your live Stripe publishable key (Vite inlines envs at build time), create a file `.env.production` containing:

```
VITE_STRIPE_PUBLIC_KEY=pk_live_...
VITE_STRIPE_FLOW_PRICE_ID=price_...
```

Then run a build and deploy hosting. There's a convenience script at `scripts/deploy_live_frontend.sh` which will prompt you for these values locally, write `.env.production`, run `npm run build`, and `firebase deploy --only hosting`.

Important: do not paste secret values into chat. The publishable key is safe to place in the frontend, but keep secret keys only in Secret Manager or functions config.

Runtime config endpoint
---------------------------------
If you prefer not to rebuild the frontend when rotating publishable keys, you can fetch the publishable key and price id at runtime from the server. A small function `getStripeConfig` is provided and routed at `/api/stripe-config` via Firebase Hosting rewrites.

To deploy the runtime endpoint with the publishable key as an env var (non-sensitive):

```bash
gcloud functions deploy getStripeConfig \
  --gen2 --region=us-central1 --runtime=nodejs20 \
  --source=functions_deploy --trigger-http --entry-point=getStripeConfig \
  --set-env-vars="STRIPE_PUBLISHABLE_KEY=pk_live_...,STRIPE_PRICE_ID=price_..." \
  --project=focustate
```

Frontend usage example (fetch before initializing Stripe):

```js
// call this before creating the Stripe instance
async function loadStripeConfig() {
  const resp = await fetch('/api/stripe-config');
  return resp.json(); // { publishableKey, priceId }
}

const cfg = await loadStripeConfig();
const stripe = Stripe(cfg.publishableKey);
```

This lets you rotate the publishable key without rebuilding the static site.

If you'd like, I can also add an automated step that queries Firestore after the test events and prints the updated document — tell me if you want that added to `smoke_test.sh`.

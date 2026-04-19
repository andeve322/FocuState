# Firebase Cloud Functions for UniFocus - Stripe Integration

## Setup Steps

### 1. Install dependencies
```bash
cd functions
npm install
```

### 2. Set environment variables
The Cloud Function needs these environment variables set in Firebase:

```bash
firebase functions:config:set stripe.secret_key="sk_test_..." stripe.webhook_secret="whsec_..."
```

Or edit `.env.local` in the `functions` directory:
```
STRIPE_SECRET_KEY=sk_test_...
STRIPE_WEBHOOK_SECRET=whsec_...
```

### 3. Deploy the function
```bash
firebase deploy --only functions
```

The function will be deployed as `handleStripeWebhook` and accessible at:
```
https://us-central1-{PROJECT_ID}.cloudfunctions.net/handleStripeWebhook
```

### 4. Configure Stripe Webhook
1. Go to [Stripe Dashboard > Webhooks](https://dashboard.stripe.com/webhooks)
2. Click "Add endpoint"
3. Paste your Cloud Function URL from step 3
4. Select these events:
   - `checkout.session.completed`
   - `customer.subscription.updated`
   - `customer.subscription.deleted`
5. Copy the "Signing secret" and use it for `STRIPE_WEBHOOK_SECRET`

### 5. Ensure Firestore Security Rules allow updates
Make sure your Firestore rules allow the Cloud Function to write to user settings:

```javascript
match /users/{userId}/settings/preferences {
  allow read: if request.auth.uid == userId;
  allow write: if request.auth.uid == userId || 
               (request.auth == null && request.resource.data.updatedAt == request.time);
}
```

## How it works

1. User clicks "Upgrade to Flow" in the app
2. Redirected to Stripe Checkout with `clientReferenceId` set to their Firebase UID
3. User completes payment
4. Stripe sends webhook to Cloud Function
5. Cloud Function extracts user ID and updates Firestore `flowTier` to `'flow'` (treats user as paid)
6. App detects `?checkout=success` and updates UI (or fetches fresh `flowTier` from Firestore on next load)

## Environment Variables Reference

**Client (.env.local in project root):**
- `VITE_STRIPE_PUBLIC_KEY`: Your Stripe publishable key
- `VITE_STRIPE_FLOW_PRICE_ID`: The price ID of your subscription product

**Cloud Function (Firebase config):**
- `STRIPE_SECRET_KEY`: Your Stripe secret key (restricted)
- `STRIPE_WEBHOOK_SECRET`: Webhook signing secret from Stripe dashboard

## Testing locally

1. Run functions emulator:
```bash
firebase emulators:start --only functions
```

2. Use Stripe CLI to forward webhooks to local emulator:
```bash
stripe listen --forward-to http://localhost:5001/{PROJECT_ID}/us-central1/handleStripeWebhook
```

3. Test with Stripe CLI:
```bash
stripe trigger checkout.session.completed
```

See logs with:
```bash
firebase functions:log
```

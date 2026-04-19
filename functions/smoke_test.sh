#!/usr/bin/env bash
set -euo pipefail

# Simple smoke-test for local webhook handling using the Stripe CLI.
# Usage: FUNCTION_URL="http://localhost:5001/<PROJECT>/us-central1/handleStripeWebhook" ./functions/smoke_test.sh

if ! command -v stripe >/dev/null 2>&1; then
  echo "Stripe CLI is required. Install from https://stripe.com/docs/stripe-cli"
  exit 2
fi

FUNCTION_URL=${FUNCTION_URL:-}
if [ -z "$FUNCTION_URL" ]; then
  echo "Please set FUNCTION_URL environment variable to your webhook endpoint." >&2
  echo "Example: FUNCTION_URL=http://localhost:5001/<PROJECT>/us-central1/handleStripeWebhook" >&2
  exit 2
fi

echo "Starting stripe listen, forwarding to: $FUNCTION_URL"

# Start stripe listen in background and capture its PID
stripe listen --forward-to "$FUNCTION_URL" &
LISTEN_PID=$!

# Give the listener a moment to start
sleep 2

echo "Triggering sample events..."
stripe trigger checkout.session.completed || echo "Trigger failed (checkout). Check stripe CLI output."
sleep 1
stripe trigger customer.subscription.deleted || echo "Trigger failed (subscription.deleted)."

echo "Waiting briefly for webhook processing..."
sleep 3

echo "Stopping stripe listen (pid $LISTEN_PID)"
kill $LISTEN_PID || true

echo "Smoke test complete. Check Firestore for user updates and the collection 'stripeWebhookEvents' for processed event ids."

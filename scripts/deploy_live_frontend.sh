#!/usr/bin/env zsh
# Small helper to build + deploy the frontend with live Stripe publishable key
# Prompts for the publishable key and price id, writes `.env.production`, builds, and deploys hosting.
# Run this locally; do NOT paste your keys into chat.

set -euo pipefail

echo "This script will create/overwrite .env.production with your live Stripe keys and deploy hosting."
read -r -p "Enter your Stripe publishable key (pk_live_...): " PUBLISHABLE_KEY
read -r -p "Enter your Stripe price id (price_...): " PRICE_ID

cat > .env.production <<EOF
VITE_STRIPE_PUBLIC_KEY=${PUBLISHABLE_KEY}
VITE_STRIPE_FLOW_PRICE_ID=${PRICE_ID}
EOF

echo ".env.production created with publishable key and price id. Building the site..."

# Install deps if node_modules missing
if [ ! -d node_modules ]; then
  echo "node_modules not found — running npm install"
  npm install
fi

npm run build

echo "Build complete. Deploying hosting..."
firebase deploy --only hosting

echo "Deployment complete. Remember to remove or secure .env.production if you don't want it stored locally." 

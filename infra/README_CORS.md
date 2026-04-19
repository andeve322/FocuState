# Configure Firebase Storage CORS

This file contains a ready-to-use CORS policy (`cors.json`) for the `focustate` Storage bucket.

It allows preflight and uploads from local dev origins and the production host `focustate.app`.

## Apply via Google Cloud SDK (recommended)

1. Install and authenticate the Google Cloud SDK if needed:

```bash
# install (macOS example via Homebrew)
brew install --cask google-cloud-sdk
# then authenticate
gcloud auth login
```

2. Select the project and apply the CORS config:

```bash
gcloud config set project focustate
# Apply the CORS json to the bucket
gsutil cors set infra/cors.json gs://focustate.appspot.com
```

3. Wait ~30–60s for changes to propagate, clear browser cache, and retry uploads.

## Apply via Google Cloud Console (UI)

1. Go to https://console.cloud.google.com/storage/browser
2. Select the bucket `focustate.appspot.com`.
3. Find the CORS configuration editor (Bucket details → Edit CORS configuration) and paste the contents of `infra/cors.json`.
4. Save, then wait and retry.

## If you cannot change bucket CORS

Options:
- Upload via your backend (Cloud Function / Express route) which receives the file from the browser and uploads to Storage server-side (no CORS).
- Generate signed upload URLs server-side and POST to that signed URL from the browser.
- As a temporary safety measure, the app can store the PDF base64 locally if upload fails (I can add this fallback in the client if needed).

## After applying

- Open DevTools → Network and verify the `OPTIONS` preflight request to `firebasestorage.googleapis.com` returns 200 with CORS response headers (Access-Control-Allow-Origin etc.).
- Then the actual upload request should proceed and return 200/201.

If you want, I can also add a small retry UI in the app to surface upload failure and allow manual retry once CORS is updated.

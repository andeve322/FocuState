# Firebase Cloud Storage Security Rules Setup

To enable PDF uploads to Cloud Storage, you need to update your Cloud Storage security rules.

## Steps:

1. Go to [Firebase Console](https://console.firebase.google.com)
2. Select your **focustate** project
3. Click **Storage** in the left sidebar
4. Click the **Rules** tab at the top
5. Replace all existing content with this:

```
rules_version = '2';
service firebase.storage {
  match /b/{bucket}/o {
    match /users/{userId}/pdfs/{allPaths=**} {
      allow read, write: if request.auth.uid == userId;
    }
  }
}
```

6. Click **Publish**

## What These Rules Do:

- Only authenticated users can upload/download PDFs
- Users can only access their own PDFs (`request.auth.uid == userId`)
- PDFs are stored in paths like: `/users/{userId}/pdfs/{folderId}/{fileName}`
- Users cannot access other users' PDFs

That's it! After publishing, PDF uploads will work properly.

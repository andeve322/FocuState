# Firestore Security Rules Setup

To enable cloud sync, you need to update your Firestore security rules to allow authenticated users to read and write their own data.

## Steps to Update Security Rules:

1. Go to [Firebase Console](https://console.firebase.google.com)
2. Select your project: **focustate**
3. Navigate to **Firestore Database** → **Rules** tab
4. Replace the existing rules with the following:

```javascript
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    // Allow users to read and write only their own user document
    match /users/{userId} {
      allow read, write: if request.auth.uid == userId;
    }
  }
}
```

## What These Rules Do:

- Users can only read and write to documents in the `users` collection where the document ID matches their UID
- This ensures users can only access their own data
- Unauthenticated users cannot access any data

## Publish Rules:

1. Click the **Publish** button at the bottom right
2. Confirm the update
3. Wait a few seconds for the rules to take effect

## Data Structure:

After these rules are in place, your data will be stored as:

```
/users/{userId} (single document with all user data)
  - documents (stringified JSON of folder structure)
  - stats (stringified JSON of work/break stats)
  - dailyRecords (stringified JSON of daily focus history)
  - documentsLastSynced (timestamp)
  - statsLastSynced (timestamp)
  - dailyRecordsLastSynced (timestamp)
```

This simplified structure works better with Firestore's security model and avoids the `ERR_BLOCKED_BY_CLIENT` errors you were seeing.

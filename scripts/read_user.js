const admin = require('firebase-admin');
const path = require('path');

const keyPath = path.resolve(__dirname, '..', 'serviceAccountKey.json');

if (!keyPath) {
  console.error('serviceAccountKey.json not found');
  process.exit(1);
}

admin.initializeApp({
  credential: admin.credential.cert(require(keyPath)),
});

const db = admin.firestore();

const uid = process.argv[2] || 'U0PyRXiGZEa8UPWi3knKgzNLadH2';

(async () => {
  try {
    const doc = await db.doc(`users/${uid}`).get();
    if (!doc.exists) {
      console.log('No user doc for', uid);
      process.exit(0);
    }
    console.log('User doc:', JSON.stringify(doc.data(), null, 2));
  } catch (err) {
    console.error('Error reading user doc:', err);
    process.exit(2);
  }
})();

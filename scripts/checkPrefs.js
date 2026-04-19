import admin from 'firebase-admin';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import fs from 'fs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const serviceAccountKey = JSON.parse(fs.readFileSync(`${__dirname}/../serviceAccountKey.json`, 'utf8'));

admin.initializeApp({
  credential: admin.credential.cert(serviceAccountKey),
  databaseURL: 'https://unifocus-76c6e.firebaseio.com'
});

const db = admin.firestore();

async function checkPrefs() {
  const usersSnapshot = await db.collection('users').get();
  
  console.log(`Found ${usersSnapshot.docs.length} users\n`);
  
  for (const userDoc of usersSnapshot.docs) {
    const userId = userDoc.id;
    const prefsDoc = await db.doc(`users/${userId}/settings/preferences`).get();
    
    if (prefsDoc.exists) {
      console.log(`User ${userId}:`);
      console.log(JSON.stringify(prefsDoc.data(), null, 2));
      console.log('---');
    }
  }
  
  process.exit(0);
}

checkPrefs().catch(err => {
  console.error('Error:', err);
  process.exit(1);
});

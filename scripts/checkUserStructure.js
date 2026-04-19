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

async function checkUserStructure() {
  console.log('Checking user data structure...\n');
  
  const usersSnapshot = await db.collection('users').limit(1).get();
  
  for (const userDoc of usersSnapshot.docs) {
    const userId = userDoc.id;
    console.log(`User ID: ${userId}`);
    console.log('User doc data:', JSON.stringify(userDoc.data(), null, 2));
    
    // Check settings subcollection
    const settingsSnapshot = await db.collection(`users/${userId}/settings`).get();
    console.log('\nSettings subcollection documents:');
    for (const doc of settingsSnapshot.docs) {
      console.log(`  ${doc.id}:`, JSON.stringify(doc.data(), null, 2));
    }
  }
  
  process.exit(0);
}

checkUserStructure().catch(err => {
  console.error('Error:', err);
  process.exit(1);
});

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

async function checkLeaderboards() {
  console.log('Checking leaderboard data...\n');
  
  const collections = ['focus_weekly', 'focus_monthly', 'snake'];
  
  for (const col of collections) {
    console.log(`\n=== ${col.toUpperCase()} ===`);
    const snapshot = await db.collection('leaderboards').doc(col).collection('entries').get();
    
    for (const doc of snapshot.docs) {
      console.log(`ID: ${doc.id}`);
      console.log(JSON.stringify(doc.data(), null, 2));
      console.log('---');
    }
  }
  
  process.exit(0);
}

checkLeaderboards().catch(err => {
  console.error('Error:', err);
  process.exit(1);
});

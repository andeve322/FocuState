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

async function clearLeaderboards() {
  console.log('Clearing all leaderboard entries...\n');
  
  const collections = ['focus_weekly', 'focus_monthly', 'snake'];
  
  for (const col of collections) {
    const snapshot = await db.collection('leaderboards').doc(col).collection('entries').get();
    for (const doc of snapshot.docs) {
      await doc.ref.delete();
      console.log(`Deleted ${col}/${doc.id}`);
    }
  }
  
  console.log('\n✓ All leaderboard entries cleared');
  process.exit(0);
}

clearLeaderboards().catch(err => {
  console.error('Error:', err);
  process.exit(1);
});

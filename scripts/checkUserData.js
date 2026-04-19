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

async function checkUserData() {
  console.log('Checking user data...\n');
  
  const users = ['rP4Qf3E1rIRzc1NEqLIIjAtajL32', 'dNJay8j3fLOUKtlWbRZGPCQLPaH2'];
  
  for (const userId of users) {
    const userDoc = await db.collection('users').doc(userId).get();
    if (userDoc.exists) {
      const data = userDoc.data();
      console.log(`\nUser: ${userId}`);
      console.log('dailyRecords:', data.dailyRecords);
      console.log('Parsed:');
      try {
        const parsed = typeof data.dailyRecords === 'string' ? JSON.parse(data.dailyRecords) : data.dailyRecords;
        console.log(parsed);
      } catch (e) {
        console.log('Error parsing:', e.message);
      }
    }
  }
  
  process.exit(0);
}

checkUserData().catch(err => {
  console.error('Error:', err);
  process.exit(1);
});

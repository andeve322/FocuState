#!/usr/bin/env node

/**
 * One-time migration script to populate leaderboards from existing cloud data.
 * Reads all users' focus stats and BreakSnake scores, writes to leaderboard collections.
 * Run with: node scripts/populateLeaderboards.js
 */

import admin from 'firebase-admin';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import fs from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Initialize Firebase Admin
const serviceAccountPath = join(__dirname, '../serviceAccountKey.json');
const serviceAccount = JSON.parse(fs.readFileSync(serviceAccountPath, 'utf-8'));
admin.initializeApp({
  credential: admin.credential.cert(serviceAccount)
});

const db = admin.firestore();

function getWeekStart(date = new Date()) {
  const d = new Date(date);
  const daysSinceSaturday = (d.getDay() + 1) % 7;
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - daysSinceSaturday);
  return d;
}

function getMonthStart(date = new Date()) {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  d.setDate(1);
  return d;
}

function sumFocusMinutesSince(records, startDate) {
  if (!records) return 0;
  // Convert startDate to YYYY-MM-DD string for comparison
  const startYear = startDate.getFullYear();
  const startMonth = String(startDate.getMonth() + 1).padStart(2, '0');
  const startDay = String(startDate.getDate()).padStart(2, '0');
  const startDateStr = `${startYear}-${startMonth}-${startDay}`;
  
  return Object.entries(records).reduce((acc, [dateKey, minutes]) => {
    // Compare date strings directly (YYYY-MM-DD format)
    if (dateKey >= startDateStr) {
      acc += Number(minutes) || 0;
    }
    return acc;
  }, 0);
}

async function populateLeaderboards() {
  console.log('Starting leaderboard population...\n');

  try {
    // 1. Fetch all users
    const usersSnapshot = await db.collection('users').get();
    console.log(`Found ${usersSnapshot.size} total users\n`);

    let flowCount = 0;
    let focusWeeklyWrites = 0;
    let focusMonthlyWrites = 0;
    let snakeWrites = 0;

    const weeklyStart = getWeekStart();
    const monthlyStart = getMonthStart();
    const weeklyKey = weeklyStart.toISOString();
    const monthlyKey = monthlyStart.toISOString();

    for (const userDoc of usersSnapshot.docs) {
      const userId = userDoc.id;
      const userData = userDoc.data();

      // Check if user has Flow tier - all users with flowTier should have leaderboard access
      // (flowTier is stored for theme management but indicates app access level)
      let hasFlowTier = false;
      try {
        const prefsDoc = await db.doc(`users/${userId}/settings/preferences`).get();
        if (prefsDoc.exists) {
          hasFlowTier = prefsDoc.data().flowTier === 'flow';
        }
      } catch (err) {
        console.log(`  Skipping user ${userId}: error reading preferences - ${err.message}`);
        continue;
      }

      if (!hasFlowTier) {
        console.log(`  Skipping user ${userId}: no Flow tier`);
        continue;
      }

      flowCount++;
      console.log(`\nProcessing Flow user ${flowCount}: ${userId}`);
      const username = userData.username || (userData.email ? userData.email.split('@')[0] : 'user');

      // === FOCUS LEADERBOARD ===
      if (userData.dailyRecords) {
        try {
          const dailyRecords = typeof userData.dailyRecords === 'string' 
            ? JSON.parse(userData.dailyRecords) 
            : userData.dailyRecords;

          const weeklyMinutes = sumFocusMinutesSince(dailyRecords, weeklyStart);
          const monthlyMinutes = sumFocusMinutesSince(dailyRecords, monthlyStart);

          // Write weekly entry
          if (weeklyMinutes > 0) {
            await db.doc(`leaderboards/focus_weekly/entries/${userId}`).set({
              username,
              minutes: weeklyMinutes,
              periodType: 'weekly',
              periodStart: weeklyKey,
              updatedAt: new Date().toISOString()
            });
            focusWeeklyWrites++;
            console.log(`  ✓ Weekly focus: ${weeklyMinutes} min`);
          }

          // Write monthly entry
          if (monthlyMinutes > 0) {
            await db.doc(`leaderboards/focus_monthly/entries/${userId}`).set({
              username,
              minutes: monthlyMinutes,
              periodType: 'monthly',
              periodStart: monthlyKey,
              updatedAt: new Date().toISOString()
            });
            focusMonthlyWrites++;
            console.log(`  ✓ Monthly focus: ${monthlyMinutes} min`);
          }
        } catch (err) {
          console.error(`  ✗ Focus error: ${err.message}`);
        }
      }

      // === BREAKSNAKE LEADERBOARD ===
      try {
        const snakeDocPath = `users/${userId}/game/snake`;
        const snakeDoc = await db.doc(snakeDocPath).get();

        if (snakeDoc.exists && snakeDoc.data().highScore > 0) {
          const highScore = snakeDoc.data().highScore;
          await db.doc(`leaderboards/snake/entries/${userId}`).set({
            username,
            score: highScore,
            updatedAt: new Date().toISOString()
          });
          snakeWrites++;
          console.log(`  ✓ BreakSnake high score: ${highScore}`);
        }
      } catch (err) {
        console.error(`  ✗ BreakSnake error: ${err.message}`);
      }
    }

    console.log(`\n✅ Migration complete!`);
    console.log(`  Flow users processed: ${flowCount}`);
    console.log(`  Focus weekly entries written: ${focusWeeklyWrites}`);
    console.log(`  Focus monthly entries written: ${focusMonthlyWrites}`);
    console.log(`  BreakSnake entries written: ${snakeWrites}`);

    process.exit(0);
  } catch (err) {
    console.error('Fatal error:', err);
    process.exit(1);
  }
}

populateLeaderboards();

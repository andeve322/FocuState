import { get, set, del } from 'idb-keyval';

// Local persistence helpers for per-user (or anonymous) local-first storage
// Keys: local:${uid}:${bucket}
// 
// This module now handles ALL data persistence locally:
// - Documents & notes
// - Flashcard decks
// - Study hours & focus stats
// - Daily focus records
// - Todo lists
// - Subject tags
// - User preferences
// - Folder structure

const MANIFEST_KEY = (uid) => `local:${uid}:manifest`;
const BUCKET_KEY = (uid, bucket) => `local:${uid}:${bucket}`;

// Additional data-specific keys
const DOCUMENTS_KEY = (uid) => `local:${uid}:documents`;
const FLASHCARDS_KEY = (uid) => `local:${uid}:flashcards`;
const TAGS_KEY = (uid) => `local:${uid}:tags`;
const TODOS_KEY = (uid) => `local:${uid}:todos`;
const FOCUS_STATS_KEY = (uid) => `local:${uid}:focusStats`;
const DAILY_RECORDS_KEY = (uid) => `local:${uid}:dailyRecords`;
const FOLDER_STRUCTURE_KEY = (uid) => `local:${uid}:folderStructure`;
const USER_PREFERENCES_KEY = (uid) => `local:${uid}:userPreferences`;

const debounceMap = new Map();

export async function saveBucket(uid, bucketName, data) {
  const key = BUCKET_KEY(uid, bucketName);
  const payload = { data, lastModified: Date.now(), schemaVersion: 1 };
  try {
    await set(key, payload);
    try { console.debug(`[localPersistence] saveBucket wrote ${key}`); } catch (e) {}
    // Update manifest
    const manifestKey = MANIFEST_KEY(uid);
    const manifest = (await get(manifestKey)) || { items: {} };
    manifest.items = manifest.items || {};
    manifest.items[bucketName] = { lastModified: payload.lastModified, schemaVersion: payload.schemaVersion };
    await set(manifestKey, manifest);
    return payload;
  } catch (err) {
    try { console.warn('[localPersistence] saveBucket failed:', err); } catch (e) {}
    return { data: null, lastModified: null, schemaVersion: 1 };
  }
}

export async function loadBucket(uid, bucketName) {
  const key = BUCKET_KEY(uid, bucketName);
  const payload = await get(key);
  return payload ? payload.data : null;
}

export async function loadBucketMeta(uid, bucketName) {
  const key = BUCKET_KEY(uid, bucketName);
  const payload = await get(key);
  return payload ? { lastModified: payload.lastModified, schemaVersion: payload.schemaVersion } : null;
}

export async function loadManifest(uid) {
  const manifestKey = MANIFEST_KEY(uid);
  return (await get(manifestKey)) || null;
}

export function scheduleLocalSave(uid, bucketName, data, delay = 700) {
  const key = `${uid}:${bucketName}`;
  try {
    if (debounceMap.has(key)) {
      clearTimeout(debounceMap.get(key).timer);
    }
    const entry = { data };
    const timer = setTimeout(async () => {
      try {
        await saveBucket(uid, bucketName, data);
      } catch (e) {
        try { console.warn('[localPersistence] scheduled save failed', e); } catch (e) {}
      }
      debounceMap.delete(key);
    }, delay);
    debounceMap.set(key, { timer, entry });
    try { console.debug(`[localPersistence] scheduled save for ${key} in ${delay}ms`); } catch (e) {}
  } catch (e) {
    try { console.warn('[localPersistence] scheduleLocalSave error', e); } catch (e) {}
  }
}

export async function flushAllPending(uid) {
  try { console.debug('[localPersistence] flushAllPending called'); } catch (e) {}
  for (const [k, v] of debounceMap.entries()) {
    try {
      clearTimeout(v.timer);
    } catch (_) {}
    // k is like `${uid}:${bucket}` - only flush those that match uid
    if (!k.startsWith(`${uid}:`)) continue;
    const [, bucketName] = k.split(':');
    try {
      await saveBucket(uid, bucketName, v.entry.data);
      debounceMap.delete(k);
      try { console.debug(`[localPersistence] flushed pending save ${k}`); } catch (e) {}
    } catch (e) {
      try { console.warn('[localPersistence] failed to flush', k, e); } catch (e) {}
    }
  }
}

export async function clearLocalForUser(uid) {
  const manifestKey = MANIFEST_KEY(uid);
  const manifest = await get(manifestKey);
  if (manifest && manifest.items) {
    for (const bucketName of Object.keys(manifest.items)) {
      try { await del(BUCKET_KEY(uid, bucketName)); } catch (_) {}
    }
  }
  await del(manifestKey);
  // Also clear specialized data stores
  await del(DOCUMENTS_KEY(uid));
  await del(FLASHCARDS_KEY(uid));
  await del(TAGS_KEY(uid));
  await del(TODOS_KEY(uid));
  await del(FOCUS_STATS_KEY(uid));
  await del(DAILY_RECORDS_KEY(uid));
  await del(FOLDER_STRUCTURE_KEY(uid));
  await del(USER_PREFERENCES_KEY(uid));
}

// ============================================
// DOCUMENTS & NOTES
// ============================================
export async function saveDocuments(uid, documents) {
  try {
    await set(DOCUMENTS_KEY(uid), {
      data: documents,
      lastModified: Date.now(),
      schemaVersion: 1
    });
    console.debug('[localPersistence] Documents saved locally');
    return { success: true };
  } catch (err) {
    console.warn('[localPersistence] Failed to save documents:', err);
    return { success: false, error: err.message };
  }
}

export async function loadDocuments(uid) {
  try {
    const payload = await get(DOCUMENTS_KEY(uid));
    return payload ? payload.data : null;
  } catch (err) {
    console.warn('[localPersistence] Failed to load documents:', err);
    return null;
  }
}

// ============================================
// FLASHCARD DECKS
// ============================================
export async function saveFlashcards(uid, flashcards) {
  try {
    await set(FLASHCARDS_KEY(uid), {
      data: flashcards,
      lastModified: Date.now(),
      schemaVersion: 1
    });
    console.debug('[localPersistence] Flashcards saved locally');
    return { success: true };
  } catch (err) {
    console.warn('[localPersistence] Failed to save flashcards:', err);
    return { success: false, error: err.message };
  }
}

export async function loadFlashcards(uid) {
  try {
    const payload = await get(FLASHCARDS_KEY(uid));
    return payload ? payload.data : null;
  } catch (err) {
    console.warn('[localPersistence] Failed to load flashcards:', err);
    return null;
  }
}

// ============================================
// SUBJECT TAGS
// ============================================
export async function saveTags(uid, tags) {
  try {
    await set(TAGS_KEY(uid), {
      data: tags,
      lastModified: Date.now(),
      schemaVersion: 1
    });
    console.debug('[localPersistence] Tags saved locally');
    return { success: true };
  } catch (err) {
    console.warn('[localPersistence] Failed to save tags:', err);
    return { success: false, error: err.message };
  }
}

export async function loadTags(uid) {
  try {
    const payload = await get(TAGS_KEY(uid));
    return payload ? payload.data : null;
  } catch (err) {
    console.warn('[localPersistence] Failed to load tags:', err);
    return null;
  }
}

// ============================================
// TODOS
// ============================================
export async function saveTodos(uid, todos) {
  try {
    await set(TODOS_KEY(uid), {
      data: todos,
      lastModified: Date.now(),
      schemaVersion: 1
    });
    console.debug('[localPersistence] Todos saved locally');
    return { success: true };
  } catch (err) {
    console.warn('[localPersistence] Failed to save todos:', err);
    return { success: false, error: err.message };
  }
}

export async function loadTodos(uid) {
  try {
    const payload = await get(TODOS_KEY(uid));
    return payload ? payload.data : null;
  } catch (err) {
    console.warn('[localPersistence] Failed to load todos:', err);
    return null;
  }
}

// ============================================
// FOCUS STATS & STUDY HOURS
// ============================================
export async function saveFocusStats(uid, stats) {
  try {
    await set(FOCUS_STATS_KEY(uid), {
      data: stats,
      lastModified: Date.now(),
      schemaVersion: 1
    });
    console.debug('[localPersistence] Focus stats saved locally');
    return { success: true };
  } catch (err) {
    console.warn('[localPersistence] Failed to save focus stats:', err);
    return { success: false, error: err.message };
  }
}

export async function loadFocusStats(uid) {
  try {
    const payload = await get(FOCUS_STATS_KEY(uid));
    return payload ? payload.data : null;
  } catch (err) {
    console.warn('[localPersistence] Failed to load focus stats:', err);
    return null;
  }
}

// ============================================
// DAILY FOCUS RECORDS
// ============================================
export async function saveDailyRecords(uid, dailyRecords) {
  try {
    await set(DAILY_RECORDS_KEY(uid), {
      data: dailyRecords,
      lastModified: Date.now(),
      schemaVersion: 1
    });
    console.debug('[localPersistence] Daily records saved locally');
    return { success: true };
  } catch (err) {
    console.warn('[localPersistence] Failed to save daily records:', err);
    return { success: false, error: err.message };
  }
}

export async function loadDailyRecords(uid) {
  try {
    const payload = await get(DAILY_RECORDS_KEY(uid));
    return payload ? payload.data : null;
  } catch (err) {
    console.warn('[localPersistence] Failed to load daily records:', err);
    return null;
  }
}

// ============================================
// FOLDER STRUCTURE
// ============================================
export async function saveFolderStructure(uid, folderStructure) {
  try {
    await set(FOLDER_STRUCTURE_KEY(uid), {
      data: folderStructure,
      lastModified: Date.now(),
      schemaVersion: 1
    });
    console.debug('[localPersistence] Folder structure saved locally');
    return { success: true };
  } catch (err) {
    console.warn('[localPersistence] Failed to save folder structure:', err);
    return { success: false, error: err.message };
  }
}

export async function loadFolderStructure(uid) {
  try {
    const payload = await get(FOLDER_STRUCTURE_KEY(uid));
    return payload ? payload.data : null;
  } catch (err) {
    console.warn('[localPersistence] Failed to load folder structure:', err);
    return null;
  }
}

// ============================================
// USER PREFERENCES
// ============================================
export async function saveUserPreferences(uid, preferences) {
  try {
    await set(USER_PREFERENCES_KEY(uid), {
      data: preferences,
      lastModified: Date.now(),
      schemaVersion: 1
    });
    console.debug('[localPersistence] User preferences saved locally');
    return { success: true };
  } catch (err) {
    console.warn('[localPersistence] Failed to save user preferences:', err);
    return { success: false, error: err.message };
  }
}

export async function loadUserPreferences(uid) {
  try {
    const payload = await get(USER_PREFERENCES_KEY(uid));
    return payload ? payload.data : null;
  } catch (err) {
    console.warn('[localPersistence] Failed to load user preferences:', err);
    return null;
  }
}

export default {
  saveBucket,
  loadBucket,
  loadManifest,
  scheduleLocalSave,
  flushAllPending,
  clearLocalForUser,
  saveDocuments,
  loadDocuments,
  saveFlashcards,
  loadFlashcards,
  saveTags,
  loadTags,
  saveTodos,
  loadTodos,
  saveFocusStats,
  loadFocusStats,
  saveDailyRecords,
  loadDailyRecords,
  saveFolderStructure,
  loadFolderStructure,
  saveUserPreferences,
  loadUserPreferences
};

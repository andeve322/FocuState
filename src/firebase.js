import { initializeApp } from "firebase/app";
import { getAnalytics, logEvent } from "firebase/analytics";
import { getAuth, createUserWithEmailAndPassword, signInWithEmailAndPassword, signOut, setPersistence, browserLocalPersistence, onAuthStateChanged, signInWithPopup, GoogleAuthProvider, OAuthProvider, sendEmailVerification } from "firebase/auth";
import { getFirestore, collection, addDoc, getDocs, updateDoc, deleteDoc, doc, getDoc, query, where, setDoc, orderBy, limit } from "firebase/firestore";
import { getStorage, ref, uploadBytes, uploadBytesResumable, getDownloadURL, getBytes, deleteObject, listAll } from "firebase/storage";
import { getFunctions, httpsCallable } from 'firebase/functions';
import { increment } from 'firebase/firestore';

// Import local storage modules
import { 
  saveBucket, loadBucket, loadBucketMeta,
  saveDocuments, loadDocuments,
  saveFlashcards, loadFlashcards,
  saveTags, loadTags,
  saveTodos, loadTodos,
  saveFocusStats, loadFocusStats,
  saveDailyRecords, loadDailyRecords,
  saveFolderStructure, loadFolderStructure,
  saveUserPreferences, loadUserPreferences
} from './lib/localPersistence';
import {
  saveFileLocally, getFileLocally, getBlobUrl, deleteFileLocally,
  getFilesInFolder, getStorageUsage
} from './lib/localFileStorage';

// Firebase configuration
const firebaseConfig = {
  apiKey: "AIzaSyBddtEwpCqUHzCii7f-ABBeaplTQACfPPU",
  authDomain: "focustate.firebaseapp.com",
  projectId: "focustate",
  // Use the actual Firebase Storage bucket hostname for this project
  // (was `focustate.firebasestorage.app` in prior commits)
  storageBucket: "focustate.firebasestorage.app",
  messagingSenderId: "233519007992",
  appId: "1:233519007992:web:ce1918c2355437c2efd30d",
  measurementId: "G-R5D5RM892P"
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
const storage = getStorage(app);
const analytics = getAnalytics(app);

// Username validation helpers
const USERNAME_REGEX = /^[a-zA-Z0-9._-]{3,20}$/;
const BANNED_USERNAMES = [
  // System/admin terms
  'admin','adm1n','adm!n','4dm1n','admim',
  'support','supp0rt','suppurt',
  'help','h3lp','h31p',
  'owner','own3r','own0r',
  'moderator','m0d3r4t0r','mod3r4t0r',
  'mod','m0d','m00d',
  'staff','5t4ff','st4ff',
  'root','r00t','r007',
  'system','sy5t3m','5y5t3m',
  'null','nul1','nul0',
  'undefined','und3f1n3d','undef1n3d',
  
  // Offensive/hateful terms
  'fuck','f*ck','fvck','fucc','fck','f4ck',
  'shit','5h1t','sh1t','5hlt',
  'ass','455','4ss','a55',
  'bitch','b1tch','b!tch','b1tc#','bytch',
  'cunt','c*nt','cvnt','c0nt','kunt',
  'fag','f4g','fvg',
  'rape','r4p3','r4pe','rp3',
  'hitler','h1tl3r','h1tler','hltlr',
  'nazis','n4z1s','n4z15','naz15','na21s',
  'nazi','n4z1','n4zi','naz1','na21',
  'terror','t3rr0r','t3rr0','t0rr0r',
  'bomb','b0mb','b0m6',
  'pedo','p3d0','ped0','p3do',
  'porn','p0rn','p0r9',
  'sex','53x','s3x'
];

const normalizeUsername = (username) => username.trim();
const usernameToKey = (username) => normalizeUsername(username).toLowerCase();

export const checkUsernameAvailability = async (username) => {
  const clean = normalizeUsername(username);
  const key = usernameToKey(clean);

  if (!clean || !USERNAME_REGEX.test(clean)) {
    return { success: false, available: false, error: 'Usernames must be 3-20 chars, letters/numbers/._- only' };
  }

  if (BANNED_USERNAMES.some((bad) => key.includes(bad))) {
    return { success: false, available: false, error: 'That username is not allowed' };
  }

  try {
    const existing = await getDoc(doc(db, 'usernames', key));
    if (existing.exists()) {
      return { success: true, available: false };
    }
    return { success: true, available: true };
  } catch (error) {
    console.error('Username availability check failed:', error);
    const perm = error?.code === 'permission-denied';
    return { 
      success: false, 
      available: false, 
      error: perm 
        ? 'Username check blocked by Firestore rules; allow read on /usernames/{id}' 
        : 'Could not verify username availability'
    };
  }
};

export const setUsername = async (userId, username) => {
  const clean = normalizeUsername(username);
  const key = usernameToKey(clean);

  // Validate
  if (!clean || !USERNAME_REGEX.test(clean)) {
    return { success: false, error: 'Usernames must be 3-20 chars, letters/numbers/._- only' };
  }
  if (BANNED_USERNAMES.some((bad) => key.includes(bad))) {
    return { success: false, error: 'That username is not allowed' };
  }

  try {
    // Check current profile for old username to release
    const profileRef = doc(db, 'users', userId);
    const profileSnap = await getDoc(profileRef);
    const oldKey = profileSnap.exists() ? profileSnap.data().usernameLower : null;

    // Ensure desired username not taken by someone else
    const desiredRef = doc(db, 'usernames', key);
    const desiredSnap = await getDoc(desiredRef);
    if (desiredSnap.exists() && desiredSnap.data().uid !== userId) {
      return { success: false, error: 'Username already taken' };
    }

    // Reserve username
    await setDoc(desiredRef, { uid: userId, username: clean, usernameLower: key, updatedAt: new Date().toISOString() });

    // Release old username mapping if different
    if (oldKey && oldKey !== key) {
      await deleteDoc(doc(db, 'usernames', oldKey)).catch(() => {});
    }

    // Update user profile
    await setDoc(profileRef, { username: clean, usernameLower: key, updatedAt: new Date().toISOString() }, { merge: true });

    return { success: true, username: clean };
  } catch (error) {
    console.error('Error setting username:', error);
    return { success: false, error: 'Failed to set username' };
  }
};

// Enable persistent authentication
setPersistence(auth, browserLocalPersistence).catch(err => console.log('Persistence error:', err));

// Log initialization
console.log('Firebase initialized successfully', { projectId: firebaseConfig.projectId });

// ============================================
// AUTHENTICATION FUNCTIONS
// ============================================

export const registerUser = async (email, password, username = null) => {
  try {
    const userCredential = await createUserWithEmailAndPassword(auth, email, password);
    logEvent(analytics, "sign_up", { method: "email" });
    // Initialize preferences doc with default tiers and settings
    try {
      await setDoc(doc(db, 'users', userCredential.user.uid, 'settings', 'preferences'), {
        flowTier: 'flow',
        autoSyncEnabled: false
      }, { merge: true });
    } catch (err) {
      console.warn('Could not set default flow tier on sign up:', err);
    }
    // If a username was provided at signup, attempt to reserve it immediately
    if (username) {
      try {
        const setRes = await setUsername(userCredential.user.uid, username);
        if (!setRes.success) {
          // If reservation failed, clean up created auth user to avoid orphaned accounts
          try { await userCredential.user.delete(); } catch (delErr) { console.warn('Failed to delete user after username reservation failure', delErr); }
          return { success: false, error: setRes.error || 'Failed to reserve username' };
        }
      } catch (err) {
        console.warn('Username reservation during registration failed:', err);
        try { await userCredential.user.delete(); } catch (delErr) { console.warn('Failed to delete user after username reservation exception', delErr); }
        return { success: false, error: 'Failed to reserve username' };
      }
    }
    // Send email verification and sign the user out so they must verify before full access
    try {
      await sendEmailVerification(userCredential.user);
      // Immediately sign out to ensure verification step is required before use
      await signOut(auth);
      return { success: true, user: userCredential.user, emailSent: true };
    } catch (verErr) {
      console.warn('Failed to send verification email or sign out:', verErr);
      // Still return success but note email was not sent
      return { success: true, user: userCredential.user, emailSent: false };
    }
  } catch (error) {
    console.error('Registration error:', error);
    return { success: false, error: error.message || 'Registration failed' };
  }
};

export const loginUser = async (email, password) => {
  try {
    const userCredential = await signInWithEmailAndPassword(auth, email, password);
    logEvent(analytics, "login", { method: "email" });
    return { success: true, user: userCredential.user };
  } catch (error) {
    console.error('Login error:', error);
    return { success: false, error: error.message };
  }
};

// Resend verification email: sign in temporarily to send verification, then sign out.
export const resendVerificationEmail = async (email, password) => {
  try {
    const userCredential = await signInWithEmailAndPassword(auth, email, password);
    try {
      await sendEmailVerification(userCredential.user);
      await signOut(auth);
      return { success: true };
    } catch (err) {
      console.error('Failed to send verification email:', err);
      try { await signOut(auth); } catch (e) {}
      return { success: false, error: err.message };
    }
  } catch (err) {
    console.error('Could not sign in to resend verification:', err);
    return { success: false, error: err.message };
  }
};

export const loginWithGoogle = async () => {
  try {
    const provider = new GoogleAuthProvider();
    const userCredential = await signInWithPopup(auth, provider);
    logEvent(analytics, "login", { method: "google" });
    return { success: true, user: userCredential.user };
  } catch (error) {
    console.error('Google login error:', error);
    return { success: false, error: error.message };
  }
};

export const loginWithApple = async () => {
  try {
    const provider = new OAuthProvider('apple.com');
    provider.addScope('email');
    provider.addScope('name');
    const userCredential = await signInWithPopup(auth, provider);
    logEvent(analytics, "login", { method: "apple" });
    return { success: true, user: userCredential.user };
  } catch (error) {
    console.error('Apple login error:', error);
    return { success: false, error: error.message };
  }
};

export const logoutUser = async () => {
  try {
    await signOut(auth);
    logEvent(analytics, "logout");
    return { success: true };
  } catch (error) {
    return { success: false, error: error.message };
  }
};

export const getCurrentUser = () => {
  return auth.currentUser;
};

export const onAuthChange = (callback) => {
  return onAuthStateChanged(auth, callback);
};

// ============================================
// FIRESTORE DATABASE FUNCTIONS
// ============================================

// Save user profile
export const saveUserProfile = async (userId, userData) => {
  try {
    await setDoc(doc(db, "users", userId), userData, { merge: true });
    logEvent(analytics, "save_user_profile");
    return { success: true };
  } catch (error) {
    return { success: false, error: error.message };
  }
};

// Get user profile
export const getUserProfile = async (userId) => {
  try {
    const userDoc = await getDoc(doc(db, "users", userId));
    if (userDoc.exists()) {
      return { success: true, data: userDoc.data() };
    }
    return { success: false, error: "User profile not found" };
  } catch (error) {
    return { success: false, error: error.message };
  }
};

// Get flow tier (defaults to 'light' if missing)
export const getFlowTier = async (userId) => {
  try {
    const prefRef = doc(db, 'users', userId, 'settings', 'preferences');
    const snap = await getDoc(prefRef);
    const tier = snap.exists() && snap.data().flowTier ? snap.data().flowTier : 'flow';
    const missing = !(snap.exists() && snap.data().flowTier);
    return { success: true, tier, missing };
  } catch (error) {
    console.error('Error loading flow tier:', error);
    return { success: false, error: error.message, tier: 'flow' };
  }
};

// Set flow tier (e.g., 'light' or 'flow')
export const setFlowTier = async (userId, tier) => {
  try {
    await setDoc(doc(db, 'users', userId, 'settings', 'preferences'), { flowTier: tier }, { merge: true });
    return { success: true };
  } catch (error) {
    console.error('Error setting flow tier:', error);
    return { success: false, error: error.message };
  }
};

// Save note/document
export const saveDocument = async (userId, documentData) => {
  try {
    const docRef = await addDoc(collection(db, "users", userId, "documents"), {
      ...documentData,
      createdAt: new Date(),
      updatedAt: new Date()
    });
    logEvent(analytics, "save_document", { docId: docRef.id });
    return { success: true, docId: docRef.id };
  } catch (error) {
    return { success: false, error: error.message };
  }
};

// Get all documents for a user
export const getUserDocuments = async (userId) => {
  try {
    const docsSnapshot = await getDocs(collection(db, "users", userId, "documents"));
    const documents = [];
    docsSnapshot.forEach((doc) => {
      documents.push({ id: doc.id, ...doc.data() });
    });
    return { success: true, documents };
  } catch (error) {
    return { success: false, error: error.message };
  }
};

// Update document
export const updateDocument = async (userId, docId, updates) => {
  try {
    await updateDoc(doc(db, "users", userId, "documents", docId), {
      ...updates,
      updatedAt: new Date()
    });
    logEvent(analytics, "update_document", { docId });
    return { success: true };
  } catch (error) {
    return { success: false, error: error.message };
  }
};

// Delete document
export const deleteDocument = async (userId, docId) => {
  try {
    await deleteDoc(doc(db, "users", userId, "documents", docId));
    logEvent(analytics, "delete_document", { docId });
    return { success: true };
  } catch (error) {
    return { success: false, error: error.message };
  }
};

// Save flashcard deck
export const saveFlashcardDeck = async (userId, deckData) => {
  try {
    const deckRef = await addDoc(collection(db, "users", userId, "flashcards"), {
      ...deckData,
      createdAt: new Date(),
      updatedAt: new Date()
    });
    logEvent(analytics, "save_flashcard_deck", { deckId: deckRef.id });
    return { success: true, deckId: deckRef.id };
  } catch (error) {
    return { success: false, error: error.message };
  }
};

// Get all flashcard decks for a user
export const getUserFlashcardDecks = async (userId) => {
  try {
    const decksSnapshot = await getDocs(collection(db, "users", userId, "flashcards"));
    const decks = [];
    decksSnapshot.forEach((doc) => {
      decks.push({ id: doc.id, ...doc.data() });
    });
    return { success: true, decks };
  } catch (error) {
    return { success: false, error: error.message };
  }
};

// Update flashcard deck
export const updateFlashcardDeck = async (userId, deckId, updates) => {
  try {
    await updateDoc(doc(db, "users", userId, "flashcards", deckId), {
      ...updates,
      updatedAt: new Date()
    });
    logEvent(analytics, "update_flashcard_deck", { deckId });
    return { success: true };
  } catch (error) {
    return { success: false, error: error.message };
  }
};

// Delete flashcard deck
export const deleteFlashcardDeck = async (userId, deckId) => {
  try {
    await deleteDoc(doc(db, "users", userId, "flashcards", deckId));
    logEvent(analytics, "delete_flashcard_deck", { deckId });
    return { success: true };
  } catch (error) {
    return { success: false, error: error.message };
  }
};

// ============================================
// CLOUD STORAGE FUNCTIONS
// ============================================

// Upload file (PDF, images, etc.)
export const uploadFile = async (userId, fileType, file, fileName) => {
  try {
    const storageRef = ref(storage, `users/${userId}/${fileType}/${fileName}`);
    await uploadBytes(storageRef, file);
    logEvent(analytics, "upload_file", { fileType, fileName });
    return { success: true, path: `users/${userId}/${fileType}/${fileName}` };
  } catch (error) {
    return { success: false, error: error.message };
  }
};

// Download file
export const downloadFile = async (filePath) => {
  try {
    const storageRef = ref(storage, filePath);
    const data = await getBytes(storageRef);
    logEvent(analytics, "download_file");
    return { success: true, data };
  } catch (error) {
    return { success: false, error: error.message };
  }
};

// Delete file
export const deleteFile = async (filePath) => {
  try {
    const storageRef = ref(storage, filePath);
    await deleteObject(storageRef);
    logEvent(analytics, "delete_file");
    return { success: true };
  } catch (error) {
    return { success: false, error: error.message };
  }
};

// ============================================
// ANALYTICS FUNCTIONS
// ============================================

// Log custom event
export const logCustomEvent = (eventName, eventData = {}) => {
  try {
    logEvent(analytics, eventName, eventData);
    return { success: true };
  } catch (error) {
    return { success: false, error: error.message };
  }
};

// Log study session
export const logStudySession = (duration, topicsReviewed) => {
  return logCustomEvent("study_session", {
    duration_seconds: duration,
    topics_count: topicsReviewed
  });
};

// Log document opened
export const logDocumentOpened = (docName, docType) => {
  return logCustomEvent("document_opened", {
    doc_name: docName,
    doc_type: docType
  });
};

// Log timer used
export const logTimerUsed = (duration, type) => {
  return logCustomEvent("timer_used", {
    duration_minutes: duration,
    timer_type: type
  });
};

// Log audio played
export const logAudioPlayed = (audioName) => {
  return logCustomEvent("audio_played", {
    audio_name: audioName
  });
};

// ============================================
// LOCAL STORAGE SYNC FUNCTIONS (REPLACES CLOUD)
// ============================================

// Sync user's documents locally
export const syncDocumentsToCloud = async (userId, documents) => {
  try {
    const result = await saveDocuments(userId, documents);
    return { success: result.success, error: result.error };
  } catch (error) {
    console.error('Error syncing documents locally:', error);
    return { success: false, error: error.message };
  }
};

// Load user's documents from local storage
export const loadDocumentsFromCloud = async (userId) => {
  try {
    const documents = await loadDocuments(userId);
    return { success: true, documents, lastSynced: new Date().toISOString() };
  } catch (error) {
    console.error('Error loading documents locally:', error);
    return { success: false, error: error.message };
  }
};

// Sync focus stats locally
export const syncFocusStatsToCloud = async (userId, focusStats, statsDate) => {
  try {
    const result = await saveFocusStats(userId, { stats: focusStats, statsDate });
    return { success: result.success, error: result.error };
  } catch (error) {
    console.error('Error syncing focus stats locally:', error);
    return { success: false, error: error.message };
  }
};

// Load user's focus stats from local storage
export const loadFocusStatsFromCloud = async (userId) => {
  try {
    const data = await loadFocusStats(userId);
    return { success: true, stats: data?.stats || null, statsDate: data?.statsDate || null, lastSynced: new Date().toISOString() };
  } catch (error) {
    console.error('Error loading focus stats locally:', error);
    return { success: false, error: error.message };
  }
};

// Sync daily focus records locally
export const syncDailyFocusRecordsToCloud = async (userId, dailyRecords) => {
  try {
    const result = await saveDailyRecords(userId, dailyRecords);
    return { success: result.success, error: result.error };
  } catch (error) {
    console.error('Error syncing daily records locally:', error);
    return { success: false, error: error.message };
  }
};

// Load user's daily focus records from local storage
export const loadDailyFocusRecordsFromCloud = async (userId) => {
  try {
    const records = await loadDailyRecords(userId);
    return { success: true, records, lastSynced: new Date().toISOString() };
  } catch (error) {
    console.error('Error loading daily records locally:', error);
    return { success: false, error: error.message };
  }
};

// Sync user's todo list locally
export const syncTodosToCloud = async (userId, todos) => {
  try {
    const result = await saveTodos(userId, todos);
    return { success: result.success, error: result.error };
  } catch (error) {
    console.error('Error syncing todos locally:', error);
    return { success: false, error: error.message };
  }
};

// Load user's todo list from local storage
export const loadTodosFromCloud = async (userId) => {
  try {
    const todos = await loadTodos(userId);
    return { success: true, todos, lastSynced: new Date().toISOString() };
  } catch (error) {
    console.error('Error loading todos locally:', error);
    return { success: false, error: error.message };
  }
};

// Sync all user data at once (locally)
export const syncAllUserDataToCloud = async (userId, documents, focusStats, dailyRecords, statsDate, todos) => {
  try {
    const results = await Promise.all([
      saveDocuments(userId, documents),
      saveFocusStats(userId, { stats: focusStats, statsDate }),
      saveDailyRecords(userId, dailyRecords),
      saveTodos(userId, todos)
    ]);
    
    const allSuccess = results.every(r => r.success);
    const failed = results.filter(r => !r || !r.success);
    const errorSummary = failed.length > 0 ? failed.map((f, i) => {
      try { return f && f.error ? f.error : `operation_${i}_failed`; } catch (e) { return `operation_${i}_failed`; }
    }).join(' | ') : null;

    return {
      success: allSuccess,
      syncedAt: new Date().toISOString(),
      results: results,
      error: errorSummary
    };
  } catch (error) {
    console.error('Error syncing all data locally:', error);
    return { success: false, error: error.message };
  }
};

// Load all user data at once (from local storage)
export const loadAllUserDataFromCloud = async (userId) => {
  try {
    const [documents, focusStatsData, dailyRecords, todos] = await Promise.all([
      loadDocuments(userId),
      loadFocusStats(userId),
      loadDailyRecords(userId),
      loadTodos(userId)
    ]);
    
    const hasAnyData = documents || focusStatsData || dailyRecords || todos;
    
    return {
      success: true,
      documents,
      focusStats: focusStatsData?.stats || null,
      dailyRecords,
      todos,
      hasData: !!hasAnyData,
      lastSynced: hasAnyData ? new Date().toISOString() : null
    };
  } catch (error) {
    console.error('Error loading all data locally:', error);
    return { success: false, error: error.message, hasData: false };
  }
};

// Get sync status for user
export const getSyncStatus = async (userId) => {
  try {
    const [documents, focusStatsData, dailyRecords] = await Promise.all([
      loadDocuments(userId),
      loadFocusStats(userId),
      loadDailyRecords(userId)
    ]);
    
    return {
      success: true,
      documents: { synced: !!documents, lastSynced: new Date().toISOString() },
      stats: { synced: !!focusStatsData, lastSynced: new Date().toISOString() },
      records: { synced: !!dailyRecords, lastSynced: new Date().toISOString() }
    };
  } catch (error) {
    console.error('Error getting sync status:', error);
    return { success: false, error: error.message };
  }
};

// PDF Local Storage Functions
export const uploadPdfToCloud = async (userId, folderId, fileName, pdfBlob, onProgress) => {
  try {
    // Generate a unique file ID
    const fileId = `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    
    // Simulate upload progress (since it's local, it's instant)
    if (typeof onProgress === 'function') {
      onProgress(100, { bytesTransferred: pdfBlob.size, totalBytes: pdfBlob.size });
    }
    
    // Save file locally
    const result = await saveFileLocally(userId, folderId, fileName, pdfBlob, fileId, {
      originalName: fileName,
      uploadedAt: new Date().toISOString()
    });
    
    return result;
  } catch (error) {
    console.error('Error uploading PDF locally:', error);
    return { success: false, error: error.message };
  }
};


// Download PDF from local storage
export const downloadPdfFromCloud = async (userId, folderId, fileName) => {
  try {
    // Extract file ID from fileName (it's stored in the file metadata)
    // In this case, we need to search for the file by name in the folder
    const files = await getFilesInFolder(userId, folderId);
    
    if (!files.success || !files.files) {
      return { success: false, error: 'Could not retrieve folder files' };
    }
    
    // Find the file by name
    const fileRecord = files.files.find(f => f.fileName === fileName);
    if (!fileRecord) {
      return { success: false, error: 'File not found' };
    }
    
    const result = await getFileLocally(userId, fileRecord.fileId);
    return result.success 
      ? { success: true, blob: result.blob }
      : { success: false, error: result.error };
  } catch (error) {
    console.error('Error downloading PDF locally:', error);
    return { success: false, error: error.message };
  }
};

// Delete PDF from local storage
export const deletePdfFromCloud = async (userId, folderId, fileName) => {
  try {
    // Get the file ID from folder files
    const files = await getFilesInFolder(userId, folderId);
    
    if (!files.success || !files.files) {
      return { success: false, error: 'Could not retrieve folder files' };
    }
    
    // Find the file by name
    const fileRecord = files.files.find(f => f.fileName === fileName);
    if (!fileRecord) {
      return { success: false, error: 'File not found' };
    }
    
    const result = await deleteFileLocally(userId, fileRecord.fileId);
    return result.success
      ? { success: true }
      : { success: false, error: result.error };
  } catch (error) {
    console.error('Error deleting PDF locally:', error);
    return { success: false, error: error.message };
  }
};

// Request account deletion via Gen 1 Callable Cloud Function
export const requestAccountDeletion = async () => {
  try {
    if (!auth.currentUser) {
      console.warn('requestAccountDeletion: no auth.currentUser present');
      return { success: false, error: 'Not authenticated' };
    }

    // Diagnostic log: confirm this function is called in the running bundle
    try { console.log('requestAccountDeletion called; auth.currentUser.uid=', auth.currentUser && auth.currentUser.uid, 'email=', auth.currentUser && auth.currentUser.email); } catch (e) { /* ignore logging errors */ }

    // Force refresh the ID token and capture any error
    let idToken = null;
    try {
      try { console.log('Refreshing ID token (force)'); } catch (e) {}
      idToken = await auth.currentUser.getIdToken(true);
      try { console.log('Obtained id token (len):', idToken ? idToken.length : null); } catch (e) {}
      // Decode token payload to inspect aud/iss/sub for debugging (do not log full token)
      try {
        const parts = idToken.split('.');
        if (parts && parts.length >= 2) {
          const payload = JSON.parse(atob(parts[1]));
          try { console.log('idToken payload (aud, iss, sub):', payload.aud, payload.iss, payload.sub); } catch (e) {}
        }
      } catch (e) {
        console.warn('Could not decode id token payload', e);
      }
    } catch (tokErr) {
      console.error('Error getting ID token for deletion:', tokErr);
      return { success: false, error: tokErr?.message || String(tokErr) };
    }

    // Fallback: call the CORS-enabled HTTP endpoint directly with the ID token
    try {
      const idTokenForHeader = idToken; // already obtained above
      const endpoint = 'https://us-central1-focustate.cloudfunctions.net/enqueueAccountDeletionHttp';
      try { console.log('Calling HTTP endpoint', endpoint); } catch (e) {}
      const resp = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer ' + idTokenForHeader
        },
        body: JSON.stringify({})
      });

      const json = await resp.json().catch(() => ({}));
      if (resp.ok && json && json.success) {
        return { success: true, jobId: json.jobId };
      }
      return { success: false, error: json?.error || `HTTP ${resp.status}` };
    } catch (err) {
      console.error('Error calling enqueueAccountDeletion HTTP endpoint:', err);
      return { success: false, error: err?.message || String(err) };
    }
  } catch (error) {
    console.error('Error requesting account deletion:', error);
    return { success: false, error: error.message || String(error) };
  }
};

// Danger: Permanently delete all user data (Firestore + Storage)
export const deleteAllUserData = async (userId) => {
  try {
    // Firestore: delete known subcollections under users/{uid}
    const subcollections = ["documents", "flashcards", "settings", "game"];
    for (const sub of subcollections) {
      const snap = await getDocs(collection(db, 'users', userId, sub));
      const deletions = snap.docs.map((d) => deleteDoc(d.ref).catch(() => {}));
      await Promise.all(deletions);
    }

    // Firestore: delete root user doc
    const userRef = doc(db, 'users', userId);
    const userSnap = await getDoc(userRef);
    if (userSnap.exists()) {
      await deleteDoc(userRef).catch(() => {});
    }

    // Storage: delete all under users/{uid}/
    const userRoot = ref(storage, `users/${userId}`);
    const deletePrefix = async (prefixRef) => {
      const listing = await listAll(prefixRef);
      await Promise.all(listing.items.map((item) => deleteObject(item).catch(() => {})));
      await Promise.all(listing.prefixes.map((pref) => deletePrefix(pref)));
    };
    await deletePrefix(userRoot).catch(() => {});

    return { success: true };
  } catch (error) {
    console.error('Failed to delete all user data:', error);
    return { success: false, error: error.message };
  }
};

// Atomically increment/decrement user's storage usage from client-side when appropriate
export const incrementUserStorageUsage = async (userId, deltaBytes) => {
  try {
    const userRef = doc(db, 'users', userId);
    await updateDoc(userRef, { storageUsageBytes: increment(Number(deltaBytes) || 0) });
    return { success: true };
  } catch (error) {
    console.error('Error incrementing user storage usage:', error);
    return { success: false, error: error.message };
  }
};

// ============================================
// USER SETTINGS FUNCTIONS
// ============================================

export const saveAutoSyncSetting = async (userId, autoSyncEnabled) => {
  try {
    const userSettingsRef = doc(db, 'users', userId, 'settings', 'preferences');
    await setDoc(userSettingsRef, { autoSyncEnabled }, { merge: true });
    return { success: true };
  } catch (error) {
    console.error('Error saving auto sync setting:', error);
    return { success: false, error: error.message };
  }
};

export const loadAutoSyncSetting = async (userId) => {
  try {
    const userSettingsRef = doc(db, 'users', userId, 'settings', 'preferences');
    const settingsDoc = await getDoc(userSettingsRef);
    if (settingsDoc.exists()) {
      return { success: true, autoSyncEnabled: settingsDoc.data().autoSyncEnabled ?? false };
    }
    return { success: true, autoSyncEnabled: false };
  } catch (error) {
    console.error('Error loading auto sync setting:', error);
    return { success: false, error: error.message, autoSyncEnabled: false };
  }
};

// Leaderboard opt-in preference
export const saveLeaderboardOptIn = async (userId, optIn) => {
  try {
    const userSettingsRef = doc(db, 'users', userId, 'settings', 'preferences');
    await setDoc(userSettingsRef, { leaderboardOptIn: !!optIn }, { merge: true });
    // NOTE: we do NOT delete leaderboard entries on opt-out.
    // Hiding is handled at read-time (fetch functions will filter out users who opted out).
    return { success: true };
  } catch (error) {
    console.error('Error saving leaderboard opt-in:', error);
    return { success: false, error: error.message };
  }
};

export const loadLeaderboardOptIn = async (userId) => {
  try {
    const userSettingsRef = doc(db, 'users', userId, 'settings', 'preferences');
    const settingsDoc = await getDoc(userSettingsRef);
    if (settingsDoc.exists()) {
      return { success: true, optIn: !!settingsDoc.data().leaderboardOptIn };
    }
    return { success: true, optIn: false };
  } catch (error) {
    console.error('Error loading leaderboard opt-in:', error);
    return { success: false, error: error.message, optIn: false };
  }
};

// Leaderboard helpers
const LEADERBOARD_LIMIT = 20;

export const updateFocusLeaderboardEntry = async (userId, username, minutes, periodType, periodStartIso) => {
  try {
    const collectionId = periodType === 'weekly' ? 'focus_weekly' : 'focus_monthly';
    const entryRef = doc(db, 'leaderboards', collectionId, 'entries', userId);
    await setDoc(entryRef, {
      username,
      minutes,
      periodType,
      periodStart: periodStartIso,
      updatedAt: new Date().toISOString()
    }, { merge: true });
    return { success: true };
  } catch (error) {
    const code = error && (error.code || '');
    const msg = error && error.message ? error.message : String(error);
    const permPattern = /permission-denied|insufficient permissions|missing or insufficient permissions/i;
    if (code === 'permission-denied' || permPattern.test(msg)) {
      console.info('Skipped client focus leaderboard write - insufficient permissions');
    } else {
      console.error('Error updating focus leaderboard:', error);
    }
    return { success: false, error: error.message };
  }
};

export const fetchFocusLeaderboard = async (periodType = 'weekly') => {
  try {
    const collectionId = periodType === 'weekly' ? 'focus_weekly' : 'focus_monthly';
    const entriesRef = collection(db, 'leaderboards', collectionId, 'entries');
    const q = query(entriesRef, orderBy('minutes', 'desc'), limit(LEADERBOARD_LIMIT));
    const snap = await getDocs(q);
    const rawEntries = snap.docs.map(docSnap => ({ id: docSnap.id, ...docSnap.data() }));
    // Filter out users who have opted out of leaderboards (hide but do not delete their records)
    const checked = await Promise.all(rawEntries.map(async (e) => {
      try {
        const opt = await loadLeaderboardOptIn(e.id);
        if (opt && opt.success === true && opt.optIn === false) return null;
      } catch (err) {
        // If opt-in check fails, assume entry is visible to avoid accidental hiding
        console.warn('Failed to check leaderboard opt-in for', e.id, err);
      }
      return e;
    }));
    const entries = checked.filter(Boolean);
    return { success: true, entries };
  } catch (error) {
    console.error('Error fetching focus leaderboard:', error);
    return { success: false, error: error.message, entries: [] };
  }
};

export const updateSnakeLeaderboardEntry = async (userId, username, score) => {
  try {
    const entryRef = doc(db, 'leaderboards', 'snake', 'entries', userId);
    await setDoc(entryRef, {
      username,
      score,
      updatedAt: new Date().toISOString()
    }, { merge: true });
    return { success: true };
  } catch (error) {
    const code = error && (error.code || '');
    const msg = error && error.message ? error.message : String(error);
    const permPattern = /permission-denied|insufficient permissions|missing or insufficient permissions/i;
    if (code === 'permission-denied' || permPattern.test(msg)) {
      console.info('Skipped client snake leaderboard write - insufficient permissions');
      return { success: false, error: 'permission-denied' };
    }
    console.error('Error updating snake leaderboard:', error);
    return { success: false, error: error.message };
  }
};

export const fetchSnakeLeaderboard = async () => {
  try {
    const entriesRef = collection(db, 'leaderboards', 'snake', 'entries');
    const q = query(entriesRef, orderBy('score', 'desc'), limit(LEADERBOARD_LIMIT));
    const snap = await getDocs(q);
    const rawEntries = snap.docs.map(docSnap => ({ id: docSnap.id, ...docSnap.data() }));

    // For each leaderboard entry, reflect the authoritative per-user highScore
    // stored under users/{uid}/game/snake. If the user's stored highScore is higher,
    // prefer that value. Client-side writes are best-effort and will be skipped
    // if Firestore rules prevent them; the server Cloud Function is authoritative.
    const checked = await Promise.all(rawEntries.map(async (e) => {
      try {
        const opt = await loadLeaderboardOptIn(e.id);
        if (opt && opt.success === true && opt.optIn === false) return null;
      } catch (err) {
        console.warn('Failed to check leaderboard opt-in for', e.id, err);
      }

      try {
        const snakeRef = doc(db, 'users', e.id, 'game', 'snake');
        const snakeSnap = await getDoc(snakeRef);
        const cloudHigh = (snakeSnap && snakeSnap.exists() && snakeSnap.data().highScore) ? Number(snakeSnap.data().highScore) : 0;
        const entryScore = Number(e.score) || 0;
        if (cloudHigh > entryScore) {
          // Update local representation
          e.score = cloudHigh;
          // Persist corrected score back to leaderboard (best-effort).
          try {
            await setDoc(doc(db, 'leaderboards', 'snake', 'entries', e.id), { score: cloudHigh, updatedAt: new Date().toISOString() }, { merge: true });
          } catch (updErr) {
            const code = updErr && (updErr.code || '');
            const msg = updErr && updErr.message ? updErr.message : String(updErr);
            if (code === 'permission-denied' || /insufficient permissions/i.test(msg)) {
              // Expected when client rules disallow writing leaderboard entries.
              console.info('Skipped client leaderboard write for', e.id, '- insufficient permissions (server will reconcile)');
            } else {
              console.warn('Failed to update leaderboard entry with cloud highScore for', e.id, updErr);
            }
          }
        }
      } catch (err) {
        const code = err && (err.code || '');
        const msg = err && err.message ? err.message : String(err);
        // Detect common permission-denied variants (different Firebase SDKs / locales)
        const permPattern = /permission-denied|insufficient permissions|missing or insufficient permissions/i;
        if (code === 'permission-denied' || permPattern.test(msg)) {
          console.info('Skipping reconciliation for', e.id, '- permission denied when accessing leaderboard or user data');
        } else {
          console.warn('Failed to reconcile snake high score for', e.id, err);
        }
      }

      return e;
    }));

    const entries = checked.filter(Boolean).sort((a,b) => (Number(b.score)||0) - (Number(a.score)||0));
    return { success: true, entries };
  } catch (error) {
    console.error('Error fetching snake leaderboard:', error);
    return { success: false, error: error.message, entries: [] };
  }
};

// Sync per-user snake high score (client writes the per-user doc)
export const syncSnakeHighScore = async (userId, highScore) => {
  try {
    const snakeRef = doc(db, 'users', userId, 'game', 'snake');
    await setDoc(snakeRef, {
      highScore: Number(highScore) || 0,
      lastUpdated: new Date().toISOString()
    }, { merge: true });
    return { success: true };
  } catch (error) {
    console.error('Error syncing snake high score:', error);
    return { success: false, error: error.message };
  }
};

export const loadSnakeHighScore = async (userId) => {
  try {
    const snakeRef = doc(db, 'users', userId, 'game', 'snake');
    const snakeDoc = await getDoc(snakeRef);
    if (snakeDoc.exists()) {
      return { 
        success: true, 
        highScore: snakeDoc.data().highScore || 0,
        lastUpdated: snakeDoc.data().lastUpdated
      };
    }
    return { success: true, highScore: 0 };
  } catch (error) {
    console.error('Error loading snake high score:', error);
    return { success: false, error: error.message, highScore: 0 };
  }
};

export { app, analytics, auth, db, storage };

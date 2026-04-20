import React, { useState, useEffect, useRef, useCallback } from 'react';
import MathHelper from './components/MathHelperNew';
import { renderMathToHtml } from './utils/mathRenderer';
import mermaid from 'mermaid';
import { Document, Page, pdfjs } from 'react-pdf';
import ReactQuill from 'react-quill-new'; 
import 'react-quill-new/dist/quill.snow.css'; 
import jsPDF from 'jspdf'; 
import html2canvas from 'html2canvas';
import { saveAs } from 'file-saver';
import { Save } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
// Local persistence modules
import { 
  saveFocusStats, loadFocusStats,
  saveDailyRecords, loadDailyRecords,
  saveTodos, loadTodos,
  saveFolderStructure, loadFolderStructure
} from './lib/localPersistence';
import TagManagerModal from './TagManagerModal';
import { getTags } from './tags';

// --- ICONS ---
import { 
  Feather, PenTool, PanelLeftClose, PanelLeftOpen,
  LibraryBig, FileText, Folder, Upload, Trophy, 
  Play, Pause, RotateCcw, RotateCw,
  ChevronLeft, X, Plus, ZoomIn, ZoomOut,
  Maximize, Minimize, Sun, Moon, ExternalLink,
  CloudRain, Trees, Zap, Activity, Waves, Volume2,
  FilePenLine, Download, Edit2, Coffee, BookOpen, Clock, Music as MusicIcon, Layers,
  ArrowUpLeft, ChevronRight, Home, Palette, Trash2, AlertTriangle, Hash, ArrowLeft,
  Tag,
  PanelRightClose, PanelRightOpen, Calendar as CalendarIcon, Check,
  Columns2, CheckCircle2, Circle, Trash, ListTodo, ChevronUp, ChevronDown, BarChart3, LogOut, User, Cloud, Lock,
  Sparkles, Wind, Brain, Heart, Droplets, Gamepad2,
  FolderTree, FileDown, Timer, SplitSquareVertical, Keyboard, Eye, Wifi
} from 'lucide-react';

import './index.css';
import FlashcardDeck from './FlashcardDeck';
import SnakeGame from './SnakeGame';

// --- CONFIGURATION ---
const OPENAI_API_KEY = "PASTE_YOUR_API_KEY_HERE";

// Set PDF worker from local public folder
if (typeof window !== 'undefined') {
  pdfjs.GlobalWorkerOptions.workerSrc = `/pdf.worker.mjs`;
}

// --- AUDIO GROUPS ---
const GROUP_A = [
  { id: '500hz', label: '500 Hz', icon: <MusicIcon size={18}/>, src: '/music/500 Hz.mp3' },
  { id: 'brown', label: 'Brown', icon: <Activity size={18}/>, src: '/music/brown.mp3' },
  { id: 'relax', label: 'Relax', icon: <Waves size={18}/>, src: '/music/relax.mp3' },
  { id: 'white', label: 'White', icon: <Zap size={18}/>, src: '/music/white.mp3' },
  { id: 'space', label: 'Space', icon: <Sparkles size={18}/>, src: '/music/Space.mp3' },
  { id: 'aereo', label: 'Aereo', icon: <Wind size={18}/>, src: '/music/Aereo.mp3' },
  { id: 'binaural', label: 'Binaural', icon: <Brain size={18}/>, src: '/music/Binaural1.mp3' },
  { id: 'hyperfocus', label: 'Hyperfocus', icon: <Zap size={18}/>, src: '/music/Hyperfocus.mp3' },
  { id: 'floating', label: 'Floating', icon: <Feather size={18}/>, src: '/music/Floating.mp3' },
  { id: 'meditate', label: 'Meditate', icon: <Heart size={18}/>, src: '/music/Meditate2.mp3' }
];

const GROUP_B = [
  { id: 'rain', label: 'Heavy Rain', icon: <CloudRain size={18}/>, src: '/music/rain.mp3' },
  { id: 'nature', label: 'Forest', icon: <Trees size={18}/>, src: '/music/nature.mp3' },
  { id: 'creek', label: 'Creek', icon: <Waves size={18}/>, src: '/music/Creek.mp3' },
  { id: 'streamforest', label: 'Stream', icon: <Droplets size={18}/>, src: '/music/streamforest.mp3' }
];

const FOLDER_COLORS = ['#6366f1', '#ef4444', '#f59e0b', '#10b981', '#3b82f6', '#8b5cf6', '#ec4899', '#64748b'];

// --- HELPER: UNIQUE NAME GENERATOR ---
const getUniqueName = (name, existingItems, excludeId = null) => {
  let uniqueName = name;
  let counter = 1;
  const siblings = excludeId ? existingItems.filter(i => i.id !== excludeId) : existingItems;
  while (siblings.some(item => item.name.toLowerCase() === uniqueName.toLowerCase())) {
    if (uniqueName.includes('.')) {
      const parts = name.split('.');
      const ext = parts.pop();
      const base = parts.join('.');
      uniqueName = `${base} (${counter}).${ext}`;
    } else {
      uniqueName = `${name} (${counter})`;
    }
    counter++;
  }
  return uniqueName;
};

// Tiny silent video data URI to pre-warm PiP video element
const PIP_WARMUP_SRC = "data:video/webm;base64,GkXfo0AgQoaBAUL3gQFC8oEEQvOBAULygQQVQ=="; // unused placeholder for potential future PiP

// Define a reusable spring transition for smoothness
const smoothTransition = { type: "spring", stiffness: 200, damping: 25 };
const containerVariants = { hidden: { opacity: 0 }, show: { opacity: 1, transition: { staggerChildren: 0.05 } } };
const itemVariants = { hidden: { opacity: 0, y: 20, scale: 0.95 }, show: { opacity: 1, y: 0, scale: 1, transition: { type: "spring", stiffness: 100, damping: 20 } } };

export default function App(props) {
    // Extract props early to avoid reference errors
    const user = props.user;
    const username = props.username;
    const flowTier = props.flowTier;
    const autoSyncEnabled = props.autoSyncEnabled;
    const leaderboardOptIn = props.leaderboardOptIn;
    const saveAutoSyncSetting = props.saveAutoSyncSetting;
    const saveLeaderboardOptIn = props.saveLeaderboardOptIn;
    const syncAllUserDataToCloud = props.syncAllUserDataToCloud;
    const restoringFromCloudRef = props.restoringFromCloudRef;

    const [showTagModal, setShowTagModal] = useState(false);
    const [activeTag, setActiveTag] = useState(null); // {id, name, color, icon}
  const [activePage, setActivePage] = useState('MENU');
  const [isLoaded, setIsLoaded] = useState(false);
  const [showAboutModal, setShowAboutModal] = useState(false);
  const [showPrivacyPolicy, setShowPrivacyPolicy] = useState(false);
  const [showTermsOfService, setShowTermsOfService] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [isAuthTransitioning, setIsAuthTransitioning] = useState(false);

  const [showPromoBanner, setShowPromoBanner] = useState(() => {
    try {
      const v = localStorage.getItem('promo_earlybird_closed');
      return v !== '1';
    } catch (e) { return true; }
  });



  // TIMER STATE (placed early to avoid TDZ in PiP helpers)
  const [timerMode, setTimerMode] = useState('WORK'); 
  const [isActive, setIsActive] = useState(false);
  const [workDuration, setWorkDuration] = useState(25);
  const [breakDuration, setBreakDuration] = useState(5);
  const [timeLeft, setTimeLeft] = useState(25 * 60);
  const [stats, setStats] = useState({ work: 0, break: 0 });
  const secondsTracker = useRef(0);
  const timeLeftRef = useRef(timeLeft);
  const lastElapsedRef = useRef(0);
  const timerWorker = useRef(null);
  const [isPiPActive, setIsPiPActive] = useState(false); // repurposed: popup window open
  const pipVideoRef = useRef(null);
  const pipCanvasRef = useRef(null);
  const pipWarmReady = useRef(false);
  const timerPopupRef = useRef(null);
  const timerStartTime = useRef(null);
  const timerDuration = useRef(0);
  const [autoRestartCycle, setAutoRestartCycle] = useState(false);
  const [cycleCount, setCycleCount] = useState(0); // completed work+break cycles in current series
  const [devQuickCycle, setDevQuickCycle] = useState(false);
  const CYCLES_TARGET = 3;
  const DEV_WORK_SECONDS = 6;
  const DEV_BREAK_SECONDS = 4;
  const timerModeRef = useRef('WORK');
  const workDurationRef = useRef(workDuration);
  const breakDurationRef = useRef(breakDuration);
  const autoRestartCycleRef = useRef(autoRestartCycle);
  const cycleCountRef = useRef(cycleCount);
  const devQuickCycleRef = useRef(devQuickCycle);
  const focusUploadRef = useRef({
    weekly: { periodStart: null, minutes: null },
    monthly: { periodStart: null, minutes: null }
  });

  // Wrapper to persist autoSync setting (both local and cloud)
  const setAutoSyncEnabled = (value) => {
    const newValue = typeof value === 'function' ? value(autoSyncEnabledState) : value;
    // Allow all users to toggle cloud sync (ungated). Persisted server-side when logged in.
    setAutoSyncEnabledState(newValue);
    // Save to cloud if user is logged in
    if (user && saveAutoSyncSetting) {
      saveAutoSyncSetting(user.uid, newValue).catch(err => console.error('Failed to save auto sync setting:', err));
    }
  };



  // Wrapper to persist leaderboard opt-in (Flow users only)
  const setLeaderboardOptInState = (value) => {
    // Only Flow plan can opt in
    if (flowTier !== 'flow') {
      const enforced = false;
      setLeaderboardOptIn(enforced);
      if (user && saveLeaderboardOptIn) {
        saveLeaderboardOptIn(user.uid, enforced).catch(err => console.error('Failed to save leaderboard opt-in:', err));
      }
      return;
    }
    const newValue = typeof value === 'function' ? value(leaderboardOptInState) : value;
    setLeaderboardOptIn(newValue);
    if (user && saveLeaderboardOptIn) {
      saveLeaderboardOptIn(user.uid, newValue).catch(err => console.error('Failed to save leaderboard opt-in:', err));
    }
  };

  const toggleFullScreen = () => {
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen().then(() => setIsFullscreen(true)).catch(console.log);
    } else {
      document.exitFullscreen().then(() => setIsFullscreen(false));
    }
  };

  // Picture-in-Picture toggle
  // --- Popup Timer Window (replacement for PiP) ---
  const closeTimerPopup = useCallback(() => {
    const popup = timerPopupRef.current;
    if (popup && !popup.closed) {
      try { popup.close(); } catch (_) {}
    }
    timerPopupRef.current = null;
    setIsPiPActive(false);
  }, []);

  const renderTimerPopup = useCallback(() => {
    const popup = timerPopupRef.current;
    if (!popup || popup.closed) return;
    const html = `<!doctype html>
    <html><head><title>Focus Timer</title>
    <style>
      :root { color-scheme: light dark; }
      body { margin: 0; font-family: 'Inter', system-ui, -apple-system, sans-serif; background: #0f172a; color: #e2e8f0; display: grid; place-items: center; height: 100vh; }
      .card { padding: 16px 18px; border-radius: 14px; background: linear-gradient(145deg, #0b1224, #111a30); box-shadow: 0 10px 30px rgba(0,0,0,0.35); min-width: 200px; text-align: center; }
      .mode { font-size: 14px; letter-spacing: 0.06em; text-transform: uppercase; color: #94a3b8; margin-bottom: 8px; }
      .time { font-size: 46px; font-weight: 700; letter-spacing: 0.04em; color: #f8fafc; }
      .status { margin-top: 10px; font-size: 13px; color: #cbd5e1; display: flex; align-items: center; gap: 6px; justify-content: center; }
      .dot { width: 10px; height: 10px; border-radius: 50%; background: #22c55e; box-shadow: 0 0 12px rgba(34,197,94,0.7); animation: pulse 1.4s ease-in-out infinite; }
      .paused { background: #eab308; box-shadow: 0 0 12px rgba(234,179,8,0.7); animation: none; }
      .break { background: #0f766e; }
      .work { background: #4338ca; }
      @keyframes pulse { 0% { transform: scale(0.9);} 50% { transform: scale(1.05);} 100% { transform: scale(0.9);} }
    </style></head>
    <body>
      <div class="card">
        <div id="mode" class="mode">Timer</div>
        <div id="time" class="time">00:00</div>
        <div id="status" class="status"><span class="dot"></span><span>Ready</span></div>
      </div>
    <script>
      (function(){
        const modeEl = document.getElementById('mode');
        const timeEl = document.getElementById('time');
        const statusEl = document.getElementById('status');
        const dotEl = statusEl.querySelector('.dot');
        const statusText = statusEl.querySelector('span:last-child');
        const fmt = (sec) => {
          const m = Math.max(0, Math.floor(sec / 60));
          const s = Math.max(0, Math.floor(sec % 60));
          return m.toString().padStart(2,'0') + ':' + s.toString().padStart(2,'0');
        };
        const apply = (payload) => {
          if (!payload) return;
          const { timerMode, timeLeft, isActive } = payload;
          modeEl.textContent = timerMode || 'Timer';
          timeEl.textContent = fmt(timeLeft ?? 0);
          statusText.textContent = isActive ? 'Running' : 'Paused';
          dotEl.classList.toggle('paused', !isActive);
          modeEl.classList.toggle('work', timerMode === 'WORK');
          modeEl.classList.toggle('break', timerMode === 'BREAK');
        };
        window.addEventListener('message', (event) => {
          const data = event.data;
          if (!data || data.type !== 'TIMER_UPDATE') return;
          apply(data.payload);
        });
        window.addEventListener('beforeunload', () => {
          try { window.opener && window.opener.postMessage({ type: 'TIMER_POPUP_CLOSED' }, '*'); } catch (_) {}
        });
      })();
    </script>
    </body></html>`;
    popup.document.open();
    popup.document.write(html);
    popup.document.close();
  }, []);

  const sendTimerPopupUpdate = useCallback(() => {
    const popup = timerPopupRef.current;
    if (!popup || popup.closed) {
      closeTimerPopup();
      return;
    }
    popup.postMessage({
      type: 'TIMER_UPDATE',
      payload: { timerMode, timeLeft, isActive }
    }, '*');
  }, [timerMode, timeLeft, isActive, closeTimerPopup]);

  const togglePiP = () => {
    // Open/close dedicated popup window (instead of Picture-in-Picture)
    if (timerPopupRef.current && !timerPopupRef.current.closed) {
      closeTimerPopup();
      return;
    }
    const popup = window.open('', 'focusTimerPopup', 'width=260,height=220,menubar=no,toolbar=no,location=no,status=no,resizable=yes');
    if (!popup) return;
    timerPopupRef.current = popup;
    renderTimerPopup();
    setIsPiPActive(true);
    // Send initial state after a short delay to ensure handlers are bound
    setTimeout(sendTimerPopupUpdate, 30);
  };

  // Keep popup updated with timer state
  useEffect(() => {
    if (!isPiPActive) return;
    sendTimerPopupUpdate();
  }, [isPiPActive, sendTimerPopupUpdate]);

  // Cleanup popup on unmount
  useEffect(() => () => closeTimerPopup(), [closeTimerPopup]);



  // GLOBAL STATE
  const [folders, setFolders] = useState({ 
    id: 'root', name: 'Home', type: 'folder', 
    children: [{ id: 1, name: "General", type: 'folder', color: '#6366f1', children: [], files: [] }], 
    files: [] 
  });

  // Helper to persist folder tree to both idb-keyval and per-user localPersistence
  const [needsCloudSave, setNeedsCloudSave] = useState(false);

  // persistFolders updates state and saves to local storage
  const persistFolders = (updater) => {
    setFolders(prev => {
      const next = typeof updater === 'function' ? updater(prev) : updater;
      try {
        console.log('[App] persistFolders: saving workspace locally (children=', (next.children||[]).length, 'files=', (next.files||[]).length, ')');
        
        // Save to local storage for all users (anonymous or logged in)
        const uid = user?.uid || 'anonymous-user';
        (async () => {
          try {
            await saveFolderStructure(uid, next);
            console.log('[App] persistFolders: saved to local storage');
          } catch (err) {
            console.warn('[App] persistFolders: failed to save to local storage', err);
          }
        })();

        // If the user is signed in, also mark for cloud save
        if (user) {
          setNeedsCloudSave(true);
          // Attempt a one-off immediate cloud save so uploads are reflected
          if (next && !restoringFromCloudRef.current) {
            (async () => {
              try {
                const d = new Date();
                const todayKey = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
                await syncAllUserDataToCloud(user.uid, next, stats, dailyFocusRecords, todayKey, todos);
                console.log('[App] persistFolders: immediate cloud-save complete');
                setNeedsCloudSave(false);
              } catch (err) {
                console.warn('[App] persistFolders: immediate cloud-save failed', err);
              }
            })();
          }
        }
      } catch (e) { console.warn('persistFolders error', e); }
      return next;
    });
  };
  
  const [currentPath, setCurrentPath] = useState(['root']); 
  const [activeFile, setActiveFile] = useState(null); 
  const [theme, setTheme] = useState('light'); 

  // DUAL AUDIO STATE
  const [trackA, setTrackA] = useState(null);
  const [volA, setVolA] = useState(0.5);
  const audioRefA = useRef(null);
  const [trackB, setTrackB] = useState(null);
  const [volB, setVolB] = useState(0.5);
  const audioRefB = useRef(null);
  
  // NEW STATE: Daily Focus Records
  const [dailyFocusRecords, setDailyFocusRecords] = useState({}); 
  const previousWorkMinutesRef = useRef(0); // Track previous stats.work to detect new sessions 
  // Initialize with local date (not UTC) to match todayKey format
  const getLocalDateKey = () => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  };
  const lastSavedDateRef = useRef(getLocalDateKey());

  // TODO LIST STATE
  const [todos, setTodos] = useState({}); // { dateString: [{ id, title, completed }] }

  // CLOUD SYNC STATE
  const [autoSyncEnabledState, setAutoSyncEnabledState] = useState(autoSyncEnabled || false);
  const [leaderboardOptInState, setLeaderboardOptIn] = useState(leaderboardOptIn || false);

  // MODAL STATE
  const [showLeaderboardModal, setShowLeaderboardModal] = useState(false);
  const [showAuthModal, setShowAuthModal] = useState(false);
  const [leaderboardView, setLeaderboardView] = useState('focus');
  const [focusScope, setFocusScope] = useState('today');
  const [focusLeaderboard, setFocusLeaderboard] = useState([]);
  const [snakeLeaderboard, setSnakeLeaderboard] = useState([]);
  const [leaderboardLoading, setLeaderboardLoading] = useState(false);
  const [leaderboardError, setLeaderboardError] = useState(null);

  // Persist prefs/stats/daily/todos locally for light users
  useEffect(() => {
    // Save preferences and other volatile state to localStorage as backup
    try {
      localStorage.setItem('unifocus_theme', theme);
      localStorage.setItem('unifocus_workDuration', workDuration);
      localStorage.setItem('unifocus_breakDuration', breakDuration);
      localStorage.setItem('unifocus_isFullscreen', isFullscreen);
    } catch (e) {
      console.warn('[App] Failed to save preferences to localStorage:', e);
    }
  }, [stats, dailyFocusRecords, todos, theme, workDuration, breakDuration, isFullscreen]);

  // --- PERSISTENCE (Loading Data) ---
  useEffect(() => {
    async function loadData() {
      try {
        // Use anonymous UID for local-only users
        const uid = user?.uid || 'anonymous-user';
        
        // Load preferences from localStorage
        const savedTheme = localStorage.getItem('unifocus_theme');
        if (savedTheme) setTheme(savedTheme);
        
        const savedWorkDuration = localStorage.getItem('unifocus_workDuration');
        if (savedWorkDuration) setWorkDuration(parseInt(savedWorkDuration));
        
        const savedBreakDuration = localStorage.getItem('unifocus_breakDuration');
        if (savedBreakDuration) setBreakDuration(parseInt(savedBreakDuration));
        
        const savedIsFullscreen = localStorage.getItem('unifocus_isFullscreen');
        if (savedIsFullscreen) setIsFullscreen(savedIsFullscreen === 'true');
        
        console.debug('[Persistence] User preferences loaded from localStorage');
        
        // Load workspace data from IndexedDB
        try {
          const savedFolders = await loadFolderStructure(uid);
          if (savedFolders) {
            console.log('[Persistence] Loaded folder structure from IndexedDB');
            setFolders(savedFolders);
          }
        } catch (e) {
          console.warn('[App] Failed to load folder structure:', e);
        }

        // Load focus stats
        try {
          const savedStats = await loadFocusStats(uid);
          if (savedStats) {
            console.log('[Persistence] Loaded focus stats from IndexedDB');
            setStats(savedStats);
          }
        } catch (e) {
          console.warn('[App] Failed to load focus stats:', e);
        }

        // Load daily records
        try {
          const savedRecords = await loadDailyRecords(uid);
          if (savedRecords) {
            console.log('[Persistence] Loaded daily records from IndexedDB');
            setDailyFocusRecords(savedRecords);
          }
        } catch (e) {
          console.warn('[App] Failed to load daily records:', e);
        }

        // Load todos
        try {
          const savedTodos = await loadTodos(uid);
          if (savedTodos) {
            console.log('[Persistence] Loaded todos from IndexedDB');
            setTodos(savedTodos);
          }
        } catch (e) {
          console.warn('[App] Failed to load todos:', e);
        }
      } catch (e) {
        console.warn('[App] Error loading data:', e);
      }
      setIsLoaded(true);
    }
    loadData();
  }, []);

  // Save focus stats to local storage when they change
  useEffect(() => {
    if (!isLoaded) return;
    const uid = user?.uid || 'anonymous-user';
    const saveStats = async () => {
      try {
        await saveFocusStats(uid, stats);
      } catch (e) {
        console.warn('[App] Failed to save focus stats locally:', e);
      }
    };
    const timer = setTimeout(saveStats, 1000); // Debounce by 1 second
    return () => clearTimeout(timer);
  }, [stats, isLoaded]);

  // Save daily records to local storage when they change
  useEffect(() => {
    if (!isLoaded) return;
    const uid = user?.uid || 'anonymous-user';
    const saveDailyRecordsLocal = async () => {
      try {
        await saveDailyRecords(uid, dailyFocusRecords);
      } catch (e) {
        console.warn('[App] Failed to save daily records locally:', e);
      }
    };
    const timer = setTimeout(saveDailyRecordsLocal, 1000); // Debounce by 1 second
    return () => clearTimeout(timer);
  }, [dailyFocusRecords, isLoaded]);

  // Save todos to local storage when they change
  useEffect(() => {
    if (!isLoaded) return;
    const uid = user?.uid || 'anonymous-user';
    const saveTodosLocal = async () => {
      try {
        await saveTodos(uid, todos);
      } catch (e) {
        console.warn('[App] Failed to save todos locally:', e);
      }
    };
    const timer = setTimeout(saveTodosLocal, 1000); // Debounce by 1 second
    return () => clearTimeout(timer);
  }, [todos, isLoaded]);

  // Save folder structure to local storage when it changes
  useEffect(() => {
    if (!user || !isLoaded) return;
    const saveFoldersLocal = async () => {
      try {
        await saveFolderStructure(user.uid, folders);
      } catch (e) {
        console.warn('[App] Failed to save folder structure locally:', e);
      }
    };
    const timer = setTimeout(saveFoldersLocal, 1000); // Debounce by 1 second
    return () => clearTimeout(timer);
  }, [folders, user, isLoaded]);

  // Import-from-cloud event listener removed (feature disabled)

  // Sync Daily Records - Update live as work minutes accumulate
  useEffect(() => {
    if (!isLoaded || timerMode !== 'WORK') return; 
    const d = new Date();
    const todayKey = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    
    // Only update if this is actually today's work session (after midnight reset check)
    if (lastSavedDateRef.current === todayKey) {
      const workMinutes = typeof stats.work === 'number' ? stats.work : 0;
      const sessionStartMinutes = previousWorkMinutesRef.current;
      
      console.log(`[Daily Records DEBUG] workMinutes=${workMinutes}, sessionStartMinutes=${sessionStartMinutes}, previousRef=${previousWorkMinutesRef.current}`);
      
      // Skip if work minutes haven't actually changed since last update
      if (workMinutes === sessionStartMinutes) {
        console.log(`[Daily Records] Skipping - workMinutes unchanged from previous update`);
        return;
      }
      
      setDailyFocusRecords(prev => {
        const existingVal = prev[todayKey];

        // If work minutes dropped, session likely paused or timer was reset
        if (workMinutes < sessionStartMinutes) {
          console.log(`[Daily Records] Session ended, keeping existing total`);
          return prev;
        }

        // Compute how many minutes this session contributed since last tick
        const sessionMinutes = workMinutes - sessionStartMinutes;
        if (sessionMinutes <= 0) {
          console.log(`[Daily Records] No session minutes to record (${sessionMinutes})`);
          return prev;
        }

        // Helper to sum a day's total from either numeric or object entry
        const getTotalFromEntry = (entry) => {
          if (entry == null) return 0;
          if (typeof entry === 'object') {
            if (typeof entry.total === 'number') return entry.total;
            const by = entry.byTag || {};
            return Object.values(by).reduce((s, v) => s + (Number(v) || 0), 0);
          }
          return Number(entry) || 0;
        };

        const existingTotal = getTotalFromEntry(existingVal);

        // If existing is an object, preserve tag structure
        if (existingVal && typeof existingVal === 'object') {
          const nextByTag = { ...(existingVal.byTag || {}) };
          if (activeTag && activeTag.id) {
            nextByTag[activeTag.id] = (Number(nextByTag[activeTag.id]) || 0) + sessionMinutes;
            console.log(`[Daily Records] ${todayKey}: +${sessionMinutes}m -> tag ${activeTag.id} += ${sessionMinutes}`);
          } else {
            // no active tag: treat as untagged minutes
            nextByTag['untagged'] = (Number(nextByTag['untagged']) || 0) + sessionMinutes;
            console.log(`[Daily Records] ${todayKey}: +${sessionMinutes}m -> untagged += ${sessionMinutes}`);
          }
          const sumByTag = Object.values(nextByTag).reduce((s, v) => s + (Number(v) || 0), 0);
          const finalTotal = Math.max(existingTotal + sessionMinutes, sumByTag);
          return { ...prev, [todayKey]: { total: finalTotal, byTag: nextByTag } };
        }

        // existing is numeric or missing
        if (activeTag && activeTag.id) {
          // convert numeric legacy entry into object preserving old minutes as 'untagged'
          const tagId = activeTag.id;
          const nextByTag = {};
          if (existingTotal > 0) nextByTag['untagged'] = existingTotal;
          nextByTag[tagId] = (Number(nextByTag[tagId]) || 0) + sessionMinutes;
          const finalTotal = existingTotal + sessionMinutes;
          console.log(`[Daily Records] ${todayKey}: +${sessionMinutes}m -> converted to object; tag ${tagId} += ${sessionMinutes}`);
          return { ...prev, [todayKey]: { total: finalTotal, byTag: nextByTag } };
        }

        // both existing and current session are untagged: keep numeric
        const nextTotal = existingTotal + sessionMinutes;
        console.log(`[Daily Records] ${todayKey}: +${sessionMinutes}m -> total ${nextTotal} (untagged)`);
        return { ...prev, [todayKey]: nextTotal };
      });
      
      // Update ref after setState to track what we just processed
      previousWorkMinutesRef.current = workMinutes;
    } else {
      console.log('[Daily Records] Skipped update: lastSavedDateRef.current =', lastSavedDateRef.current, ', todayKey =', todayKey);
    }
  }, [stats.work, isLoaded, timerMode]);
  
  // Local Persistence - Save to localStorage frequently (every 2 seconds)
  useEffect(() => {
    if (!isLoaded || !folders) return;
    // Local persistence has been disabled; keep a light heartbeat for debugging
    const persistInterval = setInterval(() => {
      try { console.log('[Persistence] (disabled) local saves are turned off'); } catch (e) {}
    }, 5000);
    return () => clearInterval(persistInterval);
  }, [isLoaded, folders, theme, workDuration, breakDuration, stats, dailyFocusRecords, todos, isFullscreen]);

  // Mark cloud-dirty when important datasets change (no local saves)
  useEffect(() => { if (isLoaded) setNeedsCloudSave(true); }, [folders]);
  useEffect(() => { if (isLoaded) setNeedsCloudSave(true); }, [stats, dailyFocusRecords]);
  useEffect(() => { if (isLoaded) setNeedsCloudSave(true); }, [todos]);
  useEffect(() => { if (isLoaded) setNeedsCloudSave(true); }, [theme, workDuration, breakDuration, autoSyncEnabled]);



  // --- HELPER ---
  const findFolder = (folder, targetId) => {
    if (folder.id === targetId) return folder;
    for (let child of folder.children) {
      const found = findFolder(child, targetId);
      if (found) return found;
    }
    return null;
  };

  const currentFolderId = currentPath[currentPath.length - 1];
  const currentFolder = isLoaded ? (findFolder(folders, currentFolderId) || folders) : folders; 

  // --- TIMER & AUDIO ---
  // Initialize Web Worker for precise timing
  useEffect(() => {
    timerWorker.current = new Worker('/timer-worker.js');
    
    timerWorker.current.onmessage = (e) => {
      const { type, timeLeft: workerTimeLeft } = e.data;

      if (type === 'TICK') {
        // Update displayed time
        setTimeLeft(workerTimeLeft);
        timeLeftRef.current = workerTimeLeft;

        // Compute elapsed seconds from the original duration reported when START was called.
        // This avoids relying on tick counts (which can be missed/delayed during throttling or sleep).
        const duration = timerDuration.current || 0; // seconds
        const elapsed = Math.max(0, duration - workerTimeLeft);

        // Calculate whole-minute increments since last processed elapsed value.
        const lastMinutes = Math.floor(lastElapsedRef.current / 60);
        const nowMinutes = Math.floor(elapsed / 60);
        const minuteDelta = Math.max(0, nowMinutes - lastMinutes);

        if (minuteDelta > 0) {
          const modeKey = timerModeRef.current.toLowerCase();
          setStats(prev => {
            const updated = { ...prev, [modeKey]: prev[modeKey] + minuteDelta };
            console.log(`[Timer] +${minuteDelta} minute(s): ${modeKey}=${updated[modeKey]}`);
            return updated;
          });
        }

        // Save elapsed for next tick
        lastElapsedRef.current = elapsed;

      } else if (type === 'COMPLETE') {
        handleTimerComplete();
      }
    };

    return () => {
      if (timerWorker.current) {
        timerWorker.current.postMessage({ type: 'STOP' });
        timerWorker.current.terminate();
      }
    };
  }, []);

  const getModeSeconds = useCallback((mode) => {
    if (devQuickCycleRef.current) {
      return mode === 'WORK' ? DEV_WORK_SECONDS : DEV_BREAK_SECONDS;
    }
    return mode === 'WORK' ? Math.round(workDurationRef.current * 60) : Math.round(breakDurationRef.current * 60);
  }, []);

  // Control worker based on isActive state
  useEffect(() => {
    if (!timerWorker.current) return;

    if (isActive && timeLeftRef.current > 0) {
      timerStartTime.current = Date.now();
      timerDuration.current = timeLeftRef.current;
      lastElapsedRef.current = 0;
      timerWorker.current.postMessage({ type: 'START', payload: { duration: timeLeftRef.current } });
    } else if (!isActive) {
      timerWorker.current.postMessage({ type: 'PAUSE' });
    }
  }, [isActive]);

  // Keep refs in sync for timer state to avoid stale closures in worker callbacks
  useEffect(() => { timerModeRef.current = timerMode; }, [timerMode]);
  useEffect(() => { workDurationRef.current = workDuration; }, [workDuration]);
  useEffect(() => { breakDurationRef.current = breakDuration; }, [breakDuration]);
  useEffect(() => { autoRestartCycleRef.current = autoRestartCycle; }, [autoRestartCycle]);
  useEffect(() => { devQuickCycleRef.current = devQuickCycle; }, [devQuickCycle]);
  useEffect(() => { cycleCountRef.current = cycleCount; }, [cycleCount]);
  useEffect(() => { timeLeftRef.current = timeLeft; }, [timeLeft]);

  // When toggling dev quick cycle, update the pending time if not active
  useEffect(() => {
    if (!isActive) {
      setTimeLeft(getModeSeconds(timerModeRef.current));
    }
  }, [devQuickCycle, getModeSeconds]);

  // Reset cycle counter when auto-restart is toggled on
  useEffect(() => {
    if (autoRestartCycle) {
      setCycleCount(0);
      cycleCountRef.current = 0;
    }
  }, [autoRestartCycle]);

  // Recalculate on visibility change to fix background throttling
  useEffect(() => {
    const handleVisibilityChange = () => {
      if (!document.hidden && isActive && timerWorker.current) {
        timerWorker.current.postMessage({ type: 'SYNC' });
      }
    };
    
    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => document.removeEventListener('visibilitychange', handleVisibilityChange);
  }, [isActive]);

  const handleTimerComplete = () => {
    secondsTracker.current = 0;
    lastElapsedRef.current = 0;
    let message = '';
    let notificationType = '';

    const startPhase = (mode) => {
      const duration = getModeSeconds(mode);
      // Force a pause->start transition so the worker effect re-runs
      setIsActive(false);
      timerModeRef.current = mode;
      timeLeftRef.current = duration;
      setTimerMode(mode);
      setTimeLeft(duration);
      // Defer re-start to the next tick to allow state to flush
      setTimeout(() => setIsActive(true), 0);
    };

    const currentMode = timerModeRef.current;
    const autoRestart = autoRestartCycleRef.current;

    if (currentMode === 'WORK') { 
      // Always start the break timer; auto-restart only changes what happens after the break ends
      startPhase('BREAK');
      message = 'Work session complete! Time for a break.';
      notificationType = 'WORK_END';
      playWorkEndSound();
    } else { 
        // Break ended
        const nextCount = cycleCountRef.current + 1;
        setCycleCount(nextCount);
        cycleCountRef.current = nextCount;

        if (autoRestart && nextCount < CYCLES_TARGET) {
          // Auto-restart next work session
          startPhase('WORK');
          message = `Break complete! Starting cycle ${nextCount + 1}/${CYCLES_TARGET}.`;
          notificationType = 'AUTO_RESTART';
          playBreakEndSound();
        } else {
          // Series complete or auto-restart off: stop and prompt user
          setIsActive(false); 
          setTimerMode('WORK');
          setTimeLeft(getModeSeconds('WORK'));
          message = nextCount >= CYCLES_TARGET
            ? `Completed ${CYCLES_TARGET} Focus Loops. Ready to start again?`
            : 'Focus cycle complete!';
          notificationType = nextCount >= CYCLES_TARGET ? 'SERIES_COMPLETE' : 'CYCLE_END';
          playBreakEndSound();
          const resetCount = nextCount >= CYCLES_TARGET ? 0 : nextCount;
          setCycleCount(resetCount);
          cycleCountRef.current = resetCount;
        }
    }
    
    const event = new CustomEvent('timerFinish', { detail: { message, notificationType } });
    document.dispatchEvent(event);
  };

  const playWorkEndSound = () => {
    const audio = new Audio('/music/notify1.mp3');
    audio.volume = 0.7;
    audio.play().catch(e => {});
  };

  const playBreakEndSound = () => {
    const audio = new Audio('/music/notify2.mp3');
    audio.volume = 0.7;
    audio.play().catch(e => {});
  };

  // Update track selection without touching volume (avoid reload when only volume changes)
  useEffect(() => {
    if (!audioRefA.current) return;
    if (!trackA) {
      audioRefA.current.pause();
      return;
    }
    const d = GROUP_A.find(t => t.id === trackA);
    if (!d) return;
    try {
      const expected = new URL(d.src, window.location.origin).href;
      if (audioRefA.current.src !== expected) {
        audioRefA.current.src = expected;
        audioRefA.current.load();
        audioRefA.current.play().catch(() => {});
      } else if (audioRefA.current.paused) {
        audioRefA.current.play().catch(() => {});
      }
    } catch (err) {
      // Fallback: conservative check using indexOf if URL construction fails
      if (audioRefA.current.src.indexOf(d.src) === -1) {
        audioRefA.current.src = d.src;
        audioRefA.current.load();
        audioRefA.current.play().catch(() => {});
      } else if (audioRefA.current.paused) {
        audioRefA.current.play().catch(() => {});
      }
    }
  }, [trackA]);

  // Only update volume when volume state changes — do not reload audio source
  useEffect(() => {
    if (audioRefA.current) {
      audioRefA.current.volume = volA;
    }
  }, [volA]);

  // Same separation for audio B
  useEffect(() => {
    if (!audioRefB.current) return;
    if (!trackB) {
      audioRefB.current.pause();
      return;
    }
    const d = GROUP_B.find(t => t.id === trackB);
    if (!d) return;
    try {
      const expected = new URL(d.src, window.location.origin).href;
      if (audioRefB.current.src !== expected) {
        audioRefB.current.src = expected;
        audioRefB.current.load();
        audioRefB.current.play().catch(() => {});
      } else if (audioRefB.current.paused) {
        audioRefB.current.play().catch(() => {});
      }
    } catch (err) {
      if (audioRefB.current.src.indexOf(d.src) === -1) {
        audioRefB.current.src = d.src;
        audioRefB.current.load();
        audioRefB.current.play().catch(() => {});
      } else if (audioRefB.current.paused) {
        audioRefB.current.play().catch(() => {});
      }
    }
  }, [trackB]);

  useEffect(() => {
    if (audioRefB.current) {
      audioRefB.current.volume = volB;
    }
  }, [volB]);

  // --- ACTIONS ---
  const updateFolderTree = (folder, targetId, updateFn) => {
    if (folder.id === targetId) return updateFn(folder);
    return { ...folder, children: folder.children.map(child => updateFolderTree(child, targetId, updateFn)) };
  };

  const deleteFromTree = (folder, targetId) => {
    const newChildren = folder.children.filter(child => child.id !== targetId).map(child => deleteFromTree(child, targetId));
    const newFiles = folder.files.filter(file => file.id !== targetId);
    return { ...folder, children: newChildren, files: newFiles };
  };

  const handleCreateFolder = (name, color) => {
    const newFolder = { id: Date.now(), name, type: 'folder', color: color || '#6366f1', children: [], files: [] };
    persistFolders(prev => updateFolderTree(prev, currentFolderId, (f) => ({ ...f, children: [...f.children, newFolder] })));
  };

  const handleCreateNote = (name, color) => {
    const newNote = { id: Date.now(), name: name.endsWith('.txt')?name:`${name}`, type: 'note', content: '', color: color || '#6366f1' };
    persistFolders(prev => updateFolderTree(prev, currentFolderId, (f) => ({ ...f, files: [...f.files, newNote] })));
  };

  const handleCreateDeck = (name, color) => {
    const newDeck = { id: Date.now(), name, type: 'deck', content: '[]', color: color || '#6366f1' };
    persistFolders(prev => updateFolderTree(prev, currentFolderId, (f) => ({ ...f, files: [...f.files, newDeck] })));
  };

  const handleUpdateNote = (fid, c) => {
    persistFolders(prev => updateFolderTree(prev, currentFolderId, (f) => ({
      ...f, files: f.files.map(file => file.id === fid ? { ...file, content: c } : file)
    })));
  };

  const handleRenameItem = (item, newName, newColor) => {
    persistFolders(prev => updateFolderTree(prev, currentFolderId, (f) => {
      if (item.type === 'folder') return { ...f, children: f.children.map(c => c.id === item.id ? { ...c, name: newName, color: newColor || c.color } : c) };
      return { ...f, files: f.files.map(f => f.id === item.id ? { ...f, name: newName, color: newColor || f.color } : f) };
    }));
  };

  const handleUpdateFileMeta = (fileId, meta) => {
    persistFolders(prev => updateFolderTree(prev, currentFolderId, (f) => ({
      ...f, files: f.files.map(file => file.id === fileId ? { ...file, ...meta } : file)
    })));
  };

  const handleDeleteConfirm = (itemId) => {
    if (activeFile && activeFile.id === itemId) setActiveFile(null);
    persistFolders(prev => deleteFromTree(prev, itemId));
  };

  const handleClearHistory = () => {
    // Clear daily records and reset tracked work minutes so we don't
    // immediately re-append the same minutes as a new session.
    setDailyFocusRecords({});
    setStats({ work: 0, break: 0 });
    previousWorkMinutesRef.current = 0;
    setNeedsCloudSave(true);

    // If signed-in, attempt an immediate cloud sync so the cleared
    // state is reflected server-side without waiting for the interval.
    if (user) {
      (async () => {
        try {
          const d = new Date();
          const todayKey = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
          await syncAllUserDataToCloud(user.uid, folders, { work: 0, break: 0 }, {}, todayKey, todos);
          setNeedsCloudSave(false);
          console.log('[App] Cleared history and synced empty dailyRecords to cloud');
        } catch (err) {
          console.warn('[App] Failed to sync cleared history to cloud', err);
        }
      })();
    }
  };

  const navigateToFolder = (id) => { setCurrentPath([...currentPath, id]); setActiveFile(null); };
  const navigateUp = () => { if (currentPath.length > 1) { setCurrentPath(prev => prev.slice(0, -1)); setActiveFile(null); } };
  const navigateToPathIndex = (idx) => { setCurrentPath(prev => prev.slice(0, idx + 1)); setActiveFile(null); };

  if (!isLoaded) return <div className="loading-screen">Loading Sanctuary...</div>;

  return (
    <div className={`app-root theme-${theme}`}>
      {/* Native beforeunload prompt will be used for unsaved Flow workspaces */}
      <AnimatePresence mode="wait">
        {activePage === 'MENU' && (
          <motion.div 
            key="menu" 
            className="menu-screen" 
            initial={{ opacity: 0, filter: "blur(10px)", scale: 0.95 }} 
            animate={{ opacity: 1, filter: "blur(0px)", scale: 1 }} 
            exit={{ opacity: 0, filter: "blur(15px)", scale: 0.9 }} 
            transition={{ duration: 0.6, ease: "easeInOut" }}
          >
            {isAuthTransitioning && (
              <motion.div
                style={{
                  position: 'fixed',
                  top: 0,
                  left: 0,
                  right: 0,
                  bottom: 0,
                  backgroundColor: 'rgba(99, 102, 241, 0.9)',
                  zIndex: 999,
                  backdropFilter: 'blur(10px)'
                }}
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.3 }}
              />
            )}
            <FloatingBackground />
            
            {/* NEW: Fullscreen Button on Landing */}
            <motion.button 
              className="fullscreen-landing-btn"
              onClick={toggleFullScreen}
              whileHover={{ scale: 1.1 }}
              whileTap={{ scale: 0.9 }}
              style={{
                position: 'fixed',
                top: '20px',
                left: '20px',
                padding: '10px 12px',
                borderRadius: '8px',
                backgroundColor: theme === 'dark' ? '#374151' : 'white',
                color: theme === 'dark' ? '#6366f1' : '#4338ca',
                border: theme === 'dark' ? '1px solid #4b5563' : '1px solid #e2e8f0',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                zIndex: 99,
                width: 'fit-content',
                height: 'fit-content',
                boxShadow: theme === 'dark' ? '0 2px 8px rgba(0, 0, 0, 0.3)' : '0 2px 8px rgba(0, 0, 0, 0.1)'
              }}
            >
              {isFullscreen ? <Minimize size={20}/> : <Maximize size={20}/>}
            </motion.button>

            {/* NEW: About Button */}

            <motion.button 
              className="about-trigger-btn"
              onClick={() => setShowAboutModal(true)}
              whileHover={{ scale: 1.05 }}
              whileTap={{ scale: 0.95 }}
            >
              <BookOpen size={18} /> About
            </motion.button>

            {/* Footer Links - Small & Unassuming */}
            <div style={{
              position: 'fixed',
              bottom: '20px',
              left: '20px',
              display: 'flex',
              gap: '12px',
              alignItems: 'center',
              fontSize: '0.75rem',
              zIndex: 50
            }}>
              <button
                onClick={() => setShowPrivacyPolicy(true)}
                style={{
                  background: 'none',
                  border: 'none',
                  color: '#9ca3af',
                  cursor: 'pointer',
                  textDecoration: 'none',
                  transition: 'color 0.2s',
                  fontSize: '0.75rem',
                  fontWeight: '400'
                }}
                onMouseEnter={(e) => e.currentTarget.style.color = '#6b7280'}
                onMouseLeave={(e) => e.currentTarget.style.color = '#9ca3af'}
              >
                Privacy
              </button>
              <span style={{ color: '#d1d5db' }}>•</span>
              <button
                onClick={() => setShowTermsOfService(true)}
                style={{
                  background: 'none',
                  border: 'none',
                  color: '#9ca3af',
                  cursor: 'pointer',
                  textDecoration: 'none',
                  transition: 'color 0.2s',
                  fontSize: '0.75rem',
                  fontWeight: '400'
                }}
                onMouseEnter={(e) => e.currentTarget.style.color = '#6b7280'}
                onMouseLeave={(e) => e.currentTarget.style.color = '#9ca3af'}
              >
                Terms
              </button>
            </div>

            <motion.div className="menu-content" initial={{ y: 20, opacity: 0 }} animate={{ y: 0, opacity: 1 }} transition={{ delay: 0.2 }}>
              <h1 className="menu-title">FocuState.</h1>
              <p className="menu-subtitle">All Focus, No Distractions.</p>
              <div className="menu-grid">
                  <motion.button 
                    className="menu-card" 
                    onClick={() => setActivePage('STUDY')}
                    whileHover={{ scale: 1.05, y: -5 }} 
                    whileTap={{ scale: 0.95 }}
                    style={{ cursor: 'pointer' }}
                  >
                    <div className="icon-wrapper"><LibraryBig size={40} /></div>
                    <h2>Enter Workspace</h2>
                    <p>Start Today.</p>
                  </motion.button>
              </div>
            </motion.div>

    
            

            <AnimatePresence>
              {showAboutModal && (
                <AboutModal key="aboutModal" onClose={() => setShowAboutModal(false)} />
              )}
              {showPrivacyPolicy && (
                <PrivacyPolicyModal key="privacyModal" onClose={() => setShowPrivacyPolicy(false)} />
              )}
              {showTermsOfService && (
                <TermsOfServiceModal key="termsModal" onClose={() => setShowTermsOfService(false)} />
              )}
            </AnimatePresence>

          </motion.div>
        )}

        {activePage === 'STUDY' && (
          <motion.div 
            key="study" 
            className="workspace-wrapper" 
            style={{ height: '100%', width: '100%' }} 
            initial={{ opacity: 0, filter: "blur(10px)" }} 
            animate={{ opacity: 1, filter: "blur(0px)" }} 
            exit={{ opacity: 0, filter: "blur(10px)", y: -20 }} 
            transition={{ duration: 0.5, ease: "easeInOut" }}
          >
      {/* Tag Session Modal */}
      {showTagModal && (
        <TagManagerModal
          onClose={() => setShowTagModal(false)}
          onSelectTag={tag => { setActiveTag(tag); setShowTagModal(false); }}
          selectedTag={activeTag}
        />
      )}

            <StudyFocusMode 
              goBack={() => setActivePage('MENU')} goToReNote={() => setActivePage('RENOTE')}
              currentFolder={currentFolder} rootFolder={folders} currentPath={currentPath}
              activeFile={activeFile} setActiveFile={setActiveFile} theme={theme} setTheme={setTheme}
              onCreateFolder={handleCreateFolder} onCreateNote={handleCreateNote} onCreateDeck={handleCreateDeck}
              onUpdateNote={handleUpdateNote} onRenameItem={handleRenameItem} 
              onUpdateFileMeta={handleUpdateFileMeta} onDeleteItem={handleDeleteConfirm}
              onNavigate={navigateToFolder} onNavigateUp={navigateUp} onBreadcrumbClick={navigateToPathIndex}
              setRootFolder={persistFolders} updateFolderTree={updateFolderTree} currentFolderId={currentFolderId}
              timerMode={timerMode} setTimerMode={setTimerMode} isActive={isActive} setIsActive={setIsActive}
              timeLeft={timeLeft} setTimeLeft={setTimeLeft} workDuration={workDuration} setWorkDuration={setWorkDuration}
              breakDuration={breakDuration} setBreakDuration={setBreakDuration} stats={stats}
              trackA={trackA} setTrackA={setTrackA} volA={volA} setVolA={setVolA} trackB={trackB} setTrackB={setTrackB} volB={volB} setVolB={setVolB}
              dailyFocusRecords={dailyFocusRecords}
              isFullscreen={isFullscreen} 
              toggleFullScreen={toggleFullScreen}
              togglePiP={togglePiP}
              isPiPActive={isPiPActive}
              autoRestartCycle={autoRestartCycle}
              setAutoRestartCycle={setAutoRestartCycle}
              devQuickCycle={devQuickCycle}
              setDevQuickCycle={setDevQuickCycle}
              onClearHistory={handleClearHistory}
              todos={todos} setTodos={setTodos}
              user={user}
              username={username}
              leaderboardOptIn={leaderboardOptIn}
              flowTier={flowTier}
              activeTag={activeTag}
              setActiveTag={setActiveTag}
              showTagModal={showTagModal}
              setShowTagModal={setShowTagModal}
              onLogout={async () => {
                setIsAuthTransitioning(true);
                const result = await logoutUser();
                if (result.success) {
                  setTimeout(() => {
                    setUser(null);
                    setActivePage('MENU');
                    setIsAuthTransitioning(false);
                  }, 400);
                }
              }}
            />
          </motion.div>
        )}
      </AnimatePresence>

      <div style={{ display: activePage === 'RENOTE' ? 'block' : 'none', height: '100%' }}>
        <ReNoteMode goBack={() => setActivePage('MENU')} goToStudy={() => setActivePage('STUDY')} />
      </div>

      <audio ref={audioRefA} loop crossOrigin="anonymous" />
      <audio ref={audioRefB} loop crossOrigin="anonymous" />
      
      {/* Legacy PiP elements (unused, kept to avoid layout shifts if reintroduced) */}
      <canvas ref={pipCanvasRef} width="320" height="180" style={{ display: 'none' }} />
      <video ref={pipVideoRef} style={{ display: 'none' }} playsInline muted />

      <AnimatePresence>
        {showLeaderboardModal && (
          <LeaderboardModal
            key="leaderboardModal"
            theme={theme}
            onClose={() => setShowLeaderboardModal(false)}
            leaderboardView={leaderboardView}
            setLeaderboardView={setLeaderboardView}
            focusScope={focusScope}
            setFocusScope={setFocusScope}
            focusLeaderboard={focusLeaderboard}
            snakeLeaderboard={snakeLeaderboard}
            loading={leaderboardLoading}
            error={leaderboardError}
            leaderboardOptIn={leaderboardOptIn}
            onOptIn={() => setLeaderboardOptInState(true)}
            user={user}
            flowTier={flowTier}
          />
        )}
      </AnimatePresence>
    </div>
  );
}

// --- COMPONENTS ---



// --- Workspace Tour (inline highlights) ---
function TourTooltip({ targetRef, text, theme, onNext, onSkip, center, icon, title }) {
  const [highlight, setHighlight] = useState(null);

  useEffect(() => {
    const update = () => {
      const el = targetRef?.current;
      if (!el || center) {
        setHighlight(null);
        return;
      }
      const rect = el.getBoundingClientRect();
      setHighlight({
        top: rect.top - 10,
        left: rect.left - 10,
        width: rect.width + 20,
        height: rect.height + 20
      });
    };
    update();
    window.addEventListener('resize', update);
    window.addEventListener('scroll', update, true);
    return () => {
      window.removeEventListener('resize', update);
      window.removeEventListener('scroll', update, true);
    };
  }, [targetRef, center]);

  const bg = theme === 'dark' ? 'linear-gradient(135deg, #0f172a 0%, #1f2937 100%)' : theme === 'sepia' ? 'linear-gradient(135deg, #fff8ed 0%, #f5e7d4 100%)' : 'linear-gradient(135deg, #ffffff 0%, #f4f7ff 100%)';
  const border = theme === 'dark' ? '#4b5563' : '#e5e7eb';
  const color = theme === 'dark' ? '#e5e7eb' : '#0f172a';

  return (
    <>
      {highlight && (
        <div
          className="tour-highlight"
          style={{
            top: highlight.top,
            left: highlight.left,
            width: highlight.width,
            height: highlight.height
          }}
        />
      )}
      <div className="tour-tooltip-centered" style={{ background: bg, color, border: `1px solid ${border}` }}>
        <div className="tour-header">
          <div className="tour-feature-badge">
            {icon}
            <span className="tour-feature-name">{title}</span>
          </div>
          <div className="tour-decorative-line"></div>
        </div>
        <div className="tour-text">{text}</div>
        <div className="tour-actions">
          <button className="tour-btn-skip" onClick={onSkip}>Skip Tour</button>
          <button className="tour-btn-continue" onClick={onNext}>Continue →</button>
        </div>
      </div>
    </>
  );
}

function FloatingBackground() {
  const icons = [ { Icon: BookOpen, x: '10%', y: '20%', delay: 0 }, { Icon: Coffee, x: '80%', y: '15%', delay: 2 }, { Icon: Feather, x: '20%', y: '80%', delay: 4 }, { Icon: Clock, x: '75%', y: '75%', delay: 1 }, { Icon: MusicIcon, x: '50%', y: '10%', delay: 3 }, { Icon: PenTool, x: '10%', y: '50%', delay: 5 } ];
  return <div className="floating-bg-container">{icons.map((item, index) => (<motion.div key={index} className="floating-icon" style={{ left: item.x, top: item.y }} animate={{ y: [0, -20, 0], opacity: [0.3, 0.6, 0.3], rotate: [0, 5, -5, 0] }} transition={{ duration: 6, repeat: Infinity, delay: item.delay, ease: "easeInOut" }}><item.Icon size={64} strokeWidth={1} /></motion.div>))}</div>;
}

function StudyFocusMode(props) {
  // Derive local tier values from props to avoid referencing App-level variables
  const flowTier = props.flowTier;  // Bring through commonly used top-level props into local variables
  const user = props.user;
  const username = props.username;
  const [isSidebarOpen, setIsSidebarOpen] = useState(true);
  const [isToolsPanelOpen, setIsToolsPanelOpen] = useState(true); 
  const [showTimerModal, setShowTimerModal] = useState(false); 
  const [showHistoryModal, setShowHistoryModal] = useState(false); 
  const [timerModalMessage, setTimerModalMessage] = useState(''); 
  const [showFolderModal, setShowFolderModal] = useState(false);
  const [showNoteModal, setShowNoteModal] = useState(false);
  const [showDeckModal, setShowDeckModal] = useState(false);
  const [renamingItem, setRenamingItem] = useState(null);
  
  // Get today's focus minutes from dailyFocusRecords
  const getTodayMinutes = () => {
    const d = new Date();
    const todayKey = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    const entry = props.dailyFocusRecords?.[todayKey];
    if (entry == null) return 0;
    if (typeof entry === 'object') {
      if (typeof entry.total === 'number') return entry.total;
      const by = entry.byTag || {};
      return Object.values(by).reduce((s, v) => s + (Number(v) || 0), 0);
    }
    return Number(entry) || 0;
  }; 
  const [itemToDelete, setItemToDelete] = useState(null);
  // Split view state: left/right files and which pane is focused
  const [splitMode, setSplitMode] = useState(false);
  const [leftFile, setLeftFile] = useState(props.activeFile);
  const [rightFile, setRightFile] = useState(null);
  const [focusedPane, setFocusedPane] = useState('right'); // when opening split, default choose right to pick second file
  const [showTodoModal, setShowTodoModal] = useState(false);
  const [showSnakeModal, setShowSnakeModal] = useState(false);
  const [isSyncing, setIsSyncing] = useState(false);
  // Sync progress UI state
  const [syncProgress, setSyncProgress] = useState(0);
  const [syncStatus, setSyncStatus] = useState('idle'); // 'idle' | 'in-progress' | 'success' | 'error'
  const syncProgressIntervalRef = useRef(null);
  const [showTour, setShowTour] = useState(false);
  const [tourStep, setTourStep] = useState(0);
  const splitRef = useRef(null);
  const cloudRef = useRef(null);
  const folderRef = useRef(null);
  const fileNavRef = useRef(null);
  const pdfNavRef = useRef(null);
  const deckRef = useRef(null);
  const timerRef = useRef(null);
  const statsRef = useRef(null);
  const todoRef = useRef(null);
  const soundRef = useRef(null);
  const snakeRef = useRef(null);

  const tourSteps = [
    { key: 'welcome', title: 'Welcome to FocuState!', text: 'Let me show you around your new study environment.', icon: <Sparkles size={24} color="#6366f1" /> },
    { key: 'files', ref: folderRef, title: 'Manage Files', text: 'Create folders to organize your notes and study materials.', icon: <Folder size={24} color="#6366f1" /> },
    { key: 'deck', ref: deckRef, title: 'Flashcard Decks', text: 'Create spaced-repetition flashcard decks for active recall.', icon: <Layers size={24} color="#8b5cf6" /> },
    { key: 'split', ref: splitRef, title: 'Split View', text: 'Study two documents side-by-side.', icon: <Columns2 size={24} color="#ec4899" /> },
    { key: 'timer', ref: timerRef, title: 'Focus Timer', text: 'Use the Pomodoro timer to manage your study and break sessions.', icon: <Timer size={24} color="#ef4444" /> },
    { key: 'sound', ref: soundRef, title: 'Soundscape Mixer', text: 'Mix ambient sounds to create your ideal focus environment.', icon: <Volume2 size={24} color="#10b981" /> },
    { key: 'stats', ref: statsRef, title: 'Study Stats', text: 'Track your daily focus time and build study habits.', icon: <BarChart3 size={24} color="#f59e0b" /> },
    { key: 'todo', ref: todoRef, title: 'To-Do List', text: 'Keep track of your tasks and assignments here.', icon: <ListTodo size={24} color="#06b6d4" /> },
    { key: 'snake', ref: snakeRef, title: 'Take a Break', text: 'Enjoy a quick game of Snake during your break time!', icon: <Gamepad2 size={24} color="#8b5cf6" /> }
  ];

  useEffect(() => {
    // Local tutorial flag removed; default to not showing tour automatically.
  }, []);
  
  // Force sidebar open during tour steps that need it
  useEffect(() => {
    if (showTour && tourStep >= 1 && tourStep <= 4 && !isSidebarOpen) {
      setIsSidebarOpen(true);
    }
  }, [showTour, tourStep, isSidebarOpen]);
  
  
  const completeTour = () => { setShowTour(false); setTourStep(0); };

  const cycleTheme = () => { if (props.theme === 'light') props.setTheme('sepia'); else if (props.theme === 'sepia') props.setTheme('dark'); else props.setTheme('light'); };
  const getThemeIcon = () => { if (props.theme === 'light') return <Sun size={16} />; if (props.theme === 'sepia') return <Feather size={16} />; return <Moon size={16} />; };
  
  const handleFolderCreate = (name, color) => {
    const unique = getUniqueName(name, props.currentFolder.children);
    props.onCreateFolder(unique, color);
    setShowFolderModal(false);
  };

  const handleNoteCreate = (name, color) => {
    const unique = getUniqueName(name, props.currentFolder.files);
    props.onCreateNote(unique, color);
    setShowNoteModal(false);
  };

  const handleCreateDeck = (name, color) => {
    const unique = getUniqueName(name, props.currentFolder.files);
    props.onCreateDeck(unique, color);
    setShowDeckModal(false);
  };

  // Keep leftFile in sync with global activeFile when not in split mode
  useEffect(() => {
    if (!splitMode) setLeftFile(props.activeFile);
  }, [props.activeFile, splitMode]);

  // Open file handler that respects split mode and focused pane
  const handleOpenFile = (file, options = {}) => {
    const side = options.side || (splitMode ? focusedPane : 'left');
    if (splitMode) {
      if (side === 'left') {
        setLeftFile(file);
      } else {
        setRightFile(file);
      }
    } else {
      // single mode: set global active file so other parts of the app work
      props.setActiveFile(file);
      setLeftFile(file);
    }
  };

  const handleToggleSplit = () => {
    if (!splitMode) {
      // enabling split: put current activeFile on left and show browser on right
      setLeftFile(props.activeFile || null);
      setRightFile(null);
      setFocusedPane('right');
      setSplitMode(true);
    } else {
      // disabling split: collapse into single view, pick leftFile as active
      setSplitMode(false);
      setRightFile(null);
      props.setActiveFile(leftFile || null);
    }
  };

  const handleRenameSubmit = (newName, newColor) => {
    if (newName === renamingItem.name) {
        props.onRenameItem(renamingItem, newName, newColor);
    } else {
        const siblings = renamingItem.type === 'folder' ? props.currentFolder.children : props.currentFolder.files;
        const unique = getUniqueName(newName, siblings, renamingItem.id);
        props.onRenameItem(renamingItem, unique, newColor);
    }
    setRenamingItem(null);
  };

  const confirmDelete = () => { if (itemToDelete) { props.onDeleteItem(itemToDelete); setItemToDelete(null); } };

  const handleManualSync = async () => {
    if (isSyncing) return;
    if (!props.user) {
      // Prompt anonymous user to sign in before syncing
      setShowAuthModal(true);
      console.info('[Cloud] Manual sync requires login; opening auth modal');
      return;
    }
    // Allow manual cloud sync for all tiers (light users included).
    
    // Start progress UI
    setIsSyncing(true);
    setSyncStatus('in-progress');
    setSyncProgress(5);

    // Slowly advance progress toward 90% while background sync runs
    if (syncProgressIntervalRef.current) clearInterval(syncProgressIntervalRef.current);
    syncProgressIntervalRef.current = setInterval(() => {
      setSyncProgress(p => {
        const next = p + Math.random() * 6; // random smoothing
        return Math.min(90, next);
      });
    }, 650);

    console.log('Starting manual cloud sync...');
    console.info('[Cloud] User tier:', props.flowTier, 'autoSyncEnabled:', props.autoSyncEnabled);
    console.log('Current stats:', props.stats);
    console.log('Current dailyFocusRecords:', props.dailyFocusRecords);
    try {
      const d = new Date();
      const todayKey = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
      console.log('Today key:', todayKey);

      // Sanitize folder tree to avoid sending binary data (base64/blob) which can
      // make the JSON payload exceed Cloud Function size limits.
      const sanitizeFoldersForSync = (folders) => {
        try {
          return JSON.parse(JSON.stringify(folders, (key, value) => {
            if (key === 'blob' || key === 'base64') return undefined;
            return value;
          }));
        } catch (e) {
          // Fallback: shallow walk and remove known big fields
          const clone = JSON.parse(JSON.stringify(folders));
          const walk = (node) => {
            if (!node) return;
            if (Array.isArray(node.files)) {
              node.files = node.files.map(f => {
                const copy = { ...f };
                delete copy.blob;
                delete copy.base64;
                return copy;
              });
            }
            if (Array.isArray(node.children)) node.children.forEach(walk);
          };
          walk(clone);
          return clone;
        }
      };

      const sanitizedFolders = sanitizeFoldersForSync(props.rootFolder);

      // Optional: measure JSON payload size and prevent oversize requests
      const payload = { folders: sanitizedFolders, stats: props.stats, dailyFocusRecords: props.dailyFocusRecords, todos: props.todos };
      const payloadBytes = typeof TextEncoder !== 'undefined' ? new TextEncoder().encode(JSON.stringify(payload)).length : JSON.stringify(payload).length;
      const MAX_SAFE_BYTES = 9 * 1024 * 1024; // 9 MB threshold for safety
      if (payloadBytes > MAX_SAFE_BYTES) {
        console.error('Manual sync aborted: payload too large (bytes):', payloadBytes);
        if (syncProgressIntervalRef.current) { clearInterval(syncProgressIntervalRef.current); syncProgressIntervalRef.current = null; }
        setSyncProgress(100);
        setSyncStatus('error');
        setTimeout(() => { setIsSyncing(false); setSyncStatus('idle'); setSyncProgress(0); }, 1600);
        alert('Sync aborted: workspace contains large file data. Please ensure your files are uploaded to Cloud Storage before syncing.');
        return;
      }

      const result = await syncAllUserDataToCloud(props.user.uid, sanitizedFolders, props.stats, props.dailyFocusRecords, todayKey, props.todos);
      console.log('Manual sync result:', result);

      // Stop the indeterminate animation and finish
      if (syncProgressIntervalRef.current) { clearInterval(syncProgressIntervalRef.current); syncProgressIntervalRef.current = null; }
      setSyncProgress(100);
      if (result.success) {
        setSyncStatus('success');
        console.log('✅ Data synced successfully to cloud');
      } else {
        setSyncStatus('error');
        console.error('❌ Manual sync failed:', result.error || 'sub-operations failed');
        try { console.error('Sub-results:', result.results); } catch (e) { console.error('Sub-results unavailable', e); }
      }

      // keep the success/error state visible briefly, then reset
      setTimeout(() => {
        setIsSyncing(false);
        setSyncStatus('idle');
        setSyncProgress(0);
      }, 1400);
    } catch (error) {
      if (syncProgressIntervalRef.current) { clearInterval(syncProgressIntervalRef.current); syncProgressIntervalRef.current = null; }
      console.error('Manual sync failed:', error);
      setSyncProgress(100);
      setSyncStatus('error');
      setTimeout(() => {
        setIsSyncing(false);
        setSyncStatus('idle');
        setSyncProgress(0);
      }, 1600);
    }
  };

  // Cleanup sync interval on unmount
  useEffect(() => {
    return () => {
      if (syncProgressIntervalRef.current) clearInterval(syncProgressIntervalRef.current);
      syncProgressIntervalRef.current = null;
    };
  }, []);

  const handleToggleSidebar = () => {
    if (showFolderModal || showNoteModal || showDeckModal || renamingItem || itemToDelete) return;
    setIsSidebarOpen(!isSidebarOpen);
  };

  useEffect(() => {
    const handleTimerFinish = (e) => {
        setIsToolsPanelOpen(true); 
        const { message, notificationType } = e.detail;
        setTimerModalMessage(message);
        setShowTimerModal(true);
    };
    document.addEventListener('timerFinish', handleTimerFinish);
    return () => { document.removeEventListener('timerFinish', handleTimerFinish); };

    // Close snake game modal when break time ends
    useEffect(() => {
      if (props.timerMode !== 'BREAK' && showSnakeModal) {
        setShowSnakeModal(false);
      }
    }, [props.timerMode, showSnakeModal]);
  }, []);

  return (
    <div className="mode-container study-mode-layout">
      <AnimatePresence>
        {showFolderModal && <AestheticModal key="folderModal" icon={<Folder size={24} />} title="New Folder" placeholder="Folder Name..." hasColorPicker onClose={() => setShowFolderModal(false)} onCreate={handleFolderCreate} />}
        {showNoteModal && <AestheticModal key="noteModal" icon={<FilePenLine size={24} />} title="New Document" placeholder="Note Title..." hasColorPicker onClose={() => setShowNoteModal(false)} onCreate={handleNoteCreate} />}
        {showDeckModal && <AestheticModal key="deckModal" icon={<Layers size={24} />} title="New Flashcard Deck" placeholder="Deck Name..." hasColorPicker onClose={() => setShowDeckModal(false)} onCreate={handleCreateDeck} />}
        {renamingItem && <AestheticModal key="renameModal" icon={<Edit2 size={24} />} title={`Rename`} placeholder={renamingItem.name} initialValue={renamingItem.name} initialColor={renamingItem.color} hasColorPicker={true} onClose={() => setRenamingItem(null)} onCreate={handleRenameSubmit} />}
        {itemToDelete && <ConfirmationModal onClose={() => setItemToDelete(null)} onConfirm={confirmDelete} />}
        {showTimerModal && <TimerNotificationModal key="timerModal" message={timerModalMessage} onClose={() => setShowTimerModal(false)} />}
        
        {showHistoryModal && (
          <FocusHistoryModal 
            records={props.dailyFocusRecords} 
            onClose={() => setShowHistoryModal(false)} 
            theme={props.theme}
            onClearHistory={props.onClearHistory} // <-- PASS THIS PROP
            user={props.user}
            flowTier={flowTier}
          />
        )}
        

        {showTodoModal && (
            <TodoListModal 
                onClose={() => setShowTodoModal(false)}
                todos={props.todos}
                setTodos={props.setTodos}
                theme={props.theme}
            />
        )}
        
        {props.timerMode === 'BREAK' && showSnakeModal && (
          <motion.div 
            className="modal-overlay" 
            onClick={() => setShowSnakeModal(false)}
            initial={{ opacity: 0 }} 
            animate={{ opacity: 1 }} 
            exit={{ opacity: 0 }}
          >
            <motion.div 
              className={`todo-modal theme-${props.theme}`}
              style={{ maxWidth: '560px', width: '78%', height: '72vh', padding: 0 }}
              onClick={(e) => e.stopPropagation()}
              initial={{ scale: 0.92, opacity: 0, y: 10 }} 
              animate={{ scale: 1, opacity: 1, y: 0 }} 
              exit={{ scale: 0.92, opacity: 0, y: 10 }}
              transition={{ duration: 0.25 }}
            >
              <div className="todo-modal-header" style={{ background: '#4338ca', borderBottom: '1px solid #4338ca' }}>
                <h2 style={{ display: 'flex', alignItems: 'center', gap: '10px', margin: 0, color: '#fff' }}>
                  <Gamepad2 size={24} /> BreakSnake.
                </h2>
                <motion.button
                  className="close-modal-btn"
                  onClick={() => setShowSnakeModal(false)}
                  whileHover={{ scale: 1.05 }}
                  whileTap={{ scale: 0.95 }}
                  style={{ color: '#e0e7ff' }}
                >
                  <X size={24} />
                </motion.button>
              </div>

              <div className="todo-modal-content" style={{ padding: 0, flex: 1, overflow: 'hidden' }}>
                <div style={{ flex: 1, minHeight: 0, padding: '8px' }}>
                  <SnakeGame theme={props.theme} />
                </div>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      <motion.div className={`sidebar ${!isSidebarOpen ? 'closed' : ''}`}>
        <div ref={fileNavRef} style={{ width: 260, padding: 20, height: '100%', display: 'flex', flexDirection: 'column' }}>
          <div className="sidebar-header" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '15px' }}>
            <span>LIBRARY</span>
            <button 
              onClick={handleToggleSidebar}
              className="sidebar-close-btn"
              style={{
                padding: '10px',
                borderRadius: '10px',
                backgroundColor: props.theme === 'dark' ? '#1f2937' : 'white',
                color: props.theme === 'dark' ? '#818cf8' : '#4f46e5',
                border: props.theme === 'dark' ? '2px solid #4f46e5' : '2px solid #e0e7ff',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                boxShadow: props.theme === 'dark' ? '0 4px 12px rgba(79, 70, 229, 0.15)' : '0 4px 12px rgba(0, 0, 0, 0.08)',
                transition: 'all 0.2s ease'
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.boxShadow = '0 8px 20px rgba(79, 70, 229, 0.3)';
                e.currentTarget.style.backgroundColor = props.theme === 'dark' ? '#374151' : '#f9fafb';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.boxShadow = props.theme === 'dark' ? '0 4px 12px rgba(79, 70, 229, 0.15)' : '0 4px 12px rgba(0, 0, 0, 0.08)';
                e.currentTarget.style.backgroundColor = props.theme === 'dark' ? '#1f2937' : 'white';
              }}
              title="Close Sidebar"
            >
              <PanelLeftClose size={24} />
            </button>
          </div>
          
          {/* User Section */}
          {props.user && (
            <div style={{
              padding: '10px 12px',
              borderRadius: '6px',
              backgroundColor: '#4338ca',
              marginBottom: '15px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              fontSize: '0.85rem',
              color: 'white'
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', minWidth: 0 }}>
                <User size={16} style={{ flexShrink: 0, color: 'white' }} />
                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: 'white', fontWeight: 'bold' }}>
                  {props.username}
                </span>
              </div>
              <button
                onClick={props.onLogout}
                style={{
                  background: 'none',
                  border: 'none',
                  cursor: 'pointer',
                  padding: '4px',
                  display: 'flex',
                  alignItems: 'center',
                  color: '#fca5a5',
                  flexShrink: 0,
                  transition: 'all 0.2s ease'
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.color = '#ef4444';
                  e.currentTarget.style.filter = 'drop-shadow(0 0 8px #ef4444)';
                  e.currentTarget.style.transform = 'scale(1.1)';
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.color = '#fca5a5';
                  e.currentTarget.style.filter = 'drop-shadow(0 0 0px rgba(0,0,0,0))';
                  e.currentTarget.style.transform = 'scale(1)';
                }}
                title="Logout"
              >
                <LogOut size={16} />
              </button>
            </div>
          )}
          
          <button className="btn-back-small" onClick={props.goBack} title="Back to Main Menu"><ArrowLeft size={18} /></button>
          <div className="folder-nav-header">
             <span className="current-location">{props.currentFolder.id === 'root' ? 'Home' : props.currentFolder.name}</span>
             {props.currentPath.length > 1 && (<button className="btn-icon-sm" onClick={props.onNavigateUp} title="Go Up"><ArrowUpLeft size={16} /></button>)}
          </div>
          <div className="folder-list">
            {props.currentFolder.children.length === 0 && props.currentFolder.files.length === 0 && (<div className="empty-state">Empty Folder</div>)}
            {props.currentFolder.children.map(child => (
              <motion.div layout key={child.id} className="folder-item" onClick={() => props.onNavigate(child.id)} transition={smoothTransition}>
                <div style={{display:'flex', alignItems:'center', gap:'10px'}}>
                  <Folder size={16} fill={child.color || '#6366f1'} style={{ color: child.color || '#6366f1' }} className="folder-icon-filled"/>
                  <span className="folder-name">{child.name}</span> 
                </div>
                <button className="btn-icon-sm" onClick={(e) => { e.stopPropagation(); setRenamingItem({ type:'folder', id: child.id, name: child.name, color: child.color }); }}><Edit2 size={12} /></button>
              </motion.div>
            ))}
            {props.currentFolder.files.map(file => (
              <motion.div layout key={file.id} className={`folder-item ${props.activeFile && props.activeFile.id === file.id ? 'active-file-item' : ''}`} onClick={() => handleOpenFile(file)} transition={smoothTransition}>
                 <div style={{display:'flex', alignItems:'center', gap:'10px'}}>
                   {file.type === 'note' ? <FilePenLine size={16} style={{color: file.color || '#6366f1'}}/> : file.type === 'deck' ? <Layers size={16} style={{color: file.color || '#8b5cf6'}}/> : <FileText size={16} style={{color: file.color || '#ef4444'}}/>}
                   <span className="folder-name">{file.name}</span> 
                 </div>
                 <button className="btn-icon-sm" onClick={(e) => { e.stopPropagation(); setRenamingItem({ type:'file', id: file.id, name: file.name, color: file.color }); }}><Edit2 size={12} /></button>
              </motion.div>
            ))}
          </div>
          <div className="sidebar-actions" style={{display:'flex', flexDirection:'column', gap:'8px', marginTop:'12px'}}>
            <button ref={folderRef} className="btn-add-folder" onClick={() => setShowFolderModal(true)}><Plus size={16} /> Folder</button>
            <button 
              className="btn-add-folder" 
              onClick={() => setShowNoteModal(true)}
              title="New Document"
            >
              <FilePenLine size={16} /> Notes
            </button>
            <button 
              ref={deckRef}
              className="btn-add-folder" 
              onClick={() => setShowDeckModal(true)}
              title="New Flashcard Deck"
            >
              <Layers size={16} /> Deck
            </button>
          </div>
        </div>
      </motion.div>

      <AnimatePresence>{!isSidebarOpen && (<motion.div className="sidebar-trigger" onClick={() => setIsSidebarOpen(true)} initial={{ opacity: 0, scale: 0 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0 }} transition={{ duration: 0.2 }}><PanelLeftOpen size={24} /></motion.div>)}</AnimatePresence>

      <motion.div className="study-content" layout>
        <div className={`toolbar ${!isSidebarOpen ? 'padded-left' : ''}`} style={{alignItems:'center'}}>
           <div className="toolbar-left">
             <div className="breadcrumbs">
                {props.currentPath.map((id, index) => (<span key={id} className="crumb" onClick={() => props.onBreadcrumbClick(index)}>{index === 0 ? <Home size={14}/> : '/'}{index === props.currentPath.length - 1 ? (props.currentFolder.id==='root'?'':props.currentFolder.name) : ''}</span>))}
             </div>
             <div className="btn-with-tooltip">
 
              {/* Cloud sync progress indicator */}
              {(isSyncing || syncStatus !== 'idle') && (
                <div className={`cloud-sync-indicator ${syncStatus === 'error' ? 'error' : syncStatus === 'success' ? 'success' : ''}`} title={syncStatus === 'in-progress' ? `Syncing: ${Math.round(syncProgress)}%` : syncStatus === 'success' ? 'Sync complete' : 'Sync failed'} style={{ display: 'flex', alignItems: 'center', gap: 8, marginLeft: 8 }}>
                  <div className="cloud-sync-bar" aria-hidden style={{ width: 120, height: 8, background: '#e6e9f8', borderRadius: 6, overflow: 'hidden' }}>
                    <div className="cloud-sync-fill" style={{ width: `${Math.max(0, Math.min(100, syncProgress || 0))}%`, height: '100%', background: syncStatus === 'error' ? '#ef4444' : syncStatus === 'success' ? '#10b981' : '#6366f1', transition: 'width 260ms linear' }} />
                  </div>
                  <div className="cloud-sync-label" style={{ fontSize: '0.85rem', color: syncStatus === 'error' ? '#ef4444' : syncStatus === 'success' ? '#10b981' : '#4b5563' }}>
                    {syncStatus === 'in-progress' ? `${Math.round(syncProgress || 0)}%` : syncStatus === 'success' ? 'Done' : syncStatus === 'error' ? 'Failed' : ''}
                  </div>
                </div>
              )}
             </div>
             <button onClick={cycleTheme} className="btn-tool theme-btn">{getThemeIcon()}</button>
                <button ref={splitRef} onClick={handleToggleSplit} className="btn-tool">{splitMode ? <Columns2 size={16}/> : <Columns2 size={16}/>}</button>
             <button onClick={props.toggleFullScreen} className="btn-tool">{props.isFullscreen ? <Minimize size={16}/> : <Maximize size={16}/>}</button>
             <button
               className="help-btn help-btn-workspace"
               style={{ position: 'static', marginLeft: 12 }}
               onClick={() => setShowTour(s => !s)}
               title={showTour ? 'Hide guide' : 'Show guide'}
             >
               ?
             </button>
           </div>
           {isToolsPanelOpen && <button onClick={() => setIsToolsPanelOpen(false)} className="btn-tool primary-tool"><PanelRightClose size={16} /> </button>}
        </div>

        <AnimatePresence mode="wait">
          {!splitMode ? (
            leftFile ? (
              leftFile.type === 'note' ? (
                <motion.div key={`editor-${leftFile.id}`} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }} transition={{ duration: 0.3 }} style={{flex:1, minHeight:0, overflow:'hidden', display:'flex', flexDirection:'column'}}>
                  <RichDocEditor file={props.currentFolder.files.find(f => f.id === leftFile.id) || leftFile} onUpdate={(val) => props.onUpdateNote(leftFile.id, val)} onClose={() => props.setActiveFile(null)} theme={props.theme} />
                </motion.div>
              ) : leftFile.type === 'deck' ? (
                <motion.div key={`deck-${leftFile.id}`} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }} transition={{ duration: 0.3 }} style={{flex:1, minHeight:0, overflow:'hidden', display:'flex', flexDirection:'column'}}>
                  <FlashcardDeck file={leftFile} onUpdate={(content) => props.onUpdateNote(leftFile.id, content)} theme={props.theme} onClose={() => props.setActiveFile(null)} />
                </motion.div>
              ) : (
                <motion.div key={`reader-${leftFile.id}`} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }} transition={{ duration: 0.3 }} style={{flex:1, minHeight:0, overflow:'hidden', display:'flex', flexDirection:'column'}}>
                  <AestheticPDFReader file={leftFile} onUpdateMeta={props.onUpdateFileMeta} onClose={() => { setLeftFile(null); props.setActiveFile(null); }} user={props.user} splitMode={splitMode} />
                </motion.div>
              )
            ) : (
              <motion.div key={props.currentFolder.id} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }} transition={{ duration: 0.3 }} style={{flex:1, minHeight:0, overflow:'hidden', display:'flex', flexDirection:'column'}}>
                <FileBrowser currentFolder={props.currentFolder} rootFolder={props.rootFolder} onNavigate={props.onNavigate} setRootFolder={props.setRootFolder} updateFolderTree={props.updateFolderTree} currentFolderId={props.currentFolderId} onRenameRequest={(item) => setRenamingItem(item)} onDeleteRequest={(id) => setItemToDelete(id)} theme={props.theme} onSelectFile={(file) => handleOpenFile(file)} user={user} />
              </motion.div>
            )
          ) : (
            <motion.div key="splitview" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }} transition={{ duration: 0.3 }} style={{flex:1, minHeight:0, display:'flex', gap: '12px', overflow:'hidden'}}>
              <div className="split-pane" style={{flex: 1, display:'flex', flexDirection:'column', minWidth:0, minHeight:0}}>
                <div style={{display:'flex', alignItems:'center', justifyContent:'space-between', padding:'8px 12px', borderBottom:'1px solid #e5e7eb', flex:'0 0 auto'}}>
                  <div style={{fontWeight:600}}>{leftFile ? leftFile.name : 'Left: File Browser'}</div>
                  {/* removed Focus/Close header buttons in split view per UX request */}
                </div>
                <div className="pane-content" style={{flex:1, minWidth:0, minHeight:0}}>
                  {leftFile ? (
                    leftFile.type === 'note' ? (
                      <div style={{height:'100%', width:'100%', overflow:'hidden', display:'flex', flexDirection:'column'}}>
                        <RichDocEditor file={props.currentFolder.files.find(f => f.id === leftFile.id) || leftFile} onUpdate={(val) => props.onUpdateNote(leftFile.id, val)} onClose={() => setLeftFile(null)} theme={props.theme} />
                      </div>
                    ) : leftFile.type === 'deck' ? (
                      <div style={{height:'100%', width:'100%', overflow:'hidden', display:'flex', flexDirection:'column'}}>
                        <FlashcardDeck file={leftFile} onUpdate={(content) => props.onUpdateNote(leftFile.id, content)} theme={props.theme} onClose={() => setLeftFile(null)} />
                      </div>
                    ) : (
                      <AestheticPDFReader file={leftFile} onUpdateMeta={props.onUpdateFileMeta} onClose={() => setLeftFile(null)} user={props.user} splitMode={splitMode} />
                    )
                  ) : (
                    <FileBrowser currentFolder={props.currentFolder} rootFolder={props.rootFolder} onNavigate={props.onNavigate} setRootFolder={props.setRootFolder} updateFolderTree={props.updateFolderTree} currentFolderId={props.currentFolderId} onRenameRequest={(item) => setRenamingItem(item)} onDeleteRequest={(id) => setItemToDelete(id)} theme={props.theme} onSelectFile={(file) => handleOpenFile(file, { side: 'left' })} user={user} />
                  )}
                </div>
              </div>
              <div className="split-pane" style={{flex: 1, display:'flex', flexDirection:'column', minWidth:0, minHeight:0}}>
                <div style={{display:'flex', alignItems:'center', justifyContent:'space-between', padding:'8px 12px', borderBottom:'1px solid #e5e7eb', flex:'0 0 auto'}}>
                  <div style={{fontWeight:600}}>{rightFile ? rightFile.name : 'Right: File Browser'}</div>
                  {/* removed Focus/Close header buttons in split view per UX request */}
                </div>
                <div className="pane-content" style={{flex:1, minWidth:0, minHeight:0}}>
                  {rightFile ? (
                    rightFile.type === 'note' ? (
                      <div style={{height:'100%', width:'100%', overflow:'hidden', display:'flex', flexDirection:'column'}}>
                        <RichDocEditor file={props.currentFolder.files.find(f => f.id === rightFile.id) || rightFile} onUpdate={(val) => props.onUpdateNote(rightFile.id, val)} onClose={() => setRightFile(null)} theme={props.theme} />
                      </div>
                    ) : rightFile.type === 'deck' ? (
                      <div style={{height:'100%', width:'100%', overflow:'hidden', display:'flex', flexDirection:'column'}}>
                        <FlashcardDeck file={rightFile} onUpdate={(content) => props.onUpdateNote(rightFile.id, content)} theme={props.theme} onClose={() => setRightFile(null)} />
                      </div>
                    ) : (
                      <AestheticPDFReader file={rightFile} onUpdateMeta={props.onUpdateFileMeta} onClose={() => setRightFile(null)} user={props.user} splitMode={splitMode} />
                    )
                  ) : (
                    <FileBrowser currentFolder={props.currentFolder} rootFolder={props.rootFolder} onNavigate={props.onNavigate} setRootFolder={props.setRootFolder} updateFolderTree={props.updateFolderTree} currentFolderId={props.currentFolderId} onRenameRequest={(item) => setRenamingItem(item)} onDeleteRequest={(id) => setItemToDelete(id)} theme={props.theme} onSelectFile={(file) => handleOpenFile(file, { side: 'right' })} user={user} />
                  )}
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
        <AnimatePresence>{!isToolsPanelOpen && (<motion.div className="tools-panel-trigger" onClick={() => setIsToolsPanelOpen(true)} initial={{ opacity: 0, scale: 0.8 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.8 }} transition={{ duration: 0.2 }}><PanelRightOpen size={16} /> Tools</motion.div>)}</AnimatePresence>
      </motion.div>

      <motion.div className={`tools-panel ${!isToolsPanelOpen ? 'closed' : ''}`} initial={{ x: 100, opacity: 0 }} animate={{ x: 0, opacity: 1 }} transition={{ duration: 0.5, ease: "easeOut", delay: 0.1 }}>
        <div className="stats-row">
            <span style={{display:'flex', alignItems:'center', gap:'8px', flexGrow:1}}>
              <span style={{display:'flex', alignItems:'center', gap:'4px'}}>
                <Trophy size={16} className="text-gold"/>
                <span>Focus: {getTodayMinutes()}m</span>
                <button className="btn-icon-xs focus-stats-btn" onClick={() => {
                  setShowHistoryModal(true);
                }} style={{background: 'transparent', border:'none', cursor: 'pointer', color: '#6366f1', marginLeft:'2px', position:'relative'}}>
                  <span ref={statsRef}><BarChart3 size={18} /></span>
                </button>
              </span>
              <button className="btn-icon-xs todo-list-btn" onClick={() => {
                setShowTodoModal(true);
              }} style={{background: 'transparent', border:'none', cursor: 'pointer', color: '#6366f1', position:'relative'}}>
                <span ref={todoRef}><ListTodo size={18} /></span>
              </button>
              {(props.timerMode === 'BREAK' || showTour) && (
                <button ref={snakeRef} className="btn-icon-xs" onClick={() => props.timerMode === 'BREAK' && setShowSnakeModal(true)} style={{background: 'transparent', border:'none', cursor: showTour ? 'default' : 'pointer', color: '#818cf8', pointerEvents: showTour ? 'none' : 'auto'}}>
                  <Gamepad2 size={18} />
                </button>
              )}
            </span>
        </div>

        <div className="tool-box">
           <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
             <h3 style={{ margin: 0 }}>{props.timerMode}</h3>
             {props.activeTag && (
               <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginLeft: 6 }}>
                 <div style={{ width: 12, height: 12, borderRadius: 4, background: props.activeTag.color, boxShadow: `0 1px 3px ${props.activeTag.color}33` }} />
                 <div style={{ fontSize: '0.95rem', fontWeight: 700, color: props.activeTag.color, maxWidth: 140, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{props.activeTag.name}</div>
               </div>
             )}
           </div>
           <div className="timer-display">{Math.floor(props.timeLeft / 60)}:{(props.timeLeft % 60).toString().padStart(2, '0')}</div>
           <div className="timer-controls">
             <button
               ref={timerRef}
               onClick={() => props.setIsActive(!props.isActive)}
               className={props.isActive ? 'btn-pause' : 'btn-start'}
               disabled={props.timerMode === 'BREAK'}
               title={props.timerMode === 'BREAK' ? 'Disabled during break' : (props.isActive ? 'Pause' : 'Start')}
               style={{ cursor: props.timerMode === 'BREAK' ? 'not-allowed' : 'pointer', opacity: props.timerMode === 'BREAK' ? 0.6 : 1 }}
             >
               {props.isActive ? <Pause size={16} fill="currentColor"/> : <Play size={16} fill="currentColor"/>}
             </button>
             <button onClick={() => {
               props.setIsActive(false);
               props.setTimeLeft(props.devQuickCycle ? 6 : props.workDuration * 60);
               props.setTimerMode('WORK');
             }} className="btn-reset"><RotateCcw size={16}/></button>
             <button 
               onClick={() => props.togglePiP()} 
               className="btn-pip"
               title={props.isPiPActive ? "Close pop-out timer" : "Open pop-out timer"}
               style={props.isPiPActive ? { background: '#4338ca', color: '#fff', border: 'none' } : undefined}
             >
               <ExternalLink size={16}/>
             </button>
             {/* Tag Session Button for Flow users - now a simple icon in timer controls */}
             {props.flowTier === 'flow' && (
                 <button
                 className="tag-session-btn"
                 style={{ marginLeft: 8, background: 'none', color: props.activeTag?.color || '#6366f1', border: 'none', borderRadius: 6, padding: 4, display: 'inline-flex', alignItems: 'center' }}
                 onClick={() => props.setShowTagModal(true)}
                 title={props.activeTag ? `Current tag: ${props.activeTag.name}` : 'Tag this session'}
               >
                 <Tag size={18} />
               </button>
             )}
           </div>
           <div className="auto-restart-toggle" style={{ marginTop: '12px', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '10px', fontSize: '0.85rem', flexWrap: 'wrap' }}>
             <span style={{display:'flex', alignItems:'center', gap:'6px'}}>
               <input 
                 type="checkbox" 
                 id="auto-restart-toggle"
                 checked={props.autoRestartCycle}
                 onChange={(e) => props.setAutoRestartCycle(e.target.checked)}
                 style={{ cursor: 'pointer', accentColor: '#6366f1' }}
               />
               <label htmlFor="auto-restart-toggle" style={{ cursor: 'pointer', color: '#64748b', userSelect: 'none' }}>
                 Loop Focus Cycles
               </label>
             </span>
            
           </div>
        </div>
        {!props.isActive && (
           <div className="tool-box sliders-box">
             <label>Focus: {props.workDuration}m</label>
             <input type="range" min="5" max="60" step="5" value={props.workDuration} onChange={(e) => {props.setWorkDuration(parseInt(e.target.value)); if(!props.isActive && props.timerMode === 'WORK') props.setTimeLeft(parseInt(e.target.value)*60);}} />
             <label>Break: {props.breakDuration}m</label>
             <input type="range" min="5" max="30" step="5" value={props.breakDuration} onChange={(e) => {props.setBreakDuration(parseInt(e.target.value)); if(!props.isActive && props.timerMode === 'BREAK') props.setTimeLeft(parseInt(e.target.value)*60);}} />
           </div>
        )}
           <div className="tool-box music-box">
           <h3 ref={soundRef}>Soundscape Mixer</h3>
           <div className="mixer-group">
             <span className="mixer-label"></span>

             {/* Single grid containing Group A then a spacer then Group B */}
             {/* Group A: buttons + its slider */}
             <div className="vibe-grid vibe-grid-a">
                {GROUP_A.map((track, idx) => {
                  return (
                    <button 
                      key={track.id} 
                      className={`vibe-btn vibe-${track.id} ${props.trackA === track.id ? 'active' : ''}`} 
                      onClick={() => {
                        props.setTrackA(props.trackA === track.id ? null : track.id);
                      }}
                      title={track.label}
                    >
                      {track.icon} <span>{track.label}</span>
                    </button>
                  );
                })}
             </div>

             {/* Slider for Group A, shown beneath its section */}
             {props.trackA && (
               <div className="volume-control group-volume group-a-volume" style={{ marginTop: 12 }}>
                 <Volume2 size={16} />
                 <input type="range" min="0" max="1" step="0.01" value={props.volA} onChange={(e) => props.setVolA(parseFloat(e.target.value))} />
               </div>
             )}

             {/* spacer between sections */}
             <div className="vibe-spacer" aria-hidden="true" />

             {/* Group B: buttons + its slider */}
             <div className="vibe-grid vibe-grid-b">
                {GROUP_B.map((track, idx) => {
                  return (
                    <button 
                      key={track.id} 
                      className={`vibe-btn vibe-${track.id} ${props.trackB === track.id ? 'active' : ''}`} 
                      onClick={() => {
                        props.setTrackB(props.trackB === track.id ? null : track.id);
                      }}
                      title={track.label}
                    >
                      {track.icon} <span>{track.label}</span>
                    </button>
                  );
                })}
             </div>

             {/* Slider for Group B, shown beneath its section */}
             {props.trackB && (
               <div className="volume-control group-volume group-b-volume" style={{ marginTop: 12 }}>
                 <Volume2 size={16} />
                 <input type="range" min="0" max="1" step="0.01" value={props.volB} onChange={(e) => props.setVolB(parseFloat(e.target.value))} />
               </div>
             )}
           </div>
        </div>
      </motion.div>
      {showTour && (() => {
        const current = tourSteps[tourStep];
        if (!current) return null;
        return (
          <TourTooltip
            key={current.key}
            targetRef={current.ref}
            text={current.text}
            icon={current.icon}
            title={current.title}
            theme={props.theme}
            center={!current.ref}
            onSkip={completeTour}
            onNext={() => {
              const next = tourStep + 1;
              if (next >= tourSteps.length) completeTour();
              else setTourStep(next);
            }}
          />
        );
      })()}
    </div>
  );
}

// ReNoteMode Component
function ReNoteMode({ goBack, goToStudy }) {
  const [notes, setNotes] = useState("");
  const [aiResponse, setAiResponse] = useState("");
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    mermaid.initialize({ startOnLoad: true, theme: 'neutral' });
  }, []);

  const callAI = async (type) => {
    if (!OPENAI_API_KEY || OPENAI_API_KEY.includes("PASTE")) {
      alert("Add API Key first!");
      return;
    }
    setIsLoading(true);
    const systemPrompt = type === 'flowchart' 
      ? "Create valid Mermaid.js flowchart code. Return ONLY code starting with 'graph TD'." 
      : "Summarize these notes into clear, structured bullet points using Markdown.";
      
    try {
      const response = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${OPENAI_API_KEY}`
        },
        body: JSON.stringify({
          model: "gpt-4o",
          messages: [{ role: "system", content: systemPrompt }, { role: "user", content: notes }]
        })
      });
      const data = await response.json();
      const content = data?.choices?.[0]?.message?.content || 'No response';
      setAiResponse(content);
      
      if (type === 'flowchart') {
        setTimeout(() => {
          const el = document.getElementById("mermaid-chart");
          if (el) {
            el.removeAttribute("data-processed");
            mermaid.render('graphDiv', content).then(({ svg }) => el.innerHTML = svg);
          }
        }, 100);
      }
    } catch (error) {
      setAiResponse("Error: " + error.message);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="mode-container renote-layout">
      <header className="header">
        <button onClick={goBack} className="btn-back"><ChevronLeft size={16} /> Menu</button>
        <h1 style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <PenTool size={24} /> ReNote AI Coach
        </h1>
        <button onClick={goToStudy} className="btn-tool primary-tool">
          <LibraryBig size={16} /> Go to Study
        </button>
      </header>
      <div className="main-grid">
        <div className="card editor-card">
          <textarea value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Paste notes here..." />
          <div className="action-row">
            <button disabled={isLoading} onClick={() => callAI('summary')}>📝 Summarize</button>
            <button disabled={isLoading} onClick={() => callAI('flowchart')}>🔀 Flowchart</button>
          </div>
        </div>
        <div className="card output-card">
          {aiResponse ? (
            <div className="output-content">
              {aiResponse.includes("graph TD") ? <div id="mermaid-chart"></div> : <div className="text-output">{aiResponse}</div>}
            </div>
          ) : (
            <div className="placeholder-text">AI output appears here...</div>
          )}
        </div>
      </div>
    </div>
  );
}

// AestheticPDFReader Component
function AestheticPDFReader({ file, onUpdateMeta, onClose, user, splitMode }) {
  const [numPages, setNumPages] = useState(null);
  const [scale, setScale] = useState(1.0);
  const [inputVal, setInputVal] = useState("");
  const [pdfUrl, setPdfUrl] = useState(null);
  const [isLoading, setIsLoading] = useState(false);
  const [currentPage, setCurrentPage] = useState(1);
  const scrollContainerRef = useRef(null);
  const scrollTimeoutRef = useRef(null);
  const pdfNavRef = useRef(null);

  // Load PDF from base64 (persisted) or blob (fresh upload) or Cloud Storage
  useEffect(() => {
    setIsLoading(true);
    
    // 1. Try to use base64 data (persisted PDFs survive page reload)
    if (file.base64) {
      try {
        setPdfUrl(file.base64);
        setIsLoading(false);
        return;
      } catch (err) {
        console.error('Failed to use base64 PDF:', err);
      }
    }

    // 2. Try to use blob (fresh uploads in current session)
    if (file.blob && file.blob instanceof Blob) {
      try {
        const url = URL.createObjectURL(file.blob);
        setPdfUrl(url);
        setIsLoading(false);
        return;
      } catch (err) {
        console.error('Failed to create blob URL from file.blob:', err);
      }
    }

    // 3. Try to download from Cloud Storage (for new sessions or failed base64/blob)
    if (!user || !file.name || !file.folderId) {
      setIsLoading(false);
      return;
    }
    
    console.log(`Downloading PDF from Cloud Storage: ${file.name}`);
    downloadPdfFromCloud(user.uid, file.folderId, file.name)
      .then(result => {
        console.log('Download result:', result);
        if (result.success && result.blob) {
          try {
            const url = URL.createObjectURL(result.blob);
            setPdfUrl(url);
            console.log('PDF loaded from Cloud Storage');
          } catch (err) {
            console.error('Failed to create blob URL from Cloud Storage:', err);
          }
        } else {
          console.error('Failed to download PDF from Cloud Storage:', result.error);
        }
        setIsLoading(false);
      })
      .catch(err => {
        console.error('Exception downloading PDF from cloud:', err);
        setIsLoading(false);
      });
  }, [file.base64, file.blob, file.name, file.folderId, user]);

  function onDocumentLoadSuccess({ numPages }) { 
    setNumPages(numPages); 
    if (file.scrollTop && scrollContainerRef.current) {
      setTimeout(() => { scrollContainerRef.current.scrollTop = file.scrollTop; }, 100);
    }
  }

  const handleScroll = () => {
    if (scrollContainerRef.current) {
      const top = scrollContainerRef.current.scrollTop;
      
      // Save scroll position
      if (scrollTimeoutRef.current) clearTimeout(scrollTimeoutRef.current);
      scrollTimeoutRef.current = setTimeout(() => {
        // Persist both scrollTop and the current visible page so we can restore exactly
        onUpdateMeta(file.id, { scrollTop: top, currentPage });
      }, 500);
      
      // Find which page is currently visible (top of viewport)
      const pages = scrollContainerRef.current.querySelectorAll('[data-page-number]');
      if (pages.length > 0) {
        const containerRect = scrollContainerRef.current.getBoundingClientRect();
        const containerCenterY = containerRect.top + containerRect.height / 2;
        let bestPage = null;
        let bestDistance = Infinity;
        for (let i = 0; i < pages.length; i++) {
          const pageRect = pages[i].getBoundingClientRect();
          const pageCenterY = pageRect.top + pageRect.height / 2;
          const dist = Math.abs(pageCenterY - containerCenterY);
          if (dist < bestDistance) {
            bestDistance = dist;
            bestPage = pages[i];
          }
        }
        if (bestPage) {
          const pageNum = parseInt(bestPage.getAttribute('data-page-number'));
          if (pageNum !== currentPage) {
            setCurrentPage(pageNum);
            setInputVal(pageNum.toString());
          }
        }
      }
    }
  };

  useEffect(() => {
    const container = scrollContainerRef.current;
    if (!container) return;
    const wheelOptions = { passive: false, capture: true };
    const handleWheel = (e) => {
      if (e.ctrlKey || e.metaKey) {
        e.preventDefault();
        const delta = e.deltaY * -0.002; 
        setScale(s => Math.min(Math.max(0.5, s + delta), 3.0));
        return;
      }
      // Let native scrolling handle two-finger trackpad gestures for smoother speed
    };
    container.addEventListener('wheel', handleWheel, wheelOptions);
    return () => { container.removeEventListener('wheel', handleWheel, wheelOptions); };
  }, []);

  const jumpToPage = (e) => {
    if (e.key === 'Enter') {
      const pageNum = parseInt(inputVal);
      if (pageNum >= 1 && pageNum <= numPages) {
        const pages = scrollContainerRef.current?.querySelectorAll('[data-page-number]');
        if (pages && pages.length > 0) {
          for (let i = 0; i < pages.length; i++) {
            if (parseInt(pages[i].getAttribute('data-page-number')) === pageNum) {
              // Use immediate jump so the scroll position is stable when we persist
              pages[i].scrollIntoView({ behavior: 'auto', block: 'start' });
              setCurrentPage(pageNum);
              // Persist the manual page jump immediately so toggling views preserves it
              try { onUpdateMeta(file.id, { currentPage: pageNum, scrollTop: scrollContainerRef.current?.scrollTop || 0 }); } catch (err) { console.error('Failed to persist page jump:', err); }
              break;
            }
          }
        }
      }
    }
  };

  // Restore saved current page after the document renders pages
  useEffect(() => {
    if (!numPages) return;
    const savedPage = file.currentPage || file.savedPage || null;
    if (savedPage && scrollContainerRef.current) {
      // Wait a tick for pages to render then scroll to the saved page
      setTimeout(() => {
        const target = scrollContainerRef.current.querySelector(`[data-page-number='${savedPage}']`);
        if (target) target.scrollIntoView({ behavior: 'auto', block: 'start' });
      }, 50);
    }
  }, [numPages, file.currentPage, file.savedPage]);

  // Persist immediately when splitMode changes so quick toggles don't lose position
  useEffect(() => {
    try {
      const lastTop = scrollContainerRef.current?.scrollTop || 0;
      onUpdateMeta(file.id, { scrollTop: lastTop, currentPage });
    } catch (err) {
      // ignore
    }
  }, [splitMode]);

  // Persist on pointer/mouse/touch end to capture scrollbar drags and track clicks
  useEffect(() => {
    const persistNow = () => {
      try {
        const lastTop = scrollContainerRef.current?.scrollTop || 0;
        onUpdateMeta(file.id, { scrollTop: lastTop, currentPage });
      } catch (err) {
        // ignore
      }
    };
    window.addEventListener('pointerup', persistNow);
    window.addEventListener('mouseup', persistNow);
    window.addEventListener('touchend', persistNow);
    return () => {
      window.removeEventListener('pointerup', persistNow);
      window.removeEventListener('mouseup', persistNow);
      window.removeEventListener('touchend', persistNow);
    };
  }, [file.id, currentPage]);

  // On unmount ensure we persist last-known scroll and page
  useEffect(() => {
    return () => {
      try {
        const lastTop = scrollContainerRef.current?.scrollTop || 0;
        onUpdateMeta(file.id, { scrollTop: lastTop, currentPage });
      } catch (err) {
        console.error('Failed to persist PDF position on unmount:', err);
      }
    };
  }, [file.id, currentPage]);

  return (
    <div className="aesthetic-reader">
      <div className="reader-header-bar">
        <div className="reader-group-left">
           <div style={{display:'flex', alignItems:'center', gap:'5px', borderRight:'1px solid #e5e7eb', paddingRight:'15px', marginRight:'5px'}}>
              <button onClick={() => setScale(s => Math.max(0.5, s - 0.2))} title="Zoom Out"><ZoomOut size={16}/></button>
              <span style={{fontSize:'0.9rem', width:'40px', textAlign:'center', fontVariantNumeric:'tabular-nums'}}>{(scale * 100).toFixed(0)}%</span>
              <button onClick={() => setScale(s => Math.min(3.0, s + 0.2))} title="Zoom In"><ZoomIn size={16}/></button>
           </div>
           
           <div style={{display:'flex', alignItems:'center', gap:'8px'}}>
              <span style={{fontSize:'0.8rem', color:'#9ca3af'}}>Page</span>
              <input 
                ref={pdfNavRef}
                className="page-jump-input"
                type="number" 
                placeholder="#" 
                value={inputVal}
                onChange={(e) => setInputVal(e.target.value)}
                onKeyDown={jumpToPage}
              />
              <span style={{fontSize:'0.8rem', color:'#9ca3af'}}>/ {numPages || '--'}</span>
           </div>
        </div>
        <button onClick={onClose} style={{color:'#ef4444'}}>
          <X size={16}/>Close
        </button>
      </div>

      <div className="pdf-scroll-container" ref={scrollContainerRef} onScroll={handleScroll}>
        {isLoading && <div style={{padding: '20px', color: '#9ca3af'}}>Loading PDF...</div>}
        {!isLoading && !pdfUrl && (
          <div style={{display:'flex', alignItems:'center', justifyContent:'center', height:'100%', flexDirection:'column', gap:'15px', color: '#ef4444', padding:'20px', textAlign:'center'}}>
            <FileText size={48} />
            <div>
              <p style={{margin:'0 0 10px 0', fontWeight:500, fontSize:'1.1rem'}}>ERROR: PDF URL not loaded</p>
              <p style={{margin:0, fontSize:'0.95rem', lineHeight:'1.5', color: '#6b7280'}}>
                Check console for errors. Ensure PDF uploaded successfully to Cloud Storage.
              </p>
            </div>
          </div>
        )}
        {!isLoading && pdfUrl && (
          <Document 
            file={pdfUrl} 
            onLoadSuccess={onDocumentLoadSuccess}
            onLoadError={(error) => console.error('PDF load error:', error)}
            style={{width: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '0'}}
          >
            {numPages && Array.from(new Array(numPages), (el, index) => (
              <div key={`page_${index + 1}`} data-page-number={index + 1} style={{width: '100%', display: 'flex', justifyContent: 'center', marginBottom: '10px'}}>
                <div style={{maxWidth: '100%', aspectRatio: '8.5/11', overflow: 'hidden', display: 'flex', alignItems: 'center', justifyContent: 'center', backgroundColor: '#f3f4f6', borderRadius: '4px'}}>
                  <Page 
                    pageNumber={index + 1} 
                    scale={scale}
                    renderTextLayer={false}
                    renderAnnotationLayer={false}
                    width={Math.min(800, window.innerWidth - 40)}
                  />
                </div>
              </div>
            ))}
          </Document>
        )}
      </div>
    </div>
  );
}

function ConfirmationModal({ onClose, onConfirm }) {
  return (
    <div className="modal-overlay">
      <motion.div initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }} className="modal-content confirmation-modal">
        <div className="modal-icon-bubble danger-bubble"><AlertTriangle size={32} /></div>
        <h3>Are you sure?</h3><p className="modal-text">This action cannot be undone.</p>
        <div className="modal-btn-row"><button onClick={onClose} className="btn-secondary modal-btn">Cancel</button><button onClick={onConfirm} className="btn-danger modal-btn">Delete</button></div>
      </motion.div>
    </div>
  );
}

function AestheticModal({ icon, title, placeholder, onClose, onCreate, hasColorPicker, initialValue, initialColor }) {
  const [val, setVal] = useState(initialValue || "");
  const [color, setColor] = useState(initialColor || FOLDER_COLORS[0]);
  return (
    <div className="modal-overlay">
      <motion.div initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }} className="modal-content aesthetic-modal">
        <div className="modal-icon-bubble" style={{backgroundColor: hasColorPicker ? color + '20' : '#e0e7ff', color: hasColorPicker ? color : '#4338ca'}}>{icon}</div>
        <h3>{title}</h3>
        <input autoFocus type="text" placeholder={placeholder} value={val} onChange={(e) => setVal(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && val && onCreate(val, color)}/>
        {hasColorPicker && (
          <div className="color-picker-row">{FOLDER_COLORS.map(c => (<button key={c} onClick={() => setColor(c)} className={`color-dot ${color === c ? 'selected' : ''}`} style={{backgroundColor: c}} />))}</div>
        )}
        <div className="modal-btn-row"><button onClick={onClose} className="btn-secondary modal-btn">Cancel</button><button onClick={() => val && onCreate(val, color)} className="btn-primary modal-btn" style={{backgroundColor: hasColorPicker ? color : null}}>Confirm</button></div>
      </motion.div>
    </div>
  );
}

function FileBrowser({ currentFolder, rootFolder, onNavigate, setRootFolder, updateFolderTree, currentFolderId, onSelectFile, onRenameRequest, onDeleteRequest, theme, user }) {
  const uploadFile = async (e) => { 
    const files = Array.from(e.target.files || []);
    if (!files || files.length === 0) return;

    // Client-side cumulative size limit for this upload action: sum sizes of all selected files
    // and abort if the total exceeds the tier limit. Use actual `file.size` values only.
    
    // Process only the first file for the existing single-file upload flow
    const file = files[0];
    
    const uniqueName = getUniqueName(file.name, currentFolder.files);
    let fileType = 'pdf';
    let fileColor = '#ef4444';
    let fileUrl = URL.createObjectURL(file);
    let base64Data = null;
    
    if (file.type === "application/pdf") {
      fileType = 'pdf';
      fileColor = '#ef4444';
      
      const MAX_PDF_SIZE = 5 * 1024 * 1024; // 5 MB
      if (file.size > MAX_PDF_SIZE) {
        alert("This PDF is larger than 5MB. Please compress it and try again to avoid filling up your browser's local memory.");
        return;
      }

      const reader = new FileReader();
      await new Promise((resolve, reject) => {
        reader.onload = () => {
          base64Data = reader.result; // data:application/pdf;base64,...
          resolve();
        };
        reader.onerror = reject;
        reader.readAsDataURL(file);
      });
    } else if (file.type === "text/plain" || file.name.endsWith('.txt') || file.name.endsWith('.rtf') || file.type === "application/rtf") {
      fileType = 'note';
      fileColor = '#6366f1';
    } else {
      alert("Only PDF, TXT, and RTF files are supported.");
      return;
    }
    
    const fileId = Date.now();

    // Insert the file entry locally
    setRootFolder(prev => updateFolderTree(prev, currentFolderId, (folder) => ({ 
      ...folder, 
      files: [...folder.files, { 
        id: fileId, 
        name: uniqueName, 
        url: fileType === 'pdf' ? null : fileUrl,
        type: fileType, 
        blob: fileType === 'pdf' ? null : file,
        base64: fileType === 'pdf' ? base64Data : null,
        scrollTop: 0, 
        color: fileColor,
        folderId: currentFolder.id,
        uploadStatus: 'done',
        uploadProgress: 100,
      }] 
    })));
  };

  // Local UI state to show the Done badge briefly then remove it from the DOM
  const [doneBadgeMap, setDoneBadgeMap] = useState({});
  const doneBadgeTimers = useRef({});

  useEffect(() => {
    // Show badge only for files that have just finished uploading and haven't shown the badge yet
    currentFolder.files.forEach(f => {
      const alreadyShown = !!f.shownDoneBadge;
      if (f.uploadStatus === 'done' && !doneBadgeMap[f.id] && !alreadyShown) {
        // mark badge in-memory map so DOM shows it
        setDoneBadgeMap(m => ({ ...m, [f.id]: true }));

        // mark file metadata so we don't show again when re-entering folder
        try {
          setRootFolder(prev => updateFolderTree(prev, currentFolderId, (folder) => ({
            ...folder,
            files: folder.files.map(file => file.id === f.id ? { ...file, shownDoneBadge: true } : file)
          })));
        } catch (err) {
          console.warn('Could not mark shownDoneBadge on file:', err);
        }

        // schedule removal from DOM after animation completes (approx 2.2s)
        const t = setTimeout(() => {
          setDoneBadgeMap(m => { const copy = { ...m }; delete copy[f.id]; return copy; });
          delete doneBadgeTimers.current[f.id];
        }, 2200);
        doneBadgeTimers.current[f.id] = t;
      }
    });

    return () => {
      // clear pending timers when folder changes/unmount
      Object.values(doneBadgeTimers.current).forEach(clearTimeout);
      doneBadgeTimers.current = {};
    };
  }, [currentFolder.files]);

  return (
    <div className="file-browser" style={{height:'100%', display:'flex', flexDirection:'column', overflow:'hidden'}}>
      <h2 style={{flex:'0 0 auto', margin:'0 0 15px 0'}}>{currentFolder.name}</h2>
      
      {/* FIX: The key prop here forces a re-render when items are added/removed */}
      <motion.div 
        key={`${currentFolder.id}-${currentFolder.children.length}-${currentFolder.files.length}`}
        className="files-grid" 
        variants={containerVariants} 
        initial="hidden" 
        animate="show" 
        style={{flex:1, minHeight:0, overflowY:'auto'}}
      >
        {currentFolder.children.map(child => (
          <motion.div key={child.id} className="file-card folder-card" onClick={() => onNavigate(child.id)} style={{borderColor: child.color, boxShadow: theme === 'dark' ? `0 0 15px ${child.color}40` : 'none', backgroundColor: child.color + (theme === 'dark' ? '25' : '10')}} variants={itemVariants}>
            <div className="file-card-actions">
              <button className="btn-icon-xs" onClick={(e) => { e.stopPropagation(); onRenameRequest({ type:'folder', id: child.id, name: child.name, color: child.color }); }}><Edit2 size={12}/></button>
              <button className="btn-icon-xs btn-delete" onClick={(e) => { e.stopPropagation(); onDeleteRequest(child.id); }}><Trash2 size={12}/></button>
            </div>
            <Folder size={32} className="file-icon" style={{color: child.color || '#f59e0b'}} /><span className="file-name">{child.name}</span>
          </motion.div>
        ))}
        {currentFolder.files.map((file, idx) => (
          <motion.div key={file.id} className="file-card" onClick={() => onSelectFile && onSelectFile(file)} variants={itemVariants}>
            <div className="file-card-actions">
              <button className="btn-icon-xs" onClick={(e) => { e.stopPropagation(); onRenameRequest({ type:'file', id: file.id, name: file.name, color: file.color }); }}><Edit2 size={12}/></button>
              <button className="btn-icon-xs btn-delete" onClick={(e) => { e.stopPropagation(); onDeleteRequest(file.id); }}><Trash2 size={12}/></button>
            </div>
            {file.type === 'note' ? <FilePenLine size={32} style={{color: file.color || '#6366f1'}} className="file-icon"/> : file.type === 'deck' ? <Layers size={32} style={{color: file.color || '#8b5cf6'}} className="file-icon"/> : <FileText size={32} style={{color: file.color || '#ef4444'}} className="file-icon"/>}
            <span className="file-name">{file.name}</span>

            {/* Upload progress UI: show a small 'Done' badge when finished; otherwise show progress bar/status */}
            {file.uploadStatus === 'done' && doneBadgeMap[file.id] ? (
              <div className="progress-done" onClick={(e) => e.stopPropagation()}>Done</div>
            ) : (
              (file.uploadStatus !== 'done' && (file.uploadStatus === 'uploading' || file.uploadStatus === 'error' || file.uploadStatus === 'pending' || file.uploadProgress !== undefined)) && (
              <div className="upload-progress" onClick={(e) => e.stopPropagation()}>
                <div className="progress-bar" aria-hidden>
                  <div className="progress-fill" style={{ width: `${Math.min(100, Math.max(0, file.uploadProgress || 0))}%` }} />
                </div>
                <div className={`progress-meta ${file.uploadStatus === 'error' ? 'failed' : file.uploadStatus === 'done' ? 'done' : ''}`}>
                  {file.uploadStatus === 'uploading' && `${Math.round(file.uploadProgress || 0)}%`}
                  {file.uploadStatus === 'error' && 'Failed'}
                  {file.uploadStatus === 'pending' && 'Pending'}
                </div>
              </div>
            ))}

          </motion.div>
        ))}
        
        <motion.label 
          className="upload-card" 
          whileHover={{ scale: 0.98, y: -2 }} 
          whileTap={{ scale: 0.98 }} 
          transition={{ type: "spring", stiffness: 300, damping: 20 }}
        >
          <Upload size={32} strokeWidth={1} />
          <span>Upload File</span>
          <input type="file" hidden accept=".pdf,.txt,.rtf,application/pdf,text/plain,application/rtf" onChange={uploadFile} />
        </motion.label>
      </motion.div>
    </div>
  );
}
function RichDocEditor({ file, onUpdate, onClose, theme = 'light' }) {
  if (!file) return null;
  
  const quillRef = useRef(null);
  const [showPreview, setShowPreview] = useState(false);
  const [canUndo, setCanUndo] = useState(false);
  const [canRedo, setCanRedo] = useState(false);
  const [localContent, setLocalContent] = useState(file.content || '');

  useEffect(() => {
    // Sync local editor content when a different file is loaded
    setLocalContent(file.content || '');
  }, [file.id]);
  const saveTimeoutRef = useRef(null);

  // Debounced save helper
  const scheduleSave = (val) => {
    if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
    saveTimeoutRef.current = setTimeout(() => {
      try { onUpdate(val); } catch (e) { console.error('debounced save failed', e); }
      saveTimeoutRef.current = null;
    }, 700);
  };

  // Flush pending save when file switches or editor unmounts
  useEffect(() => {
    return () => {
      if (saveTimeoutRef.current) {
        clearTimeout(saveTimeoutRef.current);
        try { onUpdate(localContent); } catch (_) {}
        saveTimeoutRef.current = null;
      }
    };
  }, [file.id]);

  const handleQuillChange = (val) => {
    setLocalContent(val);
    scheduleSave(val);
  };
  // History helpers for undo/redo
  const updateHistoryState = () => {
    const editor = quillRef.current && quillRef.current.getEditor ? quillRef.current.getEditor() : null;
    if (!editor || !editor.history) {
      setCanUndo(false);
      setCanRedo(false);
      return;
    }
    const undoStack = editor.history.stack && editor.history.stack.undo ? editor.history.stack.undo.length : 0;
    const redoStack = editor.history.stack && editor.history.stack.redo ? editor.history.stack.redo.length : 0;
    setCanUndo(undoStack > 0);
    setCanRedo(redoStack > 0);
  };

  useEffect(() => {
    const editor = quillRef.current && quillRef.current.getEditor ? quillRef.current.getEditor() : null;
    if (!editor) return;
    // Update history state on text-change and selection-change
    const onTextChange = () => updateHistoryState();
    editor.on('text-change', onTextChange);
    editor.on('selection-change', onTextChange);
    // initialize
    setTimeout(updateHistoryState, 150);
    return () => {
      try { editor.off('text-change', onTextChange); editor.off('selection-change', onTextChange); } catch (_) {}
    };
  }, [quillRef.current]);

  // Keyboard shortcuts for Undo/Redo when editor has focus
  useEffect(() => {
    const handler = (e) => {
      const editor = quillRef.current && quillRef.current.getEditor ? quillRef.current.getEditor() : null;
      if (!editor || !editor.hasFocus || !editor.hasFocus()) return;
      const isMod = e.ctrlKey || e.metaKey;
      if (!isMod) return;
      if (e.key.toLowerCase() === 'z') {
        e.preventDefault();
        if (e.shiftKey) {
          if (editor.history) editor.history.redo();
        } else {
          if (editor.history) editor.history.undo();
        }
        updateHistoryState();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [quillRef.current]);
  const downloadPDF = async () => {
    try {
      const doc = new jsPDF('p', 'pt', 'a4');

      // Render math-enabled HTML for the note content
      const rendered = renderMathToHtml(file.content || '');

      // Create a hidden container to render the HTML for snapshotting
      const container = document.createElement('div');
      container.style.width = '794px';
      container.style.padding = '20px';
      container.style.background = '#ffffff';
      container.style.color = '#000000';
      container.style.boxSizing = 'border-box';
      container.style.position = 'fixed';
      container.style.left = '-9999px';
      container.innerHTML = `<div style="font-family: Inter, system-ui, -apple-system, sans-serif; font-size:12pt; line-height:1.4;">${rendered}</div>`;
      document.body.appendChild(container);

      const canvas = await html2canvas(container, { scale: 2, backgroundColor: '#ffffff', useCORS: true });
      const imgData = canvas.toDataURL('image/png');

      const pdfWidth = doc.internal.pageSize.getWidth();
      const pdfHeight = doc.internal.pageSize.getHeight();

      const imgWidth = pdfWidth;
      const imgHeight = (canvas.height * imgWidth) / canvas.width;

      let heightLeft = imgHeight;
      let position = 0;

      doc.addImage(imgData, 'PNG', 0, position, imgWidth, imgHeight);
      heightLeft -= pdfHeight;

      while (heightLeft > -1) {
        position = position - pdfHeight;
        doc.addPage();
        doc.addImage(imgData, 'PNG', 0, position, imgWidth, imgHeight);
        heightLeft -= pdfHeight;
      }

      doc.save(`${file.name}.pdf`);
      document.body.removeChild(container);
    } catch (err) {
      console.error('PDF export failed:', err);
      alert('Failed to export PDF with rendered math. See console for details.');
    }
  };
  const downloadRTF = () => { 
    const convertHtmlToRtf = (html) => { 
      let rtf = html.replace(/<strong>/g, "\\b ").replace(/<\/strong>/g, "\\b0 ").replace(/<b>/g, "\\b ").replace(/<\/b>/g, "\\b0 ").replace(/<em>/g, "\\i ").replace(/<\/em>/g, "\\i0 ").replace(/<i>/g, "\\i ").replace(/<\/i>/g, "\\i0 ").replace(/<u>/g, "\\ul ").replace(/<\/u>/g, "\\ulnone ").replace(/<p>/g, "\\par ").replace(/<\/p>/g, "\\par ").replace(/<br>/g, "\\line ").replace(/<h1>/g, "\\fs48\\b ").replace(/<\/h1>/g, "\\b0\\fs24\\par ").replace(/<h2>/g, "\\fs36\\b ").replace(/<\/h2>/g, "\\b0\\fs24\\par "); 
      rtf = rtf.replace(/<[^>]+>/g, "").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">"); 
      return `{\\rtf1\\ansi\\deff0 {\\fonttbl {\\f0 Arial;}} \\fs24 ${rtf} }`; 
    }; 
    const rtfContent = convertHtmlToRtf(file.content || ""); 
    const blob = new Blob([rtfContent], { type: "application/rtf" }); 
    saveAs(blob, `${file.name}.rtf`); 
  };

  // Render MathHelper into the Quill toolbar: create a container and move it
  const mathHelperContainerRef = useRef(null);
  useEffect(() => {
    const el = mathHelperContainerRef.current;
    if (!el) return;
    function moveIntoToolbar() {
      const toolbar = document.querySelector('.quill-wrapper .ql-toolbar');
      if (toolbar && !toolbar.contains(el)) {
        toolbar.appendChild(el);
        el.style.display = 'inline-flex';
        el.style.marginLeft = '6px';
      }
    }
    // Try immediately and again shortly after Quill initializes
    moveIntoToolbar();
    const t = setTimeout(moveIntoToolbar, 300);
    return () => clearTimeout(t);
  }, [showPreview]);
  return (
    <div className="note-editor" style={{display:'flex', flexDirection:'column', height:'100%', overflow:'hidden'}}>
      <div className="note-header" style={{flex:'0 0 auto', display:'flex', alignItems:'center', justifyContent:'space-between', padding:'6px 12px', gap:'8px', borderBottom:'1px solid #e5e7eb'}}>
        <div style={{display:'flex', alignItems:'center', gap:'6px', minWidth:0, flex:1}}>
          <FilePenLine size={18} className="note-icon" style={{color: file.color || '#6366f1', flexShrink:0}} />
          <span className="note-title-display" style={{fontSize:'0.95rem', fontWeight:600, whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis'}}>{file.name}</span>
        </div>
        <div className="editor-actions" style={{display:'flex', gap:'6px', flexShrink:0}}>
          <button className="btn-icon-sm" onClick={() => {
            const editor = quillRef.current && quillRef.current.getEditor ? quillRef.current.getEditor() : null;
            if (editor && editor.history) { editor.history.undo(); updateHistoryState(); }
          }} style={{padding:6}} disabled={!canUndo} title="Undo">
            <RotateCcw size={16} />
          </button>
          <button className="btn-icon-sm" onClick={() => {
            const editor = quillRef.current && quillRef.current.getEditor ? quillRef.current.getEditor() : null;
            if (editor && editor.history) { editor.history.redo(); updateHistoryState(); }
          }} style={{padding:6}} disabled={!canRedo} title="Redo">
            <RotateCw size={16} />
          </button>
          {/* MathHelper moved into the Quill toolbar below */}
          <button className="btn-tool-sm" onClick={() => setShowPreview(s => !s)} style={{padding:'6px 10px', fontWeight:700}}>{showPreview ? 'Edit' : 'Preview'}</button>
          <button onClick={downloadRTF} className="btn-tool-sm" style={{padding:'4px 8px', fontSize:'0.8rem'}} title="Works in Apple Pages & Word">
            <FileText size={14} className="text-blue-600"/> .RTF 
          </button>
          <button onClick={downloadPDF} className="btn-tool-sm" style={{padding:'4px 8px', fontSize:'0.8rem'}} title="Download PDF">
            <Download size={14} className="text-red-600"/> .PDF
          </button>
          <button onClick={onClose} className="close-file-btn" style={{color:'#ef4444', padding:'4px 8px', fontSize:'0.8rem'}}>
            <X size={14}/>Close
          </button>
        </div>
      </div>
      <div className="quill-wrapper" style={{flex:'1 1 auto', minHeight:0}}>
        <div ref={mathHelperContainerRef} style={{display:'none'}}>
          <MathHelper theme={theme} onInsert={(tpl) => {
            const editor = quillRef.current && quillRef.current.getEditor ? quillRef.current.getEditor() : null;
            if (editor) {
              const range = editor.getSelection(true);
              const idx = range ? range.index : editor.getLength();
              editor.insertText(idx, tpl);
            }
          }} />
        </div>
        {!showPreview ? (
          <ReactQuill
            ref={quillRef}
            theme="snow"
            value={localContent}
            onChange={handleQuillChange}
            placeholder=""
            modules={{ toolbar: [ [{ 'header': [1, 2, 3, false] }], [{ 'font': [] }], [{ 'size': ['small', false, 'large', 'huge'] }], ['bold', 'italic', 'underline', 'strike'], [{ 'color': [] }, { 'background': [] }], [{ 'align': [] }], [{'list': 'ordered'}, {'list': 'bullet'}], ['clean'] ] }}
            readOnly={false}
          />
        ) : (
          <div style={{padding:12, overflowY:'auto', height:'100%'}}>
            <div dangerouslySetInnerHTML={{__html: renderMathToHtml((quillRef.current && quillRef.current.getEditor) ? quillRef.current.getEditor().getText() : (localContent || ''))}} />
          </div>
        )}
      </div>
    </div>
  );
}

function TimerNotificationModal({ message, onClose }) {
  return (
    <div className="modal-overlay">
      <motion.div initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }} className="modal-content confirmation-modal">
        <div className="modal-icon-bubble" style={{backgroundColor: '#e0e7ff', color: '#4338ca'}}><Hash size={32} /></div>
        <h3>Attention!</h3>
        <p className="modal-text">{message}</p>
        <div className="modal-btn-row">
            <button onClick={onClose} className="btn-primary modal-btn">Got It</button>
        </div>
      </motion.div>
    </div>
  );
}

function AboutModal({ onClose }) {
  return (
    <div className="modal-overlay" onClick={onClose}>
      <motion.div 
        initial={{ opacity: 0, scale: 0.9, y: 20 }} 
        animate={{ opacity: 1, scale: 1, y: 0 }} 
        exit={{ opacity: 0, scale: 0.9, y: 20 }}
        transition={{ type: "spring", stiffness: 300, damping: 25 }}
        className="modal-content about-modal"
        onClick={(e) => e.stopPropagation()}
        style={{
          maxWidth: '600px',
          maxHeight: '90vh',
          backgroundColor: '#ffffff',
          borderRadius: '24px',
          padding: '0',
          boxShadow: '0 25px 80px rgba(99, 102, 241, 0.15)',
          border: 'none',
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
          transition: 'max-width 0.3s ease'
        }}
      >
        {/* Gradient Header */}
        <div style={{
          background: 'linear-gradient(135deg, #4f46e5 0%, #6366f1 100%)',
          padding: '40px 40px 30px 40px',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'flex-start',
          flexShrink: 0
        }}>
          <div style={{flex: 1}}>
            <h2 style={{ margin: 0, fontSize: '1.8rem', fontWeight: '800', color: 'white' }}>
              About
            </h2>
          </div>
          
          <motion.button 
            onClick={onClose} 
            className="btn-icon-sm" 
            whileHover={{ scale: 1.1 }}
            whileTap={{ scale: 0.9 }}
            style={{background: 'rgba(255,255,255,0.2)', border:'none', cursor: 'pointer', padding: '8px', flexShrink: 0, borderRadius: '8px', transition: 'all 0.2s'}}
            onMouseEnter={(e) => e.currentTarget.style.background = 'rgba(255,255,255,0.3)'}
            onMouseLeave={(e) => e.currentTarget.style.background = 'rgba(255,255,255,0.2)'}
          >
            <X size={20} color="white" />
          </motion.button>
        </div>

        {/* Scrollable Content */}
        <div style={{flex: 1, overflowY: 'auto', paddingRight: '8px', scrollbarWidth: 'thin', scrollbarColor: '#cbd5e1 transparent'}}>
          <div style={{ padding: '40px 40px' }}>
            {/* Main Description */}
            <motion.div 
              initial={{ opacity: 0, y: 10 }} 
              animate={{ opacity: 1, y: 0 }} 
              transition={{ delay: 0.15 }}
              style={{marginBottom: '35px'}}
            >
              <p style={{ 
                fontSize: '1rem',
                lineHeight: '1.8',
                color: '#4b5563',
                margin: 0,
                fontWeight: '600'
              }}>
                 <span style={{ color: '#6366f1', fontWeight: 800 }}>FocuState</span> brings everything you need into one beautiful, distraction-free workspace. Focus smarter, study harder.
              </p>
            </motion.div>

            {/* Features with Descriptions */}
            <motion.div 
              initial={{ opacity: 0, y: 10 }} 
              animate={{ opacity: 1, y: 0 }} 
              transition={{ delay: 0.2 }}
              style={{ marginBottom: '35px' }}
            >
              <h3 style={{fontSize: '0.9rem', fontWeight: '700', color: '#6366f1', textTransform: 'uppercase', letterSpacing: '1px', margin: '0 0 20px 0'}}>Core Features</h3>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: '16px' }}>
                {[
                  { Icon: Clock, title: 'Focus Timer', desc: 'Pomodoro-style timer with customizable work and break cycles to keep the momentum going.' },
                  { Icon: FilePenLine, title: 'Note Taking', desc: 'Rich text editor for capturing notes and ideas, with TeX support.' },
                  { Icon: Layers, title: 'Flashcard Decks', desc: 'Create and use flashcards for spaced repetition.' },
                  { Icon: ListTodo, title: 'To-Do Lists', desc: 'Daily task management, synced across your devices.' },
                  { Icon: BarChart3, title: 'Analytics & Stats', desc: 'Track your study habits and celebrate your progress over time.' },
                  { Icon: Save, title: 'Local Storage', desc: 'All your data is stored locally on your device for privacy and speed.' }
                ].map((feature, idx) => (
                  <motion.div 
                    key={idx}
                    initial={{ opacity: 0, x: -10 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ delay: 0.25 + idx * 0.05 }}
                    style={{
                      display: 'flex',
                      gap: '16px',
                      padding: '14px 16px',
                      backgroundColor: '#f8fafc',
                      borderRadius: '12px',
                      border: '1px solid #e2e8f0',
                      transition: 'all 0.2s'
                    }}
                    onMouseEnter={(e) => {
                      e.currentTarget.style.backgroundColor = '#f0f4ff';
                      e.currentTarget.style.borderColor = '#e0e7ff';
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.backgroundColor = '#f8fafc';
                      e.currentTarget.style.borderColor = '#e2e8f0';
                    }}
                  >
                    <feature.Icon size={24} color="#6366f1" style={{flexShrink: 0, marginTop: '2px'}} />
                    <div style={{flex: 1}}>
                      <div style={{fontWeight: '600', color: '#1f2937', marginBottom: '4px', fontSize: '0.95rem'}}>
                        {feature.title}
                      </div>
                      <div style={{fontSize: '0.85rem', color: '#6b7280', lineHeight: '1.4'}}>
                        {feature.desc}
                      </div>
                    </div>
                  </motion.div>
                ))}
              </div>
            </motion.div>

            {/* Unique Value Props */}
            <motion.div 
              initial={{ opacity: 0, y: 10 }} 
              animate={{ opacity: 1, y: 0 }} 
              transition={{ delay: 0.35 }}
              style={{ marginBottom: '35px' }}
            >
              <h3 style={{fontSize: '0.9rem', fontWeight: '700', color: '#6366f1', textTransform: 'uppercase', letterSpacing: '1px', margin: '0 0 20px 0'}}>Why FocuState</h3>
              <div style={{
                display: 'grid',
                gridTemplateColumns: '1fr 1fr',
                gap: '12px'
              }}>
                {[
                  { Icon: Eye, label: 'Distraction-free interface' },
                  { Icon: Lock, label: 'Private & secure' },
                  { Icon: Save, label: 'On-device storage' },
                  { Icon: Zap, label: 'Zero bloat' }
                ].map((point, idx) => (
                  <motion.div
                    key={idx}
                    initial={{ opacity: 0, scale: 0.9 }}
                    animate={{ opacity: 1, scale: 1 }}
                    transition={{ delay: 0.40 + idx * 0.05 }}
                    style={{
                      padding: '12px 14px',
                      background: 'linear-gradient(135deg, #f0f4ff 0%, #ede9fe 100%)',
                      borderRadius: '10px',
                      display: 'flex',
                      flexDirection: 'column',
                      alignItems: 'center',
                      gap: '8px',
                      fontSize: '0.9rem',
                      fontWeight: '600',
                      color: '#6366f1',
                      textAlign: 'center',
                      border: '1px solid #e0e7ff'
                    }}
                  >
                    <point.Icon size={20} color="#6366f1" />
                    {point.label}
                  </motion.div>
                ))}
              </div>
            </motion.div>

            {/* Footer Info */}
            <motion.div 
              initial={{ opacity: 0, y: 10 }} 
              animate={{ opacity: 1, y: 0 }} 
              transition={{ delay: 0.45 }}
              style={{
                borderTop: '1px solid #e5e7eb',
                paddingTop: '25px',
                textAlign: 'center'
              }}
            >
              <p style={{fontSize: '0.85rem', color: '#9ca3af', margin: '0 0 10px 0'}}>Designed & built by</p>
              <p style={{fontSize: '0.95rem', color: '#6366f1', margin: 0, fontWeight: '700'}}>Andrea Maccariello</p>
            </motion.div>
          </div>
        </div>
      </motion.div>
    </div>
  );
}

function FocusHistoryModal({ records, onClose, theme, onClearHistory, user, flowTier }) {
  const [view, setView] = useState('MONTH'); 
  const [navDate, setNavDate] = useState(new Date());
  const [selectedDate, setSelectedDate] = useState(new Date());
  const [isDeleting, setIsDeleting] = useState(false); // Deletion Confirmation State

  // Log when records prop changes
  useEffect(() => {
    const todayKey = `${new Date().getFullYear()}-${String(new Date().getMonth() + 1).padStart(2, '0')}-${String(new Date().getDate()).padStart(2, '0')}`;
    console.log('[FocusHistoryModal] Records updated, today =', records[todayKey] || 0, 'mins, full records:', records);
  }, [records]);

  const getDaysInMonth = (date) => new Date(date.getFullYear(), date.getMonth() + 1, 0).getDate();
  const getFirstDayOfMonth = (date) => new Date(date.getFullYear(), date.getMonth(), 1).getDay();
  // FIXED: Uses local time instead of UTC to avoid timezone shifts
const toKey = (d) => {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
  const getMins = (date) => {
    const entry = records?.[toKey(date)];
    if (entry == null) return 0;
    if (typeof entry === 'object') {
      if (typeof entry.total === 'number') return entry.total;
      const by = entry.byTag || {};
      return Object.values(by).reduce((s, v) => s + (Number(v) || 0), 0);
    }
    return Number(entry) || 0;
  };
  
  const getVisualHeight = (mins) => {
    if (mins === 0) return 0;
    const maxReference = 480; 
    const ratio = Math.min(mins, maxReference) / maxReference;
    return Math.sqrt(ratio) * 100; 
  };

  const calculateStats = (period) => {
    let total = 0;
    let count = 0;
    let daysToCheck = 0;

    if (period === 'WEEK') daysToCheck = 7;
    if (period === 'MONTH') daysToCheck = getDaysInMonth(navDate);
    if (period === 'YEAR') daysToCheck = 365;

    let iterator = new Date(navDate);
    if (period === 'WEEK') {
        iterator = new Date(selectedDate);
        iterator.setDate(iterator.getDate() - 6);
    } else if (period === 'MONTH') {
        iterator.setDate(1);
    } else {
        iterator.setMonth(0); iterator.setDate(1);
    }

    for (let i = 0; i < daysToCheck; i++) {
        const m = getMins(iterator);
        if (m > 0) { total += m; count++; }
        iterator.setDate(iterator.getDate() + 1);
    }

    const dailyAvg = count > 0 ? Math.round(total / count) : 0;
    const totalHours = (total / 60).toFixed(1);
    
    return { total, totalHours, dailyAvg, daysActive: count };
  };

  const periodStats = calculateStats(view);
  const selectedMins = getMins(selectedDate);
  const selectedHours = (selectedMins / 60).toFixed(1);

  // Breakdown by tag state
  const [statsView, setStatsView] = useState('GENERAL'); // GENERAL | TAG_BREAKDOWN
  const [breakdownRange, setBreakdownRange] = useState('WEEK'); // DAY | WEEK | MONTH | YEAR
  const [tagsList, setTagsList] = useState([]);

  useEffect(() => {
    // Load tags for this user (falls back to local IndexedDB when no user provided)
    getTags().then(list => setTagsList(list || [])).catch(() => setTagsList([]));
  }, []);

  const toKeyStr = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;

  const aggregateByTag = (records, startDate, endDate) => {
    const startKey = toKeyStr(startDate);
    const endKey = toKeyStr(endDate);
    const map = {};
    let total = 0;
    for (const [dateKey, val] of Object.entries(records || {})) {
      if (dateKey < startKey || dateKey > endKey) continue;
      if (typeof val === 'number') {
        total += Number(val) || 0;
        map['untagged'] = (map['untagged'] || 0) + (Number(val) || 0);
      } else if (val && typeof val === 'object') {
        const dayTotal = Number(val.total) || 0;
        total += dayTotal;
        const byTag = val.byTag || {};
        let tagSum = 0;
        for (const [tagId, mins] of Object.entries(byTag)) {
          const m = Number(mins) || 0;
          tagSum += m;
          map[tagId] = (map[tagId] || 0) + m;
        }
        const untagged = dayTotal - tagSum;
        if (untagged > 0) map['untagged'] = (map['untagged'] || 0) + untagged;
      }
    }
    return { total, byTag: map };
  };

  const getBreakdownRange = (range) => {
    const now = new Date(selectedDate);
    let start = new Date(now);
    let end = new Date(now);
    if (range === 'DAY') {
      // start/end already set
    } else if (range === 'WEEK') {
      // Week containing selectedDate (Sunday - Saturday)
      const startOfWeek = new Date(selectedDate);
      startOfWeek.setDate(selectedDate.getDate() - selectedDate.getDay());
      start = startOfWeek;
      end = new Date(startOfWeek);
      end.setDate(startOfWeek.getDate() + 6);
    } else if (range === 'MONTH') {
      start = new Date(navDate.getFullYear(), navDate.getMonth(), 1);
      end = new Date(navDate.getFullYear(), navDate.getMonth(), getDaysInMonth(navDate));
    } else if (range === 'YEAR') {
      start = new Date(navDate.getFullYear(), 0, 1);
      end = new Date(navDate.getFullYear(), 11, 31);
    }
    return { start, end };
  };

  const breakdown = (() => {
    // breakdown calculation is independent of whether it's shown
    const { start, end } = getBreakdownRange(breakdownRange);
    const agg = aggregateByTag(records, start, end);
    // Map tag ids to names/colors
    const items = Object.entries(agg.byTag).map(([tagId, mins]) => {
      if (tagId === 'untagged') return { id: 'untagged', name: 'Untagged', color: '#94a3b8', mins };
      const found = tagsList.find(t => t.id === tagId) || { id: tagId, name: tagId, color: '#6366f1' };
      return { id: tagId, name: found.name || tagId, color: found.color || '#6366f1', mins };
    }).sort((a,b) => b.mins - a.mins);
    return { total: agg.total, items };
  })();

  // Small SVG Pie/Donut chart component for tag breakdown
  const PieChart = ({ items, size = 220, innerRadius = 70 }) => {
    const total = items.reduce((s, it) => s + (it.mins || 0), 0);
    const hasData = total > 0;
    const cx = size / 2;
    const cy = size / 2;
    const outerR = size / 2;
    const innerR = innerRadius;
    let startAngle = -90; // start at top
    const [hover, setHover] = useState(null);

    // We'll render the donut using stroked concentric circle segments for reliability.
    const radiusMid = (outerR + innerR) / 2;
    const thickness = outerR - innerR;
    const circumference = 2 * Math.PI * radiusMid;
    let accLen = 0; // accumulated length in px for dashoffset

    return (
      <div style={{ display: 'flex', gap: 14, alignItems: 'center' }}>
        <div style={{ position: 'relative', width: size, height: size }}>
          <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
            {/* If there's no data, draw a faint ring to indicate empty donut */}
            {!hasData && (
              <g>
                <circle cx={cx} cy={cy} r={(outerR + innerR) / 2} fill="none" stroke={theme === 'dark' ? '#334155' : '#e6edf8'} strokeWidth={outerR - innerR - 6} />
              </g>
            )}

            {hasData && items.map((it, idx) => {
              const portion = (it.mins / total) || 0;
              const segLen = portion * circumference;
              const percent = Math.round(portion * 100);
              const key = `slice-${it.id}-${idx}`;
              const dashArray = `${segLen} ${Math.max(0, circumference - segLen)}`;
              const dashOffset = -accLen;
              accLen += segLen;
              return (
                <circle
                  key={key}
                  cx={cx}
                  cy={cy}
                  r={radiusMid}
                  fill="none"
                  stroke={it.color}
                  strokeWidth={thickness}
                  strokeLinecap="butt"
                  strokeDasharray={dashArray}
                  strokeDashoffset={dashOffset}
                  transform={`rotate(-90 ${cx} ${cy})`}
                  style={{ cursor: 'pointer', pointerEvents: 'auto' }}
                  onMouseEnter={(e) => setHover({ item: it, percent, x: e.clientX, y: e.clientY })}
                  onMouseMove={(e) => setHover(h => h ? { ...h, x: e.clientX, y: e.clientY } : h)}
                  onMouseLeave={() => setHover(null)}
                />
              );
            })}

            {/* center circle to smooth edges - ignore pointer events so slices remain interactive */}
            <circle cx={cx} cy={cy} r={innerR - 1} fill={theme === 'dark' ? '#0b1220' : '#fff'} style={{ pointerEvents: 'none' }} />
          </svg>
          {hover && (
            <div style={{ position: 'fixed', left: hover.x + 12, top: hover.y + 12, zIndex: 9999, pointerEvents: 'none' }}>
              <div style={{ background: '#0f172a', color: '#fff', padding: '6px 8px', borderRadius: 6, fontSize: '0.85rem', boxShadow: '0 6px 20px rgba(2,6,23,0.3)' }}>
                <div style={{ fontWeight: 700 }}>{hover.item.name}</div>
                <div style={{ color: '#c7d2fe' }}>{hover.percent}% — {hover.item.mins} mins</div>
              </div>
            </div>
          )}
        </div>
      </div>
    );
  };

  const renderMonth = () => {
    const days = [];
    const daysInMonth = getDaysInMonth(navDate);
    const startDay = getFirstDayOfMonth(navDate); 
    const today = new Date();
    const todayKey = toKey(today);
    
    for (let i = 0; i < startDay; i++) days.push(<div key={`empty-${i}`} className="day-cell empty" />);
    for (let d = 1; d <= daysInMonth; d++) {
        const date = new Date(navDate.getFullYear(), navDate.getMonth(), d);
        const dateKey = toKey(date);
        const mins = getMins(date);
        const isSelected = dateKey === toKey(selectedDate);
        const isToday = dateKey === todayKey;
        
        days.push(
            <div key={d} className={`day-cell ${isSelected ? 'selected' : ''} ${isToday ? 'today' : ''}`} onClick={() => setSelectedDate(date)}>
                <span className="day-number">{d}</span>
                {mins > 0 && <div className="focus-dot" style={{ opacity: isToday ? 1 : Math.min(1, 0.3 + (mins/120)) }} />}
            </div>
        );
    }
    return <div className="month-grid">{['S','M','T','W','T','F','S'].map(d=><div key={d} className="day-name">{d}</div>)}{days}</div>;
  };

  const renderWeek = () => {
    const bars = [];
    const startOfWeek = new Date(selectedDate);
    startOfWeek.setDate(selectedDate.getDate() - selectedDate.getDay()); 

    for (let i = 0; i < 7; i++) {
        const d = new Date(startOfWeek);
        d.setDate(startOfWeek.getDate() + i);
        const mins = getMins(d);
        const height = getVisualHeight(mins);
        const isSelected = toKey(d) === toKey(selectedDate);

        bars.push(
            <div key={i} className="week-col" onClick={() => setSelectedDate(d)}>
                <span className="week-val">{mins > 0 ? mins : ''}</span>
                <div className="week-bar-bg">
                    <div className="week-bar-fill" style={{ height: `${height}%`, background: isSelected ? '#4f46e5' : '#818cf8' }} />
                </div>
                <span className="week-label" style={{color: isSelected ? '#4f46e5' : null}}>{d.toLocaleDateString('en-US',{weekday:'short'})}</span>
            </div>
        );
    }
    return <div className="week-chart">{bars}</div>;
  };

  return (
    <motion.div
      className="modal-overlay"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      onClick={onClose}
    >
      <motion.div
        className={`focus-history-modal theme-${theme}`}
        layout
        initial={{ scale: 0.8, opacity: 0, y: 20 }}
        animate={{ scale: 1, opacity: 1, y: 0 }}
        exit={{ scale: 0.8, opacity: 0, y: 20 }}
        transition={{ duration: 0.28, type: 'spring', stiffness: 220, damping: 28 }}
        onClick={(e) => e.stopPropagation()}
        style={{
          width: statsView === 'TAG_BREAKDOWN' ? 1120 : undefined,
            // adjust By Subject modal height (resized after removing delete button)
            // increased slightly to give more vertical room for the breakdown chart
            height: statsView === 'TAG_BREAKDOWN' ? 766 : undefined,
            maxHeight: statsView === 'TAG_BREAKDOWN' ? '80vh' : '75vh',
          maxWidth: statsView === 'TAG_BREAKDOWN' ? '1200px' : undefined,
          overflow: 'visible'
        }}
      >
        {/* HEADER */}
        <div className="focus-history-header" style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <h2 style={{ margin: 0 }}>FocuStats</h2>
          <div style={{ marginLeft: 'auto', display: 'flex', gap: 8, alignItems: 'center' }}>
            <div className="view-toggle-group" style={{ display: 'flex', gap: 8, padding: 4, borderRadius: 10, backgroundColor: 'rgba(0,0,0,0.02)' }}>
              <motion.button
                onClick={() => setStatsView('GENERAL')}
                whileHover={{ scale: 1.03 }}
                whileTap={{ scale: 0.98 }}
                className={`focus-view-tab ${statsView === 'GENERAL' ? 'active' : ''}`}
                style={{ padding: '8px 14px', border: 'none', cursor: 'pointer' }}
                aria-pressed={statsView === 'GENERAL'}
                key="toggle-general"
              >
                General
              </motion.button>
              <motion.button
                onClick={() => setStatsView('TAG_BREAKDOWN')}
                whileHover={{ scale: 1.03 }}
                whileTap={{ scale: 0.98 }}
                className={`focus-view-tab ${statsView === 'TAG_BREAKDOWN' ? 'active' : ''}`}
                style={{ padding: '8px 14px', border: 'none', cursor: 'pointer' }}
                aria-pressed={statsView === 'TAG_BREAKDOWN'}
                key="toggle-breakdown"
              >
                By Subject
              </motion.button>
            </div>
            <motion.button
              className="close-modal-btn"
              onClick={onClose}
              whileHover={{ scale: 1.1 }}
              whileTap={{ scale: 0.95 }}
            >
              <X size={24} />
            </motion.button>
          </div>
        </div>

        {/* CONTENT - TWO COLUMNS */}
        <div className="focus-history-content">
          {/* LEFT: CALENDAR */}
          <div className="focus-calendar-section" style={{ width: statsView === 'TAG_BREAKDOWN' ? 340 : undefined }}>
            <div className="focus-calendar-nav">
              <button onClick={() => {setNavDate(new Date()); setSelectedDate(new Date());}} className="btn-secondary" style={{padding:'6px 12px', fontSize:'0.75rem', borderRadius: 10, fontWeight: 600}}>Today</button>
              <select className="cal-select" value={navDate.getMonth()} onChange={(e) => { const d = new Date(navDate); d.setMonth(parseInt(e.target.value)); setNavDate(d); }}>
                {Array.from({length:12}, (_, i) => <option key={i} value={i}>{new Date(0, i).toLocaleString('default', { month: 'short' })}</option>)}
              </select>
              <select className="cal-select" value={navDate.getFullYear()} onChange={(e) => { const d = new Date(navDate); d.setFullYear(parseInt(e.target.value)); setNavDate(d); }}>
                {Array.from({length: 5}, (_, i) => new Date().getFullYear() - 2 + i).map(y => <option key={y} value={y}>{y}</option>)}
              </select>
            </div>
            {renderMonth()}
          </div>

          {/* RIGHT: STATS AND VIEWS */}
          <div className="focus-stats-section" style={{ width: statsView === 'TAG_BREAKDOWN' ? 'calc(100% - 360px)' : undefined, overflow: statsView === 'TAG_BREAKDOWN' ? 'visible' : undefined }}>
            <AnimatePresence mode="wait">
              {statsView === 'GENERAL' && (
                <motion.div key="general-view" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }} transition={{ duration: 0.18 }} style={{ width: '100%' }}>
                  <div className="focus-view-tabs">
                    <div className={`focus-view-tab ${view === 'WEEK' ? 'active' : ''}`} onClick={() => setView('WEEK')}>Weekly</div>
                    <div className={`focus-view-tab ${view === 'MONTH' ? 'active' : ''}`} onClick={() => setView('MONTH')}>Monthly</div>
                    <div className={`focus-view-tab ${view === 'YEAR' ? 'active' : ''}`} onClick={() => setView('YEAR')}>Yearly</div>
                  </div>

                  <div className="focus-view-content">
                    {view === 'WEEK' && renderWeek()}
                    {view === 'MONTH' && <div style={{textAlign:'center', padding:'20px', color:'#9ca3af'}}><h4>Select a date from the calendar</h4></div>}
                    {view === 'YEAR' && (
                      <div style={{textAlign:'center', padding:'30px', color:'#9ca3af'}}>
                        <Trophy size={40} style={{marginBottom:'15px', color:'#fbbf24'}} />
                        <h3 style={{marginTop: 0}}>Yearly Overview</h3>
                        <p style={{margin:'8px 0'}}>Total Focus: {calculateStats('YEAR').totalHours} Hours</p>
                        <p style={{margin:'8px 0'}}>Active Days: {calculateStats('YEAR').daysActive}</p>
                      </div>
                    )}
                  </div>
                </motion.div>
              )}

              {statsView === 'TAG_BREAKDOWN' && breakdown && (
                <motion.div key="tag-breakdown" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }} transition={{ duration: 0.18 }}>
                  <div
                    className="focus-breakdown"
                    style={{
                      marginTop: 12,
                      padding: 14,
                      borderRadius: 12,
                      border: theme === 'dark' ? '1px solid #23303b' : '1px solid #e6edf8',
                      background: theme === 'dark' ? '#0b1220' : '#fbfdff',
                      display: 'grid',
                      gridTemplateColumns: '1fr',
                      gap: 12
                    }}
                  >
                    {/* header row: controls aligned right */}
                    <div className="breakdown-header" style={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'center' }}>
                      <div className="breakdown-controls">
                        <div className="focus-view-tabs" style={{ display: 'flex', gap: 4 }}>
                          {[['DAY','Daily'], ['WEEK','Weekly'], ['MONTH','Monthly'], ['YEAR','Yearly']].map(([key,label]) => (
                            <div
                              key={key}
                              role="button"
                              tabIndex={0}
                              onClick={() => setBreakdownRange(key)}
                              onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') setBreakdownRange(key); }}
                              className={`focus-view-tab ${breakdownRange === key ? 'active' : ''}`}
                              style={{ cursor: 'pointer' }}
                            >
                              {label}
                            </div>
                          ))}
                        </div>
                      </div>
                    </div>

                    {/* summary row: two stat cards */}
                    <div className="breakdown-summary" style={{ display: 'flex', gap: 12, alignItems: 'stretch', flexWrap: 'wrap' }}>
                      <div className="focus-stat-box" style={{ minWidth: 160, flex: '0 0 220px' }}>
                        <div style={{fontSize:'0.75rem', color:'#9ca3af', fontWeight:600, marginBottom:'6px'}}>Selected Range</div>
                        <div className="focus-stat-big">{breakdown.total} <span style={{fontSize:'0.9rem', fontWeight:500, color:'#9ca3af'}}>mins</span></div>
                        <div className="focus-stat-sub">{(breakdown.total/60).toFixed(1)} hours</div>
                      </div>
                      <div className="focus-stat-box" style={{ minWidth: 160, flex: '0 0 220px' }}>
                        <div style={{fontSize:'0.75rem', color:'#9ca3af', fontWeight:600, marginBottom:'6px'}}>Top Subject</div>
                        <div style={{fontSize:'1rem', fontWeight:700, color: theme === 'dark' ? '#e6eef8' : '#374151'}}>{breakdown.items[0] ? breakdown.items[0].name : '—'}</div>
                        <div style={{fontSize:'0.9rem', color: theme === 'dark' ? '#9ca3af' : '#6b7280', marginTop: 8}}>{breakdown.items[0] ? `${breakdown.items[0].mins} mins` : ''}</div>
                      </div>
                    </div>

                    {/* main content: donut left, legend right */}
                    {(() => {
                      const hasItems = breakdown.items && breakdown.items.length > 0;
                      const displayItems = hasItems ? breakdown.items : (() => {
                        const fromTags = (tagsList || []).map(t => ({ id: t.id, name: t.name, color: t.color || '#6366f1', mins: 0 }));
                        if (!fromTags.find(i => i.id === 'untagged')) {
                          fromTags.unshift({ id: 'untagged', name: 'Untagged', color: '#94a3b8', mins: 0 });
                        }
                        return fromTags;
                      })();

                      return (
                        <div className="breakdown-main" style={{ display: 'grid', gridTemplateColumns: '320px 1fr', gap: 18, alignItems: 'center' }}>
                          <div className="donut-wrap" style={{ display: 'flex', justifyContent: 'center', alignItems: 'center' }}>
                            <motion.div key={breakdownRange} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }} transition={{ duration: 0.24 }}>
                              <PieChart items={displayItems} size={260} innerRadius={84} />
                            </motion.div>
                          </div>

                          <div className="legend-wrap" style={{ maxHeight: 320, overflowY: 'auto' }}>
                            <div className="breakdown-legend">
                              {displayItems.map(item => {
                                const pct = breakdown.total > 0 ? Math.round((item.mins / breakdown.total) * 100) : 0;
                                return (
                                  <div key={item.id} className="legend-item">
                                    <div className="legend-left">
                                      <div className="legend-color" style={{ background: item.color }} />
                                      <div style={{ fontWeight: 700, maxWidth: 420, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', color: theme === 'dark' ? '#e6eef8' : undefined }}>{item.name}</div>
                                    </div>
                                    <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
                                      <div style={{ color: theme === 'dark' ? '#e6eef8' : '#374151', fontWeight: 700 }}>{item.mins} mins</div>
                                      <div style={{ color: theme === 'dark' ? '#9ca3af' : '#6b7280' }}>{pct}%</div>
                                    </div>
                                  </div>
                                );
                              })}
                            </div>
                          </div>
                        </div>
                      );
                    })()}
                  </div>
                </motion.div>
              )}
            </AnimatePresence>

            {/* header-level view buttons are in the modal header; no duplicates here */}

            {/* Tag Breakdown rendered above inside AnimatePresence; duplicate removed */}

            {statsView !== 'TAG_BREAKDOWN' && (
              <div className="focus-stats-footer">
                <div className="focus-stat-box">
                  <div style={{fontSize:'0.75rem', color:'#9ca3af', fontWeight:600, marginBottom:'4px'}}>{selectedDate.toDateString()}</div>
                  <div className="focus-stat-big">{selectedMins} <span style={{fontSize:'0.9rem', fontWeight:500, color:'#9ca3af'}}>mins</span></div>
                  <div className="focus-stat-sub">{selectedHours} hours</div>
                </div>
                <div className="focus-stat-grid">
                  <div className="focus-stat-item">
                    <h4>{view === 'WEEK' ? 'Weekly' : view === 'MONTH' ? 'Monthly' : 'Yearly'} Total</h4>
                    <p>{periodStats.totalHours} hrs</p>
                  </div>
                  <div className="focus-stat-item">
                    <h4>{view === 'WEEK' ? 'Avg/Day' : 'Avg/Day'}</h4>
                    <p>{periodStats.dailyAvg} m</p>
                  </div>
                </div>
              </div>
            )}

            {statsView !== 'TAG_BREAKDOWN' && (
              <div className="focus-history-delete-footer" style={{ display: 'flex', justifyContent: 'center', marginTop: 20, paddingBottom: 12 }}>
                {isDeleting ? (
                  <div className="confirm-delete-row" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10 }}>
                    <span style={{ color: '#ef4444', fontWeight: 'bold' }}>Clear all history?</span>
                    <div style={{ display: 'flex', gap: '10px' }}>
                      <button
                        onClick={() => { onClearHistory(); setIsDeleting(false); onClose(); }}
                        className="btn-danger modal-btn"
                        style={{ fontSize: '0.75rem', padding: '6px 12px' }}
                      >
                        Clear All
                      </button>
                      <button onClick={() => setIsDeleting(false)} className="btn-secondary modal-btn" style={{ fontSize: '0.75rem', padding: '6px 12px' }}>Cancel</button>
                    </div>
                  </div>
                ) : (
                  <button onClick={() => setIsDeleting(true)} className="clear-history-btn" style={{ display: 'inline-flex', alignItems: 'center', gap: 8, padding: '8px 14px' }}>
                    <Trash2 size={14} style={{ marginRight: '6px' }} /> Clear History
                  </button>
                )}
              </div>
            )}
          </div>
        </div>
      </motion.div>
    </motion.div>
  );
}

// --- PRIVACY POLICY MODAL ---
function PrivacyPolicyModal({ onClose }) {
  return (
    <div className="modal-overlay" onClick={onClose}>
      <motion.div 
        initial={{ opacity: 0, scale: 0.9, y: 20 }} 
        animate={{ opacity: 1, scale: 1, y: 0 }} 
        exit={{ opacity: 0, scale: 0.9, y: 20 }}
        transition={{ type: "spring", stiffness: 300, damping: 25 }}
        className="modal-content"
        onClick={(e) => e.stopPropagation()}
        style={{
          maxWidth: '700px',
          maxHeight: '90vh',
          backgroundColor: '#ffffff',
          borderRadius: '24px',
          overflow: 'hidden',
          display: 'flex',
          flexDirection: 'column',
          boxShadow: '0 25px 80px rgba(99, 102, 241, 0.15)',
          border: 'none'
        }}
      >
        {/* Header */}
        <div style={{
          background: 'linear-gradient(135deg, #4f46e5 0%, #6366f1 100%)',
          padding: '32px 40px',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          flexShrink: 0
        }}>
          <h2 style={{ margin: 0, fontSize: '1.8rem', fontWeight: '800', color: 'white' }}>
            Privacy Policy
          </h2>
          <button
            onClick={onClose}
            style={{
              background: 'rgba(255,255,255,0.2)',
              border: 'none',
              color: 'white',
              cursor: 'pointer',
              padding: '8px',
              borderRadius: '8px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              transition: 'all 0.2s'
            }}
            onMouseEnter={(e) => e.currentTarget.style.background = 'rgba(255,255,255,0.3)'}
            onMouseLeave={(e) => e.currentTarget.style.background = 'rgba(255,255,255,0.2)'}
          >
            <X size={24} />
          </button>
        </div>

        {/* Content */}
        <div style={{
          padding: '40px',
          overflowY: 'auto',
          flex: 1
        }}>
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.1 }}
          >
            <h3 style={{ fontSize: '1.1rem', fontWeight: '700', color: '#1f2937', marginBottom: '12px' }}>
              Effective April 2026
            </h3>

            <h4 style={{ fontSize: '1rem', fontWeight: '700', color: '#1f2937', marginTop: '24px', marginBottom: '12px' }}>
              1. Introduction & Core Philosophy
            </h4>
            <p style={{ fontSize: '0.95rem', color: '#6b7280', lineHeight: '1.6', marginBottom: '24px' }}>
              FocuState is built on a simple premise: <strong>your data is yours.</strong> Our application is 100% free with no premium tiers, paywalls, or hidden costs.
            </p>

            <h4 style={{ fontSize: '1rem', fontWeight: '700', color: '#1f2937', marginTop: '24px', marginBottom: '12px' }}>
              2. Data Storage & Privacy
            </h4>
            <p style={{ fontSize: '0.95rem', color: '#6b7280', lineHeight: '1.6', marginBottom: '16px' }}>
              <strong>Everything is stored locally.</strong> All your documents, notes, flashcards, to-do lists, and focus statistics remain exclusively on your device. We do not transmit your personal content or study data to any external servers. 
            </p>

            <h4 style={{ fontSize: '1rem', fontWeight: '700', color: '#1f2937', marginTop: '24px', marginBottom: '12px' }}>
              3. Telemetry & Tracking
            </h4>
            <p style={{ fontSize: '0.95rem', color: '#6b7280', lineHeight: '1.6', marginBottom: '16px' }}>
              We don't track your behavior. There are no tracking scripts, analytics tools, or telemetry mechanisms running in the background. Your study habits and focus routines are completely private.
            </p>

            <h4 style={{ fontSize: '1rem', fontWeight: '700', color: '#1f2937', marginTop: '24px', marginBottom: '12px' }}>
              4. Open Source
            </h4>
            <p style={{ fontSize: '0.95rem', color: '#6b7280', lineHeight: '1.6', marginBottom: '16px' }}>
              The project is fully open source. You can inspect the source code yourself to verify our data processing and storage procedures. 
            </p>
          </motion.div>
        </div>
      </motion.div>
    </div>
  );
}

// --- TERMS OF SERVICE MODAL ---
function TermsOfServiceModal({ onClose }) {
  return (
    <div className="modal-overlay" onClick={onClose}>
      <motion.div 
        initial={{ opacity: 0, scale: 0.9, y: 20 }} 
        animate={{ opacity: 1, scale: 1, y: 0 }} 
        exit={{ opacity: 0, scale: 0.9, y: 20 }}
        transition={{ type: "spring", stiffness: 300, damping: 25 }}
        className="modal-content"
        onClick={(e) => e.stopPropagation()}
        style={{
          maxWidth: '700px',
          maxHeight: '90vh',
          backgroundColor: '#ffffff',
          borderRadius: '24px',
          overflow: 'hidden',
          display: 'flex',
          flexDirection: 'column',
          boxShadow: '0 25px 80px rgba(99, 102, 241, 0.15)',
          border: 'none'
        }}
      >
        {/* Header */}
        <div style={{
          background: 'linear-gradient(135deg, #4f46e5 0%, #6366f1 100%)',
          padding: '32px 40px',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          flexShrink: 0
        }}>
          <h2 style={{ margin: 0, fontSize: '1.8rem', fontWeight: '800', color: 'white' }}>
            Terms of Service
          </h2>
          <button
            onClick={onClose}
            style={{
              background: 'rgba(255,255,255,0.2)',
              border: 'none',
              color: 'white',
              cursor: 'pointer',
              padding: '8px',
              borderRadius: '8px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              transition: 'all 0.2s'
            }}
            onMouseEnter={(e) => e.currentTarget.style.background = 'rgba(255,255,255,0.3)'}
            onMouseLeave={(e) => e.currentTarget.style.background = 'rgba(255,255,255,0.2)'}
          >
            <X size={24} />
          </button>
        </div>

        {/* Content */}
        <div style={{
          padding: '40px',
          overflowY: 'auto',
          flex: 1
        }}>
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.1 }}
          >
            <h3 style={{ fontSize: '1.1rem', fontWeight: '700', color: '#1f2937', marginBottom: '12px' }}>
              Effective April 2026
            </h3>

            <h4 style={{ fontSize: '1rem', fontWeight: '700', color: '#1f2937', marginTop: '24px', marginBottom: '12px' }}>
              1. 100% Free Service
            </h4>
            <p style={{ fontSize: '0.95rem', color: '#6b7280', lineHeight: '1.6', marginBottom: '24px' }}>
              FocuState is an entirely free application. There are no premium tiers, no hidden fees, and no paid subscriptions. All features are made available to all users indiscriminately.
            </p>

            <h4 style={{ fontSize: '1rem', fontWeight: '700', color: '#1f2937', marginTop: '24px', marginBottom: '12px' }}>
              2. Open Source
            </h4>
            <p style={{ fontSize: '0.95rem', color: '#6b7280', lineHeight: '1.6', marginBottom: '24px' }}>
              The FocuState project is fully open source under the MIT License. You are free to view, modify, and distribute the source code in accordance with that license. 
            </p>

            <h4 style={{ fontSize: '1rem', fontWeight: '700', color: '#1f2937', marginTop: '24px', marginBottom: '12px' }}>
              3. Data Ownership
            </h4>
            <p style={{ fontSize: '0.95rem', color: '#6b7280', lineHeight: '1.6', marginBottom: '24px' }}>
              Since all data is stored locally on your device, you maintain full control and ownership of everything you create within this application. You are responsible for backing up your data if necessary.
            </p>

            <h4 style={{ fontSize: '1rem', fontWeight: '700', color: '#1f2937', marginTop: '24px', marginBottom: '12px' }}>
              4. Disclaimer
            </h4>
            <p style={{ fontSize: '0.95rem', color: '#6b7280', lineHeight: '1.6', marginBottom: '24px' }}>
              The service is provided on an "as-is" and "as-available" basis. FocuState makes no warranties, expressed or implied, regarding the permanence of your locally stored data or that the application will meet your specific study goals.
            </p>
          </motion.div>
        </div>
      </motion.div>
    </div>
  );
}

function TodoListModal({ onClose, todos, setTodos, theme }) {
  const [selectedDate, setSelectedDate] = useState(new Date().toISOString().slice(0, 10));
  const [newTodoTitle, setNewTodoTitle] = useState('');
  const [currentMonth, setCurrentMonth] = useState(new Date());

  const dateKey = selectedDate;
  const todaysItems = todos[dateKey] || [];

  const addTodo = () => {
    if (!newTodoTitle.trim()) return;
    const newTodo = {
      id: Date.now(),
      title: newTodoTitle,
      completed: false,
      createdAt: new Date().toISOString(),
    };
    setTodos({
      ...todos,
      [dateKey]: [...todaysItems, newTodo],
    });
    setNewTodoTitle('');
  };

  const toggleTodo = (id) => {
    setTodos({
      ...todos,
      [dateKey]: todaysItems.map(todo =>
        todo.id === id ? { ...todo, completed: !todo.completed } : todo
      ),
    });
  };

  const deleteTodo = (id) => {
    const updated = todaysItems.filter(todo => todo.id !== id);
    if (updated.length === 0) {
      const newTodos = { ...todos };
      delete newTodos[dateKey];
      setTodos(newTodos);
    } else {
      setTodos({
        ...todos,
        [dateKey]: updated,
      });
    }
  };

  const hasTodos = (dateStr) => {
    return todos[dateStr] && todos[dateStr].length > 0;
  };

  return (
    <motion.div
      className="modal-overlay"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      onClick={onClose}
    >
      <motion.div
        className={`todo-modal theme-${theme}`}
        initial={{ scale: 0.8, opacity: 0, y: 20 }}
        animate={{ scale: 1, opacity: 1, y: 0 }}
        exit={{ scale: 0.8, opacity: 0, y: 20 }}
        transition={{ duration: 0.3 }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="todo-modal-header">
          <h2>My To-Do Lists</h2>
          <motion.button
            className="close-modal-btn"
            onClick={onClose}
            whileHover={{ scale: 1.1 }}
            whileTap={{ scale: 0.95 }}
          >
            <X size={24} />
          </motion.button>
        </div>

        <div className="todo-modal-content">
          <div className="todo-calendar-section">
            <TodoCalendarWidget
              selectedDate={selectedDate}
              setSelectedDate={setSelectedDate}
              currentMonth={currentMonth}
              setCurrentMonth={setCurrentMonth}
              hasTodos={hasTodos}
            />
          </div>

          <div className="todo-list-section">
            <div className="todo-list-header">
              <h3>
                {new Date(selectedDate).toLocaleDateString('en-US', {
                  weekday: 'short',
                  year: 'numeric',
                  month: 'short',
                  day: 'numeric',
                })}
              </h3>
              <span className="todo-count">{todaysItems.length}</span>
            </div>

            <div className="todo-items-list">
              {todaysItems.length === 0 ? (
                <div className="todo-empty-state">
                  <ListTodo size={32} />
                  <p>No to-dos yet</p>
                </div>
              ) : (
                todaysItems.map(todo => (
                  <motion.div
                    key={todo.id}
                    className={`todo-item-row ${todo.completed ? 'completed' : ''}`}
                    initial={{ opacity: 0, x: -10 }}
                    animate={{ opacity: 1, x: 0 }}
                    exit={{ opacity: 0, x: 10 }}
                  >
                    <motion.button
                      className="todo-checkbox"
                      onClick={() => toggleTodo(todo.id)}
                      whileHover={{ scale: 1.15 }}
                      whileTap={{ scale: 0.95 }}
                    >
                      {todo.completed ? (
                        <CheckCircle2 size={20} />
                      ) : (
                        <Circle size={20} />
                      )}
                    </motion.button>
                    <span className="todo-text">{todo.title}</span>
                    <motion.button
                      className="delete-todo-btn"
                      onClick={() => deleteTodo(todo.id)}
                      whileHover={{ scale: 1.15 }}
                      whileTap={{ scale: 0.95 }}
                    >
                      <Trash size={16} />
                    </motion.button>
                  </motion.div>
                ))
              )}
            </div>

            <div className="add-todo-input-group">
              <input
                type="text"
                placeholder="Add a new to-do..."
                value={newTodoTitle}
                onChange={(e) => setNewTodoTitle(e.target.value)}
                onKeyPress={(e) => {
                  if (e.key === 'Enter') addTodo();
                }}
                className="todo-input-field"
              />
              <motion.button
                className="add-todo-btn"
                onClick={addTodo}
                whileHover={{ scale: 1.05 }}
                whileTap={{ scale: 0.95 }}
              >
                <Plus size={18} />
              </motion.button>
            </div>
          </div>
        </div>
      </motion.div>
    </motion.div>
  );
}




// --- TODO CALENDAR WIDGET COMPONENT ---
function TodoCalendarWidget({ selectedDate, setSelectedDate, currentMonth, setCurrentMonth, hasTodos }) {
  const getDaysInMonth = (date) => {
    return new Date(date.getFullYear(), date.getMonth() + 1, 0).getDate();
  };

  const getFirstDayOfMonth = (date) => {
    return new Date(date.getFullYear(), date.getMonth(), 1).getDay();
  };

  const daysInMonth = getDaysInMonth(currentMonth);
  const firstDay = getFirstDayOfMonth(currentMonth);
  const days = [];

  for (let i = 0; i < firstDay; i++) {
    days.push(null);
  }

  for (let i = 1; i <= daysInMonth; i++) {
    days.push(i);
  }

  const handlePrevMonth = () => {
    setCurrentMonth(new Date(currentMonth.getFullYear(), currentMonth.getMonth() - 1));
  };

  const handleNextMonth = () => {
    setCurrentMonth(new Date(currentMonth.getFullYear(), currentMonth.getMonth() + 1));
  };

  const formatDateString = (day) => {
    return `${currentMonth.getFullYear()}-${String(currentMonth.getMonth() + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  };

  const isToday = (day) => {
    const today = new Date().toISOString().slice(0, 10);
    return formatDateString(day) === today;
  };

  const isSelected = (day) => {
    return formatDateString(day) === selectedDate;
  };

  return (
    <div className="todo-calendar-widget">
      <div className="calendar-nav-header">
        <motion.button
          className="calendar-nav-btn"
          onClick={handlePrevMonth}
          whileHover={{ scale: 1.1 }}
          whileTap={{ scale: 0.9 }}
        >
          <ChevronUp size={18} />
        </motion.button>
        <h4>
          {currentMonth.toLocaleDateString('en-US', { month: 'short', year: 'numeric' })}
        </h4>
        <motion.button
          className="calendar-nav-btn"
          onClick={handleNextMonth}
          whileHover={{ scale: 1.1 }}
          whileTap={{ scale: 0.9 }}
        >
          <ChevronDown size={18} />
        </motion.button>
      </div>

      <div className="calendar-weekdays-row">
        {['S', 'M', 'T', 'W', 'T', 'F', 'S'].map((day, idx) => (
          <div key={idx} className="weekday-label">
            {day}
          </div>
        ))}
      </div>

      <div className="calendar-days-grid">
        {days.map((day, index) => (
          <motion.button
            key={index}
            className={`calendar-day-cell ${day === null ? 'empty' : ''} ${isToday(day) ? 'today' : ''} ${isSelected(day) ? 'selected' : ''} ${day && hasTodos(formatDateString(day)) ? 'has-items' : ''}`}
            onClick={() => {
              if (day) {
                setSelectedDate(formatDateString(day));
              }
            }}
            whileHover={day && !isSelected(day) ? { backgroundColor: '#e0e7ff' } : {}}
            whileTap={day ? { scale: 0.95 } : {}}
          >
            {day && <span className="day-number">{day}</span>}
            {day && hasTodos(formatDateString(day)) && <div className="todo-dot" />}
          </motion.button>
        ))}
      </div>
    </div>
  );
}
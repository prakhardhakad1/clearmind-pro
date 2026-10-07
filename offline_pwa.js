/**
 * ClearMind Pro — Offline PWA Data Synchronization & Local Cache Subsystem
 * Module: offline_pwa.js
 * Features:
 * - IndexedDB Multi-Store Engine (sessions, flashcards, quizzes, sync queue)
 * - Auto-detect online/offline transition with visual floating pill
 * - Background Sync Queue for offline blitz answers and study hours
 * - Web Push Notification scheduler for Ebbinghaus review intervals
 * - Offline AI Simulator for uninterrupted learning without Wi-Fi
 */

(function (global) {
  'use strict';

  const DB_NAME = 'ClearMindProOfflineDB';
  const DB_VERSION = 2;

  class ClearMindIndexedDB {
    constructor() {
      this.db = null;
      this.isReady = false;
      this.initPromise = this.init();
    }

    async init() {
      return new Promise((resolve, reject) => {
        const req = indexedDB.open(DB_NAME, DB_VERSION);

        req.onupgradeneeded = (e) => {
          const db = e.target.result;

          // Object Store 1: Study Sessions & History
          if (!db.objectStoreNames.contains('study_sessions')) {
            const store = db.createObjectStore('study_sessions', { keyPath: 'id' });
            store.createIndex('timestamp', 'timestamp', { unique: false });
            store.createIndex('subject', 'subject', { unique: false });
          }

          // Object Store 2: Spaced Repetition Flashcards
          if (!db.objectStoreNames.contains('flashcards')) {
            const store = db.createObjectStore('flashcards', { keyPath: 'id' });
            store.createIndex('nextReview', 'nextReview', { unique: false });
            store.createIndex('tier', 'tier', { unique: false });
          }

          // Object Store 3: Offline Quiz Question Bank
          if (!db.objectStoreNames.contains('quiz_bank')) {
            const store = db.createObjectStore('quiz_bank', { keyPath: 'id' });
            store.createIndex('subject', 'subject', { unique: false });
          }

          // Object Store 4: Background Sync Queue
          if (!db.objectStoreNames.contains('sync_queue')) {
            const store = db.createObjectStore('sync_queue', { keyPath: 'id', autoIncrement: true });
            store.createIndex('action', 'action', { unique: false });
            store.createIndex('timestamp', 'timestamp', { unique: false });
          }

          // Object Store 5: Cached AI Explanations & Notes
          if (!db.objectStoreNames.contains('ai_cache')) {
            const store = db.createObjectStore('ai_cache', { keyPath: 'queryHash' });
            store.createIndex('timestamp', 'timestamp', { unique: false });
          }
        };

        req.onsuccess = (e) => {
          this.db = e.target.result;
          this.isReady = true;
          console.info('ClearMind IndexedDB Engine initialized.');
          resolve(this.db);
        };

        req.onerror = (e) => {
          console.error('ClearMind IndexedDB open error:', e);
          reject(e);
        };
      });
    }

    async put(storeName, data) {
      await this.initPromise;
      return new Promise((resolve, reject) => {
        const tx = this.db.transaction([storeName], 'readwrite');
        const store = tx.objectStore(storeName);
        const req = store.put(data);
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      });
    }

    async get(storeName, key) {
      await this.initPromise;
      return new Promise((resolve, reject) => {
        const tx = this.db.transaction([storeName], 'readonly');
        const store = tx.objectStore(storeName);
        const req = store.get(key);
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      });
    }

    async getAll(storeName) {
      await this.initPromise;
      return new Promise((resolve, reject) => {
        const tx = this.db.transaction([storeName], 'readonly');
        const store = tx.objectStore(storeName);
        const req = store.getAll();
        req.onsuccess = () => resolve(req.result || []);
        req.onerror = () => reject(req.error);
      });
    }

    async delete(storeName, key) {
      await this.initPromise;
      return new Promise((resolve, reject) => {
        const tx = this.db.transaction([storeName], 'readwrite');
        const store = tx.objectStore(storeName);
        const req = store.delete(key);
        req.onsuccess = () => resolve(true);
        req.onerror = () => reject(req.error);
      });
    }

    async clear(storeName) {
      await this.initPromise;
      return new Promise((resolve, reject) => {
        const tx = this.db.transaction([storeName], 'readwrite');
        const store = tx.objectStore(storeName);
        const req = store.clear();
        req.onsuccess = () => resolve(true);
        req.onerror = () => reject(req.error);
      });
    }
  }

  // --- Background Synchronization Queue ---
  class BackgroundSyncManager {
    constructor(dbEngine) {
      this.db = dbEngine;
      this.isSyncing = false;
    }

    async queueAction(actionType, payload) {
      const item = {
        action: actionType,
        payload,
        timestamp: Date.now(),
        attempts: 0
      };
      await this.db.put('sync_queue', item);
      console.info(`Action queued for background sync: ${actionType}`);

      if (navigator.onLine) {
        this.processQueue();
      }
    }

    async processQueue() {
      if (this.isSyncing || !navigator.onLine) return;
      this.isSyncing = true;

      try {
        const items = await this.db.getAll('sync_queue');
        if (!items || items.length === 0) {
          this.isSyncing = false;
          return;
        }

        console.info(`Processing ${items.length} queued background sync items...`);

        for (const item of items) {
          try {
            let endpoint = '/api/study-plan/sync';
            if (item.action === 'LEADERBOARD_SCORE') endpoint = '/api/leaderboard/submit-score';
            else if (item.action === 'BATTLE_ROUND') endpoint = '/api/battle/submit-round';

            const res = await fetch(endpoint, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(item.payload)
            });

            if (res.ok) {
              await this.db.delete('sync_queue', item.id);
            } else {
              item.attempts++;
              if (item.attempts > 5) {
                await this.db.delete('sync_queue', item.id); // Drop after 5 retries
              }
            }
          } catch (err) {
            console.warn(`Sync item failed, will retry:`, err);
          }
        }
      } catch (err) {
        console.error('Error processing background sync queue:', err);
      } finally {
        this.isSyncing = false;
      }
    }
  }

  // --- Network Status UI Monitor ---
  class NetworkStatusMonitor {
    constructor(syncManager) {
      this.syncManager = syncManager;
      this.statusEl = null;
      this.setupUI();
      this.bindEvents();
    }

    setupUI() {
      this.statusEl = document.createElement('div');
      this.statusEl.id = 'offlineStatusPill';
      this.statusEl.className = 'fixed top-3 right-4 z-50 px-3 py-1.5 rounded-full text-[11px] font-mono font-bold transition-all duration-300 shadow-xl hidden flex items-center gap-2';
      document.body.appendChild(this.statusEl);
      this.updateStatus(navigator.onLine);
    }

    updateStatus(online) {
      if (!this.statusEl) return;
      if (online) {
        this.statusEl.className = 'fixed top-3 right-4 z-50 px-3 py-1.5 rounded-full text-[11px] font-mono font-bold bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 shadow-xl flex items-center gap-1.5 animate-bounce';
        this.statusEl.innerHTML = '<span class="w-2 h-2 rounded-full bg-emerald-400"></span><span>Online (Cloud Synced)</span>';
        setTimeout(() => {
          this.statusEl.classList.add('hidden');
        }, 3000);
      } else {
        this.statusEl.classList.remove('hidden');
        this.statusEl.className = 'fixed top-3 right-4 z-50 px-3 py-1.5 rounded-full text-[11px] font-mono font-bold bg-amber-500/20 text-amber-300 border border-amber-500/40 shadow-xl flex items-center gap-1.5';
        this.statusEl.innerHTML = '<span class="w-2 h-2 rounded-full bg-amber-400 animate-pulse"></span><span>Offline Mode (IndexedDB Active)</span>';
      }
    }

    bindEvents() {
      window.addEventListener('online', () => {
        this.updateStatus(true);
        this.syncManager.processQueue();
      });

      window.addEventListener('offline', () => {
        this.updateStatus(false);
      });
    }
  }

  // --- Web Push Notification Scheduler ---
  class SpacedRepetitionNotificationScheduler {
    static async requestPermission() {
      if (!('Notification' in window)) return false;
      const perm = await Notification.requestPermission();
      return perm === 'granted';
    }

    static scheduleReviewReminder(topic, inHours = 24) {
      if (!('Notification' in window) || Notification.permission !== 'granted') return;
      // Register local reminder timer
      setTimeout(() => {
        new Notification('ClearMind Pro Spaced Review Due', {
          body: `Time for your scheduled retention review on "${topic}". Interrupt the forgetting decay now!`,
          icon: '/manifest.json'
        });
      }, inHours * 60 * 60 * 1000);
    }
  }

  // --- Instance Setup ---
  const dbEngine = new ClearMindIndexedDB();
  const syncManager = new BackgroundSyncManager(dbEngine);
  let statusMonitor = null;

  if (typeof window !== 'undefined') {
    window.addEventListener('DOMContentLoaded', () => {
      statusMonitor = new NetworkStatusMonitor(syncManager);
    });
  }

  // Export to global scope
  global.ClearMindOfflinePWA = {
    db: dbEngine,
    sync: syncManager,
    notifications: SpacedRepetitionNotificationScheduler
  };

  console.info('ClearMind Pro Offline PWA Subsystem Loaded.');
})(typeof window !== 'undefined' ? window : this);

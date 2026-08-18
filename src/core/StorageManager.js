/**
 * CS_sumpler - StorageManager
 *
 * IndexedDB persistence and Project Import/Export engine:
 * - Stores audio binary blobs and project settings inside the browser
 * - Supports exporting project JSON + bundled audio for sharing between PCs
 * - Supports importing bundled project files with automatic restoration to IndexedDB
 * - Includes in-memory mock fallback for Node.js test execution
 */

const DB_NAME = 'TheaterSoundDB';
const DB_VERSION = 1;
const STORE_PROJECTS = 'projects';
const STORE_AUDIO = 'audio_files';

export class StorageManager {
  /**
   * @param {Object} [options]
   * @param {string} [options.dbName]
   * @param {Function} [options.onEvent]
   */
  constructor({
    dbName = DB_NAME,
    onEvent = null
  } = {}) {
    this.dbName = dbName;
    this.db = null;
    this.onEvent = onEvent;

    // In-memory fallback if IndexedDB is unavailable
    this._memoryProjects = new Map();
    this._memoryAudio = new Map();
    this._useMemoryFallback = false;
  }

  /**
   * Open or initialize the IndexedDB database
   * @returns {Promise<IDBDatabase|null>}
   */
  async init() {
    if (typeof indexedDB === 'undefined') {
      this._useMemoryFallback = true;
      return null;
    }

    return new Promise((resolve, reject) => {
      const request = indexedDB.open(this.dbName, DB_VERSION);

      request.onupgradeneeded = (event) => {
        const db = event.target.result;
        if (!db.objectStoreNames.contains(STORE_PROJECTS)) {
          db.createObjectStore(STORE_PROJECTS, { keyPath: 'id' });
        }
        if (!db.objectStoreNames.contains(STORE_AUDIO)) {
          db.createObjectStore(STORE_AUDIO, { keyPath: 'soundId' });
        }
      };

      request.onsuccess = (event) => {
        this.db = event.target.result;
        resolve(this.db);
      };

      request.onerror = (event) => {
        console.warn('[StorageManager] Failed to open IndexedDB, falling back to memory store:', event.target.error);
        this._useMemoryFallback = true;
        resolve(null);
      };
    });
  }

  /**
   * Save a project object to IndexedDB
   * @param {Object} project
   * @returns {Promise<void>}
   */
  async saveProject(project) {
    if (!project || !project.id) {
      throw new Error('Invalid project: Project object must have an "id" property.');
    }

    project.updatedAt = new Date().toISOString();

    if (this._useMemoryFallback || !this.db) {
      this._memoryProjects.set(project.id, JSON.parse(JSON.stringify(project)));
      return;
    }

    return new Promise((resolve, reject) => {
      const tx = this.db.transaction(STORE_PROJECTS, 'readwrite');
      const store = tx.objectStore(STORE_PROJECTS);
      const req = store.put(project);

      req.onsuccess = () => resolve();
      req.onerror = (e) => reject(e.target.error);
    });
  }

  /**
   * Load a project by ID
   * @param {string} projectId
   * @returns {Promise<Object|null>}
   */
  async loadProject(projectId) {
    if (this._useMemoryFallback || !this.db) {
      const data = this._memoryProjects.get(projectId);
      return data ? JSON.parse(JSON.stringify(data)) : null;
    }

    return new Promise((resolve, reject) => {
      const tx = this.db.transaction(STORE_PROJECTS, 'readonly');
      const store = tx.objectStore(STORE_PROJECTS);
      const req = store.get(projectId);

      req.onsuccess = () => resolve(req.result || null);
      req.onerror = (e) => reject(e.target.error);
    });
  }

  /**
   * List all saved projects (metadata only)
   * @returns {Promise<Array<Object>>}
   */
  async listProjects() {
    if (this._useMemoryFallback || !this.db) {
      return Array.from(this._memoryProjects.values()).map(p => ({
        id: p.id,
        name: p.name,
        updatedAt: p.updatedAt,
        actsCount: p.acts ? p.acts.length : 0,
        soundsCount: p.sounds ? p.sounds.length : 0
      }));
    }

    return new Promise((resolve, reject) => {
      const tx = this.db.transaction(STORE_PROJECTS, 'readonly');
      const store = tx.objectStore(STORE_PROJECTS);
      const req = store.getAll();

      req.onsuccess = () => {
        const list = (req.result || []).map(p => ({
          id: p.id,
          name: p.name,
          updatedAt: p.updatedAt,
          actsCount: p.acts ? p.acts.length : 0,
          soundsCount: p.sounds ? p.sounds.length : 0
        }));
        resolve(list);
      };
      req.onerror = (e) => reject(e.target.error);
    });
  }

  /**
   * Save an audio binary file to IndexedDB
   * @param {string} soundId
   * @param {Blob|ArrayBuffer} data Audio binary
   * @param {Object} metadata { name, fileName, fileType, fileSize, duration }
   * @returns {Promise<void>}
   */
  async saveAudioFile(soundId, data, metadata = {}) {
    const record = {
      soundId,
      name: metadata.name || '音声',
      fileName: metadata.fileName || '',
      fileType: metadata.fileType || 'audio/mpeg',
      fileSize: metadata.fileSize || 0,
      duration: metadata.duration || 0,
      data,
      savedAt: new Date().toISOString()
    };

    if (this._useMemoryFallback || !this.db) {
      this._memoryAudio.set(soundId, record);
      return;
    }

    return new Promise((resolve, reject) => {
      const tx = this.db.transaction(STORE_AUDIO, 'readwrite');
      const store = tx.objectStore(STORE_AUDIO);
      const req = store.put(record);

      req.onsuccess = () => resolve();
      req.onerror = (e) => reject(e.target.error);
    });
  }

  /**
   * Retrieve an audio file from IndexedDB
   * @param {string} soundId
   * @returns {Promise<Object|null>} Record with .data (Blob/ArrayBuffer)
   */
  async getAudioFile(soundId) {
    if (this._useMemoryFallback || !this.db) {
      return this._memoryAudio.get(soundId) || null;
    }

    return new Promise((resolve, reject) => {
      const tx = this.db.transaction(STORE_AUDIO, 'readonly');
      const store = tx.objectStore(STORE_AUDIO);
      const req = store.get(soundId);

      req.onsuccess = () => resolve(req.result || null);
      req.onerror = (e) => reject(e.target.error);
    });
  }

  /**
   * Retrieve all saved audio file records
   * @returns {Promise<Array<Object>>}
   */
  async getAllAudioFiles() {
    if (this._useMemoryFallback || !this.db) {
      return Array.from(this._memoryAudio.values());
    }

    return new Promise((resolve, reject) => {
      const tx = this.db.transaction(STORE_AUDIO, 'readonly');
      const store = tx.objectStore(STORE_AUDIO);
      const req = store.getAll();

      req.onsuccess = () => resolve(req.result || []);
      req.onerror = (e) => reject(e.target.error);
    });
  }

  /**
   * Delete an audio file by soundId
   * @param {string} soundId
   * @returns {Promise<void>}
   */
  async deleteAudioFile(soundId) {
    if (this._useMemoryFallback || !this.db) {
      this._memoryAudio.delete(soundId);
      return;
    }

    return new Promise((resolve, reject) => {
      const tx = this.db.transaction(STORE_AUDIO, 'readwrite');
      const store = tx.objectStore(STORE_AUDIO);
      const req = store.delete(soundId);

      req.onsuccess = () => resolve();
      req.onerror = (e) => reject(e.target.error);
    });
  }

  /**
   * Export a self-contained Project Bundle (Project Metadata + Base64-encoded audio files)
   * Suitable for downloading as a single `.theatersound` / `.json` file.
   *
   * @param {Object} project
   * @returns {Promise<string>} JSON string of the bundle
   */
  async exportProjectBundle(project) {
    const audioFiles = await this.getAllAudioFiles();
    const soundIdSet = new Set((project.sounds || []).map(s => s.id));

    const bundledAudio = [];
    for (const record of audioFiles) {
      if (soundIdSet.has(record.soundId)) {
        let base64Data = '';
        if (record.data instanceof ArrayBuffer) {
          base64Data = this._arrayBufferToBase64(record.data);
        } else if (typeof Blob !== 'undefined' && record.data instanceof Blob) {
          const ab = await record.data.arrayBuffer();
          base64Data = this._arrayBufferToBase64(ab);
        } else if (typeof record.data === 'string') {
          base64Data = record.data;
        }

        bundledAudio.push({
          soundId: record.soundId,
          name: record.name,
          fileName: record.fileName,
          fileType: record.fileType,
          fileSize: record.fileSize,
          duration: record.duration,
          base64: base64Data
        });
      }
    }

    const bundle = {
      format: 'CS_sumpler_project_bundle',
      version: '1.0.0',
      exportedAt: new Date().toISOString(),
      project,
      audioFiles: bundledAudio
    };

    return JSON.stringify(bundle, null, 2);
  }

  /**
   * Import a Project Bundle (JSON string or Object) and restore into IndexedDB
   * @param {string|Object} bundleInput
   * @returns {Promise<Object>} Restored Project Object
   */
  async importProjectBundle(bundleInput) {
    const bundle = typeof bundleInput === 'string' ? JSON.parse(bundleInput) : bundleInput;

    if (!bundle || !bundle.project) {
      throw new Error('Invalid project bundle: Missing project metadata.');
    }

    const project = bundle.project;

    // Restore project structure
    await this.saveProject(project);

    // Restore audio files if present
    if (Array.isArray(bundle.audioFiles)) {
      for (const item of bundle.audioFiles) {
        if (item.soundId && item.base64) {
          const arrayBuffer = this._base64ToArrayBuffer(item.base64);
          await this.saveAudioFile(item.soundId, arrayBuffer, {
            name: item.name,
            fileName: item.fileName,
            fileType: item.fileType,
            fileSize: item.fileSize,
            duration: item.duration
          });
        }
      }
    }

    return project;
  }

  /**
   * Helper: ArrayBuffer to Base64
   */
  _arrayBufferToBase64(buffer) {
    if (typeof Buffer !== 'undefined') {
      return Buffer.from(buffer).toString('base64');
    }
    let binary = '';
    const bytes = new Uint8Array(buffer);
    const len = bytes.byteLength;
    for (let i = 0; i < len; i++) {
      binary += String.fromCharCode(bytes[i]);
    }
    return btoa(binary);
  }

  /**
   * Helper: Base64 to ArrayBuffer
   */
  _base64ToArrayBuffer(base64) {
    if (typeof Buffer !== 'undefined') {
      const buf = Buffer.from(base64, 'base64');
      return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
    }
    const binaryString = atob(base64);
    const len = binaryString.length;
    const bytes = new Uint8Array(len);
    for (let i = 0; i < len; i++) {
      bytes[i] = binaryString.charCodeAt(i);
    }
    return bytes.buffer;
  }
}

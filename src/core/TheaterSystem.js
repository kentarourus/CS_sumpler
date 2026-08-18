/**
 * CS_sumpler - TheaterSystem
 *
 * Central Unified Facade connecting:
 * - AudioEngine (Web Audio API, rate, detune, polyphony, pause/resume)
 * - CueManager (Multi-Act script and cue sequencer)
 * - KeymapManager (Physical key mapping & safety controls)
 * - StorageManager (IndexedDB persistence & Project Bundles)
 *
 * Provides a clean reactive Event Bus for the upcoming UI layer.
 */

import { AudioEngine } from './AudioEngine.js';
import { CueManager } from './CueManager.js';
import { KeymapManager } from './KeymapManager.js';
import { StorageManager } from './StorageManager.js';
import {
  ActionType,
  SystemEvent,
  createDefaultProject,
  createSoundItem,
  generateId
} from '../types/models.js';

export class TheaterSystem {
  /**
   * @param {Object} [options]
   * @param {AudioContext} [options.audioContext] Optional custom context
   * @param {string} [options.dbName] Optional custom DB name
   */
  constructor(options = {}) {
    this.options = options;

    // Active Project State
    this.project = createDefaultProject();

    // Event Bus listeners: eventName -> Set<Function>
    this.listeners = new Map();

    // Core Subsystems
    this.storage = new StorageManager({
      dbName: options.dbName,
      onEvent: (event, data) => this.emit(event, data)
    });

    this.audio = new AudioEngine({
      audioContext: options.audioContext,
      masterVolume: this.project.settings.masterVolume,
      onEvent: (event, data) => this._handleAudioEvent(event, data)
    });

    this.cues = new CueManager({
      acts: this.project.acts,
      activeActId: this.project.activeActId,
      onEvent: (event, data) => this._handleCueEvent(event, data)
    });

    this.keymap = new KeymapManager({
      keymaps: this.project.keymaps,
      onAction: (action, binding, event) => this._handleKeyAction(action, binding, event),
      onEvent: (event, data) => this.emit(event, data)
    });

    this.isInitialized = false;
  }

  /**
   * Initialize all subsystems, load saved project and audio files
   * @returns {Promise<void>}
   */
  async init() {
    if (this.isInitialized) return;

    // 1. Initialize Storage (IndexedDB)
    await this.storage.init();

    // 2. Load latest project or fallback to default
    const savedProjects = await this.storage.listProjects();
    if (savedProjects.length > 0) {
      const latest = savedProjects.sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt))[0];
      const fullProject = await this.storage.loadProject(latest.id);
      if (fullProject) {
        this.project = fullProject;
      }
    }

    // Synchronize submodules with loaded project state
    this._syncProjectToModules();

    // 3. Preload saved audio files into AudioEngine
    await this._preloadAudioFromStorage();

    // 4. Start Key listener
    this.keymap.startListening();

    this.isInitialized = true;
    this.emit(SystemEvent.STATE_CHANGE, { project: this.project });
  }

  /**
   * Sync active project data to all submodules
   */
  _syncProjectToModules() {
    this.audio.setMasterVolume(this.project.settings.masterVolume);
    if (this.project.settings.isMuted) {
      this.audio.isMuted = true;
    }

    this.cues.loadData({
      acts: this.project.acts,
      activeActId: this.project.activeActId
    });

    this.keymap.setAllBindings(this.project.keymaps);
  }

  /**
   * Preload audio files from IndexedDB into AudioEngine
   */
  async _preloadAudioFromStorage() {
    const audioRecords = await this.storage.getAllAudioFiles();
    for (const record of audioRecords) {
      if (record.data) {
        try {
          await this.audio.loadSound(record.soundId, record.data);
        } catch (err) {
          console.warn(`[TheaterSystem] Failed to decode cached sound ${record.soundId}:`, err);
        }
      }
    }
  }

  /**
   * Request browser audio context unlock on user gesture
   */
  async unlockAudio() {
    const success = await this.audio.unlockAudioContext();
    if (success) {
      this.emit('audio:unlocked', {});
    }
    return success;
  }

  // ==========================================
  // Project Management API
  // ==========================================

  /**
   * Get the active Project object
   * @returns {Object}
   */
  getProject() {
    this.project.acts = this.cues.acts;
    this.project.activeActId = this.cues.activeActId;
    this.project.keymaps = this.keymap.getAllBindings();
    return this.project;
  }

  /**
   * Save current project state to IndexedDB
   */
  async saveProject() {
    const current = this.getProject();
    await this.storage.saveProject(current);
    this.emit('project:saved', { project: current });
  }

  /**
   * Create a new project
   * @param {string} [name]
   */
  async createNewProject(name = '新規演劇プロジェクト') {
    this.audio.clearAll();
    this.project = createDefaultProject(name);
    this._syncProjectToModules();
    await this.saveProject();
    this.emit(SystemEvent.STATE_CHANGE, { project: this.project });
  }

  /**
   * Export the entire project and its audio files as a single bundle
   * @returns {Promise<string>}
   */
  async exportProjectBundle() {
    return this.storage.exportProjectBundle(this.getProject());
  }

  /**
   * Import a project bundle (JSON / object) and load it
   * @param {string|Object} bundleData
   */
  async importProjectBundle(bundleData) {
    this.audio.clearAll();
    const loadedProject = await this.storage.importProjectBundle(bundleData);
    this.project = loadedProject;
    this._syncProjectToModules();
    await this._preloadAudioFromStorage();
    this.emit(SystemEvent.STATE_CHANGE, { project: this.project });
    return loadedProject;
  }

  // ==========================================
  // Audio Registration API
  // ==========================================

  /**
   * Register a new audio file (File, Blob, or ArrayBuffer) into the system
   *
   * @param {File|Blob|ArrayBuffer} fileOrBuffer
   * @param {Object} [meta] { name, fileName, fileType }
   * @returns {Promise<Object>} Created SoundItem
   */
  async registerAudioFile(fileOrBuffer, meta = {}) {
    const soundId = generateId('snd');
    const fileName = meta.fileName || (fileOrBuffer.name ? fileOrBuffer.name : 'sound.mp3');
    const name = meta.name || fileName.replace(/\.[^/.]+$/, '');
    const fileType = meta.fileType || (fileOrBuffer.type ? fileOrBuffer.type : 'audio/mpeg');
    const fileSize = meta.fileSize || (fileOrBuffer.size ? fileOrBuffer.size : 0);

    // 1. Decode audio into Web Audio memory buffer
    const audioBuffer = await this.audio.loadSound(soundId, fileOrBuffer);
    const duration = audioBuffer.duration;

    // 2. Save raw binary into IndexedDB
    await this.storage.saveAudioFile(soundId, fileOrBuffer, {
      name,
      fileName,
      fileType,
      fileSize,
      duration
    });

    // 3. Create sound item metadata and add to project
    const soundItem = createSoundItem({
      id: soundId,
      name,
      fileName,
      fileType,
      fileSize,
      duration
    });

    if (!Array.isArray(this.project.sounds)) {
      this.project.sounds = [];
    }
    this.project.sounds.push(soundItem);

    await this.saveProject();
    this.emit('sound:registered', { soundItem, sounds: this.project.sounds });
    return soundItem;
  }

  /**
   * Remove an audio file from the project and memory
   * @param {string} soundId
   */
  async removeAudioFile(soundId) {
    this.audio.unloadSound(soundId);
    await this.storage.deleteAudioFile(soundId);

    if (Array.isArray(this.project.sounds)) {
      this.project.sounds = this.project.sounds.filter(s => s.id !== soundId);
    }

    // Clean up direct key assignments and cues referencing this sound
    const bindings = this.keymap.getAllBindings();
    for (const [code, binding] of Object.entries(bindings)) {
      if (binding.soundId === soundId) {
        binding.soundId = null;
      }
    }
    this.keymap.setAllBindings(bindings);

    await this.saveProject();
    this.emit('sound:removed', { soundId, sounds: this.project.sounds });
  }

  /**
   * Get registered sound metadata by ID
   * @param {string} soundId
   * @returns {Object|null}
   */
  getSound(soundId) {
    return (this.project.sounds || []).find(s => s.id === soundId) || null;
  }

  /**
   * Get all registered sound items
   * @returns {Array<Object>}
   */
  getAllSounds() {
    return this.project.sounds || [];
  }

  // ==========================================
  // Playback & Cue Execution API
  // ==========================================

  /**
   * Trigger direct SE by soundId or physical key code
   * @param {string} soundIdOrCode
   * @param {Object} [overrideOptions]
   * @returns {AudioTrack|null}
   */
  playDirectSound(soundIdOrCode, overrideOptions = {}) {
    let soundId = soundIdOrCode;

    // Check if a key code was passed
    const binding = this.keymap.getBinding(soundIdOrCode);
    if (binding && binding.soundId) {
      soundId = binding.soundId;
    }

    const soundItem = this.getSound(soundId);
    const name = soundItem ? soundItem.name : '';

    const options = {
      name,
      volume: soundItem ? soundItem.defaultVolume : 1.0,
      playbackRate: soundItem ? soundItem.defaultPlaybackRate : 1.0,
      detune: soundItem ? soundItem.defaultDetune : 0,
      overlapMode: soundItem ? soundItem.defaultOverlapMode : 'overlap',
      ...overrideOptions
    };

    return this.audio.playSound(soundId, options);
  }

  /**
   * Trigger the current cue (Space/Enter)
   * Plays the cue's associated sound with its volume/rate/pitch overrides and auto-advances.
   */
  triggerCue() {
    return this.cues.triggerCurrentCue((cue) => {
      if (!cue.soundId) return null;
      return this.audio.playSound(cue.soundId, {
        name: cue.name,
        volume: cue.volume,
        playbackRate: cue.playbackRate,
        detune: cue.detune,
        loop: cue.loop,
        overlapMode: cue.overlapMode,
        fadeDuration: cue.fadeDuration
      });
    });
  }

  /**
   * Step cue cursor forward by +1 without playing (ArrowDown)
   */
  stepCueNext() {
    return this.cues.stepNext();
  }

  /**
   * Step cue cursor backward by -1 without playing (ArrowUp / Rewind)
   */
  stepCuePrev() {
    return this.cues.stepPrev();
  }

  /**
   * Jump directly to a cue in a given act
   * @param {string} actId
   * @param {number} index
   */
  jumpToCue(actId, index) {
    this.cues.jumpTo(actId, index);
  }

  /**
   * Pause or resume the currently playing / last played audio track
   */
  pauseResumeCurrent() {
    if (this.audio.lastPlayedTrackId) {
      const track = this.audio.activeTracks.get(this.audio.lastPlayedTrackId);
      if (track) {
        track.toggle();
        return;
      }
    }
    // If no active track, toggle all
    const hasPlaying = Array.from(this.audio.activeTracks.values()).some(t => t.state === 'playing');
    if (hasPlaying) {
      this.audio.pauseAll();
    } else {
      this.audio.resumeAll();
    }
  }

  /**
   * Pause a specific active track
   * @param {string} trackId
   */
  pauseTrack(trackId) {
    this.audio.pauseTrack(trackId);
  }

  /**
   * Resume a specific active track
   * @param {string} trackId
   */
  resumeTrack(trackId) {
    this.audio.resumeTrack(trackId);
  }

  /**
   * Toggle pause/resume for a specific track
   * @param {string} trackId
   */
  toggleTrack(trackId) {
    this.audio.toggleTrack(trackId);
  }

  /**
   * Stop a specific active track
   * @param {string} trackId
   * @param {number} [fadeDuration]
   */
  stopTrack(trackId, fadeDuration) {
    const fade = fadeDuration !== undefined
      ? fadeDuration
      : (this.project.settings.enableClicklessStop ? (this.project.settings.stopFadeDuration || 0.03) : 0);
    this.audio.stopTrack(trackId, fade);
  }

  /**
   * Set volume for a specific active track
   * @param {string} trackId
   * @param {number} volume
   */
  setTrackVolume(trackId, volume) {
    this.audio.setTrackVolume(trackId, volume);
  }

  /**
   * Pause all active playing tracks
   */
  pauseAll() {
    this.audio.pauseAll();
  }

  /**
   * Resume all paused tracks
   */
  resumeAll() {
    this.audio.resumeAll();
  }

  /**
   * Panic Stop (Esc): Emergency stop for all active audio
   */
  panicStop() {
    const fade = this.project.settings.enableClicklessStop ? (this.project.settings.stopFadeDuration || 0.03) : 0;
    this.audio.stopAll(fade);
  }

  /**
   * Stop Last Played Sound (Backspace)
   */
  stopLast() {
    const fade = this.project.settings.enableClicklessStop ? (this.project.settings.stopFadeDuration || 0.03) : 0;
    return this.audio.stopLast(fade);
  }

  /**
   * Set master volume (0.0 to 2.0)
   * @param {number} vol
   */
  setMasterVolume(vol) {
    this.project.settings.masterVolume = vol;
    this.audio.setMasterVolume(vol);
  }

  /**
   * Toggle master mute (M)
   */
  toggleMute() {
    const isMuted = this.audio.toggleMasterMute();
    this.project.settings.isMuted = isMuted;
    return isMuted;
  }

  /**
   * Switch to next Act (PageDown)
   */
  nextAct() {
    return this.cues.nextAct();
  }

  /**
   * Switch to previous Act (PageUp)
   */
  prevAct() {
    return this.cues.prevAct();
  }

  /**
   * Get active voice tracks summary for UI visualizer
   */
  getActiveTracks() {
    return this.audio.getActiveTracksSummary();
  }

  // ==========================================
  // Keymap Configuration API
  // ==========================================

  /**
   * Bind a sound directly to a physical key
   * @param {string} code e.g. 'Digit1', 'KeyQ', 'Numpad1'
   * @param {string} soundId
   * @param {string} [customName]
   */
  assignDirectSoundKey(code, soundId, customName = '') {
    const soundItem = this.getSound(soundId);
    const label = customName || (soundItem ? soundItem.name : `SE (${code})`);
    this.keymap.bindKey(code, {
      action: ActionType.PLAY_DIRECT,
      soundId,
      label
    });
    this.project.keymaps = this.keymap.getAllBindings();
    this.saveProject();
  }

  /**
   * Clear binding for a key
   * @param {string} code
   */
  unassignKey(code) {
    this.keymap.unbindKey(code);
    this.project.keymaps = this.keymap.getAllBindings();
    this.saveProject();
  }

  // ==========================================
  // Event Routing & Pub/Sub
  // ==========================================

  _handleKeyAction(action, binding, event) {
    switch (action) {
      case ActionType.PLAY_DIRECT:
        if (binding.soundId) {
          this.playDirectSound(binding.soundId);
        }
        break;
      case ActionType.CUE_TRIGGER:
        this.triggerCue();
        break;
      case ActionType.CUE_NEXT:
        this.stepCueNext();
        break;
      case ActionType.CUE_PREV:
        this.stepCuePrev();
        break;
      case ActionType.PANIC_STOP:
        this.panicStop();
        break;
      case ActionType.STOP_LAST:
        this.stopLast();
        break;
      case ActionType.PAUSE_RESUME_CURRENT:
        this.pauseResumeCurrent();
        break;
      case ActionType.MUTE_TOGGLE:
        this.toggleMute();
        break;
      case ActionType.ACT_NEXT:
        this.nextAct();
        break;
      case ActionType.ACT_PREV:
        this.prevAct();
        break;
      default:
        break;
    }
  }

  _handleAudioEvent(event, data) {
    this.emit(event, data);
  }

  _handleCueEvent(event, data) {
    this.emit(event, data);
  }

  /**
   * Subscribe to system events
   * @param {string} event
   * @param {Function} callback
   */
  on(event, callback) {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, new Set());
    }
    this.listeners.get(event).add(callback);
    return () => this.off(event, callback);
  }

  /**
   * Unsubscribe from system events
   * @param {string} event
   * @param {Function} callback
   */
  off(event, callback) {
    if (this.listeners.has(event)) {
      this.listeners.get(event).delete(callback);
    }
  }

  /**
   * Broadcast an event to all subscribers
   * @param {string} event
   * @param {any} data
   */
  emit(event, data) {
    if (this.listeners.has(event)) {
      for (const cb of this.listeners.get(event)) {
        try {
          cb(data);
        } catch (err) {
          console.error(`[TheaterSystem] Listener error on event "${event}":`, err);
        }
      }
    }
  }

  /**
   * Dispose and cleanup system
   */
  dispose() {
    this.keymap.stopListening();
    this.audio.clearAll();
    this.listeners.clear();
  }
}

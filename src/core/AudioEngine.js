/**
 * CS_sumpler - AudioEngine
 *
 * Core Web Audio API management engine providing:
 * - Polyphonic concurrent audio playback
 * - Global audio graph with Master Gain and Mute controls
 * - Multi-format audio decoding (MP3, WAV, OGG, AAC/M4A, FLAC, WebM)
 * - Emergency Panic Stop (Esc) and Last-played Stop (Backspace)
 * - Flexible Overlap Modes: Overlap, Restart, Toggle, Single
 * - Global & Per-track Pause / Resume support
 * - Event-driven callbacks for UI state updates
 */

import { AudioTrack } from './AudioTrack.js';
import { OverlapMode, PlaybackState, generateId } from '../types/models.js';

export class AudioEngine {
  /**
   * @param {Object} [options]
   * @param {AudioContext} [options.audioContext] Optional custom AudioContext (e.g. for testing)
   * @param {number} [options.masterVolume=1.0]
   * @param {Function} [options.onEvent] Global event emitter callback
   */
  constructor({
    audioContext = null,
    masterVolume = 1.0,
    onEvent = null
  } = {}) {
    this._customContext = audioContext;
    this.audioContext = null;
    this.masterGainNode = null;

    this.masterVolume = Math.max(0, Math.min(2.0, Number(masterVolume) || 1.0));
    this.isMuted = false;
    this._unmutedVolume = this.masterVolume;

    // Cache of decoded AudioBuffers: soundId -> AudioBuffer
    this.buffers = new Map();

    // Sound metadata cache: soundId -> { duration, sampleRate, numberOfChannels }
    this.soundMetadata = new Map();

    // Active playback voices: trackId -> AudioTrack
    this.activeTracks = new Map();

    // History tracking
    this.lastPlayedTrackId = null;
    this.isUnlocked = false;

    this.onEvent = onEvent;

    this._initContext();
  }

  /**
   * Initialize AudioContext and Master Gain
   */
  _initContext() {
    if (this._customContext) {
      this.audioContext = this._customContext;
    } else if (typeof window !== 'undefined') {
      const AudioContextClass = window.AudioContext || window.webkitAudioContext;
      if (AudioContextClass) {
        this.audioContext = new AudioContextClass();
      }
    }

    if (this.audioContext) {
      try {
        this.masterGainNode = this.audioContext.createGain();
        this.masterGainNode.gain.setValueAtTime(this.masterVolume, this.audioContext.currentTime);
        this.masterGainNode.connect(this.audioContext.destination);
      } catch (e) {
        console.warn('[AudioEngine] Could not initialize master gain node:', e);
      }
    }
  }

  /**
   * Unlock AudioContext on first user interaction (browser autoplay policy requirement)
   * @returns {Promise<boolean>}
   */
  async unlockAudioContext() {
    if (!this.audioContext) {
      this._initContext();
    }

    if (!this.audioContext) {
      return false;
    }

    if (this.audioContext.state === 'suspended') {
      try {
        await this.audioContext.resume();
      } catch (err) {
        console.warn('[AudioEngine] Error unlocking audio context:', err);
      }
    }

    this.isUnlocked = this.audioContext.state === 'running';
    return this.isUnlocked;
  }

  /**
   * Decode and cache an audio file from ArrayBuffer or Blob
   * Supports all formats decodable by browser Web Audio API (MP3, WAV, OGG, M4A, FLAC, WebM)
   *
   * @param {string} soundId Unique sound ID
   * @param {ArrayBuffer|Blob} arrayBufferOrBlob Raw audio data
   * @returns {Promise<AudioBuffer>}
   */
  async loadSound(soundId, arrayBufferOrBlob) {
    if (!this.audioContext) {
      this._initContext();
    }
    if (!this.audioContext) {
      throw new Error('AudioContext is not available in current environment.');
    }

    let bufferData;
    if (typeof Blob !== 'undefined' && arrayBufferOrBlob instanceof Blob) {
      bufferData = await arrayBufferOrBlob.arrayBuffer();
    } else if (arrayBufferOrBlob instanceof ArrayBuffer) {
      bufferData = arrayBufferOrBlob;
    } else {
      throw new Error('Invalid audio data format: Expected ArrayBuffer or Blob.');
    }

    // Clone buffer data to avoid detached buffer issues in some browser implementations
    const bufferCopy = bufferData.slice(0);

    try {
      // Use Promise-based decodeAudioData with callback fallback
      let audioBuffer;
      if (this.audioContext.decodeAudioData.length === 1) {
        audioBuffer = await this.audioContext.decodeAudioData(bufferCopy);
      } else {
        audioBuffer = await new Promise((resolve, reject) => {
          this.audioContext.decodeAudioData(bufferCopy, resolve, reject);
        });
      }

      this.buffers.set(soundId, audioBuffer);
      this.soundMetadata.set(soundId, {
        duration: audioBuffer.duration,
        sampleRate: audioBuffer.sampleRate,
        numberOfChannels: audioBuffer.numberOfChannels
      });

      return audioBuffer;
    } catch (err) {
      console.error(`[AudioEngine] Failed to decode audio data for soundId: ${soundId}`, err);
      throw new Error(`Audio decode failed for soundId "${soundId}": ${err.message}`);
    }
  }

  /**
   * Register a pre-created AudioBuffer directly (useful for tests and synthesizers)
   * @param {string} soundId
   * @param {AudioBuffer} audioBuffer
   */
  registerBuffer(soundId, audioBuffer) {
    this.buffers.set(soundId, audioBuffer);
    this.soundMetadata.set(soundId, {
      duration: audioBuffer.duration,
      sampleRate: audioBuffer.sampleRate,
      numberOfChannels: audioBuffer.numberOfChannels
    });
  }

  /**
   * Check if sound is loaded in memory
   * @param {string} soundId
   * @returns {boolean}
   */
  hasSound(soundId) {
    return this.buffers.has(soundId);
  }

  /**
   * Get duration of a loaded sound in seconds
   * @param {string} soundId
   * @returns {number}
   */
  getDuration(soundId) {
    const meta = this.soundMetadata.get(soundId);
    return meta ? meta.duration : 0;
  }

  /**
   * Unload a sound from memory
   * @param {string} soundId
   */
  unloadSound(soundId) {
    // Stop any playing tracks with this soundId
    for (const [trackId, track] of this.activeTracks.entries()) {
      if (track.soundId === soundId) {
        track.stop(0);
        this.activeTracks.delete(trackId);
      }
    }
    this.buffers.delete(soundId);
    this.soundMetadata.delete(soundId);
  }

  /**
   * Clear all sound buffers from memory
   */
  clearAll() {
    this.stopAll(0);
    this.buffers.clear();
    this.soundMetadata.clear();
    this.activeTracks.clear();
    this.lastPlayedTrackId = null;
  }

  /**
   * Play a loaded sound with full control options
   *
   * @param {string} soundId Sound buffer ID
   * @param {Object} [options] Playback configuration
   * @param {string} [options.name] Display name for the track
   * @param {number} [options.volume=1.0] Track volume (0.0 - 2.0)
   * @param {number} [options.playbackRate=1.0] Playback speed (0.25 - 4.0)
   * @param {number} [options.detune=0] Pitch offset in cents (-2400 to +2400)
   * @param {boolean} [options.loop=false] Loop playback
   * @param {string} [options.overlapMode=OverlapMode.OVERLAP] 'overlap'|'restart'|'toggle'|'single'
   * @param {number} [options.fadeDuration=0] Micro-fade duration
   * @param {number} [options.startOffset=0] Starting offset in seconds
   * @returns {AudioTrack|null} Created AudioTrack instance or null if prevented
   */
  playSound(soundId, options = {}) {
    const audioBuffer = this.buffers.get(soundId);
    if (!audioBuffer) {
      this._emit('error', { message: `Audio buffer for soundId "${soundId}" not found.` });
      return null;
    }

    const {
      name = '',
      volume = 1.0,
      playbackRate = 1.0,
      detune = 0,
      loop = false,
      overlapMode = OverlapMode.OVERLAP,
      fadeDuration = 0,
      startOffset = 0
    } = options;

    // Find any existing active tracks for this soundId
    const existingTracks = Array.from(this.activeTracks.values()).filter(t => t.soundId === soundId);

    // Handle OverlapMode rules
    if (overlapMode === OverlapMode.SINGLE) {
      const isPlaying = existingTracks.some(t => t.state === PlaybackState.PLAYING);
      if (isPlaying) {
        // Ignore trigger while still playing
        return null;
      }
    } else if (overlapMode === OverlapMode.RESTART) {
      // Stop all currently playing instances of this sound
      for (const track of existingTracks) {
        track.stop(fadeDuration);
        this.activeTracks.delete(track.id);
      }
    } else if (overlapMode === OverlapMode.TOGGLE) {
      const activePlaying = existingTracks.find(t => t.state === PlaybackState.PLAYING);
      if (activePlaying) {
        activePlaying.pause();
        return activePlaying;
      }
      const activePaused = existingTracks.find(t => t.state === PlaybackState.PAUSED);
      if (activePaused) {
        activePaused.resume();
        return activePaused;
      }
    }

    // Create new voice track
    const trackId = generateId('trk');
    const track = new AudioTrack({
      id: trackId,
      soundId,
      name,
      audioContext: this.audioContext,
      audioBuffer,
      destinationNode: this.masterGainNode || this.audioContext.destination,
      volume,
      playbackRate,
      detune,
      loop,
      fadeDuration,
      onStateChange: (t, newState) => {
        this._emit('track:state', { trackId: t.id, soundId: t.soundId, state: newState, track: t });
        if (newState === PlaybackState.STOPPED || newState === PlaybackState.ENDED) {
          this.activeTracks.delete(t.id);
        }
      },
      onEnded: (t) => {
        this._emit('track:ended', { trackId: t.id, soundId: t.soundId, track: t });
        this.activeTracks.delete(t.id);
      }
    });

    this.activeTracks.set(trackId, track);
    this.lastPlayedTrackId = trackId;

    // Start playback
    track.play(startOffset);
    this._emit('track:play', { trackId, soundId, track });

    return track;
  }

  /**
   * Pause a specific active track
   * @param {string} trackId
   */
  pauseTrack(trackId) {
    const track = this.activeTracks.get(trackId);
    if (track) {
      track.pause();
      this._emit('track:pause', { trackId, soundId: track.soundId, track });
    }
  }

  /**
   * Resume a specific paused track
   * @param {string} trackId
   */
  resumeTrack(trackId) {
    const track = this.activeTracks.get(trackId);
    if (track) {
      track.resume();
      this._emit('track:resume', { trackId, soundId: track.soundId, track });
    }
  }

  /**
   * Stop a specific active track
   * @param {string} trackId
   * @param {number} [fadeDuration=0]
   */
  stopTrack(trackId, fadeDuration = 0) {
    const track = this.activeTracks.get(trackId);
    if (track) {
      track.stop(fadeDuration);
      this.activeTracks.delete(trackId);
      this._emit('track:stop', { trackId, soundId: track.soundId, track });
    }
  }

  /**
   * Panic Stop (Esc): Stop all currently active audio voices immediately
   * @param {number} [fadeDuration=0.03] Small fade to prevent audio clicking, 0 for instant
   */
  stopAll(fadeDuration = 0.03) {
    const tracksToStop = Array.from(this.activeTracks.values());
    for (const track of tracksToStop) {
      try {
        track.stop(fadeDuration);
      } catch (err) {
        console.warn(`Error stopping track ${track.id}:`, err);
      }
    }
    this.activeTracks.clear();
    this._emit('all:stop', { stoppedCount: tracksToStop.length });
  }

  /**
   * Stop Last Played Sound (Backspace): Stops only the most recently triggered sound
   * @param {number} [fadeDuration=0.03]
   * @returns {boolean} Whether a sound was stopped
   */
  stopLast(fadeDuration = 0.03) {
    if (this.lastPlayedTrackId && this.activeTracks.has(this.lastPlayedTrackId)) {
      const track = this.activeTracks.get(this.lastPlayedTrackId);
      track.stop(fadeDuration);
      this.activeTracks.delete(this.lastPlayedTrackId);
      this._emit('track:stop', { trackId: track.id, soundId: track.soundId, track });
      this.lastPlayedTrackId = null;
      return true;
    }

    // If lastPlayedTrackId is already gone, find the newest active track
    const activeList = Array.from(this.activeTracks.values());
    if (activeList.length > 0) {
      const last = activeList[activeList.length - 1];
      last.stop(fadeDuration);
      this.activeTracks.delete(last.id);
      this._emit('track:stop', { trackId: last.id, soundId: last.soundId, track: last });
      return true;
    }

    return false;
  }

  /**
   * Pause all currently playing sounds
   */
  pauseAll() {
    for (const track of this.activeTracks.values()) {
      if (track.state === PlaybackState.PLAYING) {
        track.pause();
      }
    }
    this._emit('all:pause', {});
  }

  /**
   * Resume all currently paused sounds
   */
  resumeAll() {
    for (const track of this.activeTracks.values()) {
      if (track.state === PlaybackState.PAUSED) {
        track.resume();
      }
    }
    this._emit('all:resume', {});
  }

  /**
   * Set Master Volume (0.0 to 2.0)
   * @param {number} vol
   */
  setMasterVolume(vol) {
    this.masterVolume = Math.max(0, Math.min(2.0, Number(vol) || 0));
    if (!this.isMuted && this.masterGainNode && this.audioContext) {
      this.masterGainNode.gain.setValueAtTime(this.masterVolume, this.audioContext.currentTime);
    }
    this._emit('volume:change', { masterVolume: this.masterVolume, isMuted: this.isMuted });
  }

  /**
   * Toggle Master Mute (M key)
   * @returns {boolean} New mute state
   */
  toggleMasterMute() {
    this.isMuted = !this.isMuted;
    if (this.masterGainNode && this.audioContext) {
      const targetGain = this.isMuted ? 0 : this.masterVolume;
      this.masterGainNode.gain.setValueAtTime(targetGain, this.audioContext.currentTime);
    }
    this._emit('volume:change', { masterVolume: this.masterVolume, isMuted: this.isMuted });
    return this.isMuted;
  }

  /**
   * Get summary list of currently playing / paused voices for UI meters
   * @returns {Array<Object>}
   */
  getActiveTracksSummary() {
    return Array.from(this.activeTracks.values()).map(t => ({
      id: t.id,
      soundId: t.soundId,
      name: t.name,
      state: t.state,
      volume: t.volume,
      playbackRate: t.playbackRate,
      detune: t.detune,
      currentTime: t.getCurrentTime(),
      duration: t.duration,
      progress: t.getProgress(),
      loop: t.loop
    }));
  }

  /**
   * Internal event dispatcher
   */
  _emit(eventName, data) {
    if (typeof this.onEvent === 'function') {
      this.onEvent(eventName, data);
    }
  }
}

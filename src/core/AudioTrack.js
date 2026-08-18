/**
 * CS_sumpler - AudioTrack
 *
 * Represents an individual polyphonic playback voice with support for:
 * - Precise pause and resume (offset tracking)
 * - Playback rate / speed adjustment
 * - Pitch shift (cents / detune)
 * - Volume control and clickless stop/fade
 * - Natural completion vs manual stop lifecycle
 */

import { PlaybackState } from '../types/models.js';

export class AudioTrack {
  /**
   * @param {Object} options
   * @param {string} options.id Unique track ID
   * @param {string} options.soundId Associated sound identifier
   * @param {string} options.name Display name
   * @param {AudioContext} options.audioContext Web Audio Context
   * @param {AudioBuffer} options.audioBuffer Decoded audio data
   * @param {AudioNode} options.destinationNode Destination Web Audio node (e.g. Master Gain)
   * @param {number} [options.volume=1.0] Individual track volume (0.0 - 2.0)
   * @param {number} [options.playbackRate=1.0] Playback speed (0.25 - 4.0)
   * @param {number} [options.detune=0] Pitch offset in cents (-2400 to +2400)
   * @param {boolean} [options.loop=false] Whether to loop
   * @param {number} [options.fadeDuration=0] Initial fade in/out duration in seconds
   * @param {Function} [options.onStateChange] Callback on state transition
   * @param {Function} [options.onEnded] Callback on natural playback end
   */
  constructor({
    id,
    soundId,
    name = '',
    audioContext,
    audioBuffer,
    destinationNode,
    volume = 1.0,
    playbackRate = 1.0,
    detune = 0,
    loop = false,
    fadeDuration = 0,
    onStateChange = null,
    onEnded = null
  }) {
    this.id = id;
    this.soundId = soundId;
    this.name = name;
    this.audioContext = audioContext;
    this.audioBuffer = audioBuffer;
    this.destinationNode = destinationNode;

    this.volume = Math.max(0, Math.min(2.0, Number(volume) || 1.0));
    this.playbackRate = Math.max(0.25, Math.min(4.0, Number(playbackRate) || 1.0));
    this.detune = Math.max(-2400, Math.min(2400, Number(detune) || 0));
    this.loop = Boolean(loop);
    this.fadeDuration = Math.max(0, Number(fadeDuration) || 0);

    this.duration = audioBuffer ? audioBuffer.duration : 0;
    this.state = PlaybackState.IDLE;

    this.onStateChange = onStateChange;
    this.onEnded = onEnded;

    // Web Audio internal nodes
    this.sourceNode = null;
    this.gainNode = null;

    // Time tracking for precise pause / resume
    this.startedAtContextTime = 0;
    this.offsetAtStart = 0;
    this.pausedAtOffset = 0;
    this._isManuallyStopped = false;
  }

  /**
   * Start playback from a given offset in seconds
   * @param {number} [offset=0]
   */
  play(offset = 0) {
    if (!this.audioBuffer || !this.audioContext) {
      console.warn(`[AudioTrack ${this.id}] Cannot play: AudioBuffer or AudioContext missing.`);
      return this;
    }

    // If currently playing, stop existing source node cleanly first
    if (this.state === PlaybackState.PLAYING && this.sourceNode) {
      try {
        this._isManuallyStopped = true;
        this.sourceNode.stop();
      } catch (_) {
        // Ignore if already stopped
      }
    }

    this._isManuallyStopped = false;
    const ctx = this.audioContext;
    const now = ctx.currentTime;

    // Create fresh nodes
    this.sourceNode = ctx.createBufferSource();
    this.sourceNode.buffer = this.audioBuffer;
    this.sourceNode.loop = this.loop;

    // Configure playbackRate and pitch (detune)
    if (this.sourceNode.playbackRate) {
      this.sourceNode.playbackRate.setValueAtTime(this.playbackRate, now);
    }
    if (this.sourceNode.detune) {
      this.sourceNode.detune.setValueAtTime(this.detune, now);
    }

    // Create track GainNode
    this.gainNode = ctx.createGain();
    if (this.fadeDuration > 0 && offset === 0) {
      // Fade in from 0
      this.gainNode.gain.setValueAtTime(0, now);
      this.gainNode.gain.linearRampToValueAtTime(this.volume, now + this.fadeDuration);
    } else {
      this.gainNode.gain.setValueAtTime(this.volume, now);
    }

    // Connect node chain: source -> trackGain -> destination
    this.sourceNode.connect(this.gainNode);
    this.gainNode.connect(this.destinationNode);

    // Calculate valid offset
    const safeOffset = Math.max(0, Math.min(this.duration, offset));
    this.offsetAtStart = safeOffset;
    this.startedAtContextTime = now;
    this.pausedAtOffset = safeOffset;

    // Handle playback completion
    this.sourceNode.onended = () => {
      this._handleSourceEnded();
    };

    // Start playback
    try {
      this.sourceNode.start(0, safeOffset);
      this._setState(PlaybackState.PLAYING);
    } catch (err) {
      console.error(`[AudioTrack ${this.id}] Failed to start AudioBufferSourceNode:`, err);
      this._setState(PlaybackState.STOPPED);
    }

    return this;
  }

  /**
   * Pause playback at the exact current position
   */
  pause() {
    if (this.state !== PlaybackState.PLAYING) {
      return this;
    }

    this.pausedAtOffset = this.getCurrentTime();
    this._isManuallyStopped = true;

    if (this.sourceNode) {
      try {
        this.sourceNode.stop();
      } catch (_) {}
    }

    this._setState(PlaybackState.PAUSED);
    return this;
  }

  /**
   * Resume playback from the paused position
   */
  resume() {
    if (this.state !== PlaybackState.PAUSED) {
      return this;
    }

    if (this.pausedAtOffset >= this.duration && !this.loop) {
      this.pausedAtOffset = 0; // Restart if at the end
    }

    return this.play(this.pausedAtOffset);
  }

  /**
   * Toggle between play/resume and pause
   */
  toggle() {
    if (this.state === PlaybackState.PLAYING) {
      this.pause();
    } else if (this.state === PlaybackState.PAUSED) {
      this.resume();
    } else {
      this.play(0);
    }
    return this;
  }

  /**
   * Stop playback completely
   * @param {number} [fadeDuration=0] Micro-fade duration in seconds to prevent audio click
   */
  stop(fadeDuration = 0) {
    if (this.state === PlaybackState.STOPPED || this.state === PlaybackState.ENDED) {
      return this;
    }

    this._isManuallyStopped = true;
    this.pausedAtOffset = 0;

    const ctx = this.audioContext;
    const now = ctx ? ctx.currentTime : 0;
    const actualFade = Math.max(0, fadeDuration);

    if (this.gainNode && ctx && actualFade > 0 && this.state === PlaybackState.PLAYING) {
      try {
        this.gainNode.gain.cancelScheduledValues(now);
        this.gainNode.gain.setValueAtTime(this.gainNode.gain.value, now);
        this.gainNode.gain.linearRampToValueAtTime(0.0001, now + actualFade);

        setTimeout(() => {
          this._stopSourceNodeImmediate();
          this._setState(PlaybackState.STOPPED);
        }, actualFade * 1000);
        return this;
      } catch (_) {
        // Fallback to immediate stop
      }
    }

    this._stopSourceNodeImmediate();
    this._setState(PlaybackState.STOPPED);
    return this;
  }

  /**
   * Internal helper to stop and disconnect source node
   */
  _stopSourceNodeImmediate() {
    if (this.sourceNode) {
      try {
        this.sourceNode.onended = null;
        this.sourceNode.stop();
        this.sourceNode.disconnect();
      } catch (_) {}
      this.sourceNode = null;
    }
    if (this.gainNode) {
      try {
        this.gainNode.disconnect();
      } catch (_) {}
      this.gainNode = null;
    }
  }

  /**
   * Internal handler for when sourceNode completes
   */
  _handleSourceEnded() {
    if (this._isManuallyStopped) {
      // Ignored because manual stop or pause caused this
      return;
    }

    this._stopSourceNodeImmediate();
    this._setState(PlaybackState.ENDED);

    if (typeof this.onEnded === 'function') {
      this.onEnded(this);
    }
  }

  /**
   * Set track volume with optional smoothing
   * @param {number} vol 0.0 - 2.0
   * @param {number} [rampTime=0.02] Smoothing time in seconds
   */
  setVolume(vol, rampTime = 0.02) {
    this.volume = Math.max(0, Math.min(2.0, Number(vol) || 0));
    if (this.gainNode && this.audioContext && this.state === PlaybackState.PLAYING) {
      const now = this.audioContext.currentTime;
      try {
        this.gainNode.gain.cancelScheduledValues(now);
        if (rampTime > 0) {
          this.gainNode.gain.setValueAtTime(this.gainNode.gain.value, now);
          this.gainNode.gain.linearRampToValueAtTime(this.volume, now + rampTime);
        } else {
          this.gainNode.gain.setValueAtTime(this.volume, now);
        }
      } catch (_) {}
    }
    return this;
  }

  /**
   * Set playback speed in real-time (0.25x - 4.0x)
   * @param {number} rate
   */
  setPlaybackRate(rate) {
    const clamped = Math.max(0.25, Math.min(4.0, Number(rate) || 1.0));
    if (this.playbackRate === clamped) return this;

    // If playing, update time baseline so offset calculation remains consistent
    if (this.state === PlaybackState.PLAYING && this.audioContext) {
      const currentPos = this.getCurrentTime();
      this.offsetAtStart = currentPos;
      this.startedAtContextTime = this.audioContext.currentTime;
      if (this.sourceNode && this.sourceNode.playbackRate) {
        this.sourceNode.playbackRate.setValueAtTime(clamped, this.audioContext.currentTime);
      }
    }

    this.playbackRate = clamped;
    return this;
  }

  /**
   * Set pitch shift in cents (-2400 to +2400)
   * @param {number} cents
   */
  setDetune(cents) {
    const clamped = Math.max(-2400, Math.min(2400, Number(cents) || 0));
    this.detune = clamped;
    if (this.sourceNode && this.sourceNode.detune && this.audioContext && this.state === PlaybackState.PLAYING) {
      try {
        this.sourceNode.detune.setValueAtTime(clamped, this.audioContext.currentTime);
      } catch (_) {}
    }
    return this;
  }

  /**
   * Calculate current playback position in seconds
   * @returns {number}
   */
  getCurrentTime() {
    if (this.state === PlaybackState.PLAYING && this.audioContext) {
      const elapsed = (this.audioContext.currentTime - this.startedAtContextTime) * this.playbackRate;
      const pos = this.offsetAtStart + elapsed;
      if (this.loop && this.duration > 0) {
        return pos % this.duration;
      }
      return Math.min(this.duration, Math.max(0, pos));
    }
    if (this.state === PlaybackState.PAUSED) {
      return this.pausedAtOffset;
    }
    if (this.state === PlaybackState.ENDED) {
      return this.duration;
    }
    return 0;
  }

  /**
   * Get progress ratio (0.0 to 1.0)
   * @returns {number}
   */
  getProgress() {
    if (this.duration <= 0) return 0;
    return Math.min(1.0, Math.max(0, this.getCurrentTime() / this.duration));
  }

  /**
   * Internal state change notifier
   */
  _setState(newState) {
    if (this.state === newState) return;
    this.state = newState;
    if (typeof this.onStateChange === 'function') {
      this.onStateChange(this, newState);
    }
  }
}

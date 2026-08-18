/**
 * CS_sumpler - CueManager
 *
 * Manages the hierarchical theater script cue sequence:
 * - Multi-Act / Scene support (「第1幕」「第2幕」など場面ごとのキューリスト管理)
 * - Cue execution and automatic progression (Space/Enter trigger)
 * - Rehearsal navigation: cursor forward/backward without playing (↑/↓)
 * - Cue jumping for direct rehearsal head-ins
 * - Cue and Act CRUD & reordering operations
 */

import { createAct, createCue, generateId } from '../types/models.js';

export class CueManager {
  /**
   * @param {Object} [options]
   * @param {Array<Object>} [options.acts] Initial list of acts
   * @param {string} [options.activeActId]
   * @param {Function} [options.onEvent] Event callback
   */
  constructor({
    acts = [],
    activeActId = null,
    onEvent = null
  } = {}) {
    this.acts = acts.length > 0 ? acts : [createAct('第1幕', 0)];
    this.activeActId = activeActId || this.acts[0].id;
    this.cueCursors = new Map(); // actId -> currentCueIndex
    this.onEvent = onEvent;

    // Initialize cursors
    for (const act of this.acts) {
      this.cueCursors.set(act.id, 0);
    }
  }

  /**
   * Get the current active Act object
   * @returns {Object}
   */
  getActiveAct() {
    let act = this.acts.find(a => a.id === this.activeActId);
    if (!act && this.acts.length > 0) {
      act = this.acts[0];
      this.activeActId = act.id;
    }
    return act;
  }

  /**
   * Switch the active Act
   * @param {string} actId
   * @returns {boolean}
   */
  setActiveAct(actId) {
    const act = this.acts.find(a => a.id === actId);
    if (!act) return false;

    this.activeActId = actId;
    if (!this.cueCursors.has(actId)) {
      this.cueCursors.set(actId, 0);
    }

    this._emit('act:change', { actId, act, currentCueIndex: this.getCurrentCueIndex() });
    return true;
  }

  /**
   * Add a new Act
   * @param {string} name
   * @returns {Object} Created Act
   */
  addAct(name = '新規場面') {
    const newAct = createAct(name, this.acts.length);
    this.acts.push(newAct);
    this.cueCursors.set(newAct.id, 0);
    this._emit('act:added', { act: newAct, acts: this.acts });
    return newAct;
  }

  /**
   * Remove an Act
   * @param {string} actId
   * @returns {boolean}
   */
  removeAct(actId) {
    if (this.acts.length <= 1) {
      // Must maintain at least one act
      return false;
    }

    const index = this.acts.findIndex(a => a.id === actId);
    if (index === -1) return false;

    this.acts.splice(index, 1);
    this.cueCursors.delete(actId);

    // If removed active act, switch to adjacent act
    if (this.activeActId === actId) {
      const nextIndex = Math.min(index, this.acts.length - 1);
      this.activeActId = this.acts[nextIndex].id;
    }

    this._emit('act:removed', { actId, acts: this.acts, activeActId: this.activeActId });
    return true;
  }

  /**
   * Rename an Act
   * @param {string} actId
   * @param {string} newName
   */
  renameAct(actId, newName) {
    const act = this.acts.find(a => a.id === actId);
    if (act) {
      act.name = newName;
      this._emit('act:updated', { act, acts: this.acts });
    }
  }

  /**
   * Reorder Acts
   * @param {Array<string>} actIdList Ordered list of Act IDs
   */
  reorderActs(actIdList) {
    const map = new Map(this.acts.map(a => [a.id, a]));
    const reordered = [];
    for (let i = 0; i < actIdList.length; i++) {
      const act = map.get(actIdList[i]);
      if (act) {
        act.order = i;
        reordered.push(act);
      }
    }
    this.acts = reordered;
    this._emit('act:reordered', { acts: this.acts });
  }

  /**
   * Switch to next Act in order (PageDown)
   */
  nextAct() {
    const currentIndex = this.acts.findIndex(a => a.id === this.activeActId);
    if (currentIndex >= 0 && currentIndex < this.acts.length - 1) {
      this.setActiveAct(this.acts[currentIndex + 1].id);
      return true;
    }
    return false;
  }

  /**
   * Switch to previous Act in order (PageUp)
   */
  prevAct() {
    const currentIndex = this.acts.findIndex(a => a.id === this.activeActId);
    if (currentIndex > 0) {
      this.setActiveAct(this.acts[currentIndex - 1].id);
      return true;
    }
    return false;
  }

  /**
   * Get current cue index for the active Act
   * @returns {number}
   */
  getCurrentCueIndex() {
    return this.cueCursors.get(this.activeActId) || 0;
  }

  /**
   * Get cue list for the active Act (or specified Act)
   * @param {string} [actId]
   * @returns {Array<Object>}
   */
  getCues(actId = this.activeActId) {
    const act = this.acts.find(a => a.id === actId);
    return act ? act.cues : [];
  }

  /**
   * Get the current cue object at cursor
   * @returns {Object|null}
   */
  getCurrentCue() {
    const cues = this.getCues();
    const index = this.getCurrentCueIndex();
    if (index >= 0 && index < cues.length) {
      return cues[index];
    }
    return null;
  }

  /**
   * Get the next upcoming cue object (preview)
   * @returns {Object|null}
   */
  getNextCue() {
    const cues = this.getCues();
    const nextIndex = this.getCurrentCueIndex() + 1;
    if (nextIndex < cues.length) {
      return cues[nextIndex];
    }
    return null;
  }

  /**
   * Get the previous cue object
   * @returns {Object|null}
   */
  getPreviousCue() {
    const cues = this.getCues();
    const prevIndex = this.getCurrentCueIndex() - 1;
    if (prevIndex >= 0 && prevIndex < cues.length) {
      return cues[prevIndex];
    }
    return null;
  }

  /**
   * Add a new Cue to the specified Act (or active Act)
   * @param {Object} cueOptions
   * @param {string} [actId]
   * @param {number} [insertIndex]
   * @returns {Object} Created Cue
   */
  addCue(cueOptions = {}, actId = this.activeActId, insertIndex = -1) {
    const act = this.acts.find(a => a.id === actId);
    if (!act) return null;

    const cue = createCue(cueOptions);
    if (insertIndex >= 0 && insertIndex <= act.cues.length) {
      act.cues.splice(insertIndex, 0, cue);
    } else {
      act.cues.push(cue);
    }

    this._emit('cue:list-changed', { actId, cues: act.cues });
    return cue;
  }

  /**
   * Remove a Cue by ID
   * @param {string} cueId
   * @param {string} [actId]
   * @returns {boolean}
   */
  removeCue(cueId, actId = this.activeActId) {
    const act = this.acts.find(a => a.id === actId);
    if (!act) return false;

    const index = act.cues.findIndex(c => c.id === cueId);
    if (index === -1) return false;

    act.cues.splice(index, 1);

    // Adjust cursor if necessary
    const cursor = this.cueCursors.get(actId) || 0;
    if (cursor >= act.cues.length && act.cues.length > 0) {
      this.cueCursors.set(actId, act.cues.length - 1);
    } else if (act.cues.length === 0) {
      this.cueCursors.set(actId, 0);
    }

    this._emit('cue:list-changed', { actId, cues: act.cues });
    this._emit('cue:cursor-changed', { actId, currentIndex: this.getCurrentCueIndex() });
    return true;
  }

  /**
   * Update a Cue's configuration
   * @param {string} cueId
   * @param {Object} updates
   * @param {string} [actId]
   * @returns {Object|null}
   */
  updateCue(cueId, updates = {}, actId = this.activeActId) {
    const act = this.acts.find(a => a.id === actId);
    if (!act) return null;

    const cue = act.cues.find(c => c.id === cueId);
    if (!cue) return null;

    Object.assign(cue, updates);

    // Ensure valid bounds
    if (updates.volume !== undefined) cue.volume = Math.max(0, Math.min(2.0, Number(updates.volume) || 0));
    if (updates.playbackRate !== undefined) cue.playbackRate = Math.max(0.25, Math.min(4.0, Number(updates.playbackRate) || 1.0));
    if (updates.detune !== undefined) cue.detune = Math.max(-2400, Math.min(2400, Number(updates.detune) || 0));

    this._emit('cue:updated', { actId, cue, cues: act.cues });
    return cue;
  }

  /**
   * Reorder Cues in an Act
   * @param {Array<string>} cueIdList
   * @param {string} [actId]
   */
  reorderCues(cueIdList, actId = this.activeActId) {
    const act = this.acts.find(a => a.id === actId);
    if (!act) return;

    const map = new Map(act.cues.map(c => [c.id, c]));
    const reordered = [];
    for (const id of cueIdList) {
      const cue = map.get(id);
      if (cue) reordered.push(cue);
    }

    act.cues = reordered;
    this._emit('cue:list-changed', { actId, cues: act.cues });
  }

  /**
   * Step cue cursor forward by +1 without playing sound (ArrowDown)
   * @returns {number} New cursor index
   */
  stepNext() {
    const cues = this.getCues();
    const currentIndex = this.getCurrentCueIndex();
    if (currentIndex < cues.length - 1) {
      const nextIndex = currentIndex + 1;
      this.cueCursors.set(this.activeActId, nextIndex);
      this._emit('cue:cursor-changed', {
        actId: this.activeActId,
        currentIndex: nextIndex,
        currentCue: this.getCurrentCue()
      });
      return nextIndex;
    }
    return currentIndex;
  }

  /**
   * Step cue cursor backward by -1 without playing sound (ArrowUp / Rewind)
   * @returns {number} New cursor index
   */
  stepPrev() {
    const currentIndex = this.getCurrentCueIndex();
    if (currentIndex > 0) {
      const prevIndex = currentIndex - 1;
      this.cueCursors.set(this.activeActId, prevIndex);
      this._emit('cue:cursor-changed', {
        actId: this.activeActId,
        currentIndex: prevIndex,
        currentCue: this.getCurrentCue()
      });
      return prevIndex;
    }
    return currentIndex;
  }

  /**
   * Jump directly to a cue in a given act (for rehearsals)
   * @param {string} actId
   * @param {number} cueIndex
   */
  jumpTo(actId, cueIndex) {
    if (actId !== this.activeActId) {
      this.setActiveAct(actId);
    }
    const cues = this.getCues(actId);
    const validIndex = Math.max(0, Math.min(Math.max(0, cues.length - 1), cueIndex));
    this.cueCursors.set(actId, validIndex);

    this._emit('cue:cursor-changed', {
      actId,
      currentIndex: validIndex,
      currentCue: this.getCurrentCue()
    });
  }

  /**
   * Reset cue cursor to the beginning (0)
   */
  reset() {
    this.cueCursors.set(this.activeActId, 0);
    this._emit('cue:cursor-changed', {
      actId: this.activeActId,
      currentIndex: 0,
      currentCue: this.getCurrentCue()
    });
  }

  /**
   * Trigger the current cue and execute the audio playback callback.
   * If autoAdvance is enabled, automatically advances cursor to next cue.
   *
   * @param {Function} playCallback Callback function (cue) => AudioTrack|null
   * @returns {Object} Result { cue, track, advanced: boolean, nextIndex: number }
   */
  triggerCurrentCue(playCallback) {
    const cue = this.getCurrentCue();
    const cues = this.getCues();
    const currentIndex = this.getCurrentCueIndex();

    if (!cue) {
      this._emit('cue:trigger-empty', { actId: this.activeActId, currentIndex });
      return { cue: null, track: null, advanced: false, nextIndex: currentIndex };
    }

    let track = null;
    if (typeof playCallback === 'function') {
      track = playCallback(cue);
    }

    let advanced = false;
    let nextIndex = currentIndex;

    if (cue.autoAdvance && currentIndex < cues.length - 1) {
      nextIndex = currentIndex + 1;
      this.cueCursors.set(this.activeActId, nextIndex);
      advanced = true;
    }

    this._emit('cue:triggered', {
      actId: this.activeActId,
      triggeredCue: cue,
      triggeredIndex: currentIndex,
      nextIndex,
      advanced,
      currentCue: this.getCurrentCue()
    });

    return { cue, track, advanced, nextIndex };
  }

  /**
   * Export all act and cue data for persistence
   */
  exportData() {
    return {
      acts: JSON.parse(JSON.stringify(this.acts)),
      activeActId: this.activeActId
    };
  }

  /**
   * Load acts and cues data from stored state
   */
  loadData({ acts = [], activeActId = null } = {}) {
    if (acts && acts.length > 0) {
      this.acts = JSON.parse(JSON.stringify(acts));
      this.activeActId = activeActId && this.acts.some(a => a.id === activeActId)
        ? activeActId
        : this.acts[0].id;
    } else {
      this.acts = [createAct('第1幕', 0)];
      this.activeActId = this.acts[0].id;
    }

    this.cueCursors.clear();
    for (const act of this.acts) {
      this.cueCursors.set(act.id, 0);
    }

    this._emit('act:change', {
      actId: this.activeActId,
      act: this.getActiveAct(),
      currentCueIndex: 0
    });
  }

  /**
   * Internal event emitter
   */
  _emit(eventName, data) {
    if (typeof this.onEvent === 'function') {
      this.onEvent(eventName, data);
    }
  }
}

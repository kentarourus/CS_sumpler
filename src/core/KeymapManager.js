/**
 * CS_sumpler - KeymapManager
 *
 * Physical keyboard event handler:
 * - Direct SE triggers, Cue playback, and Panic Stop
 * - Uses `KeyboardEvent.code` for physical key consistency (US/JIS/External Keypad)
 * - Prevents unwanted browser default behaviors (Space scroll, Backspace navigation)
 * - Safe text input detection (pauses shortcuts when typing in inputs/textareas)
 * - Key learning / capture mode for custom key binding configuration
 */

import { ActionType, createDefaultKeymaps } from '../types/models.js';

export class KeymapManager {
  /**
   * @param {Object} [options]
   * @param {Object} [options.keymaps] Key code -> Action mapping
   * @param {Function} [options.onAction] Action dispatch callback
   * @param {Function} [options.onEvent] General event callback
   */
  constructor({
    keymaps = null,
    onAction = null,
    onEvent = null
  } = {}) {
    this.keymaps = keymaps ? { ...keymaps } : createDefaultKeymaps();
    this.onAction = onAction;
    this.onEvent = onEvent;

    this.isEnabled = true;
    this.isListening = false;
    this.targetElement = null;

    // Capture mode for key assignment in settings UI
    this.isCaptureMode = false;
    this.captureCallback = null;

    this._boundKeyDownHandler = this._handleKeyDown.bind(this);
  }

  /**
   * Start listening for global keydown events
   * @param {EventTarget} [target] Default: window or document
   */
  startListening(target = null) {
    if (this.isListening) return;

    if (target) {
      this.targetElement = target;
    } else if (typeof window !== 'undefined') {
      this.targetElement = window;
    }

    if (this.targetElement && this.targetElement.addEventListener) {
      this.targetElement.addEventListener('keydown', this._boundKeyDownHandler, { capture: true });
      this.isListening = true;
    }
  }

  /**
   * Stop listening for keydown events
   */
  stopListening() {
    if (!this.isListening) return;

    if (this.targetElement && this.targetElement.removeEventListener) {
      this.targetElement.removeEventListener('keydown', this._boundKeyDownHandler, { capture: true });
    }
    this.isListening = false;
  }

  /**
   * Pause/Resume shortcut execution
   */
  setEnabled(enabled) {
    this.isEnabled = Boolean(enabled);
  }

  /**
   * Enter key capture mode to record the next key press for configuration
   * @param {Function} callback Callback with captured key code
   */
  startCaptureMode(callback) {
    this.isCaptureMode = true;
    this.captureCallback = callback;
  }

  /**
   * Exit key capture mode
   */
  stopCaptureMode() {
    this.isCaptureMode = false;
    this.captureCallback = null;
  }

  /**
   * Assign an action to a physical key code
   * @param {string} code e.g. 'Digit1', 'KeyQ', 'NumpadEnter'
   * @param {Object} actionConfig { action: ActionType, soundId?: string, label?: string }
   */
  bindKey(code, actionConfig) {
    if (!code) return;
    this.keymaps[code] = { ...actionConfig };
    this._emit('keymap:updated', { code, binding: this.keymaps[code], allKeymaps: this.keymaps });
  }

  /**
   * Unbind a key code
   * @param {string} code
   */
  unbindKey(code) {
    if (this.keymaps[code]) {
      delete this.keymaps[code];
      this._emit('keymap:updated', { code, binding: null, allKeymaps: this.keymaps });
    }
  }

  /**
   * Get binding for a specific key code
   * @param {string} code
   * @returns {Object|null}
   */
  getBinding(code) {
    return this.keymaps[code] || null;
  }

  /**
   * Get all registered key bindings
   * @returns {Object}
   */
  getAllBindings() {
    return { ...this.keymaps };
  }

  /**
   * Replace all key mappings with a new mapping object
   * @param {Object} newKeymaps
   */
  setAllBindings(newKeymaps) {
    this.keymaps = newKeymaps ? { ...newKeymaps } : createDefaultKeymaps();
    this._emit('keymap:updated', { allKeymaps: this.keymaps });
  }

  /**
   * Reset key mappings to factory defaults
   */
  resetToDefaults() {
    this.keymaps = createDefaultKeymaps();
    this._emit('keymap:updated', { allKeymaps: this.keymaps });
  }

  /**
   * Test whether an event originated from an active text input element
   * @param {KeyboardEvent} event
   * @returns {boolean}
   */
  _isTextInputActive(event) {
    const target = event.target;
    if (!target) return false;

    const tagName = target.tagName ? target.tagName.toUpperCase() : '';
    const isInput = tagName === 'INPUT' && !['button', 'checkbox', 'radio', 'range', 'submit'].includes(target.type);
    const isTextarea = tagName === 'TEXTAREA';
    const isContentEditable = target.isContentEditable;

    return Boolean(isInput || isTextarea || isContentEditable);
  }

  /**
   * Main Keydown Handler
   * @param {KeyboardEvent} event
   */
  _handleKeyDown(event) {
    // If in capture mode (editing key config in UI), capture and exit
    if (this.isCaptureMode) {
      event.preventDefault();
      event.stopPropagation();
      const code = event.code;
      const key = event.key;
      if (typeof this.captureCallback === 'function') {
        this.captureCallback({ code, key, event });
      }
      this.stopCaptureMode();
      return;
    }

    if (!this.isEnabled) return;

    // Ignore normal typing when user is focused on a text input, UNLESS it's Escape (Emergency stop is always active)
    const isTyping = this._isTextInputActive(event);
    if (isTyping && event.code !== 'Escape') {
      return;
    }

    const code = event.code;
    const binding = this.keymaps[code];

    if (!binding) return;

    // Prevent default browser reactions for captured keys
    if (['Space', 'Backspace', 'ArrowUp', 'ArrowDown', 'PageUp', 'PageDown'].includes(code)) {
      event.preventDefault();
    }

    this._emit('key:pressed', { code, key: event.key, binding });

    // Dispatch mapped action
    if (typeof this.onAction === 'function') {
      this.onAction(binding.action, binding, event);
    }
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

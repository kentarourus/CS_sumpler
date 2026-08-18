/**
 * CS_sumpler - Main Application UI Controller
 *
 * Connects the TheaterSystem core engine to the browser DOM.
 * Handles both Setup Mode and Live Performance Mode.
 */

import { TheaterSystem } from './src/core/TheaterSystem.js';
import { ActionType } from './src/types/models.js';

// ============================================================================
// Globals
// ============================================================================
let system = null;
let currentMode = 'setup'; // 'setup' | 'live'
let activeTracksTimer = null;

// ============================================================================
// DOM References
// ============================================================================
const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => document.querySelectorAll(sel);

const dom = {};

function cacheDom() {
  dom.unlockOverlay   = $('#unlock-overlay');
  dom.btnUnlock       = $('#btn-unlock');
  dom.app             = $('#app');

  // Header
  dom.projectName     = $('#project-name');
  dom.btnMute         = $('#btn-mute');
  dom.masterVolume    = $('#master-volume');
  dom.masterVolumeLabel = $('#master-volume-label');
  dom.btnSave         = $('#btn-save');
  dom.btnExport       = $('#btn-export');
  dom.btnImport       = $('#btn-import');
  dom.fileImport      = $('#file-import');
  dom.btnModeSetup    = $('#btn-mode-setup');
  dom.btnModeLive     = $('#btn-mode-live');

  // Setup - Library
  dom.soundCount      = $('#sound-count');
  dom.dropZone        = $('#drop-zone');
  dom.dropZoneInner   = dom.dropZone?.querySelector('.drop-zone-inner');
  dom.btnBrowse       = $('#btn-browse');
  dom.fileBrowse      = $('#file-browse');
  dom.soundList       = $('#sound-list');

  // Setup - Cues
  dom.actSelect       = $('#act-select');
  dom.btnPrevAct      = $('#btn-prev-act');
  dom.btnNextAct      = $('#btn-next-act');
  dom.btnAddAct       = $('#btn-add-act');
  dom.btnRemoveAct    = $('#btn-remove-act');
  dom.btnAddCue       = $('#btn-add-cue');
  dom.cueList         = $('#cue-list');

  // Setup - Keyboard
  dom.keyboardVisual  = $('#keyboard-visual');

  // Live
  dom.modeSetup       = $('#mode-setup');
  dom.modeLive        = $('#mode-live');
  dom.liveActName     = $('#live-act-name');
  dom.liveCueNum      = $('#live-cue-num');
  dom.liveCueTotal    = $('#live-cue-total');
  dom.liveNextName    = $('#live-next-name');
  dom.liveCueList     = $('#live-cue-list');
  dom.liveKeyStrip    = $('#live-key-strip');
  dom.liveActiveTracks = $('#live-active-tracks');
  dom.btnPanic        = $('#btn-panic');

  // Modals
  dom.modalSound      = $('#modal-sound-settings');
  dom.formSound       = $('#form-sound-settings');
  dom.modalCue        = $('#modal-cue-edit');
  dom.formCue         = $('#form-cue-edit');
  dom.modalKeyAssign  = $('#modal-key-assign');

  // Toast
  dom.toastContainer  = $('#toast-container');
}

// ============================================================================
// Initialization
// ============================================================================
document.addEventListener('DOMContentLoaded', () => {
  cacheDom();
  setupUnlockFlow();
});

function setupUnlockFlow() {
  dom.btnUnlock.addEventListener('click', async () => {
    system = new TheaterSystem();
    await system.init();
    await system.unlockAudio();

    dom.unlockOverlay.classList.add('hidden');
    dom.app.classList.remove('hidden');

    initUI();
  });
}

function initUI() {
  bindHeaderEvents();
  bindDropZone();
  bindCueControls();
  bindKeyboardVisual();
  bindLiveControls();
  bindModals();
  subscribeSystemEvents();

  // Initial render
  syncProjectName();
  syncMasterVolume();
  renderSoundList();
  renderActSelect();
  renderCueList();
  renderKeyboardVisual();
}

// ============================================================================
// TOAST NOTIFICATIONS
// ============================================================================
function showToast(message, type = 'info', duration = 2500) {
  const el = document.createElement('div');
  el.className = `toast toast-${type}`;
  el.textContent = message;
  dom.toastContainer.appendChild(el);
  setTimeout(() => {
    el.style.opacity = '0';
    el.style.transform = 'translateX(30px)';
    el.style.transition = 'all 0.3s ease';
    setTimeout(() => el.remove(), 300);
  }, duration);
}

// ============================================================================
// HEADER CONTROLS
// ============================================================================
function bindHeaderEvents() {
  // Project Name
  dom.projectName.addEventListener('change', () => {
    system.project.name = dom.projectName.value.trim() || '無題のプロジェクト';
    system.saveProject();
  });

  // Mute
  dom.btnMute.addEventListener('click', () => {
    const muted = system.toggleMute();
    updateMuteButton(muted);
  });

  // Master Volume
  dom.masterVolume.addEventListener('input', () => {
    const vol = parseInt(dom.masterVolume.value, 10) / 100;
    system.setMasterVolume(vol);
    dom.masterVolumeLabel.textContent = `${dom.masterVolume.value}%`;
  });

  // Save
  dom.btnSave.addEventListener('click', async () => {
    await system.saveProject();
    showToast('プロジェクトを保存しました', 'success');
  });

  // Export
  dom.btnExport.addEventListener('click', async () => {
    try {
      const bundle = await system.exportProjectBundle();
      const blob = new Blob([bundle], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${system.project.name || 'project'}.theatersound`;
      a.click();
      URL.revokeObjectURL(url);
      showToast('エクスポート完了', 'success');
    } catch (err) {
      showToast('エクスポートに失敗: ' + err.message, 'error');
    }
  });

  // Import
  dom.btnImport.addEventListener('click', () => dom.fileImport.click());
  dom.fileImport.addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    try {
      const text = await file.text();
      await system.importProjectBundle(text);
      syncProjectName();
      syncMasterVolume();
      renderSoundList();
      renderActSelect();
      renderCueList();
      renderKeyboardVisual();
      showToast('インポート完了', 'success');
    } catch (err) {
      showToast('インポートに失敗: ' + err.message, 'error');
    }
    dom.fileImport.value = '';
  });

  // Mode Switch
  dom.btnModeSetup.addEventListener('click', () => switchMode('setup'));
  dom.btnModeLive.addEventListener('click', () => switchMode('live'));
}

function syncProjectName() {
  dom.projectName.value = system.project.name || '';
}

function syncMasterVolume() {
  const vol = Math.round((system.project.settings.masterVolume || 1.0) * 100);
  dom.masterVolume.value = vol;
  dom.masterVolumeLabel.textContent = `${vol}%`;
  updateMuteButton(system.project.settings.isMuted || false);
}

function updateMuteButton(isMuted) {
  const icon = dom.btnMute.querySelector('.icon-speaker');
  icon.textContent = isMuted ? '🔇' : '🔊';
  dom.btnMute.classList.toggle('muted', isMuted);
}

// ============================================================================
// MODE SWITCHING
// ============================================================================
function switchMode(mode) {
  currentMode = mode;
  dom.btnModeSetup.classList.toggle('active', mode === 'setup');
  dom.btnModeLive.classList.toggle('active', mode === 'live');
  dom.modeSetup.classList.toggle('hidden', mode !== 'setup');
  dom.modeLive.classList.toggle('hidden', mode !== 'live');
  document.body.classList.toggle('live-fullscreen', mode === 'live');

  if (mode === 'live') {
    renderLiveView();
    startActiveTracksTimer();
  } else {
    stopActiveTracksTimer();
    renderSoundList();
    renderCueList();
    renderKeyboardVisual();
  }
}

// ============================================================================
// SOUND LIBRARY / DROP ZONE
// ============================================================================
function bindDropZone() {
  const dz = dom.dropZoneInner;
  ['dragenter', 'dragover'].forEach(evt => {
    dz.addEventListener(evt, (e) => { e.preventDefault(); dz.classList.add('drag-over'); });
  });
  ['dragleave', 'drop'].forEach(evt => {
    dz.addEventListener(evt, () => dz.classList.remove('drag-over'));
  });
  dz.addEventListener('drop', (e) => {
    e.preventDefault();
    handleFiles(e.dataTransfer.files);
  });

  dom.btnBrowse.addEventListener('click', () => dom.fileBrowse.click());
  dom.fileBrowse.addEventListener('change', (e) => {
    handleFiles(e.target.files);
    dom.fileBrowse.value = '';
  });
}

async function handleFiles(fileList) {
  for (const file of fileList) {
    try {
      await system.registerAudioFile(file, {
        fileName: file.name,
        fileType: file.type,
        fileSize: file.size
      });
      showToast(`登録: ${file.name}`, 'success');
    } catch (err) {
      showToast(`失敗: ${file.name} - ${err.message}`, 'error');
    }
  }
  renderSoundList();
  renderKeyboardVisual();
}

function renderSoundList() {
  const sounds = system.getAllSounds();
  dom.soundCount.textContent = sounds.length;
  dom.soundList.innerHTML = '';

  sounds.forEach(s => {
    const li = document.createElement('li');
    li.className = 'sound-item';
    li.dataset.soundId = s.id;
    li.draggable = true;

    const duration = s.duration ? formatTime(s.duration) : '--:--';
    const size = s.fileSize ? formatFileSize(s.fileSize) : '';

    li.innerHTML = `
      <span class="sound-item-icon">🔈</span>
      <div class="sound-item-info">
        <div class="sound-item-name">${escHtml(s.name)}</div>
        <div class="sound-item-meta">${duration}${size ? ' · ' + size : ''}</div>
      </div>
      <div class="sound-item-actions">
        <button class="btn-icon-sm btn-sound-play" title="試聴">▶</button>
        <button class="btn-icon-sm btn-sound-edit" title="編集">⚙</button>
        <button class="btn-icon-sm btn-remove btn-sound-delete" title="削除">✕</button>
      </div>
    `;

    // Play preview
    li.querySelector('.btn-sound-play').addEventListener('click', (e) => {
      e.stopPropagation();
      system.playDirectSound(s.id);
    });

    // Edit
    li.querySelector('.btn-sound-edit').addEventListener('click', (e) => {
      e.stopPropagation();
      openSoundSettingsModal(s.id);
    });

    // Delete
    li.querySelector('.btn-sound-delete').addEventListener('click', async (e) => {
      e.stopPropagation();
      if (confirm(`「${s.name}」を削除しますか？`)) {
        await system.removeAudioFile(s.id);
        renderSoundList();
        renderCueList();
        renderKeyboardVisual();
        showToast(`削除: ${s.name}`, 'info');
      }
    });

    // Drag support for cue list drop
    li.addEventListener('dragstart', (e) => {
      e.dataTransfer.setData('text/sound-id', s.id);
      li.classList.add('dragging');
    });
    li.addEventListener('dragend', () => li.classList.remove('dragging'));

    dom.soundList.appendChild(li);
  });
}

// ============================================================================
// CUE LIST & ACTS
// ============================================================================
function bindCueControls() {
  dom.actSelect.addEventListener('change', () => {
    system.cues.setActiveAct(dom.actSelect.value);
    renderCueList();
  });

  dom.btnPrevAct.addEventListener('click', () => {
    system.prevAct();
    renderActSelect();
    renderCueList();
  });

  dom.btnNextAct.addEventListener('click', () => {
    system.nextAct();
    renderActSelect();
    renderCueList();
  });

  dom.btnAddAct.addEventListener('click', () => {
    const name = prompt('新しい幕・場面の名前:', `第${system.cues.acts.length + 1}幕`);
    if (name) {
      system.cues.addAct(name);
      system.saveProject();
      renderActSelect();
      showToast(`追加: ${name}`, 'success');
    }
  });

  dom.btnRemoveAct.addEventListener('click', () => {
    if (system.cues.acts.length <= 1) {
      showToast('最低1つの幕が必要です', 'error');
      return;
    }
    const act = system.cues.getActiveAct();
    if (confirm(`「${act.name}」を削除しますか？`)) {
      system.cues.removeAct(act.id);
      system.saveProject();
      renderActSelect();
      renderCueList();
      showToast(`削除: ${act.name}`, 'info');
    }
  });

  dom.btnAddCue.addEventListener('click', () => {
    openCueEditModal(null); // null => new cue
  });

  // Cue list: allow drop from sound list to add as cue
  dom.cueList.addEventListener('dragover', (e) => e.preventDefault());
  dom.cueList.addEventListener('drop', (e) => {
    e.preventDefault();
    const soundId = e.dataTransfer.getData('text/sound-id');
    if (soundId) {
      const soundItem = system.getSound(soundId);
      const cueName = soundItem ? soundItem.name : '新規キュー';
      system.cues.addCue({ name: cueName, soundId });
      system.saveProject();
      renderCueList();
      showToast(`キュー追加: ${cueName}`, 'success');
    }
  });
}

function renderActSelect() {
  dom.actSelect.innerHTML = '';
  system.cues.acts.forEach(act => {
    const opt = document.createElement('option');
    opt.value = act.id;
    opt.textContent = act.name;
    if (act.id === system.cues.activeActId) opt.selected = true;
    dom.actSelect.appendChild(opt);
  });
}

function renderCueList() {
  const cues = system.cues.getCues();
  const currentIndex = system.cues.getCurrentCueIndex();
  dom.cueList.innerHTML = '';

  cues.forEach((cue, i) => {
    const li = document.createElement('li');
    li.className = 'cue-item' + (i === currentIndex ? ' cue-current' : '');
    li.dataset.cueId = cue.id;
    li.dataset.index = i;

    const soundItem = cue.soundId ? system.getSound(cue.soundId) : null;
    const soundName = soundItem ? soundItem.name : '（音声未設定）';

    let badges = '';
    if (cue.loop) badges += '<span class="cue-badge cue-badge-loop">LOOP</span>';
    if (!cue.autoAdvance) badges += '<span class="cue-badge cue-badge-manual">手動</span>';

    li.innerHTML = `
      <span class="cue-item-num">${i + 1}</span>
      <div class="cue-item-info">
        <div class="cue-item-name">${escHtml(cue.name)}</div>
        <div class="cue-item-sound">🔈 ${escHtml(soundName)}</div>
        ${cue.note ? `<div class="cue-item-note">📝 ${escHtml(cue.note)}</div>` : ''}
      </div>
      <div class="cue-item-badges">${badges}</div>
      <div class="cue-item-actions">
        <button class="btn-icon-sm btn-cue-up" title="上へ">▲</button>
        <button class="btn-icon-sm btn-cue-down" title="下へ">▼</button>
        <button class="btn-icon-sm btn-cue-edit" title="編集">⚙</button>
        <button class="btn-icon-sm btn-remove btn-cue-delete" title="削除">✕</button>
      </div>
    `;

    // Click to set cue cursor
    li.addEventListener('click', () => {
      system.cues.jumpTo(system.cues.activeActId, i);
      renderCueList();
    });

    // Move up
    li.querySelector('.btn-cue-up').addEventListener('click', (e) => {
      e.stopPropagation();
      if (i > 0) {
        const ids = cues.map(c => c.id);
        [ids[i - 1], ids[i]] = [ids[i], ids[i - 1]];
        system.cues.reorderCues(ids);
        system.saveProject();
        renderCueList();
      }
    });

    // Move down
    li.querySelector('.btn-cue-down').addEventListener('click', (e) => {
      e.stopPropagation();
      if (i < cues.length - 1) {
        const ids = cues.map(c => c.id);
        [ids[i], ids[i + 1]] = [ids[i + 1], ids[i]];
        system.cues.reorderCues(ids);
        system.saveProject();
        renderCueList();
      }
    });

    // Edit
    li.querySelector('.btn-cue-edit').addEventListener('click', (e) => {
      e.stopPropagation();
      openCueEditModal(cue.id);
    });

    // Delete
    li.querySelector('.btn-cue-delete').addEventListener('click', (e) => {
      e.stopPropagation();
      system.cues.removeCue(cue.id);
      system.saveProject();
      renderCueList();
    });

    dom.cueList.appendChild(li);
  });
}

// ============================================================================
// KEYBOARD VISUAL
// ============================================================================
function bindKeyboardVisual() {
  dom.keyboardVisual.addEventListener('click', (e) => {
    const keyEl = e.target.closest('.kb-key');
    if (!keyEl) return;
    const code = keyEl.dataset.code;
    if (code) openKeyAssignModal(code);
  });
}

function renderKeyboardVisual() {
  const bindings = system.keymap.getAllBindings();
  const keys = dom.keyboardVisual.querySelectorAll('.kb-key');

  keys.forEach(keyEl => {
    const code = keyEl.dataset.code;
    const binding = bindings[code];
    const assignEl = keyEl.querySelector('.kb-assign');

    if (binding && binding.action === ActionType.PLAY_DIRECT && binding.soundId) {
      const soundItem = system.getSound(binding.soundId);
      assignEl.textContent = soundItem ? soundItem.name : '?';
      keyEl.classList.add('kb-assigned');
    } else {
      assignEl.textContent = '';
      keyEl.classList.remove('kb-assigned');
    }
  });
}

// ============================================================================
// LIVE / PERFORMANCE MODE
// ============================================================================
function bindLiveControls() {
  dom.btnPanic.addEventListener('click', () => {
    system.panicStop();
    renderLiveActiveTracks();
  });

  // Cue list click to jump
  dom.liveCueList.addEventListener('click', (e) => {
    const item = e.target.closest('.live-cue-item');
    if (item) {
      const idx = parseInt(item.dataset.index, 10);
      system.cues.jumpTo(system.cues.activeActId, idx);
      renderLiveView();
    }
  });
}

function renderLiveView() {
  const act = system.cues.getActiveAct();
  const cues = system.cues.getCues();
  const currentIndex = system.cues.getCurrentCueIndex();
  const currentCue = system.cues.getCurrentCue();

  // Act and counter
  dom.liveActName.textContent = act ? act.name : '';
  dom.liveCueNum.textContent = cues.length > 0 ? currentIndex + 1 : 0;
  dom.liveCueTotal.textContent = cues.length;

  // Next cue name
  if (currentCue) {
    dom.liveNextName.textContent = `「${currentCue.name}」`;
  } else {
    dom.liveNextName.textContent = '（キューなし）';
  }

  // Cue list
  dom.liveCueList.innerHTML = '';
  cues.forEach((cue, i) => {
    const li = document.createElement('li');
    li.className = 'live-cue-item';
    li.dataset.index = i;
    if (i < currentIndex) li.classList.add('live-cue-past');
    else if (i === currentIndex) li.classList.add('live-cue-active');
    else if (i === currentIndex + 1) li.classList.add('live-cue-next');

    li.innerHTML = `
      <span class="live-cue-item-num">${i + 1}</span>
      <span class="live-cue-item-name">${escHtml(cue.name)}</span>
      ${cue.note ? `<span class="live-cue-item-note">${escHtml(cue.note)}</span>` : ''}
    `;
    dom.liveCueList.appendChild(li);
  });

  // Scroll to active cue
  const activeEl = dom.liveCueList.querySelector('.live-cue-active');
  if (activeEl) {
    activeEl.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }

  // Direct key strip
  renderLiveKeyStrip();
  renderLiveActiveTracks();
}

function renderLiveKeyStrip() {
  const bindings = system.keymap.getAllBindings();
  dom.liveKeyStrip.innerHTML = '';

  const directKeys = Object.entries(bindings)
    .filter(([, b]) => b.action === ActionType.PLAY_DIRECT && b.soundId)
    .sort(([a], [b]) => a.localeCompare(b));

  directKeys.forEach(([code, binding]) => {
    const soundItem = system.getSound(binding.soundId);
    const displayKey = codeToDisplayKey(code);
    const btn = document.createElement('div');
    btn.className = 'live-key-btn';
    btn.dataset.code = code;
    btn.innerHTML = `
      <span class="live-key-btn-code">${displayKey}</span>
      <span class="live-key-btn-name">${escHtml(soundItem ? soundItem.name : binding.label)}</span>
    `;
    btn.addEventListener('click', () => {
      system.playDirectSound(binding.soundId);
      btn.classList.add('key-flash');
      setTimeout(() => btn.classList.remove('key-flash'), 200);
    });
    dom.liveKeyStrip.appendChild(btn);
  });
}

function renderLiveActiveTracks() {
  const tracks = system.getActiveTracks();
  dom.liveActiveTracks.innerHTML = '';

  if (tracks.length === 0) {
    dom.liveActiveTracks.innerHTML = '<div style="font-size:0.75rem;color:var(--text-muted);padding:4px 0;">再生中の音声はありません</div>';
    return;
  }

  tracks.forEach(t => {
    const bar = document.createElement('div');
    bar.className = 'active-track-bar';
    const stateClass = t.state === 'playing' ? 'state-playing' : 'state-paused';
    const stateLabel = t.state === 'playing' ? '再生中' : '一時停止';
    const progressPct = Math.round(t.progress * 100);
    const fillClass = t.state === 'paused' ? 'paused' : '';

    bar.innerHTML = `
      <span class="active-track-name">${escHtml(t.name || t.soundId)}</span>
      <span class="active-track-state ${stateClass}">${stateLabel}</span>
      <div class="active-track-progress">
        <div class="active-track-progress-fill ${fillClass}" style="width:${progressPct}%"></div>
      </div>
      <span class="active-track-time">${formatTime(t.currentTime)}</span>
    `;
    dom.liveActiveTracks.appendChild(bar);
  });
}

function startActiveTracksTimer() {
  stopActiveTracksTimer();
  activeTracksTimer = setInterval(() => {
    if (currentMode === 'live') {
      renderLiveActiveTracks();
    }
  }, 200);
}

function stopActiveTracksTimer() {
  if (activeTracksTimer) {
    clearInterval(activeTracksTimer);
    activeTracksTimer = null;
  }
}

// ============================================================================
// MODALS
// ============================================================================
function bindModals() {
  // --- Sound Settings Modal ---
  dom.formSound.addEventListener('submit', (e) => {
    e.preventDefault();
    const soundId = $('#modal-sound-id').value;
    const soundItem = system.getSound(soundId);
    if (!soundItem) return;

    soundItem.name = $('#modal-sound-name').value.trim() || soundItem.name;
    soundItem.defaultVolume = parseInt($('#modal-sound-volume').value, 10) / 100;
    soundItem.defaultPlaybackRate = parseInt($('#modal-sound-rate').value, 10) / 100;
    soundItem.defaultDetune = parseInt($('#modal-sound-detune').value, 10);
    soundItem.defaultOverlapMode = $('#modal-sound-overlap').value;

    system.saveProject();
    renderSoundList();
    renderKeyboardVisual();
    dom.modalSound.close();
    showToast('音声設定を保存しました', 'success');
  });

  $('#btn-sound-cancel').addEventListener('click', () => dom.modalSound.close());

  $('#btn-sound-test').addEventListener('click', () => {
    const soundId = $('#modal-sound-id').value;
    if (soundId) {
      system.audio.playSound(soundId, {
        volume: parseInt($('#modal-sound-volume').value, 10) / 100,
        playbackRate: parseInt($('#modal-sound-rate').value, 10) / 100,
        detune: parseInt($('#modal-sound-detune').value, 10)
      });
    }
  });

  // Sliders live labels
  $('#modal-sound-volume').addEventListener('input', function() {
    $('#modal-sound-volume-val').textContent = this.value + '%';
  });
  $('#modal-sound-rate').addEventListener('input', function() {
    $('#modal-sound-rate-val').textContent = (parseInt(this.value) / 100).toFixed(2) + 'x';
  });
  $('#modal-sound-detune').addEventListener('input', function() {
    $('#modal-sound-detune-val').textContent = this.value;
  });

  // --- Cue Edit Modal ---
  dom.formCue.addEventListener('submit', (e) => {
    e.preventDefault();
    const cueId = $('#modal-cue-id').value;
    const updates = {
      name: $('#modal-cue-name').value.trim() || '新規キュー',
      soundId: $('#modal-cue-sound').value || null,
      note: $('#modal-cue-note').value.trim(),
      volume: parseInt($('#modal-cue-volume').value, 10) / 100,
      playbackRate: parseInt($('#modal-cue-rate').value, 10) / 100,
      detune: parseInt($('#modal-cue-detune').value, 10),
      loop: $('#modal-cue-loop').checked,
      autoAdvance: $('#modal-cue-autoadvance').checked,
      overlapMode: $('#modal-cue-overlap').value
    };

    if (cueId) {
      // Editing existing cue
      system.cues.updateCue(cueId, updates);
    } else {
      // New cue
      system.cues.addCue(updates);
    }
    system.saveProject();
    renderCueList();
    dom.modalCue.close();
    showToast(cueId ? 'キューを更新しました' : 'キューを追加しました', 'success');
  });

  $('#btn-cue-cancel').addEventListener('click', () => dom.modalCue.close());

  // Cue slider labels
  $('#modal-cue-volume').addEventListener('input', function() {
    $('#modal-cue-volume-val').textContent = this.value + '%';
  });
  $('#modal-cue-rate').addEventListener('input', function() {
    $('#modal-cue-rate-val').textContent = (parseInt(this.value) / 100).toFixed(2) + 'x';
  });
  $('#modal-cue-detune').addEventListener('input', function() {
    $('#modal-cue-detune-val').textContent = this.value;
  });

  // --- Key Assign Modal ---
  $('#btn-key-save').addEventListener('click', () => {
    const code = $('#modal-key-code').value;
    const soundId = $('#modal-key-sound').value;
    if (code && soundId) {
      system.assignDirectSoundKey(code, soundId);
    }
    dom.modalKeyAssign.close();
    renderKeyboardVisual();
    showToast('キー割り当てを保存しました', 'success');
  });

  $('#btn-key-clear').addEventListener('click', () => {
    const code = $('#modal-key-code').value;
    if (code) {
      // Restore default binding if it exists, otherwise unbind
      system.keymap.bindKey(code, { action: ActionType.PLAY_DIRECT, soundId: null, label: `SE (${codeToDisplayKey(code)})` });
      system.project.keymaps = system.keymap.getAllBindings();
      system.saveProject();
    }
    dom.modalKeyAssign.close();
    renderKeyboardVisual();
    showToast('割り当てを解除しました', 'info');
  });

  $('#btn-key-cancel').addEventListener('click', () => dom.modalKeyAssign.close());
}

function openSoundSettingsModal(soundId) {
  const soundItem = system.getSound(soundId);
  if (!soundItem) return;

  $('#modal-sound-id').value = soundId;
  $('#modal-sound-name').value = soundItem.name;
  $('#modal-sound-volume').value = Math.round(soundItem.defaultVolume * 100);
  $('#modal-sound-volume-val').textContent = Math.round(soundItem.defaultVolume * 100) + '%';
  $('#modal-sound-rate').value = Math.round(soundItem.defaultPlaybackRate * 100);
  $('#modal-sound-rate-val').textContent = soundItem.defaultPlaybackRate.toFixed(2) + 'x';
  $('#modal-sound-detune').value = soundItem.defaultDetune;
  $('#modal-sound-detune-val').textContent = soundItem.defaultDetune;
  $('#modal-sound-overlap').value = soundItem.defaultOverlapMode;

  dom.modalSound.showModal();
}

function openCueEditModal(cueId) {
  // Populate sound select options
  const soundSelect = $('#modal-cue-sound');
  soundSelect.innerHTML = '<option value="">（なし）</option>';
  system.getAllSounds().forEach(s => {
    const opt = document.createElement('option');
    opt.value = s.id;
    opt.textContent = s.name;
    soundSelect.appendChild(opt);
  });

  if (cueId) {
    const cue = system.cues.getCues().find(c => c.id === cueId);
    if (!cue) return;
    $('#modal-cue-id').value = cueId;
    $('#modal-cue-name').value = cue.name;
    $('#modal-cue-sound').value = cue.soundId || '';
    $('#modal-cue-note').value = cue.note || '';
    $('#modal-cue-volume').value = Math.round(cue.volume * 100);
    $('#modal-cue-volume-val').textContent = Math.round(cue.volume * 100) + '%';
    $('#modal-cue-rate').value = Math.round(cue.playbackRate * 100);
    $('#modal-cue-rate-val').textContent = cue.playbackRate.toFixed(2) + 'x';
    $('#modal-cue-detune').value = cue.detune;
    $('#modal-cue-detune-val').textContent = cue.detune;
    $('#modal-cue-overlap').value = cue.overlapMode;
    $('#modal-cue-loop').checked = cue.loop;
    $('#modal-cue-autoadvance').checked = cue.autoAdvance;
  } else {
    // New cue defaults
    $('#modal-cue-id').value = '';
    $('#modal-cue-name').value = '';
    $('#modal-cue-sound').value = '';
    $('#modal-cue-note').value = '';
    $('#modal-cue-volume').value = 100;
    $('#modal-cue-volume-val').textContent = '100%';
    $('#modal-cue-rate').value = 100;
    $('#modal-cue-rate-val').textContent = '1.00x';
    $('#modal-cue-detune').value = 0;
    $('#modal-cue-detune-val').textContent = '0';
    $('#modal-cue-overlap').value = 'restart';
    $('#modal-cue-loop').checked = false;
    $('#modal-cue-autoadvance').checked = true;
  }

  dom.modalCue.showModal();
}

function openKeyAssignModal(code) {
  const binding = system.keymap.getBinding(code);
  const displayKey = codeToDisplayKey(code);

  $('#modal-key-code').value = code;
  $('#key-assign-label').innerHTML = `キー: <kbd>${displayKey}</kbd>`;

  // Populate sound select
  const soundSelect = $('#modal-key-sound');
  soundSelect.innerHTML = '<option value="">（なし）</option>';
  system.getAllSounds().forEach(s => {
    const opt = document.createElement('option');
    opt.value = s.id;
    opt.textContent = s.name;
    if (binding && binding.soundId === s.id) opt.selected = true;
    soundSelect.appendChild(opt);
  });

  dom.modalKeyAssign.showModal();
}

// ============================================================================
// SYSTEM EVENT SUBSCRIPTIONS
// ============================================================================
function subscribeSystemEvents() {
  // Cue changes
  system.on('cue:triggered', () => {
    if (currentMode === 'live') renderLiveView();
    else renderCueList();
  });
  system.on('cue:cursor-changed', () => {
    if (currentMode === 'live') renderLiveView();
    else renderCueList();
  });
  system.on('act:change', () => {
    renderActSelect();
    if (currentMode === 'live') renderLiveView();
    else renderCueList();
  });

  // Audio
  system.on('track:play', () => {
    if (currentMode === 'live') renderLiveActiveTracks();
  });
  system.on('track:stop', () => {
    if (currentMode === 'live') renderLiveActiveTracks();
  });
  system.on('track:ended', () => {
    if (currentMode === 'live') renderLiveActiveTracks();
  });
  system.on('all:stop', () => {
    if (currentMode === 'live') renderLiveActiveTracks();
  });

  // Volume
  system.on('volume:change', (data) => {
    updateMuteButton(data.isMuted);
  });

  // Key flashes in live mode
  system.on('key:pressed', (data) => {
    if (currentMode === 'live' && data.binding?.action === ActionType.PLAY_DIRECT) {
      const btn = dom.liveKeyStrip.querySelector(`[data-code="${data.code}"]`);
      if (btn) {
        btn.classList.add('key-flash');
        setTimeout(() => btn.classList.remove('key-flash'), 200);
      }
    }
  });
}

// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================
function formatTime(seconds) {
  const s = Math.max(0, seconds);
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  return `${m}:${sec.toString().padStart(2, '0')}`;
}

function formatFileSize(bytes) {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1048576) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / 1048576).toFixed(1) + ' MB';
}

function escHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

function codeToDisplayKey(code) {
  const map = {
    'Digit1': '1', 'Digit2': '2', 'Digit3': '3', 'Digit4': '4', 'Digit5': '5',
    'Digit6': '6', 'Digit7': '7', 'Digit8': '8', 'Digit9': '9', 'Digit0': '0',
    'KeyQ': 'Q', 'KeyW': 'W', 'KeyE': 'E', 'KeyR': 'R', 'KeyT': 'T',
    'KeyY': 'Y', 'KeyU': 'U', 'KeyI': 'I', 'KeyO': 'O', 'KeyP': 'P',
    'KeyA': 'A', 'KeyS': 'S', 'KeyD': 'D', 'KeyF': 'F', 'KeyG': 'G',
    'KeyH': 'H', 'KeyJ': 'J', 'KeyK': 'K', 'KeyL': 'L',
    'Numpad1': 'N1', 'Numpad2': 'N2', 'Numpad3': 'N3',
    'Numpad4': 'N4', 'Numpad5': 'N5', 'Numpad6': 'N6',
    'Numpad7': 'N7', 'Numpad8': 'N8', 'Numpad9': 'N9',
    'Space': 'Space', 'Enter': 'Enter', 'Escape': 'Esc',
    'Backspace': 'BS', 'ArrowUp': '↑', 'ArrowDown': '↓',
    'PageUp': 'PgUp', 'PageDown': 'PgDn'
  };
  return map[code] || code.replace('Key', '').replace('Digit', '');
}

/**
 * CS_sumpler - Data Models, Constants, and Factory Functions
 *
 * Designed for static GitHub Pages execution with Web Audio API.
 */

export const OverlapMode = Object.freeze({
  OVERLAP: 'overlap',   // 重ね再生（同じ音を何度でも重ねて鳴らす）
  RESTART: 'restart',   // 頭出し再生（既に鳴っている同音を止めて最初から鳴らす）
  TOGGLE: 'toggle',     // トグル再生（再生中なら一時停止/停止、停止中なら再生/再開）
  SINGLE: 'single'      // 排他再生（鳴り終わるまで次のトリガーを無視）
});

export const PlaybackState = Object.freeze({
  IDLE: 'idle',
  PLAYING: 'playing',
  PAUSED: 'paused',
  STOPPED: 'stopped',
  ENDED: 'ended'
});

export const ActionType = Object.freeze({
  PLAY_DIRECT: 'PLAY_DIRECT',               // 直接割り当てSE再生
  CUE_TRIGGER: 'CUE_TRIGGER',               // 現在キュー再生（+自動進行）
  CUE_NEXT: 'CUE_NEXT',                     // キューカーソル1つ進む（音は鳴らさない）
  CUE_PREV: 'CUE_PREV',                     // キューカーソル1つ戻る（巻き戻し）
  PANIC_STOP: 'PANIC_STOP',                 // 非常停止（全音即時停止）
  STOP_LAST: 'STOP_LAST',                   // 直前の音のみ停止
  PAUSE_RESUME_CURRENT: 'PAUSE_RESUME_CURRENT', // 現在/直前の音を一時停止・再開
  MUTE_TOGGLE: 'MUTE_TOGGLE',               // マスターミュート切り替え
  ACT_NEXT: 'ACT_NEXT',                     // 次の幕・場面へ切り替え
  ACT_PREV: 'ACT_PREV'                      // 前の幕・場面へ切り替え
});

export const SystemEvent = Object.freeze({
  STATE_CHANGE: 'state:change',
  AUDIO_PLAY: 'audio:play',
  AUDIO_PAUSE: 'audio:pause',
  AUDIO_RESUME: 'audio:resume',
  AUDIO_STOP: 'audio:stop',
  AUDIO_ENDED: 'audio:ended',
  AUDIO_PROGRESS: 'audio:progress',
  CUE_CHANGE: 'cue:change',
  ACT_CHANGE: 'act:change',
  VOLUME_CHANGE: 'volume:change',
  KEY_PRESS: 'key:press',
  ERROR: 'system:error'
});

/**
 * Generate unique random ID
 */
export function generateId(prefix = 'id') {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).substring(2, 8)}`;
}

/**
 * Default Project Factory
 */
export function createDefaultProject(name = '学校演劇 音響プロジェクト') {
  const act1 = createAct('第1幕', 0);
  return {
    id: generateId('proj'),
    version: '1.0.0',
    name,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    settings: {
      masterVolume: 1.0,
      isMuted: false,
      enableClicklessStop: true, // 微小フェードアウトによるクリックノイズ防止
      stopFadeDuration: 0.05,    // 秒
      allowGlobalKeyNavigation: true
    },
    acts: [act1],
    activeActId: act1.id,
    sounds: [], // SoundItem[]
    directSounds: [], // DirectSoundMapping[]
    keymaps: createDefaultKeymaps()
  };
}

/**
 * Act (幕・場面) Factory
 */
export function createAct(name = '新規場面', order = 0) {
  return {
    id: generateId('act'),
    name,
    order,
    cues: [] // Cue[]
  };
}

/**
 * Cue Factory
 */
export function createCue({
  name = '新規キュー',
  soundId = null,
  note = '',
  volume = 1.0,
  playbackRate = 1.0,
  detune = 0,
  loop = false,
  overlapMode = OverlapMode.RESTART,
  autoAdvance = true,
  fadeDuration = 0
} = {}) {
  return {
    id: generateId('cue'),
    name,
    soundId,
    note,
    volume: Math.max(0, Math.min(2.0, Number(volume) || 1.0)),
    playbackRate: Math.max(0.25, Math.min(4.0, Number(playbackRate) || 1.0)),
    detune: Math.max(-2400, Math.min(2400, Number(detune) || 0)), // cents (-2400 = -2 octaves, +2400 = +2 octaves)
    loop: Boolean(loop),
    overlapMode: Object.values(OverlapMode).includes(overlapMode) ? overlapMode : OverlapMode.RESTART,
    autoAdvance: Boolean(autoAdvance),
    fadeDuration: Math.max(0, Number(fadeDuration) || 0)
  };
}

/**
 * SoundItem Factory (Metadata for registered audio files)
 */
export function createSoundItem({
  id = generateId('snd'),
  name = '無題の音声',
  fileName = '',
  fileType = 'audio/mpeg',
  fileSize = 0,
  duration = 0,
  defaultVolume = 1.0,
  defaultPlaybackRate = 1.0,
  defaultDetune = 0,
  defaultOverlapMode = OverlapMode.OVERLAP
} = {}) {
  return {
    id,
    name,
    fileName,
    fileType,
    fileSize,
    duration,
    defaultVolume: Math.max(0, Math.min(2.0, Number(defaultVolume) || 1.0)),
    defaultPlaybackRate: Math.max(0.25, Math.min(4.0, Number(defaultPlaybackRate) || 1.0)),
    defaultDetune: Math.max(-2400, Math.min(2400, Number(defaultDetune) || 0)),
    defaultOverlapMode
  };
}

/**
 * Direct Sound Mapping Factory
 */
export function createDirectSoundMapping(keyCode, soundId, customName = '') {
  return {
    id: generateId('dmap'),
    keyCode, // e.g. 'Digit1', 'KeyQ'
    soundId,
    customName
  };
}

/**
 * Default Keymaps configuration (Standard US/JIS physical key codes)
 */
export function createDefaultKeymaps() {
  return {
    // 進行・安全操作キー
    'Space': { action: ActionType.CUE_TRIGGER, label: 'キュー再生 / 進行' },
    'Enter': { action: ActionType.CUE_TRIGGER, label: 'キュー再生 / 進行' },
    'NumpadEnter': { action: ActionType.CUE_TRIGGER, label: 'キュー再生 / 進行' },
    'ArrowDown': { action: ActionType.CUE_NEXT, label: 'キュー確認 (次へ)' },
    'ArrowUp': { action: ActionType.CUE_PREV, label: 'キュー確認 (前へ・巻き戻し)' },
    'Escape': { action: ActionType.PANIC_STOP, label: '非常停止 (全音即時停止)' },
    'Backspace': { action: ActionType.STOP_LAST, label: '直前の音のみ停止' },
    'KeyP': { action: ActionType.PAUSE_RESUME_CURRENT, label: '一時停止 / 再開' },
    'KeyM': { action: ActionType.MUTE_TOGGLE, label: 'マスターミュート' },
    'PageDown': { action: ActionType.ACT_NEXT, label: '次の幕へ' },
    'PageUp': { action: ActionType.ACT_PREV, label: '前の幕へ' },

    // 直接SE割り当て初期スロット（数字キー 1〜0）
    'Digit1': { action: ActionType.PLAY_DIRECT, soundId: null, label: 'SE 1' },
    'Digit2': { action: ActionType.PLAY_DIRECT, soundId: null, label: 'SE 2' },
    'Digit3': { action: ActionType.PLAY_DIRECT, soundId: null, label: 'SE 3' },
    'Digit4': { action: ActionType.PLAY_DIRECT, soundId: null, label: 'SE 4' },
    'Digit5': { action: ActionType.PLAY_DIRECT, soundId: null, label: 'SE 5' },
    'Digit6': { action: ActionType.PLAY_DIRECT, soundId: null, label: 'SE 6' },
    'Digit7': { action: ActionType.PLAY_DIRECT, soundId: null, label: 'SE 7' },
    'Digit8': { action: ActionType.PLAY_DIRECT, soundId: null, label: 'SE 8' },
    'Digit9': { action: ActionType.PLAY_DIRECT, soundId: null, label: 'SE 9' },
    'Digit0': { action: ActionType.PLAY_DIRECT, soundId: null, label: 'SE 0' },

    // テンキー 1〜9 (外付けテンキー用)
    'Numpad1': { action: ActionType.PLAY_DIRECT, soundId: null, label: 'テンキー 1' },
    'Numpad2': { action: ActionType.PLAY_DIRECT, soundId: null, label: 'テンキー 2' },
    'Numpad3': { action: ActionType.PLAY_DIRECT, soundId: null, label: 'テンキー 3' },
    'Numpad4': { action: ActionType.PLAY_DIRECT, soundId: null, label: 'テンキー 4' },
    'Numpad5': { action: ActionType.PLAY_DIRECT, soundId: null, label: 'テンキー 5' },
    'Numpad6': { action: ActionType.PLAY_DIRECT, soundId: null, label: 'テンキー 6' },
    'Numpad7': { action: ActionType.PLAY_DIRECT, soundId: null, label: 'テンキー 7' },
    'Numpad8': { action: ActionType.PLAY_DIRECT, soundId: null, label: 'テンキー 8' },
    'Numpad9': { action: ActionType.PLAY_DIRECT, soundId: null, label: 'テンキー 9' }
  };
}

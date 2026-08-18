/**
 * CS_sumpler - Automated Test Suite
 *
 * Runs comprehensive unit and integration tests on the core theater playback engine.
 */

import {
  TheaterSystem,
  AudioEngine,
  AudioTrack,
  CueManager,
  KeymapManager,
  StorageManager,
  OverlapMode,
  PlaybackState,
  ActionType,
  createDefaultProject,
  createCue,
  createSoundItem
} from '../src/index.js';

// ============================================================================
// Lightweight Web Audio API Mock for Node.js Testing Environment
// ============================================================================

class MockAudioParam {
  constructor(defaultValue = 1.0) {
    this.value = defaultValue;
  }
  setValueAtTime(val) {
    this.value = val;
  }
  linearRampToValueAtTime(val) {
    this.value = val;
  }
  cancelScheduledValues() {}
}

class MockAudioNode {
  connect(dest) {
    this.destination = dest;
    return dest;
  }
  disconnect() {
    this.destination = null;
  }
}

class MockGainNode extends MockAudioNode {
  constructor() {
    super();
    this.gain = new MockAudioParam(1.0);
  }
}

class MockAudioBufferSourceNode extends MockAudioNode {
  constructor(ctx) {
    super();
    this.ctx = ctx;
    this.buffer = null;
    this.loop = false;
    this.playbackRate = new MockAudioParam(1.0);
    this.detune = new MockAudioParam(0);
    this.onended = null;
    this._playing = false;
  }

  start(when = 0, offset = 0) {
    this._playing = true;
    this.offset = offset;
  }

  stop() {
    if (this._playing) {
      this._playing = false;
      if (typeof this.onended === 'function') {
        this.onended();
      }
    }
  }
}

class MockAudioBuffer {
  constructor({ duration = 5.0, sampleRate = 44100, numberOfChannels = 2 } = {}) {
    this.duration = duration;
    this.sampleRate = sampleRate;
    this.numberOfChannels = numberOfChannels;
  }
}

class MockAudioContext {
  constructor() {
    this.currentTime = 100.0;
    this.state = 'running';
    this.destination = new MockAudioNode();
  }

  createGain() {
    return new MockGainNode();
  }

  createBufferSource() {
    return new MockAudioBufferSourceNode(this);
  }

  async decodeAudioData(arrayBuffer) {
    return new MockAudioBuffer({ duration: 3.5, sampleRate: 44100, numberOfChannels: 2 });
  }

  async resume() {
    this.state = 'running';
  }
}

// ============================================================================
// Test Framework Helpers
// ============================================================================

let totalTests = 0;
let passedTests = 0;
let failedTests = 0;

function assert(condition, message) {
  totalTests++;
  if (condition) {
    passedTests++;
    console.log(`  ✓ ${message}`);
  } else {
    failedTests++;
    console.error(`  ✗ FAIL: ${message}`);
  }
}

function assertEqual(actual, expected, message) {
  assert(actual === expected, `${message} (Expected: ${expected}, Got: ${actual})`);
}

function assertDeepEqual(actual, expected, message) {
  const actualJson = JSON.stringify(actual);
  const expectedJson = JSON.stringify(expected);
  assert(actualJson === expectedJson, `${message} (Expected: ${expectedJson}, Got: ${actualJson})`);
}

console.log('====================================================');
console.log('CS_sumpler Core System Test Suite');
console.log('====================================================\n');

// ============================================================================
// 1. Data Models & Factory Tests
// ============================================================================
console.log('1. Testing Data Models & Factory Functions');

const defaultProj = createDefaultProject('テスト劇');
assert(defaultProj.name === 'テスト劇', 'Default project has correct name');
assert(defaultProj.acts.length === 1, 'Default project initializes with 1 Act');
assert(defaultProj.keymaps['Space'].action === ActionType.CUE_TRIGGER, 'Space is mapped to CUE_TRIGGER');
assert(defaultProj.keymaps['Escape'].action === ActionType.PANIC_STOP, 'Escape is mapped to PANIC_STOP');
assert(defaultProj.keymaps['Backspace'].action === ActionType.STOP_LAST, 'Backspace is mapped to STOP_LAST');

const cue = createCue({
  name: '雷鳴',
  volume: 1.5,
  playbackRate: 2.0,
  detune: 1200, // +1 octave
  overlapMode: OverlapMode.RESTART
});
assertEqual(cue.volume, 1.5, 'Cue volume set correctly');
assertEqual(cue.playbackRate, 2.0, 'Cue playbackRate set correctly');
assertEqual(cue.detune, 1200, 'Cue detune (pitch shift) set correctly');
assertEqual(cue.overlapMode, OverlapMode.RESTART, 'Cue overlapMode set to restart');

// Clamping tests
const clampedCue = createCue({ volume: 5.0, playbackRate: 10.0, detune: 5000 });
assertEqual(clampedCue.volume, 2.0, 'Cue volume clamped to 2.0');
assertEqual(clampedCue.playbackRate, 4.0, 'Cue playbackRate clamped to 4.0');
assertEqual(clampedCue.detune, 2400, 'Cue detune clamped to +2400 cents');

// ============================================================================
// 2. AudioTrack Voice Lifecycle, Speed, Pitch & Pause/Resume
// ============================================================================
console.log('\n2. Testing AudioTrack (Speed, Pitch, Pause & Resume)');

const mockCtx = new MockAudioContext();
const mockBuffer = new MockAudioBuffer({ duration: 10.0 });
const destNode = mockCtx.createGain();

let trackState = null;
const track = new AudioTrack({
  id: 'trk_test_1',
  soundId: 'snd_bell',
  name: 'チャイム',
  audioContext: mockCtx,
  audioBuffer: mockBuffer,
  destinationNode: destNode,
  volume: 0.8,
  playbackRate: 1.0,
  detune: 0,
  onStateChange: (t, s) => { trackState = s; }
});

assertEqual(track.state, PlaybackState.IDLE, 'AudioTrack initial state is IDLE');

// Start playback
track.play(0);
assertEqual(track.state, PlaybackState.PLAYING, 'AudioTrack is PLAYING after play()');
assertEqual(track.volume, 0.8, 'Volume is 0.8');

// Simulate time passing (advance ctx.currentTime from 100.0 to 103.0 = 3 seconds elapsed)
mockCtx.currentTime = 103.0;
assertEqual(track.getCurrentTime(), 3.0, 'Current time computed as 3.0s');
assertEqual(track.getProgress(), 0.3, 'Progress computed as 30% (3s / 10s)');

// Test pitch shift change
track.setDetune(700); // +7 semitones (perfect 5th)
assertEqual(track.detune, 700, 'Pitch shift detune set to 700 cents');
assertEqual(track.sourceNode.detune.value, 700, 'sourceNode.detune updated');

// Test playback speed change
track.setPlaybackRate(1.5);
assertEqual(track.playbackRate, 1.5, 'Playback rate set to 1.5x');

// Test Pause
track.pause();
assertEqual(track.state, PlaybackState.PAUSED, 'AudioTrack state is PAUSED after pause()');
assertEqual(track.pausedAtOffset, 3.0, 'pausedAtOffset accurately stored at 3.0s');

// Test Resume
mockCtx.currentTime = 110.0;
track.resume();
assertEqual(track.state, PlaybackState.PLAYING, 'AudioTrack is PLAYING after resume()');
assertEqual(track.offsetAtStart, 3.0, 'Resume starts from 3.0s offset');

// Advance time by 2 seconds with 1.5x speed -> 2 * 1.5 = 3 seconds progress -> total 6.0s
mockCtx.currentTime = 112.0;
assertEqual(track.getCurrentTime(), 6.0, 'Current time is 6.0s with 1.5x rate after resume');

// Stop
track.stop(0);
assertEqual(track.state, PlaybackState.STOPPED, 'AudioTrack is STOPPED after stop()');

// ============================================================================
// 3. AudioEngine Polyphony, Overlap Modes & Panic Stop
// ============================================================================
console.log('\n3. Testing AudioEngine Polyphony, Overlap Modes & Panic Controls');

const engine = new AudioEngine({ audioContext: mockCtx, masterVolume: 0.9 });
engine.registerBuffer('snd_bgm', new MockAudioBuffer({ duration: 60.0 }));
engine.registerBuffer('snd_thunder', new MockAudioBuffer({ duration: 4.0 }));

assert(engine.hasSound('snd_bgm'), 'AudioEngine registered snd_bgm');
assert(engine.hasSound('snd_thunder'), 'AudioEngine registered snd_thunder');

// Overlap mode test: 2 concurrent plays
const trackBgm = engine.playSound('snd_bgm', { volume: 0.7, overlapMode: OverlapMode.OVERLAP });
const trackThunder = engine.playSound('snd_thunder', { volume: 1.0, overlapMode: OverlapMode.OVERLAP });

assertEqual(engine.activeTracks.size, 2, 'AudioEngine has 2 polyphonic active tracks');
assertEqual(trackBgm.state, PlaybackState.PLAYING, 'BGM is playing');
assertEqual(trackThunder.state, PlaybackState.PLAYING, 'Thunder is playing');

// Restart mode test: Triggering thunder with RESTART stops previous thunder
const trackThunder2 = engine.playSound('snd_thunder', { volume: 1.0, overlapMode: OverlapMode.RESTART });
assertEqual(trackThunder.state, PlaybackState.STOPPED, 'Prior thunder instance was stopped by RESTART');
assertEqual(trackThunder2.state, PlaybackState.PLAYING, 'New thunder instance is playing');

// Single mode test: Triggering with SINGLE is ignored while playing
const trackThunderBlocked = engine.playSound('snd_thunder', { overlapMode: OverlapMode.SINGLE });
assert(trackThunderBlocked === null, 'Trigger was blocked by SINGLE overlapMode while playing');

// Stop Last test (Backspace)
const stoppedLast = engine.stopLast(0);
assert(stoppedLast, 'stopLast successfully stopped newest track');
assertEqual(trackThunder2.state, PlaybackState.STOPPED, 'Thunder2 stopped');
assertEqual(engine.activeTracks.size, 1, 'Only BGM remains active');

// Panic Stop test (Esc)
engine.stopAll(0);
assertEqual(engine.activeTracks.size, 0, 'stopAll (Panic Stop) cleared all active tracks');
assertEqual(trackBgm.state, PlaybackState.STOPPED, 'BGM stopped by Panic Stop');

// Master Mute & Volume
engine.setMasterVolume(0.5);
assertEqual(engine.masterVolume, 0.5, 'Master volume set to 0.5');
const isMuted = engine.toggleMasterMute();
assert(isMuted, 'Master is muted after toggle');
assert(!engine.toggleMasterMute(), 'Master is unmuted after second toggle');

// ============================================================================
// 4. CueManager Multi-Act Sequence, Stepping & Auto-Advance
// ============================================================================
console.log('\n4. Testing CueManager (Multi-Act, Stepping & Auto-Advance)');

const cueMgr = new CueManager();
assertEqual(cueMgr.acts.length, 1, 'CueManager initialized with 1 Act');

// Add Act 2
const act2 = cueMgr.addAct('第2幕 屋上');
assertEqual(cueMgr.acts.length, 2, 'CueManager now has 2 Acts');

// Add Cues to Act 1
const c1 = cueMgr.addCue({ name: 'オープニングBGM', soundId: 'snd_bgm', autoAdvance: true });
const c2 = cueMgr.addCue({ name: 'せりふ: ようこそ', soundId: 'snd_dialogue_1', autoAdvance: true });
const c3 = cueMgr.addCue({ name: '拍手SE', soundId: 'snd_applause', autoAdvance: false });

assertEqual(cueMgr.getCues().length, 3, 'Act 1 has 3 cues');
assertEqual(cueMgr.getCurrentCueIndex(), 0, 'Initial cue cursor at index 0');
assertEqual(cueMgr.getCurrentCue().name, 'オープニングBGM', 'Current cue is c1');

// Trigger Cue 1 (autoAdvance = true -> cursor moves to 1)
let triggeredSoundId = null;
const res1 = cueMgr.triggerCurrentCue((c) => {
  triggeredSoundId = c.soundId;
  return { id: 'dummy_track' };
});
assertEqual(triggeredSoundId, 'snd_bgm', 'Triggered soundId is snd_bgm');
assert(res1.advanced, 'Cursor auto-advanced');
assertEqual(cueMgr.getCurrentCueIndex(), 1, 'Cursor advanced to index 1');
assertEqual(cueMgr.getCurrentCue().name, 'せりふ: ようこそ', 'Current cue is now c2');

// Manual Step Forward (ArrowDown) without playing
cueMgr.stepNext();
assertEqual(cueMgr.getCurrentCueIndex(), 2, 'stepNext moved cursor to index 2 (拍手SE)');

// Manual Step Backward (ArrowUp / Rewind)
cueMgr.stepPrev();
assertEqual(cueMgr.getCurrentCueIndex(), 1, 'stepPrev rewound cursor back to index 1');

// Jump directly to cue (Rehearsal jump)
cueMgr.jumpTo(cueMgr.activeActId, 2);
assertEqual(cueMgr.getCurrentCueIndex(), 2, 'jumpTo moved cursor to index 2');

// Switch to Act 2
cueMgr.setActiveAct(act2.id);
assertEqual(cueMgr.getActiveAct().name, '第2幕 屋上', 'Active Act switched to Act 2');
assertEqual(cueMgr.getCues().length, 0, 'Act 2 currently has 0 cues');

cueMgr.addCue({ name: '風の音SE', soundId: 'snd_wind' });
assertEqual(cueMgr.getCues().length, 1, 'Act 2 has 1 cue');

// Switch back to Act 1
cueMgr.prevAct();
assertEqual(cueMgr.getActiveAct().name, '第1幕', 'Switched back to Act 1 via prevAct()');

// ============================================================================
// 5. KeymapManager Physical Key Bindings & Safe Text Typing
// ============================================================================
console.log('\n5. Testing KeymapManager (Physical Keys & Safe Typing)');

let dispatchedAction = null;
let dispatchedBinding = null;

const keymgr = new KeymapManager({
  onAction: (action, binding) => {
    dispatchedAction = action;
    dispatchedBinding = binding;
  }
});

// Bind custom key
keymgr.bindKey('KeyQ', { action: ActionType.PLAY_DIRECT, soundId: 'snd_bell', label: 'ベル' });
assertEqual(keymgr.getBinding('KeyQ').soundId, 'snd_bell', 'KeyQ bound to snd_bell');

// Simulate KeyQ keydown
keymgr._handleKeyDown({
  code: 'KeyQ',
  key: 'q',
  target: { tagName: 'BODY', isContentEditable: false },
  preventDefault: () => {}
});
assertEqual(dispatchedAction, ActionType.PLAY_DIRECT, 'Action PLAY_DIRECT dispatched for KeyQ');
assertEqual(dispatchedBinding.soundId, 'snd_bell', 'SoundId snd_bell received');

// Simulate typing in an <input> text field (should NOT trigger Space or KeyQ)
dispatchedAction = null;
keymgr._handleKeyDown({
  code: 'Space',
  key: ' ',
  target: { tagName: 'INPUT', type: 'text', isContentEditable: false },
  preventDefault: () => {}
});
assert(dispatchedAction === null, 'Shortcut was safely ignored while typing in text input');

// Escape (Panic stop) MUST work even when typing in text input for safety!
keymgr._handleKeyDown({
  code: 'Escape',
  key: 'Escape',
  target: { tagName: 'INPUT', type: 'text', isContentEditable: false },
  preventDefault: () => {}
});
assertEqual(dispatchedAction, ActionType.PANIC_STOP, 'Panic Stop (Escape) triggered even when focused on input');

// Key Capture Mode (for settings UI)
let captured = null;
keymgr.startCaptureMode((res) => { captured = res; });
keymgr._handleKeyDown({
  code: 'Numpad7',
  key: '7',
  target: { tagName: 'BODY' },
  preventDefault: () => {},
  stopPropagation: () => {}
});
assert(captured !== null, 'Key capture mode recorded key');
assertEqual(captured.code, 'Numpad7', 'Captured physical code is Numpad7');
assert(!keymgr.isCaptureMode, 'Key capture mode automatically exited after 1 press');

// ============================================================================
// 6. StorageManager Serialization & Bundle Export/Import
// ============================================================================
console.log('\n6. Testing StorageManager (IndexedDB fallback, Bundle Export/Import)');

const storage = new StorageManager();
await storage.init();

const testProj = createDefaultProject('文化祭演劇');
testProj.sounds.push(createSoundItem({ id: 'snd_s1', name: '雷音', fileName: 'thunder.mp3' }));

await storage.saveProject(testProj);
const loadedProj = await storage.loadProject(testProj.id);
assertEqual(loadedProj.name, '文化祭演劇', 'Project saved and reloaded accurately');

// Save mock audio binary
const mockAudioData = new Uint8Array([0, 1, 2, 3, 4, 5, 255, 254]).buffer;
await storage.saveAudioFile('snd_s1', mockAudioData, { name: '雷音', fileName: 'thunder.mp3' });

const loadedAudio = await storage.getAudioFile('snd_s1');
assert(loadedAudio !== null, 'Audio file record retrieved');
assertEqual(loadedAudio.name, '雷音', 'Audio file name matches');

// Export Bundle
const bundleJson = await storage.exportProjectBundle(testProj);
assert(typeof bundleJson === 'string', 'Project bundle exported as JSON string');
assert(bundleJson.includes('CS_sumpler_project_bundle'), 'Bundle contains format header');

// Import Bundle into fresh storage instance
const storage2 = new StorageManager();
await storage2.init();
const importedProject = await storage2.importProjectBundle(bundleJson);
assertEqual(importedProject.name, '文化祭演劇', 'Imported project name matches');

const importedAudio = await storage2.getAudioFile('snd_s1');
assert(importedAudio !== null, 'Imported audio file recovered into database');

// ============================================================================
// 7. TheaterSystem Full Integration Facade
// ============================================================================
console.log('\n7. Testing TheaterSystem Integrated Facade');

const system = new TheaterSystem({ audioContext: mockCtx });
await system.init();

// Register a sound file
const mockBufferData = new Uint8Array([1, 2, 3, 4]).buffer;
const soundItem = await system.registerAudioFile(mockBufferData, {
  name: '開幕ベル',
  fileName: 'bell.mp3'
});
assertEqual(soundItem.name, '開幕ベル', 'Sound registered via system facade');
assert(system.audio.hasSound(soundItem.id), 'Sound buffer loaded into audio engine');

// Assign to direct key 'Digit1'
system.assignDirectSoundKey('Digit1', soundItem.id, 'ベル(1)');
const binding1 = system.keymap.getBinding('Digit1');
assertEqual(binding1.soundId, soundItem.id, 'Digit1 assigned to soundItem.id');

// Trigger direct sound via key simulation
const trackDirect = system.playDirectSound('Digit1');
assert(trackDirect !== null, 'Direct sound played');
assertEqual(trackDirect.state, PlaybackState.PLAYING, 'Direct sound is playing');

// Add a cue referencing this sound
const act = system.cues.getActiveAct();
const cue1 = system.cues.addCue({
  name: 'ベルを鳴らす',
  soundId: soundItem.id,
  playbackRate: 1.25,
  detune: 300,
  autoAdvance: true
});

// Trigger Cue
const cueRes = system.triggerCue();
assert(cueRes.track !== null, 'Cue playback started');
assertEqual(cueRes.track.playbackRate, 1.25, 'Cue override playbackRate applied');
assertEqual(cueRes.track.detune, 300, 'Cue override pitch detune applied');

// Test Master Volume and Panic Stop
system.setMasterVolume(0.8);
assertEqual(system.getProject().settings.masterVolume, 0.8, 'Project master volume updated');

system.panicStop();
assertEqual(system.audio.activeTracks.size, 0, 'Panic stop cleared all playing sounds');

// Clean up
system.dispose();

console.log('\n====================================================');
console.log(`Test Results: Total ${totalTests}, Passed ${passedTests}, Failed ${failedTests}`);
console.log('====================================================\n');

if (failedTests > 0) {
  process.exit(1);
} else {
  console.log('All tests passed successfully! Core system is rock solid.\n');
}

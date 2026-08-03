/**
 * Web Audio mocks for jest — the ONLY thing this suite mocks.
 *
 * jsdom has no AudioContext, so without these the Piano cannot be constructed
 * and Player.play() would be untestable. Same approach (and lineage) as
 * resound-sound's setupMocks.js and resound-fe's __tests__/helpers/mocks.js:
 * stub the browser API, then exercise the real instruments through it.
 *
 * jsdom's own `document` and `window` are left alone — score.test.js renders
 * into them.
 */

class MockParam {
  constructor(value = 0) {
    this.value = value;
    this.setValueAtTime = jest.fn();
    this.linearRampToValueAtTime = jest.fn();
    this.exponentialRampToValueAtTime = jest.fn();
    this.setTargetAtTime = jest.fn();
    this.cancelScheduledValues = jest.fn();
  }
}

class MockNode {
  connect() { return this; }

  disconnect() {}
}

class MockGainNode extends MockNode {
  constructor() {
    super();
    this.gain = new MockParam(1);
  }
}

class MockOscillatorNode extends MockNode {
  constructor() {
    super();
    this.frequency = new MockParam(440);
    this.detune = new MockParam(0);
    this.type = 'sine';
    this.onended = null;
  }

  start() {}

  stop() {
    if (this.onended) setTimeout(() => this.onended(), 0);
  }

  setPeriodicWave() { this.type = 'custom'; }
}

class MockBiquadFilterNode extends MockNode {
  constructor() {
    super();
    this.type = 'lowpass';
    this.frequency = new MockParam(350);
    this.Q = new MockParam(1);
    this.gain = new MockParam(0);
  }
}

class MockWaveShaperNode extends MockNode {
  constructor() {
    super();
    this.curve = null;
    this.oversample = 'none';
  }
}

class MockAudioContext {
  constructor() {
    this.currentTime = 0;
    this.destination = {};
    this.state = 'running';
    this.sampleRate = 44100;
  }

  createOscillator() { return new MockOscillatorNode(); }

  createGain() { return new MockGainNode(); }

  createBiquadFilter() { return new MockBiquadFilterNode(); }

  createWaveShaper() { return new MockWaveShaperNode(); }

  createPeriodicWave() { return {}; }

  createBuffer(channels, length, sampleRate) {
    const data = new Float32Array(length);
    return {
      numberOfChannels: channels,
      length,
      sampleRate: sampleRate || this.sampleRate,
      getChannelData: () => data,
    };
  }

  createBufferSource() {
    return {
      buffer: null, onended: null, connect: () => ({ connect: () => {} }), start: () => {}, stop: () => {},
    };
  }

  resume() { this.state = 'running'; return Promise.resolve(); }

  suspend() { this.state = 'suspended'; return Promise.resolve(); }
}

// The Piano pre-renders its sample buffers through an OfflineAudioContext;
// warm() throws outright without one.
class MockOfflineAudioContext extends MockAudioContext {
  constructor(channels = 1, length = 44100, sampleRate = 44100) {
    super();
    this.numberOfChannels = channels;
    this.length = length;
    this.sampleRate = sampleRate;
  }

  startRendering() {
    return Promise.resolve(this.createBuffer(this.numberOfChannels, this.length, this.sampleRate));
  }
}

global.AudioContext = MockAudioContext;
global.webkitAudioContext = MockAudioContext;
global.OfflineAudioContext = MockOfflineAudioContext;
global.webkitOfflineAudioContext = MockOfflineAudioContext;
window.AudioContext = MockAudioContext;
window.webkitAudioContext = MockAudioContext;
window.OfflineAudioContext = MockOfflineAudioContext;

// Pure Web Audio API synthesizer for Zepto logo sound, engine revs, and drifting tire screeches.
// Zero external audio files required - generates high quality synthesized sounds in real time.

class SoundEffects {
  private ctx: AudioContext | null = null;
  private driftOsc: OscillatorNode | null = null;
  private driftGain: GainNode | null = null;
  private driftNoise: AudioBufferSourceNode | null = null;
  private driftNoiseGain: GainNode | null = null;
  private isDrifting = false;

  private init() {
    if (!this.ctx && typeof window !== 'undefined') {
      const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
      if (AudioCtx) {
        this.ctx = new AudioCtx();
      }
    }
    if (this.ctx && this.ctx.state === 'suspended') {
      this.ctx.resume().catch(() => {});
    }
  }

  // Signature Zepto x Hot Wheels chime and engine roar
  playZeptoSound() {
    this.init();
    if (!this.ctx) return;
    const now = this.ctx.currentTime;

    // 1. Zepto energetic melodic chime (ascending 3-tone arpeggio: C5, E5, G5)
    const freqs = [523.25, 659.25, 783.99, 1046.5];
    freqs.forEach((freq, idx) => {
      const osc = this.ctx!.createOscillator();
      const gain = this.ctx!.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(freq, now + idx * 0.07);
      gain.gain.setValueAtTime(0.2, now + idx * 0.07);
      gain.gain.exponentialRampToValueAtTime(0.001, now + idx * 0.07 + 0.35);

      osc.connect(gain);
      gain.connect(this.ctx!.destination);
      osc.start(now + idx * 0.07);
      osc.stop(now + idx * 0.07 + 0.4);
    });

    // 2. Hot Wheels turbocharged engine rev
    const revStart = now + 0.28;
    const engineOsc = this.ctx.createOscillator();
    const engineGain = this.ctx.createGain();
    const filter = this.ctx.createBiquadFilter();

    engineOsc.type = 'sawtooth';
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(300, revStart);
    filter.frequency.exponentialRampToValueAtTime(2400, revStart + 0.3);
    filter.frequency.exponentialRampToValueAtTime(600, revStart + 0.8);

    engineOsc.frequency.setValueAtTime(80, revStart);
    engineOsc.frequency.exponentialRampToValueAtTime(380, revStart + 0.3);
    engineOsc.frequency.exponentialRampToValueAtTime(120, revStart + 0.8);

    engineGain.gain.setValueAtTime(0.01, revStart);
    engineGain.gain.linearRampToValueAtTime(0.25, revStart + 0.15);
    engineGain.gain.exponentialRampToValueAtTime(0.001, revStart + 0.85);

    engineOsc.connect(filter);
    filter.connect(engineGain);
    engineGain.connect(this.ctx.destination);

    engineOsc.start(revStart);
    engineOsc.stop(revStart + 0.9);
  }

  // Realistic tire screech and asphalt friction for drift powersliding
  setDrifting(active: boolean) {
    this.init();
    if (!this.ctx) return;

    if (active && !this.isDrifting) {
      this.isDrifting = true;
      const now = this.ctx.currentTime;

      // High-pitched squeal oscillator
      this.driftOsc = this.ctx.createOscillator();
      this.driftGain = this.ctx.createGain();
      const filter = this.ctx.createBiquadFilter();

      this.driftOsc.type = 'sawtooth';
      this.driftOsc.frequency.setValueAtTime(950, now);
      this.driftOsc.frequency.linearRampToValueAtTime(1150, now + 0.2);

      filter.type = 'bandpass';
      filter.frequency.setValueAtTime(1800, now);
      filter.Q.setValueAtTime(4.0, now);

      this.driftGain.gain.setValueAtTime(0.01, now);
      this.driftGain.gain.linearRampToValueAtTime(0.18, now + 0.08);

      this.driftOsc.connect(filter);
      filter.connect(this.driftGain);
      this.driftGain.connect(this.ctx.destination);
      this.driftOsc.start(now);

      // White noise for tire friction
      const bufferSize = this.ctx.sampleRate * 2;
      const noiseBuffer = this.ctx.createBuffer(1, bufferSize, this.ctx.sampleRate);
      const output = noiseBuffer.getChannelData(0);
      for (let i = 0; i < bufferSize; i++) {
        output[i] = Math.random() * 2 - 1;
      }

      this.driftNoise = this.ctx.createBufferSource();
      this.driftNoise.buffer = noiseBuffer;
      this.driftNoise.loop = true;

      const noiseFilter = this.ctx.createBiquadFilter();
      noiseFilter.type = 'bandpass';
      noiseFilter.frequency.setValueAtTime(2200, now);
      noiseFilter.Q.setValueAtTime(3.0, now);

      this.driftNoiseGain = this.ctx.createGain();
      this.driftNoiseGain.gain.setValueAtTime(0.01, now);
      this.driftNoiseGain.gain.linearRampToValueAtTime(0.14, now + 0.08);

      this.driftNoise.connect(noiseFilter);
      noiseFilter.connect(this.driftNoiseGain);
      this.driftNoiseGain.connect(this.ctx.destination);
      this.driftNoise.start(now);
    } else if (!active && this.isDrifting) {
      this.isDrifting = false;
      const now = this.ctx?.currentTime || 0;

      if (this.driftGain && this.driftOsc) {
        this.driftGain.gain.linearRampToValueAtTime(0.001, now + 0.1);
        this.driftOsc.stop(now + 0.12);
        this.driftOsc = null;
        this.driftGain = null;
      }

      if (this.driftNoiseGain && this.driftNoise) {
        this.driftNoiseGain.gain.linearRampToValueAtTime(0.001, now + 0.1);
        this.driftNoise.stop(now + 0.12);
        this.driftNoise = null;
        this.driftNoiseGain = null;
      }
    }
  }
}

export const sounds = new SoundEffects();

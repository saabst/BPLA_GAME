// Процедурный синтезатор звука БПЛА «Герань-2М» и аппаратуры управления

class DroneAudioSystem {
  private ctx: AudioContext | null = null;
  private masterGain: GainNode | null = null;
  private enabled = true;

  // Узлы двигателя
  private engineOsc1: OscillatorNode | null = null;
  private engineOsc2: OscillatorNode | null = null;
  private engineMod: OscillatorNode | null = null;
  private engineFilter: BiquadFilterNode | null = null;
  private engineGain: GainNode | null = null;

  // Шум ветра и помех
  private noiseBuffer: AudioBuffer | null = null;
  private windSource: AudioBufferSourceNode | null = null;
  private windFilter: BiquadFilterNode | null = null;
  private windGain: GainNode | null = null;

  private ewSource: AudioBufferSourceNode | null = null;
  private ewGain: GainNode | null = null;

  private staticSource: AudioBufferSourceNode | null = null;
  private staticGain: GainNode | null = null;

  private lastSamBeep = 0;
  private lastPullUpBeep = 0;

  public unlock() {
    if (!this.enabled) return;
    try {
      if (!this.ctx) {
        const AC = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
        this.ctx = new AC();
        this.masterGain = this.ctx.createGain();
        this.masterGain.gain.value = 0.45;
        this.masterGain.connect(this.ctx.destination);
        this.createNoiseBuffer();
      }
      if (this.ctx.state === 'suspended') {
        this.ctx.resume();
      }
    } catch {
      // Ignore WebAudio restrictions if blocked
    }
  }

  public setEnabled(on: boolean) {
    this.enabled = on;
    if (!on) {
      this.stopFlightAudio();
      this.stopStaticNoise();
      if (this.masterGain && this.ctx) {
        this.masterGain.gain.setTargetAtTime(0, this.ctx.currentTime, 0.05);
      }
    } else {
      this.unlock();
      if (this.masterGain && this.ctx) {
        this.masterGain.gain.setTargetAtTime(0.45, this.ctx.currentTime, 0.05);
      }
    }
  }

  private createNoiseBuffer() {
    if (!this.ctx) return;
    const len = this.ctx.sampleRate * 2;
    const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) {
      data[i] = Math.random() * 2 - 1;
    }
    this.noiseBuffer = buf;
  }

  public startFlightAudio() {
    if (!this.enabled) return;
    this.unlock();
    if (!this.ctx || !this.masterGain || !this.noiseBuffer) return;

    this.stopFlightAudio();
    this.stopStaticNoise();

    const now = this.ctx.currentTime;

    // Характерный двухтактный оппозитный поршневой рокот «Герани»
    this.engineGain = this.ctx.createGain();
    this.engineGain.gain.setValueAtTime(0.001, now);
    this.engineGain.gain.linearRampToValueAtTime(0.16, now + 0.35);

    this.engineFilter = this.ctx.createBiquadFilter();
    this.engineFilter.type = 'bandpass';
    this.engineFilter.frequency.setValueAtTime(420, now);
    this.engineFilter.Q.setValueAtTime(2.6, now);

    this.engineOsc1 = this.ctx.createOscillator();
    this.engineOsc1.type = 'sawtooth';
    this.engineOsc1.frequency.setValueAtTime(118, now);

    this.engineOsc2 = this.ctx.createOscillator();
    this.engineOsc2.type = 'square';
    this.engineOsc2.frequency.setValueAtTime(59, now);

    const osc2SubGain = this.ctx.createGain();
    osc2SubGain.gain.value = 0.55;

    // Вибрация цилиндров
    this.engineMod = this.ctx.createOscillator();
    this.engineMod.type = 'sine';
    this.engineMod.frequency.setValueAtTime(29.5, now);
    const modGain = this.ctx.createGain();
    modGain.gain.value = 5;

    this.engineMod.connect(modGain);
    modGain.connect(this.engineOsc1.frequency);

    this.engineOsc1.connect(this.engineFilter);
    this.engineOsc2.connect(osc2SubGain);
    osc2SubGain.connect(this.engineFilter);
    this.engineFilter.connect(this.engineGain);
    this.engineGain.connect(this.masterGain);

    this.engineOsc1.start(now);
    this.engineOsc2.start(now);
    this.engineMod.start(now);

    // Аэродинамический шум потока
    this.windSource = this.ctx.createBufferSource();
    this.windSource.buffer = this.noiseBuffer;
    this.windSource.loop = true;

    this.windFilter = this.ctx.createBiquadFilter();
    this.windFilter.type = 'bandpass';
    this.windFilter.frequency.setValueAtTime(700, now);
    this.windFilter.Q.setValueAtTime(0.9, now);

    this.windGain = this.ctx.createGain();
    this.windGain.gain.setValueAtTime(0.02, now);

    this.windSource.connect(this.windFilter);
    this.windFilter.connect(this.windGain);
    this.windGain.connect(this.masterGain);
    this.windSource.start(now);

    // Канал помех РЭБ
    this.ewSource = this.ctx.createBufferSource();
    this.ewSource.buffer = this.noiseBuffer;
    this.ewSource.loop = true;

    const ewFilter = this.ctx.createBiquadFilter();
    ewFilter.type = 'highpass';
    ewFilter.frequency.setValueAtTime(1800, now);

    this.ewGain = this.ctx.createGain();
    this.ewGain.gain.setValueAtTime(0, now);

    this.ewSource.connect(ewFilter);
    ewFilter.connect(this.ewGain);
    this.ewGain.connect(this.masterGain);
    this.ewSource.start(now);
  }

  public updateFlightAudio(
    speedKmh: number,
    ewInterference: number,
    samWarning: boolean,
    pullUpWarning = false
  ) {
    if (!this.enabled || !this.ctx) return;
    const now = this.ctx.currentTime;

    // Нормализованные обороты от 140 до 320 км/ч
    const norm = Math.max(0, Math.min(1.2, (speedKmh - 140) / 170));

    if (this.engineOsc1 && this.engineOsc2 && this.engineFilter && this.engineGain) {
      const baseFreq = 104 + norm * 82;
      this.engineOsc1.frequency.setTargetAtTime(baseFreq, now, 0.08);
      this.engineOsc2.frequency.setTargetAtTime(baseFreq * 0.5, now, 0.08);
      this.engineFilter.frequency.setTargetAtTime(360 + norm * 420, now, 0.08);
      this.engineGain.gain.setTargetAtTime(0.13 + norm * 0.08, now, 0.08);
    }

    if (this.windGain && this.windFilter) {
      this.windGain.gain.setTargetAtTime(0.015 + norm * norm * 0.075, now, 0.08);
      this.windFilter.frequency.setTargetAtTime(550 + norm * 900, now, 0.08);
    }

    if (this.ewGain) {
      const jitter = ewInterference > 0.05 ? (0.6 + Math.random() * 0.6) : 0;
      this.ewGain.gain.setTargetAtTime(ewInterference * 0.09 * jitter, now, 0.04);
    }

    // Сигнал облучения / пуска ЗРК
    if (samWarning && now - this.lastSamBeep > 0.28) {
      this.lastSamBeep = now;
      this.playTone(1320, 0.07, 'square', 0.07);
      setTimeout(() => this.playTone(980, 0.07, 'square', 0.06), 80);
    }

    // Предупреждение опасного сближения с землей (ССОЗ «ТЯНИ ВВЕРХ!»)
    if (pullUpWarning && now - this.lastPullUpBeep > 0.36) {
      this.lastPullUpBeep = now;
      this.playTone(620, 0.09, 'sawtooth', 0.065);
      setTimeout(() => this.playTone(790, 0.09, 'sawtooth', 0.065), 110);
    }
  }

  public stopFlightAudio() {
    try {
      this.engineOsc1?.stop();
      this.engineOsc2?.stop();
      this.engineMod?.stop();
      this.windSource?.stop();
      this.ewSource?.stop();
    } catch {
      // already stopped
    }
    this.engineOsc1 = null;
    this.engineOsc2 = null;
    this.engineMod = null;
    this.windSource = null;
    this.ewSource = null;
  }

  /** Мгновенный срыв радиоканала в белый шум при детонации БЧ */
  public triggerImpactStatic() {
    this.stopFlightAudio();
    if (!this.enabled || !this.ctx || !this.masterGain || !this.noiseBuffer) return;

    const now = this.ctx.currentTime;

    // Короткий жесткий щелчок обрыва несущей
    this.playTone(160, 0.05, 'sawtooth', 0.25);

    this.stopStaticNoise();
    this.staticSource = this.ctx.createBufferSource();
    this.staticSource.buffer = this.noiseBuffer;
    this.staticSource.loop = true;

    const bp = this.ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.setValueAtTime(2200, now);
    bp.Q.setValueAtTime(0.65, now);

    this.staticGain = this.ctx.createGain();
    this.staticGain.gain.setValueAtTime(0.22, now);

    this.staticSource.connect(bp);
    bp.connect(this.staticGain);
    this.staticGain.connect(this.masterGain);
    this.staticSource.start(now);
  }

  public stopStaticNoise() {
    try {
      this.staticSource?.stop();
    } catch {
      // ignore
    }
    this.staticSource = null;
  }

  /** Глухой мощный раскат взрыва 50-кг ОФБЧ (с поддержкой кинематографического слоу-мо в Повторе!) */
  public playDistantDetonation(secondary: boolean, slowMoScale = 1.0) {
    this.stopStaticNoise();
    if (!this.enabled || !this.ctx || !this.masterGain || !this.noiseBuffer) return;

    const stretch = slowMoScale < 0.8 ? 1.85 : 1.0;
    const pitchMul = slowMoScale < 0.8 ? 0.68 : 1.0;
    const now = this.ctx.currentTime;

    const triggerBoom = (delay: number, power: number, dur: number) => {
      if (!this.ctx || !this.masterGain || !this.noiseBuffer) return;
      const src = this.ctx.createBufferSource();
      src.buffer = this.noiseBuffer;
      src.playbackRate.setValueAtTime(pitchMul, now + delay);

      const lp = this.ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.setValueAtTime(360 * power * pitchMul, now + delay);
      lp.frequency.exponentialRampToValueAtTime(48, now + delay + dur * stretch);

      const g = this.ctx.createGain();
      g.gain.setValueAtTime(0.001, now + delay);
      g.gain.linearRampToValueAtTime(0.4 * power, now + delay + 0.04 * stretch);
      g.gain.exponentialRampToValueAtTime(0.001, now + delay + dur * stretch);

      src.connect(lp);
      lp.connect(g);
      g.connect(this.masterGain);
      src.start(now + delay);
      src.stop(now + delay + dur * stretch + 0.05);
    };

    triggerBoom(0.03, 1.0, 1.65);
    if (secondary) {
      triggerBoom(0.5 * stretch, 1.28, 2.3);
    }
  }

  /** Близкий разрыв зенитного снаряда рядом с БПЛА */
  public playFlakBurst() {
    if (!this.enabled || !this.ctx || !this.masterGain || !this.noiseBuffer) return;
    const now = this.ctx.currentTime;
    const src = this.ctx.createBufferSource();
    src.buffer = this.noiseBuffer;

    const bp = this.ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.setValueAtTime(650 + Math.random() * 400, now);
    bp.Q.setValueAtTime(1.2, now);

    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.16, now);
    g.gain.exponentialRampToValueAtTime(0.001, now + 0.16);

    src.connect(bp);
    bp.connect(g);
    g.connect(this.masterGain);
    src.start(now);
    src.stop(now + 0.18);
  }

  public playUIClick() {
    if (!this.enabled) return;
    this.unlock();
    this.playTone(920, 0.035, 'sine', 0.05);
  }

  /** Характерный армейский щелчок тангенты рации (PTT) с коротким эфирным шумом */
  public playRadioSquelch() {
    if (!this.enabled) return;
    this.unlock();
    if (!this.ctx || !this.masterGain || !this.noiseBuffer) return;

    const now = this.ctx.currentTime;
    this.playTone(1480, 0.03, 'sine', 0.055);
    setTimeout(() => this.playTone(1920, 0.028, 'sine', 0.045), 32);

    const src = this.ctx.createBufferSource();
    src.buffer = this.noiseBuffer;

    const bp = this.ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.setValueAtTime(1650, now);
    bp.Q.setValueAtTime(1.8, now);

    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.065, now);
    g.gain.exponentialRampToValueAtTime(0.001, now + 0.14);

    src.connect(bp);
    bp.connect(g);
    g.connect(this.masterGain);
    src.start(now);
    src.stop(now + 0.16);
  }

  /** Звук прохождения электронного маршрутного створа в учебном вылете */
  public playGatePass() {
    if (!this.enabled) return;
    this.unlock();
    this.playTone(1046, 0.08, 'triangle', 0.085);
    setTimeout(() => this.playTone(1568, 0.14, 'triangle', 0.095), 75);
  }

  /** Отдаленный глухой раскат артиллерии на линии фронта */
  public playDistantArtillery() {
    if (!this.enabled || !this.ctx || !this.masterGain || !this.noiseBuffer) return;
    const now = this.ctx.currentTime;
    const src = this.ctx.createBufferSource();
    src.buffer = this.noiseBuffer;

    const lp = this.ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.setValueAtTime(140, now);
    lp.frequency.exponentialRampToValueAtTime(42, now + 1.1);

    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.001, now);
    g.gain.linearRampToValueAtTime(0.08, now + 0.08);
    g.gain.exponentialRampToValueAtTime(0.001, now + 1.15);

    src.connect(lp);
    lp.connect(g);
    g.connect(this.masterGain);
    src.start(now);
    src.stop(now + 1.2);
  }

  private playTone(freq: number, dur: number, type: OscillatorType, vol: number) {
    if (!this.ctx || !this.masterGain) return;
    const now = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, now);
    g.gain.setValueAtTime(vol, now);
    g.gain.exponentialRampToValueAtTime(0.001, now + dur);
    osc.connect(g);
    g.connect(this.masterGain);
    osc.start(now);
    osc.stop(now + dur + 0.01);
  }
}

export const soundFX = new DroneAudioSystem();

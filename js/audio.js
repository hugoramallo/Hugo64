// audio.js — WebAudio synth engine, retro instruments and sound effects.
(function (G) {
  'use strict';

  const A = {
    ctx: null, master: null, musicBus: null, sfxBus: null, noiseBuf: null,
    muted: false, musicOn: true, musicVol: 0.8, sfxVol: 0.85,
  };
  A.musicLevel = () => (A.musicOn ? 0.525 * A.musicVol : 0);
  A.sfxLevel = () => 0.706 * A.sfxVol;
  A.applyVolumes = function () {
    if (!A.ctx) return;
    A.musicBus.gain.setTargetAtTime(A.musicLevel(), A.ctx.currentTime, 0.05);
    A.sfxBus.gain.setTargetAtTime(A.sfxLevel(), A.ctx.currentTime, 0.05);
  };

  A.init = function () {
    if (A.ctx) { if (A.ctx.state === 'suspended') A.ctx.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    const ctx = (A.ctx = new AC());
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -14; comp.ratio.value = 4; comp.attack.value = 0.004; comp.release.value = 0.2;
    comp.connect(ctx.destination);
    A.master = ctx.createGain(); A.master.gain.value = 0.85;
    // everything passes a low-pass filter that closes when the camera goes underwater
    A.uwFilter = ctx.createBiquadFilter(); A.uwFilter.type = 'lowpass'; A.uwFilter.frequency.value = 22000; A.uwFilter.Q.value = 0.7;
    A.master.connect(A.uwFilter); A.uwFilter.connect(comp);
    A.musicBus = ctx.createGain(); A.musicBus.gain.value = A.musicLevel(); A.musicBus.connect(A.master);
    A.sfxBus = ctx.createGain(); A.sfxBus.gain.value = A.sfxLevel(); A.sfxBus.connect(A.master);
    // a light room reverb for the music (short synthetic impulse)
    const conv = ctx.createConvolver();
    const len = Math.floor(ctx.sampleRate * 1.1);
    const ir = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const d = ir.getChannelData(ch);
      for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 3.2);
    }
    conv.buffer = ir;
    A.reverb = ctx.createGain(); A.reverb.gain.value = 0.16;
    A.reverb.connect(conv); conv.connect(A.master);
    // white noise buffer shared by drums/sfx
    const nb = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
    const nd = nb.getChannelData(0);
    for (let i = 0; i < nd.length; i++) nd[i] = Math.random() * 2 - 1;
    A.noiseBuf = nb;
  };

  A.now = () => (A.ctx ? A.ctx.currentTime : 0);

  // muffle everything underwater (k = 0 dry .. 1 fully submerged)
  let uwK = 0;
  A.setUnderwater = function (k) {
    if (!A.ctx || Math.abs(k - uwK) < 0.01) return;
    uwK = k;
    A.uwFilter.frequency.setTargetAtTime(22000 * Math.pow(650 / 22000, k), A.ctx.currentTime, 0.04);
  };
  // looping ambiences (waterfall roar); vol 0..1
  const amb = {};
  A.setAmbient = function (name, vol) {
    if (!A.ctx) return;
    let a = amb[name];
    if (!a) {
      if (vol < 0.01) return;
      const ctx = A.ctx, src = ctx.createBufferSource();
      src.buffer = A.noiseBuf; src.loop = true;
      const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 1500;
      const hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 160;
      const g = ctx.createGain(); g.gain.value = 0;
      src.connect(lp); lp.connect(hp); hp.connect(g); g.connect(A.sfxBus);
      src.start();
      a = amb[name] = { g, vol: 0 };
    }
    const v = Math.round(vol * 50) / 50;
    if (v === a.vol) return;
    a.vol = v;
    a.g.gain.setTargetAtTime(v * v * 0.32, A.ctx.currentTime, 0.3);
  };
  A.setMuted = function (m) {
    A.muted = m;
    if (A.master) A.master.gain.setTargetAtTime(m ? 0 : 0.85, A.ctx.currentTime, 0.05);
  };

  const mtof = (m) => 440 * Math.pow(2, (m - 69) / 12);
  A.mtof = mtof;

  // ---------- generic voices ----------
  // envelope helper on a gain node
  function env(g, t, a, peak, d, sustain, rel, dur) {
    const p = g.gain;
    p.setValueAtTime(0.0001, t);
    p.linearRampToValueAtTime(peak, t + a);
    p.exponentialRampToValueAtTime(Math.max(0.0001, peak * sustain), t + a + d);
    const end = Math.max(t + a + d, t + dur);
    p.setValueAtTime(Math.max(0.0001, peak * sustain), end);
    p.exponentialRampToValueAtTime(0.0001, end + rel);
    return end + rel;
  }

  // simple oscillator tone, used for SFX
  A.tone = function (o) {
    if (!A.ctx) return;
    const ctx = A.ctx, t = o.when || ctx.currentTime;
    const osc = ctx.createOscillator();
    osc.type = o.type || 'square';
    osc.frequency.setValueAtTime(o.f, t);
    if (o.f2) osc.frequency.exponentialRampToValueAtTime(o.f2, t + (o.slide || o.dur));
    const g = ctx.createGain();
    const end = env(g, t, o.a || 0.005, o.vol || 0.3, o.d || o.dur * 0.3, o.s == null ? 0.6 : o.s, o.r || 0.05, o.dur);
    let node = osc;
    if (o.lp) {
      const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = o.lp;
      osc.connect(f); node = f;
    }
    node.connect(g); g.connect(o.bus || A.sfxBus);
    osc.start(t); osc.stop(end + 0.02);
  };

  A.noise = function (o) {
    if (!A.ctx) return;
    const ctx = A.ctx, t = o.when || ctx.currentTime;
    const src = ctx.createBufferSource(); src.buffer = A.noiseBuf; src.loop = true;
    const f = ctx.createBiquadFilter(); f.type = o.ft || 'lowpass';
    f.frequency.setValueAtTime(o.f || 1200, t);
    if (o.f2) f.frequency.exponentialRampToValueAtTime(o.f2, t + o.dur);
    f.Q.value = o.q || 0.8;
    const g = ctx.createGain();
    const end = env(g, t, o.a || 0.002, o.vol || 0.3, o.d || o.dur * 0.5, o.s == null ? 0.3 : o.s, o.r || 0.04, o.dur);
    src.connect(f); f.connect(g); g.connect(o.bus || A.sfxBus);
    src.start(t, Math.random() * 0.5); src.stop(end + 0.02);
  };

  // ---------- music instruments ----------
  // Each returns nothing; schedules a note at time t on the given bus.
  const I = {};
  I.brass = function (bus, m, t, dur, vel) {
    const ctx = A.ctx, f = mtof(m);
    const g = ctx.createGain();
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.Q.value = 2;
    lp.frequency.setValueAtTime(500, t);
    lp.frequency.linearRampToValueAtTime(2600 + vel * 1200, t + 0.05);
    lp.frequency.exponentialRampToValueAtTime(1300, t + 0.25);
    const end = env(g, t, 0.025, 0.16 * vel, 0.12, 0.7, 0.09, dur * 0.92);
    [-6, 6].forEach((det) => {
      const o = ctx.createOscillator(); o.type = 'sawtooth';
      o.frequency.value = f; o.detune.value = det;
      o.connect(lp); o.start(t); o.stop(end + 0.02);
    });
    lp.connect(g); g.connect(bus);
  };
  I.marimba = function (bus, m, t, dur, vel) {
    const ctx = A.ctx, f = mtof(m);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(0.32 * vel, t + 0.004);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.55);
    const o = ctx.createOscillator(); o.type = 'sine'; o.frequency.value = f;
    const o2 = ctx.createOscillator(); o2.type = 'sine'; o2.frequency.value = f * 4.0;
    const g2 = ctx.createGain();
    g2.gain.setValueAtTime(0.12 * vel, t); g2.gain.exponentialRampToValueAtTime(0.0001, t + 0.09);
    o.connect(g); o2.connect(g2); g2.connect(g); g.connect(bus);
    o.start(t); o2.start(t); o.stop(t + 0.6); o2.stop(t + 0.12);
  };
  I.pizz = function (bus, m, t, dur, vel) {
    const ctx = A.ctx, f = mtof(m);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(0.2 * vel, t + 0.003);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.22);
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass';
    lp.frequency.setValueAtTime(3200, t); lp.frequency.exponentialRampToValueAtTime(500, t + 0.2);
    const o = ctx.createOscillator(); o.type = 'sawtooth'; o.frequency.value = f;
    o.connect(lp); lp.connect(g); g.connect(bus);
    o.start(t); o.stop(t + 0.25);
  };
  I.bass = function (bus, m, t, dur, vel) {
    const ctx = A.ctx, f = mtof(m);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(0.42 * vel, t + 0.006);
    g.gain.exponentialRampToValueAtTime(0.12 * vel, t + 0.12);
    g.gain.exponentialRampToValueAtTime(0.0001, t + Math.max(0.2, dur * 0.95));
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 900;
    const o = ctx.createOscillator(); o.type = 'triangle'; o.frequency.value = f;
    const o2 = ctx.createOscillator(); o2.type = 'sine'; o2.frequency.value = f * 2;
    const g2 = ctx.createGain(); g2.gain.value = 0.25;
    o.connect(lp); o2.connect(g2); g2.connect(lp); lp.connect(g); g.connect(bus);
    o.start(t); o2.start(t); o.stop(t + dur + 0.05); o2.stop(t + dur + 0.05);
  };
  I.flute = function (bus, m, t, dur, vel) {
    const ctx = A.ctx, f = mtof(m);
    const g = ctx.createGain();
    const end = env(g, t, 0.04, 0.16 * vel, 0.1, 0.8, 0.08, dur * 0.95);
    const o = ctx.createOscillator(); o.type = 'sine'; o.frequency.value = f;
    const o2 = ctx.createOscillator(); o2.type = 'triangle'; o2.frequency.value = f * 2;
    const g2 = ctx.createGain(); g2.gain.value = 0.12;
    const lfo = ctx.createOscillator(); lfo.frequency.value = 5.4;
    const lg = ctx.createGain(); lg.gain.value = f * 0.006;
    lfo.connect(lg); lg.connect(o.frequency);
    o.connect(g); o2.connect(g2); g2.connect(g); g.connect(bus);
    [o, o2, lfo].forEach((x) => { x.start(t); x.stop(end + 0.02); });
  };
  I.lead = function (bus, m, t, dur, vel) {
    const ctx = A.ctx, f = mtof(m);
    const g = ctx.createGain();
    const end = env(g, t, 0.01, 0.09 * vel, 0.08, 0.6, 0.06, dur * 0.85);
    const o = ctx.createOscillator(); o.type = 'square'; o.frequency.value = f;
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 2400;
    const lfo = ctx.createOscillator(); lfo.frequency.value = 6;
    const lg = ctx.createGain(); lg.gain.value = f * 0.005;
    lfo.connect(lg); lg.connect(o.frequency);
    o.connect(lp); lp.connect(g); g.connect(bus);
    [o, lfo].forEach((x) => { x.start(t); x.stop(end + 0.02); });
  };
  I.kick = function (bus, m, t, dur, vel) {
    const ctx = A.ctx;
    const o = ctx.createOscillator(); o.type = 'sine';
    o.frequency.setValueAtTime(140, t); o.frequency.exponentialRampToValueAtTime(42, t + 0.12);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.55 * vel, t); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.2);
    o.connect(g); g.connect(bus); o.start(t); o.stop(t + 0.22);
  };
  I.snare = function (bus, m, t, dur, vel) {
    A.noise({ when: t, ft: 'bandpass', f: 1900, q: 0.7, vol: 0.28 * vel, dur: 0.07, d: 0.05, s: 0.2, r: 0.06, bus });
    A.tone({ when: t, type: 'triangle', f: 190, f2: 140, dur: 0.06, vol: 0.18 * vel, bus });
  };
  I.hat = function (bus, m, t, dur, vel) {
    A.noise({ when: t, ft: 'highpass', f: 7500, vol: 0.09 * vel, dur: 0.025, d: 0.02, s: 0.1, r: 0.02, bus });
  };
  I.block = function (bus, m, t, dur, vel) {
    A.tone({ when: t, type: 'sine', f: mtof(m || 84), dur: 0.03, vol: 0.14 * vel, d: 0.02, s: 0.1, r: 0.04, bus });
  };
  I.timp = function (bus, m, t, dur, vel) {
    const ctx = A.ctx, f = mtof(m);
    const o = ctx.createOscillator(); o.type = 'sine';
    o.frequency.setValueAtTime(f * 1.05, t); o.frequency.exponentialRampToValueAtTime(f, t + 0.05);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.4 * vel, t); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.6);
    o.connect(g); g.connect(bus); o.start(t); o.stop(t + 0.62);
    A.noise({ when: t, f: 400, vol: 0.12 * vel, dur: 0.05, bus });
  };
  A.inst = I;

  // ---------- sound effects ----------
  const S = {};
  S.jump = () => A.tone({ type: 'square', f: 300, f2: 620, dur: 0.12, vol: 0.14, lp: 3000 });
  S.jump2 = () => A.tone({ type: 'square', f: 380, f2: 820, dur: 0.14, vol: 0.14, lp: 3200 });
  S.jump3 = () => {
    A.tone({ type: 'square', f: 420, f2: 1250, dur: 0.3, vol: 0.13, lp: 3500 });
    A.tone({ type: 'triangle', f: 840, f2: 2000, dur: 0.3, vol: 0.08, when: A.now() + 0.05 });
  };
  S.backflip = () => A.tone({ type: 'square', f: 260, f2: 1100, dur: 0.32, vol: 0.13, lp: 3000 });
  S.longjump = () => A.tone({ type: 'sawtooth', f: 220, f2: 560, dur: 0.28, vol: 0.1, lp: 1800 });
  S.land = (h) => A.noise({ f: 500 + h * 40, vol: 0.18 + Math.min(0.2, h * 0.02), dur: 0.06, d: 0.04 });
  // footsteps that match the ground under the player
  S.step = (kind) => {
    const r = 0.9 + Math.random() * 0.2;
    switch (kind) {
      case 'stone': A.noise({ ft: 'bandpass', f: 2600 * r, q: 1.6, vol: 0.06, dur: 0.018, d: 0.012 }); A.tone({ type: 'triangle', f: 240 * r, dur: 0.03, vol: 0.03 }); break;
      case 'wood': A.tone({ type: 'triangle', f: 170 * r, f2: 120, dur: 0.06, vol: 0.07, lp: 900 }); A.noise({ ft: 'bandpass', f: 900 * r, q: 2, vol: 0.04, dur: 0.03 }); break;
      case 'water': A.noise({ ft: 'bandpass', f: 1500 * r, f2: 600, q: 0.9, vol: 0.08, dur: 0.12, d: 0.08 }); break;
      case 'sand': A.noise({ ft: 'highpass', f: 2800 * r, vol: 0.035, dur: 0.05, d: 0.04 }); break;
      case 'dirt': A.noise({ f: 700 * r, vol: 0.06, dur: 0.03, d: 0.02 }); break;
      default: A.noise({ ft: 'bandpass', f: 1300 * r, q: 0.7, vol: 0.045, dur: 0.04, d: 0.03 }); A.noise({ f: 420, vol: 0.03, dur: 0.02 });
    }
  };
  S.coin = () => {
    const t = A.now();
    A.tone({ type: 'square', f: 988, dur: 0.06, vol: 0.1, when: t, lp: 5000 });
    A.tone({ type: 'square', f: 1480, dur: 0.22, vol: 0.1, when: t + 0.06, lp: 5000, s: 0.5 });
  };
  S.shard = () => {
    const t = A.now();
    [72, 76, 79, 84, 88].forEach((m, i) => A.tone({ type: 'triangle', f: mtof(m), dur: 0.12, vol: 0.14, when: t + i * 0.05 }));
  };
  S.gem = () => {
    const t = A.now();
    [67, 72, 76, 79, 84, 88, 91].forEach((m, i) => A.tone({ type: 'square', f: mtof(m), dur: 0.14, vol: 0.09, lp: 4000, when: t + i * 0.06 }));
  };
  S.hurt = () => {
    A.tone({ type: 'sawtooth', f: 520, f2: 140, dur: 0.35, vol: 0.16, lp: 2200 });
    A.noise({ f: 1400, vol: 0.14, dur: 0.1 });
  };
  S.stomp = () => {
    A.tone({ type: 'square', f: 180, f2: 600, dur: 0.1, vol: 0.14, lp: 2500 });
    A.noise({ f: 800, vol: 0.18, dur: 0.06 });
  };
  S.defeat = () => {
    const t = A.now();
    A.noise({ f: 3000, f2: 300, vol: 0.2, dur: 0.18 });
    A.tone({ type: 'square', f: 700, f2: 1400, dur: 0.12, vol: 0.09, when: t + 0.08, lp: 4000 });
  };
  S.punch = () => A.noise({ ft: 'bandpass', f: 1200, q: 1.2, vol: 0.2, dur: 0.05, d: 0.03 });
  S.hit = () => { A.noise({ f: 2200, vol: 0.25, dur: 0.07 }); A.tone({ type: 'square', f: 220, f2: 110, dur: 0.08, vol: 0.1 }); };
  S.switchOn = () => {
    const t = A.now();
    A.noise({ f: 2500, vol: 0.2, dur: 0.03 });
    [79, 84, 91].forEach((m, i) => A.tone({ type: 'triangle', f: mtof(m), dur: 0.16, vol: 0.14, when: t + 0.05 + i * 0.08 }));
  };
  S.tick = (hi) => A.tone({ type: 'square', f: hi ? 1500 : 1100, dur: 0.025, vol: 0.06, lp: 5000 });
  S.fall = () => A.tone({ type: 'triangle', f: 1200, f2: 200, dur: 1.0, vol: 0.12, slide: 1.0 });
  S.splash = () => { A.noise({ f: 2400, f2: 400, vol: 0.28, dur: 0.45, d: 0.3 }); };
  S.cannon = () => { A.noise({ f: 900, f2: 120, vol: 0.4, dur: 0.5 }); A.tone({ type: 'sine', f: 90, f2: 35, dur: 0.4, vol: 0.4 }); };
  S.cannonIn = () => A.tone({ type: 'sine', f: 300, f2: 120, dur: 0.2, vol: 0.2 });
  S.breakBox = () => { A.noise({ f: 1800, f2: 300, vol: 0.3, dur: 0.22 }); A.tone({ type: 'square', f: 160, f2: 80, dur: 0.1, vol: 0.1 }); };
  S.checkpoint = () => {
    const t = A.now();
    [72, 79, 84].forEach((m, i) => A.tone({ type: 'square', f: mtof(m), dur: 0.1, vol: 0.08, lp: 3500, when: t + i * 0.07 }));
  };
  S.groundpound = () => { A.noise({ f: 700, vol: 0.35, dur: 0.12 }); A.tone({ type: 'sine', f: 110, f2: 45, dur: 0.18, vol: 0.35 }); };
  S.gpSpin = () => A.tone({ type: 'triangle', f: 600, f2: 1400, dur: 0.18, vol: 0.08 });
  S.bonk = () => { A.tone({ type: 'square', f: 150, f2: 90, dur: 0.12, vol: 0.14 }); A.noise({ f: 900, vol: 0.2, dur: 0.05 }); };
  S.clang = () => { A.tone({ type: 'square', f: 880, dur: 0.18, vol: 0.08, lp: 3000 }); A.tone({ type: 'square', f: 1245, dur: 0.18, vol: 0.06, lp: 3000 }); };
  S.throw = () => A.noise({ ft: 'bandpass', f: 600, f2: 1800, vol: 0.18, dur: 0.18 });
  S.shoot = () => { A.tone({ type: 'square', f: 900, f2: 300, dur: 0.1, vol: 0.08, lp: 3000 }); };
  S.alert = () => { const t = A.now(); A.tone({ type: 'square', f: 1300, dur: 0.05, vol: 0.06, when: t }); A.tone({ type: 'square', f: 1700, dur: 0.07, vol: 0.06, when: t + 0.06 }); };
  S.charge = () => A.noise({ f: 300, f2: 900, vol: 0.18, dur: 0.3 });
  S.rumble = () => { A.noise({ f: 180, vol: 0.3, dur: 0.35, d: 0.3 }); };
  S.bossRoar = () => {
    A.tone({ type: 'sawtooth', f: 110, f2: 70, dur: 0.9, vol: 0.2, lp: 700 });
    A.tone({ type: 'sawtooth', f: 116, f2: 72, dur: 0.9, vol: 0.2, lp: 700 });
    A.noise({ f: 500, vol: 0.2, dur: 0.8, d: 0.6 });
  };
  S.shockwave = () => { A.tone({ type: 'sine', f: 70, f2: 30, dur: 0.6, vol: 0.5 }); A.noise({ f: 600, f2: 100, vol: 0.4, dur: 0.6 }); };
  S.bossHurt = () => {
    const t = A.now();
    A.tone({ type: 'square', f: 600, f2: 200, dur: 0.4, vol: 0.15, lp: 2500 });
    A.noise({ f: 3000, f2: 400, vol: 0.3, dur: 0.3, when: t });
  };
  S.explode = () => { A.noise({ f: 1500, f2: 80, vol: 0.4, dur: 0.6, d: 0.4 }); A.tone({ type: 'sine', f: 80, f2: 30, dur: 0.5, vol: 0.4 }); };
  S.spring = () => A.tone({ type: 'sine', f: 200, f2: 900, dur: 0.3, vol: 0.2 });
  S.dive = () => A.noise({ ft: 'bandpass', f: 500, f2: 1400, vol: 0.14, dur: 0.15 });
  S.wallkick = () => { A.noise({ f: 1200, vol: 0.15, dur: 0.04 }); S.jump2(); };
  S.gate = () => { A.noise({ f: 250, vol: 0.3, dur: 1.2, d: 1.0, s: 0.6 }); };
  S.death = () => {
    const t = A.now();
    [76, 72, 67, 64, 60].forEach((m, i) => A.tone({ type: 'square', f: mtof(m), dur: 0.16, vol: 0.09, lp: 2500, when: t + i * 0.13 }));
  };
  S.oneup = () => {
    const t = A.now();
    [76, 79, 88, 84, 86, 91].forEach((m, i) => A.tone({ type: 'square', f: mtof(m), dur: 0.1, vol: 0.08, lp: 4000, when: t + i * 0.08 }));
  };
  S.pause = () => { const t = A.now(); A.tone({ type: 'square', f: 1046, dur: 0.06, vol: 0.07, when: t }); A.tone({ type: 'square', f: 1568, dur: 0.1, vol: 0.07, when: t + 0.07 }); };
  S.menu = () => A.tone({ type: 'square', f: 880, dur: 0.05, vol: 0.06 });
  // water
  S.swim = () => {
    A.noise({ ft: 'bandpass', f: 1100, f2: 480, q: 0.9, vol: 0.13, dur: 0.22, d: 0.15 });
    A.noise({ ft: 'bandpass', f: 2400, f2: 900, q: 1.2, vol: 0.05, dur: 0.12, when: A.now() + 0.08 });
  };
  S.swimUnder = () => A.noise({ ft: 'lowpass', f: 520, f2: 240, vol: 0.16, dur: 0.32, d: 0.2 });
  S.diveIn = () => {
    A.noise({ ft: 'bandpass', f: 1800, f2: 300, q: 0.7, vol: 0.26, dur: 0.4, d: 0.25 });
    A.tone({ type: 'sine', f: 620, f2: 180, dur: 0.3, vol: 0.08 });
  };
  S.surface = () => {
    A.noise({ f: 1900, f2: 700, vol: 0.12, dur: 0.18 });
    A.tone({ type: 'sine', f: 320, f2: 760, dur: 0.14, vol: 0.07 });
  };
  S.bubble = () => A.tone({ type: 'sine', f: 700 + Math.random() * 500, f2: 1500 + Math.random() * 600, dur: 0.05, vol: 0.035, d: 0.03, s: 0.2 });
  S.airLow = () => A.tone({ type: 'square', f: 1320, dur: 0.06, vol: 0.06, lp: 3000 });
  S.grab = () => { A.tone({ type: 'triangle', f: 330, f2: 520, dur: 0.09, vol: 0.11 }); A.noise({ ft: 'bandpass', f: 1400, vol: 0.06, dur: 0.05 }); };
  S.climb = () => A.noise({ ft: 'bandpass', f: 900 + Math.random() * 500, q: 2.5, vol: 0.07, dur: 0.06, d: 0.04 });
  S.perch = () => { const t = A.now(); [79, 84, 88].forEach((m, i) => A.tone({ type: 'triangle', f: mtof(m), dur: 0.1, vol: 0.09, when: t + i * 0.06 })); };
  S.airJump = () => { A.tone({ type: 'square', f: 520, f2: 1180, dur: 0.16, vol: 0.12, lp: 3600 }); A.noise({ ft: 'bandpass', f: 1800, f2: 3200, q: 1, vol: 0.07, dur: 0.14 }); };
  S.potBreak = () => { A.noise({ ft: 'bandpass', f: 2400, f2: 700, q: 1.4, vol: 0.26, dur: 0.22 }); A.tone({ type: 'triangle', f: 900, f2: 300, dur: 0.12, vol: 0.08 }); };
  S.door = () => {
    A.noise({ ft: 'bandpass', f: 320, f2: 170, q: 3, vol: 0.16, dur: 0.7, d: 0.5 });
    A.tone({ type: 'sawtooth', f: 92, f2: 66, dur: 0.6, vol: 0.05, lp: 500 });
  };
  S.warp = () => {
    const t = A.now();
    A.noise({ ft: 'bandpass', f: 400, f2: 2600, q: 1.2, vol: 0.2, dur: 0.7 });
    [72, 76, 79, 84, 88, 91, 96].forEach((m, i) => A.tone({ type: 'sine', f: mtof(m), dur: 0.22, vol: 0.07, when: t + i * 0.05 }));
  };
  S.locked = () => {
    A.tone({ type: 'square', f: 220, dur: 0.12, vol: 0.08, lp: 1500 });
    A.tone({ type: 'square', f: 170, dur: 0.2, vol: 0.08, lp: 1500, when: A.now() + 0.12 });
  };
  S.chest = () => {
    const t = A.now();
    A.noise({ f: 700, f2: 300, vol: 0.2, dur: 0.25 });
    [60, 64, 67, 72, 76].forEach((m, i) => A.tone({ type: 'triangle', f: mtof(m), dur: 0.14, vol: 0.12, when: t + 0.12 + i * 0.07 }));
  };

  A.sfx = {};
  Object.keys(S).forEach((k) => {
    A.sfx[k] = function () {
      if (!A.ctx || A.muted) return;
      try { S[k].apply(null, arguments); } catch (e) { /* ignore audio errors */ }
    };
  });

  G.audio = A;
})(window.G);

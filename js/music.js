// music.js — original procedural soundtrack with a bar-synced dynamic sequencer.
// All melodies below are original compositions written for this level.
(function (G) {
  'use strict';
  const A = G.audio;
  const BPM = 132;
  const STEP = 60 / BPM / 4;     // one 16th note
  const BAR = STEP * 16;

  // ---------- notation helpers ----------
  const PC = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
  function nm(s) { // "C#5" -> midi
    const m = /^([A-G])(#|b)?(-?\d)$/.exec(s);
    let v = PC[m[1]] + (m[2] === '#' ? 1 : m[2] === 'b' ? -1 : 0);
    return v + (parseInt(m[3], 10) + 1) * 12;
  }
  // "E5:2 G5:2 R:4" -> [[midi|null, startStep, lenSteps], ...]
  function mel(str) {
    const out = []; let s = 0;
    str.trim().split(/\s+/).forEach((tok) => {
      const [n, l] = tok.split(':'); const len = parseInt(l, 10);
      if (n !== 'R') out.push([nm(n), s, len]);
      s += len;
    });
    return out;
  }
  const bars = (arr) => arr.map(mel);
  const CH = {
    C: [48, 52, 55], Am: [45, 48, 52], F: [41, 45, 48], G: [43, 47, 50], Dm: [38, 41, 45],
    Em: [40, 43, 47], G7: [43, 47, 53], CE: [40, 43, 48], D7: [38, 42, 48],
    E: [40, 44, 47], Bb: [46, 50, 53], A: [45, 49, 52], Gm: [43, 46, 50],
  };
  // diatonic third below in C major (used for the climbing counter-melody)
  const SCALE = [0, 2, 4, 5, 7, 9, 11];
  function thirdBelow(m) {
    const pc = ((m % 12) + 12) % 12, oct = Math.floor(m / 12);
    const i = SCALE.indexOf(pc);
    if (i < 0) return m - 3;
    const j = i - 2;
    return (j < 0 ? oct - 1 : oct) * 12 + SCALE[(j + 7) % 7];
  }

  // ---------- song data ----------
  const FIELD = {
    A: {
      chords: ['C', 'Am', 'F', 'G', 'C', 'Am', ['Dm', 'G'], 'C'],
      mel: bars([
        'E5:2 G5:2 C6:4 B5:2 G5:2 E5:4', 'A5:3 G5:1 E5:2 C5:2 D5:4 E5:4',
        'F5:2 A5:2 C6:2 A5:2 G5:2 F5:2 E5:2 D5:2', 'D5:3 E5:1 G5:6 R:2 B4:2 C5:2',
        'E5:2 G5:2 C6:4 D6:2 C6:2 G5:4', 'A5:2 C6:2 E6:4 D6:2 C6:2 A5:4',
        'F5:2 A5:2 D6:4 B5:2 G5:2 D5:2 F5:2', 'E5:4 C5:4 R:4 G4:2 G4:2',
      ]),
      lead: 'brass',
    },
    B: {
      chords: ['F', 'G', 'Em', 'Am', 'Dm', 'G', 'C', 'G7'],
      mel: bars([
        'A5:4 G5:2 F5:2 C5:4 F5:4', 'G5:4 F5:2 E5:2 D5:4 B4:4',
        'E5:2 G5:2 B5:4 A5:2 G5:2 E5:4', 'A5:6 G5:2 E5:4 C5:4',
        'D5:2 F5:2 A5:2 D6:2 C6:2 A5:2 F5:4', 'G5:2 B5:2 D6:4 C6:2 B5:2 A5:2 G5:2',
        'E6:4 D6:2 C6:2 G5:4 E5:4', 'F5:2 E5:2 D5:2 B4:2 G4:8',
      ]),
      lead: 'flute',
    },
    C: {
      chords: ['F', 'CE', 'Dm', 'G', 'F', 'C', 'D7', 'G'],
      mel: bars([
        'C6:6 A5:2 F5:8', 'G5:6 E5:2 C5:8', 'D5:4 F5:4 A5:4 G5:4', 'G5:12 R:4',
        'A5:6 C6:2 F6:4 E6:4', 'E6:6 D6:2 C6:8', 'D6:4 C6:4 A5:4 F#5:4', 'G5:8 R:4 B4:2 D5:2',
      ]),
      lead: 'flute', soft: true,
    },
  };
  const FIELD_ORDER = ['A', 'B', 'A', 'C'];

  const DANGER = {
    chords: ['Am', 'Am', 'F', 'E', 'Am', 'Am', 'Dm', 'E', 'F', 'G', 'Em', 'Am', 'Dm', 'E', 'Am', 'E'],
    mel: bars([
      'A4:2 C5:2 E5:4 D#5:2 E5:2 R:4', 'A5:4 G5:2 E5:2 F5:4 E5:4',
      'C5:2 F5:2 A5:4 G#5:2 A5:2 C6:4', 'B5:4 G#5:4 E5:4 D5:4',
      'A4:2 C5:2 E5:4 D#5:2 E5:2 A5:4', 'C6:4 B5:2 A5:2 G#5:4 A5:4',
      'F5:2 A5:2 D6:4 C6:2 A5:2 F5:4', 'E5:8 G#5:4 B5:4',
      'A5:6 G5:2 F5:4 E5:4', 'D5:6 E5:2 F5:4 G5:4',
      'E5:4 G5:4 B5:4 A5:4', 'A5:12 R:4',
      'D6:2 C6:2 A5:4 F5:4 D5:4', 'E5:2 F5:2 G#5:4 B5:4 D6:4',
      'C6:4 B5:2 A5:2 E5:8', 'G#5:2 A5:2 B5:4 E5:8',
    ]),
  };

  const BOSS = {
    chords: ['Dm', 'Dm', 'Bb', 'A', 'Dm', 'Dm', 'Gm', 'A', 'Bb', 'C', 'Am', 'Dm', 'Gm', 'A', 'Dm', 'A'],
    mel: bars([
      'D5:3 D5:1 F5:2 A5:2 D6:4 C6:2 A5:2', 'A#5:4 A5:2 G5:2 F5:4 E5:4',
      'F5:3 F5:1 A#5:2 D6:2 F6:4 D6:2 A#5:2', 'E6:4 C#6:4 A5:4 E5:4',
      'D5:3 D5:1 F5:2 A5:2 D6:4 E6:2 F6:2', 'E6:4 D6:2 C6:2 A#5:4 A5:4',
      'G5:2 A#5:2 D6:4 C6:2 A#5:2 G5:4', 'A5:8 C#6:4 E6:4',
      'F6:6 D6:2 A#5:8', 'G5:6 E5:2 C6:8', 'A5:4 C6:4 E6:4 C6:4', 'D6:12 R:4',
      'G5:2 G5:2 A#5:4 D6:4 G6:4', 'F6:2 E6:2 C#6:4 A5:4 E5:4',
      'F5:2 A5:2 D6:4 A5:2 F5:2 D5:4', 'E5:4 A5:4 C#6:4 E6:4',
    ]),
  };

  // Coral Lagoon: a floating, half-time tune (flute over rippling marimba arpeggios)
  const WATER = {
    chords: ['F', 'Am', 'Bb', 'C', 'Dm', 'Am', 'Bb', 'C', 'Gm', 'C', 'F', 'Dm', 'Gm', 'C', 'F', 'C'],
    mel: bars([
      'A5:6 C6:2 F6:8', 'E6:6 C6:2 A5:8', 'D6:4 F6:4 D6:4 A#5:4', 'C6:12 R:4',
      'A5:4 D6:4 F6:4 E6:4', 'E6:6 C6:2 A5:8', 'A#5:4 D6:4 G6:4 F6:4', 'E6:8 G5:4 C6:4',
      'D6:6 A#5:2 G5:8', 'G5:4 C6:4 E6:4 G6:4', 'F6:6 E6:2 C6:8', 'D6:4 C6:4 A5:4 F5:4',
      'G5:4 A#5:4 D6:4 C6:4', 'A#5:6 A5:2 G5:8', 'A5:6 C6:2 F6:8', 'E6:12 R:4',
    ]),
  };

  // Grand Foyer: a stately, unhurried waltz-like tune
  const HALL = {
    chords: ['C', 'G', 'Am', 'Em', 'F', 'C', 'Dm', 'G', 'C', 'G', 'Am', 'Em', 'F', 'G', 'C', 'C'],
    mel: bars([
      'E5:4 G5:4 C6:6 B5:2', 'D6:4 B5:4 G5:8', 'C6:4 E6:4 A5:6 G5:2', 'G5:12 R:4',
      'A5:4 C6:4 F6:6 E6:2', 'E6:4 C6:4 G5:8', 'F5:4 A5:4 D6:4 C6:4', 'B5:12 R:4',
      'E5:4 G5:4 C6:6 D6:2', 'E6:4 D6:4 B5:8', 'C6:4 E6:4 A6:6 G6:2', 'G6:8 E6:8',
      'F6:4 E6:4 D6:4 C6:4', 'D6:4 C6:4 B5:8', 'C6:16', 'R:16',
    ]),
  };

  const I = () => A.inst;
  const play = (inst, bus, m, t, lenSteps, vel) => I()[inst](bus, m, t, lenSteps * STEP, vel);

  // ---------- bar renderers ----------
  function chordAt(chords, bar, step) {
    const c = chords[bar];
    if (Array.isArray(c)) return CH[c[step < 8 ? 0 : 1]];
    return CH[c];
  }

  function renderField(song, barIdx, t, buses) {
    const sec = FIELD_ORDER[Math.floor(barIdx / 8) % FIELD_ORDER.length];
    const S = FIELD[sec], b = barIdx % 8;
    const core = buses.core, climb = buses.climb;
    const soft = !!S.soft;
    // bass: oom-pah with a passing third
    const c0 = chordAt(S.chords, b, 0), c1 = chordAt(S.chords, b, 8);
    play('bass', core, c0[0] - 12, t, 3, 1);
    play('bass', core, c1[2] - 12 - (c1[2] - c1[0] > 7 ? 12 : 0), t + 8 * STEP, 3, 0.85);
    play('bass', core, c1[0] - 12, t + 12 * STEP, 2, 0.6);
    // marimba offbeat chord stabs
    [4, 12].forEach((s) => {
      const ch = chordAt(S.chords, b, s);
      ch.forEach((m) => play('marimba', core, m + 12, t + s * STEP, 2, soft ? 0.45 : 0.6));
    });
    if (!soft) play('marimba', core, chordAt(S.chords, b, 10)[1] + 24, t + 10 * STEP, 1, 0.35);
    // light percussion
    for (let s = 0; s < 16; s += 2) play('hat', core, 0, t + s * STEP, 1, s % 4 === 0 ? 0.9 : 0.6);
    play('block', core, 84, t + 6 * STEP, 1, 0.8);
    play('block', core, 79, t + 14 * STEP, 1, 0.8);
    if (!soft) { play('kick', core, 0, t, 1, 0.8); play('kick', core, 0, t + 8 * STEP, 1, 0.6); }
    // melody
    S.mel[b].forEach(([m, s, l]) => {
      play(S.lead, core, m, t + s * STEP, l, 1);
      if (sec === 'A' && barIdx % 32 >= 16) play('marimba', core, m + 12, t + s * STEP, l, 0.35);
      if (sec === 'B') play('pizz', core, m - 12, t + s * STEP, l, 0.55);
    });
    // ---- climbing layer (faded in on the mountain) ----
    for (let s = 0; s < 16; s += 2) {
      const ch = chordAt(S.chords, b, s);
      const m = ch[(s / 2) % 3] + 12 + (s >= 8 ? 12 : 0);
      play('pizz', climb, m, t + s * STEP, 1, 0.75);
    }
    play('snare', climb, 0, t + 4 * STEP, 1, 0.8);
    play('snare', climb, 0, t + 12 * STEP, 1, 0.8);
    play('snare', climb, 0, t + 15 * STEP, 1, 0.3);
    play('kick', climb, 0, t + 10 * STEP, 1, 0.6);
    if (!soft) S.mel[b].forEach(([m, s, l]) => play('lead', climb, thirdBelow(m), t + s * STEP, l, 0.7));
    else chordAt(S.chords, b, 0).forEach((m) => play('lead', climb, m + 12, t, 14, 0.35));
    if (b % 2 === 1) chordAt(S.chords, b, 14).forEach((m) => play('brass', climb, m + 12, t + 14 * STEP, 2, 0.6));
  }

  function renderDanger(song, barIdx, t, buses) {
    const b = barIdx % 16, core = buses.core;
    const ch = CH[DANGER.chords[b]];
    for (let s = 0; s < 16; s += 2) play('bass', core, ch[0] - 12 + (s % 4 === 2 ? 12 : 0), t + s * STEP, 2, 0.8);
    [0, 6, 10].forEach((s) => ch.forEach((m) => play('brass', core, m, t + s * STEP, 2, 0.5)));
    for (let s = 0; s < 16; s++) play('hat', core, 0, t + s * STEP, 1, s % 4 === 0 ? 0.7 : 0.35);
    play('kick', core, 0, t, 1, 0.9); play('kick', core, 0, t + 8 * STEP, 1, 0.8); play('kick', core, 0, t + 11 * STEP, 1, 0.6);
    play('snare', core, 0, t + 4 * STEP, 1, 0.8); play('snare', core, 0, t + 12 * STEP, 1, 0.8);
    DANGER.mel[b].forEach(([m, s, l]) => {
      play('lead', core, m, t + s * STEP, l, 0.9);
      play('pizz', core, m - 12, t + s * STEP, l, 0.5);
    });
    if (b % 4 === 3) play('timp', core, ch[0] - 12, t + 12 * STEP, 2, 0.8);
  }

  function renderBoss(song, barIdx, t, buses) {
    const b = barIdx % 16, core = buses.core, rage = buses.climb;
    const ch = CH[BOSS.chords[b]];
    const pat = [0, 0, 12, 0, 7, 0, 12, 0, 0, 0, 12, 0, 7, 12, 7, 0];
    for (let s = 0; s < 16; s++) play('bass', core, ch[0] - 12 + pat[s], t + s * STEP, 1, s % 4 === 0 ? 0.9 : 0.6);
    play('timp', core, ch[0] - 12, t, 2, 1);
    play('timp', core, ch[0] - 12, t + 8 * STEP, 2, 0.8);
    for (let s = 0; s < 16; s += 2) play('hat', core, 0, t + s * STEP, 1, 0.7);
    play('kick', core, 0, t, 1, 1); play('kick', core, 0, t + 6 * STEP, 1, 0.7); play('kick', core, 0, t + 8 * STEP, 1, 1);
    play('snare', core, 0, t + 4 * STEP, 1, 0.9); play('snare', core, 0, t + 12 * STEP, 1, 0.9);
    if (b % 8 === 7) for (let s = 12; s < 16; s++) play('snare', core, 0, t + s * STEP, 1, 0.4 + (s - 12) * 0.15);
    BOSS.mel[b].forEach(([m, s, l]) => {
      play('brass', core, m, t + s * STEP, l, 1);
      play('brass', core, m - 12, t + s * STEP, l, 0.45);
    });
    // rage layer: driving pizz arpeggios and lead doubling as the boss gets angrier
    for (let s = 0; s < 16; s++) play('pizz', rage, ch[s % 3] + 24, t + s * STEP, 1, 0.55);
    BOSS.mel[b].forEach(([m, s, l]) => play('lead', rage, m + 12, t + s * STEP, l, 0.45));
    for (let s = 1; s < 16; s += 2) play('hat', rage, 0, t + s * STEP, 1, 0.5);
  }

  function renderWater(song, barIdx, t, buses) {
    const b = barIdx % 16, core = buses.core;
    const ch = CH[WATER.chords[b]];
    play('bass', core, ch[0] - 12, t, 8, 0.55);
    play('bass', core, ch[2] - 24 + (ch[2] - ch[0] > 7 ? 0 : 12), t + 8 * STEP, 8, 0.45);
    for (let s = 0; s < 16; s += 2) {
      const m = ch[(s / 2) % 3] + (s < 8 ? 12 : 24);
      play('marimba', core, m, t + s * STEP, 2, 0.3 + (s % 4 === 0 ? 0.08 : 0));
    }
    [2, 6, 10, 14].forEach((s) => play('hat', core, 0, t + s * STEP, 1, 0.22));
    if (b % 4 === 3) [0, 1, 2, 3].forEach((i) => play('marimba', core, ch[i % 3] + 36 + (i > 2 ? 12 : 0), t + (12 + i) * STEP, 1, 0.22));
    WATER.mel[b].forEach(([m, s, l]) => {
      play('flute', core, m, t + s * STEP, l, 0.95);
      if (barIdx % 32 >= 16) play('marimba', core, m + 12, t + s * STEP, Math.min(l, 2), 0.2);
    });
  }

  function renderHall(song, barIdx, t, buses) {
    const b = barIdx % 16, core = buses.core;
    const ch = CH[HALL.chords[b]];
    play('bass', core, ch[0] - 12, t, 6, 0.6);
    play('bass', core, ch[2] - 12 - (ch[2] - ch[0] > 7 ? 12 : 0), t + 8 * STEP, 6, 0.5);
    ch.forEach((m) => play('brass', core, m + 12, t, 14, 0.18));
    [0, 4, 8, 12].forEach((s, i) => play('marimba', core, ch[i % 3] + 24, t + s * STEP, 2, 0.28));
    HALL.mel[b].forEach(([m, s, l]) => {
      play('flute', core, m, t + s * STEP, l, 0.9);
      if (barIdx % 32 >= 16) play('pizz', core, m - 12, t + s * STEP, Math.min(l, 2), 0.3);
    });
  }

  // ---------- sequencer ----------
  const M = {
    songs: {}, target: 'field', current: null, nextBar: 0, timer: null,
    climbLevel: 0, started: false, stopped: false,
  };

  function makeSong(name, render) {
    const ctx = A.ctx;
    const out = ctx.createGain(); out.gain.value = 0;
    out.connect(A.musicBus); out.connect(A.reverb);
    const core = ctx.createGain(); core.connect(out);
    const climb = ctx.createGain(); climb.gain.value = 0; climb.connect(out);
    return { name, render, out, buses: { core, climb }, bar: 0, playing: false, fadeEnd: 0 };
  }

  M.start = function () {
    if (!A.ctx || M.started) return;
    M.started = true;
    M.songs.field = makeSong('field', renderField);
    M.songs.danger = makeSong('danger', renderDanger);
    M.songs.boss = makeSong('boss', renderBoss);
    M.songs.water = makeSong('water', renderWater);
    M.songs.hall = makeSong('hall', renderHall);
    M.nextBar = A.ctx.currentTime + 0.15;
    M.timer = setInterval(M.tick, 30);
  };

  // choose which song should play: 'field' | 'mountain' | 'danger' | 'boss' | 'none'
  M.setState = function (state) {
    if (state === 'mountain') { M.target = 'field'; M.climbTarget = 1; }
    else if (state === 'field') { M.target = 'field'; M.climbTarget = 0; }
    else M.target = state;
  };
  M.setRage = function (x) { M.rage = x; };

  M.tick = function () {
    if (!A.ctx || M.stopped) return;
    const now = A.ctx.currentTime;
    // layer crossfade for field <-> mountain (continuous, no restart)
    const f = M.songs.field;
    if (f) f.buses.climb.gain.setTargetAtTime(M.climbTarget ? 0.9 : 0, now, 1.2);
    const bs = M.songs.boss;
    if (bs) bs.buses.climb.gain.setTargetAtTime(M.rage || 0, now, 0.8);
    while (M.nextBar < now + 0.3) {
      const t = M.nextBar;
      if (M.target !== M.current) {
        const old = M.songs[M.current];
        if (old) { // fade the old tune out across ~1.5 bars while it keeps playing
          old.out.gain.cancelScheduledValues(t);
          old.out.gain.setValueAtTime(old.out.gain.value || 1, t);
          old.out.gain.linearRampToValueAtTime(0.0001, t + BAR * 1.5);
          old.fadeEnd = t + BAR * 1.5;
        }
        const nw = M.songs[M.target];
        if (nw) {
          if (!nw.playing || nw.fadeEnd) nw.bar = 0;
          nw.playing = true; nw.fadeEnd = 0;
          nw.out.gain.cancelScheduledValues(t);
          nw.out.gain.setValueAtTime(0.0001, t);
          nw.out.gain.linearRampToValueAtTime(1, t + BAR * 0.75);
        }
        M.current = M.target;
      }
      for (const k in M.songs) {
        const s = M.songs[k];
        if (!s.playing) continue;
        if (s.fadeEnd && t > s.fadeEnd) { s.playing = false; s.fadeEnd = 0; continue; }
        try { s.render(s, s.bar, t, s.buses); } catch (e) { /* keep going */ }
        s.bar++;
      }
      M.nextBar += BAR;
    }
  };

  // quick fade of all music (used for jingles)
  M.duck = function (seconds) {
    if (!A.ctx) return;
    const g = A.musicBus.gain, now = A.ctx.currentTime;
    g.cancelScheduledValues(now);
    g.setTargetAtTime(0.05, now, 0.08);
    g.setTargetAtTime(A.musicLevel(), now + seconds, 0.4);
  };

  function jingle(notes, bus) {
    const t0 = A.ctx.currentTime + 0.05;
    notes.forEach(([inst, m, s, l, v]) => A.inst[inst](bus, m, t0 + s * STEP, l * STEP, v || 1));
  }

  M.gemJingle = function () {
    if (!A.ctx || A.muted) return;
    M.duck(2.6);
    const n = [];
    ['C5', 'E5', 'G5', 'C6', 'E6'].forEach((x, i) => { n.push(['brass', nm(x), i * 2, 2, 0.9]); n.push(['marimba', nm(x) + 12, i * 2, 2, 0.6]); });
    ['C5', 'G5', 'C6', 'E6'].forEach((x) => n.push(['brass', nm(x), 10, 10, 0.8]));
    n.push(['bass', 36, 10, 10, 1]); n.push(['timp', 36, 10, 4, 1]);
    jingle(n, A.sfxBus);
  };

  M.victory = function () {
    if (!A.ctx) return;
    M.target = 'none';
    const n = [];
    const lead = mel('G4:2 C5:2 E5:2 G5:2 C6:6 R:2 A5:2 B5:2 C6:2 D6:2 E6:4 D6:2 E6:2 G6:12');
    lead.forEach(([m, s, l]) => { n.push(['brass', m, s, l, 1]); n.push(['marimba', m, s, Math.min(l, 2), 0.5]); });
    [[0, 'C'], [8, 'F'], [16, 'G'], [28, 'C']].forEach(([s, c]) => {
      CH[c].forEach((m) => n.push(['brass', m + 12, s, c === 'C' && s > 0 ? 12 : 8, 0.45]));
      n.push(['bass', CH[c][0] - 12, s, 8, 1]);
      n.push(['timp', CH[c][0] - 12, s, 2, 0.9]);
    });
    for (let s = 24; s < 28; s++) n.push(['snare', 0, s, 1, 0.3 + (s - 24) * 0.15]);
    n.push(['kick', 0, 28, 1, 1]);
    jingle(n, A.sfxBus);
  };

  M.stopAll = function () { M.target = 'none'; };

  G.music = M;
})(window.G);

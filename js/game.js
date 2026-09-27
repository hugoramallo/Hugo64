// game.js — boot, world (re)building, main loop with fixed sub-steps, game states,
// death/respawn, gem celebrations, boss flow, dynamic music and restart.
(function (G) {
  'use strict';
  const U = G.U;
  const GM = (G.game = {
    state: 'loading', time: 0, clock: 0, area: '', stats: null, checkpoint: null,
    stateT: 0,
  });

  function freshStats() { return { coins: 0, shards: 0, gems: [], deaths: 0, time: 0 }; }

  GM.init = async function () {
    const canvas = document.getElementById('c');
    G.hud.init();
    G.hud.el.loading.textContent = 'Starting renderer…';
    await G.gfx.init(canvas);
    GM.camera3 = new THREE.PerspectiveCamera(58, 1, 0.3, 6000);
    G.camera.init(GM.camera3);
    G.input.attach(canvas);
    window.addEventListener('resize', resize); resize();
    G.hud.el.loading.textContent = 'Building the world…';
    await new Promise((r) => setTimeout(r, 30));
    await GM.buildWorld((f) => { G.hud.el.loading.textContent = 'Building the world… ' + Math.round(f * 100) + '%'; });
    loadPace();
    // start from 'high' on WebGPU (the title-screen calibration then moves up or down); the WebGL 2 fallback
    // usually means an older browser or GPU, so it starts one step lower
    G.gfx.buildPipeline(G.gfx.backend === 'WebGPU' ? 'high' : 'medium');
    G.hud.el.loading.textContent = 'Preparing shaders…';
    // build every shader and pipeline now (scene, shadows, effects), so nothing compiles mid-game
    const cleanup = prewarmEffects();
    try { await G.gfx.warmup(); } catch (e) { console.warn('warm-up', e); }
    cleanup();
    wireUI();
    GM.setState('title');
    G.hud.el.loading.hidden = true;
    G.gfx.renderer.setAnimationLoop(frame);
  };

  // spawn one of every effect the game creates on the fly (particles, rings, splashes, bubbles, projectiles)
  // far below the world so their shaders are part of the warm-up; everything is cleared right after
  function prewarmEffects() {
    const x = 0, y = -60, z = 0;
    try {
      G.fx.burst(x, y, z, 2, 0xffffff, 1, 0.3, 30, 0);
      G.fx.sparkle(x, y, z, 0xffffff);
      G.fx.ring(x, y, z, 2, 30, 0xffffff);
      G.water.splash && G.water.splash(x, y, z, 1);
      G.water.ripple && G.water.ripple(x, y, z, 1);
      G.water.bubbles && G.water.bubbles(x, y, z, 2);
      G.enemies.fire && G.enemies.fire(x, y, z, 0, 0, 0, {});
      G.collect.drop && G.collect.drop(x, y, z, 1);
    } catch (e) { console.warn('prewarm', e); }
    return () => {
      for (let i = 0; i < 4; i++) {
        G.fx.update(40);
        G.water.update && G.water.update(40, GM.camera3.position);
        G.enemies.updateProjectiles && G.enemies.updateProjectiles(40);
      }
      G.enemies.projectiles.forEach((p) => p.m && p.m.parent && p.m.parent.remove(p.m));
      G.enemies.projectiles.length = 0;
      G.collect.loose.forEach((l) => l.m.parent && l.m.parent.remove(l.m));
      G.collect.loose.length = 0;
    };
  }

  function resize() {
    const w = window.innerWidth, h = window.innerHeight;
    G.gfx.resize(w, h);
    GM.camera3.aspect = w / h; GM.camera3.updateProjectionMatrix();
  }

  // Build (or rebuild) the whole level into a fresh scene.
  GM.buildWorld = async function (progress) {
    G.clearWorldEvents();
    G.physics.clear();
    G.objects.length = 0; G.carryables.length = 0; G.clearFlying();
    G.enemies.list.length = 0; G.enemies.projectiles.length = 0;
    G.collect.coins = []; G.collect.loose = []; G.collect.shards = []; G.collect.gems = [];
    G.fx.parts = []; G.fx.rings = [];
    G.decor.reset();
    G.castle.reset();
    G.level.spawners = []; G.level.shrineLights = null;

    const scene = (GM.scene = new THREE.Scene());
    G.gfx.setupScene(scene, GM.camera3);

    await G.terrain.build(scene, progress);
    const step = async (f) => { progress && progress(f); await new Promise((r) => setTimeout(r, 0)); };
    G.fx.init(scene);
    G.collect.init(scene);
    G.water.build(scene);
    await step(0.96);
    G.castle.build(scene);
    G.enemies.init(scene);
    G.level.build(scene);
    G.decor.vista(scene);
    G.boss.init(scene);
    G.player.init(scene);
    await step(0.98);
    if (!G.gfx.fieldFilled) G.gfx.makeFieldTexture();
    G.decor.buildMeadow(scene);
    G.gfx.makeTerrainShadowProxy(scene);
    G.gfx.applyShadows(scene);
    // bake characters into a few vertex-coloured meshes and merge static props (draw-call reduction)
    G.gfx.bake(G.player.model.root, 0.14);
    G.gfx.bake(G.boss.root, 0.25);
    G.enemies.list.forEach((e) => G.gfx.bake(e.root, 0.3));
    G.gfx.batchStatic(scene);
    await step(1);

    GM.stats = freshStats();
    const sp = G.level.spawn;
    GM.checkpoint = { x: sp.x, y: G.physics.ground(sp.x, sp.z, 999, 0, 0).h + 0.5, z: sp.z, face: sp.face };
    G.player.hp = G.PLAYER.MAX_HP; G.player.invuln = 0;
    G.player.spawn(sp.x, GM.checkpoint.y, sp.z, sp.face);
    G.camera.mode = 'follow';
    G.camera.snapBehind(sp.face);
    GM.time = 0; GM.area = '';
    wireWorldEvents();
  };

  function wireWorldEvents() {
    G.onWorld('gem', onGem);
    G.onWorld('shard', (n) => {
      if (n >= 8) { G.collect.revealGem('shards'); G.hud.toast('All 8 Sky Shards! A Sun Gem rises over the shrine.', 3.5); }
      else G.hud.toast('Sky Shard ' + n + ' of 8');
    });
    G.onWorld('coin', (n) => {
      if (n === 100) {
        const p = G.player.pos;
        G.collect.revealGem('coins', p.x, p.y + 3.5, p.z);
        G.hud.toast('100 Sparks! A Sun Gem appears!', 3);
      }
    });
    G.onWorld('playerDied', () => { GM.setState('dying'); G.stats && 0; GM.stats.deaths++; });
    G.onWorld('bossStart', () => { G.hud.bossBar(true, G.boss.hp, G.boss.maxHp); G.hud.toast('The Crag King awakens! Grab a boulder (E) and throw it at him!', 3.5); });
    G.onWorld('bossHit', (hp) => {
      G.hud.bossBar(true, hp, G.boss.maxHp);
      G.music.setRage(hp < G.boss.maxHp ? (hp <= 1 ? 1 : hp <= 3 ? 0.55 : 0.3) : 0);
      if (hp > 0) G.hud.toast(hp === 1 ? 'He is furious! One more rock!' : 'Direct hit! ' + hp + ' more to go...');
    });
    G.onWorld('bossDefeated', () => {
      G.hud.bossBar(false);
      const MT = G.terrain.mtn;
      G.collect.revealGem('boss', MT.x, MT.Hs + 2.5, MT.z);
      G.hud.toast('The Crag King crumbles! Grab his Crown!', 3.5);
    });
    G.onWorld('hurt', () => { G.hud.el.hud.classList.remove('hit'); void G.hud.el.hud.offsetWidth; G.hud.el.hud.classList.add('hit'); });
  }

  function onGem(g) {
    GM.stats.gems.push(g.id);
    const pl = G.player;
    if (g.id === 'boss') {
      GM.setState('victory');
      return;
    }
    GM.setState('gemget');
    G.music.gemJingle();
    G.audio.sfx.gem();
    G.hud.gemGet(g.name, true);
    GM.gemInWater = pl.isSwimming();
    if (!GM.gemInWater) pl.setState('win');
    pl.vel.set(0, 0, 0);
    pl.face = G.camera.yaw;
    pl.air = 1;
  }

  GM.setState = function (s) {
    const prev = GM.state;
    GM.state = s; GM.stateT = 0;
    const H = G.hud;
    if (s === 'title') { H.screen('title'); }
    else if (s === 'play') { H.screen(null); H.gemGet('', false); }
    else if (s === 'paused') { H.screen('pause'); G.input.releasePointer(); G.audio.sfx.pause(); if (GM.syncQualityUI) GM.syncQualityUI(); }
    else if (s === 'victory') {
      G.music.victory(); G.audio.sfx.gem();
      G.player.setState('win');
      G.hud.gemGet("Crag King's Crown", true);
      G.input.releasePointer();
    } else if (s === 'dying') {
      G.music.duck(3);
    }
    GM.prevState = prev;
  };

  GM.start = function () {
    G.audio.init();
    G.music.start();
    G.audio.setMuted(false);
    G.gfx.cameraCut();
    GM.setState('play');
    G.hud.area(G.level.AREAS.castle);
  };
  GM.restart = function () {
    if (GM.busy) return;
    G.hud.fade(true);
    setTimeout(async () => {
      GM.busy = true;
      try {
        await GM.buildWorld();
        G.gfx.buildPipeline(G.gfx.quality);
        const cleanup = prewarmEffects();
        await G.gfx.warmup();
        cleanup();
      } finally { GM.busy = false; }
      G.boss.reset();
      G.hud.bossBar(false);
      G.music.setRage(0);
      G.music.setState('field');
      G.hud.lastHp = -1; G.hud.lastCoins = -1;
      GM.setState('play');
      G.hud.fade(false);
    }, 350);
  };

  function respawn() {
    const cp = GM.checkpoint, pl = G.player;
    pl.hp = G.PLAYER.MAX_HP;
    pl.spawn(cp.x, cp.y, cp.z, cp.face);
    pl.invuln = 1.5;
    G.camera.mode = 'follow';
    G.camera.snapBehind(cp.face);
    if (G.boss.active() || G.boss.state === 'dormantReady') { G.boss.reset(); G.hud.bossBar(false); G.music.setRage(0); }
    G.hud.fade(false);
    GM.setState('play');
  }

  // pause automatically when the game loses focus or is hidden
  function autoPause() { if (GM.state === 'play') GM.setState('paused'); }
  document.addEventListener('visibilitychange', () => { if (document.hidden) autoPause(); });
  window.addEventListener('blur', () => { if (GM.state === 'play' && !document.pointerLockElement) autoPause(); });

  function wireUI() {
    const on = (id, fn) => { const el = document.getElementById(id); if (el) el.addEventListener('click', (e) => { e.preventDefault(); G.audio.init(); G.audio.sfx.menu(); fn(); }); };
    on('btn-start', () => GM.start());
    on('btn-resume', () => GM.setState('play'));
    on('btn-restart', () => GM.restart());
    on('btn-again', () => GM.restart());
    on('btn-mute', () => {
      G.audio.musicOn = !G.audio.musicOn;
      G.audio.applyVolumes();
      document.getElementById('btn-mute').textContent = G.audio.musicOn ? 'Music: On' : 'Music: Off';
    });
    on('btn-pause', () => { if (GM.state === 'play') GM.setState('paused'); });
    on('btn-castle', () => { GM.setState('play'); G.castle.warpTo(G.castle.foyerSpot()); });
    document.querySelectorAll('.seg-b').forEach((b) => b.addEventListener('click', () => {
      G.audio.sfx.menu();
      G.gfx.setQuality(b.dataset.q);
      syncQualityUI();
    }));
    document.querySelectorAll('.seg-f').forEach((b) => b.addEventListener('click', () => {
      G.audio.sfx.menu();
      GM.setPaceMode(b.dataset.f);
      syncQualityUI();
    }));
    G.on('qualityChanged', syncQualityUI);
    syncQualityUI();
    // player settings (kept in this browser only)
    const st = loadSettings();
    const bind = (id, key, isCheck) => {
      const el = document.getElementById(id);
      if (!el) return;
      if (isCheck) el.checked = !!st[key]; else el.value = st[key];
      el.addEventListener('input', () => { st[key] = isCheck ? el.checked : +el.value; applySettings(st); saveSettings(st); });
    };
    bind('set-music', 'music'); bind('set-sfx', 'sfx'); bind('set-sens', 'sens'); bind('set-invert', 'invert', true); bind('set-shake', 'shake', true);
    applySettings(st);
  }
  const SETTINGS_KEY = 'cragspire.settings';
  const DEFAULTS = { music: 80, sfx: 85, sens: 100, invert: false, shake: true };
  function loadSettings() {
    try { return Object.assign({}, DEFAULTS, JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}')); } catch (e) { return Object.assign({}, DEFAULTS); }
  }
  function saveSettings(st) { try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(st)); } catch (e) { /* storage unavailable */ } }
  function applySettings(st) {
    G.input.sens = st.sens / 100; G.input.invertY = !!st.invert; G.camera.shakeScale = st.shake ? 1 : 0;
    G.audio.musicVol = st.music / 100; G.audio.sfxVol = st.sfx / 100; G.audio.applyVolumes();
  }
  function syncQualityUI() {
    const cur = G.gfx.autoQuality ? 'auto' : G.gfx.quality;
    document.querySelectorAll('.seg-b').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.q === cur)));
    document.querySelectorAll('.seg-f').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.f === PACE.mode)));
    const info = document.getElementById('gfx-info');
    if (info) {
      const hz = Math.round(1000 / (PACE.refresh * PACE.divisor));
      info.textContent = G.gfx.backend + ' · ' + G.gfx.quality + ' · ' + Math.round(G.gfx.internalPR * 100) + '% res · ' + hz + ' fps';
    }
  }
  GM.syncQualityUI = syncQualityUI;

  // ---------------- main loop ----------------
  // Frame pacing: on high-refresh displays (120 Hz ProMotion, 144 Hz...) rendering is locked to evenly spaced
  // vsyncs (60 fps) unless the machine can hold the full rate with margin; dt is snapped to whole refresh
  // intervals, which removes timestamp jitter, so motion is perfectly regular. GPU time comes from timestamp
  // queries (or submitted-work latency) and drives the adaptive resolution.
  const STEP = 1 / 60;
  const PACE = (GM.pace = { mode: 'auto', refresh: 1000 / 60, deltas: [], lastRaf: 0, lastRender: 0, divisor: 1, lat: null, tail: null, fullOK: 0, fullBan: 0, lateWin: [], cpuAvg: 8 });
  function divisorFor() {
    const r = PACE.refresh, d60 = Math.max(1, Math.round(16.667 / r));
    if (PACE.mode === 'max') return 1;
    if (PACE.mode === '60') return d60;
    if (PACE.mode === '30') return Math.max(1, Math.round(33.333 / r));
    // auto: full rate on ~60 Hz screens; on faster screens only when there is plenty of headroom
    if (r > 11) return 1;
    return PACE.fullOK > 4 && performance.now() > PACE.fullBan ? 1 : d60;
  }
  function frame(now) {
    if (document.hidden || GM.busy) { PACE.lastRaf = 0; PACE.lastRender = 0; return; }
    if (PACE.lastRaf) {
      const d = now - PACE.lastRaf;
      if (d > 3 && d < 45) { PACE.deltas.push(d); if (PACE.deltas.length > 120) PACE.deltas.shift(); }
      if (PACE.deltas.length >= 24 && (PACE.deltas.length % 12) === 0) {
        const srt = PACE.deltas.slice().sort((a, b) => a - b);
        PACE.refresh = srt[srt.length >> 1];
      }
    }
    PACE.lastRaf = now;
    const div = (PACE.divisor = divisorFor());
    const budget = PACE.refresh * div;
    const since = now - PACE.lastRender;
    if (PACE.lastRender && since < budget - PACE.refresh * 0.5) return; // not this vsync
    let dt = PACE.lastRender ? since : budget;
    PACE.lastRender = now;
    const k = Math.max(1, Math.round(dt / PACE.refresh));
    if (Math.abs(dt - k * PACE.refresh) < PACE.refresh * 0.3) dt = k * PACE.refresh;
    const late = k > div;
    const t0 = performance.now();
    GM.tick(Math.min(dt / 1000, 0.05));
    const t1 = performance.now(), cpu = t1 - t0;
    measureGpu(t0, t1);
    PACE.cpuAvg += (cpu - PACE.cpuAvg) * 0.05;
    if (GM.state === 'play' || GM.state === 'title') {
      G.gfx.frameSample(cpu, PACE.lat, PACE.tail, late, budget, GM.state === 'title');
      trackFullRate(cpu, late);
    }
  }
  // WebGPU: how long until the frame's GPU work completes, from the start (latency) and from the end (tail)
  // of the tick. (GPU timestamp queries are not trustworthy on every GPU, e.g. Apple's tile-based ones.)
  let gpuBusy = false;
  function measureGpu(tStart, tEnd) {
    const dev = G.gfx.renderer.backend && G.gfx.renderer.backend.device;
    if (gpuBusy || !dev) return;
    gpuBusy = true;
    dev.queue.onSubmittedWorkDone().then(() => {
      const now = performance.now();
      PACE.lat = now - tStart; PACE.tail = now - tEnd; gpuBusy = false;
    }, () => { gpuBusy = false; });
  }
  // auto pacing: allow the full refresh rate only after ~3 s of comfortable headroom; fall back at once
  // (and for a while) as soon as frames start missing it
  function trackFullRate(cpu, late) {
    if (PACE.mode !== 'auto' || PACE.refresh > 11) return;
    const r = PACE.refresh, l = PACE.lat == null ? cpu * 1.6 : PACE.lat;
    if (PACE.divisor > 1) {
      PACE.fullOK = cpu < r * 0.6 && l < r * 0.72 ? PACE.fullOK + r / 1000 * PACE.divisor : 0;
    } else {
      PACE.lateWin.push(late ? 1 : 0);
      if (PACE.lateWin.length > 60) PACE.lateWin.shift();
      const lates = PACE.lateWin.reduce((a, b) => a + b, 0);
      if (lates > 4) {
        // back to the even half rate; each failed attempt waits twice as long before the next one
        PACE.banMs = Math.min(600000, (PACE.banMs || 15000) * 2);
        PACE.fullOK = 0; PACE.fullBan = performance.now() + PACE.banMs; PACE.lateWin.length = 0;
      }
    }
  }
  const PACE_KEY = 'cragspire.pace';
  function loadPace() { try { const m = localStorage.getItem(PACE_KEY); if (m === '60' || m === '30' || m === 'max' || m === 'auto') PACE.mode = m; } catch (e) { /* storage unavailable */ } }
  GM.setPaceMode = function (m) {
    PACE.mode = m; PACE.fullOK = 0; PACE.lateWin.length = 0;
    try { localStorage.setItem(PACE_KEY, m); } catch (e) { /* storage unavailable */ }
  };
  // one rendered frame (also callable directly for automated testing)
  GM.tick = function (dt, noRender) {
    GM.clock += dt;
    const I = G.input;
    I.update(dt);
    GM.stateT += dt;

    if (I.mute) {
      G.audio.musicOn = !G.audio.musicOn;
      G.audio.applyVolumes();
    }

    switch (GM.state) {
      case 'title':
        titleCamera(dt);
        if (I.jump || I.pause) GM.start();
        break;
      case 'play':
        if (I.pause) { GM.setState('paused'); break; }
        simulate(dt);
        break;
      case 'paused':
        if (I.pause) GM.setState('play');
        if (I.restart) GM.restart();
        break;
      case 'gemget':
        simulateWorldOnly(dt);
        celebrationCamera(dt);
        if (GM.stateT > 2.8) {
          G.hud.gemGet('', false);
          if (!GM.gemInWater) G.player.setState('ground');
          G.camera.mode = 'follow';
          GM.setState('play');
        }
        break;
      case 'dying':
        simulate(dt, true);
        if (GM.stateT > 1.4) G.hud.fade(true);
        if (GM.stateT > 2.0) respawn();
        break;
      case 'victory':
        simulateWorldOnly(dt);
        celebrationCamera(dt);
        if (GM.stateT > 4 && G.hud.el.victory.hidden) { GM.stats.time = GM.time; G.hud.victory(GM.stats); }
        break;
    }

    // visuals
    G.player.render(dt);
    G.enemies.render(GM.camera3.position);
    G.boss.render(dt);
    G.decor.update(dt, GM.camera3.position);
    G.water.update(dt, GM.camera3.position);
    G.castle.update(dt, GM.camera3.position);
    G.gfx.uUnder.value = G.water.camUnder;
    G.gfx.uCamDepth.value = G.water.camDepth;
    G.audio.setUnderwater && G.audio.setUnderwater(G.water.camUnder > 0.5 ? 1 : 0);
    G.gfx.update(dt, GM.state === 'title' ? G.camera.cam.position : G.player.pos);
    G.gfx.updateFields(GM.camera3.position);
    G.hud.update(dt);
    if (!noRender) G.gfx.render();
    I.endFrame();
  };

  function simulate(dt, dying) {
    const n = Math.max(1, Math.ceil(dt / STEP - 0.01));
    const sub = dt / n;
    for (let i = 0; i < n; i++) {
      G.updateObjects(sub, GM.clock);
      G.player.update(sub);
      G.enemies.update(sub);
      G.boss.update(sub);
      G.level.update(sub, GM.clock);
      G.collect.update(sub, GM.clock);
      G.fx.update(sub);
      if (i === 0) G.input.consumeEdges();
    }
    if (!dying) GM.time += dt;
    G.camera.update(dt);
    trackArea(dt);
  }
  // keep the world alive (but the player frozen) during celebrations
  function simulateWorldOnly(dt) {
    G.updateObjects(dt, GM.clock);
    G.collect.update(dt, GM.clock);
    G.fx.update(dt);
    G.player.time += dt; G.player.stateTime += dt;
  }

  let areaTimer = 0;
  function trackArea(dt) {
    areaTimer -= dt;
    if (areaTimer > 0) return;
    areaTimer = 0.25;
    const p = G.player.pos;
    const a = G.castle.inside(p) ? 'foyer' : G.terrain.areaAt(p.x, p.y, p.z);
    if (a !== GM.area) {
      GM.area = a;
      G.hud.area(G.level.AREAS[a] || '');
    }
    let m = 'field';
    const pl = G.player;
    GM.wetT = pl.isSwimming() ? Math.min(3, (GM.wetT || 0) + 0.25) : Math.max(0, (GM.wetT || 0) - 0.25);
    if (a === 'mountain' || a === 'highlands') m = 'mountain';
    if (a === 'upper' || a === 'lake') m = 'danger';
    if (a === 'summit') m = G.boss.active() ? 'boss' : 'mountain';
    if (a === 'lagoon' || GM.wetT > 1.5) m = 'water';
    if (a === 'foyer') m = 'hall';
    if (G.boss.active() && Math.hypot(p.x - G.terrain.mtn.x, p.z - G.terrain.mtn.z) < 30) m = 'boss';
    G.music.setState(m);
  }

  function titleCamera(dt) {
    const c = GM.camera3, t = GM.clock * 0.035;
    c.position.set(Math.sin(t) * 250, 92, 130 + Math.cos(t) * 250);
    c.lookAt(Math.sin(t) * 40, 30, 130 + Math.cos(t) * 40);
    G.updateObjects(dt, GM.clock);
    G.collect.update(dt, GM.clock);
  }
  function celebrationCamera(dt) {
    const pl = G.player, c = GM.camera3;
    const f = pl.face;
    const target = new THREE.Vector3(pl.pos.x + Math.sin(f) * 6, pl.pos.y + 2.2, pl.pos.z + Math.cos(f) * 6);
    c.position.lerp(target, 1 - Math.exp(-3 * dt));
    c.lookAt(pl.pos.x, pl.pos.y + 1.2, pl.pos.z);
  }

  // started by the module bootstrap in index.html once three.js is loaded
})(window.G);

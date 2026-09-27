// dev-only test harness (not shipped): manual stepping, teleports, GPU/pipeline instrumentation
(async () => {
  for (let i = 0; i < 120 && !(window.G && G.game && G.game.state !== 'loading' && G.game.stats); i++) await new Promise(r => setTimeout(r, 500));
  if (!window.__realTick) { window.__realTick = G.game.tick; G.game.tick = function (dt, nr) { if (!window.__manual) return; return window.__realTick(dt, nr); }; }
  // the renderer advances its node frame (FRAME-updated passes: scene pass, shadows) from its own rAF loop,
  // which is throttled in a hidden pane: advance it by hand before every manual tick
  window.NF = () => { const r = G.gfx.renderer; if (r.info.autoReset) r.info.reset(); r._nodes.nodeFrame.update(); r.info.frame = r._nodes.nodeFrame.frameId; };
  window.TICK = (dt, noRender) => { NF(); return window.__realTick(dt || 1 / 60, noRender); };
  window.STEP = (n, render) => { window.__manual = true; try { for (let i = 0; i < n; i++) TICK(1 / 60, !(render || i >= n - 12)); } finally { window.__manual = false; } };
  window.KEY = (code, down) => window.dispatchEvent(new KeyboardEvent(down ? 'keydown' : 'keyup', { code, key: code, bubbles: true }));
  window.TP = function (x, z, face, pitch, y) { const pl = G.player; const gy = y != null ? y : G.physics.ground(x, z, 999, 0, 0).h + 0.05; pl.hp = 8; pl.invuln = 0; pl.spawn(x, gy, z, face || 0); pl.grounded = true; pl.setState('ground'); G.camera.mode = 'follow'; G.camera.snapBehind(face || 0); if (pitch != null) G.camera.pitch = pitch; return pl.state; };
  // ---- WebGPU instrumentation: count + time pipeline / shader creation ----
  const P = (window.PIPE = { n: 0, ms: 0, async: 0, shaders: 0, shaderMs: 0, textures: 0, buffers: 0, bufBytes: 0, log: [] });
  const be = G.gfx.renderer.backend, dev = be && be.device;
  if (dev && !dev.__wrapped) {
    dev.__wrapped = true;
    const wrap = (name, fn) => { const orig = dev[name].bind(dev); dev[name] = function (...a) { return fn(orig, a); }; };
    wrap('createRenderPipeline', (o, a) => { const t = performance.now(); const r = o(...a); const d = performance.now() - t; P.n++; P.ms += d; if (d > 4) P.log.push(['sync', +d.toFixed(1), a[0] && a[0].label]); return r; });
    wrap('createRenderPipelineAsync', (o, a) => { P.async++; return o(...a); });
    wrap('createComputePipeline', (o, a) => { const t = performance.now(); const r = o(...a); P.n++; P.ms += performance.now() - t; return r; });
    wrap('createShaderModule', (o, a) => { const t = performance.now(); const r = o(...a); P.shaders++; P.shaderMs += performance.now() - t; return r; });
    wrap('createTexture', (o, a) => { P.textures++; return o(...a); });
    wrap('createBuffer', (o, a) => { P.buffers++; P.bufBytes += (a[0] && a[0].size) || 0; return o(...a); });
  }
  window.PSNAP = () => ({ n: P.n, ms: +P.ms.toFixed(1), async: P.async, shaders: P.shaders, shaderMs: +P.shaderMs.toFixed(1), tex: P.textures, buf: P.buffers });
  // serialized CPU + GPU time per frame, spikes listed with what was created during them
  window.PROF = async function (n, opts) {
    opts = opts || {};
    window.__manual = true;
    const cpu = [], tot = [], spikes = [];
    try {
      for (let i = 0; i < n; i++) {
        if (opts.each) opts.each(i);
        const p0 = P.n, s0 = P.shaders, t0 = performance.now();
        TICK(1 / 60);
        const t1 = performance.now();
        if (dev) await dev.queue.onSubmittedWorkDone();
        const t2 = performance.now();
        cpu.push(t1 - t0); tot.push(t2 - t0);
        if (t2 - t0 > (opts.spike || 30)) spikes.push({ i, cpu: +(t1 - t0).toFixed(1), total: +(t2 - t0).toFixed(1), pipes: P.n - p0, shaders: P.shaders - s0 });
      }
    } finally { window.__manual = false; }
    const st = (a) => { const s = a.slice().sort((x, y) => x - y); return { med: +s[s.length >> 1].toFixed(2), p90: +s[Math.floor(s.length * 0.9)].toFixed(2), max: +s[s.length - 1].toFixed(2) }; };
    return { cpu: st(cpu), total: st(tot), spikes: spikes.slice(0, 12), nSpikes: spikes.length };
  };
  // render n frames, then capture the canvas in the same task as the last render and upload it (dev server on :8766)
  window.SNAP = async function (name, n) {
    window.__manual = true;
    try { for (let i = 0; i < (n == null ? 30 : n); i++) TICK(1 / 60); TICK(1 / 60); } finally { window.__manual = false; }
    const blob = await new Promise((res) => G.gfx.renderer.domElement.toBlob(res, 'image/jpeg', 0.9));
    const r = await fetch('http://127.0.0.1:8766/save?name=' + encodeURIComponent(name), { method: 'POST', body: blob });
    return r.ok ? name + ' ' + blob.size : 'upload failed';
  };
  window.CLOSE = function (dist, h, side, lookH) { const pl = G.player, f = [Math.sin(pl.face), Math.cos(pl.face)], sd = side || 0; G.camera.mode = 'fixed'; G.camera.fixedPos = new THREE.Vector3(pl.pos.x + f[0] * dist + f[1] * sd, pl.pos.y + h, pl.pos.z + f[1] * dist - f[0] * sd); G.camera.fixedLook = new THREE.Vector3(pl.pos.x, pl.pos.y + (lookH || 1.05), pl.pos.z); G.camera.cam.position.copy(G.camera.fixedPos); };
  // camera that tracks the player from a fixed offset (side / front) while stepping n frames
  window.TRACK = function (n, dist, h, side, lookH) {
    const pl = G.player; G.camera.mode = 'fixed';
    window.__manual = true;
    try {
      for (let i = 0; i < n; i++) {
        const f = [Math.sin(pl.face), Math.cos(pl.face)], sd = side || 0;
        const pos = new THREE.Vector3(pl.pos.x + f[0] * dist + f[1] * sd, pl.pos.y + h, pl.pos.z + f[1] * dist - f[0] * sd);
        G.camera.fixedPos = pos; G.camera.cam.position.copy(pos);
        G.camera.fixedLook = new THREE.Vector3(pl.pos.x, pl.pos.y + (lookH || 1.0), pl.pos.z);
        TICK(1 / 60);
      }
    } finally { window.__manual = false; }
  };
  window.SNAPNOW = async function (name) {
    const blob = await new Promise((res) => G.gfx.renderer.domElement.toBlob(res, 'image/jpeg', 0.9));
    const r = await fetch('http://127.0.0.1:8766/save?name=' + encodeURIComponent(name), { method: 'POST', body: blob });
    return r.ok ? name : 'upload failed';
  };
  G.gfx.autoQuality = false;
  window.__harness = true;
  return 'harness ready';
})();

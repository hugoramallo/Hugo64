// core.js — shared namespace, math helpers and input (keyboard, mouse, gamepad).
window.G = window.G || {};
(function (G) {
  'use strict';
  const TAU = Math.PI * 2;

  // ---------- math helpers ----------
  const U = {
    TAU,
    clamp: (v, a, b) => (v < a ? a : v > b ? b : v),
    lerp: (a, b, t) => a + (b - a) * t,
    // frame-rate independent exponential smoothing
    damp: (a, b, lambda, dt) => a + (b - a) * (1 - Math.exp(-lambda * dt)),
    wrap(a) {
      a = (a + Math.PI) % TAU;
      if (a < 0) a += TAU;
      return a - Math.PI;
    },
    angleDamp(a, b, lambda, dt) {
      return a + U.wrap(b - a) * (1 - Math.exp(-lambda * dt));
    },
    // rotate angle a toward b by at most step
    angleStep(a, b, step) {
      const d = U.wrap(b - a);
      if (Math.abs(d) <= step) return b;
      return a + Math.sign(d) * step;
    },
    smoothstep(e0, e1, x) {
      const t = U.clamp((x - e0) / (e1 - e0), 0, 1);
      return t * t * (3 - 2 * t);
    },
    hash2(x, z) {
      let h = Math.sin(x * 127.1 + z * 311.7) * 43758.5453;
      return h - Math.floor(h);
    },
    // smooth value noise in [-1,1]
    vnoise(x, z) {
      const xi = Math.floor(x), zi = Math.floor(z);
      const xf = x - xi, zf = z - zi;
      const u = xf * xf * (3 - 2 * xf), v = zf * zf * (3 - 2 * zf);
      const a = U.hash2(xi, zi), b = U.hash2(xi + 1, zi);
      const c = U.hash2(xi, zi + 1), d = U.hash2(xi + 1, zi + 1);
      return (a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v) * 2 - 1;
    },
    // deterministic RNG so the level is identical on every load
    rng(seed) {
      let s = seed >>> 0;
      return function () {
        s = (s + 0x6d2b79f5) >>> 0;
        let t = s;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
      };
    },
    dist2(ax, az, bx, bz) {
      return Math.hypot(ax - bx, az - bz);
    },
    distPointSeg2D(px, pz, ax, az, bx, bz) {
      const vx = bx - ax, vz = bz - az;
      const L = vx * vx + vz * vz || 1e-6;
      const t = U.clamp(((px - ax) * vx + (pz - az) * vz) / L, 0, 1);
      return Math.hypot(px - (ax + vx * t), pz - (az + vz * t));
    },
  };
  G.U = U;

  // ---------- input ----------
  const keys = {};
  const pressed = {};
  const PREVENT = new Set(['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'ShiftLeft', 'ShiftRight', 'Tab', 'KeyE', 'KeyC']);

  const input = {
    moveX: 0, moveY: 0,          // analog stick, -1..1 (y = forward)
    moveMag: 0,
    camDX: 0, camDY: 0,          // camera deltas this frame (radians-ish)
    camZoom: 0,
    jump: false, jumpHeld: false,
    crouch: false, crouchHeld: false,
    punch: false,
    grab: false, grabHeld: false,
    run: false,
    pause: false,
    walk: false,
    manualCamTime: 99,           // seconds since last manual camera input
    usingPad: false,
    sens: 1, invertY: false, recenter: false,
    pointerLocked: false,
    anyKey: false,
  };

  let mouseDX = 0, mouseDY = 0, wheel = 0, mouseClick = false, dragging = false;
  let canvasEl = null;

  addEventListener('keydown', (e) => {
    if (!keys[e.code]) pressed[e.code] = true;
    keys[e.code] = true;
    input.anyKey = true;
    input.usingPad = false;
    if (PREVENT.has(e.code)) e.preventDefault();
  });
  addEventListener('keyup', (e) => { keys[e.code] = false; });
  addEventListener('blur', () => { for (const k in keys) keys[k] = false; });

  input.attach = function (canvas) {
    canvasEl = canvas;
    canvas.addEventListener('mousedown', (e) => {
      if (G.game && G.game.state !== 'play') return;
      if (document.pointerLockElement === canvas) {
        if (e.button === 0) mouseClick = true;
      } else {
        dragging = true;
        try {
          const p = canvas.requestPointerLock && canvas.requestPointerLock();
          if (p && p.catch) p.catch(() => {});
        } catch (err) { /* pointer lock optional */ }
      }
    });
    addEventListener('mouseup', () => { dragging = false; });
    addEventListener('mousemove', (e) => {
      if (document.pointerLockElement === canvasEl || dragging) {
        mouseDX += e.movementX || 0;
        mouseDY += e.movementY || 0;
      }
    });
    canvas.addEventListener('wheel', (e) => { wheel += Math.sign(e.deltaY); e.preventDefault(); }, { passive: false });
    document.addEventListener('pointerlockchange', () => {
      input.pointerLocked = document.pointerLockElement === canvasEl;
    });
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
  };

  input.releasePointer = function () {
    try { if (document.exitPointerLock) document.exitPointerLock(); } catch (e) {}
  };

  const k = (c) => !!keys[c];
  const p = (c) => !!pressed[c];
  let padPrev = [];

  input.update = function (dt) {
    // keyboard movement
    let mx = 0, my = 0;
    if (k('KeyW') || k('ArrowUp')) my += 1;
    if (k('KeyS') || k('ArrowDown')) my -= 1;
    if (k('KeyA')) mx -= 1;
    if (k('KeyD')) mx += 1;
    let camKey = 0;
    if (k('ArrowLeft') || k('KeyQ')) camKey -= 1;
    if (k('ArrowRight')) camKey += 1;

    let jumpHeld = k('Space');
    let jump = p('Space');
    let run = k('ShiftLeft') || k('ShiftRight');
    let crouchHeld = k('KeyC') || k('KeyL');
    let crouch = p('KeyC') || p('KeyL');
    let punch = p('KeyJ') || mouseClick;
    let grabHeld = k('KeyE') || k('KeyK');
    let grab = p('KeyE') || p('KeyK');
    let pause = p('Escape') || p('KeyP') || p('Enter');
    let walk = false;
    const inv = input.invertY ? -1 : 1;
    let camDX = camKey * 2.4 * dt + mouseDX * 0.0042 * input.sens;
    let camDY = mouseDY * 0.0032 * input.sens * inv;
    let zoom = wheel + (p('KeyZ') ? 1 : 0) + (p('KeyX') ? -1 : 0);

    // gamepad (standard mapping)
    const pads = navigator.getGamepads ? navigator.getGamepads() : [];
    const pad = pads && Array.from(pads).find((g) => g && g.connected);
    if (pad) {
      const dz = (v) => (Math.abs(v) < 0.18 ? 0 : (v - Math.sign(v) * 0.18) / 0.82);
      const ax = dz(pad.axes[0] || 0), ay = dz(pad.axes[1] || 0);
      const rx = dz(pad.axes[2] || 0), ry = dz(pad.axes[3] || 0);
      const b = (i) => !!(pad.buttons[i] && pad.buttons[i].pressed);
      const bp = (i) => b(i) && !padPrev[i];
      if (Math.abs(ax) + Math.abs(ay) > 0.01) { mx = ax; my = -ay; input.usingPad = true; }
      if (Math.abs(rx) > 0.01) camDX += rx * 2.8 * dt * input.sens;
      if (Math.abs(ry) > 0.01) camDY += ry * 1.8 * dt * input.sens * inv;
      if (bp(10) || bp(11)) input.recenterPad = true;
      if (b(0)) jumpHeld = true;
      if (bp(0)) { jump = true; input.usingPad = true; }
      if (bp(2)) punch = true;
      if (b(3)) grabHeld = true;
      if (bp(3)) grab = true;
      if (b(7) || b(1) || b(5)) run = true;
      if (b(6) || b(4)) crouchHeld = true;
      if (bp(6) || bp(4)) crouch = true;
      if (bp(9)) pause = true;
      if (bp(12)) zoom -= 1;
      if (bp(13)) zoom += 1;
      padPrev = pad.buttons.map((x) => x.pressed);
    }

    let mag = Math.hypot(mx, my);
    if (mag > 1) { mx /= mag; my /= mag; mag = 1; }
    if (walk) { mx *= 0.4; my *= 0.4; mag *= 0.4; }

    input.moveX = mx; input.moveY = my; input.moveMag = mag;
    input.jump = jump; input.jumpHeld = jumpHeld;
    input.crouch = crouch; input.crouchHeld = crouchHeld;
    input.punch = punch; input.pause = pause; input.walk = walk;
    input.grab = grab; input.grabHeld = grabHeld; input.run = run;
    input.camDX = camDX; input.camDY = camDY; input.camZoom = zoom;
    if (Math.abs(camDX) > 0.0005 || Math.abs(camDY) > 0.0005 || zoom) input.manualCamTime = 0;
    else input.manualCamTime += dt;
    input.restart = p('KeyR');
    input.recenter = p('Tab') || !!input.recenterPad; input.recenterPad = false;
    input.mute = p('KeyM');
  };

  // call once per rendered frame after all consumers read the edges
  input.endFrame = function () {
    for (const c in pressed) delete pressed[c];
    mouseDX = 0; mouseDY = 0; wheel = 0; mouseClick = false;
  };
  // consume edge flags so fixed-step substeps don't double-trigger
  input.consumeEdges = function () {
    input.jump = false; input.crouch = false; input.punch = false; input.grab = false;
  };

  G.input = input;

  // ---------- tiny event bus ----------
  const handlers = {};
  let worldHandlers = {};
  G.on = (ev, fn) => { (handlers[ev] = handlers[ev] || []).push(fn); };
  // handlers owned by level objects; dropped when the world is rebuilt
  G.onWorld = (ev, fn) => { (worldHandlers[ev] = worldHandlers[ev] || []).push(fn); };
  G.clearWorldEvents = () => { worldHandlers = {}; };
  G.emit = (ev, a, b) => {
    (handlers[ev] || []).forEach((fn) => fn(a, b));
    (worldHandlers[ev] || []).forEach((fn) => fn(a, b));
  };
})(window.G);

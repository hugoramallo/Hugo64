// camera.js — late-90s style follow camera: orbit, auto-align behind the player,
// adaptive distance (open fields vs. tight ledges), terrain avoidance and shake.
(function (G) {
  'use strict';
  const U = G.U;
  const CAM = {
    cam: null, yaw: 0, pitch: 0.32, dist: 14, distCur: 14, zoomLevel: 1,
    target: new THREE.Vector3(), look: new THREE.Vector3(), shakeT: 0,
    mode: 'follow', fixedPos: null, fixedLook: null,
  };
  const ZOOMS = [0.7, 1, 1.35];

  CAM.init = function (camera) { CAM.cam = camera; };

  // does the segment a->b pass through a wall-like collider? returns the hit fraction (1 = clear)
  const SKIP = new Set(['fence', 'hedge', 'parapet', 'step', 'crate', 'switch', 'spring', 'platform', 'falling', 'timed', 'chest',
    'door', 'threshold', 'tree', 'lamp', 'column', 'fountain', 'drum', 'stairs', 'bridge', 'log', 'roof', 'pier', 'well', 'push', 'gate']);
  function slab(o, d, h) { // returns [t0, t1] of the ray o + d t inside |x| <= h
    if (Math.abs(d) < 1e-6) return o >= -h && o <= h ? [-Infinity, Infinity] : [Infinity, -Infinity];
    const a = (-h - o) / d, b = (h - o) / d;
    return a < b ? [a, b] : [b, a];
  }
  function segmentBlock(ax, ay, az, bx, by, bz) {
    const P = G.physics, mx = (ax + bx) / 2, mz = (az + bz) / 2, half = Math.hypot(bx - ax, bz - az) / 2 + 1;
    const list = P.near(mx, mz, half);
    let best = 1;
    for (let i = 0; i < list.length; i++) {
      const c = list[i];
      if (!c.solid || c.dynamic || SKIP.has(c.tag)) continue;
      if (c.isCyl) {
        if (c.r < 2.5) continue;
        const dx = bx - ax, dz = bz - az, fx = ax - c.x, fz = az - c.z;
        const A = dx * dx + dz * dz, B = 2 * (fx * dx + fz * dz), Cc = fx * fx + fz * fz - (c.r + 0.3) * (c.r + 0.3);
        const disc = B * B - 4 * A * Cc;
        if (A < 1e-6 || disc < 0 || Cc < 0) continue;
        const t = (-B - Math.sqrt(disc)) / (2 * A);
        if (t < 0 || t >= best) continue;
        const y = ay + (by - ay) * t;
        if (y >= c.y0 && y <= c.y1) best = t;
        continue;
      }
      if (Math.max(c.hx, c.hz) < 1.4) continue;
      const l0 = P.toLocal(c, ax, az), l1 = P.toLocal(c, bx, bz), m = 0.25;
      const sx = slab(l0[0], l1[0] - l0[0], c.hx + m), sy = slab(ay - c.y, by - ay, c.hy + m), sz = slab(l0[1], l1[1] - l0[1], c.hz + m);
      const t0 = Math.max(sx[0], sy[0], sz[0]), t1 = Math.min(sx[1], sy[1], sz[1]);
      if (t0 <= t1 && t0 >= 0 && t0 < best) best = t0;
    }
    return best;
  }
  CAM.segmentBlock = segmentBlock;

  CAM.snapBehind = function (face) {
    CAM.yaw = face + Math.PI;
    const p = G.player.pos;
    CAM.target.set(p.x, p.y + 1.6, p.z);
    CAM.distCur = CAM.dist;
    if (G.gfx.cameraCut) G.gfx.cameraCut(); // a cut: refresh every shadow cascade at once
  };
  CAM.shakeScale = 1;
  CAM.shake = function (t) { CAM.shakeT = Math.max(CAM.shakeT, t * CAM.shakeScale); };

  // how enclosed is the player? 0 = wide open, 1 = hemmed in by terrain
  function enclosure(p) {
    let hits = 0;
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      const h = G.terrain.heightAt(p.x + Math.cos(a) * 9, p.z + Math.sin(a) * 9);
      if (h > p.y + 3) hits++;
    }
    return hits / 8;
  }

  CAM.update = function (dt) {
    const I = G.input, pl = G.player, p = pl.pos, cam = CAM.cam;
    if (CAM.mode === 'fixed') {
      cam.position.lerp(CAM.fixedPos, 1 - Math.exp(-4 * dt));
      cam.lookAt(CAM.fixedLook);
      return;
    }
    // manual control
    CAM.yaw -= I.camDX;
    const under = pl.state === 'uw';
    CAM.pitch = U.clamp(CAM.pitch + I.camDY, under ? -0.9 : -0.15, 1.25);
    // Tab / stick click: swing the camera back behind the player
    if (I.recenter) CAM.recenterT = 0.4;
    if (CAM.recenterT > 0) {
      CAM.recenterT -= dt;
      CAM.yaw = U.angleDamp(CAM.yaw, pl.face + Math.PI, 16, dt);
      CAM.pitch = U.damp(CAM.pitch, under ? 0.1 : 0.3, 10, dt);
    }
    if (I.camZoom) CAM.zoomLevel = U.clamp(CAM.zoomLevel + I.camZoom, 0, 2);

    // auto-rotate behind the player while moving (only after manual input is idle)
    const sp = Math.hypot(pl.vel.x, pl.vel.z);
    const moving = sp > 3 && (pl.state === 'ground' || pl.state === 'air' || pl.state === 'slide' || pl.state === 'swim' || pl.state === 'uw');
    if (moving && I.manualCamTime > 1.0) {
      const heading = Math.atan2(pl.vel.x, pl.vel.z);
      const behind = heading + Math.PI;
      const diff = Math.abs(U.wrap(behind - CAM.yaw));
      if (diff < 2.4) { // don't whip around when running toward the camera
        const rate = 0.5 + Math.min(1.6, sp / 10);
        CAM.yaw = U.angleDamp(CAM.yaw, behind, rate * 0.55, dt);
      }
      if (!under) CAM.pitch = U.damp(CAM.pitch, 0.3, 0.6, dt);
    }

    // target: follow horizontally tightly, vertically lazily while airborne
    const tx = p.x, tz = p.z;
    let ty = p.y + 1.6;
    const air = !pl.grounded && pl.state !== 'slide';
    CAM.target.x = U.damp(CAM.target.x, tx, 12, dt);
    CAM.target.z = U.damp(CAM.target.z, tz, 12, dt);
    const vyRate = air ? (ty < CAM.target.y - 2 ? 6 : 2.2) : 7;
    CAM.target.y = U.damp(CAM.target.y, ty, vyRate, dt);
    if (Math.abs(CAM.target.y - ty) > 12) CAM.target.y = ty - Math.sign(ty - CAM.target.y) * 12;

    // adaptive distance
    const area = G.game.area;
    let base = 15;
    const enc = enclosure(p);
    base = U.lerp(16.5, 9.5, enc);
    if (area === 'summit') base = 19;
    if (area === 'foyer') base = 10.5;
    if (pl.state === 'shot') base = 20;
    base *= ZOOMS[CAM.zoomLevel];
    base += Math.min(4, sp * 0.15);
    CAM.dist = U.damp(CAM.dist, base, 1.5, dt);

    // desired position
    const cp = Math.cos(CAM.pitch), spch = Math.sin(CAM.pitch);
    const dirX = Math.sin(CAM.yaw) * cp, dirY = spch, dirZ = Math.cos(CAM.yaw) * cp;
    // terrain avoidance: march from target outward
    let allowed = CAM.dist;
    const steps = 16;
    for (let i = 1; i <= steps; i++) {
      const d = (CAM.dist * i) / steps;
      const x = CAM.target.x + dirX * d, y = CAM.target.y + dirY * d, z = CAM.target.z + dirZ * d;
      if (G.terrain.heightAt(x, z) + 0.8 > y) { allowed = Math.max(2.5, (CAM.dist * (i - 1)) / steps); break; }
    }
    // walls, towers and houses also block the view (checked once against the colliders)
    const tb = segmentBlock(CAM.target.x, CAM.target.y, CAM.target.z, CAM.target.x + dirX * CAM.dist, CAM.target.y + dirY * CAM.dist, CAM.target.z + dirZ * CAM.dist);
    const terrainAllowed = allowed;
    if (tb < 1) allowed = Math.min(allowed, Math.max(0.5, tb * CAM.dist - 0.35));
    // shrink fast, grow back slowly
    CAM.distCur = allowed < CAM.distCur ? U.damp(CAM.distCur, allowed, 18, dt) : U.damp(CAM.distCur, allowed, 2.2, dt);
    let x = CAM.target.x + dirX * CAM.distCur, y = CAM.target.y + dirY * CAM.distCur, z = CAM.target.z + dirZ * CAM.distCur;
    const gh = G.terrain.heightAt(x, z);
    if (y < gh + 1.0) y = gh + 1.0;
    // when crowded out by terrain, lift the camera up a bit so the player stays visible
    if (terrainAllowed < CAM.dist * 0.6 && allowed >= terrainAllowed - 0.01) y += (CAM.dist * 0.6 - allowed) * 0.35;
    else if (allowed < CAM.dist * 0.55) {
      // pressed against a wall: rise (if the space above is free) so the player isn't filling the screen
      let lift = Math.min(2.6, (CAM.dist * 0.55 - allowed) * 0.45);
      const tl = segmentBlock(x, y, z, x, y + lift + 0.4, z);
      lift *= tl;
      CAM.lift = U.damp(CAM.lift || 0, lift, 6, dt);
      y += CAM.lift;
    }
    if (!(allowed < CAM.dist * 0.55)) CAM.lift = U.damp(CAM.lift || 0, 0, 6, dt);
    // water: follow a diving player below the surface, otherwise stay above it; never sit on the waterline
    const wl = G.terrain.waterLevelAt(x, z);
    if (under) {
      const L = wl !== null ? wl : pl.waterLevel;
      if (L != null && y > L - 0.55) y = Math.max(gh + 0.6, L - 0.55);
    } else if (wl !== null && y < wl + 0.75) y = wl + 0.75;

    cam.position.set(x, y, z);
    CAM.look.set(CAM.target.x, CAM.target.y - 0.2, CAM.target.z);
    if (CAM.shakeT > 0) {
      CAM.shakeT -= dt;
      const k = CAM.shakeT * 1.6;
      cam.position.x += (Math.random() - 0.5) * k; cam.position.y += (Math.random() - 0.5) * k;
    }
    cam.lookAt(CAM.look);
  };

  G.camera = CAM;
})(window.G);

// physics.js — collider world (oriented boxes, cylinders) with a uniform spatial hash, ground probing,
// wall resolution and a generic body integrator used by enemies, boulders and loose objects.
(function (G) {
  'use strict';
  const U = G.U;
  const P = {
    GRAVITY: -52,
    boxes: [],
    cyls: [],
    dynamic: [],          // colliders that move horizontally (platforms, push block, boss)
    grid: new Map(),
    CELL: 24,
  };
  let stamp = 1;

  const key = (ix, iz) => (ix + 512) * 4096 + (iz + 512);
  function cellsFor(c) {
    let ex, ez;
    if (c.isCyl) { ex = ez = c.r; }
    else {
      const ac = Math.abs(c.cos), as = Math.abs(c.sin);
      ex = c.hx * ac + c.hz * as; ez = c.hx * as + c.hz * ac;
    }
    const x0 = Math.floor((c.x - ex - 1) / P.CELL), x1 = Math.floor((c.x + ex + 1) / P.CELL);
    const z0 = Math.floor((c.z - ez - 1) / P.CELL), z1 = Math.floor((c.z + ez + 1) / P.CELL);
    const out = [];
    for (let i = x0; i <= x1; i++) for (let j = z0; j <= z1; j++) out.push(key(i, j));
    return out;
  }
  function insert(c) {
    if (c.dynamic) { P.dynamic.push(c); return; }
    c._cells = cellsFor(c);
    for (const k of c._cells) {
      let l = P.grid.get(k);
      if (!l) P.grid.set(k, (l = []));
      l.push(c);
    }
  }
  P.clear = function () { P.boxes.length = 0; P.cyls.length = 0; P.dynamic.length = 0; P.grid.clear(); };

  // Box: centre (x,y,z), half extents (hx,hy,hz), yaw. Optional: moving platform velocity.
  P.addBox = function (o) {
    const b = Object.assign({ yaw: 0, solid: true, vx: 0, vy: 0, vz: 0, dyaw: 0, tag: '' }, o);
    b.cos = Math.cos(b.yaw); b.sin = Math.sin(b.yaw);
    P.boxes.push(b);
    insert(b);
    return b;
  };
  P.setYaw = function (b, yaw) { b.yaw = yaw; b.cos = Math.cos(yaw); b.sin = Math.sin(yaw); };
  P.remove = function (c) {
    let i = P.boxes.indexOf(c); if (i >= 0) P.boxes.splice(i, 1);
    i = P.cyls.indexOf(c); if (i >= 0) P.cyls.splice(i, 1);
    i = P.dynamic.indexOf(c); if (i >= 0) P.dynamic.splice(i, 1);
    if (c._cells) for (const k of c._cells) { const l = P.grid.get(k); if (l) { const j = l.indexOf(c); if (j >= 0) l.splice(j, 1); } }
  };
  // vertical cylinder obstacle (tree trunks, posts, pillars)
  P.addCyl = function (o) {
    const c = Object.assign({ solid: true, top: true, isCyl: true }, o); // y0 bottom, y1 top
    P.cyls.push(c);
    insert(c);
    return c;
  };

  // candidate colliders near (x,z) within radius r (static cells + dynamic list), each once
  const cand = [];
  function gather(x, z, r) {
    cand.length = 0;
    stamp++;
    const x0 = Math.floor((x - r) / P.CELL), x1 = Math.floor((x + r) / P.CELL);
    const z0 = Math.floor((z - r) / P.CELL), z1 = Math.floor((z + r) / P.CELL);
    for (let i = x0; i <= x1; i++) for (let j = z0; j <= z1; j++) {
      const l = P.grid.get(key(i, j));
      if (!l) continue;
      for (let k = 0; k < l.length; k++) { const c = l[k]; if (c._q !== stamp) { c._q = stamp; cand.push(c); } }
    }
    for (let k = 0; k < P.dynamic.length; k++) { const c = P.dynamic[k]; if (c._q !== stamp) { c._q = stamp; cand.push(c); } }
    return cand;
  }
  P.near = gather;

  function toLocal(b, x, z) {
    const dx = x - b.x, dz = z - b.z;
    return [dx * b.cos - dz * b.sin, dx * b.sin + dz * b.cos];
  }
  function toWorldDir(b, lx, lz) {
    return [lx * b.cos + lz * b.sin, -lx * b.sin + lz * b.cos];
  }
  P.toLocal = toLocal;

  // Highest supporting surface under (x,z) at or below (y + stepUp).
  const gOut = { h: 0, box: null, cyl: null, n: null, terrain: true };
  const nTmp = new THREE.Vector3();
  P.ground = function (x, z, y, stepUp, pad) {
    pad = pad || 0;
    let h = G.terrain.heightAt(x, z);
    let box = null, cyl = null;
    const lim = y + stepUp;
    const list = gather(x, z, pad + 0.5);
    for (let i = 0; i < list.length; i++) {
      const c = list[i];
      if (!c.solid) continue;
      if (c.isCyl) {
        if (!c.top || c.y1 > lim || c.y1 <= h) continue;
        if (Math.hypot(x - c.x, z - c.z) <= c.r + pad * 0.5) { h = c.y1; cyl = c; box = null; }
      } else {
        const top = c.y + c.hy;
        if (top > lim || top <= h) continue;
        const l = toLocal(c, x, z);
        if (Math.abs(l[0]) <= c.hx + pad && Math.abs(l[1]) <= c.hz + pad) { h = top; box = c; cyl = null; }
      }
    }
    gOut.h = h; gOut.box = box; gOut.cyl = cyl;
    gOut.terrain = !box && !cyl;
    gOut.n = (box || cyl) ? nTmp.set(0, 1, 0) : G.terrain.normalAt(x, z, nTmp);
    return gOut;
  };

  // Lowest ceiling above head (boxes only)
  P.ceiling = function (x, z, headY, r) {
    let c = Infinity;
    const list = gather(x, z, r);
    for (let i = 0; i < list.length; i++) {
      const b = list[i];
      if (b.isCyl || !b.solid) continue;
      const bot = b.y - b.hy;
      if (bot < headY - 0.6 || bot > c) continue;
      const l = toLocal(b, x, z);
      if (Math.abs(l[0]) <= b.hx + r * 0.5 && Math.abs(l[1]) <= b.hz + r * 0.5) c = bot;
    }
    return c;
  };

  // Push a vertical cylinder body (pos = feet) out of boxes and cylinders.
  P.wallN = new THREE.Vector3();
  P.wallHit = null;
  P.resolveWalls = function (pos, r, h, stepUp) {
    let hit = null;
    const list = gather(pos.x, pos.z, r + 0.5).slice();
    for (let i = 0; i < list.length; i++) {
      const c = list[i];
      if (!c.solid) continue;
      if (c.isCyl) {
        if (pos.y >= c.y1 - stepUp || pos.y + h <= c.y0) continue;
        const dx = pos.x - c.x, dz = pos.z - c.z, d = Math.hypot(dx, dz), m = r + c.r;
        if (d >= m) continue;
        const nx = d > 1e-5 ? dx / d : 1, nz = d > 1e-5 ? dz / d : 0;
        pos.x = c.x + nx * m; pos.z = c.z + nz * m;
        P.wallN.set(nx, 0, nz);
        hit = c;
        continue;
      }
      const top = c.y + c.hy, bot = c.y - c.hy;
      if (pos.y >= top - stepUp || pos.y + h <= bot) continue;
      const l = toLocal(c, pos.x, pos.z);
      const qx = U.clamp(l[0], -c.hx, c.hx), qz = U.clamp(l[1], -c.hz, c.hz);
      const dx = l[0] - qx, dz = l[1] - qz;
      const d = Math.hypot(dx, dz);
      if (d >= r) continue;
      let nx, nz, push;
      if (d > 1e-5) { nx = dx / d; nz = dz / d; push = r - d; }
      else { // centre inside the box footprint: exit through the nearest side
        const px = c.hx - Math.abs(l[0]), pz = c.hz - Math.abs(l[1]);
        if (px < pz) { nx = Math.sign(l[0]) || 1; nz = 0; push = px + r; }
        else { nx = 0; nz = Math.sign(l[1]) || 1; push = pz + r; }
      }
      const w = toWorldDir(c, nx, nz);
      pos.x += w[0] * push; pos.z += w[1] * push;
      P.wallN.set(w[0], 0, w[1]);
      hit = c;
    }
    P.wallHit = hit;
    return hit;
  };

  // Is moving to (x1,z1) blocked by steep terrain for a body at feet y?
  P.terrainBlocks = function (x1, z1, feetY, maxStep) {
    const h = G.terrain.heightAt(x1, z1);
    if (h <= feetY + 0.05) return false;
    if (h > feetY + maxStep) return true;
    const n = G.terrain.normalAt(x1, z1, nTmp);
    return n.y < 0.5;
  };

  // Horizontal move with terrain wall sliding. Mutates pos. Returns true if blocked.
  P.moveHoriz = function (pos, dx, dz, maxStep) {
    if (!P.terrainBlocks(pos.x + dx, pos.z + dz, pos.y, maxStep)) { pos.x += dx; pos.z += dz; return false; }
    let blocked = true;
    if (!P.terrainBlocks(pos.x + dx, pos.z, pos.y, maxStep)) { pos.x += dx; blocked = 'z'; }
    else if (!P.terrainBlocks(pos.x, pos.z + dz, pos.y, maxStep)) { pos.z += dz; blocked = 'x'; }
    return blocked;
  };

  // Generic body: {pos, vel, r, h, grounded, bounce, friction}
  P.stepBody = function (b, dt) {
    b.vel.y += P.GRAVITY * (b.gravScale == null ? 1 : b.gravScale) * dt;
    if (b.vel.y < -60) b.vel.y = -60;
    const blocked = P.moveHoriz(b.pos, b.vel.x * dt, b.vel.z * dt, b.grounded ? 0.9 : 0.3);
    if (blocked) {
      b.hitWall = true;
      if (blocked === true) { b.vel.x *= -b.bounce || 0; b.vel.z *= -b.bounce || 0; }
    } else b.hitWall = false;
    if (!b.noWalls && P.resolveWalls(b.pos, b.r, b.h, 0.4)) b.hitWall = true;
    b.pos.y += b.vel.y * dt;
    const g = P.ground(b.pos.x, b.pos.z, b.pos.y, Math.max(0.6, -b.vel.y * dt + 0.25), 0);
    b.groundBox = g.box;
    if (b.pos.y <= g.h) {
      b.pos.y = g.h;
      if (b.vel.y < -6 && b.bounce) b.vel.y = -b.vel.y * b.bounce;
      else b.vel.y = 0;
      b.grounded = true;
      b.groundN = g.n;
      if (g.box) { b.pos.x += g.box.vx * dt; b.pos.z += g.box.vz * dt; }
    } else if (b.pos.y > g.h + 0.15 || b.vel.y > 0) {
      b.grounded = false;
    } else {
      b.pos.y = g.h; b.grounded = true; b.vel.y = 0; b.groundN = g.n;
    }
    if (b.grounded && b.friction) {
      const f = Math.exp(-b.friction * dt);
      b.vel.x *= f; b.vel.z *= f;
    }
  };

  G.physics = P;
})(window.G);

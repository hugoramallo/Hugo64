// interactive.js — moving & falling platforms, cannon, switches, gates, crates, push blocks,
// spinning hazards, springs, checkpoints, signposts and timed blocks.
(function (G) {
  'use strict';
  const U = G.U, P = G.physics;
  const OBJ = (G.objects = []);
  function reg(o) { OBJ.push(o); return o; }

  // ---------- carrying & throwing ----------
  // G.carryables holds pick-up handles: { reach, heavy, lift, pos, canPick(), pick(), hold(x,y,z,face), drop(x,y,z,face), throw(vel) }
  G.carryables = [];
  const flying = [];
  const _tmp = new THREE.Vector3();
  // ballistic flight for thrown things; onImpact(x, y, z) fires on ground, walls, enemies or water
  G.fly = function (obj, vel, r, onImpact, opts) {
    flying.push({ obj, vel: vel.clone(), r, onImpact, t: 0, spin: (opts && opts.spin) || 7, self: opts && opts.self });
  };
  function updateFlying(dt) {
    for (let i = flying.length - 1; i >= 0; i--) {
      const f = flying[i], p = f.obj.position;
      f.t += dt;
      f.vel.y += P.GRAVITY * 0.8 * dt;
      p.addScaledVector(f.vel, dt);
      if (f.obj.rotation) f.obj.rotation.x += f.spin * dt;
      let hit = f.t > 5;
      const g = P.ground(p.x, p.z, p.y + f.r, f.r + 0.6, 0).h;
      if (!hit && p.y - f.r <= g) hit = true;
      if (!hit && G.boss && G.boss.rockHitTest && G.boss.rockHitTest(p, f.r, f.vel)) hit = true;
      if (!hit && f.t > 0.05) { _tmp.set(p.x, p.y - f.r * 0.8, p.z); if (P.resolveWalls(_tmp, f.r * 0.8, f.r * 1.6, 0.05)) hit = true; }
      if (!hit) {
        for (const e of G.enemies.list) {
          if (!e.alive || e.held || e === f.self) continue;
          if (Math.hypot(e.pos.x - p.x, e.pos.y + e.h * 0.5 - p.y, e.pos.z - p.z) < e.r + f.r) {
            const dx = e.pos.x - p.x, dz = e.pos.z - p.z;
            e.onAttacked({ kind: 'throw' }, -dx, -dz, Math.hypot(dx, dz) || 1);
            hit = true; break;
          }
        }
      }
      const wl = G.terrain.waterLevelAt(p.x, p.z);
      if (!hit && wl !== null && p.y < wl) { if (G.water) G.water.splash(p.x, wl, p.z, 0.6); G.audio.sfx.splash(); hit = true; }
      if (hit) { flying.splice(i, 1); f.onImpact(p.x, Math.max(p.y, g), p.z); }
    }
  }
  G.clearFlying = () => { flying.length = 0; };

  // ---------- moving platform ----------
  G.movingPlatform = function (scene, o) {
    const mat = o.material || G.texMat('wood', o.w / 2, o.d / 2);
    const m = new THREE.Mesh(G.bevelBox(o.w, o.h, o.d, 0.12), mat);
    m.castShadow = true; m.receiveShadow = true;
    scene.add(m);
    const p0 = o.fn(o.phase || 0);
    const b = P.addBox({ x: p0[0], y: p0[1], z: p0[2], hx: o.w / 2, hy: o.h / 2, hz: o.d / 2, mesh: m, tag: 'platform', dynamic: true });
    let t = o.phase || 0;
    return reg({
      kind: 'moving', box: b,
      update(dt) {
        t += dt;
        const p = o.fn(t);
        b.vx = (p[0] - b.x) / dt; b.vy = (p[1] - b.y) / dt; b.vz = (p[2] - b.z) / dt;
        b.x = p[0]; b.y = p[1]; b.z = p[2];
        if (o.yawSpeed) { b.dyaw = o.yawSpeed; P.setYaw(b, b.yaw + o.yawSpeed * dt); }
        m.position.set(b.x, b.y, b.z); m.rotation.y = b.yaw;
      },
    });
  };

  // ---------- falling platform ----------
  G.fallingPlatform = function (scene, x, y, z, w, d) {
    const m = new THREE.Mesh(G.bevelBox(w, 0.8, d, 0.12), G.texMat('wood', 2, 2, 0xffe0b0));
    m.position.set(x, y, z); scene.add(m);
    const b = P.addBox({ x, y, z, hx: w / 2, hy: 0.4, hz: d / 2, mesh: m, tag: 'falling' });
    let state = 'idle', t = 0, vy = 0;
    return reg({
      kind: 'falling', box: b,
      update(dt) {
        t += dt;
        const pl = G.player;
        if (state === 'idle' && pl.grounded && pl.groundBox === b) { state = 'shake'; t = 0; G.audio.sfx.tick(false); }
        if (state === 'shake') {
          m.position.set(x + (Math.random() - 0.5) * 0.15, y, z + (Math.random() - 0.5) * 0.15);
          if (t > 0.65) { state = 'fall'; t = 0; vy = 0; }
        } else if (state === 'fall') {
          vy = Math.max(-30, vy - 30 * dt);
          b.vy = vy; b.y += vy * dt;
          m.position.set(x, b.y, z);
          if (t > 3) { state = 'gone'; t = 0; b.solid = false; m.visible = false; b.vy = 0; }
        } else if (state === 'gone' && t > 2.5) {
          state = 'idle'; b.y = y; b.solid = true; m.visible = true; m.position.set(x, y, z); m.scale.setScalar(0.1);
          G.fx.sparkle(x, y, z, 0xffffff);
        }
        if (m.scale.x < 1) m.scale.setScalar(Math.min(1, m.scale.x + dt * 3));
      },
    });
  };

  // ---------- switch (floor button) ----------
  G.floorSwitch = function (scene, x, z, color, onPress, opts) {
    opts = opts || {};
    const y0 = P.ground(x, z, 999, 0, 0).h;
    const base = new THREE.Mesh(new THREE.CylinderGeometry(1.3, 1.5, 1.3, 40), G.texMat('metal', 2, 1));
    base.position.set(x, y0 - 0.35, z); base.userData.static = true; scene.add(base);
    const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.95, 1.0, 0.4, 40), G.mat(color, { emissive: color, emissiveIntensity: 0.25 }));
    cap.position.set(x, y0 + 0.5, z); scene.add(cap);
    const b = P.addBox({ x, y: y0 + 0.35, z, hx: 1.0, hy: 0.35, hz: 1.0, mesh: cap, tag: 'switch' });
    let pressed = false, timer = 0;
    const sw = reg({
      kind: 'switch', box: b, pressed: false,
      press() {
        if (pressed) return;
        pressed = sw.pressed = true;
        cap.position.y = y0 + 0.25; b.y = y0 + 0.1;
        G.audio.sfx.switchOn(); G.fx.sparkle(x, y0 + 0.6, z, color);
        if (opts.timed) timer = opts.timed;
        onPress && onPress();
      },
      update(dt) {
        const pl = G.player;
        if (!pressed && pl.grounded && pl.groundBox === b) sw.press();
        if (pressed && opts.timed) {
          timer -= dt;
          const prev = Math.floor((timer + dt) * 2), cur = Math.floor(timer * 2);
          if (cur !== prev && timer > 0) G.audio.sfx.tick(timer < 3);
          if (timer <= 0) { pressed = sw.pressed = false; cap.position.y = y0 + 0.5; b.y = y0 + 0.35; opts.onRelease && opts.onRelease(); }
        }
      },
    });
    G.onWorld('groundpound', (px, pz) => { if (Math.hypot(px - x, pz - z) < 2) sw.press(); });
    return sw;
  };

  // ---------- gate (portcullis that sinks into the ground) ----------
  G.gate = function (scene, x, y, z, w, h, yaw) {
    const grp = new THREE.Group();
    const barMat = G.texMat('metal', 1, 3);
    for (let i = 0; i < 6; i++) {
      const bar = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.16, h, 16), barMat);
      bar.position.x = -w / 2 + 0.3 + (i * (w - 0.6)) / 5; grp.add(bar);
    }
    for (let j = 0; j < 3; j++) {
      const cross = new THREE.Mesh(G.bevelBox(w, 0.3, 0.35, 0.08), barMat);
      cross.position.y = -h / 2 + 0.6 + (j * (h - 1.2)) / 2; grp.add(cross);
    }
    grp.position.set(x, y, z); grp.rotation.y = yaw || 0; scene.add(grp);
    const b = P.addBox({ x, y, z, hx: w / 2, hy: h / 2, hz: 0.3, yaw: yaw || 0, tag: 'gate' });
    let opening = false, t = 0;
    return reg({
      kind: 'gate', box: b, open() { if (!opening) { opening = true; G.audio.sfx.gate(); G.camera.shake(0.4); } },
      update(dt) {
        if (!opening || t > 1.6) return;
        t += dt;
        grp.position.y = y - (t / 1.6) * (h + 0.2);
        b.y = grp.position.y;
        if (t > 1.6) b.solid = false;
      },
    });
  };

  // ---------- breakable crate (punch it, pound it, or pick it up and throw it) ----------
  G.crate = function (scene, x, z, size, reward) {
    const y0 = P.ground(x, z, 999, 0, 0).h;
    const m = new THREE.Mesh(G.bevelBox(size, size, size, 0.07), G.texMat('crate', 1, 1));
    m.position.set(x, y0 + size / 2, z); m.castShadow = true; m.receiveShadow = true; scene.add(m);
    let b = P.addBox({ x, y: y0 + size / 2, z, hx: size / 2, hy: size / 2, hz: size / 2, mesh: m, tag: 'crate' });
    let broken = false, held = false, flyingNow = false;
    const c = reg({
      kind: 'crate', box: b,
      smash() {
        if (broken) return;
        broken = true; if (b) P.remove(b); scene.remove(m);
        const p = m.position;
        G.audio.sfx.breakBox();
        G.fx.burst(p.x, p.y, p.z, 14, 0xc98a45, 7, 0.35, 0.9, -25);
        if (reward === 'shard') G.collect.shard(p.x, p.y + 0.8, p.z, 'crate');
        else G.collect.drop(p.x, p.y + 0.2, p.z, reward || 3);
      },
      update() {
        if (broken || held || flyingNow) return;
        const pl = G.player;
        if (pl.attack && pl.attackOverlap(m.position.x, m.position.y, m.position.z, size * 0.6)) c.smash();
      },
    });
    G.onWorld('groundpound', (px, pz) => {
      const p = m.position;
      if (!broken && !held && !flyingNow && Math.abs(px - p.x) < size / 2 + 0.4 && Math.abs(pz - p.z) < size / 2 + 0.4 && Math.abs(G.player.pos.y - (p.y + size / 2)) < 0.6) c.smash();
    });
    G.carryables.push({
      reach: size * 0.5 + 1.25, heavy: size > 1.2, lift: size * 0.5, get pos() { return m.position; },
      canPick: () => !broken && !held && !flyingNow,
      pick() { held = true; if (b) { P.remove(b); b = null; } G.audio.sfx.grab(); },
      hold(px, py, pz, face) { m.position.set(px, py + size * 0.5, pz); m.rotation.set(0, face, 0); },
      drop(px, py, pz) {
        held = false;
        const gy = P.ground(px, pz, py + 1, 1.5, 0).h;
        m.position.set(px, gy + size / 2, pz); m.rotation.set(0, m.rotation.y, 0);
        b = P.addBox({ x: px, y: gy + size / 2, z: pz, hx: size / 2, hy: size / 2, hz: size / 2, mesh: m, tag: 'crate', dynamic: true });
      },
      throw(vel) { held = false; flyingNow = true; G.fly(m, vel, size * 0.55, () => c.smash(), { spin: 5 }); },
    });
    return c;
  };

  // ---------- clay pot (break it for sparks; can be carried and thrown) ----------
  let potGeo = null;
  G.pot = function (scene, x, z, reward, tint) {
    const y0 = P.ground(x, z, 999, 0, 0).h;
    if (!potGeo) {
      const pts = [[0.001, 0], [0.2, 0.01], [0.31, 0.12], [0.35, 0.3], [0.3, 0.5], [0.19, 0.62], [0.16, 0.7], [0.21, 0.76], [0.19, 0.79], [0.13, 0.77]].map(([a, bb]) => new THREE.Vector2(a, bb));
      potGeo = new THREE.LatheGeometry(new THREE.SplineCurve(pts).getPoints(28), 40);
      potGeo.computeVertexNormals();
    }
    const grp = new THREE.Group(); grp.position.set(x, y0 - 0.02, z); scene.add(grp);
    const body = new THREE.Mesh(potGeo, G.mat(tint || 0xc8703a, { roughness: 0.75 })); grp.add(body);
    const band = new THREE.Mesh(new THREE.TorusGeometry(0.335, 0.025, 8, 40).rotateX(Math.PI / 2), G.mat(0xf2e2c4, { roughness: 0.7 })); band.position.y = 0.36; grp.add(band);
    grp.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
    let col = P.addCyl({ x, z, r: 0.38, y0: y0 - 0.2, y1: y0 + 0.78, top: true, tag: 'pot' });
    let broken = false, held = false, flyingNow = false;
    const pot = reg({
      kind: 'pot',
      smash() {
        if (broken) return;
        broken = true; if (col) P.remove(col); scene.remove(grp);
        const p = grp.position;
        G.audio.sfx.potBreak();
        G.fx.burst(p.x, p.y + 0.4, p.z, 12, tint || 0xc8703a, 6, 0.22, 0.8, -25);
        G.collect.drop(p.x, p.y + 0.5, p.z, reward == null ? 2 : reward);
      },
      update() {
        if (broken || held || flyingNow) return;
        const pl = G.player, p = grp.position;
        if (pl.attack && pl.attackOverlap(p.x, p.y + 0.4, p.z, 0.5)) pot.smash();
      },
    });
    G.onWorld('groundpound', (px, pz) => { const p = grp.position; if (!broken && !held && !flyingNow && Math.hypot(px - p.x, pz - p.z) < 2.2) pot.smash(); });
    G.carryables.push({
      reach: 1.35, heavy: false, lift: 0, get pos() { return grp.position; },
      canPick: () => !broken && !held && !flyingNow,
      pick() { held = true; if (col) { P.remove(col); col = null; } G.audio.sfx.grab(); },
      hold(px, py, pz, face) { grp.position.set(px, py - 0.05, pz); grp.rotation.set(0, face, 0); },
      drop(px, py, pz) {
        held = false;
        const gy = P.ground(px, pz, py + 1, 1.5, 0).h;
        grp.position.set(px, gy - 0.02, pz); grp.rotation.set(0, 0, 0);
        col = P.addCyl({ x: px, z: pz, r: 0.38, y0: gy - 0.2, y1: gy + 0.78, top: true, tag: 'pot', dynamic: true });
      },
      throw(vel) { held = false; flyingNow = true; G.fly(grp, vel, 0.4, () => pot.smash(), { spin: 9 }); },
    });
    return pot;
  };

  // ---------- throwable rock (the Crag King's weakness) ----------
  let rockGeo = null;
  G.throwRock = function (scene, x, z, opts) {
    opts = opts || {};
    const sz = opts.size || 0.6;
    if (!rockGeo) { rockGeo = G.decor.blob(1, 6, 4.4, 0.22, 0.75); G.decor.tint(rockGeo, 0x8a7f72); }
    const y0 = opts.y != null ? opts.y : P.ground(x, z, 999, 0, 0).h;
    const m = new THREE.Mesh(rockGeo, G.decor.rockMaterial());
    m.scale.setScalar(sz); m.position.set(x, y0 + sz * 0.55, z); m.rotation.y = Math.random() * 6;
    m.castShadow = true; m.receiveShadow = true; scene.add(m);
    const addCol = (cx, cy, cz) => P.addCyl({ x: cx, z: cz, r: sz * 0.95, y0: cy - 0.3, y1: cy + sz * 1.05, top: true, tag: 'rock', dynamic: true });
    let col = addCol(x, y0, z), state = 'idle', life = opts.life || Infinity;
    const handle = {
      reach: sz + 1.35, heavy: false, lift: sz * 0.6, isRock: true, get pos() { return m.position; },
      canPick: () => state === 'idle',
      pick() { state = 'held'; if (col) { P.remove(col); col = null; } G.audio.sfx.grab(); },
      hold(px, py, pz, face) { m.position.set(px, py + sz * 0.75, pz); m.rotation.set(0, face, 0); },
      drop(px, py, pz) {
        state = 'idle';
        const gy = P.ground(px, pz, py + 1, 1.5, 0).h;
        m.position.set(px, gy + sz * 0.55, pz); col = addCol(px, gy, pz);
      },
      throw(vel) {
        state = 'flying';
        G.fly(m, vel, sz * 0.9, (hx, hy, hz) => {
          G.fx.burst(hx, hy + 0.3, hz, 12, 0x8a7f72, 7, 0.3, 0.8, -25);
          G.audio.sfx.breakBox();
          remove();
        }, { spin: 6 });
      },
    };
    function remove() {
      state = 'gone'; scene.remove(m);
      if (col) { P.remove(col); col = null; }
      const i = G.carryables.indexOf(handle); if (i >= 0) G.carryables.splice(i, 1);
      if (opts.onGone) opts.onGone();
    }
    G.carryables.push(handle);
    const o = reg({
      kind: 'rock',
      update(dt) {
        if (state !== 'idle') return;
        life -= dt;
        if (life < 2) m.visible = Math.floor(life * 8) % 2 === 0;
        if (life <= 0) { G.fx.burst(m.position.x, m.position.y, m.position.z, 6, 0x8a7f72, 3, 0.25, 0.5, -10); remove(); }
      },
    });
    o.handle = handle; o.isAlive = () => state !== 'gone'; o.destroy = remove;
    return o;
  };

  // ---------- climbable pole (grab it with E, climb, balance on top) ----------
  G.pole = function (scene, x, z, h) {
    const y0 = G.decor.anchor(x, z, 0.3, 0.3);
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.2, h + 0.3, 20), G.texMat('wood', 1, 6, 0xd8a870));
    pole.position.set(x, y0 + (h + 0.3) / 2 - 0.3, z); pole.userData.static = true; scene.add(pole);
    const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.34, 0.3, 0.14, 24), G.mat(0xffc93a, { metalness: 0.7, roughness: 0.35 }));
    cap.position.set(x, y0 + h + 0.07, z); cap.userData.static = true; scene.add(cap);
    [0.25, 0.5, 0.75].forEach((f) => { const r = new THREE.Mesh(new THREE.TorusGeometry(0.2, 0.035, 8, 24).rotateX(Math.PI / 2), G.mat(0x6a4020)); r.position.set(x, y0 + h * f, z); r.userData.static = true; scene.add(r); });
    P.addCyl({ x, z, r: 0.3, y0: y0 - 0.5, y1: y0 + h + 0.14, top: true, tag: 'pole', climb: { r: 0.18, top: y0 + h + 0.14, base: y0 } });
  };

  // ---------- push block ----------
  G.pushBlock = function (scene, x, z, size) {
    const y0 = P.ground(x, z, 999, 0, 0).h;
    const m = new THREE.Mesh(G.bevelBox(size, size, size, 0.18), G.texMat('stone', 2, 2, 0xd8d0ff));
    m.position.set(x, y0 + size / 2, z); scene.add(m);
    const face = new THREE.Mesh(new THREE.CircleGeometry(size * 0.25, 5), G.mat(0x5a4fcf));
    face.position.set(0, 0, size / 2 + 0.01); m.add(face);
    const face2 = face.clone(); face2.position.z = -size / 2 - 0.01; face2.rotation.y = Math.PI; m.add(face2);
    const b = P.addBox({ x, y: y0 + size / 2, z, hx: size / 2, hy: size / 2, hz: size / 2, mesh: m, tag: 'push', dynamic: true });
    let pushT = 0, lastPush = 0;
    const h = size / 2;
    function groundUnder(nx, nz) {
      let gh = -99;
      for (const [ox, oz] of [[0, 0], [h * 0.9, h * 0.9], [-h * 0.9, h * 0.9], [h * 0.9, -h * 0.9], [-h * 0.9, -h * 0.9]]) gh = Math.max(gh, G.terrain.heightAt(nx + ox, nz + oz));
      return gh;
    }
    b.onPush = function (pl, dt) {
      const I = G.input;
      if (I.moveMag < 0.5) return;
      // player must be facing into the block
      const fx = Math.sin(pl.face), fz = Math.cos(pl.face);
      if (fx * -P.wallN.x + fz * -P.wallN.z < 0.75) return;
      lastPush = 0;
      pushT += dt;
      if (pushT < 0.25) return;
      let dx = -P.wallN.x, dz = -P.wallN.z;
      if (Math.abs(dx) > Math.abs(dz)) { dx = Math.sign(dx); dz = 0; } else { dz = Math.sign(dz); dx = 0; }
      const step = 2.4 * dt, nx = b.x + dx * step, nz = b.z + dz * step;
      const gh = groundUnder(nx, nz), cur = groundUnder(b.x, b.z);
      if (gh - cur > Math.max(0.03, step * 0.6)) return; // gentle slopes only: never up a cliff
      const near = P.near(nx, nz, 6);
      for (let k = 0; k < near.length; k++) {
        const o = near[k];
        if (o === b || !o.solid || o.isCyl) continue;
        if (Math.abs(o.x - nx) < o.hx + h - 0.05 && Math.abs(o.z - nz) < o.hz + h - 0.05 && o.y + o.hy > b.y - h + 0.3 && o.y - o.hy < b.y + h) return;
      }
      b.x = nx; b.z = nz;
      b.y = Math.max(gh + h, Math.min(b.y, gh + h + 0.3));
      m.position.set(b.x, b.y, b.z);
      if (Math.random() < 0.15) G.fx.dust(b.x - dx * h, b.y - h, b.z - dz * h, 1);
      pl.pushing = 0.1;
    };
    return reg({
      kind: 'push', box: b,
      update(dt) {
        lastPush += dt; if (lastPush > 0.1) pushT = 0;
        // settle onto the ground if unsupported
        const gh = groundUnder(b.x, b.z);
        if (b.y - h > gh + 0.01) { b.y = Math.max(gh + h, b.y - 12 * dt); m.position.y = b.y; }
      },
    });
  };

  // ---------- spinning spiked bar hazard ----------
  G.spinner = function (scene, x, y, z, len, speed) {
    const grp = new THREE.Group(); grp.position.set(x, y, z); scene.add(grp);
    const post = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.7, 1.6, 32), G.texMat('metal', 1, 1));
    post.position.y = 0.2; grp.add(post);
    const rot = new THREE.Group(); rot.position.y = 0.9; grp.add(rot);
    const bar = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.18, len * 2, 20).rotateZ(Math.PI / 2), G.mat(0x444a55, { metalness: 0.7, roughness: 0.35 }));
    rot.add(bar);
    const spikeMat = G.mat(0xff5a2a, { emissive: 0x802000 });
    for (let i = -3; i <= 3; i++) {
      if (i === 0) continue;
      const ball = new THREE.Mesh(new THREE.IcosahedronGeometry(0.45, 1), spikeMat);
      ball.position.x = (i / 3) * len; rot.add(ball);
    }
    P.addCyl({ x, z, r: 0.65, y0: y - 0.6, y1: y + 1.0 });
    let ang = 0;
    return reg({
      kind: 'spinner',
      update(dt) {
        ang += speed * dt; rot.rotation.y = ang;
        const pl = G.player;
        const py = pl.pos.y;
        if (py > y + 1.7 || py + 1.7 < y + 0.4) return;
        const ex = Math.cos(ang) * len, ez = -Math.sin(ang) * len;
        const d = U.distPointSeg2D(pl.pos.x, pl.pos.z, x - ex, z - ez, x + ex, z + ez);
        if (d < 0.95 && Math.hypot(pl.pos.x - x, pl.pos.z - z) > 0.4) {
          // knock away perpendicular to the bar, in the direction it sweeps
          const px = pl.pos.x - x, pz = pl.pos.z - z;
          const side = Math.sign(px * -Math.sin(ang) - pz * Math.cos(ang)) || 1;
          pl.hurt(1, pl.pos.x + Math.sin(ang) * side, pl.pos.z + Math.cos(ang) * side, 11);
        }
      },
    });
  };

  // ---------- spring pad ----------
  G.spring = function (scene, x, z, power) {
    const y0 = P.ground(x, z, 999, 0, 0).h;
    const base = new THREE.Mesh(new THREE.CylinderGeometry(1.2, 1.3, 1.4, 40), G.mat(0x3a3f4a));
    base.position.set(x, y0 - 0.3, z); base.userData.static = true; scene.add(base);
    const coil = new THREE.Mesh(new THREE.TorusKnotGeometry(0.55, 0.07, 160, 10, 1, 6).rotateX(Math.PI / 2).scale(1, 1, 0.9), G.mat(0xc0c8d0, { metalness: 0.9, roughness: 0.3 }));
    coil.position.set(x, y0 + 0.6, z); scene.add(coil);
    const top = new THREE.Mesh(new THREE.CylinderGeometry(1.2, 1.2, 0.25, 40), G.mat(0x3fd06a, { emissive: 0x0b4a1a }));
    top.position.set(x, y0 + 1.0, z); scene.add(top);
    const b = P.addBox({ x, y: y0 + 0.55, z, hx: 1.05, hy: 0.55, hz: 1.05, tag: 'spring' });
    let t = 1;
    return reg({
      kind: 'spring',
      update(dt) {
        t += dt;
        const pl = G.player;
        if (pl.grounded && pl.groundBox === b && pl.state !== 'hurt') {
          const f = [Math.sin(pl.face), Math.cos(pl.face)], s = Math.min(6, Math.hypot(pl.vel.x, pl.vel.z));
          pl.launch(f[0] * s, power, f[1] * s, 'spring');
          G.audio.sfx.spring(); t = 0;
        }
        const k = t < 0.3 ? Math.sin((t / 0.3) * Math.PI) : 0;
        top.position.y = y0 + 1.0 + k * 0.6; coil.scale.y = 1 + k;
        coil.position.y = y0 + 0.6 + k * 0.3;
      },
    });
  };

  // ---------- cannon ----------
  G.cannon = function (scene, x, z, opts) {
    const y0 = P.ground(x, z, 999, 0, 0).h;
    const grp = new THREE.Group(); grp.position.set(x, y0, z); scene.add(grp);
    const pit = new THREE.Mesh(new THREE.CylinderGeometry(2.0, 2.3, 2.4, 40), G.texMat('stone', 3, 1));
    pit.position.y = -0.4; grp.add(pit);
    const lid = new THREE.Mesh(new THREE.CylinderGeometry(1.4, 1.4, 0.2, 40), G.texMat('metal', 2, 2));
    lid.position.y = 0.85; grp.add(lid);
    const yawG = new THREE.Group(); yawG.position.y = 0.7; grp.add(yawG);
    const pitchG = new THREE.Group(); yawG.add(pitchG);
    const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.75, 0.95, 3.2, 40, 4), G.mat(0x2a2d36, { metalness: 0.75, roughness: 0.35 }));
    barrel.rotation.x = Math.PI / 2; barrel.position.z = 1.0; pitchG.add(barrel);
    const rim = new THREE.Mesh(new THREE.TorusGeometry(0.8, 0.14, 12, 40), G.mat(0xd8b040, { metalness: 0.9, roughness: 0.3 }));
    rim.position.z = 2.6; pitchG.add(rim);
    yawG.visible = false;
    const b = P.addBox({ x, y: y0 + 0.4, z, hx: 2.0, hy: 0.4, hz: 2.0, tag: 'cannonbase' });
    // trajectory preview dots
    const dots = [];
    for (let i = 0; i < 18; i++) {
      const d = new THREE.Mesh(new THREE.SphereGeometry(0.22, 6, 4), G.mat(0xffffff, { emissive: 0xffffff }));
      d.visible = false; scene.add(d); dots.push(d);
    }
    const V = 62, GS = 0.55;
    let open = !!opts.open, inside = false, aimYaw = 0, aimPitch = 0.65, cooldown = 0;
    const cn = reg({
      kind: 'cannon',
      open() {
        if (open) return; open = true;
        G.audio.sfx.gate(); G.fx.sparkle(x, y0 + 1, z, 0xffffff);
        G.hud.toast('The cannon hatch opened!');
      },
      update(dt) {
        const pl = G.player, I = G.input;
        cooldown -= dt;
        lid.visible = !open;
        yawG.visible = open;
        if (!open) return;
        if (!inside) {
          yawG.rotation.y = aimYaw; pitchG.rotation.x = -aimPitch;
          if (cooldown <= 0 && pl.state !== 'dead' && Math.hypot(pl.pos.x - x, pl.pos.z - z) < 1.3 && pl.pos.y < y0 + 1.6 && pl.pos.y > y0 - 0.5) {
            inside = true;
            pl.setState('cannon'); pl.vel.set(0, 0, 0);
            pl.pos.set(x, y0 + 0.2, z);
            aimYaw = G.camera.yaw + Math.PI; aimPitch = 0.65;
            G.audio.sfx.cannonIn();
            G.hud.toast('Aim: move stick/WASD · Fire: Jump');
          }
          return;
        }
        // aiming
        aimYaw -= I.moveX * 1.1 * dt + I.camDX;
        aimPitch = U.clamp(aimPitch + I.moveY * 0.8 * dt - I.camDY, 0.1, 1.35);
        yawG.rotation.y = aimYaw; pitchG.rotation.x = -aimPitch;
        const dir = new THREE.Vector3(Math.sin(aimYaw) * Math.cos(aimPitch), Math.sin(aimPitch), Math.cos(aimYaw) * Math.cos(aimPitch));
        const tip = new THREE.Vector3(x, y0 + 0.7, z).addScaledVector(dir, 2.8);
        G.camera.mode = 'fixed';
        G.camera.fixedPos = new THREE.Vector3(x - dir.x * 7, y0 + 3.2 - dir.y * 2, z - dir.z * 7);
        G.camera.fixedLook = tip.clone().addScaledVector(dir, 20);
        // preview arc
        dots.forEach((d, i) => {
          const tt = (i + 1) * 0.12;
          d.position.set(tip.x + dir.x * V * tt, tip.y + dir.y * V * tt + 0.5 * P.GRAVITY * GS * tt * tt, tip.z + dir.z * V * tt);
          d.visible = true;
        });
        if (I.jump || I.punch) {
          inside = false; cooldown = 1.2;
          dots.forEach((d) => (d.visible = false));
          pl.pos.copy(tip);
          pl.launch(dir.x * V, dir.y * V, dir.z * V, 'shot');
          pl.jumpBuf = 0;
          G.camera.mode = 'follow';
          G.camera.snapBehind(aimYaw);
          G.audio.sfx.cannon(); G.camera.shake(0.4);
          G.fx.burst(tip.x, tip.y, tip.z, 16, 0xdddddd, 8, 0.5, 0.8, 2);
        }
      },
    });
    if (opts.switchAt) G.floorSwitch(scene, opts.switchAt[0], opts.switchAt[1], 0xff4040, () => cn.open());
    return cn;
  };

  // ---------- checkpoint flag ----------
  G.checkpoint = function (scene, x, z, face, name) {
    const y0 = P.ground(x, z, 999, 0, 0).h;
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.12, 4.8, 20), G.mat(0xe8e8e8, { metalness: 0.6, roughness: 0.35 }));
    pole.position.set(x, y0 + 1.6, z); pole.userData.static = true; scene.add(pole);
    const ball = new THREE.Mesh(new THREE.SphereGeometry(0.22, 24, 16), G.mat(0xffd21f, { metalness: 0.8, roughness: 0.3 }));
    ball.position.set(x, y0 + 4.1, z); ball.userData.static = true; scene.add(ball);
    const flag = new THREE.Mesh(new THREE.PlaneGeometry(1.3, 0.8, 12, 4), G.mat(0x9aa0a8, { side: THREE.DoubleSide }));
    flag.position.set(x + 0.7, y0 + 1.0, z); scene.add(flag);
    P.addCyl({ x, z, r: 0.18, y0, y1: y0 + 4 });
    let active = false, t = 0;
    return reg({
      kind: 'checkpoint',
      update(dt) {
        const pl = G.player;
        if (active) { t = Math.min(1, t + dt * 1.5); flag.position.y = y0 + 1.0 + t * 2.6; flag.rotation.y = Math.sin(pl.time * 4) * 0.2; return; }
        if (Math.hypot(pl.pos.x - x, pl.pos.z - z) < 2.8 && Math.abs(pl.pos.y - y0) < 3 && pl.state !== 'dead') {
          active = true;
          flag.material = G.mat(0xff3b30, { emissive: 0x5a0000, side: THREE.DoubleSide });
          G.game.checkpoint = { x, y: y0 + 0.5, z, face };
          G.audio.sfx.checkpoint();
          G.hud.toast('Checkpoint: ' + name);
          pl.heal(8);
        }
      },
    });
  };

  // ---------- signpost ----------
  G.sign = function (scene, x, z, yaw, text) {
    const y0 = P.ground(x, z, 999, 0, 0).h;
    const post = new THREE.Mesh(G.bevelBox(0.25, 2.4, 0.25, 0.05), G.texMat('wood', 1, 1));
    post.position.set(x, y0 + 0.4, z); post.userData.static = true; scene.add(post);
    const board = new THREE.Mesh(G.bevelBox(1.8, 1.1, 0.18, 0.06), G.texMat('wood', 1, 1));
    board.position.set(x, y0 + 1.8, z); board.rotation.y = yaw; board.userData.static = true; scene.add(board);
    const mark = new THREE.Mesh(G.bevelBox(1.2, 0.12, 0.2, 0.04), G.mat(0x5a3418));
    mark.position.set(x, y0 + 1.95, z); mark.rotation.y = yaw; mark.userData.static = true; scene.add(mark);
    const mark2 = mark.clone(); mark2.position.y = y0 + 1.65; mark2.scale.x = 0.7; mark2.userData.static = true; scene.add(mark2);
    P.addCyl({ x, z, r: 0.4, y0, y1: y0 + 2.4, top: false });
    return reg({
      kind: 'sign',
      update() {
        const pl = G.player;
        if (Math.hypot(pl.pos.x - x, pl.pos.z - z) < 3.4 && Math.abs(pl.pos.y - y0) < 3) G.hud.showSign(text);
      },
    });
  };

  // ---------- timed blocks (appear when a switch is pressed) ----------
  G.timedBlocks = function (scene, list, color) {
    const items = list.map(([x, y, z, w, h, d]) => {
      const m = new THREE.Mesh(G.bevelBox(w, h, d, 0.1), G.mat(color, { transparent: true, opacity: 0.35, emissive: color, emissiveIntensity: 0.2 }));
      m.position.set(x, y, z); scene.add(m);
      const b = P.addBox({ x, y, z, hx: w / 2, hy: h / 2, hz: d / 2, solid: false, tag: 'timed' });
      return { m, b };
    });
    let timer = 0;
    const solidMat = G.mat(color, { emissive: color, emissiveIntensity: 0.25 });
    const ghostMat = items[0].m.material;
    return reg({
      kind: 'timed',
      activate(d) { timer = d; items.forEach((it) => { it.b.solid = true; it.m.material = solidMat; }); },
      update(dt) {
        if (timer <= 0) return;
        timer -= dt;
        const blink = timer < 3 && Math.floor(timer * 8) % 2 === 0;
        items.forEach((it) => { it.m.material = blink ? ghostMat : solidMat; });
        if (timer <= 0) items.forEach((it) => { it.b.solid = false; it.m.material = ghostMat; });
      },
    });
  };

  // ---------- treasure chest (opens when touched, even underwater) ----------
  G.chest = function (scene, x, z, yaw, onOpen, yBase) {
    const y0 = yBase != null ? yBase : P.ground(x, z, 999, 0, 0).h;
    const grp = new THREE.Group(); grp.position.set(x, y0, z); grp.rotation.y = yaw || 0; scene.add(grp);
    const wood = G.texMat('wood', 1, 1, 0xc08850), gold = G.mat(0xffc93a, { metalness: 0.9, roughness: 0.3 });
    const base = new THREE.Mesh(G.bevelBox(2.2, 1.2, 1.4, 0.08), wood); base.position.y = 0.6; grp.add(base);
    [-0.85, 0.85].forEach((bx) => { const band = new THREE.Mesh(G.bevelBox(0.18, 1.25, 1.46, 0.04), gold); band.position.set(bx, 0.6, 0); grp.add(band); });
    const hinge = new THREE.Group(); hinge.position.set(0, 1.2, -0.7); grp.add(hinge);
    const lid = new THREE.Mesh(new THREE.CylinderGeometry(0.7, 0.7, 2.2, 24, 1, false, 0, Math.PI).rotateZ(Math.PI / 2), wood);
    lid.position.set(0, 0, 0.7); hinge.add(lid);
    const lock = new THREE.Mesh(G.bevelBox(0.4, 0.5, 0.15, 0.04), gold); lock.position.set(0, 1.15, 0.72); grp.add(lock);
    const glow = new THREE.PointLight(0xffc860, 0, 8); glow.position.set(0, 1.6, 0); grp.add(glow);
    P.addBox({ x, y: y0 + 0.6, z, hx: 1.1, hy: 0.6, hz: 0.7, yaw: yaw || 0, tag: 'chest' });
    let open = false, t = 0;
    return reg({
      kind: 'chest',
      update(dt) {
        const pl = G.player;
        if (!open) {
          if (Math.hypot(pl.pos.x - x, pl.pos.z - z) < 2.3 && pl.pos.y > y0 - 1.2 && pl.pos.y < y0 + 2.6) {
            open = true; t = 0;
            G.audio.sfx.chest(); G.fx.sparkle(x, y0 + 1.6, z, 0xffe066);
            if (G.water) G.water.bubbles(x, y0 + 1.2, z, 10);
            onOpen && onOpen(x, y0, z);
          }
          return;
        }
        t += dt;
        hinge.rotation.x = -Math.min(1.9, t * 3);
        glow.intensity = Math.max(0, 3 - t) * 2;
      },
    });
  };

  // ---------- bubble vent: a column of bubbles that refills air ----------
  G.bubbleVent = function (scene, x, z) {
    const y0 = G.terrain.heightAt(x, z);
    const rock = new THREE.Mesh(G.decor.blob(1.1, 4, 7.7, 0.25, 0.6), G.decor.rockMaterial());
    G.decor.tint(rock.geometry, 0x6a7f86);
    rock.position.set(x, y0 - 0.2, z); rock.userData.static = true; scene.add(rock);
    let t = 0;
    return reg({
      kind: 'vent',
      update(dt) {
        const pl = G.player;
        const near = Math.abs(pl.pos.x - x) + Math.abs(pl.pos.z - z) < 70;
        t -= dt;
        if (near && t <= 0) { t = 0.18; if (G.water) G.water.bubbles(x + (Math.random() - 0.5) * 0.6, y0 + 0.6, z + (Math.random() - 0.5) * 0.6, 1); }
        if (pl.state === 'uw' && Math.hypot(pl.pos.x - x, pl.pos.z - z) < 1.8 && pl.pos.y > y0 - 1) {
          if (pl.air < 1 && Math.random() < dt * 6) G.audio.sfx.bubble();
          pl.air = Math.min(1, pl.air + dt * 0.6);
        }
      },
    });
  };

  G.updateObjects = function (dt, time) {
    for (let i = 0; i < OBJ.length; i++) OBJ[i].update(dt, time);
    updateFlying(dt);
  };
})(window.G);

// boss.js — the Crag King, a stone golem guarding the summit.
// Attack patterns: sweeping swipe, leaping slam with shockwaves, lobbed rock volleys.
// Weakness: rocks. Pick up the boulders around the arena (or the ones he lobs at you) and throw them at
// him: five solid hits topple him. Punches and stomps just clang off his stone hide.
(function (G) {
  'use strict';
  const U = G.U, P = G.physics;
  const V3 = THREE.Vector3;

  const B = (G.boss = {
    pos: new V3(), vel: new V3(), face: 0, state: 'dormant', t: 0, hp: 5, maxHp: 5, rockSpots: [], looseRocks: [],
    R: 2.3, H: 6.2, waves: [], specialT: 0, lastAttack: '',
  });

  function stone(c) { return G.mat(c); }

  B.init = function (scene) {
    const MT = G.terrain.mtn;
    B.center = new V3(MT.x, MT.Hs, MT.z);
    B.pos.set(MT.x, MT.Hs, MT.z - 8);
    B.face = 0;
    const root = (B.root = new THREE.Group());
    scene.add(root);
    // shockwave ring: one shared geometry and a template material (a hidden instance lives in the scene so
    // its shader is built during the loading warm-up instead of on the first stomp)
    B.waveGeo = new THREE.TorusGeometry(1, 0.35, 12, 128);
    B.waveMat = new THREE.MeshStandardMaterial({ color: 0xffe0a0, emissive: 0xff7a20, emissiveIntensity: 2.2, transparent: true, opacity: 0.85 });
    const waveTemplate = new THREE.Mesh(B.waveGeo, B.waveMat);
    waveTemplate.visible = false; waveTemplate.userData.noShadow = true; waveTemplate.position.set(MT.x, -50, MT.z);
    scene.add(waveTemplate);
    const body = (B.body = new THREE.Group()); root.add(body);
    const rock = G.mat(0x736a5d, { roughness: 0.92 }), dark = G.mat(0x564f46, { roughness: 0.95 }), moss = G.mat(0x4f8f30, { roughness: 0.9 });
    // chiselled stone: displaced, flat-shaded (faceted) and mottled when baked
    const blob = (r, d, seed, rough, sq) => G.decor.blob(r, d, seed, (rough || 0.2) * 1.5, sq);
    const stoneMesh = (geo, m) => { const o = new THREE.Mesh(geo, m); o.userData.flat = true; o.userData.rocky = true; return o; };
    B.legs = [-1, 1].map((s) => {
      const g = new THREE.Group(); g.position.set(0.95 * s, 2.0, 0); body.add(g);
      const leg = new THREE.Mesh(G.bevelBox(1.2, 2.0, 1.3, 0.3), dark); leg.position.y = -1.0; g.add(leg);
      const knee = stoneMesh(blob(0.55, 9, 3.1 + s, 0.2, 1), rock); knee.position.set(0, -0.9, 0.55); g.add(knee);
      const foot = new THREE.Mesh(G.bevelBox(1.5, 0.6, 1.9, 0.22), rock); foot.position.set(0, -1.9, 0.2); g.add(foot);
      for (let t = -1; t <= 1; t++) { const toe = stoneMesh(blob(0.22, 4, 5 + t, 0.2, 1), dark); toe.position.set(t * 0.45, -1.95, 1.15); g.add(toe); }
      return g;
    });
    const torso = (B.torso = new THREE.Group()); torso.position.y = 2.1; body.add(torso);
    const chest = stoneMesh(blob(2.0, 16, 1.7, 0.14, 1), rock);
    chest.scale.set(1.25, 1.05, 0.95); chest.position.y = 1.5; torso.add(chest);
    const mossM = stoneMesh(blob(1.0, 10, 2.9, 0.3, 1), moss);
    mossM.scale.set(1.6, 0.5, 1.3); mossM.position.set(0, 2.6, -0.2); torso.add(mossM);
    const belt = new THREE.Mesh(G.bevelBox(3.2, 0.5, 2.2, 0.2), G.mat(0xa0522d, { roughness: 0.8 })); belt.position.y = 0.45; torso.add(belt);
    const buckleB = new THREE.Mesh(new THREE.TorusGeometry(0.28, 0.08, 12, 32), G.mat(0xd8b040, { metalness: 0.85, roughness: 0.35 }));
    buckleB.position.set(0, 0.45, 1.12); torso.add(buckleB);
    for (let i = 0; i < 6; i++) { // rocky plates on the shoulders and back
      const a = (i / 6) * Math.PI * 2;
      const pl = stoneMesh(blob(0.45, 6, 7 + i, 0.25, 1), dark);
      pl.position.set(Math.cos(a) * 1.9, 2.3 + Math.sin(i * 1.7) * 0.3, Math.sin(a) * 1.1 - 0.2); torso.add(pl);
    }
    const head = (B.head = new THREE.Group()); head.position.set(0, 3.25, 0.4); torso.add(head);
    const skull = stoneMesh(G.decor.blob(1.0, 11, 31, 0.12, 1).scale(0.95, 0.72, 0.82), rock); head.add(skull);
    const jaw = new THREE.Mesh(G.bevelBox(1.6, 0.4, 1.2, 0.15), dark); jaw.position.set(0, -0.7, 0.2); head.add(jaw);
    for (let i = -2; i <= 2; i++) { const tooth = new THREE.Mesh(new THREE.ConeGeometry(0.08, 0.22, 10), G.mat(0xe8e0d0, { roughness: 0.5 })); tooth.position.set(i * 0.28, -0.42, 0.78); head.add(tooth); }
    B.eyes = [-1, 1].map((s) => {
      const e = new THREE.Mesh(G.bevelBox(0.38, 0.22, 0.1, 0.04), G.mat(0xffa020, { emissive: 0xff7a00 }));
      e.position.set(0.42 * s, 0.15, 0.77); e.userData.keep = true; head.add(e); return e;
    });
    const brow = new THREE.Mesh(G.bevelBox(1.9, 0.3, 0.4, 0.12), dark); brow.position.set(0, 0.45, 0.65); brow.rotation.x = 0.3; head.add(brow);
    const crown = new THREE.Mesh(new THREE.CylinderGeometry(0.95, 1.05, 0.5, 48, 2, true), G.mat(0xffc21a, { emissive: 0x5a3a00, metalness: 0.85, roughness: 0.3 }));
    const crownRim = new THREE.Mesh(new THREE.TorusGeometry(1.02, 0.07, 10, 48), G.mat(0xffd54a, { emissive: 0x5a3a00, metalness: 0.85, roughness: 0.25 }));
    crownRim.rotation.x = Math.PI / 2; crownRim.position.y = 0.66; head.add(crownRim);
    crown.position.y = 0.9; head.add(crown);
    for (let i = 0; i < 8; i++) {
      const sp = new THREE.Mesh(new THREE.ConeGeometry(0.16, 0.5, 16), G.mat(0xffc21a, { emissive: 0x5a3a00, metalness: 0.85, roughness: 0.3 }));
      const a = (i / 8) * Math.PI * 2; sp.position.set(Math.cos(a) * 0.95, 1.35, Math.sin(a) * 0.95); head.add(sp);
    }
    B.crystalMat = new THREE.MeshPhysicalMaterial({ color: 0x66e0ff, emissive: 0x1a6a8a, emissiveIntensity: 1, roughness: 0.1, clearcoat: 1, iridescence: 0.5, flatShading: true });
    B.crystal = new THREE.Mesh(new THREE.OctahedronGeometry(0.55, 0), B.crystalMat);
    B.crystal.scale.set(1, 1.3, 1); B.crystal.position.y = 1.2; B.crystal.userData.keep = true; head.add(B.crystal);
    B.arms = [-1, 1].map((s) => {
      const g = new THREE.Group(); g.position.set(2.35 * s, 2.5, 0); torso.add(g);
      const shoulder = stoneMesh(blob(0.7, 9, 11 + s, 0.2, 1), rock); g.add(shoulder);
      const up = new THREE.Mesh(G.bevelBox(0.9, 2.0, 0.9, 0.28), dark); up.position.y = -1.0; g.add(up);
      const fist = stoneMesh(blob(0.95, 12, 13 + s, 0.18, 1), rock); fist.position.y = -2.4; g.add(fist);
      g.side = s; return g;
    });
    B.heldRock = new THREE.Mesh(blob(1.0, 8, 17, 0.2, 1), G.mat(0x7a6e62, { roughness: 0.9 }));
    B.heldRock.userData.keep = true;
    B.heldRock.visible = false; B.heldRock.position.set(0, 5.6, 0); torso.add(B.heldRock);
    B.shadow = G.fx.makeShadow(2.6);
    B.col = P.addCyl({ x: B.pos.x, z: B.pos.z, r: B.R, y0: B.pos.y, y1: B.pos.y + B.H, top: false, dynamic: true });
    // landing marker for slams
    B.marker = new THREE.Mesh(new THREE.RingGeometry(1.5, 2.2, 64).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0xff3020, transparent: true, opacity: 0.7, depthWrite: false }));
    B.marker.visible = false; scene.add(B.marker);
    B.scene = scene;
    // boulder spots around the arena (a fresh one rolls in a few seconds after each is used)
    const entrance = MT.theta0 + MT.T;
    B.rockSpots = [0.95, 2.2, 3.6, 5.3].map((da) => ({ x: MT.x + Math.cos(entrance + da) * 13, z: MT.z + Math.sin(entrance + da) * 13, rock: null, t: 0 }));
    B.rockSpots.forEach(spawnSpotRock);
    // arena rim stones
    for (let i = 0; i < 10; i++) {
      const a = (i / 10) * Math.PI * 2 + 0.3;
      const x = MT.x + Math.cos(a) * 21, z = MT.z + Math.sin(a) * 21;
      if (Math.abs(U.wrap(a - (MT.theta0 + MT.T))) < 0.35) continue; // leave the entrance open
      const rg = blob(1.1, 8, 20 + i, 0.24, 0.8);
      rg.setAttribute('color', new THREE.BufferAttribute(new Float32Array(rg.attributes.position.count * 3).fill(0.3), 3));
      const r = new THREE.Mesh(rg, G.decor.rockMaterial());
      r.position.set(x, MT.Hs + 0.5, z); r.scale.set(1, 1.3, 1); r.userData.static = true; r.castShadow = true; r.receiveShadow = true; scene.add(r);
      P.addCyl({ x, z, r: 1.0, y0: MT.Hs - 1, y1: MT.Hs + 1.6 });
    }
    B.reset();
  };

  function spawnSpotRock(sp) {
    sp.rock = G.throwRock(B.scene, sp.x, sp.z, { size: 0.62 });
    sp.t = 0;
  }
  B.reset = function () {
    const MT = G.terrain.mtn;
    B.looseRocks.forEach((r) => { if (r.isAlive() && r.handle.canPick()) r.destroy(); });
    B.looseRocks = [];
    B.pos.set(MT.x, MT.Hs, MT.z - 6); B.vel.set(0, 0, 0);
    B.hp = B.maxHp; B.state = 'dormant'; B.t = 0; B.face = 0; B.specialT = 0;
    B.waves.forEach((w) => G.fx.scene.remove(w.m)); B.waves.length = 0;
    B.root.visible = true; B.root.scale.setScalar(1); B.col.solid = true;
    B.marker.visible = false;
  };

  function setState(s) { B.state = s; B.t = 0; }
  B.active = () => !['dormant', 'defeated', 'gone'].includes(B.state);

  function toPlayer() {
    const p = G.player.pos;
    const dx = p.x - B.pos.x, dz = p.z - B.pos.z;
    return { dx, dz, d: Math.hypot(dx, dz), yaw: Math.atan2(dx, dz) };
  }
  function clampArena(v, r) {
    const dx = v.x - B.center.x, dz = v.z - B.center.z, d = Math.hypot(dx, dz);
    if (d > r) { v.x = B.center.x + (dx / d) * r; v.z = B.center.z + (dz / d) * r; }
  }
  const phase = () => 1 + Math.floor((B.maxHp - B.hp) * 0.5); // 1..3 — gets meaner as it takes damage

  B.update = function (dt) {
    const pl = G.player;
    B.t += dt;
    const tp = toPlayer();
    const plInArena = Math.hypot(pl.pos.x - B.center.x, pl.pos.z - B.center.z) < 21 && pl.pos.y > B.center.y - 2;
    const ph = phase();

    switch (B.state) {
      case 'dormant':
        B.face = Math.sin(B.t * 0.5) * 0.4;
        if (plInArena && pl.state !== 'dead') { setState('intro'); G.emit('bossStart'); G.audio.sfx.bossRoar(); G.camera.shake(1.0); }
        break;
      case 'intro':
        B.face = U.angleStep(B.face, tp.yaw, 2 * dt);
        if (B.t > 2.2) setState('chase');
        break;
      case 'chase': {
        if (!plInArena && B.t > 1) { // player left: return to centre and wait
          const hx = B.center.x - B.pos.x, hz = B.center.z - B.pos.z;
          if (Math.hypot(hx, hz) > 1) walk(Math.atan2(hx, hz), 3, dt);
          if (B.t > 6) setState('dormantReady');
          break;
        }
        walk(tp.yaw, 3.3 + ph * 0.9, dt);
        B.specialT += dt;
        if (tp.d < 5.2 && B.t > 0.5) { setState('swipeWind'); break; }
        if (B.specialT > 3.4 - ph * 0.55) {
          B.specialT = 0;
          const pick = tp.d > 9 && B.lastAttack !== 'throw' ? 'throw' : 'slamCrouch';
          B.lastAttack = pick === 'throw' ? 'throw' : 'slam';
          setState(pick);
        }
        break;
      }
      case 'dormantReady':
        if (plInArena) setState('chase');
        break;
      case 'swipeWind':
        B.face = U.angleStep(B.face, tp.yaw, 3 * dt);
        if (B.t > 0.75 - ph * 0.12) { setState('swipe'); G.audio.sfx.throw(); }
        break;
      case 'swipe':
        if (B.t > 0.08 && B.t < 0.3 && !B.swiped) {
          const ang = Math.abs(U.wrap(tp.yaw - B.face));
          if (tp.d < 6.2 && ang < 1.4 && pl.pos.y < B.pos.y + 3.5) { pl.hurt(2, B.pos.x, B.pos.z, 17); B.swiped = true; }
        }
        if (B.t > 0.7) { B.swiped = false; setState('chase'); }
        break;
      case 'slamCrouch':
        B.face = U.angleStep(B.face, tp.yaw, 4 * dt);
        if (B.t > 0.55) {
          // leap to where the player is now
          B.target = new V3(pl.pos.x, B.center.y, pl.pos.z);
          clampArena(B.target, 16);
          B.from = B.pos.clone();
          B.air = 1.05 - ph * 0.08;
          B.marker.position.set(B.target.x, B.center.y + 0.1, B.target.z); B.marker.visible = true;
          setState('slamAir'); G.audio.sfx.jump3();
        }
        break;
      case 'slamAir': {
        const f = Math.min(1, B.t / B.air);
        B.pos.x = U.lerp(B.from.x, B.target.x, f); B.pos.z = U.lerp(B.from.z, B.target.z, f);
        B.pos.y = B.center.y + Math.sin(f * Math.PI) * 11;
        B.marker.material.opacity = 0.4 + Math.sin(B.t * 30) * 0.3;
        if (f >= 1) {
          B.pos.y = B.center.y; B.marker.visible = false;
          G.audio.sfx.shockwave(); G.camera.shake(0.8);
          G.fx.burst(B.pos.x, B.pos.y, B.pos.z, 20, 0x9a8f80, 9, 0.5, 0.8, -20);
          if (tp.d < 3.6 && pl.pos.y < B.pos.y + 3) pl.hurt(2, B.pos.x, B.pos.z, 16);
          for (let i = 0; i < ph; i++) B.waves.push({ x: B.pos.x, z: B.pos.z, r: 1, delay: i * 0.5, m: null });
          setState('stuck');
        }
        break;
      }
      case 'stuck':
        if (B.t > 2.6 - ph * 0.25) { setState('getup'); }
        break;
      case 'getup':
        if (B.t > 0.6) setState('chase');
        break;
      case 'throw':
        B.face = U.angleStep(B.face, tp.yaw, 3 * dt);
        B.heldRock.visible = B.t > 0.2;
        if (B.t > 0.8) {
          B.heldRock.visible = false;
          for (let i = 0; i < ph; i++) lob(i);
          G.audio.sfx.throw();
          setState('chase');
        }
        break;
      case 'hurt':
        B.pos.x += B.vel.x * dt; B.pos.z += B.vel.z * dt; B.vel.multiplyScalar(Math.exp(-4 * dt));
        if (B.t > 1.2) { setState(B.hp <= 0 ? 'defeated' : 'chase'); if (B.hp <= 0) { G.audio.sfx.bossRoar(); } }
        break;
      case 'defeated':
        B.root.position.x = B.pos.x + (Math.random() - 0.5) * 0.3;
        if (Math.random() < dt * 10) G.fx.burst(B.pos.x + (Math.random() - 0.5) * 3, B.pos.y + Math.random() * 5, B.pos.z + (Math.random() - 0.5) * 3, 6, 0x9a8f80, 6, 0.5, 0.8, -20);
        if (B.t > 2.6) {
          setState('gone');
          G.audio.sfx.explode(); G.camera.shake(1);
          G.fx.burst(B.pos.x, B.pos.y + 3, B.pos.z, 40, 0x9a8f80, 12, 0.8, 1.2, -25);
          B.root.visible = false; B.col.solid = false; B.shadow.visible = false;
          G.emit('bossDefeated');
        }
        break;
    }

    // keep inside the arena, update body collider
    if (B.state !== 'slamAir') clampArena(B.pos, 18);
    B.col.x = B.pos.x; B.col.z = B.pos.z; B.col.y0 = B.pos.y; B.col.y1 = B.pos.y + (B.state === 'stuck' ? 3.2 : B.H);

    updateWaves(dt);
    if (B.active()) playerContact(tp);
    // boulders roll back in after being used
    B.rockSpots.forEach((sp) => {
      if (sp.rock && sp.rock.isAlive() && (sp.rock.handle.canPick() || G.player.carry === sp.rock.handle)) return;
      if (sp.rock && sp.rock.isAlive()) { sp.rock = null; }
      sp.t += dt;
      if (sp.t > 5 && B.state !== 'gone') { spawnSpotRock(sp); G.fx.sparkle(sp.x, B.center.y + 1, sp.z, 0xd8c8a0); }
    });
  };

  // thrown objects ask whether they hit the Crag King
  B.rockHitTest = function (p, r, vel) {
    if (!B.root.visible || ['dormant', 'intro', 'hurt', 'defeated', 'gone'].includes(B.state)) return false;
    const dx = p.x - B.pos.x, dz = p.z - B.pos.z, d = Math.hypot(dx, dz);
    const top = B.pos.y + (B.state === 'stuck' ? 3.6 : B.H + 0.6);
    if (d > B.R + r + 0.35 || p.y < B.pos.y - 0.2 || p.y > top) return false;
    B.hp = Math.max(0, B.hp - 1);
    setState('hurt');
    const l = Math.hypot(vel ? vel.x : 0, vel ? vel.z : 0) || 1;
    B.vel.set(vel ? (vel.x / l) * 4 : 0, 0, vel ? (vel.z / l) * 4 : 0);
    B.waves.forEach((w) => { if (w.m) G.fx.scene.remove(w.m); }); B.waves.length = 0;
    B.marker.visible = false;
    G.audio.sfx.bossHurt(); G.audio.sfx.bossRoar(); G.camera.shake(0.7);
    G.fx.burst(p.x, p.y, p.z, 18, 0xc8b8a0, 9, 0.45, 0.9, -22);
    G.fx.sparkle(B.pos.x, B.pos.y + B.H, B.pos.z, 0xffe066);
    G.emit('bossHit', B.hp);
    return true;
  };

  function walk(yaw, sp, dt) {
    B.face = U.angleStep(B.face, yaw, 2.4 * dt);
    B.pos.x += Math.sin(B.face) * sp * dt; B.pos.z += Math.cos(B.face) * sp * dt;
    B.walkPhase = (B.walkPhase || 0) + sp * dt * 1.2;
    if (Math.floor(B.walkPhase / Math.PI) !== Math.floor((B.walkPhase - sp * dt * 1.2) / Math.PI)) { G.audio.sfx.land(6); G.camera.shake(0.08); }
  }

  function lob(i) {
    const pl = G.player;
    const sx = B.pos.x, sy = B.pos.y + 7, sz = B.pos.z;
    const T = 1.3 + i * 0.25;
    const spread = (i - (phase() - 1) / 2) * 3.5;
    const px = pl.pos.x + pl.vel.x * T * 0.5 + Math.cos(B.face) * spread;
    const pz = pl.pos.z + pl.vel.z * T * 0.5 - Math.sin(B.face) * spread;
    const g = P.GRAVITY * 0.6;
    const vy = (pl.pos.y + 0.5 - sy - 0.5 * g * T * T) / T;
    G.enemies.fire(sx, sy, sz, (px - sx) / T, vy, (pz - sz) / T, {
      scale: 2.4, r: 1.0, dmg: 2, life: 4, mat: G.mat(0x7a6e62),
      onHit(x, y, z) {
        G.audio.sfx.explode();
        G.fx.ring(x, y, z, 3, 0.3, 0xffb070);
        const p = G.player.pos;
        if (Math.hypot(p.x - x, p.z - z) < 2.8 && Math.abs(p.y - y) < 2.5) G.player.hurt(1, x, z, 12);
        // a chunk survives the impact: throw it back at him!
        B.looseRocks = B.looseRocks.filter((r) => r.isAlive());
        const inArena = Math.hypot(x - B.center.x, z - B.center.z) < 19 && y > B.center.y - 2;
        if (B.active() && inArena && B.looseRocks.length < 4 && i === 0) B.looseRocks.push(G.throwRock(B.scene, x, z, { size: 0.55, life: 14 }));
      },
    });
  }

  function updateWaves(dt) {
    const pl = G.player;
    for (let i = B.waves.length - 1; i >= 0; i--) {
      const w = B.waves[i];
      if (w.delay > 0) { w.delay -= dt; continue; }
      if (!w.m) {
        w.m = new THREE.Mesh(B.waveGeo, B.waveMat.clone());
        w.m.rotation.x = Math.PI / 2; G.fx.scene.add(w.m);
        if (w !== B.waves[0]) G.audio.sfx.shockwave();
      }
      w.r += 12.5 * dt;
      w.m.scale.set(w.r, w.r, 1);
      w.m.position.set(w.x, B.center.y + 0.35, w.z);
      w.m.material.opacity = 0.85 * (1 - w.r / 24);
      const d = Math.hypot(pl.pos.x - w.x, pl.pos.z - w.z);
      if (Math.abs(d - w.r) < 0.8 && pl.pos.y < B.center.y + 0.8 && pl.state !== 'dead') pl.hurt(2, w.x, w.z, 12);
      if (w.r > 23) { G.fx.scene.remove(w.m); w.m.material.dispose(); B.waves.splice(i, 1); }
    }
  }

  function playerContact(tp) {
    const pl = G.player;
    if (pl.state === 'dead') return;
    const stuck = B.state === 'stuck';
    // crystal position (head top)
    const headTop = B.pos.y + (stuck ? 3.4 : 7.0);
    const hx = B.pos.x + Math.sin(B.face) * (stuck ? 3.0 : 0.4), hz = B.pos.z + Math.cos(B.face) * (stuck ? 3.0 : 0.4);
    const dh = Math.hypot(pl.pos.x - hx, pl.pos.z - hz);
    if (dh < 1.9 && pl.vel.y <= 0 && pl.pos.y < headTop + 0.6 && pl.pos.y > headTop - 1.4 && !pl.grounded) {
      pl.pos.y = headTop; pl.bounce(15); G.audio.sfx.clang();
      const a = Math.atan2(pl.pos.x - B.pos.x, pl.pos.z - B.pos.z);
      pl.vel.x = Math.sin(a) * 10; pl.vel.z = Math.cos(a) * 10;
      return;
    }
    // body contact
    if (tp.d < B.R + 0.6 && pl.pos.y < B.pos.y + (stuck ? 3.2 : B.H) - 0.3) {
      if (B.state === 'chase' || B.state === 'swipe' || B.state === 'getup') pl.hurt(1, B.pos.x, B.pos.z, 12);
    }
    // player attacks bounce off stone
    if (pl.attack && pl.attackOverlap(B.pos.x, B.pos.y + 2, B.pos.z, B.R) && !B.clangCd) {
      G.audio.sfx.clang(); B.clangCd = true; setTimeout(() => (B.clangCd = false), 300);
    }
  }

  B.render = function (dt) {
    if (!B.root.visible) return;
    const r = B.root;
    if (B.state !== 'defeated') r.position.copy(B.pos);
    r.rotation.y = B.face;
    G.fx.placeShadow(B.shadow, B.pos.x, B.pos.y, B.pos.z, 2.8);
    const t = B.t, s = B.state;
    let crouch = 0, armL = 0, armR = 0, lean = 0;
    const wp = B.walkPhase || 0;
    if (s === 'chase') {
      B.legs[0].rotation.x = Math.sin(wp) * 0.5; B.legs[1].rotation.x = -Math.sin(wp) * 0.5;
      armL = -Math.sin(wp) * 0.4; armR = Math.sin(wp) * 0.4;
    } else { B.legs[0].rotation.x *= 0.9; B.legs[1].rotation.x *= 0.9; }
    if (s === 'intro') { armL = -2.6; armR = -2.6; lean = -0.2; }
    if (s === 'swipeWind') { armR = -2.8; lean = -0.15; }
    if (s === 'swipe') { armR = U.lerp(-2.8, 1.2, Math.min(1, t / 0.2)); lean = 0.25; B.torso.rotation.y = -Math.min(1, t / 0.2) * 0.8; }
    else B.torso.rotation.y *= 0.85;
    if (s === 'slamCrouch') { crouch = 0.8; armL = -3; armR = -3; }
    if (s === 'slamAir') { armL = -3.1; armR = -3.1; }
    if (s === 'stuck') { crouch = 1.5; lean = 0.9; armL = -1.2; armR = -1.2; }
    if (s === 'getup') { crouch = 1.5 * (1 - t / 0.6); lean = 0.9 * (1 - t / 0.6); }
    if (s === 'throw') { armL = -3.0; armR = -3.0; if (t > 0.6) { armL = -1; armR = -1; } }
    if (s === 'hurt') { lean = -0.4; armL = -2.5 + Math.sin(t * 20) * 0.4; armR = -2.5 - Math.sin(t * 20) * 0.4; }
    if (s === 'defeated') { lean = 0.3 + t * 0.2; crouch = t * 0.6; }
    const k = 0.2;
    B.body.position.y = U.lerp(B.body.position.y, -crouch, k);
    B.torso.rotation.x = U.lerp(B.torso.rotation.x, lean, k);
    B.arms[0].rotation.x = U.lerp(B.arms[0].rotation.x, armL, k);
    B.arms[1].rotation.x = U.lerp(B.arms[1].rotation.x, armR, k);
    const glow = s === 'stuck' ? 0.5 + Math.sin(t * 14) * 0.5 : 0.1;
    B.crystalMat.emissive.setRGB(0.1 + glow * 0.5, 0.4 + glow * 0.5, 0.55 + glow * 0.45);
    B.crystal.rotation.y += dt * 2;
    const rage = (B.maxHp - B.hp) / B.maxHp;
    B.eyes.forEach((e) => e.material.emissive.setRGB(1, 0.48 - rage * 0.4, 0));
    if (s === 'dormant') B.eyes.forEach((e) => e.material.emissive.setRGB(0.3, 0.15, 0));
  };
})(window.G);

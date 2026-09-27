// collectibles.js — Sparks (coins), Sky Shards (8 hidden pieces) and Sun Gems (major rewards).
(function (G) {
  'use strict';
  const U = G.U;
  const CL = { coins: [], loose: [], shards: [], gems: [], scene: null, maxCoins: 900 };

  let coinMesh, coinFar, coinGeo, coinMat, glowTex;
  const dummy = new THREE.Object3D();

  function makeGlowTexture() {
    const c = document.createElement('canvas'); c.width = c.height = 64;
    const x = c.getContext('2d');
    const g = x.createRadialGradient(32, 32, 0, 32, 32, 32);
    g.addColorStop(0, 'rgba(255,255,255,1)'); g.addColorStop(0.3, 'rgba(255,255,220,0.6)'); g.addColorStop(1, 'rgba(255,255,200,0)');
    x.fillStyle = g; x.fillRect(0, 0, 64, 64);
    return new THREE.CanvasTexture(c);
  }

  CL.init = function (scene) {
    CL.scene = scene;
    // lathe profile: raised rim, recessed face and an embossed centre boss
    const prof = [[0, -0.05], [0.14, -0.05], [0.16, -0.075], [0.36, -0.045], [0.42, -0.07], [0.47, -0.065], [0.5, -0.03], [0.5, 0.03], [0.47, 0.065], [0.42, 0.07], [0.36, 0.045], [0.16, 0.075], [0.14, 0.05], [0, 0.05]]
      .map(([x, y]) => new THREE.Vector2(x, y));
    coinGeo = new THREE.LatheGeometry(prof, 48).rotateX(Math.PI / 2);
    coinGeo.computeVertexNormals();
    coinMat = new THREE.MeshStandardMaterial({ color: 0xffbf1f, metalness: 1, roughness: 0.3, emissive: 0xff9a00, emissiveIntensity: 0.12 });
    // two detail levels: the embossed lathe coin near the camera, a simple 16-sided disc far away
    coinMesh = new THREE.InstancedMesh(coinGeo, coinMat, CL.maxCoins);
    coinMesh.frustumCulled = false;
    coinMesh.castShadow = true;
    coinMesh.count = 0;
    scene.add(coinMesh);
    const farGeo = new THREE.CylinderGeometry(0.5, 0.5, 0.12, 16, 1).rotateX(Math.PI / 2);
    coinFar = new THREE.InstancedMesh(farGeo, coinMat, CL.maxCoins);
    coinFar.frustumCulled = false; coinFar.castShadow = false; coinFar.count = 0; coinFar.userData.noShadowCast = true;
    scene.add(coinFar);
    glowTex = makeGlowTexture();
    CL.glowTex = glowTex;
  };

  // ---------- placement helpers (used by level.js) ----------
  CL.coin = function (x, y, z, groundSnap) {
    if (groundSnap !== false && y == null) y = G.physics.ground(x, z, 999, 0, 0).h + 1.1;
    if (CL.coins.length >= CL.maxCoins) return;
    CL.coins.push({ x, y, z, taken: false, i: CL.coins.length });
  };
  // coins along a straight line, snapped to ground (or at fixed height offset over ground)
  CL.line = function (x0, z0, x1, z1, n, yOff) {
    for (let i = 0; i < n; i++) {
      const f = n === 1 ? 0.5 : i / (n - 1);
      const x = U.lerp(x0, x1, f), z = U.lerp(z0, z1, f);
      CL.coin(x, G.physics.ground(x, z, 999, 0, 0).h + (yOff || 1.1), z);
    }
  };
  // arc of coins between two 3D points (guides jumps)
  CL.arc = function (a, b, height, n) {
    for (let i = 0; i < n; i++) {
      const f = i / (n - 1);
      CL.coin(U.lerp(a[0], b[0], f), U.lerp(a[1], b[1], f) + Math.sin(f * Math.PI) * height, U.lerp(a[2], b[2], f));
    }
  };
  CL.ring = function (cx, y, cz, r, n, vertical) {
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2;
      if (vertical) CL.coin(cx + Math.cos(a) * r, y + Math.sin(a) * r, cz);
      else CL.coin(cx + Math.cos(a) * r, y == null ? null : y, cz + Math.sin(a) * r);
    }
  };
  CL.pathCoins = function (t0, t1, n, lateral) { // along the mountain spiral path
    const MT = G.terrain.mtn;
    for (let i = 0; i < n; i++) {
      const t = U.lerp(t0, t1, i / Math.max(1, n - 1));
      const p = MT.point(t, lateral || 0);
      CL.coin(p.x, p.y + 1.1, p.z);
    }
  };

  // physics coins dropped by enemies and crates
  CL.drop = function (x, y, z, n) {
    for (let i = 0; i < n; i++) {
      const m = new THREE.Mesh(coinGeo, coinMat);
      m.position.set(x, y, z);
      CL.scene.add(m);
      const a = Math.random() * Math.PI * 2, sp = 2 + Math.random() * 3;
      CL.loose.push({ m, pos: m.position, vel: new THREE.Vector3(Math.cos(a) * sp, 10 + Math.random() * 4, Math.sin(a) * sp), r: 0.3, h: 0.5, bounce: 0.5, friction: 3, noWalls: false, life: 12, grounded: false });
    }
  };

  CL.shard = function (x, y, z, id) {
    const grp = new THREE.Group();
    const m = new THREE.Mesh(new THREE.OctahedronGeometry(0.55, 0), new THREE.MeshPhysicalMaterial({ color: 0x5cc4ff, emissive: 0x1a78e0, emissiveIntensity: 1.3, roughness: 0.08, metalness: 0.1, clearcoat: 1, iridescence: 0.7, flatShading: true }));
    m.scale.set(0.8, 1.4, 0.8); grp.add(m);
    const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex, color: 0x9fdcff, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
    glow.scale.setScalar(2.0); grp.add(glow);
    grp.position.set(x, y, z);
    CL.scene.add(grp);
    CL.shards.push({ x, y, z, id, grp, taken: false });
  };

  CL.gem = function (x, y, z, id, name, opts) {
    opts = opts || {};
    const grp = new THREE.Group();
    const core = new THREE.Mesh(new THREE.OctahedronGeometry(0.85, 0), new THREE.MeshPhysicalMaterial({ color: 0xffc21a, emissive: 0xff9000, emissiveIntensity: 1.2, roughness: 0.12, metalness: 0.35, clearcoat: 1, iridescence: 0.4, flatShading: true }));
    core.scale.set(1, 1.35, 1); grp.add(core);
    const ring = new THREE.Mesh(new THREE.TorusGeometry(1.15, 0.1, 16, 72), new THREE.MeshStandardMaterial({ color: 0xff8a1a, emissive: 0xff5a00, emissiveIntensity: 0.8, metalness: 0.8, roughness: 0.25 }));
    grp.add(ring);
    for (let i = 0; i < 6; i++) {
      const spike = new THREE.Mesh(new THREE.ConeGeometry(0.18, 0.55, 8), new THREE.MeshStandardMaterial({ color: 0xffe066, emissive: 0xffb000, emissiveIntensity: 0.9, metalness: 0.6, roughness: 0.25, flatShading: true }));
      const a = (i / 6) * Math.PI * 2;
      spike.position.set(Math.cos(a) * 1.45, Math.sin(a) * 1.45, 0); spike.rotation.z = a - Math.PI / 2;
      grp.add(spike);
    }
    const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex, color: 0xffe28a, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
    glow.scale.setScalar(4.5); grp.add(glow);
    grp.position.set(x, y, z);
    grp.visible = !opts.hidden;
    CL.scene.add(grp);
    const g = { x, y, z, id, name, grp, ring, taken: false, active: !opts.hidden, spawnT: 0 };
    CL.gems.push(g);
    return g;
  };
  CL.revealGem = function (id, x, y, z) {
    const g = CL.gems.find((q) => q.id === id);
    if (!g || g.active || g.taken) return g;
    if (x != null) { g.x = x; g.y = y; g.z = z; g.grp.position.set(x, y, z); }
    g.active = true; g.grp.visible = true; g.spawnT = 1;
    G.audio.sfx.oneup();
    G.fx.sparkle(g.x, g.y, g.z, 0xffe066);
    return g;
  };

  CL.reset = function () {
    CL.coins.forEach((c) => (c.taken = false));
    CL.shards.forEach((s) => { s.taken = false; s.grp.visible = true; });
    CL.loose.forEach((l) => CL.scene.remove(l.m));
    CL.loose.length = 0;
  };

  // ---------- update ----------
  CL.update = function (dt, time) {
    const pl = G.player, px = pl.pos.x, py = pl.pos.y + 0.85, pz = pl.pos.z;
    const S = G.game.stats;
    const alive = pl.state !== 'dead' && pl.state !== 'drown';
    // static coins (near ones use the detailed model and cast shadows)
    const rot = time * 3;
    const cam = (G.game && G.game.camera3) ? G.game.camera3.position : pl.pos;
    let nN = 0, nF = 0;
    for (let i = 0; i < CL.coins.length; i++) {
      const c = CL.coins[i];
      if (!c.taken && alive && Math.abs(c.x - px) < 1.4 && Math.abs(c.z - pz) < 1.4 && Math.abs(c.y - py) < 1.6) {
        c.taken = true; collectCoin(c.x, c.y, c.z);
      }
      if (c.taken) continue;
      dummy.position.set(c.x, c.y + Math.sin(time * 2 + i) * 0.08, c.z);
      dummy.rotation.set(0, rot + i * 0.3, 0);
      dummy.scale.setScalar(1);
      dummy.updateMatrix();
      const dx = c.x - cam.x, dz = c.z - cam.z;
      if (dx * dx + dz * dz < 4900) coinMesh.setMatrixAt(nN++, dummy.matrix);
      else coinFar.setMatrixAt(nF++, dummy.matrix);
    }
    coinMesh.count = nN; coinFar.count = nF;
    coinMesh.instanceMatrix.needsUpdate = true; coinFar.instanceMatrix.needsUpdate = true;
    // loose coins
    for (let i = CL.loose.length - 1; i >= 0; i--) {
      const l = CL.loose[i];
      G.physics.stepBody(l, dt);
      l.m.rotation.y += dt * 6;
      l.life -= dt;
      l.m.visible = l.life > 3 || Math.floor(l.life * 8) % 2 === 0;
      const d = Math.hypot(l.pos.x - px, l.pos.y + 0.3 - py, l.pos.z - pz);
      if ((d < 1.5 && alive && l.life < 11.7) || l.life <= 0 || l.pos.y < (G.terrain.waterLevelAt(l.pos.x, l.pos.z) ?? -999) - 1) {
        if (d < 1.5 && l.life > 0) collectCoin(l.pos.x, l.pos.y, l.pos.z);
        CL.scene.remove(l.m); CL.loose.splice(i, 1);
      }
    }
    // shards
    CL.shards.forEach((s, i) => {
      if (s.taken) return;
      s.grp.rotation.y = time * 2 + i;
      s.grp.position.y = s.y + Math.sin(time * 2.5 + i) * 0.2;
      if (alive && Math.hypot(s.x - px, s.y - py, s.z - pz) < 1.6) {
        s.taken = true; s.grp.visible = false;
        S.shards++;
        G.audio.sfx.shard();
        G.fx.sparkle(s.x, s.y, s.z, 0x7fd0ff);
        G.emit('shard', S.shards);
      }
    });
    // gems
    CL.gems.forEach((g, i) => {
      if (!g.active || g.taken) return;
      if (g.spawnT > 0) g.spawnT = Math.max(0, g.spawnT - dt);
      g.grp.rotation.y = time * 1.6;
      g.ring.rotation.x = time * 2;
      g.grp.position.y = g.y + Math.sin(time * 2) * 0.3 + g.spawnT * 3;
      g.grp.scale.setScalar(1 - g.spawnT * 0.8);
      if (alive && g.spawnT < 0.3 && Math.hypot(g.x - px, g.grp.position.y - py, g.z - pz) < 2.1) {
        g.taken = true; g.grp.visible = false;
        G.fx.sparkle(g.x, g.y, g.z, 0xffe066);
        G.emit('gem', g);
      }
    });
  };

  function collectCoin(x, y, z) {
    const S = G.game.stats;
    S.coins++;
    G.player.heal(1);
    if (G.player.isSwimming && G.player.isSwimming()) G.player.air = Math.min(1, G.player.air + 0.2);
    G.audio.sfx.coin();
    G.fx.sparkle(x, y, z);
    G.emit('coin', S.coins);
  }

  G.collect = CL;
})(window.G);

// water.js — everything wet: the surfaces of every water body, splashes, ripples and bubbles,
// schools of GPU-animated fish (steering on the CPU, tail wag and orientation in the vertex shader),
// swaying kelp, coral gardens, drifting underwater motes, the highland waterfall with spray and mist,
// and the "is the camera underwater" state that drives the underwater post-processing and audio.
(function (G) {
  'use strict';
  const U = G.U, TAU = U.TAU;
  const W = (G.water = { bubbleList: [], schools: [], camUnder: 0, camDepth: 0, ready: false });
  const T = () => G.terrain;

  // ------------------------------------------------------------------
  // build
  // ------------------------------------------------------------------
  W.build = function (scene) {
    W.scene = scene;
    W.bubbleList = []; W.schools = []; W.ready = false;
    const T0 = T(), mat = G.gfx.waterMaterial();
    const add = (geo, y) => {
      const m = new THREE.Mesh(geo, mat);
      m.position.y = y; m.receiveShadow = true; m.castShadow = false; m.userData.noShadow = true; m.renderOrder = 2;
      scene.add(m);
      return m;
    };
    // sea level fills every low basin (river gorge, Mirrorpool, lagoon, plunge pool)
    add(new THREE.PlaneGeometry(T0.HALF * 2 + 40, T0.HALF * 2 + 40, 8, 8).rotateX(-Math.PI / 2), T0.WATER_Y);
    const C = T0.castle;
    add(new THREE.RingGeometry(C.island - 1.5, C.rim + 1.5, 128, 1).rotateX(-Math.PI / 2).translate(C.x, 0, C.z), C.moatY);
    const F = T0.falls;
    const hi = window.ADDONS.mergeGeometries([
      new THREE.CircleGeometry(18.5, 64).rotateX(-Math.PI / 2).translate(F.high.x, 0, F.high.z),
      new THREE.PlaneGeometry(9, 16, 1, 1).rotateX(-Math.PI / 2).translate(40, 0, -254.5),
    ].map((g) => g.toNonIndexed()), false);
    add(hi, F.high.level);
    const Fo = T0.fountain;
    add(new THREE.CircleGeometry(Fo.r, 64).rotateX(-Math.PI / 2).translate(Fo.x, 0, Fo.z), Fo.level);

    buildWaterfall(scene);
    buildKelp(scene);
    buildCoral(scene);
    buildFish(scene);
    buildMotes(scene);
    W.ready = true;
  };

  // ------------------------------------------------------------------
  // splashes, ripples, bubbles
  // ------------------------------------------------------------------
  W.splash = function (x, y, z, k) {
    if (y === null || y === undefined) return;
    const n = Math.round(6 + 16 * k);
    G.fx.burst(x, y + 0.1, z, n, 0xe6f7ff, 4 + 5 * k, 0.12 + 0.12 * k, 0.55 + 0.3 * k, -22);
    G.fx.ring(x, y - 0.1, z, 2 + 3.5 * k, 0.5 + 0.3 * k, 0xf2fbff);
    if (k > 0.5) G.fx.ring(x, y - 0.1, z, 4 + 5 * k, 0.9, 0xd8f2ff);
  };
  W.ripple = function (x, y, z, r) {
    if (y === null || y === undefined) return;
    G.fx.ring(x, y - 0.12, z, r || 1.5, 0.9, 0xe8f8ff);
  };
  const bubbleGeo = new THREE.SphereGeometry(0.06, 10, 8);
  let bubbleMat = null;
  W.bubbles = function (x, y, z, n) {
    if (!W.scene) return;
    if (!bubbleMat) bubbleMat = new THREE.MeshStandardMaterial({ color: 0xe8fbff, transparent: true, opacity: 0.6, roughness: 0.05, emissive: 0x6fb8d0, emissiveIntensity: 0.4 });
    for (let i = 0; i < n; i++) {
      if (W.bubbleList.length > 120) break;
      const m = new THREE.Mesh(bubbleGeo, bubbleMat);
      m.scale.setScalar(0.6 + Math.random() * 1.2);
      m.position.set(x + (Math.random() - 0.5) * 0.3, y + (Math.random() - 0.5) * 0.2, z + (Math.random() - 0.5) * 0.3);
      m.userData.noShadow = true;
      W.scene.add(m);
      W.bubbleList.push({ m, t: 0, speed: 1.2 + Math.random() * 1.2, ph: Math.random() * TAU });
    }
  };
  function updateBubbles(dt) {
    const L = W.bubbleList;
    for (let i = L.length - 1; i >= 0; i--) {
      const b = L[i];
      b.t += dt;
      const p = b.m.position;
      p.y += b.speed * dt;
      p.x += Math.sin(b.t * 7 + b.ph) * 0.4 * dt;
      p.z += Math.cos(b.t * 6 + b.ph) * 0.4 * dt;
      const wl = T().waterLevelAt(p.x, p.z);
      if (wl === null || p.y > wl - 0.05 || b.t > 6) {
        if (wl !== null && Math.random() < 0.3) W.ripple(p.x, wl, p.z, 0.5);
        W.scene.remove(b.m);
        L.splice(i, 1);
      }
    }
  }

  // ------------------------------------------------------------------
  // waterfall: curved sheet with scrolling streaks, spray and mist
  // ------------------------------------------------------------------
  function buildWaterfall(scene) {
    const S = window.TSL, F = T().falls;
    const top = F.high.level, bottom = T().WATER_Y, H = top - bottom;
    // find the cliff lip: the first point north of the stream where the ground drops away
    let zLip = -247;
    for (let z = -258; z < -230; z += 0.25) { if (T().heightAt(40, z) < top - 2.5) { zLip = z - 0.6; break; } }
    const rows = 56, g = new THREE.PlaneGeometry(8.5, H + 0.6, 12, rows);
    const p = g.attributes.position;
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i), y = p.getY(i);
      const f = U.clamp(((H + 0.6) / 2 - y) / (H + 0.6), 0, 1); // 0 at the lip, 1 at the pool
      const yy = top + 0.3 - f * (H + 0.6);
      let zz = zLip + 1.2 + 9.5 * Math.pow(f, 0.6);         // arc outward from the cliff
      for (let k = 0; k < 24 && T().heightAt(40 + x, zz) > yy - 0.6; k++) zz += 0.6; // never behind the rock
      p.setXYZ(i, 40 + x * (1 + f * 0.35), yy, zz);
    }
    g.computeVertexNormals();
    const m = new THREE.MeshStandardNodeMaterial({ transparent: true, side: THREE.DoubleSide, roughness: 0.25, metalness: 0, depthWrite: false });
    const u = S.uv(), t = G.gfx.uTime;
    const flow = S.texture(G.gfx.noiseTex, S.vec2(u.x.mul(1.4), u.y.mul(0.8).add(t.mul(1.05)))).r;
    const streak = S.texture(G.gfx.noiseTex, S.vec2(u.x.mul(5.5), u.y.mul(0.22).add(t.mul(1.55)))).g;
    const edge = S.smoothstep(0, 0.12, u.x).mul(S.smoothstep(1, 0.88, u.x));
    m.colorNode = S.mix(S.color(0xbfeeff), S.color(0xffffff), streak.mul(1.4).clamp(0, 1));
    m.opacityNode = S.clamp(streak.mul(0.45).add(flow.mul(0.25)).add(0.42), 0, 0.97).mul(edge);
    m.emissiveNode = S.color(0x9fdcff).mul(0.28);
    const mesh = new THREE.Mesh(g, m);
    mesh.renderOrder = 3; mesh.userData.noShadow = true;
    scene.add(mesh);
    const zFoot = p.getZ(rows * 13 + 6); // bottom row, middle column
    W.mist = [];
    for (let i = 0; i < 7; i++) {
      const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: G.collect.glowTex, color: 0xeaf8ff, transparent: true, opacity: 0.2, depthWrite: false }));
      s.position.set(40 + (Math.random() - 0.5) * 8, bottom + 1 + Math.random() * 2.5, zFoot + (Math.random() - 0.3) * 5);
      s.scale.setScalar(7 + Math.random() * 6);
      scene.add(s); W.mist.push({ s, ph: Math.random() * TAU, y0: s.position.y });
    }
    W.fallsSpray = { x: 40, y: bottom, z: zFoot, t: 0, zLip };
  }
  function updateWaterfall(dt, cam) {
    const f = W.fallsSpray;
    if (!f) return;
    const d = Math.hypot(cam.x - f.x, cam.z - f.z);
    if (G.audio.setAmbient) G.audio.setAmbient('falls', U.clamp(1 - d / 120, 0, 1));
    if (d > 170) return;
    f.t -= dt;
    if (f.t <= 0) {
      f.t = 0.1;
      G.fx.burst(f.x + (Math.random() - 0.5) * 7, f.y, f.z + (Math.random() - 0.5) * 2, 3, 0xf4fbff, 5, 0.18, 0.7, -14);
      if (Math.random() < 0.35) G.fx.ring(f.x + (Math.random() - 0.5) * 6, f.y - 0.1, f.z, 3 + Math.random() * 3, 1.2, 0xf8fdff);
    }
    W.mist.forEach((m) => { m.ph += dt * 0.5; m.s.position.y = m.y0 + Math.sin(m.ph) * 0.8; m.s.material.opacity = 0.15 + Math.sin(m.ph * 1.3) * 0.06; });
  }

  // ------------------------------------------------------------------
  // underwater planting helpers
  // ------------------------------------------------------------------
  function seabed(rnd, count, regionFn, minDepth, maxDepth) {
    const pts = [];
    for (let i = 0; i < count * 6 && pts.length < count; i++) {
      const [x, z] = regionFn(rnd);
      const wl = T().waterLevelAt(x, z);
      if (wl === null) continue;
      const g = T().heightAt(x, z), depth = wl - g;
      if (depth < minDepth || depth > maxDepth) continue;
      if (T().normalAt(x, z).y < 0.7) continue;
      pts.push([x, T().groundMin(x, z, 0.8), z, depth]);
    }
    return pts;
  }
  const lagoonPt = (rnd) => { const L = T().lagoon, a = rnd() * TAU, r = Math.sqrt(rnd()) * 0.95; return [L.x + Math.cos(a) * r * L.rx, L.z + Math.sin(a) * r * L.rz]; };
  const discPt = (cx, cz, R) => (rnd) => { const a = rnd() * TAU, r = Math.sqrt(rnd()) * R; return [cx + Math.cos(a) * r, cz + Math.sin(a) * r]; };
  W.seabed = seabed; W.lagoonPt = lagoonPt;

  // ------------------------------------------------------------------
  // kelp: instanced ribbons swaying with the current
  // ------------------------------------------------------------------
  function buildKelp(scene) {
    const S = window.TSL, rnd = U.rng(55);
    const pts = [].concat(
      seabed(rnd, 380, lagoonPt, 4, 30),
      seabed(rnd, 120, discPt(150, -112, 30), 4, 30),
      seabed(rnd, 18, discPt(40, -226, 14), 4, 30),
      seabed(rnd, 90, (r) => { const x = (r() - 0.5) * 360; return [x, T().riverZ(x) + (r() - 0.5) * 8]; }, 4, 30),
    );
    // a narrow ribbon with a wavy edge; each blade gets a crossed twin so it reads from every angle
    const base = new THREE.PlaneGeometry(0.24, 1, 2, 16).translate(0, 0.5, 0);
    { const p = base.attributes.position; for (let i = 0; i < p.count; i++) { const y = p.getY(i), x = p.getX(i); p.setX(i, x * (1 + 0.6 * Math.sin(y * 20)) + Math.sin(y * 7) * 0.08); } }
    const geo = window.ADDONS.mergeGeometries([base, base.clone().rotateY(Math.PI / 2)], false);
    geo.computeVertexNormals();
    const m = new THREE.MeshStandardNodeMaterial({ side: THREE.DoubleSide, roughness: 0.75 });
    const w = S.positionLocal, t = G.gfx.uTime, k = S.positionGeometry.y.pow(1.6);
    const ph = w.x.mul(0.35).add(w.z.mul(0.27));
    m.positionNode = w.add(S.vec3(S.sin(t.mul(1.1).add(ph)).mul(0.7), 0, S.cos(t.mul(0.8).add(ph.mul(1.3))).mul(0.5)).mul(k));
    m.colorNode = S.mix(S.color(0x1c4a1c), S.color(0x6f9a32), S.positionGeometry.y);
    const mesh = new THREE.InstancedMesh(geo, m, Math.max(1, pts.length));
    const o = new THREE.Object3D(), c = new THREE.Color();
    pts.forEach(([x, y, z, depth], i) => {
      const h = Math.min(depth - 1.2, 3 + rnd() * 7);
      o.position.set(x, y - 0.2, z); o.rotation.set(0, rnd() * TAU, 0); o.scale.set(1 + rnd() * 0.6, h, 1 + rnd() * 0.6); o.updateMatrix();
      mesh.setMatrixAt(i, o.matrix);
      mesh.setColorAt(i, c.setHSL(0.2 + rnd() * 0.1, 0.45 + rnd() * 0.2, 0.36 + rnd() * 0.14));
    });
    mesh.count = pts.length;
    mesh.instanceMatrix.needsUpdate = true; if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    mesh.computeBoundingSphere();
    mesh.receiveShadow = true; mesh.castShadow = false; mesh.userData.noShadow = true;
    scene.add(mesh);
  }

  // ------------------------------------------------------------------
  // coral: brain corals, branching antler corals, sea fans and tube sponges (instanced, coloured)
  // ------------------------------------------------------------------
  function buildCoral(scene) {
    const S = window.TSL, rnd = U.rng(313), D = G.decor;
    const strip = (g) => { if (g.getAttribute('uv')) g.deleteAttribute('uv'); return g.index ? g : g; };
    const brain = D.blob(1, 4, 3.7, 0.12, 0.55).translate(0, 0.35, 0);
    const antler = (() => {
      const parts = [];
      const branch = (x, y, z, len, r, ay, tilt, depth) => {
        const dx = Math.sin(tilt) * Math.cos(ay), dz = Math.sin(tilt) * Math.sin(ay), dy = Math.cos(tilt);
        const g = new THREE.CylinderGeometry(r * 0.65, r, len, 8, 1).translate(0, len / 2, 0);
        g.rotateZ(-tilt); g.rotateY(-ay); g.translate(x, y, z);
        parts.push(strip(g));
        const tx = x + dx * len, ty = y + dy * len, tz = z + dz * len;
        if (depth <= 0) { parts.push(strip(new THREE.SphereGeometry(r * 0.8, 8, 6).translate(tx, ty, tz))); return; }
        for (let i = 0; i < 2; i++) branch(tx, ty, tz, len * 0.75, r * 0.7, ay + (i ? 0.9 : -0.9) + (rnd() - 0.5) * 0.4, Math.min(1.1, tilt * 0.7 + 0.35), depth - 1);
      };
      for (let i = 0; i < 4; i++) branch(0, 0, 0, 0.7, 0.13, (i / 4) * TAU + rnd() * 0.6, 0.35 + rnd() * 0.3, 2);
      return window.ADDONS.mergeGeometries(parts, false);
    })();
    const fan = (() => {
      const g = new THREE.CircleGeometry(1, 28, 0, Math.PI).scale(1, 1.2, 1);
      const p = g.attributes.position;
      for (let i = 0; i < p.count; i++) { const x = p.getX(i), y = p.getY(i); p.setZ(i, Math.sin(x * 2.5 + y * 1.7) * 0.08); }
      g.computeVertexNormals();
      return strip(g);
    })();
    const tubes = (() => {
      const parts = [];
      for (let i = 0; i < 5; i++) {
        const a = (i / 5) * TAU + rnd(), r = i ? 0.28 : 0, h = 0.7 + rnd() * 0.8;
        parts.push(strip(new THREE.CylinderGeometry(0.16, 0.2, h, 12, 1, true).translate(Math.cos(a) * r, h / 2, Math.sin(a) * r)));
      }
      return window.ADDONS.mergeGeometries(parts, false);
    })();
    const PAL = [0xff5f8f, 0xff8a3d, 0xffd23f, 0xb46cff, 0x49d7c8, 0xff4a4a, 0xf2f2ff, 0x7fd0ff];
    const types = [
      { geo: brain, n: 90, s: [0.7, 1.6] },
      { geo: antler, n: 110, s: [0.9, 1.7] },
      { geo: fan, n: 70, s: [0.9, 1.6], sway: true },
      { geo: tubes, n: 70, s: [0.8, 1.5] },
    ];
    const pts = seabed(rnd, 340, lagoonPt, 2.2, 17);
    let pi = 0;
    types.forEach((ty) => {
      const list = pts.slice(pi, pi + ty.n); pi += ty.n;
      if (!list.length) return;
      const m = new THREE.MeshStandardNodeMaterial({ roughness: 0.62, metalness: 0, side: ty.sway ? THREE.DoubleSide : THREE.FrontSide });
      if (ty.sway) {
        const w = S.positionLocal, t = G.gfx.uTime, k = S.positionGeometry.y.max(0);
        m.positionNode = w.add(S.vec3(S.sin(t.mul(1.3).add(w.x.mul(0.4))).mul(0.12), 0, S.cos(t.mul(1.1).add(w.z.mul(0.4))).mul(0.12)).mul(k));
      }
      const mesh = new THREE.InstancedMesh(ty.geo, m, list.length);
      const o = new THREE.Object3D(), c = new THREE.Color();
      list.forEach(([x, y, z], i) => {
        const s = U.lerp(ty.s[0], ty.s[1], rnd());
        o.position.set(x, y - 0.15, z); o.rotation.set(0, rnd() * TAU, 0); o.scale.setScalar(s); o.updateMatrix();
        mesh.setMatrixAt(i, o.matrix);
        mesh.setColorAt(i, c.setHex(PAL[Math.floor(rnd() * PAL.length)]).offsetHSL((rnd() - 0.5) * 0.04, 0, (rnd() - 0.5) * 0.1));
      });
      mesh.instanceMatrix.needsUpdate = true; mesh.instanceColor.needsUpdate = true;
      mesh.computeBoundingSphere();
      mesh.receiveShadow = true; mesh.castShadow = false; mesh.userData.noShadow = true;
      scene.add(mesh);
    });
  }

  // ------------------------------------------------------------------
  // fish: InstancedBufferGeometry, per-fish position/orientation/tail phase written each frame
  // ------------------------------------------------------------------
  const SPECIES = [ // main colour, second colour, pattern (0 plain, 1 stripes, 2 coloured fins)
    [0xff7a1a, 0xffffff, 1], [0xffd21f, 0x3a7bff, 2], [0x2f7bff, 0xffd21f, 2], [0xff4f8b, 0xffe0f0, 0],
    [0x7a5cff, 0xffd21f, 2], [0x3fe07a, 0x1a6a3a, 1], [0xff3b30, 0xffd0a0, 0], [0x3ac8ff, 0xffffff, 1],
    [0xffffff, 0xff7a1a, 2], [0xffa03a, 0x2a2a2a, 1],
  ];
  function fishGeometry() {
    const parts = [];
    const paint = (g, shade, tint, part) => {
      if (g.getAttribute('uv')) g.deleteAttribute('uv');
      const n = g.attributes.position.count, c = new Float32Array(n * 3), a = new Float32Array(n * 2);
      const p = g.attributes.position;
      for (let i = 0; i < n; i++) {
        let s = shade, k = tint;
        if (shade < 0) { // body: light belly
          const belly = U.smoothstep(0.02, -0.16, p.getY(i));
          s = U.lerp(0.82, 1.0, belly); k = 1 - 0.78 * belly;
        }
        c[i * 3] = c[i * 3 + 1] = c[i * 3 + 2] = s;
        a[i * 2] = k; a[i * 2 + 1] = part;
      }
      g.setAttribute('color', new THREE.BufferAttribute(c, 3));
      g.setAttribute('aTP', new THREE.BufferAttribute(a, 2));
      return g;
    };
    parts.push(paint(new THREE.SphereGeometry(0.5, 20, 14).scale(0.34, 0.46, 1.0), -1, 1, 0));
    parts.push(paint(new THREE.ConeGeometry(0.3, 0.45, 4, 1).rotateX(-Math.PI / 2).scale(0.25, 1.1, 1).translate(0, 0, -0.62), 0.95, 0.9, 1));
    parts.push(paint(new THREE.ConeGeometry(0.1, 0.3, 3, 1).scale(0.3, 1, 2.2).translate(0, 0.27, -0.05), 0.95, 0.9, 1));
    [-1, 1].forEach((s) => {
      parts.push(paint(new THREE.SphereGeometry(0.06, 10, 8).translate(0.13 * s, 0.07, 0.3), 1.0, 0, 0));
      parts.push(paint(new THREE.SphereGeometry(0.032, 8, 6).translate(0.165 * s, 0.075, 0.33), 0.02, 0, 0));
      parts.push(paint(new THREE.ConeGeometry(0.06, 0.18, 3, 1).rotateZ(s * 1.2).translate(0.16 * s, -0.08, 0.05), 0.95, 0.9, 1));
    });
    const g = window.ADDONS.mergeGeometries(parts, false);
    g.computeVertexNormals();
    return g;
  }
  function buildFish(scene) {
    const S = window.TSL, rnd = U.rng(77);
    const L = T().lagoon, C = T().castle;
    const regions = [
      { x: L.x, z: L.z, rx: L.rx * 0.8, rz: L.rz * 0.8, schools: 7, n: 14 },
      { x: L.x, z: L.z, rx: L.rx * 0.6, rz: L.rz * 0.6, schools: 1, n: 4, big: true },
      { x: 150, z: -112, rx: 26, rz: 26, schools: 2, n: 10 },
      { x: C.x, z: C.z, ring: [C.island + 3, C.rim - 3], schools: 3, n: 8 },
      { x: 40, z: -226, rx: 13, rz: 13, schools: 1, n: 9 },
      { x: 0, z: 118, rx: 180, rz: 5, river: true, schools: 3, n: 10 },
    ];
    let total = 0;
    regions.forEach((rg) => {
      for (let s = 0; s < rg.schools; s++) {
        const sp = SPECIES[Math.floor(rnd() * SPECIES.length)];
        const school = { rg, fish: [], target: new THREE.Vector3(), timer: 0, scale: rg.big ? 2.4 + rnd() * 0.6 : 0.6 + rnd() * 0.8, speed: rg.big ? 1.6 : 3.0 + rnd() * 0.8 };
        const p0 = randomPoint(rg, rnd);
        if (!p0) continue;
        school.target.copy(p0);
        for (let i = 0; i < rg.n; i++) {
          const f = { pos: p0.clone().add(new THREE.Vector3((rnd() - 0.5) * 3, (rnd() - 0.5) * 1, (rnd() - 0.5) * 3)), vel: new THREE.Vector3((rnd() - 0.5), 0, (rnd() - 0.5)), ph: rnd() * TAU, idx: total++ };
          f.colA = new THREE.Color(sp[0]).offsetHSL((rnd() - 0.5) * 0.03, 0, (rnd() - 0.5) * 0.08);
          f.colB = new THREE.Color(sp[1]); f.pat = sp[2];
          f.scale = school.scale * (0.8 + rnd() * 0.4);
          school.fish.push(f);
        }
        W.schools.push(school);
      }
    });
    W.fishCount = total;
    const base = fishGeometry();
    const geo = new THREE.InstancedBufferGeometry();
    geo.index = base.index;
    ['position', 'normal', 'color', 'aTP'].forEach((k) => geo.setAttribute(k, base.getAttribute(k)));
    geo.instanceCount = total;
    const iPos = new THREE.InstancedBufferAttribute(new Float32Array(total * 3), 3).setUsage(THREE.DynamicDrawUsage);
    const iRot = new THREE.InstancedBufferAttribute(new Float32Array(total * 3), 3).setUsage(THREE.DynamicDrawUsage);
    const iColA = new THREE.InstancedBufferAttribute(new Float32Array(total * 4), 4);
    const iColB = new THREE.InstancedBufferAttribute(new Float32Array(total * 4), 4);
    W.schools.forEach((sc) => sc.fish.forEach((f) => {
      iColA.setXYZW(f.idx, f.colA.r, f.colA.g, f.colA.b, f.scale);
      iColB.setXYZW(f.idx, f.colB.r, f.colB.g, f.colB.b, f.pat);
    }));
    W.iPos = iPos; W.iRot = iRot;
    const aPos = S.instancedDynamicBufferAttribute(iPos, 'vec3');
    const aRot = S.instancedDynamicBufferAttribute(iRot, 'vec3');
    const cA = S.instancedBufferAttribute(iColA, 'vec4');
    const cB = S.instancedBufferAttribute(iColB, 'vec4');
    const lp = S.positionGeometry;
    const yaw = aRot.x, pitch = aRot.y, phase = aRot.z;
    // body wave: the tail swings most, the head a little the other way
    const tailW = S.smoothstep(0.1, -0.95, lp.z);
    const wag = S.sin(phase.sub(lp.z.mul(3.2))).mul(S.mix(S.float(-0.02), S.float(0.16), tailW));
    const l1 = S.vec3(lp.x.add(wag), lp.y, lp.z).mul(cA.w);
    const cp = S.cos(pitch), sp = S.sin(pitch), cy = S.cos(yaw), sy = S.sin(yaw);
    const y1 = l1.y.mul(cp).add(l1.z.mul(sp)), z1 = l1.y.mul(sp).negate().add(l1.z.mul(cp));
    const x2 = l1.x.mul(cy).add(z1.mul(sy)), z2 = l1.x.mul(sy).negate().add(z1.mul(cy));
    const m = new THREE.MeshStandardNodeMaterial({ roughness: 0.3, metalness: 0.12 });
    m.positionNode = aPos.add(S.vec3(x2, y1, z2));
    const n = S.normalGeometry;
    const ny1 = n.y.mul(cp).add(n.z.mul(sp)), nz1 = n.y.mul(sp).negate().add(n.z.mul(cp));
    const nW = S.vec3(n.x.mul(cy).add(nz1.mul(sy)), ny1, n.x.mul(sy).negate().add(nz1.mul(cy)));
    m.normalNode = S.normalize(S.cameraViewMatrix.mul(S.vec4(nW, 0)).xyz);
    const tp = S.attribute('aTP', 'vec2');
    const stripes = S.smoothstep(0.62, 0.72, S.abs(S.fract(lp.z.mul(2.3).add(0.15)).sub(0.5)).mul(2));
    const isStripe = S.step(0.5, cB.w).mul(S.step(cB.w, 1.5));
    const isFins = S.step(1.5, cB.w);
    let body = S.mix(cA.xyz, cB.xyz, stripes.mul(isStripe).mul(S.float(1).sub(tp.y)));
    body = S.mix(body, cB.xyz, tp.y.mul(isFins));
    const vc = S.attribute('color', 'vec3');
    m.colorNode = S.mix(vc, vc.mul(body), tp.x);
    m.emissiveNode = body.mul(tp.x).mul(0.06);
    const mesh = new THREE.Mesh(geo, m);
    mesh.frustumCulled = false; mesh.castShadow = false; mesh.receiveShadow = true; mesh.userData.noShadow = true;
    scene.add(mesh);
    W.fishMesh = mesh;
    writeFish(true);
  }
  function randomPoint(rg, rnd) {
    for (let i = 0; i < 40; i++) {
      let x, z;
      if (rg.ring) { const a = rnd() * TAU, r = U.lerp(rg.ring[0], rg.ring[1], rnd()); x = rg.x + Math.cos(a) * r; z = rg.z + Math.sin(a) * r; }
      else if (rg.river) { x = rg.x + (rnd() - 0.5) * 2 * rg.rx; z = T().riverZ(x) + (rnd() - 0.5) * 4; }
      else { const a = rnd() * TAU, r = Math.sqrt(rnd()); x = rg.x + Math.cos(a) * r * rg.rx; z = rg.z + Math.sin(a) * r * rg.rz; }
      const wl = T().waterLevelAt(x, z);
      if (wl === null) continue;
      const g = T().heightAt(x, z);
      if (wl - g < (rg.big ? 6 : 2.2)) continue;
      return new THREE.Vector3(x, U.lerp(g + 1, wl - 0.9, 0.2 + rnd() * 0.6), z);
    }
    return null;
  }
  function writeFish(all) {
    const P = W.iPos.array, R = W.iRot.array;
    W.schools.forEach((sc) => {
      if (!all && !sc.active) return;
      sc.fish.forEach((f) => {
        const i = f.idx * 3;
        P[i] = f.pos.x; P[i + 1] = f.pos.y; P[i + 2] = f.pos.z;
        const hs = Math.hypot(f.vel.x, f.vel.z);
        R[i] = Math.atan2(f.vel.x, f.vel.z); R[i + 1] = Math.atan2(f.vel.y, Math.max(0.2, hs)) * 0.8; R[i + 2] = f.ph;
      });
    });
    W.iPos.needsUpdate = true; W.iRot.needsUpdate = true;
  }
  const _v = new THREE.Vector3(), _c = new THREE.Vector3(), _a = new THREE.Vector3(), _t = new THREE.Vector3();
  const frnd = U.rng(91);
  function updateFish(dt, cam) {
    const pl = G.player;
    W.schools.forEach((sc) => {
      const d0 = Math.hypot(cam.x - sc.target.x, cam.z - sc.target.z);
      sc.active = d0 < 180;
      if (!sc.active) return;
      sc.timer -= dt;
      if (sc.timer <= 0) { sc.timer = 4 + frnd() * 6; const p = randomPoint(sc.rg, frnd); if (p) sc.target.copy(p); }
      _c.set(0, 0, 0); _a.set(0, 0, 0);
      sc.fish.forEach((f) => { _c.add(f.pos); _a.add(f.vel); });
      _c.multiplyScalar(1 / sc.fish.length); _a.multiplyScalar(1 / sc.fish.length);
      const sep = sc.rg.big ? 9 : 1.2;
      sc.fish.forEach((f) => {
        const steer = _v.set(0, 0, 0);
        steer.addScaledVector(_t.copy(_c).sub(f.pos), 0.35);
        steer.addScaledVector(_t.copy(sc.target).sub(f.pos).normalize(), 1.2);
        steer.addScaledVector(_a, 0.25);
        sc.fish.forEach((o) => {
          if (o === f) return;
          const dx = f.pos.x - o.pos.x, dy = f.pos.y - o.pos.y, dz = f.pos.z - o.pos.z, d2 = dx * dx + dy * dy + dz * dz;
          if (d2 < sep && d2 > 1e-4) { const k = 1.35 * sep / d2; steer.x += dx * k; steer.y += dy * k; steer.z += dz * k; }
        });
        // flee the player
        const px = f.pos.x - pl.pos.x, py = f.pos.y - (pl.pos.y + 0.8), pz = f.pos.z - pl.pos.z, pd = Math.hypot(px, py, pz);
        let maxS = sc.speed;
        if (pd < 5.5 && pd > 1e-3) { const k = (5.5 - pd) * 3; steer.x += px / pd * k; steer.y += py / pd * k * 0.5; steer.z += pz / pd * k; maxS = sc.speed * 2.3; }
        // stay inside the water column
        const wl = T().waterLevelAt(f.pos.x, f.pos.z);
        const g = T().heightAt(f.pos.x, f.pos.z);
        if (wl === null || wl - g < 1.6) { steer.x += (sc.target.x - f.pos.x) * 2; steer.z += (sc.target.z - f.pos.z) * 2; }
        else {
          if (f.pos.y > wl - 0.7) steer.y -= 4;
          if (f.pos.y < g + 0.8) steer.y += 4;
        }
        f.vel.addScaledVector(steer, dt * 1.6);
        const spd = f.vel.length();
        if (spd > maxS) f.vel.multiplyScalar(maxS / spd);
        if (spd < 0.9) f.vel.multiplyScalar(0.9 / Math.max(spd, 0.01));
        f.pos.addScaledVector(f.vel, dt);
        if (wl !== null) f.pos.y = Math.min(f.pos.y, wl - 0.35);
        f.pos.y = Math.max(f.pos.y, g + 0.3);
        // tail beat frequency follows the swimming speed
        f.ph += dt * (5 + f.vel.length() * 2.6) / (sc.rg.big ? 2 : 1);
      });
    });
    writeFish(false);
  }

  // ------------------------------------------------------------------
  // drifting motes around the camera (only drawn underwater, clipped at the surface)
  // ------------------------------------------------------------------
  function buildMotes(scene) {
    const S = window.TSL, count = 1000, side = Math.round(Math.cbrt(count)), R = 14, sp = (R * 2) / side;
    const base = new THREE.OctahedronGeometry(0.035, 0);
    const geo = new THREE.InstancedBufferGeometry();
    geo.setAttribute('position', base.getAttribute('position'));
    if (base.index) geo.index = base.index;
    geo.instanceCount = side * side * side;
    W.uLevel = S.uniform(0);
    const id = S.instanceIndex.toFloat();
    const gx = S.mod(id, side), gy = S.mod(S.floor(id.div(side)), side), gz = S.floor(id.div(side * side));
    const cell = S.vec3(gx, gy, gz);
    const h = S.fract(S.sin(S.dot(cell, S.vec3(12.9898, 78.233, 37.719))).mul(43758.5453));
    const t = G.gfx.uTime;
    const drift = S.vec3(S.sin(t.mul(0.3).add(h.mul(6.28))).mul(0.6), t.mul(0.12).add(h.mul(3)), S.cos(t.mul(0.25).add(h.mul(4))).mul(0.6));
    const local = cell.mul(sp).add(S.vec3(h, S.fract(h.mul(7.3)), S.fract(h.mul(3.1))).mul(sp)).add(drift);
    const cam = G.gfx.uCamPos;
    const rel = S.mod(local.sub(cam).add(R), R * 2).sub(R);
    const wpos = cam.add(rel);
    const m = new THREE.MeshBasicNodeMaterial({ transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false });
    m.positionNode = wpos.add(S.positionLocal.mul(h.mul(1.5).add(0.6)));
    m.colorNode = S.color(0xbfefff);
    m.opacityNode = S.float(0.5).mul(S.smoothstep(R, R * 0.4, S.length(rel))).mul(S.step(wpos.y, W.uLevel));
    const mesh = new THREE.Mesh(geo, m);
    mesh.frustumCulled = false; mesh.visible = false; mesh.userData.noShadow = true;
    scene.add(mesh);
    W.motes = mesh;
  }

  // ------------------------------------------------------------------
  // per-frame
  // ------------------------------------------------------------------
  W.update = function (dt, cam) {
    if (!W.ready) return;
    const wl = T().waterLevelAt(cam.x, cam.z);
    const under = wl !== null && cam.y < wl - 0.02;
    W.camUnder = U.damp(W.camUnder, under ? 1 : 0, 16, dt);
    if (under) W.camDepth = wl - cam.y;
    W.camLevel = wl;
    W.motes.visible = W.camUnder > 0.05;
    if (wl !== null) W.uLevel.value = wl;
    updateBubbles(dt);
    updateFish(dt, cam);
    updateWaterfall(dt, cam);
  };
})(window.G);

// decor.js — environment dressing with high-detail procedural geometry kept cheap:
//  * trees: ~8k-triangle procedural models near the camera and ~500-triangle models further away,
//    cross-faded per pixel with temporal dithering (no popping), plus low-poly shadow-only copies
//  * every prop is anchored at the lowest ground point under its footprint, with roots/trunks running
//    below the surface so nothing floats on slopes; trees that would clip buildings or roads are dropped
//  * bushes and hedges, rocks, pebbles, fences, lamp posts, windmills and arches
//  * a far terrain ring (rolling hills and snow-capped ranges) that carries the landscape to the horizon
(function (G) {
  'use strict';
  const U = G.U, P = G.physics, T = () => G.terrain, TAU = U.TAU;
  const D = (G.decor = { animated: [], sectors: [], nearSets: [] });
  let rng = U.rng(1234);

  // the physical sky (SkyMesh with procedural clouds) is created by gfx.js
  D.sky = function () {};

  function openGround(x, z, minRoad) {
    const t = T();
    if (Math.abs(x) > 356 || Math.abs(z) > 356) return false;
    const s = t.sample(x, z);
    if (s.type !== 'ground') return false;
    if (t.waterLevelAt(x, z) !== null) return false;
    if (s.h < t.WATER_Y + 2.5) return false;
    if (t.normalAt(x, z).y < 0.86) return false;
    if (t.roadDist(x, z) < (minRoad || 5)) return false;
    if (t.paving(x, z) > 0.05) return false;
    const C = t.castle;
    if (Math.hypot(x - C.x, z - C.z) < C.rim + 3) return false;
    return true;
  }
  D.openGround = openGround;
  // ground height to anchor a prop of footprint radius r: the lowest point under it, pushed down a bit
  const anchor = (x, z, r, sink) => T().groundMin(x, z, r) - (sink || 0);
  D.anchor = anchor;

  // ---------- geometry helpers ----------
  const AD = () => window.ADDONS;
  function weld(g) { // weld duplicated vertices so normals come out smooth
    ['uv', 'normal'].forEach((k) => g.getAttribute(k) && g.deleteAttribute(k));
    const w = AD().mergeVertices(g, 1e-4);
    w.computeVertexNormals();
    return w;
  }
  // lumpy displaced sphere (leaf clumps, boulders)
  function blob(r, detail, seed, rough, squash) {
    const g = weld(new THREE.IcosahedronGeometry(r, detail));
    const p = g.attributes.position;
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i), y = p.getY(i), z = p.getZ(i), l = Math.hypot(x, y, z) || 1;
      const dx = x / l, dy = y / l, dz = z / l;
      const n = U.vnoise(dx * 2.3 + seed, dz * 2.3 + dy * 1.9) * rough + U.vnoise(dx * 6.1 - seed, dy * 5.7 + dz * 4.9) * rough * 0.4;
      const k = 1 + n;
      p.setXYZ(i, x * k, y * k * (y < 0 ? (squash || 1) : 1), z * k);
    }
    g.computeVertexNormals();
    return g;
  }
  function cylinder(rTop, rBot, h, radial, rows, bumps, flare) {
    const g = new THREE.CylinderGeometry(rTop, rBot, h, radial, rows);
    g.deleteAttribute('uv');
    const p = g.attributes.position;
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i), y = p.getY(i) + h / 2, z = p.getZ(i);
      const a = Math.atan2(z, x);
      let k = 1 + (bumps ? U.vnoise(a * 2.2, y * 1.6) * bumps : 0);
      if (flare && y < 0.8) k *= 1 + (0.8 - y) * flare;
      p.setXYZ(i, x * k, y, z * k);
    }
    g.computeVertexNormals();
    return g;
  }
  // tree trunk with its base at y = 0 and roots continuing `sink` metres underground
  function trunk(rTop, rBot, h, radial, rows, bumps, flare, sink) {
    const H = h + sink;
    const g = new THREE.CylinderGeometry(rTop, rBot, H, radial, rows + 2);
    g.deleteAttribute('uv');
    const p = g.attributes.position;
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i), y = p.getY(i) + H / 2 - sink, z = p.getZ(i);
      const a = Math.atan2(z, x);
      let k = 1 + (bumps ? U.vnoise(a * 2.2, y * 1.6) * bumps : 0);
      if (flare && y < 0.8) k *= 1 + (0.8 - Math.max(y, -0.3)) * flare;
      p.setXYZ(i, x * k, y, z * k);
    }
    g.computeVertexNormals();
    return g;
  }
  function mergeParts(parts) {
    const m = AD().mergeGeometries(parts.map((g) => {
      ['uv'].forEach((k) => g.getAttribute(k) && g.deleteAttribute(k));
      if (!g.index) { const n = g.attributes.position.count, idx = new Uint32Array(n); for (let i = 0; i < n; i++) idx[i] = i; g.setIndex(new THREE.BufferAttribute(idx, 1)); }
      return g;
    }), false);
    m.computeBoundingSphere();
    return m;
  }

  // ---------- procedural tree models: 0 = near, 1 = far, 2 = shadow proxy ----------
  function roundTree(lod) {
    const tr = [trunk(0.2, 0.44, 4.2, lod ? 7 : 24, lod ? 1 : 14, lod ? 0 : 0.06, lod ? 0.3 : 0.55, 1.2)];
    if (!lod) {
      [[0.9, 3.3, 0.2, 0.9], [-0.8, 3.6, -0.4, -1.0], [0.1, 3.9, 0.9, 0.3]].forEach(([x, y, z, rot]) => {
        const b = cylinder(0.05, 0.11, 1.9, 8, 3, 0.05, 0).translate(0, 0.95, 0);
        b.rotateZ(-Math.sign(x || 1) * 0.9); b.rotateY(rot); b.translate(x * 0.3, y, z * 0.3);
        tr.push(b);
      });
    }
    const clumps = lod
      ? [[2.5, 0, 5.2, 0], [1.9, 0.8, 6.4, 0.2], [1.8, -0.9, 5.8, -0.4]]
      : [[2.3, 0, 5.0, 0], [1.8, 1.5, 6.0, 0.5], [1.7, -1.3, 5.7, -0.8], [1.5, 0.2, 7.0, -0.3], [1.35, -0.4, 5.7, 1.4], [1.25, 0.9, 4.8, -1.4]];
    const det = lod === 2 ? 1 : lod ? 3 : 9;
    const canopy = clumps.map(([r, x, y, z], i) => blob(r, det, i * 7.3 + 1, lod ? 0.12 : 0.2, 0.8).translate(x, y, z));
    return { trunk: mergeParts(tr), canopy: mergeParts(canopy) };
  }
  function pineTree(lod) {
    const tr = [trunk(0.16, 0.36, 3.4, lod ? 6 : 20, lod ? 1 : 10, lod ? 0 : 0.05, lod ? 0.3 : 0.5, 1.2)];
    const tiers = lod ? [[2.6, 3.4, 3.6], [1.9, 3.0, 5.4], [1.2, 2.6, 7.0]]
      : [[2.7, 3.0, 3.3], [2.3, 2.8, 4.6], [1.9, 2.6, 5.9], [1.4, 2.3, 7.1], [0.9, 2.0, 8.2]];
    const canopy = tiers.map(([r, h, y], ti) => {
      const g = new THREE.ConeGeometry(r, h, lod === 2 ? 7 : lod ? 12 : 44, lod ? 1 : 8, false);
      g.deleteAttribute('uv');
      const p = g.attributes.position;
      for (let i = 0; i < p.count; i++) {
        const vx = p.getX(i), vy = p.getY(i), vz = p.getZ(i);
        if (!lod && vy < -h / 2 + 0.01 && Math.hypot(vx, vz) > 0.1) { // jagged, drooping skirt (same offset for
          const ai = Math.round(Math.atan2(vz, vx) * 100);                // duplicated seam/cap vertices)
          const k = 1 + (U.hash2(ai, ti) - 0.5) * 0.25;
          p.setXYZ(i, vx * k, vy - U.hash2(ai + 7, ti) * 0.35, vz * k);
        }
      }
      g.computeVertexNormals();
      return g.translate(0, y, 0);
    });
    return { trunk: mergeParts(tr), canopy: mergeParts(canopy) };
  }

  // ---------- trees: dithered LOD cross-fade + shadow-only proxies ----------
  const trees = [];
  D.tree = function (x, z, kind, scale) { trees.push({ x, z, kind: kind || 'round', s: scale || (0.85 + rng() * 0.5) }); };
  D.forest = function (cx, cz, radius, count, kind, avoid) {
    let placed = 0, tries = 0;
    while (placed < count && tries < count * 20) {
      tries++;
      const a = rng() * Math.PI * 2, r = Math.sqrt(rng()) * radius;
      const x = cx + Math.cos(a) * r, z = cz + Math.sin(a) * r;
      if (!openGround(x, z)) continue;
      if (avoid && avoid(x, z)) continue;
      if (trees.some((t) => Math.abs(t.x - x) < 5 && Math.abs(t.z - z) < 5 && Math.hypot(t.x - x, t.z - z) < 5)) continue;
      D.tree(x, z, kind === 'mix' ? (rng() < 0.5 ? 'round' : 'pine') : kind);
      placed++;
    }
  };
  D.treeCount = () => trees.length;

  // does a trunk at (x,z) overlap a solid collider (walls, houses, platforms)?
  function clipsCollider(x, z, r, y) {
    const list = P.near(x, z, r + 1);
    for (let i = 0; i < list.length; i++) {
      const c = list[i];
      if (c.tag === 'tree') continue;
      if (c.isCyl) { if (Math.hypot(x - c.x, z - c.z) < c.r + r && c.y1 > y - 1) return true; continue; }
      const l = P.toLocal(c, x, z);
      if (Math.abs(l[0]) < c.hx + r && Math.abs(l[1]) < c.hz + r && c.y + c.hy > y - 0.5) return true;
    }
    return false;
  }

  let models = null;
  D.buildTrees = function (scene) {
    if (!models) models = { round: [roundTree(0), roundTree(1), roundTree(2)], pine: [pineTree(0), pineTree(1), pineTree(2)] };
    const gfx = G.gfx;
    // drop trees that would clip into buildings, walls or roads placed after the forests were planned
    for (let i = trees.length - 1; i >= 0; i--) {
      const t = trees[i];
      if (T().roadDist(t.x, t.z) < 3.2 || clipsCollider(t.x, t.z, 0.9 * t.s, T().heightAt(t.x, t.z))) trees.splice(i, 1);
    }
    const mk = (base, isFar, wind, leafScale) => {
      let m = new THREE.MeshStandardNodeMaterial(base);
      if (wind) { m = gfx.windFoliage(m, wind); gfx.playerFade(m); gfx.foliage(m, { scale: leafScale, cheap: isFar }); }
      gfx.cameraFade(m, 1.5, 4.5);
      return gfx.lodFade(m, isFar);
    };
    const bark = { color: 0x7a5232, roughness: 0.95 }, leaf = { color: 0xffffff, roughness: 0.82 };
    const mats = {
      near: { trunk: mk(bark, false), round: mk(leaf, false, 0.022, 0.6), pine: mk(leaf, false, 0.012, 0.4) },
      far: { trunk: mk(bark, true), round: mk(leaf, true, 0.022, 0.9), pine: mk(leaf, true, 0.012, 0.7) },
    };
    const HSL = { round: [0.235, 0.07, 0.55, 0.15, 0.23, 0.07], pine: [0.31, 0.05, 0.42, 0.12, 0.17, 0.05] };
    const o = new THREE.Object3D();
    trees.forEach((t) => {
      const y = anchor(t.x, t.z, 0.9 * t.s, 0.1);
      o.position.set(t.x, y, t.z); o.scale.setScalar(t.s); o.rotation.set(0, rng() * 6, 0); o.updateMatrix();
      t.matrix = o.matrix.clone();
      const h = HSL[t.kind];
      t.color = new THREE.Color().setHSL(h[0] + rng() * h[1], h[2] + rng() * h[3], h[4] + rng() * h[5]);
      // climbable: grab the trunk (E) and climb all the way up to balance on the crown
      P.addCyl({ x: t.x, z: t.z, r: 0.5 * t.s, y0: y - 1, y1: y + 3 * t.s, top: false, tag: 'tree',
        climb: { r: (t.kind === 'pine' ? 0.24 : 0.3) * t.s, top: y + (t.kind === 'pine' ? 9.0 : 8.4) * t.s, base: y } });
    });
    const inst = (geo, mat, list, withColor) => {
      const m = new THREE.InstancedMesh(geo, mat, Math.max(1, list.length));
      list.forEach((t, i) => { m.setMatrixAt(i, t.matrix); if (withColor) m.setColorAt(i, t.color); });
      m.count = list.length;
      m.instanceMatrix.needsUpdate = true;
      if (m.instanceColor) m.instanceColor.needsUpdate = true;
      m.computeBoundingSphere();
      return m;
    };
    // far models: per 100 m sector (frustum culled), always drawn, dithered away near the camera
    const buckets = {};
    trees.forEach((t) => { const k = Math.floor((t.x + 400) / 200) + ':' + Math.floor((t.z + 400) / 200); (buckets[k] = buckets[k] || []).push(t); });
    D.sectors = [];
    Object.values(buckets).forEach((list) => {
      ['round', 'pine'].forEach((kind) => {
        const arr = list.filter((t) => t.kind === kind);
        if (!arr.length) return;
        const md = models[kind][1];
        [inst(md.trunk, mats.far.trunk, arr, false), inst(md.canopy, mats.far[kind], arr, true)].forEach((m) => {
          m.castShadow = false; m.receiveShadow = true; m.userData.noShadow = true; scene.add(m);
        });
      });
    });
    // near models: one instanced mesh per kind, refilled with the trees around the camera
    D.nearSets = ['round', 'pine'].map((kind) => {
      const arr = trees.filter((t) => t.kind === kind);
      const md = models[kind][0];
      const tm = inst(md.trunk, mats.near.trunk, arr, false), cm = inst(md.canopy, mats.near[kind], arr, true);
      [tm, cm].forEach((m) => { m.count = 0; m.frustumCulled = false; m.castShadow = false; m.receiveShadow = true; m.userData.noShadow = true; scene.add(m); });
      return { trees: arr, trunk: tm, canopy: cm };
    });
    D.lastLod = null;
    // shadow-only low-poly copies (layer 1), one instanced mesh per model for the whole world (few draw calls
    // in every shadow cascade)
    const shTrunk = new THREE.MeshBasicNodeMaterial();
    const shLeaf = { round: gfx.windFoliage(new THREE.MeshBasicNodeMaterial(), 0.022), pine: gfx.windFoliage(new THREE.MeshBasicNodeMaterial(), 0.012) };
    ['round', 'pine'].forEach((kind) => {
      const arr = trees.filter((t) => t.kind === kind);
      if (!arr.length) return;
      const md = models[kind][2];
      [inst(md.trunk, shTrunk, arr, false), inst(md.canopy, shLeaf[kind], arr, false)].forEach((m) => {
        m.layers.set(gfx.SHADOW_LAYER); m.castShadow = true; m.receiveShadow = false; m.userData.noShadow = true;
        scene.add(m);
      });
    });
  };
  // refill the near-detail instance lists (a few hundred trees at most) when the camera has moved
  function updateLOD(cam) {
    if (!D.nearSets.length) return;
    if (D.lastLod && Math.abs(D.lastLod.x - cam.x) + Math.abs(D.lastLod.z - cam.z) < 1.5 && D.lastLod.q === G.gfx.quality) return;
    D.lastLod = { x: cam.x, z: cam.z, q: G.gfx.quality };
    const R = G.gfx.uLodNear.value + 9 + 7;
    D.nearSets.forEach((s) => {
      let n = 0;
      for (const t of s.trees) {
        const dx = t.x - cam.x, dz = t.z - cam.z;
        if (dx * dx + dz * dz > R * R) continue;
        s.trunk.setMatrixAt(n, t.matrix); s.canopy.setMatrixAt(n, t.matrix); s.canopy.setColorAt(n, t.color);
        n++;
      }
      s.trunk.count = s.canopy.count = n;
      s.trunk.instanceMatrix.needsUpdate = true; s.canopy.instanceMatrix.needsUpdate = true;
      if (s.canopy.instanceColor) s.canopy.instanceColor.needsUpdate = true;
    });
  }

  // ---------- bushes: small leafy clumps, instanced per sector ----------
  const bushes = [];
  D.bush = function (x, z, s) { bushes.push({ x, z, s: s || 0.7 + rng() * 0.7 }); };
  D.shrubs = function (cx, cz, radius, count, avoid) {
    let placed = 0, tries = 0;
    while (placed < count && tries < count * 12) {
      tries++;
      const a = rng() * Math.PI * 2, r = Math.sqrt(rng()) * radius;
      const x = cx + Math.cos(a) * r, z = cz + Math.sin(a) * r;
      if (!openGround(x, z, 3.2) || (avoid && avoid(x, z))) continue;
      D.bush(x, z);
      placed++;
    }
  };
  D.buildBushes = function (scene) {
    if (!bushes.length) return;
    const gfx = G.gfx;
    const geo = blob(1, 5, 5.1, 0.22, 0.6).translate(0, 0.45, 0);
    const shGeo = blob(1, 1, 5.1, 0.2, 0.6).translate(0, 0.45, 0);
    const mat = gfx.cameraFade(gfx.foliage(gfx.windFoliage(new THREE.MeshStandardNodeMaterial({ color: 0xffffff, roughness: 0.85 }), 0.03), { scale: 0.4, aoMin: 0.45 }), 1.2, 3.5);
    const shMat = new THREE.MeshBasicNodeMaterial();
    const buckets = {};
    const o = new THREE.Object3D(), c = new THREE.Color();
    for (let i = bushes.length - 1; i >= 0; i--) {
      const b = bushes[i];
      if (clipsCollider(b.x, b.z, b.s, T().heightAt(b.x, b.z))) { bushes.splice(i, 1); continue; }
    }
    const shAll = new THREE.InstancedMesh(shGeo, shMat, bushes.length);
    let si = 0;
    bushes.forEach((b) => { const k = Math.floor((b.x + 400) / 200) + ':' + Math.floor((b.z + 400) / 200); (buckets[k] = buckets[k] || []).push(b); });
    Object.values(buckets).forEach((list) => {
      const m = new THREE.InstancedMesh(geo, mat, list.length);
      list.forEach((b, i) => {
        o.position.set(b.x, anchor(b.x, b.z, b.s, 0.25), b.z);
        o.rotation.set(0, rng() * 6, 0); o.scale.set(b.s * (1 + rng() * 0.4), b.s * (0.75 + rng() * 0.3), b.s * (1 + rng() * 0.4)); o.updateMatrix();
        m.setMatrixAt(i, o.matrix); shAll.setMatrixAt(si++, o.matrix);
        m.setColorAt(i, c.setHSL(0.24 + rng() * 0.08, 0.55 + rng() * 0.15, 0.2 + rng() * 0.08));
      });
      m.instanceMatrix.needsUpdate = true; m.instanceColor.needsUpdate = true; m.computeBoundingSphere();
      m.castShadow = false; m.receiveShadow = true; m.userData.noShadow = true;
      scene.add(m);
    });
    shAll.instanceMatrix.needsUpdate = true; shAll.computeBoundingSphere();
    shAll.layers.set(gfx.SHADOW_LAYER); shAll.castShadow = true; shAll.receiveShadow = false; shAll.userData.noShadow = true;
    scene.add(shAll);
  };

  // ---------- meadow: grass tufts and wildflowers placed once in the world (never generated around the
  // camera, so nothing "grows" as you move). Instanced per 64 m sector; the detailed tuft cross-fades to a
  // simple one with temporal dithering, and everything dissolves at a distance where it is only pixels tall.
  function tuftGeometry(blades, segs, width, seed) {
    const r = U.rng(seed), pos = [], col = [], nrm = [], idx = [];
    for (let b = 0; b < blades; b++) {
      const a = (b / blades) * TAU + r() * 0.8, h = 0.38 + r() * 0.38, lean = 0.12 + r() * 0.22;
      const ox = Math.cos(a) * 0.09 * r(), oz = Math.sin(a) * 0.09 * r();
      const dx = Math.cos(a), dz = Math.sin(a), px = -dz, pz = dx; // blade faces sideways to its lean
      const base = pos.length / 3;
      for (let i = 0; i <= segs; i++) {
        const f = i / segs, w = width * (1 - f * 0.9), y = h * f, off = lean * f * f;
        const cx = ox + dx * off, cz = oz + dz * off;
        if (i < segs) { pos.push(cx - px * w, y, cz - pz * w, cx + px * w, y, cz + pz * w); col.push(f, f, f, f, f, f); nrm.push(0, 1, 0, 0, 1, 0); }
        else { pos.push(cx, y, cz); col.push(1, 1, 1); nrm.push(0, 1, 0); }
      }
      for (let i = 0; i < segs - 1; i++) { const q = base + i * 2; idx.push(q, q + 1, q + 2, q + 1, q + 3, q + 2); }
      const q = base + (segs - 1) * 2; idx.push(q, q + 1, q + 2);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
    g.setAttribute('aH', new THREE.Float32BufferAttribute(col.filter((_, k) => k % 3 === 0), 1));
    g.setIndex(idx);
    g.computeBoundingSphere();
    return g;
  }
  function flowerGeometry() {
    const pos = [0, 0, 0, 0.015, 0, 0, 0, 0.42, 0, 0.015, 0.42, 0], h = [0, 0, 0, 0], idx = [0, 1, 2, 1, 3, 2], nrm = [0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0];
    const c = 4; pos.push(0, 0.46, 0); h.push(2); nrm.push(0, 1, 0);
    for (let i = 0; i < 10; i++) { const a = (i / 10) * TAU, r = i % 2 ? 0.05 : 0.14; pos.push(Math.cos(a) * r, 0.44, Math.sin(a) * r); h.push(1); nrm.push(0, 1, 0); }
    for (let i = 0; i < 10; i++) idx.push(c, c + 1 + i, c + 1 + ((i + 1) % 10));
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
    g.setAttribute('aH', new THREE.Float32BufferAttribute(h, 1));
    g.setIndex(idx);
    return g;
  }
  // wind sway plus blades bending away from the player's feet (instance transform already in positionLocal)
  function meadowPosition(k) {
    const S = window.TSL, gfx = G.gfx, w = S.positionLocal, t = gfx.uTime, hgt = S.positionGeometry.y.max(0);
    const gust = S.texture(gfx.noiseTex, w.xz.mul(0.02).add(S.vec2(t.mul(0.02), t.mul(0.012)))).level(0).r.mul(2).sub(1);
    const ph = w.x.mul(0.37).add(w.z.mul(0.29));
    const sway = S.vec2(S.sin(t.mul(2.3).add(ph)).mul(0.25).add(gust.mul(0.6)).add(0.3), S.cos(t.mul(1.7).add(ph.mul(1.3))).mul(0.2).add(gust.mul(0.4))).mul(hgt.mul(hgt)).mul(k);
    const toP = w.xz.sub(gfx.uPlayer.xz), dP = S.length(toP);
    const near = S.smoothstep(1.3, 0.2, dP).mul(S.smoothstep(1.8, 0.3, S.abs(gfx.uPlayer.y.sub(w.y))));
    const push = S.normalize(toP.add(S.vec2(0.0001, 0))).mul(near.mul(hgt).mul(0.55));
    return w.add(S.vec3(sway.x.add(push.x), near.mul(hgt).mul(-0.3), sway.y.add(push.y)));
  }
  function meadowMaterial(kind, isFar) {
    const S = window.TSL, gfx = G.gfx;
    const m = new THREE.MeshLambertNodeMaterial({ side: THREE.DoubleSide });
    m.positionNode = meadowPosition(kind === 'flower' ? 0.5 : 1);
    const h = S.attribute('aH', 'float');
    if (kind === 'flower') {
      const petal = S.step(0.5, h), center = S.step(1.5, h);
      m.colorNode = S.mix(S.mix(S.color(0x2f6a1e), S.color(0xffffff), petal), S.color(0xffd23a), center);
      m.emissiveNode = S.color(0xffffff).mul(petal.mul(0.05));
    } else {
      const patch = S.texture(gfx.noiseTex, S.positionWorld.xz.mul(1 / 90)).r;
      m.colorNode = S.mix(S.mix(S.color(0x1f4a10), S.color(0x2d6016), patch), S.mix(S.color(0x5a9a2a), S.color(0x8cbc3c), patch), h);
      // sunlight through the blades when looking toward the sun
      const V = S.normalize(S.positionWorld.sub(S.cameraPosition));
      const back = S.pow(S.max(S.dot(V, gfx.SUNV), 0), 3);
      m.emissiveNode = S.diffuseColor.rgb.mul(S.vec3(1.1, 1.05, 0.5)).mul(back.mul(h).mul(0.9));
    }
    m.normalNode = gfx.toView(S.vec3(0, 1, 0));
    if (kind !== 'flower') gfx.lodFade(m, isFar, 7, gfx.uTuftNear);
    gfx.farFade(m, kind === 'flower' ? gfx.uTuftFar.mul(0.6) : gfx.uTuftFar, 35);
    return m;
  }
  D.meadow = [];
  D.buildMeadow = function (scene) {
    const T0 = T(), gfx = G.gfx, W = T0.N + 1, H = T0.HALF;
    const gm = gfx.grassFinal, fm = gfx.flowerFinal;
    if (!gm) return;
    const rnd = U.rng(4242), step = 1.2, SEC = 64;
    const buckets = new Map();
    const put = (key, list, v) => { let b = buckets.get(key); if (!b) buckets.set(key, (b = { t: [], f: [] })); b[list].push(v); };
    for (let z = -H + 2; z < H - 2; z += step) for (let x = -H + 2; x < H - 2; x += step) {
      const jx = x + (rnd() - 0.5) * step, jz = z + (rnd() - 0.5) * step;
      const k = Math.round(jz + H) * W + Math.round(jx + H);
      const g = gm[k];
      if (!(g > 0.2)) continue;
      const patch = U.vnoise(jx * 0.05 + 3, jz * 0.05 - 5) * 0.5 + 0.5;          // clumps of long grass and open lawn
      if (rnd() > g * (0.18 + 0.75 * patch * patch)) continue;
      const key = Math.floor((jx + H) / SEC) + ':' + Math.floor((jz + H) / SEC);
      put(key, 't', [jx, jz, 0.75 + patch * 0.75 + rnd() * 0.25]);
      const f = fm[k];
      if (f > 0.15 && rnd() < f * 0.9) put(key, 'f', [jx + (rnd() - 0.5) * 0.9, jz + (rnd() - 0.5) * 0.9]);
    }
    const geo = { near: tuftGeometry(7, 3, 0.045, 11), far: tuftGeometry(3, 1, 0.075, 12), flower: flowerGeometry() };
    const mats = { near: meadowMaterial('tuft', false), far: meadowMaterial('tuft', true), flower: meadowMaterial('flower', false) };
    const PET = [0xff4f8b, 0xffe14a, 0xffffff, 0xa77bff, 0xff8a3d, 0x6fc8ff];
    const o = new THREE.Object3D(), c = new THREE.Color();
    D.meadow = [];
    buckets.forEach((b) => {
      const sec = { cx: 0, cz: 0, r: 0, meshes: {} };
      const all = b.t.length ? b.t : b.f;
      all.forEach((p) => { sec.cx += p[0]; sec.cz += p[1]; });
      sec.cx /= all.length; sec.cz /= all.length;
      all.forEach((p) => { sec.r = Math.max(sec.r, Math.hypot(p[0] - sec.cx, p[1] - sec.cz)); });
      sec.r += 1;
      const mk = (g, mat, list, colorFn) => {
        const m = new THREE.InstancedMesh(g, mat, list.length);
        list.forEach((p, i) => {
          const y = T0.heightAt(p[0], p[1]) - 0.04, s = p[2] || 1;
          o.position.set(p[0], y, p[1]); o.rotation.set(0, rnd() * TAU, 0); o.scale.set(s * (0.9 + rnd() * 0.3), s * (0.85 + rnd() * 0.3), s * (0.9 + rnd() * 0.3)); o.updateMatrix();
          m.setMatrixAt(i, o.matrix); m.setColorAt(i, colorFn(c));
        });
        m.instanceMatrix.needsUpdate = true; m.instanceColor.needsUpdate = true; m.computeBoundingSphere();
        m.castShadow = false; m.receiveShadow = true; m.userData.noShadow = true; m.visible = false;
        scene.add(m);
        return m;
      };
      const tuftCol = (cc) => { const v = 0.82 + rnd() * 0.3; return cc.setRGB(v * (0.92 + rnd() * 0.22), v * (0.95 + rnd() * 0.1), v * (0.85 + rnd() * 0.2)); };
      if (b.t.length) { sec.meshes.near = mk(geo.near, mats.near, b.t, tuftCol); sec.meshes.far = mk(geo.far, mats.far, b.t, tuftCol); }
      if (b.f.length) sec.meshes.flower = mk(geo.flower, mats.flower, b.f, (cc) => cc.setHex(PET[Math.floor(rnd() * PET.length)]));
      D.meadow.push(sec);
    });
    D.meadowCount = [...buckets.values()].reduce((a, b) => [a[0] + b.t.length, a[1] + b.f.length], [0, 0]);
  };
  function updateMeadow(cam) {
    const gfx = G.gfx, nearR = gfx.uTuftNear.value + 7, farR = gfx.uTuftFar.value;
    for (const s of D.meadow) {
      const d = Math.hypot(cam.x - s.cx, cam.z - s.cz), dMin = d - s.r, dMax = d + s.r;
      const inRange = dMin < farR;
      if (s.meshes.near) s.meshes.near.visible = inRange && dMin < nearR;
      if (s.meshes.far) s.meshes.far.visible = inRange && dMax > nearR - 14;
      if (s.meshes.flower) s.meshes.flower.visible = dMin < farR * 0.6;
    }
  }

  // ---------- flowers: zones feed the meadow builder (flower density per terrain vertex) ----------
  D.flowerZones = [];
  D.flowers = function (scene, cx, cz, radius) { D.flowerZones.push({ x: cx, z: cz, r: radius, d: 1 }); };

  // ---------- rocks: one vertex-coloured material with baked-noise detail ----------
  let rockMat = null;
  function rockMaterial() {
    if (rockMat) return rockMat;
    const S = window.TSL;
    const m = new THREE.MeshStandardNodeMaterial({ roughness: 0.9, metalness: 0 });
    const wp = S.positionWorld;
    const n1 = S.texture(G.gfx.noiseTex, S.vec2(wp.x.add(wp.y.mul(0.6)), wp.z.sub(wp.y.mul(0.4))).mul(1 / 5.5));
    const tone = n1.r.mul(0.3).add(n1.a.mul(0.2)).add(0.55);
    const mossy = S.smoothstep(0.55, 0.9, S.normalWorld.y).mul(S.smoothstep(0.45, 0.7, n1.g));
    m.colorNode = S.mix(S.attribute('color', 'vec3').mul(tone), S.color(0x4e7a2a), mossy.mul(0.8));
    const nm = S.texture(G.gfx.normalTex, S.vec2(wp.x.add(wp.z), wp.y).mul(1 / 2.2)).xyz.mul(2).sub(1);
    const nW = S.normalize(S.normalWorld.add(S.vec3(nm.x, nm.y, nm.x.sub(nm.y)).mul(0.45)));
    m.normalNode = S.normalize(S.cameraViewMatrix.mul(S.vec4(nW, 0)).xyz);
    rockMat = G.gfx.cameraFade(m, 1.2, 3.5);
    return rockMat;
  }
  D.rockMaterial = rockMaterial;
  function tint(g, hex) {
    const c = new THREE.Color(hex), n = g.attributes.position.count, a = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) { a[i * 3] = c.r; a[i * 3 + 1] = c.g; a[i * 3 + 2] = c.b; }
    g.setAttribute('color', new THREE.BufferAttribute(a, 3));
    return g;
  }
  D.tint = tint;
  D.rock = function (scene, x, z, s, solid, color) {
    const yc = T().heightAt(x, z), y = anchor(x, z, s * 0.9);
    const geo = tint(blob(s, 9, rng() * 100, 0.24, 0.72), color || [0x8f877e, 0x9c9185, 0x827a70, 0x958a7b][Math.floor(rng() * 4)]);
    const m = new THREE.Mesh(geo, rockMaterial());
    m.position.set(x, y + s * 0.18, z); m.rotation.set(rng() * 0.4, rng() * 6, rng() * 0.4);
    m.castShadow = true; m.receiveShadow = true;
    m.userData.static = true;
    scene.add(m);
    if (solid !== false) P.addCyl({ x, z, r: s * 0.85, y0: y - 1, y1: Math.max(yc + 0.3, y + s * 0.18 + s * 0.8) });
    return m;
  };
  D.rockField = function (scene, cx, cz, radius, count, minS, maxS) {
    for (let i = 0; i < count; i++) {
      const a = rng() * Math.PI * 2, r = Math.sqrt(rng()) * radius;
      const x = cx + Math.cos(a) * r, z = cz + Math.sin(a) * r;
      if (!openGround(x, z, 4)) continue;
      D.rock(scene, x, z, minS + rng() * (maxS - minS));
    }
  };

  // ---------- scattered pebbles: trail edges and meadows, instanced per sector ----------
  D.scatterPebbles = function (scene) {
    const MT = T().mtn, pts = [];
    for (let t = 0.3; t < MT.T - 0.4; t += 0.06) {
      const hw = MT.hw(t);
      [hw - 0.35, -(hw - 0.35)].forEach((lat) => {
        if (rng() < 0.45) return;
        const p = MT.point(t + (rng() - 0.5) * 0.03, lat + (rng() - 0.5) * 0.5);
        pts.push([p.x, p.z, 0.22 + rng() * 0.42]);
      });
    }
    // along every road edge and over open ground
    T().ROADS.forEach((line) => {
      for (let i = 0; i < line.length - 1; i++) {
        const [ax, az] = line[i], [bx, bz] = line[i + 1], len = Math.hypot(bx - ax, bz - az);
        const nx = -(bz - az) / len, nz = (bx - ax) / len;
        for (let d = 0; d < len; d += 1.3) {
          if (rng() < 0.55) continue;
          const side = rng() < 0.5 ? -1 : 1, off = 3.2 + rng() * 1.4;
          const x = ax + (bx - ax) * (d / len) + nx * side * off, z = az + (bz - az) * (d / len) + nz * side * off;
          if (T().waterLevelAt(x, z) !== null || T().paving(x, z) > 0.05) continue;
          pts.push([x, z, 0.16 + rng() * 0.3]);
        }
      }
    });
    for (let i = 0; i < 2200; i++) {
      const x = (rng() - 0.5) * 720, z = (rng() - 0.5) * 720;
      if (!openGround(x, z, 3.2)) continue;
      pts.push([x, z, 0.18 + rng() * 0.32]);
    }
    const geo = tint(blob(1, 2, 3.3, 0.25, 0.65), 0xffffff);
    const buckets = {};
    pts.forEach((p) => { const k = Math.floor((p[0] + 400) / 200) + ':' + Math.floor((p[1] + 400) / 200); (buckets[k] = buckets[k] || []).push(p); });
    const o = new THREE.Object3D(), c = new THREE.Color();
    Object.values(buckets).forEach((list) => {
      const m = new THREE.InstancedMesh(geo, rockMaterial(), list.length);
      list.forEach(([x, z, s], i) => {
        o.position.set(x, anchor(x, z, s * 0.8) + s * 0.1, z);
        o.rotation.set(rng() * 3, rng() * 6, rng() * 3); o.scale.set(s * (0.8 + rng() * 0.5), s * (0.6 + rng() * 0.4), s * (0.8 + rng() * 0.5));
        o.updateMatrix(); m.setMatrixAt(i, o.matrix);
        m.setColorAt(i, c.setHSL(0.08 + rng() * 0.04, 0.1 + rng() * 0.08, 0.19 + rng() * 0.1));
      });
      m.instanceMatrix.needsUpdate = true; m.instanceColor.needsUpdate = true;
      m.computeBoundingSphere();
      m.castShadow = false; m.receiveShadow = true; m.userData.noShadow = true;
      scene.add(m);
    });
  };

  // ---------- fences (posts + rails, solid) ----------
  D.fence = function (scene, pts, gaps) {
    const mat = G.texMat('wood', 1, 1);
    const postGeo = G.bevelBox(0.35, 2.3, 0.35, 0.06);
    for (let i = 0; i < pts.length - 1; i++) {
      if (gaps && gaps.includes(i)) continue;
      const [x0, z0] = pts[i], [x1, z1] = pts[i + 1];
      const len = Math.hypot(x1 - x0, z1 - z0), yaw = Math.atan2(x1 - x0, z1 - z0);
      const n = Math.ceil(len / 3.5);
      let yMin = Infinity, yMax = -Infinity;
      for (let k = 0; k <= n; k++) {
        const x = U.lerp(x0, x1, k / n), z = U.lerp(z0, z1, k / n), gy = T().heightAt(x, z);
        yMin = Math.min(yMin, gy); yMax = Math.max(yMax, gy);
        // posts run 0.8 m into the ground so they stand firm on slopes
        const p = new THREE.Mesh(postGeo, mat); p.position.set(x, anchor(x, z, 0.25) + 0.35, z); p.userData.static = true; scene.add(p);
      }
      const mx = (x0 + x1) / 2, mz = (z0 + z1) / 2;
      const y = (T().heightAt(x0, z0) + T().heightAt(x1, z1) + T().heightAt(mx, mz)) / 3;
      const pitch = Math.atan2(T().heightAt(x1, z1) - T().heightAt(x0, z0), len);
      [0.55, 1.1].forEach((h) => {
        const r = new THREE.Mesh(G.bevelBox(0.15, 0.22, len / Math.cos(pitch), 0.05), mat);
        r.position.set(mx, y + h, mz); r.rotation.set(0, yaw, 0); r.rotateX(-pitch); r.userData.static = true; scene.add(r);
      });
      P.addBox({ x: mx, y: y + 0.4, z: mz, hx: 0.2, hy: 0.95 + (yMax - yMin) / 2, hz: len / 2, yaw, tag: 'fence' });
    }
  };

  // ---------- hedges (clipped box shrubs for gardens) ----------
  let hedgeMat = null;
  D.hedge = function (scene, x0, z0, x1, z1, h, w) {
    if (!hedgeMat) {
      const S = window.TSL, m = new THREE.MeshStandardNodeMaterial({ roughness: 0.9 });
      const wp = S.positionWorld;
      const n = S.texture(G.gfx.noiseTex, S.vec2(wp.x.add(wp.y), wp.z.sub(wp.y)).mul(1 / 1.6));
      m.colorNode = S.mix(S.color(0x1f5a1c), S.color(0x4d8a2c), n.r.mul(0.8).add(n.b.mul(0.4)).clamp(0, 1));
      const nm = S.texture(G.gfx.normalTex, S.vec2(wp.x.add(wp.z), wp.y).mul(1 / 0.9)).xyz.mul(2).sub(1);
      m.normalNode = S.normalize(S.cameraViewMatrix.mul(S.vec4(S.normalize(S.normalWorld.add(S.vec3(nm.x, nm.y, nm.x.sub(nm.y)).mul(0.9))), 0)).xyz);
      hedgeMat = G.gfx.cameraFade(m, 1.2, 3.2);
    }
    const len = Math.hypot(x1 - x0, z1 - z0), yaw = Math.atan2(x1 - x0, z1 - z0);
    const mx = (x0 + x1) / 2, mz = (z0 + z1) / 2;
    const n = Math.max(1, Math.round(len / 6));
    for (let i = 0; i < n; i++) {
      const f0 = i / n, f1 = (i + 1) / n;
      const cx = U.lerp(x0, x1, (f0 + f1) / 2), cz = U.lerp(z0, z1, (f0 + f1) / 2);
      const y = anchor(cx, cz, len / n / 2, 0.3);
      const m = new THREE.Mesh(G.bevelBox(w || 1.3, (h || 1.6) + 0.5, len / n + 0.02, 0.35), hedgeMat);
      m.position.set(cx, y + ((h || 1.6) + 0.5) / 2, cz); m.rotation.y = yaw; m.userData.static = true;
      m.castShadow = true; m.receiveShadow = true;
      scene.add(m);
    }
    P.addBox({ x: mx, y: T().heightAt(mx, mz) + (h || 1.6) / 2, z: mz, hx: (w || 1.3) / 2, hy: (h || 1.6) / 2 + 0.3, hz: len / 2, yaw, tag: 'hedge' });
  };

  // ---------- lamp posts (glowing lanterns) ----------
  D.lamp = function (scene, x, z) {
    const y = anchor(x, z, 0.3, 0.2);
    const iron = G.mat(0x2b2f36, { metalness: 0.7, roughness: 0.45 });
    const post = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.14, 4.4, 16), iron);
    post.position.set(x, y + 2.2, z); post.userData.static = true; scene.add(post);
    const foot = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.34, 0.6, 16), iron);
    foot.position.set(x, y + 0.3, z); foot.userData.static = true; scene.add(foot);
    const cap = new THREE.Mesh(new THREE.ConeGeometry(0.42, 0.45, 6), iron);
    cap.position.set(x, y + 5.1, z); cap.userData.static = true; scene.add(cap);
    const glass = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.22, 0.62, 6), G.mat(0xffe6a0, { emissive: 0xffc860, emissiveIntensity: 1.6, roughness: 0.3 }));
    glass.position.set(x, y + 4.62, z); glass.userData.static = true; scene.add(glass);
    P.addCyl({ x, z, r: 0.25, y0: y, y1: y + 4.9, top: false, tag: 'lamp' });
  };

  // ---------- windmill landmark ----------
  D.windmill = function (scene, x, z, big) {
    const k = big || 1;
    const y = anchor(x, z, 3.6 * k, 0.6);
    const tower = new THREE.Mesh(new THREE.CylinderGeometry(2.4 * k, 3.6 * k, 12.6 * k, 36, 4), G.texMat('brick', 3, 4));
    tower.position.set(x, y + 6.3 * k, z); tower.userData.static = true; scene.add(tower);
    const roof = new THREE.Mesh(new THREE.ConeGeometry(3.25 * k, 3.5 * k, 36, 3), G.mat(0xd8402e, { roughness: 0.6 }));
    roof.position.set(x, y + 14.3 * k, z); roof.userData.static = true; scene.add(roof);
    const trim = new THREE.Mesh(new THREE.TorusGeometry(2.55 * k, 0.18 * k, 10, 48), G.texMat('wood', 6, 1));
    trim.rotation.x = Math.PI / 2; trim.position.set(x, y + 12.6 * k, z); trim.userData.static = true; scene.add(trim);
    const door = new THREE.Mesh(G.bevelBox(1.6 * k, 2.6 * k, 0.4, 0.08), G.texMat('wood', 1, 2, 0x8a5a30));
    door.position.set(x, y + 1.9 * k, z - 3.3 * k); door.userData.static = true; scene.add(door);
    const hub = new THREE.Group(); hub.position.set(x, y + 11.1 * k, z + 3.0 * k); scene.add(hub);
    const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.5 * k, 0.5 * k, 1, 24), G.mat(0x5a3418)); cap.rotation.x = Math.PI / 2; hub.add(cap);
    for (let i = 0; i < 4; i++) {
      const blade = new THREE.Mesh(G.bevelBox(1.3 * k, 8 * k, 0.15, 0.05), G.texMat('wood', 1, 3, 0xfff0d8));
      blade.position.y = 4.2 * k; const arm = new THREE.Group(); arm.rotation.z = (i * Math.PI) / 2; arm.add(blade); hub.add(arm);
    }
    P.addCyl({ x, z, r: 3.3 * k, y0: y - 1, y1: y + 12.6 * k });
    D.animated.push((dt) => { hub.rotation.z += dt * 0.7; });
  };

  // ---------- trailhead arch ----------
  D.arch = function (scene, x, z, yaw, w) {
    const y = T().heightAt(x, z);
    const cx = Math.cos(yaw), sz = -Math.sin(yaw);
    [-1, 1].forEach((s) => {
      const px = x + cx * s * w / 2, pz = z + sz * s * w / 2;
      const py = anchor(px, pz, 0.8);
      G.solidBox(scene, px, py + 3.2, pz, 1.4, 7.4, 1.4, G.texMat('stone', 1, 4));
    });
    const beam = new THREE.Mesh(G.bevelBox(w + 2.2, 1.2, 1.6), G.texMat('wood', 4, 1));
    beam.position.set(x, y + 7, z); beam.rotation.y = yaw; beam.userData.static = true; scene.add(beam);
    const banner = new THREE.Mesh(G.bevelBox(w * 0.6, 1.4, 0.1, 0.03), G.mat(0xe8283a, { roughness: 0.8 }));
    banner.position.set(x, y + 5.8, z); banner.rotation.y = yaw; banner.userData.static = true; scene.add(banner);
  };

  // ---------- far terrain: the landscape continues to the horizon (hills, then snow-capped ranges) ----------
  D.vista = function (scene) {
    const T0 = T(), HALF = T0.HALF, OUT = 3600, I = 160, J = 60;
    const farH = (x, z) => {
      const e = Math.max(Math.abs(x), Math.abs(z));
      let h = T0.baseHeight(x, z);
      const k = U.smoothstep(398, 900, e);
      if (k > 0) {
        const ridge = 1 - Math.abs(U.vnoise(x * 0.0024 + 11, z * 0.0024 - 3));
        const ridge2 = 1 - Math.abs(U.vnoise(x * 0.0071 - 4, z * 0.0071 + 8));
        const m = Math.pow(ridge, 2.2) * 440 + Math.pow(ridge2, 2) * 110 * U.smoothstep(398, 600, e) + (U.vnoise(x * 0.006 + 7, z * 0.006) * 0.5 + 0.5) * 70 + U.vnoise(x * 0.021, z * 0.021) * 18;
        h += k * m;
      }
      return h;
    };
    const corners = [[-HALF, -HALF], [HALF, -HALF], [HALF, HALF], [-HALF, HALF]];
    const geos = [];
    for (let side = 0; side < 4; side++) {
      const [ax, az] = corners[side], [bx, bz] = corners[(side + 1) % 4];
      const pos = new Float32Array((I + 1) * (J + 1) * 3);
      for (let j = 0; j <= J; j++) {
        const t = Math.pow(j / J, 2.1);
        const s = U.lerp(0.99, OUT / HALF, t);
        for (let i = 0; i <= I; i++) {
          const u = i / I, x = U.lerp(ax, bx, u) * s, z = U.lerp(az, bz, u) * s, v = (j * (I + 1) + i) * 3;
          pos[v] = x; pos[v + 1] = farH(x, z) - (j === 0 ? 1.5 : 0); pos[v + 2] = z;
        }
      }
      const idx = [];
      for (let j = 0; j < J; j++) for (let i = 0; i < I; i++) {
        const a = j * (I + 1) + i, b = a + 1, cc = a + I + 1, d = cc + 1;
        idx.push(a, b, cc, b, d, cc);
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
      g.setIndex(idx);
      g.computeVertexNormals();
      // make sure every triangle faces up
      const nrm = g.attributes.normal;
      if (nrm.getY(Math.floor(nrm.count / 2)) < 0) { g.setIndex(idx.map((_, k) => idx[k - (k % 3) + [0, 2, 1][k % 3]])); g.computeVertexNormals(); }
      geos.push(g);
    }
    const merged = window.ADDONS.mergeGeometries(geos, false);
    merged.computeBoundingSphere();
    const m = new THREE.Mesh(merged, G.gfx.vistaMaterial());
    m.userData.noShadow = true; m.castShadow = false; m.receiveShadow = false;
    scene.add(m);
    D.farTerrain = m;
  };

  D.blob = blob;
  D.cylinder = cylinder;

  D.update = function (dt, camPos) {
    for (const f of D.animated) f(dt);
    if (camPos) { updateLOD(camPos); updateMeadow(camPos); }
  };
  D.reset = function () {
    trees.length = 0; bushes.length = 0; D.animated = []; D.flowerZones = []; D.sectors = []; D.nearSets = []; D.lastLod = null; D.meadow = [];
    rng = U.rng(1234);
  };
})(window.G);

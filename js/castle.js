// castle.js — Brightkeep Castle (the big landmark on its moated island), the stone bridge, the plaza
// with its fountain, formal gardens with hedges and lamps, Hollyhock Village and the Windmill Downs mill.
// Everything is built from procedural geometry with world-space (triplanar) stone so block sizes match
// across walls and towers; colliders follow the visible shapes (stepped roofs, parapets, bridge ramp).
(function (G) {
  'use strict';
  const U = G.U, P = G.physics, TAU = U.TAU;
  const CS = (G.castle = { flags: [] });
  const T = () => G.terrain;
  let M = null;

  // ------------------------------------------------------------------
  // materials
  // ------------------------------------------------------------------
  function bannerTexture() {
    const W = 128, H = 320, cv = document.createElement('canvas'); cv.width = W; cv.height = H;
    const c = cv.getContext('2d');
    c.fillStyle = '#c8202e'; c.fillRect(0, 0, W, H);
    c.fillStyle = '#ffd23a'; c.fillRect(0, 0, W, 14); c.fillRect(0, 0, 10, H); c.fillRect(W - 10, 0, 10, H);
    c.beginPath(); c.moveTo(0, H - 60); c.lineTo(W / 2, H - 10); c.lineTo(W, H - 60); c.lineTo(W, H); c.lineTo(0, H); c.closePath();
    c.globalCompositeOperation = 'destination-out'; c.fill(); c.globalCompositeOperation = 'source-over';
    const cx = W / 2, cy = 120;
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * TAU;
      c.fillStyle = '#ffd23a';
      c.beginPath(); c.moveTo(cx + Math.cos(a - 0.2) * 22, cy + Math.sin(a - 0.2) * 22); c.lineTo(cx + Math.cos(a) * 44, cy + Math.sin(a) * 44); c.lineTo(cx + Math.cos(a + 0.2) * 22, cy + Math.sin(a + 0.2) * 22); c.fill();
    }
    c.beginPath(); c.arc(cx, cy, 22, 0, TAU); c.fill();
    c.fillStyle = '#fff3b0'; c.beginPath(); c.arc(cx, cy, 13, 0, TAU); c.fill();
    const t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 16;
    return t;
  }
  function materials() {
    if (M) return M;
    const S = window.TSL;
    let M_hall, M_ceiling, M_marble, M_carpet;
    // world-space triplanar texturing: identical block size on every wall, tower and pier
    const tri = (src, scale, tint, rough, bump) => {
      const m = new THREE.MeshStandardNodeMaterial({ roughness: rough || 0.86, metalness: 0 });
      const wp = S.positionWorld.mul(scale), n = S.normalWorld;
      const w0 = S.pow(S.abs(n), S.vec3(4, 4, 4)), w = w0.div(w0.x.add(w0.y).add(w0.z));
      const col = S.texture(src.map, wp.zy).rgb.mul(w.x).add(S.texture(src.map, wp.xz).rgb.mul(w.y)).add(S.texture(src.map, wp.xy).rgb.mul(w.z));
      m.colorNode = col.mul(S.color(tint));
      const nx = S.texture(src.normalMap, wp.zy).xyz.mul(2).sub(1), ny = S.texture(src.normalMap, wp.xz).xyz.mul(2).sub(1), nz = S.texture(src.normalMap, wp.xy).xyz.mul(2).sub(1);
      const pert = S.vec3(0, nx.y, nx.x.mul(S.sign(n.x))).mul(w.x).add(S.vec3(ny.x, 0, ny.y).mul(w.y)).add(S.vec3(nz.x.mul(S.sign(n.z)), nz.y, 0).mul(w.z));
      m.normalNode = G.gfx.toView(S.normalize(n.add(pert.mul(bump || 0.9))));
      return m;
    };
    const roofMat = (hex, src) => new THREE.MeshStandardMaterial({ map: src.map, normalMap: src.normalMap, color: hex, roughness: 0.55, metalness: 0 });
    M = {
      stone: tri(G.tex.ashlar, 1 / 3.2, 0xfff6e6),
      stoneDark: tri(G.tex.stone, 1 / 2.6, 0xe0d6c4, 0.9),
      plaster: tri(G.tex.plaster, 1 / 3.4, 0xffffff, 0.95, 0.6),
      roof: roofMat(0x3a6ee8, G.tex.roof),
      roofRed: roofMat(0xd0503a, G.tex.roof),
      roofGreen: roofMat(0x4a9a5a, G.tex.roof),
      thatch: new THREE.MeshStandardMaterial({ map: G.tex.thatch.map, normalMap: G.tex.thatch.normalMap, roughness: 1 }),
      gold: G.mat(0xffc93a, { metalness: 0.9, roughness: 0.28 }),
      trim: G.mat(0xf8f2e4, { roughness: 0.55 }),
      glass: G.mat(0x16275a, { roughness: 0.12, metalness: 0.3, emissive: 0x0e2458, emissiveIntensity: 0.55 }),
      warmGlass: G.mat(0xffd68a, { roughness: 0.3, emissive: 0xffb04a, emissiveIntensity: 0.5 }),
      door: G.texMat('door', 1, 1),
      timber: G.mat(0x5a3a20, { roughness: 0.85 }),
      banner: new THREE.MeshStandardMaterial({ map: bannerTexture(), side: THREE.DoubleSide, roughness: 0.85, transparent: false, alphaTest: 0.5 }),
      rose: new THREE.MeshStandardMaterial({ map: G.tex.rose, emissiveMap: G.tex.rose, emissive: 0xffffff, emissiveIntensity: 0.45, roughness: 0.2 }),
      shutter: [G.mat(0x3f8fd8), G.mat(0x4caf50), G.mat(0xd8503a), G.mat(0xf2b632)],
      shallow: new THREE.MeshStandardMaterial({ color: 0x6fd8ec, transparent: true, opacity: 0.78, roughness: 0.04, metalness: 0, envMapIntensity: 2.5 }),
      wellWater: new THREE.MeshStandardMaterial({ color: 0x1d5a78, roughness: 0.03, metalness: 0, envMapIntensity: 2.5 }),
    };
    // hall walls: sandstone outside; inside, wood wainscot, warm damask plaster and a red frieze
    {
      const m = tri(G.tex.ashlar, 1 / 3.2, 0xfff6e6);
      const P0 = S.positionWorld, n = S.normalWorld;
      const inside = S.step(S.abs(P0.x), 20.86).mul(S.step(299.14, P0.z)).mul(S.step(P0.z, 324.86)).mul(S.step(5.8, P0.y)).mul(S.step(P0.y, 22.5));
      const along = P0.x.add(P0.z);
      const nz = S.texture(G.gfx.noiseTex, S.vec2(along, P0.y).mul(1 / 3)).r;
      const wainTop = 5.9 + 2.3;
      const panelLine = S.smoothstep(0.03, 0.0, S.abs(S.fract(along.div(1.6)).sub(0.5)).sub(0.47));
      const panel = S.mix(S.color(0x6a3f20), S.color(0x8c5a30), nz).mul(S.float(1).sub(panelLine.mul(0.35)));
      // wallpaper: a fine gold diamond trellis with a small rosette in every cell
      const qu = along.mul(0.9), qv = P0.y.mul(0.9);
      const dA = S.abs(S.fract(qu.add(qv)).sub(0.5)), dB = S.abs(S.fract(qu.sub(qv)).sub(0.5));
      const trellis = S.smoothstep(0.035, 0.0, S.min(dA, dB));
      const cellC = S.vec2(S.fract(qu.add(qv).add(0.5)).sub(0.5), S.fract(qu.sub(qv).add(0.5)).sub(0.5));
      const rosette = S.smoothstep(0.1, 0.06, S.length(cellC));
      const plaster = S.mix(S.mix(S.color(0xf3e3c2), S.color(0xead6ab), nz.mul(0.5)), S.color(0xd9b56a), trellis.mul(0.7).add(rosette.mul(0.55)).clamp(0, 1));
      const frieze = S.step(21.2, P0.y);
      const goldLine = S.smoothstep(0.1, 0.0, S.abs(P0.y.sub(wainTop))).add(S.smoothstep(0.08, 0.0, S.abs(P0.y.sub(21.2))));
      let inCol = S.mix(plaster, panel, S.step(P0.y, wainTop));
      inCol = S.mix(inCol, S.color(0x9a2a26), frieze);
      inCol = S.mix(inCol, S.color(0xe8b43a), goldLine.clamp(0, 1));
      m.colorNode = S.mix(m.colorNode, inCol, inside);
      m.roughnessNode = S.mix(S.float(0.86), S.mix(S.float(0.85), S.float(0.5), S.step(P0.y, wainTop)), inside);
      m.normalNode = S.mix(m.normalNode, G.gfx.toView(n), inside);
      M_hall = m;
    }
    // ceiling slab: stone outside, a deep blue vault with gold stars underneath
    {
      const m = tri(G.tex.ashlar, 1 / 3.2, 0xfff6e6);
      const P0 = S.positionWorld, down = S.step(S.normalWorld.y, -0.5);
      const cell = S.floor(P0.xz.mul(0.8));
      const h = S.fract(S.sin(S.dot(cell, S.vec2(12.9898, 78.233))).mul(43758.5453));
      const f = S.fract(P0.xz.mul(0.8)).sub(0.5);
      const star = S.step(0.86, h).mul(S.smoothstep(0.16, 0.05, S.length(f)));
      const vault = S.mix(S.color(0x1d2d66), S.color(0xffd34a), star);
      m.colorNode = S.mix(m.colorNode, vault, down);
      m.emissiveNode = S.color(0xffc93a).mul(star.mul(down).mul(0.6));
      M_ceiling = m;
    }
    // polished marble floor: cream/terracotta checker, veins and a sun medallion
    {
      const m = new THREE.MeshStandardNodeMaterial({ roughness: 0.22, metalness: 0 });
      const P0 = S.positionWorld, up = S.step(0.5, S.normalWorld.y);
      const q = P0.xz.mul(0.5);
      const chk = S.mod(S.floor(q.x).add(S.floor(q.y)), 2);
      const vein = S.texture(G.gfx.noiseTex, P0.xz.mul(1 / 5.5)).a;
      const veinL = S.smoothstep(0.92, 0.99, vein).mul(0.25);
      let col = S.mix(S.color(0xf1e7d4), S.color(0xb4473a), chk).mul(S.float(1).sub(veinL));
      const rel = P0.xz.sub(S.vec2(0, 304)), d = S.length(rel);
      const ang = S.atan(rel.y, rel.x);
      const rays = S.step(0.5, S.fract(ang.mul(12 / TAU)));
      let med = S.mix(S.color(0xf6e3a8), S.color(0xe8a92a), rays);
      med = S.mix(med, S.color(0xffc93a), S.step(d, 1.2));
      med = S.mix(med, S.color(0x6a2a1e), S.step(1.2, d).mul(S.step(d, 1.45)));
      med = S.mix(med, S.color(0x8a2e24), S.step(3.0, d));
      col = S.mix(col, med, S.step(d, 3.4).mul(up));
      m.colorNode = S.mix(S.color(0xeae0cc), col, up);
      m.roughnessNode = S.mix(S.float(0.4), S.float(0.18), up);
      M_marble = m;
    }
    // carpet runner (world x across the runner: gold borders)
    {
      const m = new THREE.MeshStandardNodeMaterial({ roughness: 0.95 });
      const ax = S.abs(S.positionWorld.x);
      const border = S.step(1.72, ax).mul(S.step(ax, 1.92));
      const pat = S.texture(G.gfx.noiseTex, S.positionWorld.xz.mul(1 / 1.2)).g.mul(0.15);
      m.colorNode = S.mix(S.color(0xa81e2a).mul(pat.add(0.9)), S.color(0xe8b43a), border);
      M_carpet = m;
    }
    // waving flags (vertex animation from the flag's own UVs)
    const fm = new THREE.MeshStandardNodeMaterial({ side: THREE.DoubleSide, roughness: 0.8 });
    fm.colorNode = S.texture(M.banner.map, S.uv().mul(S.vec2(1, 0.45)).add(S.vec2(0, 0.25))).rgb;
    const u = S.uv().x, t = G.gfx.uTime;
    fm.positionNode = S.positionLocal.add(S.vec3(0, S.sin(t.mul(5).sub(u.mul(6))).mul(0.08).mul(u), S.sin(t.mul(6).sub(u.mul(5))).mul(0.32).mul(u)));
    M.flag = fm;
    M.hall = M_hall; M.ceiling = M_ceiling; M.marble = M_marble; M.carpet = M_carpet;
    M.marbleWhite = G.mat(0xf3eee4, { roughness: 0.3 });
    M.dayGlass = G.mat(0xd6f2ff, { emissive: 0x9fd8ff, emissiveIntensity: 0.85, roughness: 0.15 });
    M.roseIn = new THREE.MeshStandardMaterial({ map: G.tex.rose, emissiveMap: G.tex.rose, emissive: 0xffffff, emissiveIntensity: 1.1, roughness: 0.2 });
    M.candle = G.mat(0xfff4e0, { roughness: 0.6 });
    M.flame = G.mat(0xffc060, { emissive: 0xffa030, emissiveIntensity: 3.2 });
    return M;
  }

  // ------------------------------------------------------------------
  // geometry helpers
  // ------------------------------------------------------------------
  function add(scene, geo, mat, x, y, z, ry, stat) {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, y, z); if (ry) m.rotation.y = ry;
    m.castShadow = true; m.receiveShadow = true; m.userData.static = stat !== false;
    scene.add(m);
    return m;
  }
  const box = (w, h, d) => new THREE.BoxGeometry(w, h, d);
  // spire / cone roof with a flared eave; UVs in 2 m tile units so one roof material fits every size
  function roofCone(r, h, segs) {
    const pts = [], n = 14;
    pts.push(new THREE.Vector2(r * 1.04, -0.35));
    for (let i = 0; i <= n; i++) { const f = i / n; pts.push(new THREE.Vector2(Math.max(0.001, r * Math.pow(1 - f, 1.35)), f * h)); }
    const g = new THREE.LatheGeometry(pts, segs);
    const uv = g.attributes.uv, L = pts.length, slant = [0];
    for (let j = 1; j < L; j++) slant.push(slant[j - 1] + pts[j].distanceTo(pts[j - 1]));
    const circ = TAU * r;
    for (let i = 0; i <= segs; i++) for (let j = 0; j < L; j++) uv.setXY(i * L + j, (i / segs) * circ / 2, (slant[L - 1] - slant[j]) / 2);
    return g;
  }
  // gabled roof prism: ridge along local x, eaves at z = ±d/2 (tile-unit UVs); the gable-end triangles
  // sit `inset` metres inside the roof edges so they stay tucked under the overhang
  function gable(w, d, h, inset) {
    const x0 = -w / 2, x1 = w / 2, zA = -d / 2, zB = d / 2, sl = Math.hypot(d / 2, h);
    const pos = [
      x0, 0, zA, x1, h, 0, x1, 0, zA, x0, 0, zA, x0, h, 0, x1, h, 0,
      x1, 0, zB, x0, h, 0, x0, 0, zB, x1, 0, zB, x1, h, 0, x0, h, 0,
    ];
    const uv = [
      x0 / 2, 0, x1 / 2, sl / 2, x1 / 2, 0, x0 / 2, 0, x0 / 2, sl / 2, x1 / 2, sl / 2,
      x1 / 2, 0, x0 / 2, sl / 2, x0 / 2, 0, x1 / 2, 0, x1 / 2, sl / 2, x0 / 2, sl / 2,
    ];
    const slopes = new THREE.BufferGeometry();
    slopes.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    slopes.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    slopes.computeVertexNormals();
    const i0 = inset == null ? 0.7 : inset, gx = w / 2 - i0, bw = d / 2 - i0, gh = h * (1 - i0 / (d / 2)) + h * (i0 / (d / 2)) - 0.05;
    const tri = new THREE.BufferGeometry();
    tri.setAttribute('position', new THREE.Float32BufferAttribute([
      -gx, 0, -bw, -gx, 0, bw, -gx, gh, 0,
      gx, 0, bw, gx, 0, -bw, gx, gh, 0,
    ], 3));
    tri.setAttribute('uv', new THREE.Float32BufferAttribute([0, 0, 1, 0, 0.5, 1, 0, 0, 1, 0, 0.5, 1], 2));
    tri.computeVertexNormals();
    return { slopes, tri };
  }
  // stepped colliders under a gabled roof so the player can stand on it (never more than h/steps below)
  function gableCollider(cx, cz, yaw, w, d, h, yBase, steps) {
    for (let k = 1; k < steps; k++) {
      const top = yBase + (h * k) / steps, hz = (d / 2) * (1 - k / steps);
      P.addBox({ x: cx, y: top - h / steps / 2, z: cz, hx: w / 2, hy: h / steps / 2, hz, yaw, tag: 'roof' });
    }
  }
  let winGeo = null;
  function windowGeos() {
    if (winGeo) return winGeo;
    const A = window.ADDONS;
    const glass = A.mergeGeometries([
      box(1, 1.8, 0.12).translate(0, 0.9, 0),
      new THREE.CylinderGeometry(0.5, 0.5, 0.12, 16, 1, false, -Math.PI / 2, Math.PI).rotateX(Math.PI / 2).translate(0, 1.8, 0),
    ].map((g) => { g.deleteAttribute('uv'); return g.index ? g : g; }), false);
    const frame = A.mergeGeometries([
      box(1.5, 0.2, 0.42).translate(0, -0.08, 0.05),
      box(0.18, 1.9, 0.34).translate(-0.59, 0.95, 0.02), box(0.18, 1.9, 0.34).translate(0.59, 0.95, 0.02),
      new THREE.TorusGeometry(0.59, 0.1, 8, 20, Math.PI).translate(0, 1.8, 0.02),
    ].map((g) => { g.deleteAttribute('uv'); return g; }), false);
    winGeo = { glass, frame };
    return winGeo;
  }
  function windowAt(scene, x, y, z, yaw, s, warm) {
    const W = windowGeos(), k = s || 1;
    const g = add(scene, W.glass, warm ? M.warmGlass : M.glass, x, y, z, yaw); g.scale.setScalar(k); g.userData.noShadowCast = true;
    const f = add(scene, W.frame, M.trim, x, y, z, yaw); f.scale.setScalar(k);
  }
  // daylight pane seen from inside the hall (glows, lets the sun through)
  function windowIn(scene, x, y, z, yaw) {
    const g = add(scene, windowGeos().glass, M.dayGlass, x, y, z, yaw); g.scale.setScalar(1.2); g.userData.noShadowCast = true;
  }
  function tower(scene, x, z, r, y0, y1, roofH, opts) {
    opts = opts || {};
    add(scene, new THREE.CylinderGeometry(r, r * 1.05, y1 - y0, 56, 1, true), M.stone, x, (y0 + y1) / 2, z);
    add(scene, new THREE.CylinderGeometry(r * 1.12, r * 0.98, 1.3, 56), M.stone, x, y1 - 0.65, z);
    add(scene, new THREE.TorusGeometry(r * 1.12, 0.16, 8, 72).rotateX(Math.PI / 2), M.trim, x, y1 + 0.02, z);
    add(scene, roofCone(r * 1.24, roofH, 56), opts.roof || M.roof, x, y1, z);
    add(scene, new THREE.SphereGeometry(0.38, 16, 12), M.gold, x, y1 + roofH + 0.25, z);
    add(scene, new THREE.CylinderGeometry(0.07, 0.07, 3, 8), M.gold, x, y1 + roofH + 1.6, z);
    if (opts.flag) {
      const f = new THREE.Mesh(new THREE.PlaneGeometry(2.6, 1.5, 16, 4).translate(1.3, 0, 0), M.flag);
      f.position.set(x, y1 + roofH + 2.4, z); f.rotation.y = opts.flagYaw || 0; f.castShadow = true;
      scene.add(f);
    }
    // windows spiral around the tower
    const rows = opts.rows || 2;
    for (let rI = 0; rI < rows; rI++) {
      const y = y0 + (y1 - y0) * ((rI + 0.6) / (rows + 0.4));
      const n = opts.perRow || 3;
      for (let i = 0; i < n; i++) {
        const a = (opts.face || 0) + ((i - (n - 1) / 2) * (opts.spread || 0.9)) + rI * 0.35;
        windowAt(scene, x + Math.sin(a) * (r - 0.02), y, z + Math.cos(a) * (r - 0.02), a, opts.winScale || 1);
      }
    }
    P.addCyl({ x, z, r, y0: y0 - 1, y1: y1 + 1, top: false, tag: 'castle' });
  }
  function merlonRow(scene, x0, z0, x1, z1, y, h) {
    const len = Math.hypot(x1 - x0, z1 - z0), yaw = Math.atan2(x1 - x0, z1 - z0);
    const wall = add(scene, box(0.9, h || 0.8, len), M.stone, (x0 + x1) / 2, y + (h || 0.8) / 2, (z0 + z1) / 2, yaw);
    wall.userData.flat = true;
    const n = Math.floor(len / 2.2);
    for (let i = 0; i <= n; i++) {
      const f = n ? i / n : 0.5;
      add(scene, box(1.1, 1.0, 1.05), M.stone, U.lerp(x0, x1, f), y + (h || 0.8) + 0.5, U.lerp(z0, z1, f), yaw);
    }
    P.addBox({ x: (x0 + x1) / 2, y: y + ((h || 0.8) + 1.0) / 2, z: (z0 + z1) / 2, hx: 0.5, hy: ((h || 0.8) + 1.0) / 2, hz: len / 2, yaw, tag: 'parapet' });
  }

  // ------------------------------------------------------------------
  // Brightkeep Castle
  // ------------------------------------------------------------------
  function buildCastle(scene) {
    const C = T().castle, cx = C.x, cz = C.z, y0 = C.islandY - 0.6, top = 23.4;
    const front = 298, back = 326;
    // ---- main hall: real walls with an arched doorway, window openings and a rose window (the hall is
    // hollow: see buildInterior) ----
    const TW = 1.2, inX = 22 - TW, inF = front + TW, inB = back - TW, floorY = C.islandY + 0.9, ceilY = top - 1.0, GY = floorY + 6.0;
    CS.hall = { x0: -inX, x1: inX, z0: inF, z1: inB, floorY, ceilY, top, GY, front, back };
    const FRONT_WIN = [[-18, 7.8], [-13, 7.8], [13, 7.8], [18, 7.8], [-18, 15.4], [18, 15.4]];
    const SIDE_WIN = [[309.5, 8.2], [316.5, 8.2], [309.5, 15.6], [316.5, 15.6]];
    const BACK_WIN = [[-15, 14.5], [-5, 14.5], [5, 14.5], [15, 14.5]];
    CS.windows = { FRONT_WIN, SIDE_WIN, BACK_WIN };
    const wallGeo = (u0, u1, holes) => {
      const sh = new THREE.Shape();
      sh.moveTo(u0, y0); sh.lineTo(u1, y0); sh.lineTo(u1, top); sh.lineTo(u0, top); sh.lineTo(u0, y0);
      holes.forEach((h) => {
        const pth = new THREE.Path();
        if (h.r) pth.absarc(h.x, h.y, h.r, 0, TAU, false);
        else { const r = h.w / 2; pth.moveTo(h.x - r, h.y); pth.lineTo(h.x + r, h.y); pth.lineTo(h.x + r, h.y + h.h); pth.absarc(h.x, h.y + h.h, r, 0, Math.PI, false); pth.lineTo(h.x - r, h.y); }
        sh.holes.push(pth);
      });
      const g = new THREE.ExtrudeGeometry(sh, { depth: TW, bevelEnabled: false, curveSegments: 18 });
      g.deleteAttribute('uv');
      return g;
    };
    const hole = (u, y) => ({ x: u, y, w: 1.2, h: 2.16 });
    add(scene, wallGeo(-22, 22, [{ x: 0, y: floorY, w: 4.6, h: 6.8 }, { x: 0, y: 18.8, r: 3.3 }].concat(FRONT_WIN.map(([u, y]) => hole(u, y)))), M.hall, cx, 0, front);
    add(scene, wallGeo(-22, 22, BACK_WIN.map(([u, y]) => hole(u, y))), M.hall, cx, 0, back - TW);
    const side = wallGeo(front, back, SIDE_WIN.map(([u, y]) => hole(u, y))).rotateY(-Math.PI / 2);
    add(scene, side, M.hall, 22, 0, 0);
    add(scene, side.clone(), M.hall, -inX, 0, 0);
    // colliders: wall segments around the doorway, threshold, back/side walls, floor and ceiling slabs
    const hy = (top - y0) / 2, cyW = (top + y0) / 2;
    [-1, 1].forEach((sg) => P.addBox({ x: sg * 12.15, y: cyW, z: front + TW / 2, hx: 9.85, hy, hz: TW / 2, tag: 'castle' }));
    P.addBox({ x: cx, y: (12.7 + top) / 2, z: front + TW / 2, hx: 2.3, hy: (top - 12.7) / 2, hz: TW / 2, tag: 'castle' });
    P.addBox({ x: cx, y: (floorY + y0) / 2, z: front + TW / 2, hx: 2.35, hy: (floorY - y0) / 2, hz: TW / 2 + 0.05, tag: 'threshold' });
    P.addBox({ x: cx, y: cyW, z: back - TW / 2, hx: 22, hy, hz: TW / 2, tag: 'castle' });
    [-1, 1].forEach((sg) => P.addBox({ x: sg * (22 - TW / 2), y: cyW, z: (front + back) / 2, hx: TW / 2, hy, hz: (back - front) / 2, tag: 'castle' }));
    P.addBox({ x: cx, y: (y0 + floorY) / 2, z: (inF + inB) / 2, hx: inX, hy: (floorY - y0) / 2, hz: (inB - inF) / 2, tag: 'floor' });
    P.addBox({ x: cx, y: (ceilY + top) / 2, z: (front + back) / 2, hx: 22, hy: (top - ceilY) / 2, hz: (back - front) / 2, tag: 'castle' });
    add(scene, box(44, top - ceilY, back - front), M.ceiling, cx, (ceilY + top) / 2, (front + back) / 2);
    // plinth and string courses run around the outside only (split around the doorway)
    const band = (y, h, out, mat) => {
      const W2 = 22 + out;
      [[-W2, -2.95], [2.95, W2]].forEach(([u0, u1]) => { if (y - h / 2 < 15.2) add(scene, box(u1 - u0, h, out * 2 + 0.2), mat, (u0 + u1) / 2, y, front); });
      if (y - h / 2 >= 15.2) add(scene, box(W2 * 2, h, out * 2 + 0.2), mat, cx, y, front);
      add(scene, box(W2 * 2, h, out * 2 + 0.2), mat, cx, y, back);
      [-1, 1].forEach((sg) => add(scene, box(out * 2 + 0.2, h, back - front + out * 2), mat, sg * 22, y, (front + back) / 2));
    };
    band(y0 + 0.75, 1.5, 0.6, M.stoneDark);
    band(12.5, 0.5, 0.4, M.trim);
    band(top - 0.3, 0.6, 0.4, M.trim);
    // terrace parapet (front part of the roof) with battlements
    merlonRow(scene, -22.2, front + 0.3, 22.2, front + 0.3, top);
    merlonRow(scene, -21.8, front + 0.5, -21.8, 305, top);
    merlonRow(scene, 21.8, front + 0.5, 21.8, 305, top);
    // pitched roof over the rear part
    const gz = (305 + back + 1) / 2, gd = back + 1 - 305, gh = 9;
    const gr = gable(46, gd, gh, 1);
    add(scene, gr.slopes, M.roof, cx, top, gz);
    add(scene, gr.tri, M.stone, cx, top, gz);
    gableCollider(cx, gz, 0, 46, gd, gh, top, 12);
    // dormer windows on the roof
    [-14, -5, 5, 14].forEach((x) => {
      add(scene, box(2.2, 2.4, 2.2), M.stone, x, top + 2.4, 307.8);
      const dr = gable(2.8, 3.0, 1.4, 0.3); add(scene, dr.slopes, M.roof, x, top + 3.5, 307.8, Math.PI / 2); add(scene, dr.tri, M.stone, x, top + 3.5, 307.8, Math.PI / 2);
      windowAt(scene, x, top + 1.5, 306.6, Math.PI, 0.7);
    });
    // central keep rising through the roof, with a door onto the terrace
    tower(scene, cx, 314, 8, top - 0.5, 47, 19, { flag: true, flagYaw: -0.4, rows: 2, perRow: 5, spread: 0.55, face: Math.PI, winScale: 1.3 });
    add(scene, new THREE.TorusGeometry(8.1, 0.25, 8, 80).rotateX(Math.PI / 2), M.gold, cx, 36, 314);
    // corner towers and gate towers
    [[-24, 300, -Math.PI * 0.75], [24, 300, Math.PI * 0.75], [-24, 324, -Math.PI * 0.25], [24, 324, Math.PI * 0.25]].forEach(([x, z, face]) =>
      tower(scene, x, z, 5, y0, 33, 12, { flag: true, flagYaw: 0.6, rows: 3, perRow: 3, face, spread: 0.7 }));
    [-7, 7].forEach((x) => tower(scene, x, 295.6, 3.2, y0, 27, 8, { rows: 2, perRow: 1, face: Math.PI, winScale: 0.8 }));
    // gate: arch frame, porch steps, rose window, banners (the door leaves are animated, see buildInterior)
    add(scene, new THREE.TorusGeometry(2.65, 0.42, 10, 28, Math.PI).translate(0, 6.8, 0), M.stoneDark, cx, floorY, front - 0.3);
    [-2.65, 2.65].forEach((x) => add(scene, box(0.84, 6.8, 0.84), M.stoneDark, cx + x, floorY + 3.4, front - 0.3));
    add(scene, box(9, 0.45, 3.2), M.stoneDark, cx, C.islandY + 0.2, front - 1.8);
    add(scene, box(7.4, 0.45, 1.8), M.stoneDark, cx, C.islandY + 0.65, front - 1.1);
    P.addBox({ x: cx, y: C.islandY + 0.2, z: front - 1.8, hx: 4.5, hy: 0.24, hz: 1.6, tag: 'step' });
    P.addBox({ x: cx, y: C.islandY + 0.65, z: front - 1.1, hx: 3.7, hy: 0.24, hz: 0.9, tag: 'step' });
    const rose = add(scene, new THREE.CircleGeometry(3.3, 64), M.rose, cx, 18.8, front + 0.35, Math.PI); rose.userData.noShadowCast = true;
    add(scene, new THREE.TorusGeometry(3.45, 0.32, 10, 72), M.trim, cx, 18.8, front - 0.1);
    [-13, 13].forEach((x) => {
      const b = add(scene, new THREE.PlaneGeometry(3, 7.5), M.banner, cx + x, 16.4, front - 0.12, Math.PI);
      b.castShadow = false; b.userData.noShadowCast = true;
      add(scene, new THREE.CylinderGeometry(0.1, 0.1, 3.6, 8).rotateZ(Math.PI / 2), M.gold, cx + x, 20.2, front - 0.25);
    });
    // windows: outside glass + frames, inside daylight panes (sunlight streams through the openings)
    FRONT_WIN.forEach(([x, y]) => { windowAt(scene, cx + x, y, front - 0.02, Math.PI, 1.2); windowIn(scene, cx + x, y, inF - 0.08, 0); });
    SIDE_WIN.forEach(([z, y]) => [-1, 1].forEach((sg) => { windowAt(scene, sg * 22.02, y, z, sg * Math.PI / 2, 1.2); windowIn(scene, sg * (inX + 0.08), y, z, -sg * Math.PI / 2); }));
    BACK_WIN.forEach(([x, y]) => { windowAt(scene, cx + x, y, back + 0.02, 0, 1.2); windowIn(scene, cx + x, y, inB + 0.08, Math.PI); });
    const roseIn = add(scene, new THREE.CircleGeometry(3.3, 64), M.roseIn, cx, 18.8, inF - 0.35, 0); roseIn.userData.noShadowCast = true;
    buildInterior(scene);
    // courtyard: lamps, flower beds, topiary trees, hedges hugging the island edge
    [[-6, 282], [6, 282], [-6, 290], [6, 290]].forEach(([x, z]) => G.decor.lamp(scene, x, z));
    [[-17, 290], [17, 290]].forEach(([x, z]) => G.decor.flowers(scene, x, z, 5));
    G.decor.flowers(scene, 0, 338, 9);
    [[-13, 287], [13, 287], [-20, 337], [20, 337], [-8, 341], [8, 341]].forEach(([x, z]) => G.decor.tree(x, z, 'round', 0.75));
    for (let a = -Math.PI / 2 + 0.55; a < 1.5 * Math.PI - 0.6; a += 0.27) {
      const r = C.island - 2.4, a1 = a + 0.22;
      if (Math.abs(a + 0.11 - Math.PI / 2) < 0.2) continue; // gap for the moat stairs
      G.decor.hedge(scene, cx + Math.cos(a) * r, cz + Math.sin(a) * r, cx + Math.cos(a1) * r, cz + Math.sin(a1) * r, 1.1, 1.0);
    }
    // stone retaining wall around the island with a coping ring
    // (with a gap at the back where the stairs climb out of the moat)
    const gapA = 0.09;
    add(scene, new THREE.CylinderGeometry(C.island + 0.45, C.island + 0.9, C.islandY + 3.2, 160, 1, true, gapA, TAU - gapA * 2), M.stoneDark, cx, (C.islandY - 3.2) / 2 + 0.02, cz);
    add(scene, new THREE.TorusGeometry(C.island + 0.45, 0.32, 8, 160, TAU - gapA * 2).rotateX(Math.PI / 2).rotateY(-(Math.PI / 2 + gapA)), M.stone, cx, C.islandY + 0.02, cz);
    // stone stairs rising out of the moat behind the castle (swimmers can climb back onto the island)
    for (let i = 0; i < 9; i++) {
      const zz = cz + C.island - 0.6 + i * 0.75, topY = C.islandY - 0.45 - i * 0.5;
      add(scene, box(5, topY + 3.2, 0.76), M.stoneDark, cx, (topY - 3.2) / 2, zz);
      P.addBox({ x: cx, y: (topY - 3.2) / 2, z: zz, hx: 2.5, hy: (topY + 3.2) / 2, hz: 0.38, tag: 'stairs' });
    }
    // sealed-door sign
    G.sign(scene, 4.5, 292.5, Math.PI, "Brightkeep Castle. Come in! Magic paintings in the Grand Foyer carry you across the land, and the Sun Door upstairs opens for anyone carrying three Sun Gems. Something glitters on the castle terrace, too.");
  }

  // ------------------------------------------------------------------
  // the Grand Foyer: marble floor, carpet, grand staircase to a U-shaped gallery, columns, coffered
  // vault, chandelier, magic paintings that carry you across the land, and the Sun Door
  // ------------------------------------------------------------------
  function paintingTexture(kind) {
    const W = 320, H = 250, cv = document.createElement('canvas'); cv.width = W; cv.height = H;
    const c = cv.getContext('2d');
    const grad = (y0, y1, a, b) => { const g = c.createLinearGradient(0, y0, 0, y1); g.addColorStop(0, a); g.addColorStop(1, b); return g; };
    const blob = (x, y, rx, ry, col) => { c.fillStyle = col; c.beginPath(); c.ellipse(x, y, rx, ry, 0, 0, TAU); c.fill(); };
    const pine = (x, y, h, col) => { c.fillStyle = col; for (let i = 0; i < 3; i++) { const w = h * (0.42 - i * 0.1); c.beginPath(); c.moveTo(x - w, y - i * h * 0.26); c.lineTo(x + w, y - i * h * 0.26); c.lineTo(x, y - h * (0.48 + i * 0.26)); c.fill(); } };
    const rnd = U.rng(kind.length * 31);
    if (kind === 'mountain') {
      c.fillStyle = grad(0, 170, '#6cc4ff', '#dff4ff'); c.fillRect(0, 0, W, H);
      [[60, 50, 40, 14], [230, 38, 52, 16], [150, 70, 30, 10]].forEach(([x, y, rx, ry]) => blob(x, y, rx, ry, 'rgba(255,255,255,0.9)'));
      blob(60, 200, 140, 60, '#6fb94a'); blob(270, 205, 120, 55, '#5aa63e');
      for (let k = 0; k < 6; k++) { const y = 200 - k * 26, w = 120 - k * 18; c.fillStyle = k % 2 ? '#9a7b58' : '#8a6a4a'; c.beginPath(); c.moveTo(160 - w, y); c.lineTo(160 + w, y); c.lineTo(160 + w - 12, y - 26); c.lineTo(160 - w + 12, y - 26); c.fill(); c.fillStyle = '#d9c29a'; c.fillRect(160 - w + 6, y - 6, (w - 6) * 2, 4); }
      c.fillStyle = '#7a5e42'; c.beginPath(); c.moveTo(146, 44); c.lineTo(174, 44); c.lineTo(160, 26); c.fill();
      c.fillStyle = grad(210, 250, '#58b040', '#3a8a2a'); c.fillRect(0, 214, W, 40);
      for (let i = 0; i < 40; i++) blob(rnd() * W, 218 + rnd() * 30, 2.5, 2.5, ['#ff5f8f', '#ffd23f', '#ffffff'][i % 3]);
    } else if (kind === 'lagoon') {
      c.fillStyle = grad(0, 120, '#7fd6ff', '#e6f8ff'); c.fillRect(0, 0, W, H);
      blob(250, 50, 26, 26, '#ffe066'); blob(250, 50, 36, 36, 'rgba(255,224,102,0.25)');
      c.fillStyle = grad(110, 250, '#38d8d0', '#0b5e9a'); c.fillRect(0, 112, W, 140);
      for (let i = 0; i < 9; i++) { c.strokeStyle = 'rgba(255,255,255,0.5)'; c.lineWidth = 2; c.beginPath(); const y = 125 + i * 12; c.moveTo(rnd() * 80, y); c.lineTo(80 + rnd() * 200, y); c.stroke(); }
      blob(70, 116, 46, 10, '#e8d49a'); c.fillStyle = '#7a5a30'; c.fillRect(66, 70, 6, 44); blob(69, 68, 26, 10, '#3fa04a'); blob(60, 76, 16, 7, '#46b050');
      [['#ff5f8f', 40], ['#ffd23f', 110], ['#b46cff', 190], ['#ff8a3d', 260], ['#49d7c8', 300]].forEach(([col, x]) => { blob(x, 238, 18, 14, col); blob(x + 10, 228, 8, 12, col); });
      for (let i = 0; i < 7; i++) { const x = 60 + rnd() * 200, y = 160 + rnd() * 50; blob(x, y, 9, 5, i % 2 ? '#ff7a1a' : '#ffd21f'); c.fillStyle = i % 2 ? '#ff7a1a' : '#ffd21f'; c.beginPath(); c.moveTo(x - 8, y); c.lineTo(x - 15, y - 5); c.lineTo(x - 15, y + 5); c.fill(); }
    } else if (kind === 'woods') {
      c.fillStyle = grad(0, 250, '#9fdcaa', '#1f4a2a'); c.fillRect(0, 0, W, H);
      for (let i = 0; i < 5; i++) { c.fillStyle = 'rgba(255,250,200,0.18)'; c.beginPath(); c.moveTo(120 + i * 30, 0); c.lineTo(150 + i * 30, 0); c.lineTo(90 + i * 50, 250); c.lineTo(60 + i * 50, 250); c.fill(); }
      for (let i = 0; i < 14; i++) pine(rnd() * W, 190 + rnd() * 20, 90 + rnd() * 60, i % 2 ? '#2f6a3a' : '#245a30');
      c.fillStyle = '#3a6a2a'; c.fillRect(0, 205, W, 50);
      [[120, 70], [160, 110], [200, 60], [240, 90]].forEach(([x, h]) => { c.fillStyle = '#e6dccb'; c.fillRect(x - 9, 205 - h, 18, h); c.fillStyle = '#cfc2ac'; c.fillRect(x - 13, 205 - h - 6, 26, 7); });
      blob(200, 120, 7, 9, '#ffd23a'); blob(200, 120, 16, 16, 'rgba(255,210,58,0.3)');
    } else {
      c.fillStyle = grad(0, 120, '#78c8ff', '#e0f4ff'); c.fillRect(0, 0, W, H);
      c.fillStyle = '#8a7a66'; c.fillRect(0, 90, W, 110);
      c.fillStyle = '#6fb04a'; c.fillRect(0, 78, W, 16);
      for (let i = 0; i < 9; i++) pine(20 + i * 36, 86, 50 + rnd() * 20, '#2f6a3a');
      c.fillStyle = grad(90, 210, '#ffffff', '#bfeeff'); c.fillRect(140, 88, 40, 120);
      for (let i = 0; i < 8; i++) { c.strokeStyle = 'rgba(160,220,255,0.8)'; c.beginPath(); const x = 144 + rnd() * 32; c.moveTo(x, 92); c.lineTo(x, 206); c.stroke(); }
      c.fillStyle = grad(200, 250, '#2fc0d8', '#0b5e9a'); c.fillRect(0, 200, W, 50);
      blob(160, 204, 50, 8, 'rgba(255,255,255,0.8)');
    }
    const t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 16;
    return t;
  }
  function makePainting(scene, x, y, z, yaw, kind, dest) {
    const S = window.TSL, PW = 3.2, PH = 2.5;
    const tex = paintingTexture(kind);
    const rip = S.uniform(0.05), hit = S.uniform(new THREE.Vector2(0.5, 0.5));
    const m = new THREE.MeshStandardNodeMaterial({ roughness: 0.55 });
    const u = S.uv(), rel = u.sub(hit).mul(S.vec2(PW / PH, 1)), d = S.length(rel);
    const wave = S.sin(d.mul(34).sub(G.gfx.uTime.mul(11))).mul(rip).mul(S.smoothstep(1.1, 0.0, d));
    const uvD = u.add(S.normalize(rel.add(S.vec2(1e-4, 0))).mul(wave.mul(0.025)));
    const col = S.texture(tex, uvD).rgb;
    m.colorNode = col;
    m.emissiveNode = col.mul(0.22);
    m.positionNode = S.positionLocal.add(S.vec3(0, 0, wave.mul(0.18)));
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(PW, PH, 40, 32), m);
    mesh.position.set(x, y, z); mesh.rotation.y = yaw; mesh.castShadow = false; mesh.receiveShadow = true; mesh.userData.noShadowCast = true;
    scene.add(mesh);
    const nx = Math.sin(yaw), nz = Math.cos(yaw), tx = Math.cos(yaw), tz = -Math.sin(yaw);
    // gilded frame
    [[0, PH / 2 + 0.12, PW + 0.48, 0.24], [0, -PH / 2 - 0.12, PW + 0.48, 0.24], [-PW / 2 - 0.12, 0, 0.24, PH], [PW / 2 + 0.12, 0, 0.24, PH]].forEach(([a, b, w, h]) =>
      add(scene, box(w, h, 0.16), M.gold, x + tx * a - nx * 0.02, y + b, z + tz * a - nz * 0.02, yaw));
    CS.paintings.push({ x, y, z, nx, nz, tx, tz, rip, hit, dest, t: 0, W: PW, H: PH });
  }
  function doorLeaf(sign) {
    const sh = new THREE.Shape(), w = 2.3 * sign;
    sh.moveTo(0, 0); sh.lineTo(w, 0); sh.lineTo(w, 9.1);
    sh.absarc(w, 6.8, 2.3, Math.PI / 2, sign > 0 ? Math.PI : 0, sign < 0);
    sh.lineTo(0, 0);
    const g = new THREE.ExtrudeGeometry(sh, { depth: 0.22, bevelEnabled: false, curveSegments: 16 });
    g.translate(0, 0, -0.11);
    return g;
  }
  function buildInterior(scene) {
    const H = CS.hall, S = window.TSL, { floorY, ceilY, GY } = H, inX = H.x1, inF = H.z0, inB = H.z1;
    // floor, vault beams
    add(scene, box(inX * 2, floorY - 4.4, inB - inF), M.marble, 0, (floorY + 4.4) / 2, (inF + inB) / 2);
    [-16, -8, 0, 8, 16].forEach((x) => add(scene, box(0.5, 0.7, inB - inF), M.timber, x, ceilY - 0.35, (inF + inB) / 2));
    [303.5, 309, 314.5, 320].forEach((z) => add(scene, box(inX * 2, 0.6, 0.45), M.timber, 0, ceilY - 0.3, z));
    // gallery floors (back and both sides), with gilded edges
    const gT = 0.5, gb = GY - gT / 2, sideZ0 = inF, sideZ1 = inB - 5;
    add(scene, box(inX * 2, gT, 5), M.marble, 0, gb, inB - 2.5);
    P.addBox({ x: 0, y: gb, z: inB - 2.5, hx: inX, hy: gT / 2, hz: 2.5, tag: 'gallery' });
    [-1, 1].forEach((sg) => {
      add(scene, box(5, gT, sideZ1 - sideZ0), M.marble, sg * (inX - 2.5), gb, (sideZ0 + sideZ1) / 2);
      P.addBox({ x: sg * (inX - 2.5), y: gb, z: (sideZ0 + sideZ1) / 2, hx: 2.5, hy: gT / 2, hz: (sideZ1 - sideZ0) / 2, tag: 'gallery' });
      add(scene, box(0.16, 0.34, sideZ1 - sideZ0), M.gold, sg * (inX - 5.02), gb - 0.1, (sideZ0 + sideZ1) / 2);
    });
    add(scene, box(inX * 2 - 10, 0.34, 0.16), M.gold, 0, gb - 0.1, sideZ1 - 0.02);
    // balustrades
    const balustrade = (x0, z0, x1, z1) => {
      const len = Math.hypot(x1 - x0, z1 - z0), yaw = Math.atan2(x1 - x0, z1 - z0), mx = (x0 + x1) / 2, mz = (z0 + z1) / 2;
      add(scene, box(0.3, 0.16, len), M.marbleWhite, mx, GY + 1.02, mz, yaw);
      add(scene, box(0.34, 0.12, len), M.marbleWhite, mx, GY + 0.06, mz, yaw);
      const n = Math.max(2, Math.round(len / 0.5));
      for (let i = 0; i <= n; i++) add(scene, new THREE.CylinderGeometry(0.06, 0.09, 0.9, 8), M.marbleWhite, U.lerp(x0, x1, i / n), GY + 0.5, U.lerp(z0, z1, i / n));
      P.addBox({ x: mx, y: GY + 0.55, z: mz, hx: 0.16, hy: 0.55, hz: len / 2, yaw, tag: 'parapet' });
    };
    [-1, 1].forEach((sg) => {
      balustrade(sg * (inX - 5 + 0.15), sideZ0 + 0.2, sg * (inX - 5 + 0.15), sideZ1);
      balustrade(sg * 4.3, sideZ1 + 0.15, sg * (inX - 5 + 0.15), sideZ1 + 0.15);
    });
    // columns under the gallery edge
    const column = (x, z) => {
      add(scene, new THREE.CylinderGeometry(0.46, 0.5, GY - gT - floorY - 0.7, 20), M.marbleWhite, x, (floorY + 0.35 + GY - gT - 0.35) / 2, z);
      add(scene, box(1.2, 0.35, 1.2), M.marbleWhite, x, floorY + 0.175, z);
      add(scene, box(1.25, 0.35, 1.25), M.gold, x, GY - gT - 0.175, z);
      P.addCyl({ x, z, r: 0.55, y0: floorY - 0.5, y1: GY - gT, top: false, tag: 'column' });
    };
    [-1, 1].forEach((sg) => { [303, 309.5, sideZ1].forEach((z) => column(sg * (inX - 5), z)); column(sg * 10, sideZ1); column(sg * 4.7, sideZ1); });
    // grand staircase with a carpet runner and banisters
    const steps = 12, run = 0.9, z0 = sideZ1 - steps * run;
    for (let i = 0; i < steps; i++) {
      const topY = floorY + (GY - floorY) * (i + 1) / steps, zc = z0 + run * (i + 0.5);
      add(scene, box(8, topY - floorY, run + 0.02), M.marbleWhite, 0, (floorY + topY) / 2, zc);
      const cp = add(scene, box(4.2, 0.04, run), M.carpet, 0, topY + 0.02, zc); cp.userData.noShadowCast = true;
      P.addBox({ x: 0, y: (floorY + topY) / 2, z: zc, hx: 4, hy: (topY - floorY) / 2, hz: run / 2, tag: 'stairs' });
    }
    const pitch = Math.atan2(GY - floorY, steps * run), rl = Math.hypot(GY - floorY, steps * run);
    [-1, 1].forEach((sg) => {
      const r = add(scene, box(0.26, 0.2, rl), M.gold, sg * 4.1, (floorY + GY) / 2 + 1.05, z0 + steps * run / 2); r.rotation.x = -pitch;
      for (let k = 0; k <= 6; k++) {
        const f = k / 6, zz = z0 + steps * run * f, yy = floorY + (GY - floorY) * f;
        add(scene, new THREE.CylinderGeometry(0.07, 0.07, 1.05, 8), M.marbleWhite, sg * 4.1, yy + 0.55, zz);
        if (k < 6) P.addBox({ x: sg * 4.1, y: yy + 0.9, z: zz + steps * run / 12, hx: 0.14, hy: 0.6, hz: steps * run / 12, tag: 'parapet' });
      }
      add(scene, new THREE.SphereGeometry(0.2, 14, 10), M.gold, sg * 4.1, floorY + 1.15, z0);
    });
    // carpet: entrance mat, runner to the stairs, gallery runner to the Sun Door
    [[inF + 0.75, 1.5, floorY], [z0 - 0.8, 1.6, floorY], [inB - 2.5, 5, GY]].forEach(([z, len, y]) => { const c = add(scene, box(4.2, 0.04, len), M.carpet, 0, y + 0.02, z); c.userData.noShadowCast = true; });
    // chandelier (a warm point light; no shadows)
    const ch = new THREE.Group(); ch.position.set(0, 17.2, 304); scene.add(ch);
    const gold = M.gold;
    [[new THREE.TorusGeometry(2.6, 0.12, 10, 64).rotateX(Math.PI / 2), 0], [new THREE.TorusGeometry(1.4, 0.1, 10, 48).rotateX(Math.PI / 2), -0.6]].forEach(([g, y]) => { const m = new THREE.Mesh(g, gold); m.position.y = y; ch.add(m); });
    const orb = new THREE.Mesh(new THREE.SphereGeometry(0.42, 20, 14), gold); orb.position.y = -0.55; ch.add(orb);
    const rod = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, ceilY - 17.2, 8), gold); rod.position.y = (ceilY - 17.2) / 2; ch.add(rod);
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * TAU, r = i % 2 ? 2.6 : 1.4, yb = i % 2 ? 0 : -0.6;
      const cnd = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.08, 0.42, 8), M.candle); cnd.position.set(Math.cos(a) * r, yb + 0.26, Math.sin(a) * r); ch.add(cnd);
      const fl = new THREE.Mesh(new THREE.SphereGeometry(0.09, 10, 8).scale(1, 1.6, 1), M.flame); fl.position.set(Math.cos(a) * r, yb + 0.58, Math.sin(a) * r); fl.userData.noShadowCast = true; ch.add(fl);
    }
    const lamp = new THREE.PointLight(0xffd2a0, 260, 26, 2); lamp.position.set(0, -0.9, 0); ch.add(lamp);
    CS.chandelier = ch;
    // wall sconces under the back gallery
    [-14, -8, 8, 14].forEach((x) => {
      add(scene, box(0.3, 0.5, 0.3), gold, x, floorY + 3.2, inB - 0.2);
      const f = add(scene, new THREE.SphereGeometry(0.12, 10, 8).scale(1, 1.5, 1), M.flame, x, floorY + 3.65, inB - 0.35, 0, false); f.userData.noShadowCast = true;
    });
    // main doors (open as the player approaches, from either side)
    const doorMat = G.texMat('door', 1 / 2.3, 1 / 9.1);
    const leaves = [-1, 1].map((sg) => {
      const piv = new THREE.Group(); piv.position.set(sg * 2.3, floorY, H.front + 0.55); scene.add(piv);
      const m = new THREE.Mesh(doorLeaf(-sg), doorMat); m.castShadow = true; m.receiveShadow = true; piv.add(m);
      const ring = new THREE.Mesh(new THREE.TorusGeometry(0.22, 0.05, 8, 20), gold); ring.position.set(-sg * 1.8, 3.4, -0.16); piv.add(ring);
      return piv;
    });
    const doorCol = P.addBox({ x: 0, y: floorY + 3.4, z: H.front + 0.55, hx: 2.3, hy: 3.4, hz: 0.2, tag: 'door' });
    CS.door = { leaves, col: doorCol, open: 0, sfx: 0 };
    // magic paintings
    const py = floorY + 2.45;
    makePainting(scene, inX - 0.06, py, 305, -Math.PI / 2, 'mountain', { x: 8, z: 46, face: Math.PI, name: 'Cragspire Trail' });
    makePainting(scene, inX - 0.06, py, 313, -Math.PI / 2, 'highlands', { x: 2, z: -300, face: 1.0, name: 'Skyfall Highlands' });
    makePainting(scene, -inX + 0.06, py, 305, Math.PI / 2, 'lagoon', { x: 226, z: 24, face: Math.PI / 2, name: 'Coral Lagoon' });
    makePainting(scene, -inX + 0.06, py, 313, Math.PI / 2, 'woods', { x: -272, z: 36, face: -1.26, name: 'Whispering Woods' });
    // the Sun Door on the back gallery (needs 3 Sun Gems) and the keep door on the terrace
    const sunCv = document.createElement('canvas'); sunCv.width = sunCv.height = 256;
    {
      const c = sunCv.getContext('2d');
      c.fillStyle = '#f6ecd2'; c.fillRect(0, 0, 256, 256);
      for (let i = 0; i < 16; i++) { const a = (i / 16) * TAU; c.fillStyle = i % 2 ? '#ffc21a' : '#ff9a1a'; c.beginPath(); c.moveTo(128 + Math.cos(a - 0.14) * 50, 118 + Math.sin(a - 0.14) * 50); c.lineTo(128 + Math.cos(a) * 100, 118 + Math.sin(a) * 100); c.lineTo(128 + Math.cos(a + 0.14) * 50, 118 + Math.sin(a + 0.14) * 50); c.fill(); }
      c.fillStyle = '#ffd23a'; c.beginPath(); c.arc(128, 118, 52, 0, TAU); c.fill();
      c.fillStyle = '#7a3a10'; c.font = 'bold 64px sans-serif'; c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillText('3', 128, 122);
    }
    const sunTex = new THREE.CanvasTexture(sunCv); sunTex.colorSpace = THREE.SRGBColorSpace;
    const sunMat = new THREE.MeshStandardMaterial({ map: sunTex, emissiveMap: sunTex, emissive: 0xffffff, emissiveIntensity: 0.25, roughness: 0.4, metalness: 0.2 });
    const sd = new THREE.Group(); sd.position.set(0, GY, inB - 0.08); sd.rotation.y = Math.PI; scene.add(sd);
    const slab = new THREE.Mesh(window.ADDONS.mergeGeometries([box(3.4, 3.6, 0.2).translate(0, 1.8, 0), new THREE.CylinderGeometry(1.7, 1.7, 0.2, 24, 1, false, -Math.PI / 2, Math.PI).rotateX(Math.PI / 2).translate(0, 3.6, 0)], false), G.mat(0xf2e6c8, { roughness: 0.5 }));
    sd.add(slab);
    const emb = new THREE.Mesh(new THREE.CircleGeometry(1.35, 40), sunMat); emb.position.set(0, 2.9, 0.12); sd.add(emb);
    const arch = new THREE.Mesh(new THREE.TorusGeometry(1.85, 0.16, 8, 32, Math.PI), gold); arch.position.set(0, 3.6, 0.05); sd.add(arch);
    [-1.85, 1.85].forEach((x) => { const j = new THREE.Mesh(box(0.32, 3.6, 0.32), gold); j.position.set(x, 1.8, 0.05); sd.add(j); });
    sd.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
    CS.sunDoor = { g: sd, emb, mat: sunMat, x: 0, y: GY, z: inB, t: 0, warned: false };
    const kd = new THREE.Group(); kd.position.set(0, H.top, 314 - 8 - 0.04); kd.rotation.y = Math.PI; scene.add(kd);
    const kslab = new THREE.Mesh(window.ADDONS.mergeGeometries([box(2.6, 2.8, 0.2).translate(0, 1.4, 0), new THREE.CylinderGeometry(1.3, 1.3, 0.2, 20, 1, false, -Math.PI / 2, Math.PI).rotateX(Math.PI / 2).translate(0, 2.8, 0)], false), G.texMat('door', 1 / 2.6, 1 / 4.1));
    kd.add(kslab);
    const karch = new THREE.Mesh(new THREE.TorusGeometry(1.45, 0.14, 8, 28, Math.PI), gold); karch.position.set(0, 2.8, 0.06); kd.add(karch);
    CS.keepDoor = { x: 0, y: H.top, z: 306 };
    // sparks inside
    G.collect.ring(0, floorY + 1.1, 304, 4.4, 10);
    for (let i = 1; i < steps; i += 2) G.collect.coin(0, floorY + (GY - floorY) * (i + 1) / steps + 1.1, z0 + run * (i + 0.5));
    [-1, 1].forEach((sg) => { for (let i = 0; i < 5; i++) G.collect.coin(sg * (inX - 2.5), GY + 1.1, U.lerp(sideZ0 + 2, sideZ1 - 2, i / 4)); });
  }

  // ------------------------------------------------------------------
  // bridge over the moat (stepped ramp colliders under a sloped deck)
  // ------------------------------------------------------------------
  function buildBridge(scene) {
    const C = T().castle, z0 = C.z - C.rim - 2.5, z1 = C.z - C.island + 1.5;
    const yA = T().heightAt(0, z0) + 0.15, yB = C.islandY + 0.15, len = z1 - z0, pitch = Math.atan2(yB - yA, len);
    const deck = add(scene, box(8.4, 0.9, len / Math.cos(pitch) + 0.4), M.stoneDark, 0, (yA + yB) / 2 - 0.45, (z0 + z1) / 2);
    deck.rotation.x = -pitch;
    const n = Math.ceil(len);
    for (let i = 0; i < n; i++) {
      const f = (i + 0.5) / n, zz = U.lerp(z0, z1, f), yy = U.lerp(yA, yB, f);
      P.addBox({ x: 0, y: yy - 0.5, z: zz, hx: 4.2, hy: 0.5, hz: len / n / 2 + 0.02, tag: 'bridge' });
    }
    // parapets with posts
    [-4, 4].forEach((x) => {
      const w = add(scene, box(0.6, 1.0, len / Math.cos(pitch)), M.stone, x, (yA + yB) / 2 + 0.5, (z0 + z1) / 2);
      w.rotation.x = -pitch;
      for (let i = 0; i <= 5; i++) {
        const f = i / 5, zz = U.lerp(z0, z1, f), yy = U.lerp(yA, yB, f);
        add(scene, box(0.9, 1.5, 0.9), M.stone, x, yy + 0.75, zz);
        add(scene, new THREE.SphereGeometry(0.34, 12, 8), M.trim, x, yy + 1.7, zz);
      }
      for (let i = 0; i < 6; i++) {
        const f = (i + 0.5) / 6, zz = U.lerp(z0, z1, f), yy = U.lerp(yA, yB, f);
        P.addBox({ x, y: yy + 0.5, z: zz, hx: 0.35, hy: 0.62, hz: len / 12 + 0.1, tag: 'parapet' });
      }
    });
    // arches and piers in the moat
    [0.33, 0.67].forEach((f) => {
      const zz = U.lerp(z0, z1, f), yy = U.lerp(yA, yB, f);
      add(scene, box(7.6, yy + 3.5, 1.8), M.stoneDark, 0, (yy - 3.5) / 2 - 0.9, zz);
      P.addBox({ x: 0, y: (yy - 3.5) / 2 - 0.9, z: zz, hx: 3.8, hy: (yy + 3.5) / 2, hz: 0.9, tag: 'pier' });
    });
    add(scene, new THREE.TorusGeometry(2.6, 0.5, 10, 24, Math.PI).rotateY(Math.PI / 2), M.stoneDark, 3.9, U.lerp(yA, yB, 0.5) - 3.4, U.lerp(z0, z1, 0.5));
    add(scene, new THREE.TorusGeometry(2.6, 0.5, 10, 24, Math.PI).rotateY(Math.PI / 2), M.stoneDark, -3.9, U.lerp(yA, yB, 0.5) - 3.4, U.lerp(z0, z1, 0.5));
    [-5.5, 5.5].forEach((x) => G.decor.lamp(scene, x, z0 - 1.5));
  }

  // ------------------------------------------------------------------
  // plaza fountain (wade-able basin, tiered bowls, animated water curtains)
  // ------------------------------------------------------------------
  function waterCurtain(r0, r1, h) {
    const S = window.TSL;
    const g = new THREE.CylinderGeometry(r0, r1, h, 48, 6, true);
    const m = new THREE.MeshStandardNodeMaterial({ transparent: true, side: THREE.DoubleSide, roughness: 0.2, depthWrite: false });
    const u = S.uv(), t = G.gfx.uTime;
    const streak = S.texture(G.gfx.noiseTex, S.vec2(u.x.mul(6), u.y.mul(0.5).add(t.mul(0.9)))).g;
    m.colorNode = S.mix(S.color(0xcff4ff), S.color(0xffffff), streak);
    m.opacityNode = S.clamp(streak.mul(0.6).add(0.25), 0, 0.85).mul(S.smoothstep(0, 0.15, u.y));
    m.emissiveNode = S.color(0x9fdcff).mul(0.2);
    const mesh = new THREE.Mesh(g, m); mesh.userData.noShadow = true;
    return mesh;
  }
  function buildFountain(scene) {
    const F = T().fountain, x = F.x, z = F.z, g0 = T().heightAt(x, z);
    const rimTop = F.level + 0.35;
    // outer wall up, across the top, inner wall down: this winding makes every face point outward
    const prof = [[F.r + 0.9, g0 - 0.3], [F.r + 0.9, rimTop - 0.15], [F.r + 0.75, rimTop], [F.r + 0.1, rimTop], [F.r - 0.1, rimTop - 0.1], [F.r - 0.1, g0 - 0.3]].map(([a, b]) => new THREE.Vector2(a, b));
    add(scene, new THREE.LatheGeometry(prof, 72), M.stone, x, 0, z);
    add(scene, new THREE.CircleGeometry(F.r, 48).rotateX(-Math.PI / 2), M.stoneDark, x, g0 + 0.02, z);
    // rim colliders (ring of thin boxes) so the player can hop onto the edge or into the basin
    const segs = 24;
    for (let i = 0; i < segs; i++) {
      const a = (i / segs) * TAU, rr = F.r + 0.4;
      P.addBox({ x: x + Math.cos(a) * rr, y: (rimTop + g0 - 0.3) / 2, z: z + Math.sin(a) * rr, hx: 0.5, hy: (rimTop - g0 + 0.3) / 2, hz: (TAU * rr) / segs / 2 + 0.05, yaw: -a, tag: 'fountain' });
    }
    // tiered bowls
    add(scene, new THREE.CylinderGeometry(0.7, 0.95, 3.2, 32), M.stone, x, g0 + 1.6, z);
    const bowl = (r, y) => {
      const pr = [[0.2, -0.7], [r * 0.5, -0.55], [r, -0.1], [r + 0.12, 0.08], [r - 0.18, 0.08], [0.2, -0.3]].map(([a, b]) => new THREE.Vector2(a, b));
      add(scene, new THREE.LatheGeometry(pr, 48), M.stone, x, y, z);
      add(scene, new THREE.CircleGeometry(r - 0.2, 40).rotateX(-Math.PI / 2), M.shallow, x, y - 0.02, z, 0, false).castShadow = false;
    };
    bowl(2.6, g0 + 3.4);
    add(scene, new THREE.CylinderGeometry(0.4, 0.55, 2.2, 24), M.stone, x, g0 + 4.4, z);
    bowl(1.3, g0 + 5.6);
    add(scene, new THREE.SphereGeometry(0.45, 20, 14), M.gold, x, g0 + 6.3, z);
    P.addCyl({ x, z, r: 1.0, y0: g0 - 1, y1: g0 + 3.2, tag: 'fountain' });
    P.addCyl({ x, z, r: 2.6, y0: g0 + 2.7, y1: g0 + 3.45, tag: 'fountain' });
    // falling water
    const c1 = waterCurtain(2.75, 3.4, 3.4 - (F.level - g0)); c1.position.set(x, (g0 + 3.4 + F.level) / 2, z); scene.add(c1);
    const c2 = waterCurtain(1.42, 1.9, 2.2); c2.position.set(x, g0 + 4.5, z); scene.add(c2);
    const jet = waterCurtain(0.08, 0.25, 1.6); jet.position.set(x, g0 + 7.1, z); scene.add(jet);
    let tt = 0;
    CS.animate.push((dt, cam) => {
      if (Math.hypot(cam.x - x, cam.z - z) > 90) return;
      tt -= dt;
      if (tt > 0) return;
      tt = 0.45;
      const a = Math.random() * TAU;
      G.fx.ring(x + Math.cos(a) * 3.2, F.level - 0.1, z + Math.sin(a) * 3.2, 1.3, 0.9, 0xeafaff);
    });
  }

  // ------------------------------------------------------------------
  // plaza, gardens, lamps and hedges
  // ------------------------------------------------------------------
  function buildGrounds(scene) {
    const D = G.decor;
    buildFountain(scene);
    // lamps around the plaza and along the roads
    [[-27, 230], [-27, 254], [27, 230], [27, 254], [-12, 226.5], [12, 226.5], [-6, 214], [6, 214], [-40, 245.5], [40, 245.5]].forEach(([x, z]) => D.lamp(scene, x, z));
    // hedges framing the plaza (gaps where the roads leave)
    D.hedge(scene, -30.5, 227, -30.5, 238.5, 1.3, 1.2); D.hedge(scene, -30.5, 246, -30.5, 257, 1.3, 1.2);
    D.hedge(scene, 30.5, 227, 30.5, 238.5, 1.3, 1.2); D.hedge(scene, 30.5, 246, 30.5, 257, 1.3, 1.2);
    D.hedge(scene, -29, 225.2, -10, 225.2, 1.3, 1.2); D.hedge(scene, 10, 225.2, 29, 225.2, 1.3, 1.2);
    D.hedge(scene, -29, 258.8, -7, 258.8, 1.1, 1.1); D.hedge(scene, 7, 258.8, 29, 258.8, 1.1, 1.1);
    // formal gardens either side of the plaza: hedge squares with flower beds and small trees
    [-1, 1].forEach((s) => {
      const gx = s * 54, gz = 262;
      D.flowers(scene, gx, gz, 13);
      D.hedge(scene, gx - 12, gz - 12, gx + 12, gz - 12, 1.0, 1.0);
      D.hedge(scene, gx - 12, gz + 12, gx + 12, gz + 12, 1.0, 1.0);
      D.hedge(scene, gx - 12, gz - 12, gx - 12, gz - 3, 1.0, 1.0); D.hedge(scene, gx - 12, gz + 3, gx - 12, gz + 12, 1.0, 1.0);
      D.hedge(scene, gx + 12, gz - 12, gx + 12, gz - 3, 1.0, 1.0); D.hedge(scene, gx + 12, gz + 3, gx + 12, gz + 12, 1.0, 1.0);
      [[-7, -7], [7, -7], [-7, 7], [7, 7]].forEach(([a, b]) => D.tree(gx + a, gz + b, 'round', 0.7));
    });
    D.flowers(scene, -46, 232, 9); D.flowers(scene, 46, 232, 9);
    // garden cannon (to the castle terrace) with its switch
    G.cannon(scene, -44, 268, { switchAt: [-60, 244] });
    G.sign(scene, -38.5, 266, Math.PI * 0.8, "Garden cannon. Stomp the red switch in the west garden to unlock it, then aim high at the castle terrace.");
  }

  // ------------------------------------------------------------------
  // Hollyhock Village: cottages around a green, a well, gardens and chimney smoke
  // ------------------------------------------------------------------
  function cottage(scene, x, z, yaw, w, d, h, roofKind, shutter) {
    const y = G.decor.anchor(x, z, Math.max(w, d) * 0.55, 0.3);
    const cy = Math.cos(yaw), sy = Math.sin(yaw);
    const L = (lx, lz) => [x + lx * cy + lz * sy, z - lx * sy + lz * cy];
    add(scene, box(w, h + 0.6, d), M.plaster, x, y + (h + 0.6) / 2 - 0.3, z, yaw);
    add(scene, box(w + 0.3, 0.7, d + 0.3), M.stoneDark, x, y + 0.2, z, yaw);
    // timber frame
    [[-w / 2, -d / 2], [w / 2, -d / 2], [-w / 2, d / 2], [w / 2, d / 2]].forEach(([a, b]) => {
      const [px, pz] = L(a, b); add(scene, box(0.35, h, 0.35), M.timber, px, y + h / 2, pz, yaw);
    });
    [[0, d / 2 + 0.05], [0, -d / 2 - 0.05]].forEach(([a, b]) => { const [px, pz] = L(a, b); add(scene, box(w, 0.3, 0.2), M.timber, px, y + h - 0.15, pz, yaw); });
    // roof
    const rh = 3.2, over = 0.7;
    const gr = gable(w + over * 2, d + over * 2, rh);
    const roofMat = roofKind === 'thatch' ? M.thatch : roofKind === 'green' ? M.roofGreen : M.roofRed;
    add(scene, gr.slopes, roofMat, x, y + h, z, yaw);
    add(scene, gr.tri, M.plaster, x, y + h, z, yaw);
    // door (front = +z local), windows with shutters, chimney
    { const [px, pz] = L(0, d / 2 + 0.1); add(scene, box(1.5, 2.4, 0.2), M.door, px, y + 1.2, pz, yaw); }
    [-w / 2 + 1.4, w / 2 - 1.4].forEach((a) => {
      const [px, pz] = L(a, d / 2 + 0.02);
      windowAt(scene, px, y + 1.4, pz, yaw, 0.75, true);
      [-0.65, 0.65].forEach((o) => { const [qx, qz] = L(a + o, d / 2 + 0.12); add(scene, box(0.45, 1.5, 0.08), shutter, qx, y + 2.1, qz, yaw); });
    });
    { const [px, pz] = L(-w / 2 - 0.02, 0); windowAt(scene, px, y + 1.4, pz, yaw - Math.PI / 2, 0.75, true); }
    const [chx, chz] = L(w / 2 - 1.2, -d / 4);
    add(scene, box(0.9, 3.2, 0.9), M.stoneDark, chx, y + h + 1.9, chz, yaw);
    CS.chimneys.push({ x: chx, y: y + h + 3.6, z: chz, t: Math.random() * 2 });
    CS.houses.push({ x, z, yaw, w: w + over * 2, ridge: y + h + rh });
    P.addBox({ x, y: y + h / 2 - 0.3, z, hx: w / 2, hy: h / 2 + 0.3, hz: d / 2, yaw, tag: 'house' });
    gableCollider(x, z, yaw, w + over * 2, d + over * 2 - 0.4, rh, y + h, 7);
  }
  function buildVillage(scene) {
    const D = G.decor, V = T().village;
    const houses = [
      [0, 'thatch'], [0.8, 'red'], [1.6, 'green'], [2.35, 'thatch'], [3.1, 'red'], [3.9, 'thatch'], [4.65, 'green'],
    ];
    houses.forEach(([a, roof], i) => {
      const r = 27 + (i % 2) * 3, x = V.x + Math.cos(a) * r, z = V.z + Math.sin(a) * r;
      const yaw = Math.atan2(V.x - x, V.z - z); // door (+z local) faces the green
      cottage(scene, x, z, yaw, 7 + (i % 3), 6 + (i % 2), 4.2, roof, M.shutter[i % 4]);
      D.flowers(scene, x + Math.cos(a) * 7, z + Math.sin(a) * 7, 5);
    });
    // well on the green
    const wy = T().heightAt(V.x, V.z);
    add(scene, new THREE.CylinderGeometry(1.5, 1.6, 1.4, 32, 1, true), M.stoneDark, V.x, wy + 0.5, V.z);
    add(scene, new THREE.TorusGeometry(1.55, 0.18, 8, 40).rotateX(Math.PI / 2), M.stone, V.x, wy + 1.2, V.z);
    add(scene, new THREE.CircleGeometry(1.45, 32).rotateX(-Math.PI / 2), M.wellWater, V.x, wy + 0.4, V.z, 0, false).castShadow = false;
    [-1.3, 1.3].forEach((o) => add(scene, box(0.25, 2.6, 0.25), M.timber, V.x + o, wy + 1.8, V.z));
    const wr = gable(3.6, 3.2, 1.2); add(scene, wr.slopes, M.roofRed, V.x, wy + 3.1, V.z, Math.PI / 2);
    P.addCyl({ x: V.x, z: V.z, r: 1.75, y0: wy - 1, y1: wy + 1.3, tag: 'well' });
    // lamps, fences, gardens
    [[12, 12], [-12, 12], [12, -12], [-12, -12]].forEach(([a, b]) => D.lamp(scene, V.x + a, V.z + b));
    D.fence(scene, [[V.x - 52, V.z + 30], [V.x - 30, V.z + 48], [V.x - 5, V.z + 52]]);
    D.fence(scene, [[V.x + 20, V.z + 46], [V.x + 44, V.z + 30]]);
    D.shrubs(V.x, V.z, 70, 45, (bx, bz) => Math.hypot(bx - V.x, bz - V.z) < 36);
    D.forest(V.x - 40, V.z + 55, 22, 8, 'round');
    D.forest(V.x + 58, V.z + 36, 18, 5, 'mix');
    G.sign(scene, V.x + 20, V.z - 20, -Math.PI * 0.75, "Hollyhock Village. Friendly folk, warm chimneys and sturdy rooftops. Rooftop hopping is a local sport!");
  }

  // ------------------------------------------------------------------
  // build + per-frame
  // ------------------------------------------------------------------
  CS.build = function (scene) {
    materials();
    CS.animate = []; CS.chimneys = []; CS.houses = []; CS.paintings = []; CS.warp = null;
    buildCastle(scene);
    buildBridge(scene);
    buildGrounds(scene);
    buildVillage(scene);
    G.decor.windmill(scene, 215, 300, 1.35);
    G.sign(scene, 196, 290, Math.PI * 0.8, "Windmill Downs. The breeze here never stops; follow the hedgerows to the old mill.");
  };
  // ---------- warps (paintings, Sun Door, keep door, pause-menu shortcut) ----------
  CS.warpTo = function (dest, opts) {
    if (CS.warp) return;
    CS.warp = { t: 0, dest, painting: opts && opts.painting };
    G.player.controlLock = 1.2;
    G.audio.sfx.warp();
  };
  CS.foyerSpot = () => ({ x: 0, y: CS.hall.floorY, z: CS.hall.z0 + 2.2, face: 0, name: 'Grand Foyer' });
  CS.inside = (p) => { const H = CS.hall; return !!H && p.x > H.x0 && p.x < H.x1 && p.z > H.z0 - 0.3 && p.z < H.z1 && p.y < H.ceilY; };
  function updateWarp(dt) {
    const w = CS.warp;
    if (!w) return;
    const pl = G.player;
    w.t += dt;
    if (w.painting && w.t < 0.5) { pl.pos.x -= w.painting.nx * dt * 2.5; pl.pos.z -= w.painting.nz * dt * 2.5; pl.vel.set(0, 0, 0); }
    if (w.t > 0.25 && !w.faded) { w.faded = true; G.hud.fade(true); }
    if (w.t > 0.7 && !w.moved) {
      w.moved = true;
      const d = w.dest;
      const y = d.y != null ? d.y : G.physics.ground(d.x, d.z, 999, 0, 0).h;
      pl.spawn(d.x, y + 0.05, d.z, d.face);
      pl.controlLock = 0.3;
      if (G.boss.active() || G.boss.state === 'dormantReady') { G.boss.reset(); G.hud.bossBar(false); G.music.setRage(0); }
      G.game.checkpoint = { x: d.x, y: y + 0.5, z: d.z, face: d.face };
      G.camera.mode = 'follow'; G.camera.snapBehind(d.face); G.camera.pitch = 0.3;
    }
    if (w.t > 0.95) { G.hud.fade(false); if (w.dest.name) G.hud.area(w.dest.name); CS.warp = null; }
  }
  function updateInterior(dt) {
    const pl = G.player, H = CS.hall;
    if (!H) return;
    // main doors swing open as the player comes near (from either side)
    const Dd = CS.door;
    if (Dd) {
      const dz = pl.pos.z - (H.front + 0.6);
      const want = Math.abs(pl.pos.x) < 5 && Math.abs(dz) < 6 && pl.pos.y < H.floorY + 4 ? 1 : 0;
      if (want && Dd.open < 0.05 && !Dd.sfx) { G.audio.sfx.door(); Dd.sfx = 1; }
      if (!want && Dd.open < 0.05) Dd.sfx = 0;
      Dd.open = U.damp(Dd.open, want, want ? 4 : 2.2, dt);
      Dd.leaves[0].rotation.y = -Dd.open * 1.45; Dd.leaves[1].rotation.y = Dd.open * 1.45;
      Dd.col.solid = Dd.open < 0.55;
    }
    if (CS.chandelier) CS.chandelier.rotation.z = Math.sin(G.gfx.uTime.value * 0.7) * 0.012;
    // paintings shimmer when approached; touching one (usually mid-jump) dives into it
    CS.paintings.forEach((p) => {
      const cxp = pl.pos.x - p.x, cyp = pl.pos.y + 0.9 - p.y, czp = pl.pos.z - p.z;
      const d = cxp * p.nx + czp * p.nz, u = cxp * p.tx + czp * p.tz;
      const near = Math.abs(u) < p.W / 2 + 0.6 && Math.abs(cyp) < p.H / 2 + 1.5 && d < 4 && d > -0.5;
      if (p.t > 0) p.t -= dt;
      p.rip.value = U.damp(p.rip.value, p.t > 0 ? 1 : near ? 0.3 : 0.05, 5, dt);
      if (!CS.warp && G.game.state === 'play' && d < 0.8 && d > -0.6 && Math.abs(u) < p.W / 2 && Math.abs(cyp) < p.H / 2 - 0.1) {
        p.hit.value.set(0.5 + u / p.W, 0.5 + cyp / p.H);
        p.t = 1.2;
        CS.warpTo(p.dest, { painting: p });
      }
    });
    // the Sun Door (3 gems) leads out onto the terrace; the keep door brings you back to the gallery
    const sd = CS.sunDoor;
    if (sd) {
      const gems = G.game.stats ? G.game.stats.gems.length : 0;
      sd.mat.emissiveIntensity = 0.25 + (gems >= 3 ? 0.4 + Math.sin(G.gfx.uTime.value * 3) * 0.15 : 0);
      const at = Math.abs(pl.pos.x - sd.x) < 2.2 && pl.pos.z > sd.z - 2.3 && pl.pos.y > sd.y - 0.6 && pl.pos.y < sd.y + 3;
      if (at && !CS.warp) {
        if (gems >= 3) CS.warpTo({ x: 0, y: H.top, z: 301.2, face: Math.PI, name: 'Castle Terrace' });
        else if (!sd.warned) { sd.warned = true; G.audio.sfx.locked(); G.hud.toast('The Sun Door opens for 3 Sun Gems. You have ' + gems + '.', 3); }
      } else if (!at) sd.warned = false;
    }
    const kd = CS.keepDoor;
    if (kd && !CS.warp && Math.abs(pl.pos.x - kd.x) < 1.6 && pl.pos.z > kd.z - 1.4 && pl.pos.z < kd.z + 1 && pl.pos.y > kd.y - 0.5 && pl.pos.y < kd.y + 3) {
      CS.warpTo({ x: 0, y: H.GY, z: H.z1 - 3.4, face: Math.PI, name: 'Grand Foyer' });
    }
  }

  let smokeMat = null;
  const puffs = [];
  CS.update = function (dt, cam) {
    if (!CS.animate) return;
    CS.animate.forEach((f) => f(dt, cam));
    updateInterior(dt);
    updateWarp(dt);
    if (!smokeMat && G.collect.glowTex) smokeMat = new THREE.SpriteMaterial({ map: G.collect.glowTex, color: 0xd8d8d8, transparent: true, opacity: 0.35, depthWrite: false });
    CS.chimneys.forEach((c) => {
      if (Math.abs(cam.x - c.x) + Math.abs(cam.z - c.z) > 220) return;
      c.t -= dt;
      if (c.t > 0 || puffs.length > 60) return;
      c.t = 0.7 + Math.random() * 0.5;
      const s = new THREE.Sprite(smokeMat.clone());
      s.position.set(c.x, c.y, c.z); s.scale.setScalar(1.2);
      G.game.scene.add(s);
      puffs.push({ s, t: 0 });
    });
    for (let i = puffs.length - 1; i >= 0; i--) {
      const p = puffs[i];
      p.t += dt;
      p.s.position.y += dt * 1.4; p.s.position.x += dt * 0.6;
      p.s.scale.setScalar(1.2 + p.t * 1.6);
      p.s.material.opacity = 0.35 * (1 - p.t / 4);
      if (p.t > 4) { p.s.parent && p.s.parent.remove(p.s); p.s.material.dispose(); puffs.splice(i, 1); }
    }
  };
  CS.reset = function () { puffs.length = 0; CS.warp = null; };
})(window.G);

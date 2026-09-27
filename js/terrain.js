// terrain.js — analytic heightfield for the whole 800 m world: the original playfield (meadow, gorge,
// plain, spiral mountain, hills, Mirrorpool, vale) surrounded by castle grounds with a moat, a village,
// windmill downs, a coral lagoon, woods with ruins, and highlands with a waterfall. Also: water bodies,
// 1 m mesh generation with material weights, and collision queries that match the rendered triangles.
(function (G) {
  'use strict';
  const U = G.U, TAU = U.TAU;

  const T = {
    HALF: 400, N: 800, CELL: 1, WATER_Y: -8,
    heights: null,
    meshes: [],
  };

  // ---------- landmarks ----------
  T.castle = { x: 0, z: 312, island: 36, bankIn: 38.5, bankOut: 49.5, rim: 52, groundY: 2.4, islandY: 5.0, moatY: 1.2 };
  T.lagoon = { x: 300, z: 25, rx: 92, rz: 118 };
  T.village = { x: -150, z: 300 };
  T.ruins = { x: -300, z: 45 };
  T.falls = { x: 40, zTop: -253, pond: { x: 40, z: -226 }, high: { x: 40, z: -276, level: 20.6 } };
  T.fountain = { x: 0, z: 242, r: 5.2, level: 3.1 };

  // ---------- spiral mountain ----------
  const MT = T.mtn = {
    x: 0, z: -50,
    R0: 80, Rend: 27, TURNS: 3,
    H0: 1.2, Hs: 76, plateauR: 22,
    theta0: Math.PI / 2,          // path starts on the south face, facing the meadow
  };
  MT.T = MT.TURNS * TAU;
  MT.rp = (t) => MT.R0 - (MT.R0 - MT.Rend) * (t / MT.T);
  MT.yp = (t) => MT.H0 + (MT.Hs - MT.H0) * (t / MT.T);
  // half width of the path; it narrows on the upper "Knife-edge" stretch
  MT.hw = (t) => {
    const n = U.smoothstep(4.25 * Math.PI, 4.5 * Math.PI, t) * (1 - U.smoothstep(5.05 * Math.PI, 5.3 * Math.PI, t));
    return 5 - 2.2 * n;
  };
  MT.point = function (t, lateral) { // world point on the path centre line (+lateral = outward)
    const a = MT.theta0 + t;
    const r = MT.rp(t) + (lateral || 0);
    return { x: MT.x + Math.cos(a) * r, z: MT.z + Math.sin(a) * r, y: MT.yp(t) };
  };
  MT.tangent = function (t) {
    const a = MT.theta0 + t, r = MT.rp(t), dr = -(MT.R0 - MT.Rend) / MT.T;
    const tx = -Math.sin(a) * r + Math.cos(a) * dr, tz = Math.cos(a) * r + Math.sin(a) * dr;
    const l = Math.hypot(tx, tz);
    return { x: tx / l, z: tz / l };
  };

  function mountain(x, z) {
    const dx = x - MT.x, dz = z - MT.z, r = Math.hypot(dx, dz);
    if (r > MT.R0 + 60) return null;
    let th = Math.atan2(dz, dx) - MT.theta0;
    th = ((th % TAU) + TAU) % TAU;
    const SEAM = 0.1; // blend across the seam where one turn of the spiral meets the next
    if (th < SEAM) {
      const a = mountainAt(r, th), b = mountainAt(r, th + TAU);
      const f = U.smoothstep(0, SEAM, th);
      const res = f > 0.5 ? a : b;
      return Object.assign({}, res, { h: U.lerp(b.h, a.h, f) });
    }
    return mountainAt(r, th);
  }
  function mountainAt(r, th) {
    let kLast = -1;
    for (let k = 0; k < 5; k++) {
      const t = th + TAU * k;
      if (t > MT.T) break;
      if (r <= MT.rp(t) + MT.hw(t)) kLast = k; else break;
    }
    if (kLast < 0) {
      const t = th, edge = MT.rp(t) + MT.hw(t);
      return { h: MT.yp(t) - (r - edge) * 3.2, type: 'cliff', t, band: -1 };
    }
    const t = th + TAU * kLast, c = MT.rp(t), hw = MT.hw(t);
    if (r >= c - hw) return { h: MT.yp(t), type: 'path', t, band: kLast, edge: Math.min(r - (c - hw), (c + hw) - r) };
    const t2 = t + TAU;
    if (t2 <= MT.T) {
      const a = c - hw, b = MT.rp(t2) + MT.hw(t2);
      const s = U.clamp((a - r) / (a - b), 0, 1);
      return { h: U.lerp(MT.yp(t), MT.yp(t2), s * s * (3 - 2 * s)), type: 'rock', t, band: kLast };
    }
    if (r <= MT.plateauR) return { h: MT.Hs, type: 'summit', t: MT.T, band: 99 };
    const a = c - hw, s = U.clamp((a - r) / Math.max(0.01, a - MT.plateauR), 0, 1);
    return { h: U.lerp(MT.yp(t), MT.Hs, s * s * (3 - 2 * s)), type: 'rock', t, band: kLast };
  }
  T.mountainInfo = mountain;

  // ---------- roads (with a bucketed distance query) ----------
  function bump(x, z, cx, cz, r, h) {
    const d = Math.hypot(x - cx, z - cz);
    return d < r ? h * 0.5 * (1 + Math.cos(Math.PI * d / r)) : 0;
  }
  T.riverZ = (x) => 118 + 9 * Math.sin(x * 0.02);
  const ROADS = [
    [[6, 226], [0, 204], [0, 165], [6, 145], [0, 134]],
    [[0, 102], [-5, 85], [4, 60], [0, 36]],
    [[-5, 85], [-50, 78], [-100, 60], [-140, 32]],
    [[4, 60], [50, 55], [88, 72], [96, 84]],
    [[0, 165], [-60, 160], [-110, 140], [-130, 131]],
    [[-130, 96], [-138, 70], [-140, 32]],
    [[6, 145], [45, 150], [66, 142]],
    [[96, 84], [120, 70], [140, 40]],
    // new areas
    [[-9, 205], [-60, 232], [-112, 270], [-140, 290]],
    [[-28, 242], [-90, 256], [-136, 286]],
    [[28, 242], [90, 262], [160, 290], [202, 296]],
    [[140, 40], [190, 34], [214, 26]],
    [[150, -72], [196, -60], [226, -46]],
    [[-130, 131], [-190, 150], [-250, 160], [-300, 142]],
    [[-300, 100], [-302, 72], [-300, 58]],
    [[-140, 32], [-200, 22], [-258, 38], [-288, 45]],
    [[-80, -165], [-118, -205], [-128, -240], [-122, -272], [-96, -300], [-40, -312]],
    [[-40, -312], [10, -300], [34, -282]],
  ];
  T.ROADS = ROADS;
  const RB = 32, roadBuckets = new Map();
  (function bucketRoads() {
    for (const line of ROADS) for (let i = 0; i < line.length - 1; i++) {
      const [ax, az] = line[i], [bx, bz] = line[i + 1];
      const x0 = Math.floor((Math.min(ax, bx) - 8) / RB), x1 = Math.floor((Math.max(ax, bx) + 8) / RB);
      const z0 = Math.floor((Math.min(az, bz) - 8) / RB), z1 = Math.floor((Math.max(az, bz) + 8) / RB);
      for (let gx = x0; gx <= x1; gx++) for (let gz = z0; gz <= z1; gz++) {
        const k = gx + ',' + gz;
        if (!roadBuckets.has(k)) roadBuckets.set(k, []);
        roadBuckets.get(k).push([ax, az, bx, bz]);
      }
    }
  })();
  function roadDist(x, z) { // exact within ~8 m of a road, 99 otherwise
    const list = roadBuckets.get(Math.floor(x / RB) + ',' + Math.floor(z / RB));
    if (!list) return 99;
    let best = 99;
    for (const s of list) { const d = U.distPointSeg2D(x, z, s[0], s[1], s[2], s[3]); if (d < best) best = d; }
    return best;
  }
  T.roadDist = roadDist;

  // ---------- base landscape ----------
  const RIVER_RAMPS = [-236, -70, 42, 176];     // gentle banks where swimmers can climb out of the river
  function islet(x, z, cx, cz, r, top) {
    const d = Math.hypot(x - cx, z - cz);
    if (d >= r) return -99;
    const f = d / r;
    return top - f * f * (top + 28);
  }
  function base(x, z) {
    let h = 2.5 + 1.4 * Math.sin(x * 0.043 + 1.3) * Math.cos(z * 0.037 - 0.4)
      + 1.0 * U.vnoise(x * 0.06, z * 0.06) + 0.45 * U.vnoise(x * 0.17 + 9, z * 0.17);
    // broad undulation outside the original playfield
    const e0 = Math.max(Math.abs(x), Math.abs(z));
    const outer = U.smoothstep(200, 255, e0);
    if (outer > 0) h += outer * (4.2 * U.vnoise(x * 0.011 + 3, z * 0.011 - 7) + 2.0 * U.vnoise(x * 0.027, z * 0.027 + 5));
    const ds = Math.hypot(x, z - 185);
    h = U.lerp(h, 2, U.smoothstep(48, 26, ds) * 0.85);
    // hills (original), then the new rolling downs and wooded hills
    h += bump(x, z, 140, 50, 38, 16) + bump(x, z, 175, -25, 26, 24) + bump(x, z, 108, 2, 20, 9)
      + bump(x, z, 96, 88, 13, 6) + bump(x, z, -62, 172, 18, 7) + bump(x, z, 52, 178, 15, 5)
      + bump(x, z, -95, 75, 10, 3) + bump(x, z, 60, -170, 22, 6);
    h += bump(x, z, 150, 252, 42, 9) + bump(x, z, 215, 300, 34, 13) + bump(x, z, 112, 330, 28, 6)
      + bump(x, z, -262, -42, 46, 10) + bump(x, z, -336, 40, 40, 13) + bump(x, z, -282, 212, 42, 8)
      + bump(x, z, -340, -150, 52, 15) + bump(x, z, -228, 332, 34, 7) + bump(x, z, 250, -250, 60, 14)
      + bump(x, z, 190, -330, 45, 11);
    // west mesa: flat top, sheer sides
    const dm = Math.hypot(x + 165, z + 20);
    h += 6.6 * U.smoothstep(23.2, 21.4, dm);
    // Hollow Vale: the land north of the mountain drops lower
    h -= 5.5 * U.smoothstep(-128, -150, z);
    // north cliff shelf (vale) and, further north, the highlands plateau behind a sheer cliff
    const shelf = 15 * U.smoothstep(-196, -200, z) * U.smoothstep(-110, -104, x) * (1 - U.smoothstep(-24, -18, x));
    const cliffZ = -250 + 7 * Math.sin(x * 0.028 + 1);
    let plateau = 27 * U.smoothstep(cliffZ + 3.2, cliffZ - 3.2, z);
    const rampW = U.smoothstep(-172, -158, x) * (1 - U.smoothstep(-96, -82, x));
    if (rampW > 0) plateau = U.lerp(plateau, 27 * U.smoothstep(-200, -282, z), rampW);
    h += Math.max(shelf, plateau);
    // highland pond and the stream that feeds the waterfall
    const dh = Math.hypot(x - T.falls.high.x, z - T.falls.high.z);
    if (dh < 44) {
      h = U.lerp(h, 23.4, U.smoothstep(44, 24, dh));
      h = U.lerp(h, 18.4, U.smoothstep(19, 9, dh));
    }
    if (Math.abs(x - 40) < 6 && z > -268 && z < -246) {
      const k = (1 - U.smoothstep(2.6, 4.2, Math.abs(x - 40))) * U.smoothstep(-268, -262, z);
      h = Math.min(h, U.lerp(h, 19.2, k));
    }
    // waterfall plunge pool at the cliff base
    const dp = Math.hypot(x - T.falls.pond.x, z - T.falls.pond.z);
    const pr = 22 + 13 * U.smoothstep(-234, -212, z); // gentle beach on the south side, sheer on the cliff side
    h = U.lerp(h, -15, U.smoothstep(pr, 8, dp));
    // Mirrorpool basin
    const dl = Math.hypot(x - 150, z + 112);
    h = U.lerp(h, -20, U.smoothstep(40, 31, dl));
    // Coral Lagoon: beaches, a deep bowl with underwater hills and two islets
    const L = T.lagoon;
    const lq = Math.hypot((x - L.x) / L.rx, (z - L.z) / L.rz) + U.vnoise(x * 0.031, z * 0.031) * 0.07;
    if (lq < 1.3) {
      const floorH = -9.5 - 17 * U.smoothstep(0.9, 0.35, lq) + 3.2 * U.vnoise(x * 0.045 + 4, z * 0.045);
      h = U.lerp(h, floorH, U.smoothstep(1.22, 0.9, lq));
      h = Math.max(h, islet(x, z, 282, -18, 14, -5.4), islet(x, z, 334, 70, 12, -5.8));
    }
    // castle grounds: gardens, island plateau and moat
    const C = T.castle, dc = Math.hypot(x - C.x, z - C.z);
    if (dc < 132) {
      h = U.lerp(h, C.groundY, U.smoothstep(132, 72, dc) * 0.94);
      if (dc < 56) {
        let v;
        if (dc <= C.island) v = C.islandY;
        else if (dc <= C.bankIn) v = U.lerp(C.islandY, -1.2, U.smoothstep(C.island, C.bankIn, dc));
        else if (dc <= C.bankOut) { const q = (dc - 44) / 5.5; v = -2.8 + 1.6 * q * q; }
        else if (dc <= C.rim) v = U.lerp(-1.2, C.groundY, U.smoothstep(C.bankOut, C.rim, dc));
        else v = C.groundY;
        h = U.lerp(v, h, U.smoothstep(53, 56, dc));
      }
    }
    // plaza in front of the castle and the village green
    const plaza = (1 - U.smoothstep(30, 38, Math.abs(x))) * U.smoothstep(216, 226, z) * (1 - U.smoothstep(258, 262, z));
    h = U.lerp(h, C.groundY, plaza);
    const dv = Math.hypot(x - T.village.x, z - T.village.z);
    h = U.lerp(h, 2.6, U.smoothstep(62, 36, dv));
    const dr = Math.hypot(x - T.ruins.x, z - T.ruins.z);
    h = U.lerp(h, 3.2, U.smoothstep(34, 20, dr));
    // Tumbledown Gorge (river) with a few gentle exit banks on the south side
    const rz = T.riverZ(x), d = Math.abs(z - rz);
    const hN = U.lerp(h, -18, U.smoothstep(17, 7.5, d));
    let rm = 0;
    for (const rx of RIVER_RAMPS) rm = Math.max(rm, 1 - U.smoothstep(7, 15, Math.abs(x - rx)));
    if (rm > 0 && z > rz) {
      const hR = U.lerp(U.lerp(h, -9.6, U.smoothstep(42, 12, d)), -18, U.smoothstep(11, 7.5, d));
      h = U.lerp(hN, Math.min(hN, hR), rm);
    } else h = hN;
    // mountain ring at the edge of the world
    const e = Math.max(Math.abs(x), Math.abs(z));
    if (e > 366) {
      const k = Math.min(1, Math.pow((e - 366) / 20, 1.65) * 16 / 58);
      h += k * (52 + 20 * U.vnoise(x * 0.012 + 5, z * 0.012 - 2) + 12 * U.vnoise(x * 0.041, z * 0.041 + 9));
    }
    return h;
  }
  T.baseHeight = base;

  T.sample = function (x, z) {
    const b = base(x, z);
    const m = mountain(x, z);
    if (m && m.h > b) return { h: m.h, type: m.type, m };
    return { h: b, type: 'ground', m: null };
  };

  // stone paving (plaza, castle courtyard, village square, ruins)
  function paving(x, z) {
    const C = T.castle;
    let p = (1 - U.smoothstep(26, 29, Math.abs(x))) * U.smoothstep(226, 229, z) * (1 - U.smoothstep(254, 257, z));
    const dc = Math.hypot(x - C.x, z - C.z);
    if (dc < C.island && z < C.z - 12) p = Math.max(p, 1 - U.smoothstep(C.island - 3, C.island - 1, dc));
    p = Math.max(p, 1 - U.smoothstep(12, 14, Math.hypot(x - T.village.x, z - T.village.z)));
    p = Math.max(p, (1 - U.smoothstep(14, 17, Math.hypot(x - T.ruins.x, z - T.ruins.z))) * 0.85);
    return p;
  }
  T.paving = paving;

  // ---------- water bodies ----------
  // The sea level (-8) fills every basin; the moat, the highland pond and the fountain sit higher.
  const F = T.falls;
  T.waterBodies = [
    { name: 'sea', level: T.WATER_Y, contains: () => true },
    { name: 'moat', level: T.castle.moatY, contains: (x, z) => { const d = Math.hypot(x - T.castle.x, z - T.castle.z); return d > T.castle.island - 1 && d < T.castle.rim + 1; } },
    { name: 'highland', level: F.high.level, contains: (x, z) => Math.hypot(x - F.high.x, z - F.high.z) < 18 || (Math.abs(x - 40) < 4.5 && z > -262 && z < -247.5) },
    { name: 'fountain', level: T.fountain.level, contains: (x, z) => Math.hypot(x - T.fountain.x, z - T.fountain.z) < T.fountain.r },
  ];
  // water surface height at (x,z), or null when dry
  T.waterLevelAt = function (x, z) {
    const g = T.heightAt(x, z);
    let best = null;
    for (const b of T.waterBodies) {
      if (g < b.level && (best === null || b.level > best) && b.contains(x, z)) best = b.level;
    }
    return best;
  };
  T.waterDepthAt = function (x, z) {
    const w = T.waterLevelAt(x, z);
    return w === null ? 0 : w - T.heightAt(x, z);
  };

  // ---------- grid + mesh (built in slices so the loading screen stays responsive) ----------
  T.build = async function (scene, progress) {
    if (T.meshes.length) { T.meshes.forEach((m) => scene.add(m)); return; }
    const N = T.N, C = T.CELL, H = T.HALF, W = N + 1;
    const hs = (T.heights = new Float32Array(W * W));
    const mats = new Float32Array(W * W * 4);
    const pave = new Float32Array(W * W);
    const types = new Array(W * W);
    for (let j = 0; j <= N; j++) {
      for (let i = 0; i <= N; i++) {
        const x = -H + i * C, z = -H + j * C, k = j * W + i;
        const s = T.sample(x, z);
        hs[k] = s.h; types[k] = s.type;
        let g = 1, d = 0, r = 0, sa = 0, pv = 0;
        if (s.type === 'path') { d = 1; g = 0; }
        else if (s.type === 'rock' || s.type === 'cliff') { r = 1; g = 0; }
        else {
          const rd = roadDist(x, z);
          d = 1 - U.smoothstep(2.4, 3.8, rd);
          // sand on every shore that sits close to its water level
          const lq = Math.hypot((x - T.lagoon.x) / T.lagoon.rx, (z - T.lagoon.z) / T.lagoon.rz);
          const shoreSea = s.h < T.WATER_Y + (lq < 1.2 ? 7.5 : 5.5);
          const nearWater = Math.abs(z - T.riverZ(x)) < 19 || Math.hypot(x - 150, z + 112) < 41 || lq < 1.25 || Math.hypot(x - 40, z + 226) < 24;
          if (nearWater && shoreSea) sa = U.smoothstep(T.WATER_Y + (lq < 1.2 ? 8 : 6), T.WATER_Y + 2.5, s.h);
          pv = paving(x, z);
          d = Math.max(0, d - pv);
          g = Math.max(0, 1 - d - sa - pv);
        }
        mats[k * 4] = g; mats[k * 4 + 1] = d; mats[k * 4 + 2] = r; mats[k * 4 + 3] = sa;
        pave[k] = pv;
      }
      if (j % 40 === 0) { progress && progress(0.1 + 0.6 * (j / N)); await new Promise((r) => setTimeout(r, 0)); }
    }
    const hAt = (i, j) => hs[U.clamp(j, 0, N) * W + U.clamp(i, 0, N)];
    const normals = new Float32Array(W * W * 3);
    const ao = new Float32Array(W * W);
    const grassMask = (T.grassMask = new Float32Array(W * W));
    T.waterGrid = new Float32Array(W * W);
    for (let j = 0; j <= N; j++) {
      for (let i = 0; i <= N; i++) {
        const k = j * W + i;
        const dx = (hAt(i + 1, j) - hAt(i - 1, j)) / (2 * C), dz = (hAt(i, j + 1) - hAt(i, j - 1)) / (2 * C);
        const l = Math.hypot(dx, 1, dz);
        normals[k * 3] = -dx / l; normals[k * 3 + 1] = 1 / l; normals[k * 3 + 2] = -dz / l;
        let sum = 0;
        for (const [a, b] of [[3, 0], [-3, 0], [0, 3], [0, -3], [2, 2], [-2, 2], [2, -2], [-2, -2]]) sum += hAt(i + a, j + b);
        const conc = sum / 8 - hs[k];
        ao[k] = U.clamp(1 - Math.max(0, conc) * 0.11, 0.52, 1);
        const ny = 1 / l, x = -H + i * C, z = -H + j * C;
        const wl = waterAtGrid(x, z, hs[k]);
        T.waterGrid[k] = wl === null ? -1000 : wl;
        const wet = wl === null ? 1 : U.smoothstep(wl + 0.6, wl + 1.6, hs[k]);
        let gm = mats[k * 4] * U.smoothstep(0.78, 0.9, ny) * wet * (1 - pave[k]);
        if (types[k] === 'summit') gm *= 0.65;
        grassMask[k] = gm;
      }
      if (j % 80 === 0) { progress && progress(0.7 + 0.2 * (j / N)); await new Promise((r) => setTimeout(r, 0)); }
    }
    function waterAtGrid(x, z, g) {
      let best = null;
      for (const b of T.waterBodies) if (g < b.level && (best === null || b.level > best) && b.contains(x, z)) best = b.level;
      return best;
    }
    const mat = G.gfx.terrainMaterial();
    const CH = 100; // 100 m chunks, culled by the frustum
    for (let cj = 0; cj < N; cj += CH) for (let ci = 0; ci < N; ci += CH) {
      const CW = CH + 1;
      const pos = new Float32Array(CW * CW * 3), nor = new Float32Array(CW * CW * 3);
      const am = new Float32Array(CW * CW * 4), ax = new Float32Array(CW * CW * 2);
      for (let j = 0; j <= CH; j++) for (let i = 0; i <= CH; i++) {
        const gi = ci + i, gj = cj + j, k = gj * W + gi, v = j * CW + i;
        pos[v * 3] = -H + gi * C; pos[v * 3 + 1] = hs[k]; pos[v * 3 + 2] = -H + gj * C;
        nor[v * 3] = normals[k * 3]; nor[v * 3 + 1] = normals[k * 3 + 1]; nor[v * 3 + 2] = normals[k * 3 + 2];
        am.set(mats.subarray(k * 4, k * 4 + 4), v * 4);
        ax[v * 2] = ao[k]; ax[v * 2 + 1] = pave[k];
      }
      const idx = new Uint32Array(CH * CH * 6);
      let p = 0;
      for (let j = 0; j < CH; j++) for (let i = 0; i < CH; i++) {
        const a = j * CW + i, b = a + 1, c = a + CW, d = c + 1;
        idx[p++] = a; idx[p++] = c; idx[p++] = b;
        idx[p++] = b; idx[p++] = c; idx[p++] = d;
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
      g.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
      g.setAttribute('aMat', new THREE.BufferAttribute(am, 4));
      g.setAttribute('aExtra', new THREE.BufferAttribute(ax, 2));
      g.setIndex(new THREE.BufferAttribute(idx, 1));
      g.computeBoundingSphere();
      const mesh = new THREE.Mesh(g, mat);
      // the full-resolution terrain only receives shadows; a coarse proxy casts them (gfx.js)
      mesh.castShadow = false; mesh.receiveShadow = true;
      mesh.userData.terrain = true; mesh.userData.noShadowCast = true;
      scene.add(mesh);
      T.meshes.push(mesh);
    }
    progress && progress(0.95);
  };

  // ---------- collision queries (match the triangles above) ----------
  T.heightAt = function (x, z) {
    const N = T.N, C = T.CELL, H = T.HALF, W = N + 1;
    const gx = (x + H) / C, gz = (z + H) / C;
    if (gx < 0 || gz < 0 || gx >= N || gz >= N) return 300;
    const i = Math.floor(gx), j = Math.floor(gz);
    const fx = gx - i, fz = gz - j, hs = T.heights;
    const ha = hs[j * W + i], hb = hs[j * W + i + 1], hc = hs[(j + 1) * W + i], hd = hs[(j + 1) * W + i + 1];
    if (fx + fz <= 1) return ha + (hb - ha) * fx + (hc - ha) * fz;
    return hd + (hc - hd) * (1 - fx) + (hb - hd) * (1 - fz);
  };
  // lowest terrain point under a footprint of radius r (for anchoring props on slopes)
  T.groundMin = function (x, z, r) {
    let m = T.heightAt(x, z);
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * TAU;
      m = Math.min(m, T.heightAt(x + Math.cos(a) * r, z + Math.sin(a) * r));
    }
    return m;
  };

  T.normalAt = function (x, z, out) {
    const N = T.N, C = T.CELL, H = T.HALF, W = N + 1;
    out = out || new THREE.Vector3();
    const gx = (x + H) / C, gz = (z + H) / C;
    if (gx < 0 || gz < 0 || gx >= N || gz >= N) return out.set(0, 1, 0);
    const i = Math.floor(gx), j = Math.floor(gz);
    const fx = gx - i, fz = gz - j, hs = T.heights;
    const ha = hs[j * W + i], hb = hs[j * W + i + 1], hc = hs[(j + 1) * W + i], hd = hs[(j + 1) * W + i + 1];
    let dhdx, dhdz;
    if (fx + fz <= 1) { dhdx = (hb - ha) / C; dhdz = (hc - ha) / C; }
    else { dhdx = (hd - hc) / C; dhdz = (hd - hb) / C; }
    return out.set(-dhdx, 1, -dhdz).normalize();
  };

  T.lineClear = function (ax, ay, az, bx, by, bz, margin) {
    const d = Math.hypot(bx - ax, bz - az);
    const n = Math.max(2, Math.ceil(d / 1.5));
    for (let i = 1; i < n; i++) {
      const f = i / n;
      if (T.heightAt(ax + (bx - ax) * f, az + (bz - az) * f) > ay + (by - ay) * f - (margin || 0)) return false;
    }
    return true;
  };

  // which area is (x,y,z) in? used for music, area names and enemy logic
  T.areaAt = function (x, y, z) {
    const mr = Math.hypot(x - MT.x, z - MT.z);
    if (mr < MT.plateauR + 2 && y > MT.Hs - 3) return 'summit';
    if (mr < MT.R0 + 8 && y > 7) {
      const m = mountain(x, z);
      if (m && m.band >= 2) return 'upper';
      return 'mountain';
    }
    if (Math.hypot(x - 150, z + 112) < 44) return 'lake';
    if (Math.hypot(x - T.castle.x, z - T.castle.z) < 125) return 'castle';
    if (Math.hypot(x - T.village.x, z - T.village.z) < 75) return 'village';
    if (Math.hypot((x - T.lagoon.x) / T.lagoon.rx, (z - T.lagoon.z) / T.lagoon.rz) < 1.25) return 'lagoon';
    if (z < -236) return 'highlands';
    if (x < -212) return 'forest';
    if (x > 100 && z > 205) return 'downs';
    if (z > 140) return 'meadow';
    if (Math.abs(z - T.riverZ(x)) < 20) return 'gorge';
    if (z < -135) return 'vale';
    if (x < -80) return 'west';
    if (x > 90) return 'hills';
    return 'plain';
  };

  G.terrain = T;
})(window.G);

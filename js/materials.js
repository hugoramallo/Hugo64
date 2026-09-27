// materials.js — cached PBR materials and procedurally painted textures with generated normal maps
// (wood planks, crates, cobblestone, brick, riveted metal). Everything is generated at load time.
(function (G) {
  'use strict';
  const cache = {};

  // PBR material factory. opts: emissive, emissiveIntensity, transparent, opacity, side,
  // roughness, metalness, clearcoat (-> physical)
  G.mat = function (hex, opts) {
    const key = hex + (opts ? JSON.stringify(opts) : '');
    if (cache[key]) return cache[key];
    const o = Object.assign({ roughness: 0.72, metalness: 0 }, opts || {});
    let m;
    if (o.clearcoat || o.iridescence || o.transmission) m = new THREE.MeshPhysicalMaterial(Object.assign({ color: hex }, o));
    else m = new THREE.MeshStandardMaterial(Object.assign({ color: hex }, o));
    if (o.emissive != null && o.emissiveIntensity == null) m.emissiveIntensity = 1;
    cache[key] = m;
    return m;
  };

  const rnd = G.U.rng(7);

  // paint a greyscale height field and colour into canvases (at twice the logical resolution for crisp
  // detail), derive a tangent-space normal map
  function makeTex(size, paint, strength) {
    const R = size * 2;
    const cc = document.createElement('canvas'), hc = document.createElement('canvas');
    cc.width = cc.height = hc.width = hc.height = R;
    const cx = cc.getContext('2d'), hx = hc.getContext('2d');
    cx.scale(2, 2); hx.scale(2, 2);
    hx.fillStyle = '#808080'; hx.fillRect(0, 0, size, size);
    paint(cx, hx, size);
    const hd = hx.getImageData(0, 0, R, R).data;
    const nc = document.createElement('canvas'); nc.width = nc.height = R;
    const nx = nc.getContext('2d'), nd = nx.createImageData(R, R);
    const hAt = (x, y) => hd[(((y + R) % R) * R + ((x + R) % R)) * 4] / 255;
    const k = (strength || 2.5) * 1.6;
    for (let y = 0; y < R; y++) for (let x = 0; x < R; x++) {
      const dx = (hAt(x + 1, y) - hAt(x - 1, y)) * k, dy = (hAt(x, y + 1) - hAt(x, y - 1)) * k;
      const l = Math.hypot(dx, dy, 1), i = (y * R + x) * 4;
      nd.data[i] = (-dx / l * 0.5 + 0.5) * 255; nd.data[i + 1] = (dy / l * 0.5 + 0.5) * 255; nd.data[i + 2] = (1 / l * 0.5 + 0.5) * 255; nd.data[i + 3] = 255;
    }
    nx.putImageData(nd, 0, 0);
    const map = new THREE.CanvasTexture(cc);
    map.colorSpace = THREE.SRGBColorSpace;
    const normalMap = new THREE.CanvasTexture(nc);
    [map, normalMap].forEach((t) => { t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = 16; });
    return { map, normalMap };
  }
  function noiseSpeckle(ctx, size, n, alpha, light) {
    for (let i = 0; i < n; i++) {
      const v = light ? 255 : 0;
      ctx.fillStyle = `rgba(${v},${v},${v},${alpha * rnd()})`;
      ctx.fillRect(rnd() * size, rnd() * size, 1 + rnd() * 2, 1 + rnd() * 2);
    }
  }

  const T = (G.tex = {});
  T.wood = makeTex(256, (c, h, s) => {
    const rows = 4, rh = s / rows;
    for (let r = 0; r < rows; r++) {
      const base = [[184, 124, 66], [168, 110, 56], [196, 136, 74], [176, 116, 60]][r];
      c.fillStyle = `rgb(${base})`; c.fillRect(0, r * rh, s, rh);
      // grain
      for (let g = 0; g < 26; g++) {
        const y = r * rh + rnd() * rh, amp = 1 + rnd() * 3;
        c.strokeStyle = `rgba(90,52,20,${0.12 + rnd() * 0.18})`; c.lineWidth = 1 + rnd();
        c.beginPath();
        for (let x = 0; x <= s; x += 8) c.lineTo(x, y + Math.sin(x * 0.03 + g) * amp);
        c.stroke();
      }
      // knots
      for (let kk = 0; kk < 2; kk++) {
        const kx = rnd() * s, ky = r * rh + rh * (0.3 + rnd() * 0.4);
        c.fillStyle = 'rgba(80,45,18,0.5)'; c.beginPath(); c.ellipse(kx, ky, 6, 3.5, 0, 0, 7); c.fill();
        h.fillStyle = 'rgba(40,40,40,0.6)'; h.beginPath(); h.ellipse(kx, ky, 6, 3.5, 0, 0, 7); h.fill();
      }
      // plank seams (grooves) and nails
      c.fillStyle = 'rgba(60,34,14,0.9)'; c.fillRect(0, r * rh + rh - 3, s, 3);
      h.fillStyle = '#202020'; h.fillRect(0, r * rh + rh - 3, s, 3);
      h.fillStyle = '#9a9a9a'; h.fillRect(0, r * rh, s, 2);
      const seam = (r * 97) % s;
      c.fillStyle = 'rgba(60,34,14,0.9)'; c.fillRect(seam, r * rh, 3, rh);
      h.fillStyle = '#202020'; h.fillRect(seam, r * rh, 3, rh);
      [[seam + 8, r * rh + 8], [seam + 8, r * rh + rh - 12], [seam - 10, r * rh + 8], [seam - 10, r * rh + rh - 12]].forEach(([x, y]) => {
        c.fillStyle = '#3a3a40'; c.beginPath(); c.arc(x, y, 2.4, 0, 7); c.fill();
        h.fillStyle = '#d0d0d0'; h.beginPath(); h.arc(x, y, 2.4, 0, 7); h.fill();
      });
    }
    noiseSpeckle(c, s, 900, 0.15, false);
  }, 3);

  T.crate = makeTex(256, (c, h, s) => {
    c.fillStyle = '#c38743'; c.fillRect(0, 0, s, s);
    for (let g = 0; g < 50; g++) {
      const y = rnd() * s; c.strokeStyle = `rgba(110,64,26,${0.15 + rnd() * 0.2})`; c.beginPath();
      for (let x = 0; x <= s; x += 8) c.lineTo(x, y + Math.sin(x * 0.04 + g) * 2); c.stroke();
    }
    const b = 26;
    c.fillStyle = '#8a5526'; c.fillRect(0, 0, s, b); c.fillRect(0, s - b, s, b); c.fillRect(0, 0, b, s); c.fillRect(s - b, 0, b, s);
    h.fillStyle = '#c8c8c8'; h.fillRect(0, 0, s, b); h.fillRect(0, s - b, s, b); h.fillRect(0, 0, b, s); h.fillRect(s - b, 0, b, s);
    c.save(); c.translate(s / 2, s / 2); c.rotate(Math.PI / 4);
    c.fillStyle = '#8a5526'; c.fillRect(-s * 0.72, -b / 2, s * 1.44, b);
    h.save(); h.translate(s / 2, s / 2); h.rotate(Math.PI / 4); h.fillStyle = '#c8c8c8'; h.fillRect(-s * 0.72, -b / 2, s * 1.44, b); h.restore();
    c.restore();
    c.strokeStyle = 'rgba(50,28,10,0.8)'; c.lineWidth = 3; c.strokeRect(b, b, s - 2 * b, s - 2 * b);
    [[13, 13], [s - 13, 13], [13, s - 13], [s - 13, s - 13]].forEach(([x, y]) => {
      c.fillStyle = '#44444c'; c.beginPath(); c.arc(x, y, 4, 0, 7); c.fill();
      h.fillStyle = '#ffffff'; h.beginPath(); h.arc(x, y, 4, 0, 7); h.fill();
    });
    noiseSpeckle(c, s, 700, 0.2, false);
  }, 3);

  T.stone = makeTex(256, (c, h, s) => {
    c.fillStyle = '#6d665f'; c.fillRect(0, 0, s, s);
    h.fillStyle = '#303030'; h.fillRect(0, 0, s, s);
    const rows = 5, rh = s / rows;
    for (let r = 0; r < rows; r++) {
      let x = (r % 2) * -24;
      while (x < s) {
        const w = 36 + rnd() * 34;
        const v = 120 + Math.floor(rnd() * 50), tint = Math.floor(rnd() * 12);
        const pad = 3;
        const rect = [x + pad, r * rh + pad, w - pad * 2, rh - pad * 2];
        [0, s].forEach((ox) => {
          c.fillStyle = `rgb(${v + tint},${v},${v - 8})`;
          roundRect(c, rect[0] + ox - (x + w > s ? s : 0), rect[1], rect[2], rect[3], 6);
          const g = h.createLinearGradient(0, rect[1], 0, rect[1] + rect[3]);
          g.addColorStop(0, '#d8d8d8'); g.addColorStop(0.5, '#f0f0f0'); g.addColorStop(1, '#b0b0b0');
          h.fillStyle = g; roundRect(h, rect[0] + ox - (x + w > s ? s : 0), rect[1], rect[2], rect[3], 6);
        });
        x += w;
      }
    }
    noiseSpeckle(c, s, 2400, 0.22, rnd() > 0.5);
    noiseSpeckle(h, s, 1600, 0.3, false);
  }, 4);

  T.brick = makeTex(256, (c, h, s) => {
    c.fillStyle = '#8a7b6a'; c.fillRect(0, 0, s, s);
    h.fillStyle = '#404040'; h.fillRect(0, 0, s, s);
    const rows = 8, rh = s / rows, bw = s / 4;
    for (let r = 0; r < rows; r++) for (let i = -1; i < 5; i++) {
      const x = i * bw + (r % 2 ? bw / 2 : 0), v = Math.floor(rnd() * 26);
      c.fillStyle = `rgb(${176 + v},${150 + v},${118 + v})`;
      roundRect(c, x + 2, r * rh + 2, bw - 4, rh - 4, 3);
      h.fillStyle = '#e8e8e8'; roundRect(h, x + 2, r * rh + 2, bw - 4, rh - 4, 3);
    }
    noiseSpeckle(c, s, 2000, 0.2, false);
    noiseSpeckle(h, s, 1200, 0.25, false);
  }, 3.5);

  T.metal = makeTex(128, (c, h, s) => {
    const g = c.createLinearGradient(0, 0, s, s);
    g.addColorStop(0, '#6f7a88'); g.addColorStop(1, '#4d5663');
    c.fillStyle = g; c.fillRect(0, 0, s, s);
    for (let i = 0; i < 160; i++) { c.fillStyle = `rgba(255,255,255,${rnd() * 0.05})`; c.fillRect(0, rnd() * s, s, 1); }
    c.strokeStyle = '#2d333c'; c.lineWidth = 3; c.strokeRect(2, 2, s - 4, s - 4);
    h.strokeStyle = '#303030'; h.lineWidth = 3; h.strokeRect(2, 2, s - 4, s - 4);
    [[12, 12], [s - 12, 12], [12, s - 12], [s - 12, s - 12]].forEach(([x, y]) => {
      c.fillStyle = '#aab4c0'; c.beginPath(); c.arc(x, y, 4, 0, 7); c.fill();
      const rg = h.createRadialGradient(x, y, 0, x, y, 5); rg.addColorStop(0, '#ffffff'); rg.addColorStop(1, '#808080');
      h.fillStyle = rg; h.beginPath(); h.arc(x, y, 5, 0, 7); h.fill();
    });
  }, 3);


  // large cut sandstone blocks (castle walls)
  T.ashlar = makeTex(256, (c, h, s) => {
    c.fillStyle = '#b9ab8e'; c.fillRect(0, 0, s, s);
    h.fillStyle = '#3a3a3a'; h.fillRect(0, 0, s, s);
    const rows = 4, rh = s / rows;
    for (let r = 0; r < rows; r++) {
      let x = (r % 2) * -40;
      while (x < s) {
        const w = 70 + rnd() * 40, v = Math.floor(rnd() * 26);
        [0, s].forEach((ox) => {
          const X = x + ox - (x + w > s ? s : 0);
          c.fillStyle = `rgb(${226 + v - 20},${214 + v - 20},${184 + v - 22})`;
          roundRect(c, X + 2, r * rh + 2, w - 4, rh - 4, 4);
          const g = h.createLinearGradient(0, r * rh, 0, r * rh + rh);
          g.addColorStop(0, '#e0e0e0'); g.addColorStop(0.15, '#f4f4f4'); g.addColorStop(0.85, '#eaeaea'); g.addColorStop(1, '#bcbcbc');
          h.fillStyle = g; roundRect(h, X + 2, r * rh + 2, w - 4, rh - 4, 4);
        });
        x += w;
      }
    }
    noiseSpeckle(c, s, 2600, 0.12, false);
    noiseSpeckle(c, s, 900, 0.1, true);
    noiseSpeckle(h, s, 1400, 0.2, false);
  }, 3.2);

  // scalloped roof tiles (light grey so the material colour tints them)
  T.roof = makeTex(256, (c, h, s) => {
    c.fillStyle = '#6a6a6a'; c.fillRect(0, 0, s, s);
    h.fillStyle = '#202020'; h.fillRect(0, 0, s, s);
    const rows = 8, rh = s / rows, cols = 8, cw = s / cols;
    for (let r = -1; r <= rows; r++) for (let i = -1; i <= cols; i++) {
      const x = i * cw + (r % 2 ? cw / 2 : 0), y = r * rh, v = 200 + Math.floor(rnd() * 40);
      c.fillStyle = `rgb(${v},${v},${v})`;
      c.beginPath(); c.moveTo(x + 1, y); c.lineTo(x + cw - 1, y); c.lineTo(x + cw - 1, y + rh * 0.9); c.arc(x + cw / 2, y + rh * 0.9, cw / 2 - 1, 0, Math.PI); c.closePath(); c.fill();
      const g = h.createLinearGradient(0, y, 0, y + rh * 1.4);
      g.addColorStop(0, '#606060'); g.addColorStop(1, '#f0f0f0');
      h.fillStyle = g;
      h.beginPath(); h.moveTo(x + 1, y); h.lineTo(x + cw - 1, y); h.lineTo(x + cw - 1, y + rh * 0.9); h.arc(x + cw / 2, y + rh * 0.9, cw / 2 - 1, 0, Math.PI); h.closePath(); h.fill();
    }
    noiseSpeckle(c, s, 1500, 0.12, false);
  }, 3);

  // rough white plaster with a few exposed bricks (village cottages)
  T.plaster = makeTex(256, (c, h, s) => {
    c.fillStyle = '#efe6d2'; c.fillRect(0, 0, s, s);
    for (let i = 0; i < 60; i++) {
      c.fillStyle = `rgba(${150 + rnd() * 60},${130 + rnd() * 50},${100 + rnd() * 40},0.06)`;
      c.beginPath(); c.arc(rnd() * s, rnd() * s, 10 + rnd() * 30, 0, 7); c.fill();
    }
    for (let k = 0; k < 3; k++) {
      const bx = rnd() * s, by = rnd() * s;
      for (let j = 0; j < 3; j++) for (let i = 0; i < 2; i++) {
        c.fillStyle = `rgb(${170 + rnd() * 20},${90 + rnd() * 20},${60})`;
        roundRect(c, bx + i * 22 + (j % 2) * 11, by + j * 10, 20, 8, 2);
        h.fillStyle = '#d0d0d0'; roundRect(h, bx + i * 22 + (j % 2) * 11, by + j * 10, 20, 8, 2);
      }
    }
    noiseSpeckle(c, s, 3000, 0.08, false);
    noiseSpeckle(h, s, 3000, 0.25, rnd() > 0.5);
  }, 2.2);

  // straw thatch
  T.thatch = makeTex(256, (c, h, s) => {
    c.fillStyle = '#b58f4a'; c.fillRect(0, 0, s, s);
    for (let i = 0; i < 2200; i++) {
      const x = rnd() * s, y = rnd() * s, l = 10 + rnd() * 22, v = Math.floor(rnd() * 60);
      c.strokeStyle = `rgba(${170 + v},${130 + v},${60 + v / 2},0.8)`; c.lineWidth = 1 + rnd();
      c.beginPath(); c.moveTo(x, y); c.lineTo(x + (rnd() - 0.5) * 4, y + l); c.stroke();
      h.strokeStyle = `rgba(255,255,255,${0.3 + rnd() * 0.4})`; h.beginPath(); h.moveTo(x, y); h.lineTo(x, y + l); h.stroke();
    }
    for (let r = 0; r < 4; r++) { c.fillStyle = 'rgba(70,45,15,0.35)'; c.fillRect(0, r * (s / 4) + s / 4 - 3, s, 3); h.fillStyle = '#101010'; h.fillRect(0, r * (s / 4) + s / 4 - 3, s, 3); }
  }, 2.5);

  // heavy door: vertical planks, iron bands and studs
  T.door = makeTex(256, (c, h, s) => {
    const n = 5, pw = s / n;
    for (let i = 0; i < n; i++) {
      const v = Math.floor(rnd() * 20);
      c.fillStyle = `rgb(${120 + v},${72 + v},${38 + v / 2})`; c.fillRect(i * pw, 0, pw, s);
      for (let g = 0; g < 16; g++) { c.strokeStyle = `rgba(60,30,10,${0.15 + rnd() * 0.2})`; c.beginPath(); const x = i * pw + rnd() * pw; c.moveTo(x, 0); c.lineTo(x + (rnd() - 0.5) * 6, s); c.stroke(); }
      c.fillStyle = 'rgba(40,20,8,0.9)'; c.fillRect(i * pw, 0, 2, s); h.fillStyle = '#202020'; h.fillRect(i * pw, 0, 2, s);
    }
    [0.18, 0.78].forEach((f) => {
      c.fillStyle = '#34363c'; c.fillRect(0, s * f, s, 16); h.fillStyle = '#e0e0e0'; h.fillRect(0, s * f, s, 16);
      for (let i = 0; i < 8; i++) { c.fillStyle = '#7c808a'; c.beginPath(); c.arc(16 + i * 32, s * f + 8, 4, 0, 7); c.fill(); h.fillStyle = '#ffffff'; h.beginPath(); h.arc(16 + i * 32, s * f + 8, 4, 0, 7); h.fill(); }
    });
    noiseSpeckle(c, s, 800, 0.15, false);
  }, 3);

  // stained-glass rose window with a sun (used as colour + emissive map)
  T.rose = (function () {
    const R = 512, cv = document.createElement('canvas'); cv.width = cv.height = R;
    const c = cv.getContext('2d'), m = R / 2;
    c.fillStyle = '#1b2440'; c.fillRect(0, 0, R, R);
    const cols = ['#ffd23a', '#ff8a3d', '#e8283a', '#3ec8ff', '#46d65a', '#a77bff'];
    for (let i = 0; i < 24; i++) {
      const a0 = (i / 24) * Math.PI * 2, a1 = ((i + 1) / 24) * Math.PI * 2;
      c.fillStyle = cols[i % cols.length];
      c.beginPath(); c.moveTo(m, m); c.arc(m, m, R * 0.47, a0 + 0.02, a1 - 0.02); c.closePath(); c.fill();
    }
    c.fillStyle = '#1b2440'; c.beginPath(); c.arc(m, m, R * 0.3, 0, 7); c.fill();
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2;
      c.fillStyle = '#ffb000';
      c.beginPath(); c.moveTo(m + Math.cos(a - 0.12) * R * 0.14, m + Math.sin(a - 0.12) * R * 0.14); c.lineTo(m + Math.cos(a) * R * 0.28, m + Math.sin(a) * R * 0.28); c.lineTo(m + Math.cos(a + 0.12) * R * 0.14, m + Math.sin(a + 0.12) * R * 0.14); c.fill();
    }
    const g = c.createRadialGradient(m, m, 0, m, m, R * 0.15); g.addColorStop(0, '#fff6c0'); g.addColorStop(1, '#ffc21a');
    c.fillStyle = g; c.beginPath(); c.arc(m, m, R * 0.14, 0, 7); c.fill();
    c.strokeStyle = '#2a2a30'; c.lineWidth = 6;
    c.beginPath(); c.arc(m, m, R * 0.47, 0, 7); c.stroke(); c.beginPath(); c.arc(m, m, R * 0.3, 0, 7); c.stroke();
    const t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 16;
    return t;
  })();

  function roundRect(ctx, x, y, w, hh, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y); ctx.lineTo(x + w - r, y); ctx.quadraticCurveTo(x + w, y, x + w, y + r);
    ctx.lineTo(x + w, y + hh - r); ctx.quadraticCurveTo(x + w, y + hh, x + w - r, y + hh);
    ctx.lineTo(x + r, y + hh); ctx.quadraticCurveTo(x, y + hh, x, y + hh - r);
    ctx.lineTo(x, y + r); ctx.quadraticCurveTo(x, y, x + r, y); ctx.fill();
  }

  const SURF = {
    wood: { roughness: 0.78, metalness: 0 }, crate: { roughness: 0.8, metalness: 0 },
    stone: { roughness: 0.9, metalness: 0 }, brick: { roughness: 0.88, metalness: 0 },
    ashlar: { roughness: 0.86, metalness: 0 }, roof: { roughness: 0.55, metalness: 0 }, plaster: { roughness: 0.95, metalness: 0 },
    thatch: { roughness: 1, metalness: 0 }, door: { roughness: 0.8, metalness: 0 },
    metal: { roughness: 0.38, metalness: 0.75 },
  };
  G.texMat = function (name, repX, repY, color) {
    const key = 'tex:' + name + ':' + repX + ':' + repY + ':' + (color || '');
    if (!cache[key]) {
      const src = G.tex[name];
      const map = src.map.clone(), normalMap = src.normalMap.clone();
      [map, normalMap].forEach((t) => { t.repeat.set(repX || 1, repY || 1); t.needsUpdate = true; });
      cache[key] = new THREE.MeshStandardMaterial(Object.assign({ map, normalMap, color: color || 0xffffff }, SURF[name]));
    }
    return cache[key];
  };

  // bevelled box geometry (rounded edges catch the light); cached per size
  const boxCache = new Map();
  G.bevelBox = function (w, h, d, radius) {
    const r = Math.min(radius == null ? 0.14 : radius, Math.min(w, h, d) * 0.24);
    const key = [w, h, d, r].map((v) => v.toFixed(3)).join(',');
    if (!boxCache.has(key)) boxCache.set(key, r > 0.01 ? new window.ADDONS.RoundedBoxGeometry(w, h, d, 3, r) : new THREE.BoxGeometry(w, h, d));
    return boxCache.get(key);
  };

  // solid static box: centre position, full size (merged into sector batches after the level is built)
  G.solidBox = function (scene, x, y, z, w, h, d, material, yaw, opts) {
    const m = new THREE.Mesh(G.bevelBox(w, h, d), material);
    m.position.set(x, y, z); m.rotation.y = yaw || 0;
    m.castShadow = true; m.receiveShadow = true;
    m.userData.static = !(opts && opts.dynamic);
    scene.add(m);
    const b = G.physics.addBox(Object.assign({ x, y, z, hx: w / 2, hy: h / 2, hz: d / 2, yaw: yaw || 0, mesh: m }, opts || {}));
    return b;
  };
})(window.G);

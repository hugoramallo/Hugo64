// fx.js — lightweight particles, shockwave rings, blob shadows and floating text.
(function (G) {
  'use strict';
  const FX = { parts: [], rings: [], scene: null };
  const pGeo = new THREE.IcosahedronGeometry(0.62, 2);
  const pool = [];

  FX.init = function (scene) {
    FX.scene = scene;
    FX.shadowGeo = new THREE.CircleGeometry(1, 32).rotateX(-Math.PI / 2);
    FX.shadowMat = new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.2, depthWrite: false });
  };

  // burst of cubes: dust, sparks, debris
  FX.burst = function (x, y, z, n, color, speed, size, life, grav) {
    for (let i = 0; i < n; i++) {
      let m = pool.pop();
      if (!m) { m = new THREE.Mesh(pGeo, new THREE.MeshStandardMaterial({ color, roughness: 0.8 })); m.castShadow = false; }
      m.material.color.setHex(color);
      m.visible = true;
      const s = size * (0.6 + Math.random() * 0.7);
      m.scale.set(s, s, s);
      m.position.set(x + (Math.random() - 0.5) * 0.6, y + Math.random() * 0.4, z + (Math.random() - 0.5) * 0.6);
      const a = Math.random() * Math.PI * 2, sp = speed * (0.4 + Math.random() * 0.8);
      FX.scene.add(m);
      FX.parts.push({ m, vx: Math.cos(a) * sp, vy: speed * (0.3 + Math.random()), vz: Math.sin(a) * sp, life: life * (0.6 + Math.random() * 0.6), max: life, s, g: grav == null ? -20 : grav, spin: (Math.random() - 0.5) * 10 });
    }
  };
  FX.dust = (x, y, z, n) => FX.burst(x, y + 0.1, z, n || 6, 0xf2e6c8, 3, 0.25, 0.45, 2);

  // sparkles: small glowing four-point stars (emissive, so the bloom makes them shine) that spin and shrink
  const starGeo = (() => {
    const sh = new THREE.Shape(), n = 4;
    for (let i = 0; i < n * 2; i++) {
      const a = (i / (n * 2)) * Math.PI * 2, r = i % 2 ? 0.3 : 1;
      if (i) sh.lineTo(Math.cos(a) * r, Math.sin(a) * r); else sh.moveTo(Math.cos(a) * r, Math.sin(a) * r);
    }
    const g = new THREE.ExtrudeGeometry(sh, { depth: 0.1, bevelEnabled: true, bevelThickness: 0.08, bevelSize: 0.08, bevelSegments: 1 });
    g.center();
    return g;
  })();
  const sparkPool = [];
  FX.sparkle = function (x, y, z, color) {
    const c = color || 0xfff27a;
    for (let i = 0; i < 12; i++) {
      let m = sparkPool.pop();
      if (!m) {
        m = new THREE.Mesh(starGeo, new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.35, emissive: 0xffffff, emissiveIntensity: 2.4 }));
        m.castShadow = false; m.userData.noShadow = true;
      }
      m.material.color.setHex(c); m.material.emissive.setHex(c);
      m.visible = true;
      const s = 0.11 * (0.6 + Math.random() * 0.8);
      m.scale.setScalar(s);
      m.position.set(x + (Math.random() - 0.5) * 0.5, y + Math.random() * 0.5, z + (Math.random() - 0.5) * 0.5);
      m.rotation.set(Math.random() * 6, Math.random() * 6, 0);
      const a = Math.random() * Math.PI * 2, sp = 4.5 * (0.4 + Math.random() * 0.8);
      FX.scene.add(m);
      FX.parts.push({ m, vx: Math.cos(a) * sp, vy: 3 + Math.random() * 4, vz: Math.sin(a) * sp, life: 0.55 * (0.6 + Math.random() * 0.6), max: 0.55, s, g: -6, spin: (Math.random() - 0.5) * 14, pool: sparkPool });
    }
  };

  // expanding ring on the ground or water (shockwaves, ground pounds, ripples); geometry shared, materials pooled
  const ringGeo = new THREE.RingGeometry(0.85, 1, 96).rotateX(-Math.PI / 2);
  const ringPool = [];
  FX.ring = function (x, y, z, maxR, dur, color) {
    let m = ringPool.pop();
    if (!m) {
      m = new THREE.Mesh(ringGeo, new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.8, side: THREE.DoubleSide, depthWrite: false }));
      m.userData.noShadow = true;
    }
    m.material.color.setHex(color || 0xffffff);
    m.material.opacity = 0.8;
    m.position.set(x, y + 0.15, z);
    m.scale.setScalar(0.5);
    FX.scene.add(m);
    FX.rings.push({ m, t: 0, dur, maxR });
  };

  FX.makeShadow = function (r) {
    const m = new THREE.Mesh(FX.shadowGeo, FX.shadowMat);
    m.scale.setScalar(r);
    m.renderOrder = 1;
    FX.scene.add(m);
    return m;
  };
  // place blob shadow on the ground below (x,y,z)
  FX.placeShadow = function (m, x, y, z, r) {
    const g = G.physics.ground(x, z, y + 0.1, 0.1, 0);
    const d = Math.max(0, y - g.h);
    m.position.set(x, g.h + 0.06, z);
    const k = Math.max(0.35, 1 - d / 25);
    m.scale.setScalar(r * k);
    m.visible = d < 60;
  };

  FX.update = function (dt) {
    for (let i = FX.parts.length - 1; i >= 0; i--) {
      const p = FX.parts[i];
      p.life -= dt;
      if (p.life <= 0) { p.m.visible = false; FX.scene.remove(p.m); (p.pool || pool).push(p.m); FX.parts.splice(i, 1); continue; }
      p.vy += p.g * dt;
      p.m.position.x += p.vx * dt; p.m.position.y += p.vy * dt; p.m.position.z += p.vz * dt;
      p.m.rotation.x += p.spin * dt; p.m.rotation.y += p.spin * dt;
      const k = Math.min(1, p.life / (p.max * 0.5));
      p.m.scale.setScalar(p.s * k);
    }
    for (let i = FX.rings.length - 1; i >= 0; i--) {
      const r = FX.rings[i];
      r.t += dt;
      const f = r.t / r.dur;
      if (f >= 1) { FX.scene.remove(r.m); ringPool.push(r.m); FX.rings.splice(i, 1); continue; }
      r.m.scale.setScalar(0.5 + r.maxR * f);
      r.m.material.opacity = 0.8 * (1 - f);
    }
  };

  G.fx = FX;
})(window.G);

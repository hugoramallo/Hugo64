// player_model.js — "Pip", the original explorer hero: a sculpted, high-detail model on an articulated
// skeleton (hips, spine, chest, neck, head, shoulders, elbows, wrists, hips, knees, ankles) with fully
// procedural animation: jog / run cycles with banking and acceleration lean, foot placement on slopes and
// steps, spring-driven secondary motion (feather, scarf, backpack, hat), head and eye look-at, blinking and
// facial expressions, jumps and flips with squash & stretch, carrying, throwing, climbing, swimming...
// Every part carries a material class (cloth, skin, hair, leather, metal, eye) that the shared character
// shader turns into fabric weave, skin translucency, hair sheen and leather grain. Rigid parts are baked
// per joint by gfx.bake.
(function (G) {
  'use strict';
  const U = G.U, TAU = U.TAU;
  const CLS = { cloth: 1, skin: 2, hair: 3, leather: 4, metal: 5, eye: 6 };

  function mat(c, r, cls, extra) {
    const m = new THREE.MeshStandardMaterial(Object.assign({ color: c, roughness: r == null ? 0.62 : r, metalness: 0 }, extra || {}));
    m.userData.cls = CLS[cls] || 0;
    return m;
  }
  const V2 = (x, y) => new THREE.Vector2(x, y);
  const V3 = (x, y, z) => new THREE.Vector3(x, y, z);
  function mesh(geo, m, parent, x, y, z) {
    const o = new THREE.Mesh(geo, m);
    o.position.set(x || 0, y || 0, z || 0);
    if (parent) parent.add(o);
    return o;
  }
  function group(parent, x, y, z) { const g = new THREE.Group(); g.position.set(x || 0, y || 0, z || 0); parent.add(g); return g; }
  // smooth lathe from [radius, height] pairs (Catmull-Rom resampled for a sculpted silhouette). The profile
  // must run from bottom to top: that winding makes the faces (and normals) point outward
  function lathe(pts, segs, samples) {
    const curve = new THREE.SplineCurve(pts.map(([r, y]) => V2(r, y)));
    const g = new THREE.LatheGeometry(curve.getPoints(samples || 24).map((p) => V2(Math.max(0.0005, p.x), p.y)), segs || 64);
    g.computeVertexNormals();
    return g;
  }
  // tube along a 3D polyline (brows, straps, seams, feather shaft)
  function tube(points, r, tubular, radial) {
    const c = new THREE.CatmullRomCurve3(points.map(([x, y, z]) => V3(x, y, z)));
    return new THREE.TubeGeometry(c, tubular || 24, r, radial || 10, false);
  }
  function deform(g, fn) {
    const p = g.attributes.position, v = new THREE.Vector3();
    for (let i = 0; i < p.count; i++) { v.set(p.getX(i), p.getY(i), p.getZ(i)); fn(v); p.setXYZ(i, v.x, v.y, v.z); }
    g.computeVertexNormals();
    return g;
  }
  // orient a mesh so its local +Y runs along `dir` and its local +Z faces `out` (for tufts lying on a surface)
  const _m4 = new THREE.Matrix4();
  function orient(o, dir, out) {
    const y = dir.clone().normalize(), x = new THREE.Vector3().crossVectors(y, out).normalize(), z = new THREE.Vector3().crossVectors(x, y);
    _m4.makeBasis(x, y, z);
    o.quaternion.setFromRotationMatrix(_m4);
    return o;
  }
  // a soft, slightly curved tuft of hair (flattened, bent cone)
  function tuftGeo(r, h, bend, flat) {
    const g = new THREE.ConeGeometry(r, h, 12, 6);
    g.translate(0, h / 2, 0);
    return deform(g, (v) => { const f = v.y / h; v.z = v.z * (flat || 0.5) + bend * f * f * h; });
  }

  G.buildPlayerModel = function () {
    const M = {};
    const root = (M.root = new THREE.Group());
    const pivot = (M.pivot = group(root, 0, 0.85, 0));   // whole-body rotation (flips, dives, swimming, banking)
    const body = (M.body = group(pivot, 0, -0.85, 0));    // body space: feet at y = 0
    body.scale.setScalar(0.9);

    const C = {
      jacket: mat(0xf0741a, 0.82, 'cloth'), jacketDark: mat(0xae4a12, 0.84, 'cloth'), lining: mat(0x8a3a10, 0.85, 'cloth'),
      skin: mat(0xf6c29a, 0.52, 'skin'), blush: mat(0xf2897e, 0.55, 'skin'), lip: mat(0x7a2418, 0.5, 'skin'), tongue: mat(0xef6a62, 0.45, 'skin'),
      hat: mat(0x129289, 0.88, 'cloth'), hatDark: mat(0x0c6a63, 0.9, 'cloth'), band: mat(0x4a2a14, 0.55, 'leather'),
      pants: mat(0x2e4497, 0.86, 'cloth'), pantsDark: mat(0x22346f, 0.88, 'cloth'),
      boot: mat(0x7d4a26, 0.42, 'leather'), bootDark: mat(0x5a3218, 0.5, 'leather'), sole: mat(0x2e1c10, 0.8, 'leather'), lace: mat(0xeadbb4, 0.8, 'cloth'),
      glove: mat(0xfbfaf6, 0.62, 'cloth'), scarf: mat(0xe0283a, 0.86, 'cloth'), scarfDark: mat(0xa81c2c, 0.88, 'cloth'), feather: mat(0xff5a40, 0.7, 'cloth'),
      hair: mat(0x5c3218, 0.55, 'hair'), brow: mat(0x4a2812, 0.7, 'hair'),
      white: mat(0xfdfdfb, 0.06, 'eye'), iris: mat(0x1e7a4c, 0.08, 'eye'), irisLight: mat(0x5cc58c, 0.08, 'eye'), black: mat(0x080808, 0.05, 'eye'),
      lash: mat(0x24130a, 0.7, 'hair'),
      gold: mat(0xffcf3a, 0.28, 'metal', { metalness: 0.85 }), pack: mat(0xb88a52, 0.86, 'cloth'), packDark: mat(0x8e6436, 0.88, 'cloth'),
      strap: mat(0x6a4020, 0.55, 'leather'), roll: mat(0x4f8a3c, 0.9, 'cloth'),
      glint: mat(0xffffff, 0.2, 'eye', { emissive: 0xffffff, emissiveIntensity: 0.9 }),
    };
    M.C = C;

    // ---------------- pelvis & legs ----------------
    const hips = (M.hips = group(body, 0, 0.74, 0));
    mesh(lathe([[0.001, -0.2], [0.22, -0.19], [0.305, -0.1], [0.325, 0.03], [0.31, 0.12], [0.001, 0.14]], 56), C.pants, hips).scale.set(1, 1, 0.82);
    M.legs = [-1, 1].map((s) => {
      const hip = group(hips, 0.16 * s, -0.05, 0);
      mesh(new THREE.CapsuleGeometry(0.108, 0.18, 12, 28), C.pants, hip, 0, -0.15, 0);
      // seam down the outside of the leg
      mesh(tube([[0.105 * s, -0.02, 0], [0.11 * s, -0.16, 0.005], [0.1 * s, -0.28, 0]], 0.006, 12, 5), C.pantsDark, hip);
      const knee = group(hip, 0, -0.31, 0);
      mesh(new THREE.SphereGeometry(0.1, 26, 18), C.pants, knee);
      mesh(new THREE.CapsuleGeometry(0.093, 0.15, 12, 28), C.pants, knee, 0, -0.12, 0);
      const ankle = group(knee, 0, -0.29, 0);
      // boot: rounded foot with a raised toe, a snug shaft with a turned-down cuff, laces, and a sole that
      // follows the boot's own footprint
      const bootG = deform(new THREE.SphereGeometry(0.155, 44, 30), (v) => {
        const f = v.z > 0 ? 1 + v.z * 1.5 : 1;
        v.x *= 0.84; v.z *= 1.3 * f; v.y *= v.y < 0 ? 0.55 : 0.66;
        if (v.z > 0.12) v.y += (v.z - 0.12) * 0.12;          // toe spring
      });
      mesh(bootG, C.boot, ankle, 0, -0.005, 0.07);
      const soleG = deform(new THREE.SphereGeometry(0.158, 36, 12, 0, TAU, Math.PI * 0.55, Math.PI * 0.45), (v) => {
        const f = v.z > 0 ? 1 + v.z * 1.5 : 1;
        v.x *= 0.86; v.z *= 1.32 * f; v.y = Math.max(v.y * 0.5, -0.07);
        if (v.z > 0.12) v.y += (v.z - 0.12) * 0.12;
      });
      mesh(soleG, C.sole, ankle, 0, -0.012, 0.07);
      mesh(new THREE.CylinderGeometry(0.097, 0.113, 0.17, 30), C.boot, ankle, 0, 0.08, -0.005);
      mesh(new THREE.TorusGeometry(0.108, 0.034, 12, 36).rotateX(Math.PI / 2), C.bootDark, ankle, 0, 0.16, -0.005);
      for (let i = 0; i < 3; i++) {
        const lz = 0.1 + i * 0.045, ly = 0.055 - i * 0.03;
        [-1, 1].forEach((d) => { const l = mesh(new THREE.CapsuleGeometry(0.009, 0.075, 4, 8).rotateZ(Math.PI / 2 + d * 0.45), C.lace, ankle, 0, ly, lz); l.rotation.x = -0.5; });
      }
      mesh(new THREE.SphereGeometry(0.02, 10, 8), C.lace, ankle, 0.03 * s, 0.1, 0.1);   // bow knot
      hip.side = s; hip.knee = knee; hip.ankle = ankle;
      return hip;
    });

    // ---------------- spine, torso, backpack, scarf ----------------
    const spine = (M.spine = group(hips, 0, 0.08, 0));
    const chest = (M.chest = group(spine, 0, 0, 0));
    // jacket: flared hem, nipped waist, full chest, sloping shoulders
    const jacketG = lathe([[0.001, -0.22], [0.355, -0.21], [0.372, -0.15], [0.325, -0.02], [0.338, 0.12], [0.36, 0.24], [0.335, 0.36], [0.24, 0.45], [0.13, 0.5], [0.001, 0.505]], 72, 36);
    mesh(jacketG, C.jacket, chest).scale.set(1, 1, 0.82);
    mesh(new THREE.TorusGeometry(0.364, 0.024, 10, 64).rotateX(Math.PI / 2).scale(1, 1, 0.82), C.jacketDark, chest, 0, -0.205, 0);
    // stand-up collar
    mesh(lathe([[0.128, 0.43], [0.19, 0.455], [0.215, 0.5], [0.2, 0.555]], 56, 10).scale(1, 1, 0.9), C.jacketDark, chest);
    // placket seam and buttons along the front curve
    const frontZ = (y) => { const r = y > 0.24 ? 0.36 - (y - 0.24) * 1.05 : y > -0.02 ? 0.325 + (y + 0.02) * 0.135 : 0.325 + (-0.02 - y) * 0.25; return r * 0.82; };
    mesh(tube([[0, 0.42, frontZ(0.42) + 0.004], [0, 0.3, frontZ(0.3) + 0.006], [0, 0.12, frontZ(0.12) + 0.006], [0, -0.03, frontZ(-0.03) + 0.006], [0, -0.19, frontZ(-0.19) + 0.006]], 0.009, 24, 6), C.jacketDark, chest);
    [0.31, 0.19, 0.07].forEach((y) => mesh(new THREE.SphereGeometry(0.027, 16, 12).scale(1, 1, 0.6), C.gold, chest, 0.035, y, frontZ(y) + 0.012));
    // pockets with flaps
    [-1, 1].forEach((s) => {
      const pk = group(chest, 0.17 * s, -0.12, frontZ(-0.12) - 0.015);
      pk.rotation.y = 0.5 * s;
      mesh(new window.ADDONS.RoundedBoxGeometry(0.15, 0.1, 0.03, 3, 0.012), C.jacket, pk, 0, 0, 0.012);
      mesh(new window.ADDONS.RoundedBoxGeometry(0.16, 0.045, 0.04, 3, 0.015), C.jacketDark, pk, 0, 0.045, 0.02);
      mesh(new THREE.SphereGeometry(0.012, 10, 8), C.gold, pk, 0, 0.035, 0.042);
    });
    // belt and buckle
    mesh(new THREE.CylinderGeometry(0.33, 0.335, 0.075, 64, 1, true).scale(1, 1, 0.82), C.strap, chest, 0, -0.035, 0);
    const buckle = group(chest, 0, -0.035, 0.335 * 0.82 + 0.008);
    mesh(new THREE.TorusGeometry(0.036, 0.011, 8, 4).rotateZ(Math.PI / 4).scale(1.3, 1, 1), C.gold, buckle);
    mesh(new THREE.CylinderGeometry(0.006, 0.006, 0.06, 6).rotateZ(Math.PI / 2), C.gold, buckle, 0, 0, 0.004);
    // backpack: body, front pocket, flap with buckle strap, bedroll with straps
    const pack = group(chest, 0, 0.2, -0.285);
    mesh(new window.ADDONS.RoundedBoxGeometry(0.42, 0.42, 0.19, 5, 0.075), C.pack, pack);
    mesh(new window.ADDONS.RoundedBoxGeometry(0.32, 0.16, 0.07, 4, 0.03), C.packDark, pack, 0, -0.09, -0.115);
    mesh(new window.ADDONS.RoundedBoxGeometry(0.4, 0.12, 0.2, 4, 0.045), C.packDark, pack, 0, 0.17, -0.01);
    mesh(new window.ADDONS.RoundedBoxGeometry(0.05, 0.2, 0.012, 2, 0.005), C.strap, pack, 0, 0.1, -0.113);
    mesh(new window.ADDONS.RoundedBoxGeometry(0.06, 0.05, 0.02, 2, 0.006), C.gold, pack, 0, 0.02, -0.12);
    mesh(new THREE.CylinderGeometry(0.072, 0.072, 0.48, 28, 1).rotateZ(Math.PI / 2), C.roll, pack, 0, -0.27, -0.01);
    [-0.16, 0.16].forEach((x) => mesh(new THREE.TorusGeometry(0.075, 0.011, 6, 24).rotateY(Math.PI / 2), C.strap, pack, x, -0.27, -0.01));
    [-1, 1].forEach((s) => mesh(tube([[0.15 * s, 0.43, -0.13], [0.19 * s, 0.47, 0.06], [0.215 * s, 0.35, 0.27], [0.2 * s, 0.14, 0.295]], 0.02, 20, 8), C.strap, chest));
    M.pack = pack;
    // scarf: a wrapped loop with a knot and two tails that flap
    const neckRing = mesh(new THREE.TorusGeometry(0.175, 0.062, 18, 56).rotateX(Math.PI / 2 - 0.12), C.scarf, chest, 0, 0.5, 0.015);
    neckRing.scale.set(1, 1, 0.94);
    mesh(new THREE.TorusGeometry(0.165, 0.02, 8, 48).rotateX(Math.PI / 2 - 0.12).scale(1, 1, 0.94), C.scarfDark, chest, 0, 0.535, 0.012);
    mesh(new THREE.SphereGeometry(0.066, 18, 14).scale(1, 0.85, 0.8), C.scarf, chest, 0.085, 0.47, 0.205);
    M.scarfTails = [0, 1].map((k) => {
      let parent = group(chest, 0.08 + k * 0.05, 0.455, 0.235 - k * 0.012);
      const segs = [];
      for (let i = 0; i < 3; i++) {
        const seg = group(parent, 0, i ? -0.11 : 0, 0);
        mesh(new window.ADDONS.RoundedBoxGeometry(0.105 - i * 0.012, 0.125, 0.032, 2, 0.012), C.scarf, seg, 0, -0.055, 0);
        segs.push(seg); parent = seg;
      }
      return segs;
    });

    // ---------------- neck, head, face, hair, hat ----------------
    const neck = (M.neck = group(chest, 0, 0.5, 0));
    mesh(new THREE.CylinderGeometry(0.092, 0.105, 0.16, 24), C.skin, neck, 0, 0.05, 0);
    const head = (M.head = group(neck, 0, 0.29, 0.02));
    // skull: slightly fuller cheeks, a softer, narrower chin
    const skullG = deform(new THREE.SphereGeometry(0.37, 72, 54), (v) => {
      const y = v.y;
      const cheek = y < 0.05 && y > -0.3 ? Math.sin((0.05 - y) / 0.35 * Math.PI) * 0.035 : 0;
      const chin = y < -0.18 ? 1 - Math.min(1, (-0.18 - y) / 0.19) * 0.14 : 1;
      const k = (1 + cheek / 0.37) * chin;
      v.x *= 1.02 * k; v.y *= 0.965; v.z *= (v.z > 0 ? 1.03 : 0.98) * (y < -0.18 ? 1 - Math.min(1, (-0.18 - y) / 0.19) * 0.06 : 1);
    });
    mesh(skullG, C.skin, head);
    mesh(new THREE.SphereGeometry(0.05, 28, 20).scale(1.12, 0.92, 1.0), C.skin, head, 0, -0.04, 0.37);
    // ears with a soft inner fold
    [-1, 1].forEach((s) => {
      const ear = group(head, 0.37 * s, -0.03, -0.01);
      ear.rotation.y = -0.35 * s;
      mesh(new THREE.SphereGeometry(0.072, 24, 18).scale(0.42, 1, 0.74), C.skin, ear);
      mesh(new THREE.SphereGeometry(0.046, 18, 12).scale(0.3, 0.8, 0.55), C.blush, ear, 0.012 * s, 0, 0.004);
      mesh(new THREE.SphereGeometry(0.06, 20, 14).scale(1, 0.62, 0.3), C.blush, head, 0.21 * s, -0.095, 0.302);   // cheek blush
    });
    // eyes: sclera, an iris that can look around (gaze group), upper lids that blink, lashes and brows
    M.lids = []; M.gaze = [];
    [-1, 1].forEach((s) => {
      const eye = group(head, 0.138 * s, 0.07, 0.294);
      eye.rotation.y = 0.3 * s;
      mesh(new THREE.SphereGeometry(0.1, 40, 30).scale(0.8, 1.16, 0.55), C.white, eye);
      const gz = group(eye, 0, 0, 0);
      const ix = -0.01 * s;
      mesh(new THREE.CircleGeometry(0.058, 36), C.iris, gz, ix, -0.012, 0.0552);
      mesh(new THREE.RingGeometry(0.03, 0.046, 36), C.irisLight, gz, ix, -0.02, 0.0556);
      mesh(new THREE.CircleGeometry(0.029, 28), C.black, gz, ix, -0.012, 0.0559);
      mesh(new THREE.CircleGeometry(0.015, 14), C.glint, gz, ix + 0.019, 0.014, 0.0563);
      mesh(new THREE.CircleGeometry(0.0075, 10), C.glint, gz, ix - 0.017, -0.036, 0.0563);
      M.gaze.push(gz);
      // lash line along the top of the eye, with a little flick at the outer corner
      mesh(new THREE.TorusGeometry(0.084, 0.012, 6, 28, Math.PI * 0.92).rotateZ(Math.PI * 0.04).scale(0.84, 1.16, 1), C.lash, eye, 0, 0.004, 0.034);
      const flick = mesh(new THREE.ConeGeometry(0.012, 0.05, 6), C.lash, eye, -0.072 * s, 0.07, 0.03);
      flick.rotation.z = 1.9 * s;
      const lid = mesh(new THREE.SphereGeometry(0.106, 34, 16, 0, TAU, 0, Math.PI * 0.5).scale(0.85, 1.2, 0.6), C.skin, eye, 0, 0.004, 0.004);
      lid.userData.keep = true; lid.scale.y = 0.12; M.lids.push(lid);
      const brow = mesh(tube([[-0.075, -0.012, 0], [-0.02, 0.018, 0.012], [0.04, 0.02, 0.01], [0.08, -0.004, 0]], 0.019, 18, 8), C.brow, eye, 0, 0.138, 0.018);
      brow.userData.keep = true; eye.brow = brow;
    });
    M.eyes = head.children.filter((c) => c.isGroup && c.brow);
    // mouth: a smile line that can open, and flip into a frown
    const mouth = (M.mouth = group(head, 0, -0.165, 0.33));
    mouth.rotation.x = -0.28;
    const smile = mesh(new THREE.TorusGeometry(0.072, 0.013, 8, 30, Math.PI * 0.84).rotateZ(Math.PI + Math.PI * 0.08), C.lip, mouth);
    smile.userData.keep = true; M.smile = smile;
    const inner = mesh(new THREE.SphereGeometry(0.056, 22, 14).scale(1.1, 0.72, 0.35), C.lip, mouth, 0, -0.036, -0.012);
    inner.userData.keep = true; inner.scale.y = 0.05; M.mouthOpen = inner;
    const tongue = mesh(new THREE.SphereGeometry(0.03, 14, 10).scale(1.2, 0.5, 0.6), C.tongue, inner, 0, -0.02, 0.01);
    tongue.userData.keep = true;
    // hair: a cap over the back of the skull, a fringe peeking out under the brim, sideburns and nape tufts
    const capG = deform(new THREE.SphereGeometry(0.386, 56, 28, Math.PI / 2 + 1.25, TAU - 2.5, 0, Math.PI * 0.66), (v) => {
      const side = Math.min(1, Math.abs(v.x) / 0.386), back = Math.max(0, -v.z / 0.386);
      const floor = 0.06 - 0.3 * Math.pow(back, 1.5);        // just above the ears at the sides, down to the nape at the back
      if (v.y < floor) v.y = floor + (v.y - floor) * (1 - Math.pow(side, 1.2)) * 0.25;
    });
    mesh(capG, C.hair, head, 0, 0.012, -0.01);
    const onSkull = (a, el, r) => V3(Math.sin(a) * Math.cos(el) * r, Math.sin(el) * r, Math.cos(a) * Math.cos(el) * r);
    for (let i = 0; i < 7; i++) {
      const a = -0.62 + (i / 6) * 1.24, el = 0.6 - Math.abs(a) * 0.1;
      const p = onSkull(a, el, 0.378), n = p.clone().normalize();
      const down = V3(Math.sin(a) * Math.sin(el), -Math.cos(el), Math.cos(a) * Math.sin(el)).normalize();
      const t = mesh(tuftGeo(0.06 - Math.abs(a) * 0.012, 0.1 + (i % 2) * 0.025, 0.04, 0.45), C.hair, head, p.x, p.y + 0.02, p.z);
      orient(t, down.clone().add(V3(Math.sin(a) * 0.35, 0, 0)).normalize(), n);
    }
    [-1, 1].forEach((s) => {
      const p = V3(0.352 * s, 0.07, 0.1), n = V3(s, 0, 0.25).normalize();
      orient(mesh(tuftGeo(0.045, 0.14, 0.02, 0.4), C.hair, head, p.x, p.y, p.z), V3(0.1 * s, -1, 0.15), n);
    });
    for (let i = 0; i < 7; i++) {
      const a = Math.PI + (i / 6 - 0.5) * 1.9, el = -0.12 - Math.abs(i / 6 - 0.5) * 0.25;
      const p = onSkull(a, el, 0.37), n = p.clone().normalize();
      orient(mesh(tuftGeo(0.055, 0.13 + (i % 3) * 0.03, -0.04, 0.45), C.hair, head, p.x, p.y, p.z), V3(n.x * 0.5, -1, n.z * 0.5), n);
    }
    // explorer hat: creased crown, leather band with a buckle, brim curled up at the sides, a feather
    const hat = (M.hat = group(head, 0, 0.205, -0.01));
    hat.rotation.x = -0.08;
    const crownG = deform(lathe([[0.332, -0.02], [0.327, 0.03], [0.305, 0.16], [0.25, 0.285], [0.15, 0.335], [0.001, 0.35]], 72, 24), (v) => {
      const up = THREE.MathUtils.smoothstep(v.y, 0.16, 0.34);
      v.y -= 0.075 * Math.exp(-(v.x * v.x) / 0.008) * up;           // centre crease, front to back
      if (v.z > 0) { v.x *= 1 - 0.08 * up * Math.min(1, v.z / 0.25); } // pinched front
    });
    mesh(crownG, C.hat, hat);
    mesh(new THREE.CylinderGeometry(0.334, 0.339, 0.075, 64, 1, true), C.band, hat, 0, 0.022, 0);
    const hb = group(hat, 0.3, 0.022, 0.14); hb.rotation.y = 1.13;
    mesh(new window.ADDONS.RoundedBoxGeometry(0.06, 0.07, 0.015, 2, 0.006), C.gold, hb, 0, 0, 0.012);
    const brimG = deform(lathe([[0.325, 0.0], [0.44, -0.016], [0.53, -0.002], [0.568, 0.03], [0.558, 0.046], [0.5, 0.022], [0.33, 0.012]], 80, 18), (v) => {
      const r = Math.hypot(v.x, v.z), side = (v.x / Math.max(r, 0.001)) ** 2;
      v.y += 0.075 * side * THREE.MathUtils.smoothstep(r, 0.38, 0.57) - 0.018 * Math.max(0, v.z / 0.56);
    });
    mesh(brimG, C.hat, hat, 0, -0.05, 0.02);
    const feather = group(hat, 0.29, 0.11, -0.07);
    feather.rotation.set(-0.3, 0.3, -0.55);
    mesh(tube([[0, 0, 0], [0.02, 0.18, -0.02], [0.05, 0.36, -0.06], [0.1, 0.5, -0.12]], 0.008, 20, 6), C.feather, feather);
    for (let i = 0; i < 10; i++) {
      const f = 0.18 + i * 0.085, len = 0.1 * Math.sin(Math.PI * (i + 0.5) / 10) + 0.02;
      [-1, 1].forEach((sd) => { const barb = mesh(new THREE.SphereGeometry(1, 10, 6).scale(len, 0.02, 0.008), C.feather, feather, 0.02 + f * 0.1 + sd * len * 0.8, f * 0.5, -f * 0.12); barb.rotation.z = sd * 0.5; });
    }
    M.feather = feather;

    // ---------------- arms ----------------
    M.arms = [-1, 1].map((s) => {
      const sh = group(chest, 0.37 * s, 0.35, 0);
      mesh(new THREE.SphereGeometry(0.108, 30, 22), C.jacket, sh);
      mesh(new THREE.CapsuleGeometry(0.088, 0.15, 12, 28), C.jacket, sh, 0, -0.125, 0);
      const elbow = group(sh, 0, -0.225, 0);
      mesh(new THREE.SphereGeometry(0.084, 26, 18), C.jacket, elbow);
      mesh(new THREE.CapsuleGeometry(0.08, 0.1, 12, 28), C.jacket, elbow, 0, -0.09, 0);
      mesh(new THREE.TorusGeometry(0.088, 0.032, 12, 36).rotateX(Math.PI / 2), C.jacketDark, elbow, 0, -0.17, 0);
      const wrist = group(elbow, 0, -0.2, 0);
      // gloved hand: flared cuff, palm, four fingers and a thumb (curl animates as one)
      mesh(lathe([[0.092, -0.03], [0.08, 0.0], [0.062, 0.05]], 32, 6), C.glove, wrist, 0, 0.0, 0);
      const hand = group(wrist, 0, -0.065, 0);
      mesh(new THREE.SphereGeometry(0.098, 30, 22).scale(0.95, 0.82, 0.62), C.glove, hand, 0, -0.03, 0);
      const fingers = group(hand, 0, -0.08, 0.01);
      for (let i = 0; i < 4; i++) {
        const fx = (i - 1.5) * 0.041;
        mesh(new THREE.CapsuleGeometry(0.023, 0.07 - Math.abs(i - 1.5) * 0.008, 6, 14), C.glove, fingers, fx, -0.045 + Math.abs(i - 1.5) * 0.008, 0.005);
      }
      const thumb = mesh(new THREE.CapsuleGeometry(0.025, 0.06, 6, 14), C.glove, hand, -0.068 * s, -0.04, 0.05);
      thumb.rotation.set(0.6, 0, 0.8 * s);
      // three stitch lines on the back of the glove
      [-1, 0, 1].forEach((k) => mesh(new THREE.CapsuleGeometry(0.004, 0.05, 3, 6), C.lace, hand, k * 0.028, -0.02, -0.055));
      sh.side = s; sh.elbow = elbow; sh.wrist = wrist; sh.fingers = fingers;
      return sh;
    });

    root.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
    M.phase = 0; M.squash = 0; M.stretch = 0; M.idleT = 0; M.blinkT = 2; M.blink = 0; M.look = 0; M.lookT = 3; M.prevState = '';
    M.lean = 0; M.bank = 0; M.prevFace = 0; M.prevSpd = 0; M.happyT = 0; M.coins = -1;
    M.lookYaw = 0; M.lookPitch = 0; M.gazeX = 0; M.gazeY = 0; M.lookScan = 0; M.lookTarget = null;
    // springs for secondary motion: value, velocity
    M.spr = { featherZ: [0, 0], featherX: [0, 0], packX: [0, 0], packZ: [0, 0], hatZ: [0, 0], hatX: [0, 0], tails: [[0, 0], [0, 0], [0, 0], [0, 0], [0, 0], [0, 0]] };
    M.footL = 0; M.footR = 0; M.pelvisDrop = 0;
    return M;
  };

  // ------------------------------------------------------------------
  // procedural animation
  // ------------------------------------------------------------------
  const P0 = () => ({
    pitch: 0, roll: 0, yaw: 0, pivotY: 0.85, scaleY: 1, bob: 0,
    spineX: 0, spineY: 0, spineZ: 0, hipsZ: 0, neckX: 0, headX: 0, headY: 0, headZ: 0,
    shX: [0.15, 0.15], shZ: [-0.12, 0.12], shY: [0, 0], elb: [0.25, 0.25], curl: [0.3, 0.3],
    hipX: [0, 0], hipZ: [0, 0], knee: [0.08, 0.08], ank: [0, 0],
    mouth: 0, brow: 0, lids: 0, frown: 0, squint: 0, look: 1, footIK: 0,
  });
  // damped spring toward a target (stiffness k, damping c): lively overshoot for secondary motion
  function spring(s, target, k, c, dt) {
    const h = Math.min(dt, 1 / 30);
    s[1] += ((target - s[0]) * k - s[1] * c) * h;
    s[0] += s[1] * h;
    return s[0];
  }
  const _v = new THREE.Vector3();
  const wrapPi = (a) => { a = (a + Math.PI) % TAU; if (a < 0) a += TAU; return a - Math.PI; };

  // something worth looking at: an enemy nearby, else the closest coin ahead, else nothing
  function findLookTarget(pl) {
    const p = pl.pos, fx = Math.sin(pl.face), fz = Math.cos(pl.face);
    let best = null, bd = 1e9;
    const es = G.enemies && G.enemies.list;
    if (es) for (const e of es) {
      if (!e.pos || !e.alive) continue;
      const dx = e.pos.x - p.x, dz = e.pos.z - p.z, d = Math.hypot(dx, dz);
      if (d > 11 || d < 0.8 || Math.abs(e.pos.y - p.y) > 6) continue;
      if ((dx * fx + dz * fz) / d < -0.1) continue;
      if (d < bd) { bd = d; best = _v.set(e.pos.x, e.pos.y + 0.8, e.pos.z); }
    }
    if (best) return best;
    const cs = G.collect && G.collect.coins;
    if (cs) for (const c of cs) {
      if (c.taken) continue;
      const dx = c.x - p.x, dz = c.z - p.z;
      if (Math.abs(dx) > 7 || Math.abs(dz) > 7) continue;
      const d = Math.hypot(dx, dz);
      if (d > 6.5 || d < 0.9 || Math.abs(c.y - p.y) > 4) continue;
      if ((dx * fx + dz * fz) / d < 0.25) continue;
      if (d < bd) { bd = d; best = _v.set(c.x, c.y, c.z); }
    }
    return best;
  }

  G.animatePlayer = function (M, pl, dt) {
    const s = pl.state, spd = Math.hypot(pl.vel.x, pl.vel.z), t = pl.time;
    const A = P0();
    const carrying = !!pl.carry;
    if (s !== M.prevState) {
      if ((s === 'air' || s === 'spring' || s === 'flip' || s === 'longjump') && pl.vel.y > 8) M.stretch = 1; // take-off stretch
      M.stateT = 0; M.prevState = s;
    }
    M.stateT = (M.stateT || 0) + dt;
    // turning rate and acceleration (for banking and leaning)
    const turn = wrapPi(pl.face - M.prevFace) / Math.max(dt, 1e-3); M.prevFace = pl.face;
    const accel = (spd - M.prevSpd) / Math.max(dt, 1e-3); M.prevSpd = spd;
    // coins make Pip happy for a moment
    const coins = G.game && G.game.stats ? G.game.stats.coins : 0;
    if (M.coins >= 0 && coins > M.coins) M.happyT = 0.9;
    M.coins = coins; M.happyT = Math.max(0, M.happyT - dt);

    // ---- locomotion on the ground ----
    const locomote = (maxAmp, speedScale) => {
      const run = pl.running && spd > 9;
      M.phase += dt * (3.2 + spd * (run ? 0.82 : 0.95)) * (speedScale || 1);
      const ph = M.phase, amp = U.clamp(spd / 9, 0.25, 1) * (maxAmp || 1);
      const sw = Math.sin(ph), sw2 = Math.sin(ph - 0.3);
      // legs: thigh swing, knee flexes during the forward swing, heel strike / toe-off roll
      A.hipX = [-sw * 0.74 * amp - 0.08 * amp, sw * 0.74 * amp - 0.08 * amp];
      A.knee = [Math.max(0, Math.sin(ph + 1.1)) * 1.3 * amp + 0.12, Math.max(0, Math.sin(ph + 1.1 + Math.PI)) * 1.3 * amp + 0.12];
      A.ank = [Math.sin(ph + 0.5) * 0.34 * amp, -Math.sin(ph + 0.5) * 0.34 * amp];
      // arms pump opposite to the legs with a little drag; elbows bend more the faster we go
      const elb = run ? 1.5 : 0.55 + amp * 0.35;
      A.shX = [sw2 * 0.78 * amp + (run ? -0.22 : 0), -sw2 * 0.78 * amp + (run ? -0.22 : 0)];
      A.shZ = [-0.15 - amp * 0.07, 0.15 + amp * 0.07];
      A.elb = [elb + Math.max(0, sw2) * 0.32 * amp, elb + Math.max(0, -sw2) * 0.32 * amp];
      A.curl = [run ? 0.95 : 0.5, run ? 0.95 : 0.5];
      // torso: lean with speed (and uphill), counter-twist, pelvis roll, bounce twice per stride
      A.spineX = (run ? 0.3 : 0.12) * amp - (pl.slopeAlong || 0) * 0.25;
      A.spineY = sw * 0.15 * amp;
      A.hipsZ = sw * 0.07 * amp;
      A.headX = -A.spineX * 0.65; A.headY = -A.spineY * 0.85;
      A.bob = Math.abs(Math.cos(ph)) * (run ? 0.11 : 0.06) * amp;
      A.pitch = run ? 0.06 : 0;
      A.brow = run ? -0.35 : 0;
      if (pl.stepSfx !== undefined) {
        const st = Math.floor(ph / Math.PI);
        if (st !== pl.stepSfx) { pl.stepSfx = st; if (spd > 2.5) G.audio.sfx.step(pl.surface ? pl.surface() : 'grass'); if (run && Math.random() < 0.5) G.fx.dust(pl.pos.x, pl.pos.y, pl.pos.z, 1); }
      }
    };

    if (s === 'ground') {
      if (spd > 0.4) { locomote(1); M.idleT = 0; A.footIK = U.clamp(1 - (spd - 0.4) / 2, 0, 1); }
      else {
        A.footIK = 1;
        M.idleT += dt;
        const br = Math.sin(t * 2.2);
        A.spineX = 0.02 + br * 0.015; A.scaleY = 1 + br * 0.012;
        A.shX = [0.08 + br * 0.03, 0.08 + br * 0.03]; A.shZ = [-0.18, 0.18]; A.elb = [0.35, 0.35];
        A.hipZ = [-0.04, 0.04]; A.knee = [0.1, 0.1];
        // weight shift and glances around
        const ws = Math.sin(t * 0.6);
        A.hipX = [ws * 0.04, -ws * 0.04]; A.spineZ = ws * 0.03; A.roll = ws * 0.02; A.hipsZ = -ws * 0.03;
        M.lookT -= dt;
        if (M.lookT <= 0) { M.lookT = 2 + Math.random() * 3; M.look = (Math.random() - 0.5) * 0.9; }
        A.headY = M.look; A.headX = -0.05 + Math.sin(t * 0.9) * 0.04;
        // after a while: tap a foot, adjust the hat, stretch
        if (M.idleT > 7) {
          const k = (M.idleT - 7) % 9;
          if (k < 2) { A.ank[1] = Math.max(0, Math.sin(t * 9)) * 0.45; }
          else if (k > 3 && k < 4.4) { A.shX[1] = -2.5; A.elb[1] = 1.9; A.shZ[1] = 0.5; A.headX = -0.12; }
          else if (k > 6 && k < 7.6) {
            const f = Math.sin((k - 6) / 1.6 * Math.PI);
            A.shX = [-2.9 * f, -2.9 * f]; A.shZ = [-0.35 - f * 0.2, 0.35 + f * 0.2]; A.elb = [0.2, 0.2]; A.spineX = -0.2 * f; A.headX = -0.35 * f;
            A.mouth = 0.8 * f; A.lids = 0.7 * f; A.scaleY = 1 + 0.04 * f;
          }
        }
      }
      if (carrying) carryArms(A, t);
    } else if (s === 'crouch' || s === 'crouchslide') {
      A.pivotY = 0.6; A.scaleY = 0.9; A.spineX = 0.45; A.hipX = [-1.2, -1.2]; A.knee = [1.9, 1.9]; A.ank = [0.5, 0.5];
      A.shX = [-0.4, -0.4]; A.elb = [0.9, 0.9]; A.headX = -0.35;
      if (s === 'crouchslide') { A.pitch = 0.2; A.shX = [0.4, 0.4]; A.shZ = [-0.8, 0.8]; }
    } else if (s === 'skid') {
      A.pitch = -0.3; A.spineX = -0.2; A.hipX = [-0.9, 0.3]; A.knee = [1.1, 0.4]; A.shX = [-1.2, -1.2]; A.shZ = [-1.1, 1.1]; A.elb = [0.2, 0.2]; A.mouth = 0.7; A.brow = 0.6;
    } else if (s === 'air' || s === 'shot' || s === 'spring') {
      const rising = pl.vel.y > 0;
      if (rising) {
        A.hipX = [-1.1, 0.35]; A.knee = [1.6, 0.35]; A.shX = [-2.7, 0.7]; A.shZ = [-0.2, 0.4]; A.elb = [0.3, 0.6];
        A.spineX = 0.08; A.headX = -0.15; A.mouth = 0.5; A.brow = 0.3;
      } else {
        // falling: arms spread for balance, legs reaching for the ground (more as the fall gets longer)
        const fall = U.clamp(-pl.vel.y / 20, 0, 1);
        A.hipX = [-0.35 - fall * 0.2, 0.15 - fall * 0.35]; A.knee = [0.6 - fall * 0.25, 0.3 + fall * 0.2]; A.shX = [-1.6 - fall * 0.5, -1.6 - fall * 0.5]; A.shZ = [-1.2 - fall * 0.3, 1.2 + fall * 0.3]; A.elb = [0.3, 0.3];
        A.headX = 0.1 + fall * 0.15; A.mouth = 0.25 + fall * 0.5; A.curl = [0.1, 0.1]; A.brow = fall;
        A.shY = [Math.sin(t * 11) * 0.12 * fall, -Math.sin(t * 11) * 0.12 * fall];
      }
      if (s === 'shot') { A.pitch = 1.3; A.shX = [-3.0, -3.0]; A.shZ = [-0.2, 0.2]; A.elb = [0, 0]; A.hipX = [0.2, 0.2]; A.knee = [0.1, 0.1]; A.mouth = 1; }
      if (carrying) carryArms(A, t);
    } else if (s === 'flip') {
      const dir = pl.flipDir || 1, f = U.clamp(pl.stateTime / pl.flipDur, 0, 1);
      const ang = (1 - Math.pow(1 - f, 2)) * TAU * dir;
      if (pl.flipAxis === 'z') A.roll = ang; else A.pitch = ang;
      if (f < 0.85) { A.hipX = [-1.7, -1.7]; A.knee = [2.1, 2.1]; A.shX = [-0.9, -0.9]; A.elb = [1.4, 1.4]; A.spineX = 0.4; A.headX = 0.3; A.curl = [1.2, 1.2]; }
      else { A.shX = [-1.8, -1.8]; A.shZ = [-1.2, 1.2]; A.hipX = [-0.4, 0.1]; A.knee = [0.6, 0.2]; }
      A.mouth = 0.6; A.squint = 0.4; A.look = 0;
    } else if (s === 'longjump') {
      A.pitch = 1.1; A.shX = [-2.9, -2.9]; A.shZ = [-0.25, 0.25]; A.elb = [0.05, 0.05]; A.hipX = [0.45, 0.25]; A.knee = [0.5, 0.2]; A.headX = -0.9; A.mouth = 0.8; A.brow = -0.5; A.look = 0;
    } else if (s === 'dive' || s === 'bellyslide') {
      A.pitch = 1.45; A.shX = [-3.0, -3.0]; A.shZ = [-0.2, 0.2]; A.elb = [0, 0]; A.hipX = [0.2, 0.2]; A.knee = [0.3, 0.3]; A.headX = -1.1; A.look = 0;
      A.pivotY = s === 'bellyslide' ? 0.35 : 0.85; A.mouth = s === 'dive' ? 0.9 : 0.4;
    } else if (s === 'gpStart') {
      A.pitch = (pl.stateTime / 0.26) * TAU; A.hipX = [-1.8, -1.8]; A.knee = [2.2, 2.2]; A.shX = [-0.6, -0.6]; A.elb = [1.5, 1.5]; A.spineX = 0.5; A.look = 0; A.squint = 0.6;
    } else if (s === 'gpFall') {
      A.hipX = [-1.5, -1.5]; A.knee = [2.0, 2.0]; A.shX = [0.4, 0.4]; A.shZ = [-1.0, 1.0]; A.elb = [0.6, 0.6]; A.brow = -1; A.mouth = 0.3; A.look = 0;
    } else if (s === 'gpLand' || s === 'hardland') {
      A.pivotY = 0.62; A.scaleY = 0.86; A.hipX = [-1.0, -1.0]; A.knee = [1.7, 1.7]; A.ank = [0.4, 0.4]; A.spineX = 0.35; A.shX = [0.2, 0.2]; A.shZ = [-0.9, 0.9]; A.squint = 0.7; A.look = 0;
    } else if (s === 'slide') {
      A.pitch = -0.5; A.pivotY = 0.6; A.hipX = [-1.3, -1.3]; A.knee = [0.9, 0.9]; A.shX = [-0.6, -0.6]; A.shZ = [-1.2, 1.2]; A.mouth = 0.6; A.brow = 0.8;
    } else if (s === 'punch' || s === 'kick') {
      const f = U.clamp(pl.stateTime / 0.1, 0, 1), back = U.clamp((pl.stateTime - 0.16) / 0.14, 0, 1), k = f * (1 - back * 0.7);
      if (s === 'kick') {
        A.hipX = [0.4, -1.9 * k]; A.knee = [0.5, 1.6 * (1 - k) + 0.1]; A.shX = [-1.4, 0.6]; A.shZ = [-0.6, 0.4]; A.spineX = -0.25; A.pitch = -0.15;
      } else {
        const r = pl.punchIdx % 2 === 0 ? 1 : 0, l = 1 - r;
        A.shX = [l ? -1.55 * k : 0.5, r ? -1.55 * k : 0.5]; A.elb = [l ? 1.6 * (1 - k) + 0.05 : 1.2, r ? 1.6 * (1 - k) + 0.05 : 1.2];
        A.shY = [l ? 0.3 * k : 0, r ? -0.3 * k : 0]; A.curl = [1.3, 1.3];
        A.spineY = (r ? -0.45 : 0.45) * k; A.spineX = 0.12; A.hipX = [-0.35, 0.25]; A.knee = [0.5, 0.2];
      }
      A.brow = -1; A.mouth = 0.4; A.look = 0;
    } else if (s === 'pickup') {
      const f = U.clamp(pl.stateTime / 0.22, 0, 1), up = Math.sin(f * Math.PI);
      A.spineX = 0.7 * up; A.hipX = [-0.9 * up, -0.9 * up]; A.knee = [1.3 * up, 1.3 * up]; A.pivotY = 0.85 - 0.18 * up;
      A.shX = [-1.2 - 1.7 * f, -1.2 - 1.7 * f]; A.shZ = [-0.35, 0.35]; A.elb = [0.4, 0.4]; A.brow = -0.4; A.look = 0;
    } else if (s === 'throw') {
      const f = U.clamp(pl.stateTime / 0.18, 0, 1);
      A.shX = [-3.0 + 1.9 * f, -3.0 + 1.9 * f]; A.shZ = [-0.3, 0.3]; A.elb = [0.6 * (1 - f), 0.6 * (1 - f)]; A.curl = [0, 0];
      A.spineX = -0.25 + 0.6 * f; A.hipX = [-0.5, 0.35]; A.knee = [0.5, 0.2]; A.mouth = 0.7; A.brow = -0.6; A.look = 0;
    } else if (s === 'climb' || s === 'perch') {
      if (s === 'climb') {
        // hand-over-hand when moving, hugging the trunk when still
        const mv = Math.abs(pl.climbVel || 0) > 0.2 || Math.abs(pl.climbSpin || 0) > 0.2;
        M.phase += dt * (mv ? 7 : 0);
        const ph = M.phase, a = mv ? 1 : 0.2;
        A.shX = [-2.6 + Math.sin(ph) * 0.45 * a, -2.6 - Math.sin(ph) * 0.45 * a]; A.shZ = [-0.55, 0.55];
        A.elb = [1.0 + Math.max(0, Math.sin(ph)) * 0.6 * a, 1.0 + Math.max(0, -Math.sin(ph)) * 0.6 * a]; A.curl = [1.4, 1.4];
        A.hipX = [-0.9 - Math.sin(ph) * 0.35 * a, -0.9 + Math.sin(ph) * 0.35 * a]; A.hipZ = [-0.45, 0.45];
        A.knee = [1.5 + Math.sin(ph) * 0.3 * a, 1.5 - Math.sin(ph) * 0.3 * a]; A.spineX = 0.15; A.headX = -0.35;
        A.bob = mv ? Math.sin(ph * 2) * 0.03 : 0; A.brow = -0.3; A.look = 0;
        if (pl.climbVel < -2) { A.shX = [-2.9, -2.9]; A.hipX = [-0.7, -0.7]; A.knee = [1.2, 1.2]; A.mouth = 0.5; }
      } else {
        // balancing proudly on the very top
        const w = Math.sin(t * 2.5);
        A.shX = [-0.2, -0.2]; A.shZ = [-1.35 - w * 0.2, 1.35 - w * 0.2]; A.elb = [0.2, 0.2];
        A.roll = w * 0.06; A.spineZ = -w * 0.05; A.hipX = [0.05, -0.05]; A.knee = [0.15, 0.15]; A.mouth = 0.35; A.headY = Math.sin(t * 0.7) * 0.4;
      }
    } else if (s === 'hurt' || s === 'bonk') {
      A.pitch = -0.5; A.shX = [-2.3, -2.1]; A.shZ = [-1.2, 1.2]; A.elb = [0.4, 0.4]; A.hipX = [-0.5, 0.5]; A.knee = [0.8, 0.3]; A.brow = 1; A.mouth = 1; A.frown = 1; A.squint = 0.5; A.look = 0;
    } else if (s === 'drown' || s === 'dead') {
      A.pitch = -1.4; A.pivotY = 0.4; A.shX = [-2.6, -2.6]; A.shZ = [-1, 1]; A.lids = 0.9; A.mouth = 0.6; A.frown = 1; A.look = 0;
    } else if (s === 'win') {
      const hop = Math.abs(Math.sin(t * 6));
      A.shX = [-3.0, -3.0]; A.shZ = [-0.45, 0.45]; A.elb = [0.2, 0.2]; A.pivotY = 0.85 + hop * 0.22; A.knee = [0.6 * (1 - hop), 0.6 * (1 - hop)]; A.mouth = 1; A.headX = -0.25; A.squint = 0.8; A.brow = 0.5; A.look = 0;
    } else if (s === 'swim') {
      const moving = spd > 1, ph = t * (moving ? 5.2 : 2.4);
      A.pitch = moving ? 1.05 : 0.3; A.headX = -A.pitch * 0.85;
      A.shX = [-2.1 + Math.sin(ph) * 0.9, -2.1 + Math.sin(ph) * 0.9]; A.shZ = [-(0.7 + Math.cos(ph) * 0.6), 0.7 + Math.cos(ph) * 0.6];
      A.elb = [0.4 + Math.max(0, Math.cos(ph)) * 0.8, 0.4 + Math.max(0, Math.cos(ph)) * 0.8];
      A.hipX = [0.3 + Math.sin(ph + Math.PI) * 0.45, 0.3 + Math.sin(ph + Math.PI) * 0.45]; A.hipZ = [-0.25 - Math.max(0, Math.sin(ph)) * 0.35, 0.25 + Math.max(0, Math.sin(ph)) * 0.35];
      A.knee = [0.4 + Math.max(0, Math.sin(ph + 1)) * 1.1, 0.4 + Math.max(0, Math.sin(ph + 1)) * 1.1];
      A.look = moving ? 0 : 1;
    } else if (s === 'uw') {
      const moving = spd > 1 || Math.abs(pl.vel.y) > 1;
      if (moving) {
        const ph = t * 7.5;
        A.pitch = U.clamp(Math.PI / 2 - pl.swimPitch, 0.15, 2.95); A.headX = -0.5;
        A.hipX = [Math.sin(ph) * 0.5, -Math.sin(ph) * 0.5]; A.knee = [0.25 + Math.max(0, Math.sin(ph + 1)) * 0.5, 0.25 + Math.max(0, -Math.sin(ph + 1)) * 0.5];
        A.shX = [-2.95 + Math.sin(ph * 0.5) * 0.3, -2.95 + Math.sin(ph * 0.5) * 0.3]; A.shZ = [-0.2, 0.2]; A.elb = [0.1, 0.1];
      } else {
        const ph = t * 2.6;
        A.pitch = 0.25;
        A.shX = [-1.2 + Math.sin(ph) * 0.35, -1.2 + Math.sin(ph) * 0.35]; A.shZ = [-(1.1 + Math.cos(ph) * 0.35), 1.1 + Math.cos(ph) * 0.35]; A.elb = [0.5, 0.5];
        A.hipX = [Math.sin(ph) * 0.4, -Math.sin(ph) * 0.4]; A.knee = [0.6, 0.6];
      }
      A.mouth = 0.1; A.look = 0; A.squint = 0.3;
    } else if (s === 'cannon') {
      A.pivotY = 0.3;
    }
    if (M.happyT > 0 && A.frown === 0) { const h = Math.min(1, M.happyT * 3); A.squint = Math.max(A.squint, 0.55 * h); A.mouth = Math.max(A.mouth, 0.55 * h); A.brow = Math.max(A.brow, 0.4 * h); }

    // ---- banking into turns and leaning with acceleration (ground locomotion) ----
    const onFoot = s === 'ground' && spd > 1;
    M.bank = U.damp(M.bank, onFoot ? U.clamp(-turn * spd * 0.011, -0.32, 0.32) : 0, 8, dt);
    M.lean = U.damp(M.lean, onFoot ? U.clamp(accel * 0.012, -0.18, 0.2) : 0, 6, dt);
    A.roll += M.bank; A.spineZ += M.bank * 0.4; A.spineX += M.lean; A.headZ -= M.bank * 0.6;

    // ---- look-at: head and eyes track enemies / nearby coins (or glance at the camera when idle) ----
    M.lookScan -= dt;
    if (M.lookScan <= 0) { M.lookScan = 0.15; const tg = A.look > 0 ? findLookTarget(pl) : null; M.lookTarget = tg ? (M.lookTarget || new THREE.Vector3()).copy(tg) : null; M.hasTarget = !!tg; }
    let lyaw = 0, lpitch = 0, wantLook = 0;
    if (A.look > 0 && M.hasTarget) {
      const tg = M.lookTarget, dx = tg.x - pl.pos.x, dz = tg.z - pl.pos.z, dy = tg.y - (pl.pos.y + 1.45);
      lyaw = U.clamp(wrapPi(Math.atan2(dx, dz) - pl.face), -1.15, 1.15);
      lpitch = U.clamp(-Math.atan2(dy, Math.hypot(dx, dz)), -0.5, 0.45);
      wantLook = 1;
    } else if (A.look > 0 && s === 'ground' && M.idleT > 3 && Math.sin(t * 0.37) > 0.7 && G.camera && G.camera.cam) {
      const c = G.camera.cam.position, dx = c.x - pl.pos.x, dz = c.z - pl.pos.z;
      lyaw = U.clamp(wrapPi(Math.atan2(dx, dz) - pl.face), -1.0, 1.0); lpitch = -0.1; wantLook = 1;
    }
    M.lookYaw = U.damp(M.lookYaw, lyaw * wantLook, 5, dt);
    M.lookPitch = U.damp(M.lookPitch, lpitch * wantLook, 5, dt);
    A.headY += M.lookYaw * 0.72; A.headX += M.lookPitch * 0.6; A.spineY += M.lookYaw * 0.12;
    // eyes lead the head and add tiny saccades
    const sacc = Math.sin(t * 1.3) * Math.sin(t * 3.1) * 0.03;
    M.gazeY = U.damp(M.gazeY, U.clamp(M.lookYaw * 0.35 + sacc, -0.3, 0.3), 14, dt);
    M.gazeX = U.damp(M.gazeX, U.clamp(M.lookPitch * 0.35, -0.2, 0.2), 14, dt);

    // ---- foot placement: pelvis drops and knees bend so both feet rest on steps and slopes ----
    let pelvisDrop = 0, raiseL = 0, raiseR = 0;
    if (A.footIK > 0 && pl.grounded && G.physics) {
      const fx = Math.sin(pl.face), fz = Math.cos(pl.face), rx = fz, rz = -fx, off = 0.145, fw = 0.06;
      const P = G.physics, y0 = pl.pos.y;
      const hl = P.ground(pl.pos.x + rx * off + fx * fw, pl.pos.z + rz * off + fz * fw, y0 + 0.45, 0.9, 0).h - y0;
      const hr = P.ground(pl.pos.x - rx * off + fx * fw, pl.pos.z - rz * off + fz * fw, y0 + 0.45, 0.9, 0).h - y0;
      const L = U.clamp(hl, -0.45, 0.45), R = U.clamp(hr, -0.45, 0.45);
      pelvisDrop = Math.min(0, Math.min(L, R)) * A.footIK;
      raiseL = (L - pelvisDrop) * A.footIK; raiseR = (R - pelvisDrop) * A.footIK;
    }
    M.pelvisDrop = U.damp(M.pelvisDrop, pelvisDrop, 14, dt);
    M.footL = U.damp(M.footL, raiseL, 14, dt); M.footR = U.damp(M.footR, raiseR, 14, dt);
    // model +x is the character's left: arms/legs[0] are on -x (right side), [1] on +x.
    // Two-bone leg (thigh ~ shin): raising the foot by r keeps it under the hip with the thigh swung forward
    // by a = acos(1 - r / L), the knee bent by 2a and the ankle turned back by a (sole stays level).
    const lift = [M.footR, M.footL];
    for (let i = 0; i < 2; i++) {
      const r = Math.max(0, lift[i]) / 0.9;
      if (r < 0.002) continue;
      const a = Math.acos(Math.max(-1, 1 - r / 0.6));
      A.knee[i] += a * 2; A.hipX[i] -= a; A.ank[i] -= a * 0.55;
    }
    const slope = pl.grounded && s === 'ground' ? U.clamp(-(pl.slopeAlong || 0), -0.5, 0.5) : 0;

    // ---- face: blinking, expressions ----
    M.blinkT -= dt;
    if (M.blinkT <= 0) { M.blink = 0.16; M.blinkT = Math.random() < 0.18 ? 0.28 : 2.2 + Math.random() * 3.5; }
    if (M.blink > 0) M.blink -= dt;
    const blink = M.blink > 0 ? Math.sin((1 - M.blink / 0.16) * Math.PI) : 0;
    const lidT = Math.max(A.lids, blink, A.squint * 0.55, s === 'hurt' ? 0.5 : 0);

    // ---- squash & stretch: landings squash, take-offs stretch ----
    M.squash = Math.max(0, M.squash - dt * 5);
    M.stretch = Math.max(0, M.stretch - dt * 4);
    const sq = M.squash, st = M.stretch;
    let sx = (1 + sq * 0.3) * (1 - st * 0.08), sy = (1 - sq * 0.35) * A.scaleY * (1 + st * 0.16);
    if ((s === 'air' || s === 'spring') && pl.vel.y > 8) { sy *= 1.05; sx *= 0.97; }

    // ---- apply with smoothing ----
    const k = 16, kq = 22, d = (a, b, r) => U.damp(a, b, r || k, dt);
    M.pivot.position.y = d(M.pivot.position.y, A.pivotY + A.bob + M.pelvisDrop, 20);
    if (s === 'flip' || s === 'gpStart') { M.pivot.rotation.x = A.pitch; M.pivot.rotation.z = A.roll; }
    else {
      M.pivot.rotation.x = d(M.pivot.rotation.x % TAU, A.pitch, 12);
      M.pivot.rotation.z = d(M.pivot.rotation.z % TAU, A.roll, 12);
    }
    M.root.scale.set(sx, sy, sx);
    M.spine.rotation.x = d(M.spine.rotation.x, A.spineX);
    M.spine.rotation.y = d(M.spine.rotation.y, A.spineY);
    M.spine.rotation.z = d(M.spine.rotation.z, A.spineZ);
    M.hips.rotation.y = d(M.hips.rotation.y, -A.spineY * 0.5);
    M.hips.rotation.z = d(M.hips.rotation.z, A.hipsZ);
    M.head.rotation.x = d(M.head.rotation.x, A.headX, 10);
    M.head.rotation.y = d(M.head.rotation.y, A.headY, 7);
    M.head.rotation.z = d(M.head.rotation.z, A.headZ, 8);
    M.arms.forEach((a, i) => {
      a.rotation.x = d(a.rotation.x, A.shX[i], kq);
      a.rotation.z = d(a.rotation.z, A.shZ[i], kq);
      a.rotation.y = d(a.rotation.y, A.shY[i], kq);
      a.elbow.rotation.x = d(a.elbow.rotation.x, -A.elb[i], kq);
      a.fingers.rotation.x = d(a.fingers.rotation.x, -A.curl[i], kq);
    });
    M.legs.forEach((l, i) => {
      l.rotation.x = d(l.rotation.x, A.hipX[i], kq);
      l.rotation.z = d(l.rotation.z, A.hipZ[i] - A.hipsZ, kq);
      l.knee.rotation.x = d(l.knee.rotation.x, A.knee[i], kq);
      l.ankle.rotation.x = d(l.ankle.rotation.x, A.ank[i] - A.knee[i] * 0.35 + A.hipX[i] * -0.25 + slope * A.footIK, kq);
    });
    M.lids.forEach((lid) => { lid.scale.y = d(lid.scale.y, 0.12 + lidT * 1.0, 40); });
    M.eyes.forEach((e) => {
      if (!e.brow) return;
      e.brow.position.y = d(e.brow.position.y, 0.138 + A.brow * 0.022, 12);
      e.brow.rotation.z = d(e.brow.rotation.z, A.brow * -0.25 * Math.sign(e.position.x) + A.frown * 0.2 * Math.sign(e.position.x), 12);
    });
    M.gaze.forEach((g) => { g.rotation.y = M.gazeY; g.rotation.x = M.gazeX; });
    M.mouthOpen.scale.y = d(M.mouthOpen.scale.y, 0.05 + A.mouth * 1.1, 14);
    M.smile.scale.y = d(M.smile.scale.y, 1 - A.frown * 1.7, 12);
    M.smile.scale.x = d(M.smile.scale.x, 1 + A.squint * 0.12 - A.mouth * 0.15, 12);

    // ---- secondary motion (springs driven by speed, turning, acceleration and vertical velocity) ----
    const wind = Math.min(1, spd / 8) + (s === 'air' || s === 'flip' ? Math.min(1, Math.abs(pl.vel.y) / 15) : 0);
    const vy = U.clamp(pl.vel.y / 20, -1, 1);
    const SP = M.spr;
    M.scarfTails.forEach((segs, j) => segs.forEach((seg, i) => {
      const sp = SP.tails[j * 3 + i];
      const target = (i ? 0.12 : -0.42) - wind * 0.9 * (i ? 0.5 : 1) + vy * 0.4 + Math.sin(t * 13 + i * 0.9 + j * 1.7) * 0.18 * wind - M.lean * 1.5;
      seg.rotation.x = spring(sp, target, 160, 10, dt);
      seg.rotation.z = d(seg.rotation.z, 0.25 * (j ? 1 : -1) + Math.sin(t * 9 + i + j) * 0.1 * wind + M.bank * 0.8, 10);
    }));
    M.feather.rotation.z = -0.55 + spring(SP.featherZ, Math.sin(t * 8) * 0.06 * wind + M.bank * 0.6, 90, 5, dt);
    M.feather.rotation.x = -0.3 + spring(SP.featherX, -vy * 0.35 - M.lean * 0.8 + wind * 0.12, 90, 5, dt);
    M.hat.rotation.z = spring(SP.hatZ, -M.bank * 0.12, 220, 14, dt);
    M.hat.rotation.x = -0.08 + spring(SP.hatX, vy * 0.06 - M.lean * 0.2, 220, 14, dt);
    M.pack.position.y = 0.2 + A.bob * -0.35;
    M.pack.rotation.x = spring(SP.packX, -A.bob * 1.2 - vy * 0.25 - M.lean * 0.6, 140, 9, dt);
    M.pack.rotation.z = spring(SP.packZ, -M.bank * 0.4, 140, 9, dt);
    M.root.visible = !(pl.invuln > 0 && Math.floor(pl.invuln * 14) % 2 === 0) && s !== 'cannon';
  };

  // arms raised holding an object overhead
  function carryArms(A, t) {
    A.shX = [-3.0, -3.0]; A.shZ = [-0.36, 0.36]; A.shY = [0, 0]; A.elb = [0.3, 0.3]; A.curl = [0.8, 0.8];
    A.spineX = Math.min(A.spineX, 0.1); A.headX = -0.05;
  }
})(window.G);

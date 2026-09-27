// gfx.js — render pipeline built on three.js r186 WebGPURenderer (automatic WebGL2 fallback) and TSL.
// Performance-oriented design:
//  * one scene pass per frame (MRT: colour, normals, velocity, emissive) feeding GTAO, TRAA and bloom
//  * cascaded shadow maps (4 cascades with cross-fading) for crisp shadows near the player and far away
//  * procedural detail comes from pre-baked tileable noise / normal textures (no per-pixel Perlin noise),
//    faded out with distance so mip transitions never show
//  * the physical sky (with clouds) is cached in a cube map refreshed one face at a time
//  * low-resolution shadow proxies (terrain, trees) are rendered only into the shadow maps (layer 1)
//  * static props are merged per material & sector; characters are baked into a few vertex-coloured meshes
//  * grass is drawn in two cross-faded rings; LOD changes use temporal dithering resolved by TRAA
//  * underwater: fog, tint, light shafts and a wobble distortion driven by the camera's water depth
(function (G) {
  'use strict';
  const THREE = window.THREE;
  const S = window.TSL;
  const A = window.ADDONS;
  const {
    float, vec2, vec3, vec4, color, uniform, attribute, positionLocal, positionWorld, normalWorld,
    smoothstep, mix, sin, cos, texture, instanceIndex, clamp, max, min, abs, length, normalize, dot, pow, exp,
    fract, floor, cameraViewMatrix, uv, pass, mrt, output, emissive, normalView, velocity, packNormalToRGB,
    unpackRGBToNormal, sample, screenUV, fog, varying, mod, frontFacing,
  } = S;

  const GFX = (G.gfx = {
    quality: 'high', autoQuality: true, backend: 'unknown', ready: false,
    uTime: uniform(0), uPlayer: uniform(new THREE.Vector3()), uCenter: uniform(new THREE.Vector2()),
    uCamPos: uniform(new THREE.Vector3()), uFrame: uniform(0), uLodNear: uniform(62),
    uUnder: uniform(0), uCamDepth: uniform(0),
    pixelRatio: 1.5, maxPixelRatio: 1.5, maxAniso: 8, frameNo: 0,
  });

  // sun from the east-south-east, ~48° high
  const SUN_DIR = new THREE.Vector3(0.6, 0.75, 0.28).normalize();
  const FOG_COLOR = 0xb3d1ec;
  const SHADOW_LAYER = 1;

  // ------------------------------------------------------------------
  // renderer
  // ------------------------------------------------------------------
  GFX.init = async function (canvas) {
    const forceWebGL = location.hash === '#webgl';
    // Instanced meshes with up to 1024 instances would read their matrices from a uniform buffer whose name is
    // unique per mesh, so every such mesh got its own shader and pipeline (~800 of them, i.e. seconds of
    // compile stutter). Routing all instance matrices through instanced vertex attributes lets every
    // instanced mesh of a material share one pipeline.
    if (THREE.NodeBuilder && THREE.NodeBuilder.prototype.getUniformBufferLimit) {
      THREE.NodeBuilder.prototype.getUniformBufferLimit = function () { return 0; };
    }
    const renderer = (GFX.renderer = new THREE.WebGPURenderer({ canvas, antialias: false, powerPreference: 'high-performance', forceWebGL }));
    GFX.maxPixelRatio = Math.min(window.devicePixelRatio || 1, 2);
    GFX.pixelRatio = Math.min(GFX.maxPixelRatio, 2);
    renderer.setPixelRatio(GFX.pixelRatio);
    renderer.toneMapping = THREE.NeutralToneMapping;
    renderer.toneMappingExposure = 0.72;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFShadowMap;
    await renderer.init();
    GFX.backend = renderer.backend && renderer.backend.isWebGPUBackend ? 'WebGPU' : 'WebGL 2';
    try { GFX.maxAniso = Math.min(16, renderer.getMaxAnisotropy() || 8); } catch (e) { GFX.maxAniso = 8; }
    makeNoiseTextures();
    GFX.ready = true;
  };

  GFX.resize = function (w, h) {
    if (!GFX.renderer) return;
    GFX.renderer.setSize(w, h, false);
  };

  // ------------------------------------------------------------------
  // baked, tileable noise: R/G = fbm (two seeds), B = cellular, A = ridged; plus a derived normal map
  // ------------------------------------------------------------------
  function makeNoiseTextures() {
    const N = 256, TAU = Math.PI * 2;
    const hash = (x, y, s) => {
      let h = (Math.imul(x, 374761393) + Math.imul(y, 668265263) + Math.imul(s, 1442695041)) | 0;
      h = Math.imul(h ^ (h >>> 13), 1274126177);
      h ^= h >>> 16;
      return (h >>> 0) / 4294967296;
    };
    const gnoise = (x, y, p, s) => { // periodic gradient noise, p = period in lattice cells
      const x0 = Math.floor(x), y0 = Math.floor(y), fx = x - x0, fy = y - y0;
      const u = fx * fx * fx * (fx * (fx * 6 - 15) + 10), v = fy * fy * fy * (fy * (fy * 6 - 15) + 10);
      const g = (ix, iy, dx, dy) => {
        const a = hash(((ix % p) + p) % p, ((iy % p) + p) % p, s) * TAU;
        return Math.cos(a) * dx + Math.sin(a) * dy;
      };
      const n00 = g(x0, y0, fx, fy), n10 = g(x0 + 1, y0, fx - 1, fy), n01 = g(x0, y0 + 1, fx, fy - 1), n11 = g(x0 + 1, y0 + 1, fx - 1, fy - 1);
      const a = n00 + (n10 - n00) * u, b = n01 + (n11 - n01) * u;
      return (a + (b - a) * v) * 1.41;
    };
    const fbm = (x, y, base, oct, s) => {
      let sum = 0, amp = 0.55, p = base;
      for (let o = 0; o < oct; o++) { sum += amp * gnoise(x * p, y * p, p, s + o * 17); p *= 2; amp *= 0.5; }
      return sum;
    };
    const worley = (x, y, cells, s) => {
      const cx = x * cells, cy = y * cells, ix = Math.floor(cx), iy = Math.floor(cy);
      let d = 9;
      for (let j = -1; j <= 1; j++) for (let i = -1; i <= 1; i++) {
        const gx = ix + i, gy = iy + j, wx = ((gx % cells) + cells) % cells, wy = ((gy % cells) + cells) % cells;
        const px = gx + hash(wx, wy, s), py = gy + hash(wx, wy, s + 99);
        d = Math.min(d, Math.hypot(px - cx, py - cy));
      }
      return d;
    };
    const data = new Uint8Array(N * N * 4);
    const hR = new Float32Array(N * N);
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
      const u = x / N, v = y / N, k = y * N + x;
      const r = fbm(u, v, 4, 5, 1), g = fbm(u, v, 8, 4, 7);
      const c = worley(u, v, 16, 3), rd = 1 - Math.abs(fbm(u, v, 6, 3, 11));
      hR[k] = r;
      data[k * 4] = Math.max(0, Math.min(255, (r * 0.5 + 0.5) * 255));
      data[k * 4 + 1] = Math.max(0, Math.min(255, (g * 0.5 + 0.5) * 255));
      data[k * 4 + 2] = Math.max(0, Math.min(255, (1 - Math.min(1, c)) * 255));
      data[k * 4 + 3] = Math.max(0, Math.min(255, rd * 255));
    }
    const noise = new THREE.DataTexture(data, N, N, THREE.RGBAFormat);
    // tangent-space normal map from the fbm channel (for water ripples and ground micro-detail)
    const nd = new Uint8Array(N * N * 4);
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
      const at = (i, j) => hR[((j + N) % N) * N + ((i + N) % N)];
      const dx = (at(x + 1, y) - at(x - 1, y)) * 6, dy = (at(x, y + 1) - at(x, y - 1)) * 6;
      const l = Math.hypot(dx, dy, 1), k = (y * N + x) * 4;
      nd[k] = (-dx / l * 0.5 + 0.5) * 255; nd[k + 1] = (-dy / l * 0.5 + 0.5) * 255; nd[k + 2] = (1 / l * 0.5 + 0.5) * 255; nd[k + 3] = 255;
    }
    const normal = new THREE.DataTexture(nd, N, N, THREE.RGBAFormat);
    [noise, normal].forEach((t) => {
      t.wrapS = t.wrapT = THREE.RepeatWrapping;
      t.magFilter = THREE.LinearFilter; t.minFilter = THREE.LinearMipmapLinearFilter;
      t.generateMipmaps = true; t.anisotropy = GFX.maxAniso; t.needsUpdate = true;
    });
    GFX.noiseTex = noise; GFX.normalTex = normal;
  }

  // ------------------------------------------------------------------
  // temporal dither (interleaved gradient noise, new pattern each frame; TRAA resolves it to a smooth blend)
  // ------------------------------------------------------------------
  function dither() {
    const p = S.screenCoordinate.xy.add(GFX.uFrame.mul(5.588238));
    return fract(float(52.9829189).mul(fract(dot(p, vec2(0.06711056, 0.00583715)))));
  }
  GFX.dither = dither;

  // ------------------------------------------------------------------
  // sky: physical sky + clouds rendered into a cube map (refreshed one face at a time)
  // ------------------------------------------------------------------
  function makeSky(clouds) {
    const sky = new A.SkyMesh();
    sky.scale.setScalar(1800);
    sky.turbidity.value = 2.4;
    sky.rayleigh.value = 1.45;
    sky.mieCoefficient.value = 0.0035;
    sky.mieDirectionalG.value = 0.82;
    sky.sunPosition.value.copy(SUN_DIR).multiplyScalar(1000);
    sky.cloudCoverage.value = clouds ? 0.4 : 0.0;
    sky.cloudDensity.value = 0.55;
    sky.cloudElevation.value = 0.55;
    sky.cloudScale.value = 0.00025;
    sky.cloudSpeed.value = 0.00003;
    sky.castShadow = false; sky.receiveShadow = false; sky.userData.noShadow = true;
    return sky;
  }

  GFX.setupScene = function (scene, camera) {
    GFX.scene = scene; GFX.camera = camera;
    const renderer = GFX.renderer;

    if (!GFX.skyCube) {
      const skyScene = new THREE.Scene();
      skyScene.add(makeSky(true));
      const rt = new THREE.CubeRenderTarget(512, { type: THREE.HalfFloatType, generateMipmaps: false });
      const cam = new THREE.CubeCamera(1, 5000, rt);
      skyScene.add(cam);
      cam.update(renderer, skyScene);
      GFX.skyCube = { rt, cam, scene: skyScene, face: -1, timer: 0 };
      // image based lighting from a cloud-free copy of the sky
      const envScene = new THREE.Scene();
      envScene.add(makeSky(false));
      const pm = new THREE.PMREMGenerator(renderer);
      GFX.envTexture = pm.fromScene(envScene, 0, 0.1, 5000).texture;
      pm.dispose();
    }
    scene.background = GFX.skyCube.rt.texture;
    scene.environment = GFX.envTexture;
    scene.environmentIntensity = 0.34;

    // warm sun, cool sky fill, green bounce from the ground
    scene.add(new THREE.HemisphereLight(0xcfe4ff, 0x56703a, 0.34));
    const sun = (GFX.sun = new THREE.DirectionalLight(0xfff0d8, 4.1));
    sun.castShadow = true;
    const sc = sun.shadow.camera;
    sc.left = -80; sc.right = 80; sc.top = 80; sc.bottom = -80; sc.near = 1; sc.far = 1400;
    sc.layers.enable(SHADOW_LAYER); // shadow-only proxies live on layer 1 (copied into every cascade)
    sun.shadow.bias = -0.00006;
    sun.shadow.normalBias = 0.04;
    sun.shadow.radius = 2.5;
    const size = shadowSize(0);
    sun.shadow.mapSize.set(size, size);
    sun.position.copy(SUN_DIR).multiplyScalar(300);
    sun.target.position.set(0, 0, 0);
    // cascaded shadow maps: 3 cascades (≈24 m, 110 m, 400 m) blended into each other; the far cascade only
    // draws the shadow proxies (terrain, trees, bushes) and big structures
    if (A.CSMShadowNode) {
      const csm = new A.CSMShadowNode(sun, {
        cascades: 3, maxFar: 400, mode: 'custom', lightMargin: 320,
        customSplitsCallback: (n, near, far, out) => { out.push(0.06, 0.275, 1); },
      });
      csm.fade = true;
      sun.shadow.shadowNode = csm;
      GFX.csm = csm; GFX.csmTuned = false;
    }
    scene.add(sun); scene.add(sun.target);

    // aerial perspective: exponential haze that thins with altitude; far scenery sinks into the sky colour.
    // Underwater the same node becomes a dense blue-green fog that darkens with depth.
    const toP = positionWorld.sub(S.cameraPosition);
    const dist = length(toP);
    const heightThin = exp(max(positionWorld.y.sub(8), 0).mul(-0.0045));
    const haze = float(1).sub(exp(pow(dist.mul(1 / 1900), 1.6).negate()));
    const hazeF = haze.mul(mix(heightThin, float(1), smoothstep(500, 2200, dist))).mul(0.96);
    const uwF = float(1).sub(exp(dist.mul(-0.042))).mul(0.97);
    const uwCol = mix(color(0x2aa3c4), color(0x0a3a6a), smoothstep(0, 22, GFX.uCamDepth));
    // sunlight scattered in the haze: the air glows warm toward the sun and stays cool-blue away from it
    const cosSun = dot(toP.div(max(dist, 0.001)), vec3(SUN_DIR.x, SUN_DIR.y, SUN_DIR.z)).max(0);
    const hazeCol = mix(mix(color(FOG_COLOR), color(0xa9c8ea), smoothstep(0.3, -0.4, cosSun)), color(0xffe6bf), pow(cosSun, 6).mul(0.7));
    scene.fogNode = fog(mix(hazeCol, uwCol, GFX.uUnder), mix(hazeF, uwF, GFX.uUnder));
  };

  // Drifting clouds: every 1.5 s the six cube faces are re-rendered on six consecutive frames (one face per
  // frame, so no frame pays for the whole cube). Faces refreshed 0.45 s apart used to show seams because
  // the clouds had moved in between; 1/60 s apart they are indistinguishable.
  function updateSky(dt) {
    const s = GFX.skyCube;
    if (!s) return;
    if (s.face < 0) {
      s.timer += dt;
      if (s.timer < 1.5) return;
      s.timer = 0; s.face = 0;
    }
    const r = GFX.renderer, prev = r.getRenderTarget();
    r.setRenderTarget(s.rt, s.face);
    r.render(s.scene, s.cam.children[s.face]);
    r.setRenderTarget(prev);
    s.face = s.face < 5 ? s.face + 1 : -1;
  }

  // shadow map size per cascade (the middle cascade gets the extra resolution on ultra)
  function shadowSize(i) {
    const v = (GFX.TIER[GFX.quality] || GFX.TIER.high).shadow;
    return Array.isArray(v) ? v[Math.min(i, v.length - 1)] : v;
  }
  // per-cascade bias: scale the normal offset with each cascade's texel size (no acne far away, no
  // peter-panning up close)
  function tuneCascades() {
    const csm = GFX.csm;
    if (!csm || !csm.lights.length) return;
    csm.lights.forEach((l, i) => {
      const sh = l.shadow, c = sh.camera, size = shadowSize(i);
      if (sh.mapSize.x !== size) sh.mapSize.set(size, size);
      const texel = (c.right - c.left) / size;
      sh.normalBias = Math.max(0.025, texel * 1.4);
      sh.bias = -0.00004 * (1 + i);
      sh.radius = i === 0 ? 2.2 : 1.6;
      if (i === csm.lights.length - 1) c.layers.set(SHADOW_LAYER);
    });
    GFX.csmTuned = true;
  }

  // Staggered cascade refresh: the near cascade (everything that moves around the player) renders every
  // frame, the middle one every second frame and the far one (terrain / tree proxies) every fourth. Each
  // cascade's lookup matrix is only rebuilt when its map is re-rendered, so a skipped cascade stays exactly
  // consistent with its map. This removes ~40% of all draw calls per frame.
  function staggerCascades() {
    const csm = GFX.csm;
    if (!csm || csm.lights.length < 3) return;
    const f = GFX.frameNo;
    const mid = csm.lights[1].shadow, far = csm.lights[2].shadow;
    mid.autoUpdate = false; far.autoUpdate = false;
    if (GFX.shadowRefreshAll > 0) { GFX.shadowRefreshAll--; mid.needsUpdate = true; far.needsUpdate = true; return; }
    mid.needsUpdate = (f & 1) === 0;
    far.needsUpdate = (f & 3) === 1;
  }
  // after a camera cut (teleport, warp, respawn) every cascade is refreshed for a couple of frames
  GFX.shadowRefreshAll = 2;
  GFX.cameraCut = function () {
    GFX.shadowRefreshAll = 2;
    // restart the upscaler's history (re-seeded from the new view) so nothing of the old view lingers
    const up = GFX.taau;
    if (up && up.isTAAUNode && up._historyRenderTarget && up._historyRenderTarget.width > 1) up._historyRenderTarget.setSize(1, 1);
  };

  GFX.update = function (dt, focus) {
    GFX.uTime.value += dt;
    GFX.uFrame.value = (GFX.uFrame.value + 1) % 64;
    GFX.frameNo = (GFX.frameNo + 1) | 0;
    updateSky(dt);
    if (!GFX.sun) return;
    // the cascades only need the light direction; keep the light near the focus for numerical comfort
    GFX.sun.target.position.copy(focus);
    GFX.sun.position.copy(focus).addScaledVector(SUN_DIR, 300);
    GFX.sun.target.updateMatrixWorld();
    if (GFX.csm && !GFX.csmTuned) tuneCascades();
    staggerCascades();
    const p = G.player && G.player.pos;
    if (p) GFX.uPlayer.value.set(p.x, p.y, p.z);
    const climbing = G.player && G.player.isClimbing && G.player.isClimbing();
    GFX.uPlayerFade.value = G.U.damp(GFX.uPlayerFade.value, climbing ? 1 : 0, 6, dt);
    GFX.uTunnel.value = G.game && G.game.state !== 'title' ? 1 : 0;
  };

  // ------------------------------------------------------------------
  // height / mask texture shared by water, grass, flowers and the terrain shader
  // R: terrain height, G: grass density, B: flower density, A: water level (-1000 = dry)
  // ------------------------------------------------------------------
  GFX.ensureFieldTexture = function () {
    if (GFX.fieldTex) return GFX.fieldTex;
    const W = G.terrain.N + 1;
    const tex = new THREE.DataTexture(new Uint16Array(W * W * 4), W, W, THREE.RGBAFormat, THREE.HalfFloatType);
    tex.minFilter = tex.magFilter = THREE.LinearFilter;
    tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
    tex.generateMipmaps = false;
    GFX.fieldTex = tex;
    return tex;
  };
  GFX.makeFieldTexture = function () {
    const T = G.terrain, W = T.N + 1, H = T.HALF, C = T.CELL;
    const tex = GFX.ensureFieldTexture();
    const data = tex.image.data;
    const toH = THREE.DataUtils.toHalfFloat;
    const zones = (G.decor && G.decor.flowerZones) || [];
    // water level, dilated 2 cells onto the shore so the shader interpolates smoothly across the waterline.
    // The raised fountain basin is left out: its rim, not the terrain, holds the water, and dilating it
    // painted caustics and a wet tint onto the plaza around it.
    const FT = T.fountain;
    const wg = new Float32Array(T.waterGrid);
    if (FT) for (let j = 0; j < W; j++) for (let i = 0; i < W; i++) {
      const x = -H + i * C, z = -H + j * C;
      if (Math.hypot(x - FT.x, z - FT.z) < FT.r + 1.5) wg[j * W + i] = -1000;
    }
    const wl = new Float32Array(wg);
    for (let j = 0; j < W; j++) for (let i = 0; i < W; i++) {
      const k = j * W + i;
      if (wg[k] > -999) continue;
      let best = -1000;
      for (let b = -2; b <= 2; b++) for (let a = -2; a <= 2; a++) {
        const ii = i + a, jj = j + b;
        if (ii < 0 || jj < 0 || ii >= W || jj >= W) continue;
        const v = wg[jj * W + ii];
        if (v > best) best = v;
      }
      wl[k] = best;
    }
    // no grass or flowers under anything that stands on the ground (bridges, hedges, walls, houses, rocks)
    const bare = new Uint8Array(W * W);
    const hs = T.heights, P = G.physics;
    const stamp = (cx, cz, ex, ez, test) => {
      const i0 = Math.max(0, Math.floor((cx - ex + H) / C)), i1 = Math.min(W - 1, Math.ceil((cx + ex + H) / C));
      const j0 = Math.max(0, Math.floor((cz - ez + H) / C)), j1 = Math.min(W - 1, Math.ceil((cz + ez + H) / C));
      for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) if (test(-H + i * C, -H + j * C, hs[j * W + i])) bare[j * W + i] = 1;
    };
    P.boxes.forEach((b) => {
      if (b.dynamic) return;
      const ac = Math.abs(b.cos), as = Math.abs(b.sin), m = 0.6;
      stamp(b.x, b.z, b.hx * ac + b.hz * as + m, b.hx * as + b.hz * ac + m, (x, z, g) => {
        if (b.y - b.hy > g + 1.2 || b.y + b.hy < g - 0.4) return false;
        const l = P.toLocal(b, x, z);
        return Math.abs(l[0]) < b.hx + m && Math.abs(l[1]) < b.hz + m;
      });
    });
    P.cyls.forEach((c) => {
      if (c.dynamic || c.r < 0.7) return;
      const r = c.r * 0.9;
      stamp(c.x, c.z, r, r, (x, z, g) => c.y0 < g + 0.5 && Math.hypot(x - c.x, z - c.z) < r);
    });
    GFX.grassFinal = new Float32Array(W * W); GFX.flowerFinal = new Float32Array(W * W);
    for (let j = 0; j < W; j++) for (let i = 0; i < W; i++) {
      const k = j * W + i, x = -H + i * C, z = -H + j * C;
      let fl = 0;
      for (const zn of zones) {
        const dx = x - zn.x, dz = z - zn.z;
        if (Math.abs(dx) > zn.r || Math.abs(dz) > zn.r) continue;
        const d = Math.hypot(dx, dz);
        if (d < zn.r) fl = Math.max(fl, zn.d * (1 - Math.pow(d / zn.r, 2)));
      }
      const gm = bare[k] ? 0 : T.grassMask[k];
      GFX.grassFinal[k] = gm; GFX.flowerFinal[k] = fl * gm;
      data[k * 4] = toH(T.heights[k]);
      data[k * 4 + 1] = toH(gm);
      data[k * 4 + 2] = toH(fl * gm);
      data[k * 4 + 3] = toH(wl[k]);
    }
    tex.needsUpdate = true;
    GFX.fieldFilled = true;
    return tex;
  };
  function fieldUV(xz) {
    const T = G.terrain, W = T.N + 1;
    return xz.add(T.HALF).div(T.CELL).add(0.5).div(W);
  }
  GFX.fieldUV = fieldUV;
  const toView = (n) => normalize(cameraViewMatrix.mul(vec4(n, 0)).xyz);
  GFX.toView = toView;
  const hash21 = (p) => fract(sin(dot(p, vec2(12.9898, 78.233))).mul(43758.5453));

  // animated caustic web (contour lines of two drifting noise layers)
  function caustics(wp, t) {
    const uvC = wp.xz.mul(1 / 9.5);
    const a = texture(GFX.noiseTex, uvC.add(vec2(t.mul(0.021), t.mul(0.013)))).r;
    const b = texture(GFX.noiseTex, uvC.mul(1.31).add(vec2(t.mul(-0.017), t.mul(0.024)))).g;
    const n = a.add(b);
    return pow(float(1).sub(abs(sin(n.mul(11.0)))), 7.0);
  }
  GFX.caustics = caustics;

  // ------------------------------------------------------------------
  // terrain material: grass / dirt / rock / sand / paving blended with baked-noise detail and micro-normals,
  // wet shores, underwater tint and animated caustics
  // ------------------------------------------------------------------
  GFX.terrainMaterial = function () {
    const m = new THREE.MeshStandardNodeMaterial({ roughness: 0.92, metalness: 0 });
    const aMat = attribute('aMat', 'vec4');
    const aEx = attribute('aExtra', 'vec2');
    const ao = aEx.x, pave = aEx.y;
    const wp = positionWorld, t = GFX.uTime;
    const camDist = length(wp.sub(S.cameraPosition));
    const detail = smoothstep(260, 70, camDist);                    // fine detail fades out (no mip shimmer)
    const nt = texture(GFX.noiseTex, wp.xz.mul(1 / 190));          // macro
    const nm = texture(GFX.noiseTex, wp.xz.mul(1 / 23));           // mid
    const nf = texture(GFX.noiseTex, wp.xz.mul(1 / 3.1));          // fine
    // cliff faces are textured with a "wall" projection so detail never stretches vertically
    const wallUV = vec2(wp.x.add(wp.z), wp.y);
    const nr = texture(GFX.noiseTex, wallUV.mul(1 / 12));
    const nr2 = texture(GFX.noiseTex, vec2(wp.x.sub(wp.z), wp.y).mul(1 / 4.5));
    const n1 = nt.r.mul(2).sub(1), n2 = nm.g.mul(2).sub(1), n3 = nf.r.mul(2).sub(1).mul(detail);

    // lawn: base gradient, sun-dried olive patches, dark lush clumps and fine blade striation up close
    const macroG = texture(GFX.noiseTex, wp.xz.mul(1 / 430)).g;
    const dry = smoothstep(0.55, 0.8, macroG.add(n2.mul(0.1)));
    const lush = smoothstep(0.5, 0.85, nm.b).mul(0.3);
    const blades = texture(GFX.noiseTex, wp.xz.mul(vec2(1 / 0.45, 1 / 1.6))).r.sub(0.5).mul(0.2).mul(detail);
    let grass = mix(color(0x2c6a1a), color(0x5a982d), n1.mul(0.5).add(0.5).add(n2.mul(0.18)).clamp(0, 1));
    grass = mix(mix(grass, color(0x8a9f42), dry.mul(0.5)), color(0x21541a), lush);
    grass = grass.mul(n3.mul(0.07).add(1).add(blades));
    const vale = mix(color(0x26702a), color(0x4f9c32), n2.mul(0.5).add(0.5));
    const grassC = mix(grass, vale, smoothstep(-128, -150, wp.z));
    const pebble = smoothstep(0.62, 0.9, nf.b).mul(detail);
    const dirt = mix(color(0x86582c), color(0xae8049), n2.mul(0.5).add(0.5)).mul(n3.mul(0.12).add(1)).mul(pebble.mul(0.2).add(1));
    const strata = sin(wp.y.mul(0.85).add(nr.a.mul(2.2))).mul(0.5).add(0.5);
    const rockTone = strata.mul(0.22).add(nr.r.mul(0.4)).add(nr2.g.mul(0.22)).add(0.14).clamp(0, 1);
    const crack = smoothstep(0.34, 0.1, nr2.b).mul(0.45).mul(detail.mul(0.6).add(0.4)); // fissures between blocks
    const rockBase = mix(color(0x574739), color(0xa38b6c), rockTone).mul(float(1).sub(crack));
    const moss = smoothstep(0.55, 0.85, normalWorld.y).mul(smoothstep(-0.2, 0.4, n2));
    const rock = mix(rockBase, mix(color(0x3f6f25), color(0x6c9230), n1.mul(0.5).add(0.5)), moss.mul(0.85));
    const sand = mix(color(0xc2a36c), color(0xe0cb94), n2.mul(0.5).add(0.5)).mul(n3.mul(0.06).add(1));

    // stone paving: offset rows of 1.2 x 0.8 m slabs, per-slab tone, mortar joints (faded with distance)
    const pv = wp.xz.mul(vec2(1 / 1.2, 1 / 0.8));
    const row = floor(pv.y);
    const pvx = pv.x.add(mod(row, 2).mul(0.5));
    const cell = vec2(floor(pvx), row);
    const fx = fract(pvx), fz = fract(pv.y);
    const edge = min(min(fx, float(1).sub(fx)).mul(1.2), min(fz, float(1).sub(fz)).mul(0.8));
    const jointFade = smoothstep(70, 22, camDist);
    const joint = mix(float(1), smoothstep(0.03, 0.06, edge), jointFade);
    const slab = hash21(cell);
    const slabC = mix(color(0xb3a894), color(0xdcd2bd), slab).mul(nm.r.mul(0.2).add(0.9)).mul(n3.mul(0.05).add(1));
    const paveC = mix(color(0x6e675c), slabC, joint);

    const slopeRock = smoothstep(0.8, 0.6, normalWorld.y);
    const wSum = aMat.x.add(aMat.y).add(aMat.w).max(0.001);
    const soft = grassC.mul(aMat.x).add(dirt.mul(aMat.y)).add(sand.mul(aMat.w)).div(wSum);
    const rockW = max(aMat.z, slopeRock).mul(float(1).sub(pave));
    let col = mix(soft, rock, rockW);
    col = mix(col, paveC, pave);
    // water: wet band on the shore, tint and caustics below the local water level
    const wlev = texture(GFX.fieldTex || GFX.ensureFieldTexture(), fieldUV(wp.xz)).a;
    const depthW = wlev.sub(wp.y);
    const wet = smoothstep(-1.4, 0.0, depthW);
    const under = smoothstep(0.05, 0.7, depthW);
    col = col.mul(float(1).sub(wet.mul(0.28)));
    col = mix(col, col.mul(vec3(0.5, 0.74, 0.78)), smoothstep(0.3, 9, depthW).mul(0.75));
    const caus = caustics(wp, t).mul(under).mul(exp(depthW.mul(-0.045))).mul(smoothstep(0.2, 0.8, normalWorld.y).mul(0.6).add(0.4));
    col = col.add(vec3(0.75, 0.95, 1.0).mul(caus.mul(0.75)));
    m.colorNode = col.mul(ao);
    m.roughnessNode = mix(float(0.95), float(0.82), rockW).sub(wet.mul(0.4)).sub(pave.mul(0.12));
    // micro-normal detail: ground projection on flat areas, wall projection on cliffs
    const nFlat = texture(GFX.normalTex, wp.xz.mul(1 / 3.3)).xyz.mul(2).sub(1);
    const nWall = texture(GFX.normalTex, wallUV.mul(1 / 3.0)).xyz.mul(2).sub(1);
    const flatW = smoothstep(0.55, 0.85, normalWorld.y);
    const pertFlat = vec3(nFlat.x, 0, nFlat.y);
    const tang = normalize(vec3(normalWorld.z.negate(), 0, normalWorld.x).add(vec3(0.0001, 0, 0)));
    const pertWall = tang.mul(nWall.x).add(vec3(0, nWall.y, 0));
    const bump = mix(float(0.22), float(0.65), rockW).add(aMat.y.mul(0.15)).mul(detail.mul(0.75).add(0.25)).mul(float(1).sub(pave.mul(0.6)));
    m.normalNode = toView(normalize(normalWorld.add(mix(pertWall, pertFlat, flatW).mul(bump))));
    return m;
  };

  // ------------------------------------------------------------------
  // distant mountains: per-pixel meadow / forest / rock / snow from slope, altitude and baked noise
  // (vertex colours on 50-100 m triangles smeared into streaks)
  // ------------------------------------------------------------------
  GFX.vistaMaterial = function () {
    const m = new THREE.MeshStandardNodeMaterial({ roughness: 0.95, metalness: 0 });
    const wp = positionWorld, slope = normalWorld.y;
    const macro = texture(GFX.noiseTex, wp.xz.mul(1 / 1100));
    const mid = texture(GFX.noiseTex, wp.xz.mul(1 / 170));
    const face = texture(GFX.noiseTex, vec2(wp.x.add(wp.z), wp.y).mul(1 / 90));
    const meadow = mix(color(0x557f2e), color(0x6b8b37), mid.r);
    const forest = mix(color(0x264a1d), color(0x31592a), mid.g);
    const green = mix(meadow, forest, smoothstep(0.42, 0.62, macro.g.add(mid.b.mul(0.25))));
    const strata = sin(wp.y.mul(0.07).add(face.a.mul(4))).mul(0.5).add(0.5);
    const rock = mix(color(0x655a4e), color(0x9c8e7d), face.r.mul(0.6).add(strata.mul(0.4)));
    const edge = mid.r.sub(0.5).mul(0.22);
    const rockW = max(smoothstep(0.8, 0.6, slope.add(edge)), smoothstep(170, 290, wp.y.add(mid.g.sub(0.5).mul(90))).mul(0.9));
    let col = mix(green, rock, rockW);
    const snowW = smoothstep(250, 330, wp.y.add(mid.r.sub(0.5).mul(90))).mul(smoothstep(0.45, 0.72, slope.add(edge)));
    col = mix(col, color(0xeef3f8), snowW);
    m.colorNode = col;
    m.roughnessNode = mix(float(0.96), float(0.55), snowW);
    return m;
  };

  // ------------------------------------------------------------------
  // water (shared by every water body): scrolling normal layers, depth colour, shoreline foam,
  // distance-faded ripples; seen from below it becomes a bright, rippled "mirror" surface
  // ------------------------------------------------------------------
  let waterMat = null;
  GFX.waterMaterial = function () {
    if (waterMat) return waterMat;
    const m = new THREE.MeshStandardNodeMaterial({ transparent: true, roughness: 0.05, metalness: 0, side: THREE.DoubleSide, depthWrite: false });
    m.envMapIntensity = 3.0;
    const t = GFX.uTime;
    const wp = positionWorld.xz;
    const dist = length(positionWorld.sub(S.cameraPosition));
    const far = smoothstep(30, 420, dist);
    const nA = texture(GFX.normalTex, wp.mul(1 / 21).add(vec2(t.mul(0.011), t.mul(0.007)))).xyz.mul(2).sub(1);
    const nB = texture(GFX.normalTex, wp.mul(1 / 8.5).add(vec2(t.mul(-0.019), t.mul(0.014)))).xyz.mul(2).sub(1);
    const nC = texture(GFX.normalTex, wp.mul(1 / 3.1).add(vec2(t.mul(0.034), t.mul(-0.027)))).xyz.mul(2).sub(1);
    const nx = nA.x.add(nB.x.mul(0.7)).add(nC.x.mul(float(0.45).mul(float(1).sub(far))));
    const nz = nA.y.add(nB.y.mul(0.7)).add(nC.y.mul(float(0.45).mul(float(1).sub(far))));
    const nW = normalize(vec3(nx, mix(float(2.3), float(6.0), far), nz));
    m.normalNode = toView(frontFacing.select(nW, nW.mul(vec3(1, -1, 1))));
    const ground = texture(GFX.fieldTex || GFX.ensureFieldTexture(), fieldUV(wp)).r;
    const depth = positionWorld.y.sub(ground).max(0);
    const cDepth = smoothstep(0.0, 9.0, depth);
    const foamN = texture(GFX.noiseTex, wp.mul(1 / 6).add(vec2(t.mul(0.02), t.mul(-0.013)))).g;
    const band = sin(depth.mul(5.0).sub(t.mul(1.8))).mul(0.5).add(0.5);
    const foam = smoothstep(1.3, 0.05, depth).mul(smoothstep(0.35, 0.95, foamN.mul(0.8).add(band.mul(0.55))));
    const shallow = color(0x44e2cf), mid = color(0x1aa2d6), deep = color(0x0b4588);
    const body = mix(mix(shallow, mid, smoothstep(0, 3.5, depth)), deep, smoothstep(3.5, 16, depth));
    const above = mix(body, color(0xf4fbff), foam);
    const below = mix(color(0x8fe3ff), color(0x3fb6dc), smoothstep(4, 40, dist));
    m.colorNode = frontFacing.select(above, below);
    const opAbove = clamp(mix(float(0.42), float(0.93), cDepth).add(foam.mul(0.8)), 0, 1);
    m.opacityNode = frontFacing.select(opAbove, mix(float(0.78), float(1.0), smoothstep(6, 45, dist)));
    m.roughnessNode = mix(float(0.04), float(0.55), foam);
    m.emissiveNode = frontFacing.select(vec3(0), color(0x2a90b8).mul(0.18));
    waterMat = m;
    return m;
  };

  // ------------------------------------------------------------------
  // low-resolution terrain used only by the shadow maps (layer 1)
  // ------------------------------------------------------------------
  GFX.makeTerrainShadowProxy = function (scene) {
    const T = G.terrain, N = T.N, W = N + 1, H = T.HALF, C = T.CELL, hs = T.heights;
    const STRIDE = 2, CH = 100; // proxy cells: 2 m, chunks of 100 proxy cells (200 m) -> 16 draw calls per cascade
    const cells = N / STRIDE;
    const mat = new THREE.MeshBasicNodeMaterial();
    for (let cj = 0; cj < cells; cj += CH) for (let ci = 0; ci < cells; ci += CH) {
      const CW = CH + 1, pos = new Float32Array(CW * CW * 3), idx = [];
      for (let j = 0; j <= CH; j++) for (let i = 0; i <= CH; i++) {
        const gi = Math.min(N, (ci + i) * STRIDE), gj = Math.min(N, (cj + j) * STRIDE), v = (j * CW + i) * 3;
        pos[v] = -H + gi * C; pos[v + 1] = hs[gj * W + gi] - 0.3; pos[v + 2] = -H + gj * C;
      }
      for (let j = 0; j < CH; j++) for (let i = 0; i < CH; i++) {
        const a = j * CW + i, b = a + 1, c = a + CW, d = c + 1;
        idx.push(a, c, b, b, c, d);
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
      g.setIndex(idx);
      g.computeVertexNormals();
      g.computeBoundingSphere();
      const mesh = new THREE.Mesh(g, mat);
      mesh.layers.set(SHADOW_LAYER);
      mesh.castShadow = true; mesh.receiveShadow = false;
      mesh.userData.noShadow = true;
      scene.add(mesh);
    }
  };
  GFX.SHADOW_LAYER = SHADOW_LAYER;

  // ------------------------------------------------------------------
  // GPU grass & flowers: camera-centred fields placed from the field texture
  // ------------------------------------------------------------------
  function bladeGeometry(segs, width) {
    const pos = [], idx = [], uvs = [];
    for (let i = 0; i <= segs; i++) {
      const y = i / segs, w = width * (1 - y * 0.85);
      if (i < segs) { pos.push(-w, y, 0, w, y, 0); uvs.push(0, y, 1, y); }
      else { pos.push(0, 1, 0); uvs.push(0.5, 1); }
    }
    for (let i = 0; i < segs - 1; i++) { const a = i * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
    const a = (segs - 1) * 2; idx.push(a, a + 1, a + 2);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    g.setAttribute('normal', upNormals(pos.length / 3)); // shadow normal-offset needs a valid normal
    g.setIndex(idx);
    return g;
  }
  function upNormals(n) {
    const a = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) a[i * 3 + 1] = 1;
    return new THREE.BufferAttribute(a, 3);
  }

  function scatterField(opts) {
    const side = opts.side, R = opts.radius, spacing = (R * 2) / side;
    const base = opts.geometry;
    const geo = new THREE.InstancedBufferGeometry();
    geo.index = base.index;
    geo.setAttribute('position', base.getAttribute('position'));
    geo.setAttribute('uv', base.getAttribute('uv'));
    geo.setAttribute('normal', base.getAttribute('normal') || upNormals(base.getAttribute('position').count));
    geo.instanceCount = side * side;
    const uCell = uniform(new THREE.Vector2());
    const id = instanceIndex.toFloat();
    const gx = mod(id, side), gz = floor(id.div(side));
    const cell = uCell.add(vec2(gx, gz)).sub(side / 2);
    const h1 = fract(sin(dot(cell, vec2(12.9898, 78.233))).mul(43758.5453));
    const h2 = fract(sin(dot(cell, vec2(39.3468, 11.135))).mul(24634.6345));
    const h3 = fract(sin(dot(cell, vec2(73.156, 52.235))).mul(15731.743));
    const world = cell.add(vec2(h1, h2)).mul(spacing);
    const field = texture(GFX.fieldTex, fieldUV(world)).level(0);
    const groundY = field.r;
    const density = opts.channel === 'b' ? field.b : field.g;
    const toPl = world.sub(GFX.uPlayer.xz);
    const dPl = length(toPl);
    const toCam = length(world.sub(GFX.uCenter));
    // ring visibility, then stochastic thinning: every blade has its own threshold, so the density fades
    // gradually across the ring edges instead of all blades shrinking together
    let vis = smoothstep(R, R * 0.66, toCam);
    if (opts.innerRadius) vis = vis.mul(smoothstep(opts.innerRadius * 0.6, opts.innerRadius, toCam));
    const thr = h3.mul(0.8).add(0.08);
    const fade = smoothstep(thr, thr.add(0.14), vis);
    const keep = opts.channel === 'b' ? smoothstep(0.55, 0.75, density.mul(h3.mul(0.6).add(0.6))) : smoothstep(0.2, 0.85, density);
    const camD = length(world.sub(GFX.uCamPos.xz));
    const lens = smoothstep(1.5, 5.0, camD.add(max(GFX.uCamPos.y.sub(groundY).sub(2.5), 0)));
    const H = float(opts.height).mul(h2.mul(0.5).add(0.6)).mul(keep).mul(fade).mul(lens);
    // wind gusts from the baked noise (a single texture fetch per vertex)
    const gust = texture(GFX.noiseTex, world.mul(0.018).add(vec2(GFX.uTime.mul(0.02), GFX.uTime.mul(0.011)))).level(0).r.mul(2).sub(1);
    const flutter = sin(GFX.uTime.mul(3.1).add(h1.mul(6.28))).mul(0.12);
    const windAmt = gust.mul(0.6).add(0.45).add(flutter).mul(opts.wind);
    const near = smoothstep(1.7, 0.1, dPl).mul(smoothstep(2.4, 0.4, abs(GFX.uPlayer.y.sub(groundY))));
    const pushDir = normalize(toPl.add(vec2(0.0001, 0)));
    // raw blade-space position (positionLocal gets overwritten by positionNode, so varyings must not use it)
    const p = S.positionGeometry;
    const tip = p.y.mul(p.y);
    const ang = h1.mul(6.2832);
    const rx = p.x.mul(cos(ang)), rz = p.x.mul(sin(ang));
    const bend = vec2(0.8, 0.55).mul(windAmt).add(pushDir.mul(near.mul(1.1))).mul(tip).mul(H);
    const y = p.y.mul(H).mul(near.mul(-0.45).add(1));
    const out = vec3(world.x.add(rx).add(bend.x), groundY.add(y).sub(0.02), world.y.add(rz).add(bend.y));
    return { geo, positionNode: out, uCell, spacing, h1, h2, h3, varyH: varying(p.y) };
  }

  const FIELD_TIERS = {
    high: { inner: 22000, innerR: 14, outer: 40000, outerR: 40, flowers: 9000 },
    medium: { inner: 16000, innerR: 12, outer: 24000, outerR: 30, flowers: 5000 },
    low: { inner: 10000, innerR: 10, outer: 12000, outerR: 21, flowers: 0 },
  };
  GFX.refreshFields = function () {
    const scene = GFX.scene;
    if (!scene || !GFX.fieldTex) return;
    const cfg = FIELD_TIERS[GFX.quality] || FIELD_TIERS.high;
    (GFX.fields || []).forEach((g) => { if (g.mesh.parent) g.mesh.parent.remove(g.mesh); g.mesh.geometry.dispose(); });
    GFX.fields = [];
    // inner ring: dense 3-segment blades; outer ring: sparser, wider single-triangle blades
    GFX.fields.push(makeGrassField(scene, cfg.inner, cfg.innerR, 0, bladeGeometry(3, 0.085), 0.58));
    GFX.fields.push(makeGrassField(scene, cfg.outer, cfg.outerR, cfg.innerR, bladeGeometry(1, 0.16), 0.62));
    if (cfg.flowers) GFX.fields.push(makeFlowers(scene, cfg.flowers));
    GFX.fieldsTier = GFX.quality;
  };

  function grassMaterial(f) {
    // Lambert: purely diffuse, so blades never pick up a white sky sheen at grazing angles
    const m = new THREE.MeshLambertNodeMaterial({ side: THREE.DoubleSide });
    m.positionNode = f.positionNode;
    const patch = texture(GFX.noiseTex, positionWorld.xz.mul(1 / 150)).r;
    const baseC = mix(color(0x1a420c), color(0x285814), patch);
    const tipC = mix(color(0x4f8f26), color(0x7aae34), patch.mul(f.h3)).mul(f.h2.mul(0.22).add(0.82));
    m.colorNode = mix(baseC, tipC, f.varyH.pow(1.0));
    m.normalNode = toView(vec3(0, 1, 0));
    return m;
  }
  function makeGrassField(scene, count, radius, innerRadius, geometry, height) {
    const side = Math.round(Math.sqrt(count));
    const f = scatterField({ side, radius, innerRadius, geometry, height, wind: 0.5, channel: 'g' });
    const mesh = new THREE.Mesh(f.geo, grassMaterial(f));
    mesh.frustumCulled = false; mesh.receiveShadow = true; mesh.castShadow = false; mesh.userData.noShadowCast = true;
    scene.add(mesh);
    return { mesh, f };
  }

  function makeFlowers(scene, count) {
    const side = Math.round(Math.sqrt(count));
    const g = new THREE.BufferGeometry();
    const pos = [0, 0, 0, 0.012, 0, 0, 0, 0.55, 0, 0.012, 0.55, 0];
    const idx = [0, 1, 2, 1, 3, 2];
    const c = pos.length / 3;
    pos.push(0, 0.62, 0);
    for (let i = 0; i < 10; i++) {
      const a = (i / 10) * Math.PI * 2, r = i % 2 ? 0.07 : 0.17;
      pos.push(Math.cos(a) * r, 0.58, Math.sin(a) * r);
    }
    for (let i = 0; i < 10; i++) idx.push(c, c + 1 + i, c + 1 + ((i + 1) % 10));
    const uvs = [];
    for (let i = 0; i < pos.length / 3; i++) uvs.push(0, i > 3 ? 1 : 0);
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    g.setIndex(idx);
    const f = scatterField({ side, radius: 34, geometry: g, height: 1.0, wind: 0.25, channel: 'b' });
    const m = new THREE.MeshLambertNodeMaterial({ side: THREE.DoubleSide });
    m.positionNode = f.positionNode;
    const pick = f.h2;
    const petal = mix(mix(color(0xff4f8b), color(0xffe14a), smoothstep(0.25, 0.3, pick)),
      mix(color(0xffffff), color(0xa77bff), smoothstep(0.75, 0.8, pick)), smoothstep(0.5, 0.55, pick));
    const isPetal = varying(uv().y);
    m.colorNode = mix(color(0x2f6a1e), petal, isPetal);
    m.emissiveNode = petal.mul(isPetal).mul(0.06);
    m.normalNode = toView(vec3(0, 1, 0));
    const mesh = new THREE.Mesh(f.geo, m);
    mesh.frustumCulled = false; mesh.receiveShadow = true; mesh.castShadow = false; mesh.userData.noShadowCast = true;
    scene.add(mesh);
    return { mesh, f };
  }

  GFX.updateFields = function (camPos) {
    GFX.uCenter.value.set(camPos.x, camPos.z);
    GFX.uCamPos.value.copy(camPos);
    (GFX.fields || []).forEach((g) => {
      g.f.uCell.value.set(Math.floor(camPos.x / g.f.spacing), Math.floor(camPos.z / g.f.spacing));
    });
  };

  // ------------------------------------------------------------------
  // foliage helpers
  // ------------------------------------------------------------------
  GFX.windFoliage = function (material, strength) {
    // positionLocal already includes the instance transform here: phase from world position
    const w = positionLocal;
    const t = GFX.uTime;
    const ph = w.x.mul(0.13).add(w.z.mul(0.11));
    const k = S.positionGeometry.y.max(0).mul(strength || 0.02);
    material.positionNode = w.add(vec3(sin(t.mul(1.25).add(ph)).mul(k), 0, cos(t.mul(0.95).add(ph.mul(1.7))).mul(k.mul(0.8))));
    return material;
  };
  function addMask(material, cond) {
    material.maskNode = material.maskNode ? material.maskNode.and(cond) : cond;
    return material;
  }
  // screen-door fade for anything that gets between the camera and the player
  GFX.cameraFade = function (material, near, far) {
    const d = length(positionWorld.sub(S.cameraPosition));
    const a = smoothstep(near || 2.5, far || 7.5, d);
    return addMask(material, dither().lessThan(a));
  };
  // foliage dissolves around the player while climbing (so the hero stays visible inside a canopy)
  GFX.uPlayerFade = uniform(0); GFX.uTunnel = uniform(0);
  // ...and anything between the camera and the player dissolves (a soft x-ray tunnel toward the hero)
  GFX.playerFade = function (material) {
    const p = positionWorld, a = S.cameraPosition, b = GFX.uPlayer.add(vec3(0, 1.0, 0));
    const ab = b.sub(a), t = clamp(dot(p.sub(a), ab).div(max(dot(ab, ab), 0.0001)), 0, 1);
    const dLine = length(p.sub(a.add(ab.mul(t))));
    const tunnelR = mix(float(1.2), float(2.8), GFX.uPlayerFade);
    const occ = max(max(smoothstep(tunnelR.mul(0.5), tunnelR, dLine), S.step(0.97, t)), float(1).sub(GFX.uTunnel));
    const near = mix(float(1), smoothstep(1.1, 2.8, length(p.sub(b))), GFX.uPlayerFade);
    return addMask(material, dither().lessThan(min(occ, near)));
  };
  // dithered LOD cross-fade: the near model fades out exactly where the far model fades in
  GFX.lodFade = function (material, isFar, band, uNear) {
    const d = length(positionWorld.xz.sub(S.cameraPosition.xz));
    const b = band || 9, nearD = uNear || GFX.uLodNear;
    const f = smoothstep(nearD.sub(b), nearD.add(b), d);
    return addMask(material, isFar ? dither().lessThan(f) : dither().greaterThanEqual(f));
  };
  // dithered fade-out with distance (at a range where the object is only a few pixels tall)
  GFX.farFade = function (material, uFar, band) {
    const d = length(positionWorld.xz.sub(S.cameraPosition.xz));
    return addMask(material, dither().lessThan(smoothstep(uFar, uFar.sub(band || 30), d)));
  };
  GFX.uTuftNear = uniform(46); GFX.uTuftFar = uniform(150);

  // ------------------------------------------------------------------
  // foliage shading (tree canopies, bushes): leaf clusters with dark gaps, sky occlusion toward the inside
  // and underside of the crown, warmer sunlit tops, a leafy normal breakup and translucency, so leaves glow
  // when the sun shines through them. The instance colour multiplies all of this.
  // ------------------------------------------------------------------
  const SUNV = vec3(SUN_DIR.x, SUN_DIR.y, SUN_DIR.z);
  GFX.SUNV = SUNV;
  // triplanar sampling (three axis-aligned projections blended by the normal: no stretching on any face)
  function triWeights(n) {
    const w = pow(abs(n), vec3(4));
    return w.div(w.x.add(w.y).add(w.z).add(0.0001));
  }
  function triplanar(tex, p, w, k) {
    return texture(tex, p.zy.mul(k)).mul(w.x).add(texture(tex, p.xz.mul(k)).mul(w.y)).add(texture(tex, p.xy.mul(k)).mul(w.z));
  }
  function triplanarBump(tex, p, w, k) {
    const nx = texture(tex, p.zy.mul(k)).xyz.mul(2).sub(1), ny = texture(tex, p.xz.mul(k)).xyz.mul(2).sub(1), nz = texture(tex, p.xy.mul(k)).xyz.mul(2).sub(1);
    return vec3(0, nx.y, nx.x).mul(w.x).add(vec3(ny.x, 0, ny.y).mul(w.y)).add(vec3(nz.x, nz.y, 0).mul(w.z));
  }
  GFX.triplanar = triplanar; GFX.triWeights = triWeights;
  GFX.foliage = function (m, o) {
    o = o || {};
    const sc = o.scale || 0.55;
    const wp = positionWorld, n = normalWorld, tw = triWeights(n);
    const nz = triplanar(GFX.noiseTex, wp, tw, 1 / sc);
    const clump = smoothstep(0.12, 0.8, nz.b);
    const sky = n.y.mul(0.5).add(0.5);
    const ao = mix(float(o.aoMin || 0.5), float(1), sky.mul(0.7).add(clump.mul(0.3)));
    const tint = mix(vec3(0.9, 0.97, 0.92), vec3(1.07, 1.05, 0.84), smoothstep(0.4, 0.95, sky));
    m.colorNode = tint.mul(mix(float(0.7), float(1.1), clump)).mul(ao);
    if (!o.cheap) {
      const b = triplanarBump(GFX.normalTex, wp, tw, 1 / (sc * 1.4));
      m.normalNode = toView(normalize(n.add(b.mul(o.bump || 0.6))));
    }
    const V = normalize(wp.sub(S.cameraPosition));
    const back = pow(max(dot(V, SUNV), 0), 4);
    const away = smoothstep(0.15, -0.5, dot(n, SUNV));
    const trans = back.mul(0.85).add(away.mul(0.14)).mul(clump.mul(0.5).add(0.5)).mul(o.trans == null ? 1 : o.trans);
    m.emissiveNode = S.diffuseColor.rgb.mul(vec3(1.2, 1.08, 0.55)).mul(trans);
    return m;
  };

  // ------------------------------------------------------------------
  // character baking: merge each rigid part of a hierarchy into one vertex-coloured mesh
  // (one shared PBR material with per-vertex roughness/metalness/emissive and a Fresnel rim)
  // ------------------------------------------------------------------
  let charMat = null;
  function characterMaterial() {
    if (charMat) return charMat;
    const m = new THREE.MeshStandardNodeMaterial();
    const col = attribute('color', 'vec3'), pbr = attribute('aPBR', 'vec3'), emi = attribute('aEmi', 'vec3'), cls = attribute('aCls', 'float');
    // material classes baked per vertex: 1 cloth, 2 skin, 3 hair, 4 leather (5 metal and 6 eyes use plain PBR)
    const is = (k) => max(float(0), float(1).sub(abs(cls.sub(k))));
    const cloth = is(1), skin = is(2), hair = is(3), leather = is(4);
    // micro-detail in each part's own space (it moves with its joint, so it never swims): fabric weave,
    // hair strands, leather grain, a hint of skin texture
    const pg = S.positionGeometry, nl = S.normalLocal, tw = triWeights(nl);
    const fine = triplanarBump(GFX.normalTex, pg, tw, 1 / 0.05);
    const grain = triplanarBump(GFX.normalTex, pg, tw, 1 / 0.13);
    const bump = fine.mul(cloth.mul(0.3).add(hair.mul(0.28))).add(grain.mul(leather.mul(0.2).add(skin.mul(0.03))));
    m.normalNode = S.transformNormalToView(normalize(nl.add(bump)));
    const tone = triplanar(GFX.noiseTex, pg, tw, 1 / 0.22).r.sub(0.5);
    m.colorNode = col.mul(float(1).add(tone.mul(cloth.mul(0.14).add(leather.mul(0.2)))));
    m.roughnessNode = pbr.x.add(tone.mul(leather.mul(0.3))).clamp(0.04, 1);
    m.metalnessNode = pbr.y;
    // Fresnel rim, velvet-like sheen on fabric, warm light scattering through skin near the terminator,
    // soft sheen along hair
    const ndv = dot(normalView, S.positionViewDirection).clamp(0, 1);
    const f = pow(float(1).sub(ndv), 2.6);
    const ndl = dot(normalWorld, SUNV);
    const sss = smoothstep(-0.5, 0.05, ndl).mul(smoothstep(0.55, 0.0, ndl));
    m.emissiveNode = emi.add(color(0xfff1d8).mul(f.mul(pbr.z)))
      .add(col.mul(pow(float(1).sub(ndv), 3.5).mul(cloth.mul(0.28).add(hair.mul(0.2)))))
      .add(col.mul(vec3(1.0, 0.42, 0.3)).mul(skin.mul(sss).mul(0.34)));
    charMat = m;
    return m;
  }
  GFX.characterMaterial = characterMaterial;

  function bakedGeometry(mesh, rim) {
    mesh.updateMatrix();
    let g = mesh.geometry.clone();
    if (mesh.userData.flat) { g = g.index ? g.toNonIndexed() : g; g.computeVertexNormals(); }
    g.applyMatrix4(mesh.matrix);
    Object.keys(g.attributes).forEach((k) => { if (k !== 'position' && k !== 'normal') g.deleteAttribute(k); });
    const n = g.attributes.position.count;
    if (!g.index) { const idx = new Uint32Array(n); for (let i = 0; i < n; i++) idx[i] = i; g.setIndex(new THREE.BufferAttribute(idx, 1)); }
    const mat = mesh.material, c = mat.color || new THREE.Color(1, 1, 1);
    const e = mat.emissive || new THREE.Color(0, 0, 0), ei = mat.emissiveIntensity == null ? 1 : mat.emissiveIntensity;
    const col = new Float32Array(n * 3), pbr = new Float32Array(n * 3), emi = new Float32Array(n * 3), clsA = new Float32Array(n);
    const pos = g.attributes.position, rocky = mesh.userData.rocky, cls = (mat.userData && mat.userData.cls) || 0;
    clsA.fill(cls);
    for (let i = 0; i < n; i++) {
      let k = 1;
      if (rocky) { // mottled stone, one tone per facet (flat geometry is non-indexed: 3 vertices per face)
        const j = mesh.userData.flat ? i - (i % 3) : i;
        const x = pos.getX(j), y = pos.getY(j), z = pos.getZ(j);
        k = 0.62 + 0.5 * G.U.hash2(Math.floor(x * 3.1 + y * 1.7), Math.floor(z * 3.1 - y * 2.3)) * 0.5 + 0.28 * (G.U.vnoise(x * 1.3 + z * 0.7, y * 1.6) * 0.5 + 0.5);
      }
      col[i * 3] = c.r * k; col[i * 3 + 1] = c.g * k; col[i * 3 + 2] = c.b * k;
      pbr[i * 3] = mat.roughness == null ? 0.7 : mat.roughness; pbr[i * 3 + 1] = mat.metalness || 0; pbr[i * 3 + 2] = rim;
      emi[i * 3] = e.r * ei; emi[i * 3 + 1] = e.g * ei; emi[i * 3 + 2] = e.b * ei;
    }
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    g.setAttribute('aPBR', new THREE.BufferAttribute(pbr, 3));
    g.setAttribute('aEmi', new THREE.BufferAttribute(emi, 3));
    g.setAttribute('aCls', new THREE.BufferAttribute(clsA, 1));
    return g;
  }
  GFX.bake = function (root, rim) {
    const r = rim == null ? 0.32 : rim;
    const mat = characterMaterial();
    const visit = (node) => {
      const kids = node.children.slice();
      const rigid = kids.filter((c) => c.isMesh && !c.isInstancedMesh && !c.userData.keep && c.material && !Array.isArray(c.material) && !c.material.transparent && c.material.isMeshStandardMaterial);
      if (rigid.length) {
        const merged = A.mergeGeometries(rigid.map((m) => bakedGeometry(m, r)), false);
        merged.computeBoundingSphere();
        const mesh = new THREE.Mesh(merged, mat);
        mesh.castShadow = true; mesh.receiveShadow = true;
        rigid.forEach((m) => node.remove(m));
        node.add(mesh);
      }
      kids.forEach((c) => { if (!c.isMesh && c.children && c.children.length) visit(c); });
    };
    visit(root);
  };

  // ------------------------------------------------------------------
  // static batching: merge static meshes per material and 120 m sector
  // ------------------------------------------------------------------
  GFX.batchStatic = function (scene) {
    const buckets = new Map();
    const tmp = new THREE.Vector3();
    scene.children.slice().forEach((o) => {
      if (!o.isMesh || o.isInstancedMesh || !o.userData.static || !o.material || Array.isArray(o.material)) return;
      o.updateMatrixWorld(true);
      if (!o.geometry.boundingSphere) o.geometry.computeBoundingSphere();
      tmp.copy(o.geometry.boundingSphere.center).applyMatrix4(o.matrixWorld);
      const key = o.material.uuid + '|' + Math.floor(tmp.x / 240) + ',' + Math.floor(tmp.z / 240) + '|' + (o.castShadow ? 1 : 0) + (o.receiveShadow ? 1 : 0) + '|' + o.layers.mask;
      if (!buckets.has(key)) buckets.set(key, []);
      buckets.get(key).push(o);
    });
    let merged = 0;
    buckets.forEach((list) => {
      if (list.length < 2) return;
      const withColor = list.some((o) => o.geometry.getAttribute('color'));
      const geos = list.map((o) => {
        const g = o.geometry.clone();
        g.applyMatrix4(o.matrixWorld);
        Object.keys(g.attributes).forEach((k) => { if (k !== 'position' && k !== 'normal' && k !== 'uv' && !(k === 'color' && withColor)) g.deleteAttribute(k); });
        if (!g.attributes.uv) g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2));
        if (withColor && !g.attributes.color) g.setAttribute('color', new THREE.BufferAttribute(new Float32Array(g.attributes.position.count * 3).fill(1), 3));
        if (g.attributes.color && g.attributes.color.itemSize !== 3) g.deleteAttribute('color');
        if (!g.attributes.normal) g.computeVertexNormals();
        if (!g.index) { const n = g.attributes.position.count, idx = new Uint32Array(n); for (let i = 0; i < n; i++) idx[i] = i; g.setIndex(new THREE.BufferAttribute(idx, 1)); }
        return g;
      });
      const mg = A.mergeGeometries(geos, false);
      if (!mg) return;
      mg.computeBoundingSphere();
      const mesh = new THREE.Mesh(mg, list[0].material);
      mesh.castShadow = list[0].castShadow; mesh.receiveShadow = list[0].receiveShadow;
      mesh.layers.mask = list[0].layers.mask;
      if (mesh.castShadow && mg.boundingSphere.radius > 12) mesh.layers.enable(SHADOW_LAYER); // big structures shadow far away too
      list.forEach((o) => scene.remove(o));
      scene.add(mesh);
      merged += list.length;
    });
    GFX.batchedCount = merged;
  };

  // ------------------------------------------------------------------
  // post-processing. The scene is rendered ONCE per frame at a reduced internal resolution (MRT: HDR colour,
  // motion vectors, normals, emissive) and rebuilt at the display's native resolution by temporal upscaling
  // (TAAU, an FSR2-style accumulator): the image stays Retina-sharp while the GPU shades a fraction of the
  // pixels. Around it: GTAO, emissive + highlight bloom, screen-space sun shafts, contrast-adaptive
  // sharpening, underwater effects, grading and vignette. The MRT layout is the same in every tier, so a
  // quality change never invalidates the scene's shaders (no compile stutter).
  // ------------------------------------------------------------------
  GFX.TIERS = ['low', 'medium', 'high', 'ultra'];
  const TIER = {
    low: { outPR: 1, ao: false, shafts: false, bloom: 0.25, shadow: 1024, lod: 26, tuftNear: 18, tuftFar: 70, pr: [0.55, 1.0] },
    medium: { outPR: 1.5, ao: false, shafts: true, bloom: 0.25, shadow: 1536, lod: 44, tuftNear: 32, tuftFar: 110, pr: [0.75, 1.2] },
    high: { outPR: 2, ao: true, shafts: true, bloom: 0.3, shadow: 2048, lod: 62, tuftNear: 46, tuftFar: 150, pr: [0.9, 1.5] },
    ultra: { outPR: 2, ao: true, shafts: true, bloom: 0.3, shadow: [2048, 3072, 2048], lod: 84, tuftNear: 60, tuftFar: 200, pr: [1.2, 2.0] },
  };
  GFX.TIER = TIER;
  // automatic quality ladder: [tier, internal pixel ratio] from cheapest to richest
  const LADDER = [
    ['low', 0.55], ['low', 0.75], ['low', 1.0],
    ['medium', 0.85], ['medium', 1.0], ['medium', 1.15],
    ['high', 1.0], ['high', 1.15], ['high', 1.3], ['high', 1.45],
    ['ultra', 1.35], ['ultra', 1.55], ['ultra', 1.75], ['ultra', 2.0],
  ];
  GFX.internalPR = 1.15;
  GFX.uTexel = uniform(new THREE.Vector2(1 / 1920, 1 / 1080));
  GFX.uSunUV = uniform(new THREE.Vector2(0.5, 0.2));
  GFX.uSunVis = uniform(0);
  const _sz = new THREE.Vector2(), _sunP = new THREE.Vector3(), _camDir = new THREE.Vector3();

  // WebGPU: temporal upscaling (scene at internal resolution, output at the display's). WebGL 2 fallback:
  // TRAA at a single resolution (the canvas itself runs at the internal pixel ratio).
  const upscale = () => GFX.backend === 'WebGPU';
  function outPR(tier) {
    const o = Math.min(GFX.maxPixelRatio, (TIER[tier] || TIER.high).outPR);
    return upscale() ? o : Math.min(o, GFX.internalPR);
  }
  function sceneScale() { return upscale() ? Math.min(1, GFX.internalPR / GFX.pixelRatio) : 1; }

  // screen-space sun shafts: sky pixels near the sun, radially smeared toward the sun's screen position
  // (rendered at a quarter of the output resolution)
  function sunShafts(depthTex) {
    const N = 36;
    return S.Fn(() => {
      const uv0 = screenUV;
      const asp = GFX.uTexel.y.div(GFX.uTexel.x); // width / height
      const stepV = GFX.uSunUV.sub(uv0).mul(0.92 / N);
      const p = uv0.toVar(), acc = float(0).toVar(), w = float(1).toVar();
      S.Loop(N, () => {
        const inside = S.step(0, p.x).mul(S.step(p.x, 1)).mul(S.step(0, p.y)).mul(S.step(p.y, 1));
        const sky = S.step(0.99995, depthTex.sample(p).r).mul(inside);
        const dSun = length(p.sub(GFX.uSunUV).mul(vec2(asp, 1)));
        acc.addAssign(sky.mul(exp(dSun.mul(-5.5))).mul(w));
        w.mulAssign(0.95);
        p.addAssign(stepV);
      });
      return vec4(vec3(acc.mul(1 / N)), 1);
    })();
  }

  GFX.buildPipeline = function (tier) {
    const { renderer, scene, camera } = GFX;
    if (GFX.pipeline && GFX.pipeline.dispose) { try { GFX.pipeline.dispose(); } catch (e) { /* ignore */ } }
    GFX.quality = tier;
    const cfg = TIER[tier] || TIER.high;
    GFX.pixelRatio = outPR(tier);
    renderer.setPixelRatio(GFX.pixelRatio);
    GFX.resize(window.innerWidth, window.innerHeight);
    GFX.internalPR = Math.max(cfg.pr[0], Math.min(cfg.pr[1], GFX.internalPR));
    const rp = new THREE.RenderPipeline(renderer);
    const uw = GFX.uUnder, t = GFX.uTime;
    const vignette = smoothstep(float(1.05), float(0.35), length(screenUV.sub(0.5).mul(vec2(1.25, 1.0))));
    const scenePass = pass(scene, camera);
    const mrtNode = mrt({ output, velocity, normal: packNormalToRGB(normalView), emissive: vec4(emissive, output.a) });
    mrtNode.setBlendMode('emissive', new THREE.BlendMode(THREE.NormalBlending));
    scenePass.setMRT(mrtNode);
    scenePass.getTexture('normal').type = THREE.UnsignedByteType;
    scenePass.getTexture('emissive').type = THREE.UnsignedByteType;
    const scale = sceneScale();
    scenePass.setResolutionScale(scale);
    GFX.scenePass = scenePass;
    const depth = scenePass.getTextureNode('depth');
    const beauty = scenePass.getTextureNode('output');
    let upIn = beauty;
    GFX.aoPass = null; GFX.aoRTT = null;
    // WebGL 2 fallback: the proven single-resolution chain (TRAA, GTAO, emissive bloom, grading) without the
    // WebGPU-only extras (upscaling, sharpening, highlight bloom, sun shafts)
    const legacy = !upscale();
    if (legacy) {
      let b = beauty;
      if (cfg.ao) {
        const nrm = sample((u) => unpackRGBToNormal(scenePass.getTextureNode('normal').sample(u)));
        const aoPass = A.ao(depth, nrm, camera);
        aoPass.resolutionScale = 0.5; aoPass.useTemporalFiltering = true;
        aoPass.radius.value = 1.1; aoPass.thickness.value = 1.5; aoPass.scale.value = 1.1; aoPass.samples.value = 10;
        b = vec4(beauty.rgb.mul(mix(float(1), aoPass.getTextureNode().sample(screenUV).r, 0.85)), 1);
      }
      const taa = A.traa(b, depth, scenePass.getTextureNode('velocity'), camera);
      taa.useSubpixelCorrection = false;
      GFX.taau = taa;
      const wob0 = vec2(sin(screenUV.y.mul(36).add(t.mul(2.2))), cos(screenUV.x.mul(27).add(t.mul(1.8)))).mul(0.0032).mul(uw);
      let c0 = taa.getTextureNode().sample(screenUV.add(wob0)).rgb;
      c0 = c0.add(A.bloom(scenePass.getTextureNode('emissive'), 1.0, 0.45, 0.0).rgb);
      const l0 = dot(c0, vec3(0.2126, 0.7152, 0.0722));
      c0 = mix(vec3(l0), c0, 1.1);
      c0 = c0.mul(mix(vec3(0.97, 0.99, 1.03), vec3(1.03, 1.0, 0.96), smoothstep(0.05, 0.6, l0)));
      c0 = mix(c0, c0.mul(vec3(0.6, 0.9, 1.04)).add(vec3(0.0, 0.012, 0.02)), uw.mul(0.85));
      const vig0 = vignette.mul(mix(float(0.22), float(0.45), uw)).add(mix(float(0.78), float(0.55), uw));
      rp.outputNode = vec4(c0.mul(vig0), 1);
    }
    if (!legacy && cfg.ao) {
      const nrm = sample((u) => unpackRGBToNormal(scenePass.getTextureNode('normal').sample(u)));
      const aoPass = A.ao(depth, nrm, camera);
      aoPass.resolutionScale = scale * 0.5;
      aoPass.useTemporalFiltering = true;
      aoPass.radius.value = 1.1;
      aoPass.thickness.value = 1.5;
      aoPass.scale.value = 1.1;
      aoPass.samples.value = tier === 'ultra' ? 14 : 10;
      const aoV = aoPass.getTextureNode().sample(screenUV).r;
      // AO is applied before the upscaler so its temporal noise is resolved together with the image
      upIn = S.rtt(vec4(beauty.rgb.mul(mix(float(1), aoV, 0.85)), 1), null, null, { resolutionScale: scale });
      GFX.aoPass = aoPass; GFX.aoRTT = upIn;
    }
    if (!legacy) {
      const up = A.taau(upIn, depth, scenePass.getTextureNode('velocity'), camera);
      GFX.taau = up;
      const upTex = up.getTextureNode();
      // underwater: gentle refraction wobble of the resolved image
      const wob = vec2(sin(screenUV.y.mul(36).add(t.mul(2.2))), cos(screenUV.x.mul(27).add(t.mul(1.8)))).mul(0.0032).mul(uw);
      const uv0 = screenUV.add(wob);
      // contrast-adaptive sharpening (AMD CAS) on the upscaled image, in a tone-compressed space
      const tc = (c) => c.div(c.add(1));
      const cC = upTex.sample(uv0).rgb;
      const cN = tc(upTex.sample(uv0.add(vec2(0, GFX.uTexel.y.negate()))).rgb), cS = tc(upTex.sample(uv0.add(vec2(0, GFX.uTexel.y))).rgb);
      const cW = tc(upTex.sample(uv0.add(vec2(GFX.uTexel.x.negate(), 0))).rgb), cE = tc(upTex.sample(uv0.add(vec2(GFX.uTexel.x, 0))).rgb);
      const cM = tc(cC);
      const mn = min(min(min(cN, cS), min(cW, cE)), cM), mx = max(max(max(cN, cS), max(cW, cE)), cM);
      const amp = S.sqrt(clamp(min(mn, vec3(1).sub(mx)).div(max(mx, 0.0001)), 0, 1));
      const wgt = amp.mul(tier === 'low' ? -0.1 : -0.16);
      const sharp = clamp(cM.add(cN.add(cS).add(cW).add(cE).mul(wgt)).div(wgt.mul(4).add(1)), 0, 0.999);
      let col = sharp.div(vec3(1).sub(sharp));
      // bloom: emissive surfaces plus the brightest HDR highlights (sun glints, the sky around the sun)
      const hl = clamp(beauty.rgb.sub(2.2), 0, 2.5).mul(0.12);
      const bloomSrc = S.rtt(vec4(scenePass.getTextureNode('emissive').rgb.add(hl), 1), null, null, { resolutionScale: cfg.bloom });
      const bl = A.bloom(bloomSrc, tier === 'low' ? 0.7 : 0.85, 0.45, 0.0);
      bl.setResolutionScale(cfg.bloom);
      col = col.add(bl.rgb);
      // sun shafts (fade out underwater, where the slanted surface shafts below take over)
      if (cfg.shafts) {
        const sh = S.rtt(sunShafts(depth), null, null, { resolutionScale: 0.25 });
        col = col.add(color(0xffd9a0).mul(sh.sample(screenUV).r.mul(GFX.uSunVis).mul(float(1).sub(uw)).mul(1.1)));
      }
      // underwater light shafts slanting down from the surface
      const sx = screenUV.x.mul(2.4).add(screenUV.y.mul(0.55));
      const shN = texture(GFX.noiseTex, vec2(sx.add(t.mul(0.011)), t.mul(0.02))).r;
      const shaft = pow(smoothstep(0.45, 0.85, shN), 2.0).mul(smoothstep(1.0, 0.0, screenUV.y)).mul(smoothstep(24, 2, GFX.uCamDepth).mul(0.7).add(0.3));
      col = col.add(color(0xc8f4ff).mul(shaft.mul(0.22)).mul(uw));
      // grading: a touch more saturation and a cool-shadow / warm-highlight split, then the underwater tint
      const luma = dot(col, vec3(0.2126, 0.7152, 0.0722));
      col = mix(vec3(luma), col, 1.1);
      col = col.mul(mix(vec3(0.97, 0.99, 1.03), vec3(1.03, 1.0, 0.96), smoothstep(0.05, 0.6, luma)));
      col = mix(col, col.mul(vec3(0.6, 0.9, 1.04)).add(vec3(0.0, 0.012, 0.02)), uw.mul(0.85));
      const vig = vignette.mul(mix(float(0.22), float(0.45), uw)).add(mix(float(0.78), float(0.55), uw));
      rp.outputNode = vec4(col.mul(vig), 1);
    }
    GFX.pipeline = rp;
    if (GFX.sun) { const s0 = shadowSize(0); if (GFX.sun.shadow.mapSize.x !== s0) GFX.sun.shadow.mapSize.set(s0, s0); }
    GFX.csmTuned = false;
    GFX.shadowRefreshAll = 2;
    GFX.uLodNear.value = cfg.lod;
    GFX.uTuftNear.value = cfg.tuftNear;
    GFX.uTuftFar.value = cfg.tuftFar;
    GFX.aq.lastChange = performance.now();
    G.emit('qualityChanged', tier);
  };

  // internal resolution only (cheap: no shader changes)
  GFX.setInternalPR = function (pr) {
    const cfg = TIER[GFX.quality] || TIER.high;
    pr = Math.max(cfg.pr[0] * 0.8, Math.min(cfg.pr[1], pr));
    if (Math.abs(pr - GFX.internalPR) < 0.01) return false;
    GFX.internalPR = pr;
    if (!upscale()) {
      // WebGL: the whole canvas follows the internal resolution
      const o = outPR(GFX.quality);
      if (Math.abs(o - GFX.pixelRatio) > 0.01) { GFX.pixelRatio = o; GFX.renderer.setPixelRatio(o); GFX.resize(window.innerWidth, window.innerHeight); }
    }
    const s = sceneScale();
    if (GFX.scenePass) GFX.scenePass.setResolutionScale(s);
    if (GFX.aoRTT) GFX.aoRTT.setResolutionScale(s);
    if (GFX.aoPass) GFX.aoPass.resolutionScale = s * 0.5;
    GFX.aq.lastChange = performance.now();
    return true;
  };

  GFX.setQuality = function (q) {
    const A_ = GFX.aq;
    if (q === 'auto') { GFX.autoQuality = true; A_.calibrated = false; A_.samples.length = 0; return; }
    GFX.autoQuality = false;
    const cfg = TIER[q] || TIER.high;
    GFX.internalPR = (cfg.pr[0] + cfg.pr[1]) / 2;
    GFX.buildPipeline(q);
  };
  GFX.setLadder = function (i) {
    i = Math.max(0, Math.min(LADDER.length - 1, i));
    const [tier, pr] = LADDER[i];
    GFX.aq.idx = i;
    if (tier !== GFX.quality) { GFX.internalPR = pr; GFX.buildPipeline(tier); }
    else GFX.setInternalPR(pr);
  };
  function ladderIndex() {
    let best = 0, bd = 1e9;
    LADDER.forEach(([tier, pr], i) => {
      const d = (tier === GFX.quality ? 0 : 10) + Math.abs(pr - GFX.internalPR);
      if (d < bd) { bd = d; best = i; }
    });
    return best;
  }

  // ------------------------------------------------------------------
  // adaptive quality. Each frame reports its CPU time, its completion latency L (tick start -> GPU done,
  // WebGPU only) and the GPU tail (tick end -> GPU done), plus whether it missed its vsync. While the title
  // screen flies over the world the ladder is calibrated up and down; during play only the internal
  // resolution is lowered, decisively and only when the GPU is the bottleneck.
  // ------------------------------------------------------------------
  GFX.aq = { samples: [], lastChange: 0, idx: -1, calibrated: false, ceiling: 99, moves: 0 };
  GFX.frameSample = function (cpuMs, lat, tail, late, budget, calibrating) {
    const q = GFX.aq;
    if (!GFX.autoQuality) return;
    if (performance.now() - q.lastChange < (calibrating ? 900 : 2500)) { q.samples.length = 0; return; }
    q.samples.push(cpuMs, lat == null ? -1 : lat, tail == null ? -1 : tail, late ? 1 : 0);
    const N = calibrating ? 45 : 120;
    if (q.samples.length < N * 4) return;
    const cpu = [], L = [], T = []; let lates = 0;
    for (let i = 0; i < q.samples.length; i += 4) {
      cpu.push(q.samples[i]);
      if (q.samples[i + 1] >= 0) { L.push(q.samples[i + 1]); T.push(q.samples[i + 2]); }
      lates += q.samples[i + 3];
    }
    q.samples.length = 0;
    const med = (a) => { if (!a.length) return -1; a.sort((x, y) => x - y); return a[a.length >> 1]; };
    const c = med(cpu), l = med(L), t = med(T), lateRatio = lates / N, known = l >= 0;
    q.last = { cpu: c, lat: l, tail: t, late: lateRatio };
    const idx = q.idx >= 0 ? q.idx : ladderIndex();
    if (calibrating) {
      const over = (known && l > budget * 0.85 && t > budget * 0.12) || lateRatio > 0.12;
      const under = known ? (l < budget * 0.72 && t < budget * 0.22) && lateRatio < 0.03 : lateRatio === 0 && q.moves < 3;
      if (over && idx > 0) { q.ceiling = Math.min(q.ceiling, idx - 1); GFX.setLadder(idx - 1); q.moves++; }
      else if (under && idx < Math.min(LADDER.length - 1, q.ceiling)) { GFX.setLadder(idx + 1); q.moves++; }
      else q.calibrated = true;
    } else {
      const gpuBound = !known || t > budget * 0.15;
      if (gpuBound && ((known && l > budget * 0.95) || lateRatio > 0.15)) GFX.setInternalPR(GFX.internalPR * 0.88);
    }
  };

  GFX.render = function () {
    const r = GFX.renderer;
    r.getDrawingBufferSize(_sz);
    GFX.uTexel.value.set(1 / Math.max(1, _sz.x), 1 / Math.max(1, _sz.y));
    // sun position on screen for the shafts (fades out as the sun leaves the view)
    const cam = GFX.camera;
    if (cam) {
      _sunP.copy(SUN_DIR).multiplyScalar(2000).add(cam.position).project(cam);
      GFX.uSunUV.value.set(_sunP.x * 0.5 + 0.5, 0.5 - _sunP.y * 0.5);
      cam.getWorldDirection(_camDir);
      const facing = _camDir.dot(SUN_DIR);
      const off = Math.max(Math.abs(_sunP.x), Math.abs(_sunP.y));
      GFX.uSunVis.value = facing > 0 ? Math.min(1, facing * 3) * Math.max(0, Math.min(1, (1.6 - off) / 0.6)) : 0;
    }
    if (GFX.pipeline) GFX.pipeline.render();
    else r.render(GFX.scene, GFX.camera);
  };

  // ------------------------------------------------------------------
  // shader warm-up: build every pipeline the world can need before the first visible frame. The scene pass is
  // compiled asynchronously with its real MRT targets while every object is forced visible and unculled, then
  // one full frame is rendered that way so the shadow-map and post-processing pipelines exist too.
  // ------------------------------------------------------------------
  function nextFrame() {
    return new Promise((res) => {
      let done = false;
      requestAnimationFrame(() => { if (!done) { done = true; res(); } });
      setTimeout(() => {
        if (done) return;
        done = true;
        try { GFX.renderer._nodes.nodeFrame.update(); } catch (e) { /* internal API unavailable */ }
        res();
      }, 60);
    });
  }
  GFX.nextFrame = nextFrame;
  GFX.warmup = async function (frames) {
    const { renderer, scene } = GFX;
    const st = (GFX.warmupStats = { t0: performance.now() });
    const saved = [];
    // WebGL 2 fallback: GLSL programs compile far more slowly, so only what is in view is prepared up front
    const full = GFX.backend === 'WebGPU';
    if (full) scene.traverse((o) => {
      const g = o.geometry;
      saved.push(o, o.visible, o.frustumCulled, o.isInstancedMesh ? o.count : -1, g && g.isInstancedBufferGeometry ? g.instanceCount : -1);
      o.visible = true; o.frustumCulled = false;
      if (o.isInstancedMesh && o.count === 0) o.count = 1;
      if (g && g.isInstancedBufferGeometry && g.instanceCount === 0) g.instanceCount = 1;
    });
    st.objects = saved.length / 5;
    try {
      // (bounded: WebGL polls compile status once per animation frame, which a background tab throttles)
      if (GFX.scenePass && GFX.scenePass.compileAsync) await Promise.race([GFX.scenePass.compileAsync(renderer), new Promise((r) => setTimeout(r, full ? 10000 : 5000))]);
    } catch (e) { /* pipelines then build during the render below */ }
    st.compile = performance.now() - st.t0;
    for (let i = 0; i < 2; i++) {
      GFX.shadowRefreshAll = 2;
      await nextFrame();
      const t = performance.now();
      GFX.render();
      st['render' + i] = performance.now() - t;
    }
    for (let i = 0; i < saved.length; i += 5) {
      const o = saved[i];
      o.visible = saved[i + 1]; o.frustumCulled = saved[i + 2];
      if (saved[i + 3] >= 0) o.count = saved[i + 3];
      if (saved[i + 4] >= 0) o.geometry.instanceCount = saved[i + 4];
    }
    // a few normal frames so the temporal history holds a real image before anything is shown
    for (let i = 0; i < (frames || 6); i++) { await nextFrame(); GFX.render(); }
    st.total = performance.now() - st.t0;
    try { if (renderer.backend && renderer.backend.device) await renderer.backend.device.queue.onSubmittedWorkDone(); } catch (e) { /* ignore */ }
  };

  // cast / receive shadows on everything suitable
  GFX.applyShadows = function (root) {
    root.traverse((o) => {
      if (!o.isMesh || o.userData.noShadow) return;
      const mat = o.material;
      const transparent = mat && (mat.transparent || mat.isMeshBasicMaterial);
      o.receiveShadow = !mat || !mat.isMeshBasicMaterial;
      o.castShadow = !transparent && !o.userData.noShadowCast;
    });
  };
})(window.G);

// level.js — hand-placed level layout for Cragspire Mountain: every sub-area, route,
// enemy, hazard, collectible trail, secret and shortcut is defined here.
(function (G) {
  'use strict';
  const U = G.U, P = G.physics, TAU = U.TAU;
  const L = (G.level = { spawners: [] });

  L.AREAS = {
    meadow: 'Sunpetal Meadow', gorge: 'Tumbledown Gorge', plain: 'Crossroad Plain', west: 'Westwind Pasture',
    hills: 'Rattlerock Hills', lake: 'Mirrorpool Basin', vale: 'Hollow Vale', mountain: 'Cragspire Trail',
    upper: 'Knife-Edge Ridge', summit: "Crag King's Throne",
    castle: 'Brightkeep Castle', foyer: 'Brightkeep Castle · Grand Foyer', village: 'Hollyhock Village', lagoon: 'Coral Lagoon', forest: 'Whispering Woods',
    highlands: 'Skyfall Highlands', downs: 'Windmill Downs',
  };
  L.GEMS = [
    { id: 'boss', name: "Crag King's Crown" }, { id: 'sky', name: 'Sky Island Sun Gem' },
    { id: 'grotto', name: 'Sealed Grotto Sun Gem' }, { id: 'lake', name: 'Mirrorpool Pillar Sun Gem' },
    { id: 'shards', name: 'Sky Shard Sun Gem' }, { id: 'coins', name: 'Hundred Sparks Sun Gem' },
    { id: 'castle', name: 'Castle Terrace Sun Gem' }, { id: 'lagoon', name: 'Sunken Treasure Sun Gem' },
    { id: 'ruins', name: 'Woodland Ruins Sun Gem' }, { id: 'falls', name: 'Hidden Falls Sun Gem' },
  ];

  L.build = function (scene) {
    const D = G.decor, CL = G.collect, E = G.enemies, MT = G.terrain.mtn;
    const gy = (x, z) => G.terrain.heightAt(x, z);
    const stone = (a, b) => G.texMat('stone', a || 1, b || 1);
    const wood = (a, b) => G.texMat('wood', a || 1, b || 1);
    // box standing on the terrain with its top at `top`
    const block = (x, z, top, w, d, mat, yaw) => {
      const bot = Math.min(gy(x, z), top - 1) - 1.5;
      return G.solidBox(scene, x, (top + bot) / 2, z, w, top - bot, d, mat || stone(1, 2), yaw);
    };
    const pt = (t, lat) => MT.point(t, lat || 0);
    // radius on the cliff face between loop band t and the next loop where the wall reaches `top`
    const wallRadius = (t, top) => {
      const a = MT.theta0 + t, r0 = MT.rp(t) - MT.hw(t), r1 = MT.rp(t + TAU) + MT.hw(t + TAU);
      for (let r = r0; r > r1; r -= 0.2) {
        if (gy(MT.x + Math.cos(a) * r, MT.z + Math.sin(a) * r) > top - 1.6) return r + 0.9;
      }
      return r1 + 1;
    };
    const polar = (t, r) => { const a = MT.theta0 + t; return [MT.x + Math.cos(a) * r, MT.z + Math.sin(a) * r]; };

    // =========================================================
    // 1. SUNPETAL MEADOW — start area
    // =========================================================
    L.spawn = { x: 0, z: 253, face: Math.PI };
    G.sign(scene, 5.5, 250, Math.PI, "Welcome to Brightkeep! The Crag King has seized Cragspire Mountain to the north and is rolling boulders down the trail. Climb to the top and topple him! Sparks restore health. Ten Sun Gems are hidden across the land: on the castle, under the lagoon, in the woods and behind the falls.");
    G.sign(scene, 5, 190, Math.PI, "Sunpetal Meadow. Follow the trail north across the gorge to reach the mountain.");
    D.windmill(scene, 58, 190);
    D.flowers(scene, 0, 182, 48, 110);
    D.flowers(scene, -60, 150, 30, 50);
    D.forest(0, 184, 58, 20, 'round', (x, z) => Math.abs(x) < 10 && z > 170);
    D.forest(-85, 188, 22, 8, 'pine');
    D.forest(85, 162, 22, 7, 'mix');
    D.tree(-30, 182, 'round', 1.4);
    CL.ring(-30, null, 182, 3.6, 8);
    CL.line(0, 186, 0, 150, 7);
    CL.line(6, 146, 40, 150, 5);
    new E.Bumblet(-18, 170, [[-18, 170], [-32, 158], [-10, 152]]);
    new E.Bumblet(26, 168, [[26, 168], [36, 156], [16, 150]]);
    G.crate(scene, 11, 183, 1.6, 4);
    G.crate(scene, 13.2, 185.5, 1.6, 3);
    // tall rock with a shard on top (triple jump or backflip)
    block(-45, 192, gy(-45, 192) + 6.6, 4, 4, stone(2, 3));
    CL.shard(-45, gy(-45, 192) + 7.9, 192, 'meadow-rock');
    G.sign(scene, -38, 186, -0.6, "Tall rocks hide treasure. Chain three running jumps (jump again right as you land) to leap higher, or backflip: hold Shift and press Space while standing still.");
    CL.ring(-62, null, 172, 5, 10);
    D.tree(-62, 172, 'pine', 1.5);
    D.fence(scene, [[-9, 204], [-9, 178]]);
    D.fence(scene, [[9, 204], [9, 178]]);

    // =========================================================
    // 2. TUMBLEDOWN GORGE — main bridge, secret ledge, falling planks, log bridge
    // =========================================================
    const deckY = Math.max(gy(0, 97), gy(0, 139)) + 0.1;
    G.solidBox(scene, 0, deckY - 0.3, 118, 6, 0.6, 44, wood(3, 22));
    [-3.1, 3.1].forEach((x) => G.solidBox(scene, x, deckY + 0.55, 118, 0.3, 1.1, 44, wood(1, 22)));
    [106, 118, 130].forEach((z) => G.solidBox(scene, 0, (deckY - 0.6 - 19) / 2, z, 2, deckY - 0.6 + 19, 2, stone(1, 8)));
    G.sign(scene, 4.5, 142, Math.PI, "Tumbledown Gorge. The water is ice-cold, so don't fall in! Something glitters on a ledge under the bridge...");
    CL.line(0, 136, 0, 100, 6, 1.2);
    // secret ledge + climb-out steps below the bridge
    const rz = G.terrain.riverZ;
    block(12, rz(12) - 10.2, -4.5, 4, 3.5, stone(2, 1));
    CL.shard(12, -3.2, rz(12) - 10.2, 'gorge-ledge');
    block(15.8, rz(15.8) - 12.4, -1.2, 3, 3, stone(1, 1));
    block(19.4, rz(19.4) - 14.6, 2.0, 3, 3, stone(1, 1));
    CL.coin(15.8, 0, rz(15.8) - 12.4); CL.coin(19.4, 3.2, rz(19.4) - 14.6);
    // falling planks at x = 70
    const fx = 70, fz = rz(70), bankY = Math.max(gy(fx, fz + 18), gy(fx, fz - 18));
    G.sign(scene, 64, fz + 19, Math.PI, "Rickety planks! They drop soon after you land. Keep moving.");
    for (let i = 0; i < 5; i++) {
      const z = fz + 12.5 - i * 6.25;
      G.fallingPlatform(scene, fx, bankY - 0.4, z, 4, 4);
      CL.coin(fx, bankY + 1.3, z);
    }
    CL.arc([fx, bankY + 1, fz - 17], [fx, bankY + 1, fz - 25], 2, 4);
    // log bridge at x = -130
    const lz = rz(-130), logY = Math.max(gy(-130, lz - 19), gy(-130, lz + 19)) + 0.2;
    const log = new THREE.Mesh(new THREE.CylinderGeometry(0.8, 0.8, 42, 32, 12), G.texMat('wood', 3, 12, 0xb88a60));
    log.rotation.x = Math.PI / 2; log.position.set(-130, logY - 0.8, lz); log.userData.static = true; scene.add(log);
    P.addBox({ x: -130, y: logY - 0.4, z: lz, hx: 0.65, hy: 0.4, hz: 21, tag: 'log' });
    CL.line(-130, lz + 14, -130, lz - 14, 6, 1.2);
    new E.Bumblet(10, 90, [[10, 90], [22, 84], [-12, 88]]);

    // =========================================================
    // 3. CROSSROAD PLAIN — foot of the mountain
    // =========================================================
    D.arch(scene, -6, 30, Math.PI / 2, 11);
    G.checkpoint(scene, 8, 42, Math.PI, 'Mountain Foot');
    G.sign(scene, 6, 48, Math.PI, "Cragspire Trail starts here and spirals up to the summit. Watch for tumbling boulders near the top. Skilled climbers find shortcuts up the cliff faces.");
    new E.Hornbuck(-35, 62);
    new E.Hornbuck(42, 44);
    block(50, 72, gy(50, 72) + 4, 5, 5, stone(2, 2));
    new E.Pebbleshot(50, 72, { leash: 2 });
    CL.ring(50, gy(50, 72) + 5.2, 72, 1.6, 5);
    // shard shrine
    const shY = gy(-25, 90);
    G.solidBox(scene, -25, shY + 0.5, 90, 3.2, 1.6, 3.2, stone(1, 1));
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * TAU;
      const p = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.25, 1.2, 6), G.mat(0x7fd0ff, { emissive: 0x1a4a7a }));
      p.position.set(-25 + Math.cos(a) * 2.3, shY + 1.8, 90 + Math.sin(a) * 2.3); scene.add(p);
      L.shrineLights = L.shrineLights || []; L.shrineLights.push(p);
    }
    G.sign(scene, -20, 94, Math.PI, "Sky Shard Shrine. Eight Sky Shards are hidden across the land: on rocks, under bridges, inside crates and behind cliffs. Bring all eight to wake a Sun Gem here.");
    CL.gem(-25, shY + 4, 90, 'shards', 'Sky Shard Sun Gem', { hidden: true });
    CL.ring(-25, null, 90, 5, 8);
    CL.line(-3, 96, 3, 50, 8);
    G.crate(scene, 24, 80, 1.6, 3); G.crate(scene, 26.2, 82, 1.6, 3); G.crate(scene, 22, 82.6, 1.6, 3);
    D.forest(-48, 50, 22, 8, 'mix');
    D.forest(40, 100, 16, 5, 'round');
    D.rockField(scene, 28, 58, 22, 7, 0.8, 1.8);
    // cannon & sky island
    G.cannon(scene, 96, 88, { switchAt: [78, 104] });
    G.sign(scene, 88, 80, Math.PI * 0.8, "Cannon Knoll. The hatch is locked; stomp the red switch nearby to open it. Aim at the floating island in the east!");
    const isl = { x: 150, y: 41, z: 12 };
    G.solidBox(scene, isl.x, isl.y, isl.z, 21, 3, 21, G.mat(0x4f9a2c, { roughness: 0.9 }));
    const underGeo = new THREE.ConeGeometry(13, 18, 40, 10);
    { const p = underGeo.attributes.position; for (let i = 0; i < p.count; i++) { const x = p.getX(i), y = p.getY(i), z = p.getZ(i), k = 1 + U.vnoise(x * 0.3 + 5, y * 0.25 + z * 0.3) * 0.22; p.setXYZ(i, x * k, y, z * k); } underGeo.computeVertexNormals(); }
    const under = new THREE.Mesh(underGeo, D.rockMaterial());
    { const n = underGeo.attributes.position.count, c = new Float32Array(n * 3); for (let i = 0; i < n; i++) { c[i * 3] = 0.3; c[i * 3 + 1] = 0.23; c[i * 3 + 2] = 0.17; } underGeo.setAttribute('color', new THREE.BufferAttribute(c, 3)); }
    under.rotation.x = Math.PI; under.position.set(isl.x, isl.y - 9.5, isl.z); under.userData.static = true; scene.add(under);
    CL.gem(isl.x + 3, isl.y + 3.4, isl.z + 3, 'sky', 'Sky Island Sun Gem');
    CL.ring(isl.x, isl.y + 2.6, isl.z, 5.5, 10);
    CL.ring(123, 62, 52, 3, 8, true);
    // stepping platforms from Hill A up to the island (skill route)
    const hillTop = gy(140, 48);
    for (let i = 1; i <= 6; i++) {
      const f = i / 7;
      const x = U.lerp(141, 149, f) + (i % 2 ? 4 : -4), z = U.lerp(41, 25, f), top = hillTop + (isl.y + 1.5 - hillTop) * f;
      G.solidBox(scene, x, top - 0.5, z, 4, 1, 4, wood(2, 2));
      CL.coin(x, top + 1.2, z);
    }

    // =========================================================
    // 4. WESTWIND PASTURE — fenced field, mesa, push block, sealed grotto
    // =========================================================
    D.fence(scene, [[-150, 50], [-143, 50], [-135, 50], [-100, 50], [-100, 64], [-100, 76], [-100, 90], [-125, 90], [-135, 90], [-150, 90], [-150, 50]], [1, 4, 7]);
    new E.Bumblet(-125, 70, [[-140, 60], [-110, 60], [-110, 82], [-140, 82]]);
    new E.Bumblet(-112, 78, [[-108, 82], [-140, 66]]);
    CL.ring(-125, null, 70, 7, 12);
    G.crate(scene, -145, 56, 1.6, 3);
    D.flowers(scene, -125, 70, 22, 60);
    // mesa + push block
    G.pushBlock(scene, -150, 14, 3.4);
    G.sign(scene, -145, 19, Math.PI, "A heavy stone block. Walk into it to push it toward the mesa, then climb up!");
    const mesaTop = gy(-165, -20);
    G.floorSwitch(scene, -170, -26, 0xffb020, () => { L.grottoGate.open(); G.hud.toast('Far away, a gate grinds open...'); });
    new E.Pebbleshot(-158, -32, { leash: 5 });
    CL.ring(-165, mesaTop + 1.2, -20, 9, 12);
    // hidden shard behind the mesa
    D.rock(scene, -189, -16, 2.6); D.rock(scene, -195, -27, 2.8); D.rock(scene, -187, -31, 2.2);
    CL.shard(-192, gy(-192, -23) + 1.3, -23, 'mesa-back');
    new E.Bumblet(-140, -40, [[-140, -40], [-125, -55], [-142, -62]]);
    // crate with a shard among rocks
    G.crate(scene, -110, -30, 1.8, 'shard');
    D.rock(scene, -106, -26, 1.6); D.rock(scene, -114, -34, 1.9);
    D.forest(-118, 22, 30, 14, 'round', (x, z) => x > -158 && x < -142 && z > -8 && z < 24);
    D.forest(-178, 38, 16, 6, 'pine');
    // sealed grotto courtyard
    const gx = -185, gz = 75, fy = gy(gx, gz), wallMat = G.texMat('brick', 4, 2);
    G.solidBox(scene, gx, fy + 4, gz - 9, 20, 10, 1.5, wallMat);
    G.solidBox(scene, gx, fy + 4, gz + 9, 20, 10, 1.5, wallMat);
    G.solidBox(scene, gx - 9.25, fy + 4, gz, 1.5, 10, 18, wallMat);
    G.solidBox(scene, gx + 9.25, fy + 4, gz - 5.6, 1.5, 10, 6.8, wallMat);
    G.solidBox(scene, gx + 9.25, fy + 4, gz + 5.6, 1.5, 10, 6.8, wallMat);
    G.solidBox(scene, gx + 9.25, fy + 7.25, gz, 1.5, 3.5, 4.6, wallMat);
    L.grottoGate = G.gate(scene, gx + 9.25, fy + 2.75, gz, 4.4, 5.5, Math.PI / 2);
    G.spinner(scene, gx, fy, gz, 5, 1.5);
    CL.gem(gx - 6, fy + 1.8, gz, 'grotto', 'Sealed Grotto Sun Gem');
    CL.ring(gx, null, gz, 7, 10);
    G.sign(scene, gx + 13, gz + 5, -Math.PI / 2, "The Sealed Grotto. Its gate answers to a switch on the high mesa to the south.");

    // =========================================================
    // 5. RATTLEROCK HILLS — gentle hill, steep hill, spinner knoll
    // =========================================================
    G.spinner(scene, 108, gy(108, 2), 2, 4.5, 1.6);
    CL.ring(108, null, 2, 6.5, 10);
    CL.line(112, 72, 138, 52, 9);
    new E.Hornbuck(124, 86);
    new E.Pebbleshot(160, 6, { leash: 6 });
    // staircase up the steep hill to the pillar
    [22, 19, 16, 13, 10, 7, 4].forEach((d, i) => {
      const x = 175 + (i % 2 ? 1.8 : -1.8), z = -25 + d;
      block(x, z, gy(x, z) + 1.1, 3, 3, stone(1, 1));
    });
    block(175, -25, gy(175, -25) + 4, 3, 3, stone(1, 2));
    CL.shard(175, gy(175, -25) + 5.3, -25, 'hill-pillar');
    D.forest(120, 62, 28, 9, 'round', (x, z) => Math.hypot(x - 140, z - 48) < 8);
    D.forest(192, 30, 14, 6, 'pine');
    D.rockField(scene, 160, 24, 26, 9, 1, 2.4);

    // =========================================================
    // 6. MIRRORPOOL BASIN — moving platforms over the lake to the pillar
    // =========================================================
    G.sign(scene, 106, -104, -Math.PI / 2, "Mirrorpool Basin. Ride the platforms out to the tall pillar. Mind the timing!");
    // wooden jetty from the shore out to the first moving platform
    G.solidBox(scene, 109, 1.5, -112, 14, 0.5, 3.2, wood(7, 2));
    [103, 108, 113].forEach((x) => [-113.3, -110.7].forEach((z) => G.solidBox(scene, x, -8.5, z, 0.5, 19.5, 0.5, wood(1, 8))));
    CL.line(104, -112, 114, -112, 3, 1.2);
    G.movingPlatform(scene, { w: 4, h: 0.8, d: 4, fn: (t) => [127 + 9 * Math.sin(t * 0.6), 1.5, -112] });
    G.movingPlatform(scene, { w: 10, h: 0.8, d: 2.6, fn: () => [147, 3.5, -112], yawSpeed: 0.75, material: wood(5, 1) });
    G.solidBox(scene, 155.5, -7, -114, 3, 24, 3, stone(1, 6));
    G.movingPlatform(scene, { w: 4, h: 0.8, d: 4, fn: (t) => [160.5, 9.25 + 5.2 * Math.sin(t * 0.7), -116], material: G.texMat('metal', 2, 2) });
    G.solidBox(scene, 168, -3, -118, 6, 34, 6, stone(2, 10));
    CL.gem(168, 15.8, -118, 'lake', 'Mirrorpool Pillar Sun Gem');
    CL.line(118, -112, 136, -112, 5, 0); // (snapped over water below; raise them)
    CL.coins.slice(-5).forEach((c) => (c.y = 3.2));
    CL.ring(147, 6, -112, 3.2, 6);
    [6, 9, 12].forEach((y) => CL.coin(160.5, y + 3, -116));
    new E.Pebbleshot(150, -69, { leash: 4 });

    // =========================================================
    // 7. HOLLOW VALE — behind the mountain
    // =========================================================
    new E.Hornbuck(-40, -168);
    new E.Hornbuck(45, -160);
    new E.Bumblet(-8, -158, [[-8, -158], [8, -172], [-20, -178]]);
    G.spring(scene, -60, -188, 42);
    G.sign(scene, -54, -186, 0, "Spring pad! Walk onto it facing the cliff to bounce up onto the shelf.");
    const shelfY = gy(-60, -208);
    CL.shard(-60, shelfY + 1.3, -207, 'vale-shelf');
    CL.line(-90, -206, -30, -206, 8);
    // long-jump gap
    const ljTop = Math.max(gy(17, -185), gy(40, -185)) + 7;
    block(17, -185, ljTop, 10, 8, stone(3, 2));
    block(40, -185, ljTop, 10, 8, stone(3, 2));
    block(7, -185, ljTop - 3.5, 3, 3, stone(1, 1));
    CL.shard(41, ljTop + 1.3, -185, 'vale-gap');
    CL.arc([22, ljTop + 1, -185], [35, ljTop + 1, -185], 2.5, 6);
    G.sign(scene, 2, -180, Math.PI / 2, "Only a long jump clears this gap: run, hold Shift, then press Space.");
    CL.line(-80, -150, 80, -150, 12);
    D.forest(0, -176, 70, 26, 'pine', (x, z) => (x > 0 && x < 50 && z > -195 && z < -175) || Math.hypot(x + 60, z + 188) < 5);

    // =========================================================
    // 8. CRAGSPIRE TRAIL — the spiral mountain path
    // =========================================================
    // loop 0: gentle introduction
    CL.pathCoins(0.5, 1.5, 6);
    CL.pathCoins(3.0, 4.2, 6, -1.5);
    new E.Bumblet(pt(1.3).x, pt(1.3).z, [[pt(0.9).x, pt(0.9).z], [pt(1.9).x, pt(1.9).z]]);
    new E.Bumblet(pt(3.9).x, pt(3.9).z, [[pt(3.5).x, pt(3.5).z], [pt(4.5).x, pt(4.5).z]]);
    { const p = pt(2.6, 2.5); G.crate(scene, p.x, p.z, 1.6, 4); }
    // climbers' shortcut: ledges up the cliff from loop 0 to loop 1
    {
      const t = Math.PI;
      G.sign(scene, pt(t - 0.08, -2.5).x, pt(t - 0.08, -2.5).z, 0, "Climbers' shortcut: rocky ledges lead up the cliff face to the next stretch of trail.");
      for (let i = 1; i <= 6; i++) {
        const top = MT.yp(t) + 3.6 * i;
        const r = wallRadius(t + (i % 2 ? 0.04 : -0.04), top);
        const [x, z] = polar(t + (i % 2 ? 0.04 : -0.04), r);
        G.solidBox(scene, x, top - 1.5, z, 3, 3, 3, stone(1, 1));
        if (i < 6) CL.coin(x, top + 1.2, z);
        else CL.shard(x, top + 1.4, z, 'cliff-ledge');
      }
    }
    // loop 1: hazards and ranged enemies
    { const p = pt(TAU + 0.3); G.checkpoint(scene, p.x, p.z, 0, 'Trail Bend'); }
    CL.pathCoins(TAU + 0.8, TAU + 2.0, 6);
    {
      const t = TAU + 2.6, r = MT.rp(t) - MT.hw(t) - 0.8, [x, z] = polar(t, r);
      G.solidBox(scene, x, MT.yp(t) + 5.5 - 1.5, z, 3.2, 3, 3.2, stone(1, 1));
      new E.Pebbleshot(x, z, { leash: 0.5 });
    }
    { const p = pt(TAU + 4.0); G.spinner(scene, p.x, MT.yp(TAU + 4.0), p.z, 4.3, 1.3); }
    CL.pathCoins(TAU + 3.6, TAU + 4.4, 5, 3.5);
    { const p = pt(3 * Math.PI + 1.5); new E.Hornbuck(p.x, p.z); }
    { const p = pt(3 * Math.PI + 0.6, 2.5); G.crate(scene, p.x, p.z, 1.6, 3); }
    // timed blue switch: light-stairs up to loop 2
    {
      const t = TAU + 5.2, sp = pt(t, -2.2);
      const steps = [];
      for (let k = 1; k <= 7; k++) {
        const tk = t + 0.05 * k, top = MT.yp(t) + 3.4 * k;
        const r = wallRadius(tk, top);
        const [x, z] = polar(tk, r);
        steps.push([x, top - 0.5, z, 2.8, 1, 2.8]);
      }
      const tb = G.timedBlocks(scene, steps, 0x3aa0ff);
      G.floorSwitch(scene, sp.x, sp.z, 0x3aa0ff, () => tb.activate(11), { timed: 11 });
      const sg = pt(t - 0.1, -3);
      G.sign(scene, sg.x, sg.z, 0, "Blue switch: glowing stairs appear up the cliff for a few seconds. Hurry!");
    }
    CL.pathCoins(3 * Math.PI + 2.2, 3 * Math.PI + 3.0, 4);
    // loop 2: narrow ridge + boulders
    { const p = pt(2 * TAU + 0.3); G.checkpoint(scene, p.x, p.z, 0, 'High Ledges'); }
    CL.pathCoins(2 * TAU + 0.8, 2 * TAU + 1.6, 5);
    CL.pathCoins(4.55 * Math.PI, 5.0 * Math.PI, 7);
    {
      const p = pt(5.5 * Math.PI);
      new E.Bumblet(p.x, p.z, [[pt(5.3 * Math.PI).x, pt(5.3 * Math.PI).z], [pt(5.75 * Math.PI).x, pt(5.75 * Math.PI).z]]);
      const t = 5.3 * Math.PI, r = MT.rp(t) - MT.hw(t) - 0.6, [x, z] = polar(t, r);
      G.solidBox(scene, x, MT.yp(t) + 5 - 1.5, z, 3.2, 3, 3.2, stone(1, 1));
      new E.Pebbleshot(x, z, { leash: 0.5 });
    }
    CL.pathCoins(5.8 * Math.PI, 5.95 * Math.PI, 3);
    { const p = pt(MT.T - 0.35); G.checkpoint(scene, p.x, p.z, 0, 'Summit Gate'); }
    { const p = pt(MT.T - 0.5, -3); G.sign(scene, p.x, p.z, 0, "The Crag King's Throne lies ahead. His stone hide shrugs off punches and stomps, but rocks hurt him! Pick up the boulders in the arena (or the chunks he throws) with E and hurl them at him. Five hits will topple him."); }
    L.spawners.push(E.BoulderSpawner(scene, MT.T - 0.6, 2 * TAU + 0.5, 4.2));
    // the rock pile the boulders tumble out of
    [[-0.66, -3.8, 1.6], [-0.6, -4.2, 2.0], [-0.54, -3.9, 1.4], [-0.62, -2.6, 1.1]].forEach(([dt, lat, s]) => {
      const p = pt(MT.T + dt, lat); D.rock(scene, p.x, p.z, s, true, 0x8c7f72);
    });
    // summit prize (revealed when the boss falls)
    CL.gem(MT.x, MT.Hs + 2.5, MT.z, 'boss', "Crag King's Crown", { hidden: true });
    // Hundred Sparks gem: appears next to the player on collecting 100 sparks
    CL.gem(0, -50, 0, 'coins', 'Hundred Sparks Sun Gem', { hidden: true });


    // =========================================================
    // 9. BRIGHTKEEP CASTLE GROUNDS — plaza, bridge, gardens, terrace gem
    // =========================================================
    const Cs = G.terrain.castle, Fo = G.terrain.fountain;
    CL.gem(0, 24.9, 301.5, 'castle', 'Castle Terrace Sun Gem');
    CL.ring(0, 24.6, 301.5, 3.6, 8);
    CL.ring(Fo.x, Fo.level + 2.4, Fo.z, 7.4, 12);
    CL.line(0, Cs.z - Cs.rim - 1, 0, Cs.z - Cs.island + 1, 5);
    CL.line(-50, 246, -50, 262, 4); CL.line(50, 246, 50, 262, 4);
    CL.ring(0, Cs.moatY - 1.2, Cs.z - 44, 1.6, 6, true);              // a ring of sparks under the bridge
    CL.ring(-44, Cs.moatY - 1.0, Cs.z, 1.6, 6, true);
    new E.Bumblet(58, 246, [[58, 246], [70, 262], [42, 272]]);
    new E.Bumblet(-66, 250, [[-66, 250], [-72, 270], [-52, 276]]);
    G.crate(scene, 22, 232, 1.6, 4); G.crate(scene, -22, 232, 1.6, 3);
    D.forest(-92, 250, 26, 10, 'mix'); D.forest(96, 238, 24, 9, 'round');
    D.forest(84, 335, 24, 10, 'round'); D.forest(-86, 338, 22, 10, 'pine');
    D.shrubs(0, 290, 120, 70);
    D.flowers(scene, 80, 290, 22); D.flowers(scene, -70, 300, 18);

    // =========================================================
    // 10. HOLLYHOCK VILLAGE — rooftop sparks, crates, a friendly loop
    // =========================================================
    const Vg = G.terrain.village;
    (G.castle.houses || []).forEach((h) => {
      const cy = Math.cos(h.yaw), sy = Math.sin(h.yaw);
      [-0.33, 0, 0.33].forEach((f) => CL.coin(h.x + cy * f * h.w, h.ridge + 1.1, h.z - sy * f * h.w));
    });
    CL.ring(Vg.x, null, Vg.z, 6.5, 10);
    G.crate(scene, Vg.x + 9, Vg.z - 4, 1.6, 4); G.crate(scene, Vg.x - 7, Vg.z + 8, 1.6, 3);
    new E.Bumblet(Vg.x + 14, Vg.z + 16, [[Vg.x + 14, Vg.z + 16], [Vg.x - 16, Vg.z + 14], [Vg.x - 12, Vg.z - 16]]);
    new E.Hornbuck(Vg.x - 50, Vg.z - 40);
    G.checkpoint(scene, Vg.x + 16, Vg.z - 8, -Math.PI * 0.75, 'Hollyhock Village');

    // =========================================================
    // 11. WINDMILL DOWNS — rolling hills, hedgerows, a grazing charger
    // =========================================================
    CL.ring(215, null, 300, 9, 12);
    CL.line(100, 262, 190, 294, 10);
    D.hedge(scene, 150, 270, 190, 282, 1.2, 1.1); D.hedge(scene, 160, 318, 200, 330, 1.2, 1.1);
    new E.Hornbuck(170, 300);
    new E.Bumblet(250, 270, [[250, 270], [270, 300], [240, 320]]);
    D.forest(260, 230, 30, 14, 'round'); D.forest(300, 320, 30, 12, 'mix'); D.forest(140, 350, 26, 10, 'round');
    D.flowers(scene, 230, 260, 30); D.flowers(scene, 170, 330, 20);
    D.shrubs(220, 290, 90, 60);

    // =========================================================
    // 12. CORAL LAGOON — beach, dock, underwater rings, bubble vents, sunken ship & treasure chest
    // =========================================================
    const Lg = G.terrain.lagoon, WY = G.terrain.WATER_Y;
    // wooden dock from the beach out over the water
    G.solidBox(scene, 222, WY + 1.25, 24, 30, 0.5, 3.2, wood(15, 2));
    for (let x = 210; x <= 236; x += 6.5) [-1.4, 1.4].forEach((o) => {
      const g0 = gy(x, 24 + o);
      if (g0 < WY + 0.2) G.solidBox(scene, x, (WY + 1.0 + g0 - 1) / 2, 24 + o, 0.45, WY + 1.0 - g0 + 1, 0.45, wood(1, 8));
    });
    G.sign(scene, 203, 28.5, -Math.PI / 2, "Coral Lagoon. Dive with Shift, steer with the camera and rise with Space. Sparks and bubble vents give you air. They say a ship sank here with its treasure still aboard!");
    CL.line(212, 24, 234, 24, 5, 1.2);
    D.forest(192, 60, 18, 7, 'round'); D.forest(196, -20, 16, 6, 'round');
    new E.Bumblet(196, 20, [[196, 20], [190, 40], [200, 8]]);
    // islets
    CL.ring(282, null, -18, 3, 8); G.crate(scene, 282, -18, 1.6, 5);
    CL.ring(334, null, 70, 2.5, 6);
    // underwater sparks along the dive route
    [[252, -13, 22], [274, -17, 16], [298, -21, 10]].forEach(([x, y, z]) => CL.ring(x, y, z, 2.2, 8, true));
    CL.line(262, 44, 300, 58, 6, 1.2); CL.line(300, -20, 330, -40, 6, 1.2);
    G.bubbleVent(scene, 272, 12); G.bubbleVent(scene, 316, 18);
    // sunken ship
    {
      const sx = 330, sz = 5, yaw = 0.45, y0 = G.terrain.heightAt(sx, sz);
      const hullMat = G.texMat('wood', 6, 3, 0xa88458), cy = Math.cos(yaw), sy = Math.sin(yaw);
      const Lw = (lx, lz) => [sx + lx * cy + lz * sy, sz - lx * sy + lz * cy];
      const ship = new THREE.Group(); ship.position.set(sx, y0 + 2.0, sz); ship.rotation.set(0, yaw, 0.12); scene.add(ship);
      // hull: a half-pipe tapered into a pointed, rising bow and a narrower stern
      const HL = 17, HR = 4;
      const hg = new THREE.CylinderGeometry(HR, HR, HL, 48, 20, true, Math.PI / 2, Math.PI).rotateZ(Math.PI / 2).rotateX(-Math.PI / 2);
      { const p = hg.attributes.position;
        for (let i = 0; i < p.count; i++) {
          const x = p.getX(i), y = p.getY(i), z = p.getZ(i), f = x / (HL / 2);
          let w = 1;
          if (f > 0.2) w = 1 - Math.pow((f - 0.2) / 0.8, 1.5) * 0.94;
          if (f < -0.55) w = 1 - Math.pow((-f - 0.55) / 0.45, 2) * 0.32;
          const sheer = Math.max(0, f - 0.35) * 2.2 * (1 + y / HR) + Math.max(0, -f - 0.7) * 1.2 * (1 + y / HR);
          p.setXYZ(i, x, y * 0.72 * (0.55 + 0.45 * w) + sheer, z * w);
        }
        hg.computeVertexNormals();
        // faded red band along the gunwale, weathered planks below
        const col = new Float32Array(p.count * 3), cA = new THREE.Color(0xc39c6a), cB = new THREE.Color(0xb24632);
        for (let i = 0; i < p.count; i++) { const k = U.smoothstep(-0.55, -0.35, p.getY(i) - Math.max(0, p.getX(i) / (HL / 2) - 0.35) * 2.2); const c = cA.clone().lerp(cB, k); col.set([c.r, c.g, c.b], i * 3); }
        hg.setAttribute('color', new THREE.BufferAttribute(col, 3)); }
      const woodSrc = G.texMat('wood', 8, 2);
      const hull = new THREE.Mesh(hg, new THREE.MeshStandardMaterial({ map: woodSrc.map, normalMap: woodSrc.normalMap, vertexColors: true, roughness: 0.85, side: THREE.DoubleSide })); ship.add(hull);
      const transom = new THREE.Mesh(new THREE.CircleGeometry(HR * 0.68, 24, Math.PI, Math.PI).scale(1, 0.72 * 0.85, 1).rotateY(Math.PI / 2), hullMat);
      transom.position.x = -HL / 2 + 0.02; transom.material.side = THREE.DoubleSide; ship.add(transom);
      // brass portholes
      [-5, -2, 1, 4].forEach((x) => [-1, 1].forEach((sgn) => { const ph = new THREE.Mesh(new THREE.TorusGeometry(0.28, 0.07, 6, 16), G.mat(0xd8b040, { metalness: 0.8, roughness: 0.4 })); ph.position.set(x, -1.2, sgn * (HR * 0.93)); ph.rotation.y = Math.PI / 2 * 0 + (sgn > 0 ? 0 : Math.PI); ship.add(ph); }));
      for (let i = -3; i <= 3; i++) { if (i === 0 || i === 1) continue; const plank = new THREE.Mesh(G.bevelBox(0.9, 0.2, 7.2, 0.05), hullMat); plank.position.set(i * 2.2, -0.2, 0); plank.rotation.y = (Math.random() - 0.5) * 0.2; ship.add(plank); }
      // broken mast with a yard and a tattered sail swaying in the current
      const mastG = new THREE.Group(); mastG.position.set(1.5, -0.4, 0.4); mastG.rotation.z = -0.5; ship.add(mastG);
      const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.36, 11, 16), G.mat(0x6a5238, { roughness: 0.9 })); mast.position.y = 5.5; mastG.add(mast);
      const yard = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.14, 6.5, 10).rotateX(Math.PI / 2), G.mat(0x6a5238, { roughness: 0.9 })); yard.position.y = 8.6; mastG.add(yard);
      const nest = new THREE.Mesh(new THREE.CylinderGeometry(0.8, 0.65, 0.7, 16, 1, true), hullMat); nest.position.y = 10.2; mastG.add(nest);
      {
        const cv = document.createElement('canvas'); cv.width = 128; cv.height = 128;
        const c2 = cv.getContext('2d'); c2.fillStyle = '#efe4c8'; c2.fillRect(0, 0, 128, 128);
        c2.fillStyle = 'rgba(160,120,70,0.35)'; for (let i = 0; i < 6; i++) c2.fillRect(0, i * 22, 128, 3);
        c2.globalCompositeOperation = 'destination-out';
        [[30, 40, 14], [90, 70, 18], [60, 105, 12], [100, 20, 9]].forEach(([x, y, r]) => { c2.beginPath(); c2.arc(x, y, r, 0, Math.PI * 2); c2.fill(); });
        c2.beginPath(); c2.moveTo(0, 128); for (let x = 0; x <= 128; x += 8) c2.lineTo(x, 118 - Math.random() * 16); c2.lineTo(128, 128); c2.fill();
        const st = new THREE.CanvasTexture(cv); st.colorSpace = THREE.SRGBColorSpace;
        const S2 = window.TSL, sm = new THREE.MeshStandardNodeMaterial({ side: THREE.DoubleSide, roughness: 0.9, alphaTest: 0.5, transparent: false });
        sm.colorNode = S2.texture(st).rgb; sm.opacityNode = S2.texture(st).a;
        const su = S2.uv();
        sm.positionNode = S2.positionLocal.add(S2.vec3(S2.sin(G.gfx.uTime.mul(1.1).add(su.x.mul(3))).mul(0.35).mul(S2.float(1).sub(su.y)), 0, 0));
        const sail = new THREE.Mesh(new THREE.PlaneGeometry(6, 4.4, 10, 8).rotateY(Math.PI / 2), sm);
        sail.position.set(0.25, 6.3, 0); mastG.add(sail);
      }
      const cabin = new THREE.Mesh(G.bevelBox(4, 2.6, 6, 0.2), hullMat); cabin.position.set(-6, 0.9, 0); ship.add(cabin);
      [-1, 1].forEach((sgn) => { const w = new THREE.Mesh(new THREE.CircleGeometry(0.35, 12), G.mat(0x2a4a6a, { emissive: 0x0a2a4a, emissiveIntensity: 0.4 })); w.position.set(-6 + 0.8 * sgn, 1.2, 3.02); ship.add(w); });
      ship.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
      // collision: keel floor, two hull walls, cabin block
      P.addBox({ x: sx, y: y0 - 0.1, z: sz, hx: 8.2, hy: 0.6, hz: 2.6, yaw, tag: 'ship' });
      [-3.6, 3.6].forEach((o) => { const [x, z] = Lw(0, o); P.addBox({ x, y: y0 + 0.8, z, hx: 8.2, hy: 1.3, hz: 0.35, yaw, tag: 'ship' }); });
      { const [x, z] = Lw(-6, 0); P.addBox({ x, y: y0 + 1.4, z, hx: 2, hy: 1.6, hz: 3, yaw, tag: 'ship' }); }
      const [chx, chz] = Lw(3.2, 0);
      const gem = CL.gem(chx, y0 + 3.4, chz, 'lagoon', 'Sunken Treasure Sun Gem', { hidden: true });
      G.chest(scene, chx, chz, yaw + Math.PI / 2, () => { CL.revealGem('lagoon', gem.x, gem.y, gem.z); G.hud.toast('The treasure chest held a Sun Gem!'); }, y0 + 0.5);
      CL.ring(sx, y0 + 5.5, sz, 5, 10);
      new E.Puffer(sx - 12, sz + 10, y0 + 5, [[sx - 12, sz + 10], [sx + 10, sz + 14], [sx + 14, sz - 10], [sx - 8, sz - 14]]);
      new E.Puffer(275, 30, -17, [[275, 30], [292, 40], [300, 22], [282, 12]]);
    }

    // =========================================================
    // 13. WHISPERING WOODS — deep forest and the pillar ruins
    // =========================================================
    const Rn = G.terrain.ruins, rg = gy(Rn.x, Rn.z);
    D.forest(-300, 110, 60, 60, 'mix', (x, z) => Math.hypot(x - Rn.x, z - Rn.z) < 34);
    D.forest(-295, -30, 60, 50, 'pine', (x, z) => Math.hypot(x - Rn.x, z - Rn.z) < 34);
    D.forest(-300, 210, 50, 36, 'round'); D.forest(-250, -110, 45, 30, 'pine'); D.forest(-340, 20, 30, 20, 'pine', (x, z) => Math.hypot(x - Rn.x, z - Rn.z) < 34);
    D.shrubs(-300, 60, 110, 140, (x, z) => Math.hypot(x - Rn.x, z - Rn.z) < 22);
    D.flowers(scene, -262, 150, 16); D.flowers(scene, -320, -60, 14);
    {
      const colMat = G.texMat('stone', 1, 3, 0xe6dccb), capMat = G.texMat('stone', 1, 1, 0xd8cdb8);
      const column = (x, z, top, broken) => {
        const g0 = D.anchor(x, z, 1.2, 0.4), h = top - g0;
        const c = new THREE.Mesh(new THREE.CylinderGeometry(0.95, 1.1, h, 20, 1), colMat);
        c.position.set(x, g0 + h / 2, z); c.userData.static = true; scene.add(c);
        if (!broken) { const cap = new THREE.Mesh(G.bevelBox(2.5, 0.5, 2.5, 0.08), capMat); cap.position.set(x, top + 0.25, z); cap.userData.static = true; scene.add(cap); }
        P.addCyl({ x, z, r: broken ? 1.1 : 1.3, y0: g0 - 1, y1: broken ? top : top + 0.5, tag: 'column' });
        return broken ? top : top + 0.5;
      };
      // outer ring of broken columns
      for (let i = 0; i < 11; i++) {
        const a = (i / 11) * TAU + 0.2, r = 15.5;
        column(Rn.x + Math.cos(a) * r, Rn.z + Math.sin(a) * r, rg + 2.5 + ((i * 37) % 5), i % 3 === 0);
      }
      // the climb: five columns spiralling up around a tall central one
      let lastTop = 0;
      for (let k = 0; k < 5; k++) {
        const a = (k / 5) * TAU * 0.9 - 0.4, r = 5;
        lastTop = column(Rn.x + Math.cos(a) * r, Rn.z + Math.sin(a) * r, rg + 1.8 + k * 2, false);
        CL.coin(Rn.x + Math.cos(a) * r, lastTop + 1.2, Rn.z + Math.sin(a) * r);
      }
      const topC = column(Rn.x, Rn.z, rg + 12.4, false);
      CL.gem(Rn.x, topC + 1.6, Rn.z, 'ruins', 'Woodland Ruins Sun Gem');
      // crumbled walls and fallen drums
      [[0.9, 22, 9], [2.6, 21, 7], [4.4, 23, 10]].forEach(([a, r, len]) => {
        const x = Rn.x + Math.cos(a) * r, z = Rn.z + Math.sin(a) * r, yaw = a + Math.PI / 2;
        const b0 = D.anchor(x, z, len / 2, 0.5);
        G.solidBox(scene, x, b0 + 1.6, z, len, 3.2, 1.3, stone(3, 1), yaw);
        G.solidBox(scene, x + Math.cos(yaw) * 0.2, b0 + 3.6, z - Math.sin(yaw) * 0.2, len * 0.55, 1.0, 1.3, stone(2, 1), yaw);
      });
      new E.Pebbleshot(Rn.x + Math.cos(0.9) * 22, Rn.z + Math.sin(0.9) * 22, { leash: 1 });
      [[4, 18, 0.3], [-14, -8, 1.2]].forEach(([dx, dz, yaw]) => {
        const x = Rn.x + dx, z = Rn.z + dz, g0 = gy(x, z);
        const drum = new THREE.Mesh(new THREE.CylinderGeometry(1.0, 1.0, 5, 20).rotateZ(Math.PI / 2), colMat);
        drum.position.set(x, g0 + 0.7, z); drum.rotation.y = yaw; drum.userData.static = true; scene.add(drum);
        P.addBox({ x, y: g0 + 0.7, z, hx: 2.5, hy: 1, hz: 1, yaw: yaw + Math.PI / 2, tag: 'drum' });
      });
      CL.ring(Rn.x, null, Rn.z, 11, 14);
      G.sign(scene, Rn.x + 18, Rn.z - 22, -Math.PI * 0.8, "The Whispering Ruins. Hop from column to column, each a little higher, to reach the Sun Gem on the tallest one.");
      new E.Hornbuck(Rn.x + 40, Rn.z - 30);
      new E.Hornbuck(Rn.x - 20, Rn.z + 60);
      new E.Bumblet(-255, 95, [[-255, 95], [-240, 120], [-270, 130]]);
      G.checkpoint(scene, -270, 30, -Math.PI / 2, 'Whispering Woods');
      CL.line(-150, 30, -250, 30, 10);
    }

    // =========================================================
    // 14. SKYFALL HIGHLANDS — switchback ramp, highland lake, hidden falls grotto
    // =========================================================
    G.sign(scene, -106, -198, Math.PI * 0.9, "Skyfall Highlands. The old road winds up the cliff to a quiet lake that feeds a mighty waterfall.");
    CL.line(-119, -210, -127, -240, 7); CL.line(-126, -252, -108, -290, 8); CL.line(-90, -304, -10, -306, 8);
    G.checkpoint(scene, -118, -282, 0, 'Skyfall Highlands');
    CL.ring(40, G.terrain.falls.high.level + 0.5, -276, 10, 12);
    new E.Hornbuck(-40, -300);
    new E.Bumblet(10, -300, [[10, -300], [30, -310], [0, -318]]);
    new E.Bumblet(80, -290, [[80, -290], [90, -310], [66, -305]]);
    D.forest(-60, -330, 45, 22, 'pine'); D.forest(110, -310, 55, 26, 'pine'); D.forest(180, -280, 40, 18, 'mix');
    D.forest(-200, -300, 50, 22, 'pine'); D.forest(260, -330, 50, 20, 'mix');
    D.flowers(scene, 5, -298, 18); D.shrubs(20, -300, 90, 50);
    // the grotto behind the waterfall: a ledge at the cliff foot, hidden by the falling water
    {
      const W = G.water && G.water.fallsSpray, zc = W ? W.zLip + 4.2 : -242.5;
      const ledgeTop = WY + 1.7;
      G.solidBox(scene, 40, (ledgeTop + WY - 9) / 2, zc, 13, ledgeTop - WY + 9, 4.6, stone(4, 2));
      D.rock(scene, 32.5, zc + 1, 2.6, true, 0x7f766c); D.rock(scene, 47.5, zc + 1.2, 2.8, true, 0x7f766c);
      CL.gem(40, ledgeTop + 1.5, zc - 0.6, 'falls', 'Hidden Falls Sun Gem');
      CL.line(36, zc + 0.8, 44, zc + 0.8, 3, 1.1);
      G.sign(scene, 34, -214, Math.PI, "Hidden Falls. The locals say the waterfall is hiding something. Swim close and take a look!");
    }

    // =========================================================
    // 15. MIRRORPOOL — stone stairs out of the water on the east bank
    // =========================================================
    {
      const zz = -103;
      for (let i = 0; i < 40; i++) {
        const x = 176 + i * 0.72, top = WY - 0.6 + i * 0.48;
        if (top > gy(x + 0.5, zz) + 0.6 && i > 4) break;
        G.solidBox(scene, x, (top + WY - 14) / 2, zz, 0.74, top - WY + 14, 3.2, stone(1, 4));
      }
    }

    // =========================================================
    // 17. THINGS TO GRAB AND CLIMB — clay pots to throw, poles and trees to climb
    // =========================================================
    [[-22, 238], [22, 238], [-22, 247], [22, 247]].forEach(([x, z], i) => G.pot(scene, x, z, i % 2 ? 3 : 2));
    [[-12, 284], [12, 284]].forEach(([x, z]) => G.pot(scene, x, z, 3, 0xb85a30));
    G.sign(scene, 9.5, 243.5, Math.PI, "Tip: press E next to a pot, a crate or even a Bumblet to lift it, then press E (or J) to throw it. Grab tree trunks and poles with E to climb them: W/S up and down, A/D around, Space to leap off. Climb to the very top to balance and jump really high! Hold Shift to run, and press Space again in mid-air for a double jump.");
    { const Vc = G.terrain.village; for (let i = 0; i < 6; i++) { const a = 0.4 + i * 0.78, r = 17; G.pot(scene, Vc.x + Math.cos(a) * r, Vc.z + Math.sin(a) * r, 2 + (i % 3), [0xc8703a, 0xb85a30, 0xd8904a][i % 3]); } }
    { const Rc = G.terrain.ruins; [0.8, 2.4, 3.9, 5.4].forEach((a) => G.pot(scene, Rc.x + Math.cos(a) * 9.5, Rc.z + Math.sin(a) * 9.5, 3, 0x9a8a78)); }
    [[200, 36], [203, 16], [198, 48]].forEach(([x, z]) => G.pot(scene, x, z, 2, 0xd8904a));
    [[16, -298], [24, -306]].forEach(([x, z]) => G.pot(scene, x, z, 3));
    [[7, 180], [-7, 176]].forEach(([x, z]) => G.pot(scene, x, z, 2));
    const pole = (x, z, h, n) => { G.pole(scene, x, z, h); const top = G.decor.anchor(x, z, 0.3, 0.3) + h; G.collect.ring(x, top + 1.3, z, 1.7, n || 8); };
    pole(-22, 205, 9, 8);
    pole(-136, 312, 10, 8);
    pole(-278, 50, 11, 10);
    pole(188, 290, 9, 8);
    G.sign(scene, -18.5, 207.5, Math.PI * 0.75, "A climbing pole! Press E to grab it, hold W to climb, and push up at the top to balance there. Sparks wait at the top.");

    // =========================================================
    // 16. SCENERY — more woods, groves and wildflowers across the outer lands
    // =========================================================
    D.forest(300, -150, 45, 22, 'pine'); D.forest(230, -210, 40, 16, 'mix'); D.forest(320, -260, 40, 16, 'pine');
    D.forest(-230, -200, 40, 18, 'pine'); D.forest(-330, -250, 35, 14, 'pine'); D.forest(-200, 240, 40, 16, 'round');
    D.forest(-330, 300, 30, 12, 'mix'); D.forest(330, 330, 30, 10, 'round'); D.forest(240, 120, 30, 12, 'round');
    D.forest(-60, -250, 30, 10, 'pine'); D.forest(100, -200, 30, 12, 'mix');
    D.flowers(scene, 250, 150, 30); D.flowers(scene, -200, 200, 30); D.flowers(scene, -230, -160, 24); D.flowers(scene, 260, -200, 24);
    D.shrubs(0, 0, 380, 220);
    D.rockField(scene, -240, -150, 40, 10, 1.2, 2.6); D.rockField(scene, 280, -220, 40, 10, 1.2, 2.8); D.rockField(scene, 180, 180, 30, 6, 1, 2);
    D.rockField(scene, -330, 250, 30, 8, 1.2, 2.4);

    D.scatterPebbles(scene);
    D.buildTrees(scene);
    D.buildBushes(scene);
  };

  L.update = function (dt, time) {
    for (const s of L.spawners) s.update(dt);
    if (L.shrineLights) L.shrineLights.forEach((p, i) => {
      const lit = i < G.game.stats.shards;
      p.material = lit ? G.mat(0xffe066, { emissive: 0xffc21a }) : G.mat(0x7fd0ff, { emissive: 0x1a4a7a });
      p.position.y += Math.sin(time * 2 + i) * 0.003;
    });
  };
})(window.G);

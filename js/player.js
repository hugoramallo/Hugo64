// player.js — 3D platformer controller: jogging and a run button, jump chains, a mid-air double jump,
// long jump, backflip, side flip, wall kick, dive, punch/kick, ground pound, slope sliding, grabbing,
// carrying and throwing objects and enemies, climbing trees and poles (balancing on top), surface
// swimming, free 3D underwater swimming with an air meter, damage and respawn.
(function (G) {
  'use strict';
  const U = G.U, P = G.physics;
  const V3 = THREE.Vector3;

  const C = {
    RADIUS: 0.5, HEIGHT: 1.7,
    RUN: 13, JOG: 7.8, CARRY: 7.2, WALK: 5, ACCEL: 26, DECEL: 34, TURN_SLOW: 13, TURN_FAST: 7.5,
    AIRJUMP: 17, CLIMB_UP: 3.4, CLIMB_DOWN: 6.5,
    J1: 19.5, J2: 23.5, J3: 28.5, BACKFLIP: 28, SIDEFLIP: 26.5, LONG_VY: 14.5, WALLKICK: 23,
    CHAIN_WINDOW: 0.2, COYOTE: 0.1, BUFFER: 0.12,
    AIR_ACCEL: 20, AIR_CAP: 10,
    SLIDE_NY: 0.74,
    GP_VY: -50,
    MAX_HP: 8,
    SWIM_SPEED: 6.4, UW_SPEED: 8.2, FLOAT_DEPTH: 1.22, AIR_TIME: 24,
  };
  G.PLAYER = C;

  const pl = {
    pos: new V3(), vel: new V3(), face: 0, state: 'air', stateTime: 0, time: 0,
    grounded: false, groundBox: null, groundN: new V3(0, 1, 0),
    hp: C.MAX_HP, invuln: 0, chain: 0, chainTimer: 0, coyote: 0, jumpBuf: 0,
    maxY: 0, punchIdx: 0, kicked: false, wallTimer: 0, wallN: new V3(), lastSafe: new V3(),
    safeTimer: 0, flipDur: 0.6, flipAxis: 'x', flipDir: 1, slopeAlong: 0, stepSfx: 0,
    attack: null, lastJump: 0, controlLock: 0,
    air: 1, airDmgT: 1.6, waterLevel: null, submerge: -1, swimPitch: 0, strokeT: 0, bubbleT: 0,
    airJumped: false, running: false, carry: null, pickTarget: null, climbTarget: null, climbAngle: 0, climbH: 0, climbVel: 0, climbSpin: 0,
  };
  G.player = pl;

  pl.init = function (scene) {
    pl.model = G.buildPlayerModel();
    scene.add(pl.model.root);
    pl.shadow = G.fx.makeShadow(0.6);
  };

  pl.spawn = function (x, y, z, face) {
    if (pl.carry) pl.dropCarry();
    pl.climbTarget = null; pl.airJumped = false;
    pl.pos.set(x, y, z); pl.vel.set(0, 0, 0); pl.face = face || 0; pl.air = 1;
    pl.setState('air'); pl.grounded = false; pl.maxY = y; pl.chain = 0;
    pl.lastSafe.set(x, y, z);
  };

  pl.setState = function (s) {
    if (pl.state !== s) { pl.prevState = pl.state; pl.state = s; pl.stateTime = 0; }
  };

  const hspeed = () => Math.hypot(pl.vel.x, pl.vel.z);
  const faceDir = () => [Math.sin(pl.face), Math.cos(pl.face)];
  function setHorizAlongFace(s) { const f = faceDir(); pl.vel.x = f[0] * s; pl.vel.z = f[1] * s; }

  // camera-relative input -> world yaw & magnitude
  function inputWorld() {
    const inp = G.input, cy = G.camera ? G.camera.yaw : 0;
    const Fx = -Math.sin(cy), Fz = -Math.cos(cy), Rx = Math.cos(cy), Rz = -Math.sin(cy);
    const x = Fx * inp.moveY + Rx * inp.moveX, z = Fz * inp.moveY + Rz * inp.moveX;
    const mag = Math.min(1, Math.hypot(x, z));
    return { mag, yaw: Math.atan2(x, z), x, z };
  }

  // ---------- actions ----------
  function doJump(vy, state) {
    pl.vel.y = vy + Math.min(hspeed(), 16) * 0.12;
    pl.grounded = false; pl.coyote = 0; pl.jumpBuf = 0;
    pl.maxY = pl.pos.y;
    pl.setState(state || 'air');
    G.fx.dust(pl.pos.x, pl.pos.y, pl.pos.z, 4);
  }
  function startFlip(axis, dir, dur) {
    pl.flipAxis = axis; pl.flipDir = dir; pl.flipDur = dur;
    pl.setState('flip');
  }

  function groundJump(inp) {
    const s = hspeed();
    const I = G.input;
    if (pl.carry) { doJump(C.J1 * 0.9); pl.chain = 0; G.audio.sfx.jump(); return; }
    if (pl.state === 'skid' && inp.mag > 0.3) {                // side flip
      pl.face = inp.yaw; setHorizAlongFace(7.5);
      doJump(C.SIDEFLIP); pl.vel.y = C.SIDEFLIP;
      startFlip('z', Math.random() < 0.5 ? 1 : -1, 0.62);
      pl.chain = 0; G.audio.sfx.backflip(); return;
    }
    if (I.crouchHeld || pl.state === 'crouch' || pl.state === 'crouchslide') {
      if (s > 7.5) {                                            // long jump
        const ns = Math.min(s * 1.5 + 2, 27);
        setHorizAlongFace(ns);
        doJump(C.LONG_VY, 'longjump'); pl.vel.y = C.LONG_VY;
        pl.chain = 0; G.audio.sfx.longjump(); return;
      }
      // backflip
      const f = faceDir();
      pl.vel.x = -f[0] * 6.5; pl.vel.z = -f[1] * 6.5;
      doJump(C.BACKFLIP); pl.vel.y = C.BACKFLIP;
      startFlip('x', -1, 0.72);
      pl.chain = 0; G.audio.sfx.backflip(); return;
    }
    // jump chain: single -> double -> triple
    let next = 1;
    if (pl.chainTimer > 0 && s > 3) next = pl.chain + 1;
    if (next === 3 && s < 8.5) next = 2;
    if (next > 3) next = 1;
    pl.chain = next;
    if (next === 3) {
      doJump(C.J3); startFlip('x', 1, 0.62); G.audio.sfx.jump3(); pl.chain = 0;
    } else {
      doJump(next === 2 ? C.J2 : C.J1);
      (next === 2 ? G.audio.sfx.jump2 : G.audio.sfx.jump)();
    }
  }

  // ---------- grabbing, carrying, throwing ----------
  function findCarry() {
    const f = faceDir();
    let best = null, bs = -1e9;
    const consider = (h) => {
      if (!h.canPick()) return;
      const p = h.pos, dx = p.x - pl.pos.x, dz = p.z - pl.pos.z, d = Math.hypot(dx, dz);
      if (d > h.reach || p.y > pl.pos.y + 1.4 || p.y < pl.pos.y - 1.2) return;
      const front = (dx * f[0] + dz * f[1]) / (d || 1);
      if (front < 0.25 && d > 0.8) return;
      const score = front * 2 - d;
      if (score > bs) { bs = score; best = h; }
    };
    G.carryables.forEach(consider);
    G.enemies.list.forEach((e) => { if (e.alive && !e.held) consider(e.handle()); });
    return best;
  }
  pl.dropCarry = function () {
    const c = pl.carry;
    if (!c) return;
    pl.carry = null;
    const f = faceDir();
    c.drop(pl.pos.x + f[0] * 1.2, pl.pos.y, pl.pos.z + f[1] * 1.2, pl.face);
  };
  // soft aim assist: pick the Crag King or an enemy roughly in front of us
  function throwTarget(f) {
    let best = null, bs = 1e9;
    const consider = (x, y, z, w) => {
      const dx = x - pl.pos.x, dz = z - pl.pos.z, d = Math.hypot(dx, dz);
      if (d < 1.5 || d > 24 || Math.abs(y - pl.pos.y) > 9) return;
      const cos = (dx * f[0] + dz * f[1]) / d;
      if (cos < 0.76) return;
      const score = d * (2 - cos) / w;
      if (score < bs) { bs = score; best = { x, y, z, d }; }
    };
    const B = G.boss;
    if (B && B.active && B.active() && B.root.visible) consider(B.pos.x, B.pos.y + (B.state === 'stuck' ? 1.8 : 3.0), B.pos.z, 2);
    G.enemies.list.forEach((e) => { if (e.alive && !e.held && e.root.visible) consider(e.pos.x, e.pos.y + e.h * 0.5, e.pos.z, 1); });
    return best;
  }
  function throwCarry() {
    const c = pl.carry;
    if (!c) return;
    pl.carry = null;
    const f = faceDir(), hs = hspeed();
    const p = c.pos;
    p.set(pl.pos.x + f[0] * 0.9, pl.pos.y + 1.7, pl.pos.z + f[1] * 0.9);
    const vh = 13 + hs * 0.45;
    let v = new V3(f[0] * vh, 6.5 + Math.max(0, pl.vel.y * 0.3), f[1] * vh);
    const tg = throwTarget(f);
    if (tg) { // ballistic solution for the flying-object gravity (0.8 g)
      const dx = tg.x - p.x, dz = tg.z - p.z, D = Math.hypot(dx, dz), T = D / vh, g = -P.GRAVITY * 0.8;
      const vy = U.clamp((tg.y - p.y + 0.5 * g * T * T) / T, 1, 20);
      v = new V3((dx / D) * vh, vy, (dz / D) * vh);
      pl.face = Math.atan2(dx, dz);
    }
    c.throw(v);
    G.audio.sfx.throw();
  }
  function holdCarry() {
    const c = pl.carry;
    if (!c) return;
    const f = faceDir();
    let lift = 2.02;
    if (pl.state === 'pickup') lift = U.lerp(0.4, 2.02, U.clamp((pl.stateTime - 0.06) / 0.16, 0, 1));
    const fwd = pl.state === 'pickup' ? 0.6 * (1 - U.clamp(pl.stateTime / 0.22, 0, 1)) + 0.12 : 0.12;
    c.hold(pl.pos.x + f[0] * fwd, pl.pos.y + lift + (pl.model ? pl.model.pivot.position.y - 0.85 : 0), pl.pos.z + f[1] * fwd, pl.face);
  }
  // ---------- climbing trees and poles ----------
  function findClimbable() {
    const list = P.near(pl.pos.x, pl.pos.z, 3);
    let best = null, bd = 1e9;
    for (let i = 0; i < list.length; i++) {
      const c = list[i];
      if (!c.climb) continue;
      const d = Math.hypot(pl.pos.x - c.x, pl.pos.z - c.z) - c.climb.r;
      if (d > 1.25 || pl.pos.y > c.climb.top - 0.6 || pl.pos.y + 1.7 < c.climb.base) continue;
      if (d < bd) { bd = d; best = c; }
    }
    return best;
  }
  function startClimb(c) {
    if (pl.carry) pl.dropCarry();
    pl.climbTarget = c;
    pl.climbAngle = Math.atan2(pl.pos.z - c.z, pl.pos.x - c.x);
    pl.climbH = U.clamp(pl.pos.y, c.climb.base, c.climb.top - 1.6);
    pl.vel.set(0, 0, 0); pl.grounded = false; pl.groundBox = null; pl.airJumped = false; pl.chain = 0;
    pl.setState('climb');
    G.audio.sfx.grab();
  }
  const climbOffset = (c) => c.climb.r + 0.36;
  // contextual prompt shown by the HUD (refreshed a few times per second)
  let promptT = 0;
  function updatePrompt(dt) {
    promptT -= dt;
    if (promptT > 0) return;
    promptT = 0.12;
    const s = pl.state;
    let t = '';
    if (s === 'climb') t = '<kbd>W</kbd><kbd>S</kbd>Climb · <kbd>Space</kbd>Leap off · <kbd>E</kbd>Let go';
    else if (s === 'perch') t = '<kbd>Space</kbd>Big jump · <kbd>C</kbd>Climb down';
    else if (pl.carry) t = '<kbd>E</kbd>Throw';
    else if (s === 'ground' || s === 'air' || s === 'flip') {
      const h = s === 'ground' ? findCarry() : null;
      if (h) t = '<kbd>E</kbd>' + (h.isEnemy ? 'Grab' : 'Lift');
      else if (findClimbable()) t = '<kbd>E</kbd>Climb';
    }
    pl.promptText = t;
  }
  pl.isClimbing = () => pl.state === 'climb' || pl.state === 'perch';
  const STONE = /bridge|stairs|castle|floor|step|threshold|gallery|roof|house|pier|fountain|parapet|column|pot|rock/;
  pl.surface = function () {
    if (pl.submerge > -0.25 && pl.waterLevel != null) return 'water';
    const b = pl.groundBox;
    if (b) return STONE.test(b.tag || '') || !b.tag ? 'stone' : 'wood';
    const T = G.terrain;
    if (T.paving(pl.pos.x, pl.pos.z) > 0.45) return 'stone';
    const s = T.sample(pl.pos.x, pl.pos.z);
    if (s.type === 'path' || T.roadDist(pl.pos.x, pl.pos.z) < 2.6) return 'dirt';
    if (s.type === 'rock' || s.type === 'cliff' || s.type === 'summit') return 'stone';
    if (s.h < T.WATER_Y + 5) return 'sand';
    return 'grass';
  };

  // ---------- damage ----------
  pl.isSwimming = () => pl.state === 'swim' || pl.state === 'uw';
  pl.hurt = function (amount, fx, fz, power) {
    if (pl.invuln > 0 || pl.state === 'dead' || pl.state === 'win' || G.game.state !== 'play') return false;
    pl.hp = Math.max(0, pl.hp - amount);
    pl.invuln = 2.0;
    G.audio.sfx.hurt();
    G.emit('hurt', amount);
    if (pl.carry) pl.dropCarry();
    pl.climbTarget = null;
    let dx = pl.pos.x - (fx == null ? pl.pos.x - Math.sin(pl.face) : fx);
    let dz = pl.pos.z - (fz == null ? pl.pos.z - Math.cos(pl.face) : fz);
    const d = Math.hypot(dx, dz) || 1;
    const pw = power || 9;
    if (pl.isSwimming()) { // water softens the blow: pushed back but still swimming
      pl.vel.x = (dx / d) * pw * 0.6; pl.vel.z = (dz / d) * pw * 0.6;
      if (pl.hp <= 0) pl.die();
      return true;
    }
    pl.vel.x = (dx / d) * pw; pl.vel.z = (dz / d) * pw; pl.vel.y = 9;
    pl.face = Math.atan2(-dx, -dz);
    pl.grounded = false;
    pl.setState('hurt');
    if (pl.hp <= 0) pl.die();
    return true;
  };
  pl.heal = function (n) { pl.hp = Math.min(C.MAX_HP, pl.hp + n); };
  pl.die = function () {
    if (pl.carry) pl.dropCarry();
    pl.climbTarget = null;
    pl.setState('dead');
    pl.vel.set(0, 12, 0);
    G.audio.sfx.death();
    G.emit('playerDied');
  };
  // bounce after stomping an enemy
  pl.bounce = function (vy) {
    pl.vel.y = G.input.jumpHeld ? (vy || 18) * 1.25 : (vy || 18);
    pl.maxY = pl.pos.y; pl.airJumped = false;
    if (pl.state === 'gpFall' || pl.state === 'gpStart' || pl.state === 'dive' || pl.state === 'longjump') {
      pl.setState('air');
    } else if (pl.state !== 'flip') pl.setState('air');
    pl.kicked = false;
  };
  pl.launch = function (vx, vy, vz, state) {
    if (pl.carry) pl.dropCarry();
    pl.climbTarget = null;
    pl.vel.set(vx, vy, vz); pl.grounded = false; pl.maxY = pl.pos.y; pl.airJumped = false;
    if (Math.hypot(vx, vz) > 0.1) pl.face = Math.atan2(vx, vz);
    pl.setState(state || 'spring');
  };

  // Is the player's attack hitbox overlapping sphere (x,y,z,r)?
  pl.attackOverlap = function (x, y, z, r) {
    const a = pl.attack;
    if (!a) return false;
    return Math.hypot(x - a.x, y - a.y, z - a.z) < r + a.r;
  };
  pl.isStompingOn = function (topY) {
    return pl.vel.y < 0 && pl.pos.y > topY - 0.7 && !pl.grounded;
  };

  // ---------- main update ----------
  const nTmp = new V3();
  pl.update = function (dt) {
    const I = G.input;
    pl.time += dt; pl.stateTime += dt;
    if (pl.invuln > 0) pl.invuln -= dt;
    if (pl.chainTimer > 0) pl.chainTimer -= dt;
    if (pl.coyote > 0) pl.coyote -= dt;
    if (pl.wallTimer > 0) pl.wallTimer -= dt;
    if (pl.controlLock > 0) pl.controlLock -= dt;
    if (I.jump) pl.jumpBuf = C.BUFFER; else if (pl.jumpBuf > 0) pl.jumpBuf -= dt;
    pl.attack = null;

    const st = pl.state;
    if (st === 'cannon' || st === 'win') { pl.vel.set(0, 0, 0); return; }
    if (st === 'dead') {
      pl.vel.y += P.GRAVITY * 0.6 * dt; pl.pos.y += pl.vel.y * dt;
      const g = G.terrain.heightAt(pl.pos.x, pl.pos.z);
      if (pl.pos.y < g) { pl.pos.y = g; pl.vel.y = 0; }
      return;
    }

    // ride moving platforms
    if (pl.grounded && pl.groundBox) {
      const b = pl.groundBox;
      pl.pos.x += b.vx * dt; pl.pos.y += b.vy * dt; pl.pos.z += b.vz * dt;
      if (b.dyaw) {
        const dx = pl.pos.x - b.x, dz = pl.pos.z - b.z, a = b.dyaw * dt;
        const ca = Math.cos(a), sa = Math.sin(a);
        pl.pos.x = b.x + dx * ca + dz * sa; pl.pos.z = b.z - dx * sa + dz * ca;
        pl.face += b.dyaw * dt;
      }
    }

    const inp = inputWorld();
    const locked = pl.controlLock > 0;
    if (locked) inp.mag = 0;
    const onGround = pl.grounded;
    let s = hspeed();

    // --------------- water sensing ---------------
    const wl = G.terrain.waterLevelAt(pl.pos.x, pl.pos.z);
    const floorH = G.terrain.heightAt(pl.pos.x, pl.pos.z);
    const depthHere = wl === null ? 0 : wl - floorH;
    pl.waterLevel = wl;
    pl.submerge = wl === null ? -1 : wl - pl.pos.y;
    if (!pl.isSwimming() && wl !== null && depthHere > 1.35 && pl.submerge > 1.05) enterWater(wl);
    else if (pl.isSwimming() && wl === null) { pl.setState('air'); pl.grounded = false; }

    // --------------- state logic ---------------
    switch (pl.state) {
      case 'ground': {
        const n = pl.groundN;
        if (n.y < C.SLIDE_NY && !pl.groundBox) { pl.setState('slide'); break; }
        const f = faceDir();
        pl.slopeAlong = f[0] * n.x + f[1] * n.z;              // >0 when heading downhill
        pl.running = I.run && !pl.carry;
        let target = inp.mag * (pl.carry ? C.CARRY : I.run ? C.RUN : C.JOG);
        if (pl.submerge > 0.15) { // wading slows you down and kicks up spray
          target *= U.clamp(1 - pl.submerge * 0.35, 0.55, 0.9);
          if (s > 3 && Math.random() < dt * 8 && G.water) G.water.splash(pl.pos.x, pl.waterLevel, pl.pos.z, 0.15);
        }
        if (inp.mag > 0.05) {
          const diff = Math.abs(U.wrap(inp.yaw - pl.face));
          if (diff > 2.4 && s > 7) { pl.setState('skid'); G.audio.sfx.land(1); break; }
          const turn = U.lerp(C.TURN_SLOW, C.TURN_FAST, U.clamp(s / C.RUN, 0, 1));
          pl.face = U.angleStep(pl.face, inp.yaw, turn * dt);
          // turning sheds some speed (inertia)
          const align = Math.cos(U.wrap(inp.yaw - pl.face));
          const tgt = target * U.clamp(align, 0.3, 1) * (1 - pl.slopeAlong * -0.6 * (pl.slopeAlong < 0 ? 1 : 0));
          if (s < tgt) s = Math.min(tgt, s + C.ACCEL * dt * (s < 4 ? 1.6 : 1));
          else s = Math.max(tgt, s - C.DECEL * 0.5 * dt);
        } else {
          s = Math.max(0, s - C.DECEL * dt);
        }
        s += pl.slopeAlong * 16 * dt;                           // gravity along slopes
        s = U.clamp(s, 0, C.RUN * 1.35);
        setHorizAlongFace(s);
        if (pl.jumpBuf > 0 && !locked) { groundJump(inp); break; }
        if (pl.carry && (I.grab || I.punch) && !locked) { pl.setState('throw'); break; }
        if (I.grab && !locked) {
          const h = findCarry();
          if (h) { pl.pickTarget = h; pl.setState('pickup'); setHorizAlongFace(0); break; }
          const c = findClimbable();
          if (c) { startClimb(c); break; }
        }
        if (I.punch && !locked) {
          if (s > 9) { pl.setState('dive'); setHorizAlongFace(Math.min(s + 6, 25)); pl.vel.y = 8; pl.grounded = false; G.audio.sfx.dive(); }
          else { pl.setState('punch'); pl.punchIdx++; G.audio.sfx.punch(); }
          break;
        }
        if (I.crouchHeld && !locked && !pl.carry) pl.setState(s > 7.5 ? 'crouchslide' : 'crouch');
        break;
      }
      case 'pickup': {
        s = Math.max(0, s - 30 * dt); setHorizAlongFace(s);
        if (pl.pickTarget && pl.stateTime > 0.08) {
          const h = pl.pickTarget; pl.pickTarget = null;
          if (h.canPick()) { h.pick(); pl.carry = h; }
        }
        if (pl.stateTime > 0.26) pl.setState('ground');
        break;
      }
      case 'throw': {
        s = Math.max(0, s - 20 * dt); setHorizAlongFace(s);
        if (pl.carry && pl.stateTime > 0.07) throwCarry();
        if (pl.jumpBuf > 0 && pl.stateTime > 0.1) { groundJump(inp); break; }
        if (pl.stateTime > 0.24) pl.setState('ground');
        break;
      }
      case 'climb': {
        const c = pl.climbTarget;
        if (!c) { pl.setState('air'); break; }
        const cl = c.climb, up = locked ? 0 : I.moveY, side = locked ? 0 : I.moveX;
        pl.climbVel = up > 0.2 ? C.CLIMB_UP * up : up < -0.2 ? C.CLIMB_DOWN * up : 0;
        pl.climbSpin = side * 2.4;
        const rOff = climbOffset(c);
        pl.climbAngle += (pl.climbSpin / Math.max(0.5, rOff)) * dt;
        pl.climbH += pl.climbVel * dt;
        if (Math.abs(pl.climbVel) > 0.2 || Math.abs(pl.climbSpin) > 0.2) { pl.strokeT -= dt; if (pl.strokeT <= 0) { pl.strokeT = 0.3; G.audio.sfx.climb(); } }
        const topH = cl.top - 1.35;
        if (pl.climbH >= topH) {
          pl.climbH = topH;
          if (up > 0.2) { // pull up onto the top
            pl.setState('perch'); pl.pos.set(c.x, cl.top, c.z); pl.face = pl.face + Math.PI; G.audio.sfx.perch(); break;
          }
        }
        if (pl.climbH <= cl.base) {
          pl.climbH = cl.base;
          if (up < -0.2) { pl.climbTarget = null; pl.pos.y = cl.base; pl.setState('air'); pl.vel.set(Math.cos(pl.climbAngle) * 2, 0, Math.sin(pl.climbAngle) * 2); break; }
        }
        pl.pos.set(c.x + Math.cos(pl.climbAngle) * rOff, pl.climbH, c.z + Math.sin(pl.climbAngle) * rOff);
        pl.face = Math.atan2(c.x - pl.pos.x, c.z - pl.pos.z);
        pl.vel.set(0, 0, 0);
        if (pl.jumpBuf > 0 && !locked) { // spring off backwards, away from the trunk
          pl.jumpBuf = 0; pl.climbTarget = null;
          const ax = Math.cos(pl.climbAngle), az = Math.sin(pl.climbAngle);
          pl.face = Math.atan2(ax, az);
          pl.vel.set(ax * 8, 17, az * 8); pl.maxY = pl.pos.y; pl.airJumped = false;
          startFlip('x', -1, 0.55); G.audio.sfx.backflip();
          break;
        }
        if ((I.grab || I.crouch) && !locked) { // let go
          pl.climbTarget = null; pl.setState('air');
          pl.vel.set(Math.cos(pl.climbAngle) * 3, 0, Math.sin(pl.climbAngle) * 3); pl.maxY = pl.pos.y;
        }
        break;
      }
      case 'perch': { // balancing on the very top of a tree or pole
        const c = pl.climbTarget;
        if (!c) { pl.setState('air'); break; }
        pl.pos.set(c.x, c.climb.top, c.z); pl.vel.set(0, 0, 0);
        if (inp.mag > 0.2) pl.face = U.angleStep(pl.face, inp.yaw, 5 * dt);
        if (pl.jumpBuf > 0 && !locked) { // big launch from the top
          pl.jumpBuf = 0; pl.climbTarget = null;
          const f = faceDir(), fwd = inp.mag > 0.2 ? 8 : 3;
          pl.vel.set(f[0] * fwd, C.J3 * 0.92, f[1] * fwd); pl.maxY = pl.pos.y; pl.airJumped = false;
          startFlip('x', 1, 0.62); G.audio.sfx.jump3();
          break;
        }
        if ((I.crouch || I.grab) && !locked) { // climb back down
          pl.setState('climb'); pl.climbH = c.climb.top - 1.4; pl.climbAngle = Math.atan2(-Math.cos(pl.face), -Math.sin(pl.face));
        }
        break;
      }
      case 'crouch': {
        const t = inp.mag * 3;
        if (inp.mag > 0.05) pl.face = U.angleStep(pl.face, inp.yaw, 6 * dt);
        s = U.damp(s, t, 10, dt);
        setHorizAlongFace(s);
        if (pl.jumpBuf > 0) { groundJump(inp); break; }
        if (!I.crouchHeld) pl.setState('ground');
        break;
      }
      case 'crouchslide': {
        s = Math.max(0, s - 12 * dt);
        setHorizAlongFace(s);
        if (pl.jumpBuf > 0) { groundJump(inp); break; }
        if (s < 3) pl.setState(I.crouchHeld ? 'crouch' : 'ground');
        break;
      }
      case 'skid': {
        s = Math.max(0, s - 42 * dt);
        setHorizAlongFace(s);
        if (pl.stateTime % 0.08 < dt) G.fx.dust(pl.pos.x, pl.pos.y, pl.pos.z, 1);
        if (pl.jumpBuf > 0) { groundJump(inp); break; }
        if (s < 1 || pl.stateTime > 0.45) { if (inp.mag > 0.1) pl.face = inp.yaw; pl.setState('ground'); }
        break;
      }
      case 'punch': {
        s = Math.max(0, s - 30 * dt); setHorizAlongFace(s);
        const f = faceDir();
        if (pl.stateTime > 0.04 && pl.stateTime < 0.2) pl.attack = { x: pl.pos.x + f[0] * 1.1, y: pl.pos.y + 0.9, z: pl.pos.z + f[1] * 1.1, r: 0.9, power: 1, kind: 'punch' };
        if (pl.jumpBuf > 0 && pl.stateTime > 0.1) { groundJump(inp); break; }
        if (I.punch && pl.stateTime > 0.14) { pl.setState('punch'); pl.punchIdx++; G.audio.sfx.punch(); break; }
        if (pl.stateTime > 0.3) pl.setState('ground');
        break;
      }
      case 'bellyslide': {
        s = Math.max(0, s - 16 * dt); setHorizAlongFace(s);
        const f = faceDir();
        if (s > 4) pl.attack = { x: pl.pos.x + f[0] * 0.8, y: pl.pos.y + 0.4, z: pl.pos.z + f[1] * 0.8, r: 1.0, power: 1, kind: 'dive' };
        if ((pl.jumpBuf > 0 || I.punch) && pl.stateTime > 0.12) { doJump(14); setHorizAlongFace(Math.max(s, 6)); G.audio.sfx.jump(); pl.chain = 0; break; }
        if (s < 0.5 && pl.stateTime > 0.4) pl.setState('ground');
        break;
      }
      case 'slide': {
        const n = pl.groundN;
        const dh = Math.hypot(n.x, n.z) || 1;
        const acc = 42 * Math.sqrt(Math.max(0, 1 - n.y * n.y));
        pl.vel.x += (n.x / dh) * acc * dt + inp.x * 8 * dt;
        pl.vel.z += (n.z / dh) * acc * dt + inp.z * 8 * dt;
        const f = Math.exp(-(n.y > 0.85 ? 3.5 : 0.4) * dt);
        pl.vel.x *= f; pl.vel.z *= f;
        s = hspeed();
        if (s > 0.5) pl.face = U.angleDamp(pl.face, Math.atan2(pl.vel.x, pl.vel.z), 8, dt);
        if (s > 3 && pl.stateTime % 0.1 < dt) G.fx.dust(pl.pos.x, pl.pos.y, pl.pos.z, 1);
        if (pl.jumpBuf > 0 && n.y > 0.55) { doJump(15); G.audio.sfx.jump(); pl.chain = 0; break; }
        if (n.y > C.SLIDE_NY + 0.04 && s < 4) pl.setState('ground');
        break;
      }
      case 'gpLand': case 'hardland': {
        pl.vel.x = 0; pl.vel.z = 0;
        const dur = pl.state === 'gpLand' ? 0.32 : (pl.hardDur || 0.4);
        if (pl.state === 'gpLand' && pl.jumpBuf > 0 && pl.stateTime > 0.1) { doJump(C.J2); G.audio.sfx.jump2(); break; }
        if (pl.stateTime > dur) pl.setState('ground');
        break;
      }
      // ---------------- airborne states ----------------
      case 'air': case 'flip': case 'longjump': case 'spring': case 'shot': case 'dive': case 'kick': case 'hurt': case 'bonk': {
        const state = pl.state;
        if (state === 'flip' && pl.stateTime > pl.flipDur) pl.setState('air');
        if (state === 'kick' && pl.stateTime > 0.32) pl.setState('air');
        if (state === 'hurt' && pl.stateTime > 0.55 && !pl.grounded) { /* keep flying back */ }
        // air control
        const ctrl = state === 'hurt' || state === 'bonk' || state === 'shot' ? 0 : state === 'longjump' ? 7 : state === 'dive' ? 5 : C.AIR_ACCEL;
        if (inp.mag > 0.05 && ctrl > 0) {
          const before = hspeed();
          pl.vel.x += inp.x * ctrl * dt; pl.vel.z += inp.z * ctrl * dt;
          const after = hspeed(), cap = Math.max(C.AIR_CAP, before);
          if (after > cap) { pl.vel.x *= cap / after; pl.vel.z *= cap / after; }
          if (state === 'air' || state === 'spring') pl.face = U.angleStep(pl.face, inp.yaw, 3 * dt);
        }
        if (state === 'air' && hspeed() > C.AIR_CAP) { // gentle air drag above the cap
          const k = Math.exp(-0.4 * dt); pl.vel.x *= k; pl.vel.z *= k;
        }
        // gravity (lighter while holding jump and rising)
        let gm = 1;
        if (pl.vel.y > 0 && !I.jumpHeld && (state === 'air') && pl.prevState !== 'spring') gm = 2.2;
        if (state === 'longjump' && pl.vel.y > 0) gm = 0.62;
        if (state === 'shot') gm = 0.55;
        if (pl.vel.y < 0) gm *= 1.12;
        pl.vel.y += P.GRAVITY * gm * dt;
        if (pl.vel.y < -48) pl.vel.y = -48;
        if (locked) break;
        // coyote jump (walked off a ledge)
        if (pl.jumpBuf > 0 && pl.coyote > 0 && state === 'air') { pl.coyote = 0; groundJump(inp); break; }
        // wall kick
        if (pl.jumpBuf > 0 && pl.wallTimer > 0 && state !== 'hurt' && state !== 'bonk') {
          pl.face = Math.atan2(pl.wallN.x, pl.wallN.z);
          setHorizAlongFace(11);
          pl.vel.y = C.WALLKICK; pl.maxY = pl.pos.y; pl.wallTimer = 0; pl.jumpBuf = 0; pl.airJumped = false;
          startFlip('x', 1, 0.5);
          G.audio.sfx.wallkick();
          G.fx.dust(pl.pos.x, pl.pos.y + 0.8, pl.pos.z, 5);
          break;
        }
        // grab a trunk or pole in mid-air (tap E, or hold it while jumping at one)
        if ((I.grab || I.grabHeld) && !pl.carry && state !== 'hurt' && state !== 'bonk') {
          const c = findClimbable();
          if (c && (I.grab || Math.hypot(pl.pos.x - c.x, pl.pos.z - c.z) < c.climb.r + 0.8)) { startClimb(c); break; }
        }
        // throw what we carry while airborne
        if (pl.carry && (I.grab || I.punch)) { throwCarry(); break; }
        // mid-air double jump (a fresh press, once per airtime; near the ground the press is kept for a chain jump)
        if (I.jump && !pl.airJumped && !pl.carry && (state === 'air' || state === 'spring' || state === 'kick' || (state === 'flip' && pl.stateTime > 0.25))) {
          const gH = P.ground(pl.pos.x, pl.pos.z, pl.pos.y, 0.1, 0).h;
          if (pl.pos.y - gH > 1.1 || pl.vel.y > 2) {
            pl.airJumped = true; pl.jumpBuf = 0; pl.chain = 0;
            if (inp.mag > 0.2) { pl.face = inp.yaw; setHorizAlongFace(Math.min(Math.max(hspeed(), 7 * inp.mag), 12)); }
            pl.vel.y = C.AIRJUMP; pl.maxY = pl.pos.y;
            startFlip('x', 1, 0.45);
            G.audio.sfx.airJump();
            G.fx.ring(pl.pos.x, pl.pos.y - 0.1, pl.pos.z, 1.6, 0.35, 0xffffff);
            G.fx.burst(pl.pos.x, pl.pos.y, pl.pos.z, 6, 0xffffff, 3, 0.18, 0.4, 2);
            break;
          }
        }
        // ground pound
        if (I.crouch && state !== 'hurt' && state !== 'bonk' && state !== 'shot') {
          pl.setState('gpStart'); pl.vel.set(0, 0, 0); G.audio.sfx.gpSpin(); break;
        }
        // jump kick / air dive
        if (I.punch && !pl.carry && (state === 'air' || state === 'flip' || state === 'spring')) {
          if (hspeed() > 12) { pl.setState('dive'); setHorizAlongFace(Math.min(hspeed() + 4, 25)); if (pl.vel.y < 4) pl.vel.y = 4; G.audio.sfx.dive(); }
          else if (!pl.kicked) { pl.setState('kick'); pl.kicked = true; if (pl.vel.y < 6) pl.vel.y = 6; G.audio.sfx.punch(); }
        }
        if (pl.state === 'kick' && pl.stateTime > 0.03 && pl.stateTime < 0.26) {
          const f = faceDir();
          pl.attack = { x: pl.pos.x + f[0] * 0.9, y: pl.pos.y + 0.5, z: pl.pos.z + f[1] * 0.9, r: 1.0, power: 1, kind: 'kick' };
        }
        if (pl.state === 'dive') {
          const f = faceDir();
          pl.attack = { x: pl.pos.x + f[0] * 0.9, y: pl.pos.y + 0.6, z: pl.pos.z + f[1] * 0.9, r: 1.0, power: 1, kind: 'dive' };
        }
        break;
      }
      case 'swim': { // floating at the surface
        const target = wl - C.FLOAT_DEPTH + Math.sin(pl.time * 2.2) * 0.05;
        pl.vel.y += ((target - pl.pos.y) * 26 - pl.vel.y * 7.5) * dt;
        swimMove(inp, C.SWIM_SPEED, dt);
        if (inp.mag > 0.2) { pl.strokeT -= dt; if (pl.strokeT <= 0) { pl.strokeT = 0.62; G.audio.sfx.swim(); G.water && G.water.ripple(pl.pos.x, wl, pl.pos.z, 1.6); } }
        else if (Math.random() < dt * 0.8) G.water && G.water.ripple(pl.pos.x, wl, pl.pos.z, 1.1);
        if (pl.jumpBuf > 0 && !locked) { // spring out of the water
          pl.jumpBuf = 0; pl.vel.y = 15.5; pl.grounded = false; pl.maxY = pl.pos.y;
          pl.setState('air'); G.audio.sfx.jump();
          G.water && G.water.splash(pl.pos.x, wl, pl.pos.z, 0.6);
          break;
        }
        if ((I.crouch || (I.crouchHeld && pl.stateTime > 0.25)) && !locked) {
          pl.setState('uw'); pl.vel.y = -5.5; G.audio.sfx.diveIn();
          G.water && G.water.splash(pl.pos.x, wl, pl.pos.z, 0.4);
        }
        break;
      }
      case 'uw': { // free 3D swimming underwater
        const cp = G.camera ? G.camera.pitch : 0.3;
        let dy = 0;
        if (inp.mag > 0.05 && I.moveY > 0.2) dy -= Math.sin(cp) * 0.9 * I.moveY;   // swim where the camera looks
        if (I.jumpHeld && !locked) dy += 1;
        if (I.crouchHeld && !locked) dy -= 1;
        let tx = inp.x, tz = inp.z;
        const len = Math.hypot(tx, dy, tz);
        if (len > 1) { tx /= len; dy /= len; tz /= len; }
        if (len > 0.05) {
          const k = 1 - Math.exp(-3.2 * dt);
          pl.vel.x += (tx * C.UW_SPEED - pl.vel.x) * k;
          pl.vel.z += (tz * C.UW_SPEED - pl.vel.z) * k;
          pl.vel.y += (dy * C.UW_SPEED * 0.85 - pl.vel.y) * k;
          pl.strokeT -= dt;
          if (pl.strokeT <= 0) { pl.strokeT = 0.55; G.audio.sfx.swimUnder(); }
        } else {
          const f = Math.exp(-1.6 * dt);
          pl.vel.x *= f; pl.vel.z *= f;
          pl.vel.y = pl.vel.y * f + 0.9 * dt;               // gentle buoyancy
        }
        const hs2 = hspeed();
        if (hs2 > 0.4) pl.face = U.angleDamp(pl.face, Math.atan2(pl.vel.x, pl.vel.z), 6, dt);
        pl.swimPitch = U.damp(pl.swimPitch, Math.atan2(pl.vel.y, Math.max(0.5, hs2)), 6, dt);
        pl.bubbleT -= dt;
        if (pl.bubbleT <= 0) { pl.bubbleT = 0.45 + Math.random() * 0.5; G.water && G.water.bubbles(pl.pos.x, pl.pos.y + 1.4, pl.pos.z, 2 + Math.floor(Math.random() * 3)); }
        if (pl.pos.y > wl - C.FLOAT_DEPTH - 0.05 && pl.vel.y > -0.5) { pl.setState('swim'); pl.vel.y *= 0.3; G.audio.sfx.surface(); }
        break;
      }
      case 'gpStart': {
        pl.vel.set(0, 0, 0);
        if (pl.stateTime > 0.26) { pl.setState('gpFall'); pl.vel.y = C.GP_VY; }
        break;
      }
      case 'gpFall': {
        pl.vel.x = 0; pl.vel.z = 0; pl.vel.y = C.GP_VY;
        pl.attack = { x: pl.pos.x, y: pl.pos.y, z: pl.pos.z, r: 0.9, power: 2, kind: 'pound' };
        break;
      }
    }

    if (pl.isClimbing()) { pl.maxY = pl.pos.y; pl.air = Math.min(1, pl.air + dt * 0.55); updatePrompt(dt); return; }

    // --------------- integrate ---------------
    const airborne = !pl.grounded;
    const dx = pl.vel.x * dt, dz = pl.vel.z * dt;
    // swimmers glide up gentle underwater slopes (beaches); steep banks still block them
    const blocked = P.moveHoriz(pl.pos, dx, dz, pl.isSwimming() ? 1.2 : pl.grounded ? 1.1 : 0.25);
    let wallHit = false;
    if (blocked) {
      const tn = G.terrain.normalAt(pl.pos.x + dx * 2, pl.pos.z + dz * 2, nTmp);
      const l = Math.hypot(tn.x, tn.z) || 1;
      pl.wallN.set(tn.x / l, 0, tn.z / l);
      wallHit = true;
      if (blocked === true) { // fully blocked: remove the into-wall component
        const into = pl.vel.x * pl.wallN.x + pl.vel.z * pl.wallN.z;
        if (into < 0) { pl.vel.x -= pl.wallN.x * into; pl.vel.z -= pl.wallN.z * into; }
      }
    }
    const hitObj = P.resolveWalls(pl.pos, C.RADIUS, C.HEIGHT, pl.grounded ? 0.55 : Math.max(0.2, -pl.vel.y * dt + 0.25));
    if (hitObj) {
      pl.wallN.copy(P.wallN); wallHit = true;
      const into = pl.vel.x * pl.wallN.x + pl.vel.z * pl.wallN.z;
      if (into < 0 && airborne) { pl.vel.x -= pl.wallN.x * into * 0.9; pl.vel.z -= pl.wallN.z * into * 0.9; }
      if (hitObj.onPush && pl.grounded) hitObj.onPush(pl, dt);
    }
    if (wallHit && airborne) {
      const sp = Math.hypot(dx, dz) / dt;
      if ((pl.state === 'longjump' || pl.state === 'dive' || pl.state === 'shot') && sp > 12) {
        pl.setState('bonk'); pl.vel.x = pl.wallN.x * 5; pl.vel.z = pl.wallN.z * 5; G.audio.sfx.bonk();
        G.fx.sparkle(pl.pos.x, pl.pos.y + 1, pl.pos.z, 0xffffff);
      } else if (pl.state !== 'hurt' && pl.state !== 'bonk') pl.wallTimer = 0.16;
    }

    pl.pos.y += pl.vel.y * dt;
    // ceilings
    if (pl.vel.y > 0) {
      const c = P.ceiling(pl.pos.x, pl.pos.z, pl.pos.y + C.HEIGHT, C.RADIUS);
      if (pl.pos.y + C.HEIGHT > c) { pl.pos.y = c - C.HEIGHT; pl.vel.y = 0; G.audio.sfx.bonk(); }
    }

    // --------------- ground ---------------
    const g = P.ground(pl.pos.x, pl.pos.z, pl.pos.y, pl.grounded ? 1.1 : Math.max(0.35, -pl.vel.y * dt + 0.25), 0.15);
    const gh = g.h, gn = g.n;
    if (pl.isSwimming()) {
      pl.grounded = false; pl.groundBox = null;
      if (pl.pos.y < gh) { pl.pos.y = gh; if (pl.vel.y < 0) pl.vel.y = 0; }
      const wl2 = G.terrain.waterLevelAt(pl.pos.x, pl.pos.z);
      if (wl2 === null || wl2 - gh < 1.15) { // waded out into the shallows
        pl.pos.y = Math.max(pl.pos.y, gh);
        if (pl.pos.y - gh < 0.6) { pl.grounded = true; pl.groundBox = g.box; pl.groundN.copy(gn); pl.vel.y = 0; pl.setState('ground'); }
        else pl.setState('air');
      }
      pl.maxY = pl.pos.y;
    } else if (pl.grounded) {
      const snap = 0.5 + hspeed() * dt * 1.6;
      if (pl.vel.y <= 0 && pl.pos.y - gh <= snap) {
        pl.pos.y = gh; pl.vel.y = 0;
        pl.groundBox = g.box; pl.groundN.copy(gn);
      } else if (pl.vel.y <= 0) { // walked off a ledge
        pl.grounded = false; pl.groundBox = null; pl.coyote = C.COYOTE; pl.maxY = pl.pos.y;
        if (['ground', 'skid', 'crouch', 'crouchslide', 'punch', 'gpLand', 'hardland', 'pickup', 'throw'].includes(pl.state)) pl.setState('air');
        if (pl.state === 'slide' || pl.state === 'bellyslide') pl.setState('air');
      }
    } else {
      pl.maxY = Math.max(pl.maxY, pl.pos.y);
      if (pl.pos.y <= gh) {
        if (pl.vel.y <= 0) land(g);
        else pl.pos.y = gh; // jumped into a rising slope
      }
    }
    if (pl.grounded && !['ground', 'crouch', 'crouchslide', 'skid', 'punch', 'bellyslide', 'slide', 'gpLand', 'hardland', 'pickup', 'throw'].includes(pl.state)) {
      // e.g. state changed to airborne this frame but still touching: let the jump take effect
      if (pl.vel.y > 0) { pl.grounded = false; pl.groundBox = null; }
    }

    // --------------- hazards / bookkeeping ---------------
    // air meter: drains while the head is underwater, refills at the surface
    const wlNow = G.terrain.waterLevelAt(pl.pos.x, pl.pos.z);
    if (pl.state === 'uw' && wlNow !== null && pl.pos.y + 1.55 < wlNow) {
      pl.air = Math.max(0, pl.air - dt / C.AIR_TIME);
      if (pl.air <= 0) {
        pl.airDmgT -= dt;
        if (pl.airDmgT <= 0) {
          pl.airDmgT = 1.6; pl.hp = Math.max(0, pl.hp - 1);
          G.audio.sfx.hurt(); G.emit('hurt', 1);
          if (pl.hp <= 0) { pl.die(); return; }
        }
      }
    } else { pl.air = Math.min(1, pl.air + dt * 0.55); pl.airDmgT = 1.6; }
    if (pl.pos.y < -60) { // fell out of the world
      pl.hp = Math.max(0, pl.hp - 2); G.emit('hurt', 2);
      pl.spawn(pl.lastSafe.x, pl.lastSafe.y + 0.5, pl.lastSafe.z, pl.face); pl.invuln = 2;
      if (pl.hp <= 0) pl.die();
      return;
    }
    const B = 392;
    pl.pos.x = U.clamp(pl.pos.x, -B, B); pl.pos.z = U.clamp(pl.pos.z, -B, B);

    if (pl.grounded && pl.state === 'ground' && !pl.groundBox && pl.groundN.y > 0.85 && pl.submerge < 0) {
      pl.safeTimer += dt;
      if (pl.safeTimer > 0.4) { pl.lastSafe.copy(pl.pos); pl.safeTimer = 0; }
    }
    holdCarry();
    updatePrompt(dt);
  };

  function land(g) {
    const fall = pl.maxY - g.h;
    const prev = pl.state;
    pl.pos.y = g.h;
    pl.grounded = true; pl.groundBox = g.box; pl.groundN.copy(g.n);
    pl.kicked = false; pl.airJumped = false;
    const vy = pl.vel.y;
    pl.vel.y = 0;
    pl.model.squash = U.clamp(-vy / 40, 0.15, 0.7);
    G.emit('playerLand', prev, fall);
    if (prev === 'gpFall') {
      pl.setState('gpLand');
      G.audio.sfx.groundpound();
      G.fx.ring(pl.pos.x, pl.pos.y, pl.pos.z, 3.5, 0.35, 0xfff4c0);
      G.fx.dust(pl.pos.x, pl.pos.y, pl.pos.z, 10);
      G.emit('groundpound', pl.pos.x, pl.pos.z);
      G.camera && G.camera.shake(0.25);
      return;
    }
    if (prev === 'dive') { pl.setState('bellyslide'); G.audio.sfx.land(2); G.fx.dust(pl.pos.x, pl.pos.y, pl.pos.z, 6); return; }
    if (fall > 30 && prev !== 'shot' && prev !== 'spring') {
      pl.hardDur = 0.9; pl.setState('hardland');
      G.audio.sfx.land(10); G.camera && G.camera.shake(0.3);
      pl.hurtFall = true;
      if (pl.invuln <= 0) { pl.hp = Math.max(0, pl.hp - 3); pl.invuln = 1.2; G.audio.sfx.hurt(); G.emit('hurt', 3); if (pl.hp <= 0) pl.die(); }
      return;
    }
    G.audio.sfx.land(Math.min(8, fall * 0.4));
    if (fall > 6) G.fx.dust(pl.pos.x, pl.pos.y, pl.pos.z, 6);
    if (g.n.y < C.SLIDE_NY && !g.box) { pl.setState('slide'); return; }
    if (fall > 18 && prev !== 'shot' && prev !== 'spring' && prev !== 'hurt') { pl.hardDur = 0.35; pl.setState('hardland'); return; }
    if (prev === 'hurt' || prev === 'bonk') { pl.hardDur = 0.35; pl.setState('hardland'); return; }
    if (prev === 'longjump') {
      const s = Math.min(hspeed(), C.RUN + 3); setHorizAlongFace(s);
      pl.setState(G.input.crouchHeld ? 'crouchslide' : 'ground');
      pl.chain = 0; return;
    }
    if (prev === 'shot') { setHorizAlongFace(Math.min(hspeed(), 10)); pl.setState('ground'); return; }
    // jump chain window
    if (prev === 'air' && pl.chain > 0) pl.chainTimer = C.CHAIN_WINDOW; else pl.chain = 0;
    const s = hspeed();
    if (s > 0.1) setHorizAlongFace(Math.min(s, C.RUN * 1.2));
    pl.setState('ground');
  }

  pl.render = function (dt) {
    const M = pl.model;
    M.root.position.copy(pl.pos);
    M.root.rotation.y = pl.face;
    G.animatePlayer(M, pl, dt);
    G.fx.placeShadow(pl.shadow, pl.pos.x, pl.pos.y, pl.pos.z, 0.65);
    pl.shadow.visible = pl.state !== 'cannon' && !pl.isSwimming();
  };

  // ---------- swimming helpers ----------
  function enterWater(wl) {
    if (pl.carry) pl.dropCarry();
    pl.airJumped = false;
    const impact = -pl.vel.y;
    if (impact > 5) {
      G.audio.sfx.splash();
      G.water && G.water.splash(pl.pos.x, wl, pl.pos.z, U.clamp(impact / 20, 0.4, 1.4));
    }
    pl.grounded = false; pl.groundBox = null; pl.maxY = pl.pos.y; pl.chain = 0;
    pl.vel.x *= 0.55; pl.vel.z *= 0.55;
    if (impact > 16 || pl.state === 'gpFall' || pl.state === 'gpStart' || pl.state === 'dive') {
      pl.setState('uw'); pl.vel.y = -Math.min(impact * 0.35, 9);
    } else { pl.setState('swim'); pl.vel.y *= 0.2; }
  }
  function swimMove(inp, max, dt) {
    const tx = inp.x * max, tz = inp.z * max;
    const k = 1 - Math.exp(-(inp.mag > 0.05 ? 3.0 : 1.8) * dt);
    pl.vel.x += (tx - pl.vel.x) * k; pl.vel.z += (tz - pl.vel.z) * k;
    if (inp.mag > 0.05) pl.face = U.angleStep(pl.face, inp.yaw, 5 * dt);
  }
})(window.G);

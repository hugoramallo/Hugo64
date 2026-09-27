// enemy_base.js — shared enemy class: state machine plumbing, perception (distance + line of sight),
// ledge avoidance, physics, stomp/attack/touch resolution, death, plus projectiles.
(function (G) {
  'use strict';
  const U = G.U, P = G.physics;
  const V3 = THREE.Vector3;
  const E = (G.enemies = { list: [], projectiles: [], scene: null });

  function iconTex(txt, color) {
    const c = document.createElement('canvas'); c.width = c.height = 64;
    const x = c.getContext('2d');
    x.font = 'bold 54px sans-serif'; x.textAlign = 'center'; x.textBaseline = 'middle';
    x.lineWidth = 8; x.strokeStyle = '#000'; x.strokeText(txt, 32, 36);
    x.fillStyle = color; x.fillText(txt, 32, 36);
    return new THREE.CanvasTexture(c);
  }
  E.init = function (scene) {
    E.scene = scene;
    E.alertMat = new THREE.SpriteMaterial({ map: iconTex('!', '#ffe14a'), depthTest: false });
    E.lostMat = new THREE.SpriteMaterial({ map: iconTex('?', '#9fd8ff'), depthTest: false });
    E.starMat = new THREE.SpriteMaterial({ map: iconTex('★', '#fff27a'), depthTest: false });
  };

  class Enemy {
    constructor(x, z, o) {
      const y = P.ground(x, z, 999, 0, 0).h;
      this.pos = new V3(x, y, z); this.vel = new V3();
      this.home = this.pos.clone();
      this.r = o.r || 0.8; this.h = o.h || 1.4;
      this.face = o.face || 0;
      this.state = 'idle'; this.t = 0; this.alive = true; this.deadT = 0;
      this.body = { pos: this.pos, vel: this.vel, r: this.r, h: this.h, grounded: true, bounce: 0, friction: 0 };
      this.detect = o.detect || 15; this.lose = o.lose || 26; this.leash = o.leash || 32;
      this.coins = o.coins == null ? 2 : o.coins;
      this.touchDamage = o.touchDamage || 1;
      this.root = new THREE.Group();
      E.scene.add(this.root);
      this.icon = new THREE.Sprite(E.alertMat); this.icon.scale.setScalar(1.3); this.icon.visible = false;
      this.icon.position.y = this.h + 1.0; this.icon.renderOrder = 5;
      this.root.add(this.icon);
      // enemies cast real shadows; no blob shadow needed
      this.hitCooldown = 0;
      this.sawPlayer = 0;
      E.list.push(this);
    }
    setState(s) { if (this.state !== s) { this.prev = this.state; this.state = s; this.t = 0; if (this.enter) this.enter(s); } }
    toPlayer() {
      const p = G.player.pos;
      const dx = p.x - this.pos.x, dz = p.z - this.pos.z;
      const d = Math.hypot(dx, dz);
      return { dx, dz, d, dy: p.y - this.pos.y, yaw: Math.atan2(dx, dz) };
    }
    // perception: distance + height + terrain line of sight
    canSee(range) {
      const pl = G.player;
      if (pl.state === 'dead' || pl.state === 'drown' || pl.state === 'cannon' || G.game.state !== 'play') return false;
      const tp = this.toPlayer();
      if (tp.d > range || Math.abs(tp.dy) > 9) return false;
      return G.terrain.lineClear(this.pos.x, this.pos.y + this.h * 0.8, this.pos.z, pl.pos.x, pl.pos.y + 1.2, pl.pos.z, 0.2);
    }
    // would stepping `dist` ahead in direction yaw drop us off a ledge / into water / into a wall?
    unsafeAhead(yaw, dist) {
      const x = this.pos.x + Math.sin(yaw) * dist, z = this.pos.z + Math.cos(yaw) * dist;
      const g = P.ground(x, z, this.pos.y + 1, 1, 0).h;
      if (g < this.pos.y - 2.2) return true;
      const wl = G.terrain.waterLevelAt(x, z);
      if (wl !== null && wl - g > 0.35) return true;
      if (g > this.pos.y + 1.2) return true;
      const n = G.terrain.normalAt(x, z);
      return n.y < 0.72 && g > this.pos.y - 0.2;
    }
    // steer toward yaw at speed, refusing to walk off ledges
    steer(yaw, speed, dt, turnRate, accel) {
      this.face = U.angleStep(this.face, yaw, (turnRate || 6) * dt);
      let sp = speed;
      if (speed > 0 && this.unsafeAhead(this.face, this.r + 1.2)) { sp = 0; this.blocked = true; } else this.blocked = false;
      const tx = Math.sin(this.face) * sp, tz = Math.cos(this.face) * sp;
      const k = 1 - Math.exp(-(accel || 8) * dt);
      this.vel.x += (tx - this.vel.x) * k; this.vel.z += (tz - this.vel.z) * k;
    }
    brake(dt, k) { const f = Math.exp(-(k || 8) * dt); this.vel.x *= f; this.vel.z *= f; }
    // player interactions: stomp, attacks, contact damage
    interact() {
      const pl = G.player;
      if (!this.alive || pl.state === 'dead' || pl.state === 'drown' || pl.state === 'cannon') return;
      const dx = pl.pos.x - this.pos.x, dz = pl.pos.z - this.pos.z;
      const d = Math.hypot(dx, dz);
      const top = this.pos.y + this.h;
      if (this.hitCooldown > 0) return;
      if (pl.attack && pl.attackOverlap(this.pos.x, this.pos.y + this.h * 0.5, this.pos.z, this.r + 0.2)) {
        this.hitCooldown = 0.3;
        this.onAttacked(pl.attack, dx, dz, d);
        return;
      }
      if (d < this.r + 0.55 && pl.pos.y < top + 0.2 && pl.pos.y + 1.6 > this.pos.y) {
        if (pl.isStompingOn(top) || pl.state === 'gpFall') {
          this.hitCooldown = 0.3;
          this.onStomp(pl.state === 'gpFall');
          return;
        }
        this.onTouch(dx, dz, d);
      }
    }
    onStomp(pound) {
      const pl = G.player;
      pl.pos.y = Math.max(pl.pos.y, this.pos.y + this.h);
      pl.bounce(pound ? 14 : 18);
      G.audio.sfx.stomp();
      this.die('squash');
    }
    onAttacked(a, dx, dz, d) {
      const n = d || 1;
      this.knock(-dx / n, -dz / n, 14, 9);
      G.audio.sfx.hit();
      this.die('launch');
    }
    onTouch(dx, dz, d) { G.player.hurt(this.touchDamage, this.pos.x, this.pos.z, 10); }
    knock(nx, nz, sp, vy) {
      this.vel.x = nx * sp; this.vel.z = nz * sp; this.vel.y = vy; this.body.grounded = false;
    }
    die(kind) {
      if (!this.alive) return;
      this.alive = false; this.deadKind = kind; this.deadT = 0;
      this.icon.visible = false;
      G.audio.sfx.defeat();
      G.emit('enemyDefeated', this);
    }
    physics(dt) {
      P.stepBody(this.body, dt);
      // ground pound shockwaves stun nearby enemies
      const wl = G.terrain.waterLevelAt(this.pos.x, this.pos.z);
      if (wl !== null && this.pos.y < wl - 0.6 && !this.aquatic) {
        G.audio.sfx.splash();
        if (G.water) G.water.splash(this.pos.x, wl, this.pos.z, 0.7);
        this.alive = false; this.deadKind = 'drown'; this.deadT = 99;
      }
    }
    // separation between enemies so they don't stack
    separate() {
      for (const o of E.list) {
        if (o === this || !o.alive) continue;
        const dx = this.pos.x - o.pos.x, dz = this.pos.z - o.pos.z, d = Math.hypot(dx, dz), m = this.r + o.r;
        if (d < m && d > 0.001 && Math.abs(this.pos.y - o.pos.y) < 2) {
          this.pos.x += (dx / d) * (m - d) * 0.5; this.pos.z += (dz / d) * (m - d) * 0.5;
        }
      }
    }
    update(dt) {
      if (this.hitCooldown > 0) this.hitCooldown -= dt;
      if (this.held) { if (this.flyingRoot) this.pos.copy(this.root.position); return; }
      if (!this.alive) { this.updateDeath(dt); return; }
      this.t += dt;
      this.think(dt);
      this.physics(dt);
      if (!this.alive) return;
      this.separate();
      this.interact();
    }
    updateDeath(dt) {
      this.deadT += dt;
      if (this.deadKind === 'squash') {
        this.root.scale.set(1 + this.deadT * 3, Math.max(0.05, 1 - this.deadT * 6), 1 + this.deadT * 3);
      } else if (this.deadKind === 'launch') {
        this.vel.y += P.GRAVITY * 0.7 * dt;
        this.pos.addScaledVector(this.vel, dt);
        this.root.rotation.x += dt * 12;
      }
      if (this.deadT > 0.35 && !this.removed) {
        this.removed = true;
        G.fx.burst(this.pos.x, this.pos.y + 0.6, this.pos.z, 12, 0xffffff, 5, 0.3, 0.5, 0);
        if (this.deadKind !== 'drown') G.collect.drop(this.pos.x, this.pos.y + 0.8, this.pos.z, this.coins);
        E.scene.remove(this.root);
      }
      if (this.deadKind === 'drown' && !this.removed) { this.removed = true; E.scene.remove(this.root); }
    }
    render(cam) {
      if (this.removed) return;
      if (this.held) {
        // wriggling while carried (the flight moves root.position directly when thrown)
        if (!this.flyingRoot) this.root.position.copy(this.pos);
        this.root.rotation.z = Math.sin(G.player.time * 22) * 0.25;
        this.root.visible = true;
        this.animate && this.animate();
        return;
      }
      this.root.rotation.z = 0;
      // distance culling: far enemies are lost in the haze anyway (saves draw calls in every pass)
      const far = cam && Math.abs(cam.x - this.pos.x) + Math.abs(cam.z - this.pos.z) > 150;
      this.root.visible = !far;
      if (far) return;
      this.root.position.copy(this.pos);
      if (this.alive) this.root.rotation.y = this.face;
      this.animate && this.animate();
    }
    showIcon(mat, on) { this.icon.material = mat; this.icon.visible = on; }
    // ---- being carried and thrown by the player ----
    canGrab() { return false; }
    handle() {
      if (this._handle) return this._handle;
      const e = this;
      this._handle = {
        reach: e.r + 1.35, heavy: false, lift: e.h * 0.5, isEnemy: true, get pos() { return e.pos; },
        canPick: () => e.alive && !e.held && e.canGrab(),
        pick() { e.held = true; e.vel.set(0, 0, 0); e.showIcon(E.alertMat, false); G.audio.sfx.grab(); },
        hold(x, y, z, face) { e.pos.set(x, y - 0.1, z); e.face = face; },
        drop(x, y, z, face) {
          e.held = false; e.pos.set(x, P.ground(x, z, y + 1, 1.5, 0).h, z);
          e.body.grounded = false; if (e.setState) e.setState(e.recoverState || 'recover');
        },
        throw(vel) {
          G.fly(e.root, vel, e.r * 0.8, (x, y, z) => {
            e.pos.set(x, y, z); e.held = false;
            G.fx.burst(x, y + 0.5, z, 10, 0xffffff, 6, 0.3, 0.5, -10);
            G.audio.sfx.hit();
            e.vel.set(vel.x * 0.2, 9, vel.z * 0.2);
            e.die('launch');
          }, { self: e, spin: 11 });
          // the flight moves the model directly; keep the logical position in sync
          e.flyingRoot = true;
        },
      };
      return this._handle;
    }
  }
  E.Enemy = Enemy;

  // groundpound stuns everything nearby
  G.on('groundpound', (x, z) => {
    for (const e of E.list) {
      if (!e.alive) continue;
      const d = Math.hypot(e.pos.x - x, e.pos.z - z);
      if (d < 3.2 && Math.abs(e.pos.y - G.player.pos.y) < 1.5 && e.onShock) e.onShock(x, z, d);
    }
  });

  // ---------- projectiles ----------
  let rockGeo = null;
  E.fire = function (x, y, z, vx, vy, vz, opts) {
    opts = opts || {};
    if (!rockGeo) rockGeo = G.decor.blob(0.4, 5, 9.1, 0.22, 1);
    const m = new THREE.Mesh(opts.geo || rockGeo, opts.mat || G.mat(0x6b5e52, { roughness: 0.9 }));
    m.castShadow = true;
    if (opts.scale) m.scale.setScalar(opts.scale);
    m.position.set(x, y, z); E.scene.add(m);
    E.projectiles.push({ m, pos: m.position, vel: new V3(vx, vy, vz), life: opts.life || 5, grav: opts.grav == null ? 0.6 : opts.grav, r: opts.r || 0.45, dmg: opts.dmg || 1, onHit: opts.onHit, shadow: G.fx.makeShadow(opts.r || 0.45) });
  };
  E.updateProjectiles = function (dt) {
    const pl = G.player;
    for (let i = E.projectiles.length - 1; i >= 0; i--) {
      const p = E.projectiles[i];
      p.life -= dt;
      p.vel.y += P.GRAVITY * p.grav * dt;
      p.pos.addScaledVector(p.vel, dt);
      p.m.rotation.x += dt * 8; p.m.rotation.z += dt * 5;
      G.fx.placeShadow(p.shadow, p.pos.x, p.pos.y, p.pos.z, p.r);
      let dead = p.life <= 0;
      const d = Math.hypot(pl.pos.x - p.pos.x, pl.pos.y + 0.85 - p.pos.y, pl.pos.z - p.pos.z);
      if (!dead && pl.attack && pl.attackOverlap(p.pos.x, p.pos.y, p.pos.z, p.r)) {
        dead = true; G.audio.sfx.hit();
      } else if (!dead && d < p.r + 0.6) {
        pl.hurt(p.dmg, p.pos.x - p.vel.x, p.pos.z - p.vel.z, 9); dead = true;
      } else if (!dead && p.pos.y < P.ground(p.pos.x, p.pos.z, p.pos.y + 0.5, 0.5, 0).h) {
        dead = true;
      }
      if (dead) {
        if (p.onHit) p.onHit(p.pos.x, p.pos.y, p.pos.z);
        G.fx.burst(p.pos.x, p.pos.y, p.pos.z, 8, 0x8a7a6a, 4, 0.25, 0.5, -20);
        E.scene.remove(p.m); E.scene.remove(p.shadow);
        E.projectiles.splice(i, 1);
      }
    }
  };

  E.update = function (dt) {
    for (let i = 0; i < E.list.length; i++) {
      const e = E.list[i];
      // cheap distance culling: far enemies idle in place
      const d = Math.abs(e.pos.x - G.player.pos.x) + Math.abs(e.pos.z - G.player.pos.z);
      if (d > 140 && e.alive && !e.always) continue;
      e.update(dt);
    }
    E.updateProjectiles(dt);
  };
  E.render = function (cam) { for (const e of E.list) e.render(cam); };
})(window.G);

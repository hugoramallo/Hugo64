// enemy_types.js — Bumblet (patrol), Hornbuck (aggressive charger), Pebbleshot (ranged)
// and the Rolling Boulder spawner that sends rocks down the mountain path.
(function (G) {
  'use strict';
  const U = G.U, P = G.physics, E = G.enemies;
  const Enemy = E.Enemy;

  // =====================================================================
  // BUMBLET — patrols waypoints, spots the player, chases, gives up and returns.
  // States: patrol, idle, alert, chase, return, recover
  // =====================================================================
  class Bumblet extends Enemy {
    constructor(x, z, waypoints) {
      super(x, z, { r: 0.8, h: 1.45, detect: 15, lose: 24, leash: 30, coins: 2 });
      this.wp = (waypoints || [[x, z]]).map(([a, b]) => [a, b]);
      this.wi = 0;
      this.setState('patrol');
      this.build();
    }
    build() {
      const g = new THREE.Group(); this.root.add(g); this.model = g;
      const skin = G.mat(0x8a4fd8, { roughness: 0.55 });
      const body = new THREE.Mesh(new THREE.SphereGeometry(0.85, 48, 36), skin);
      body.scale.set(1, 0.85, 1); body.position.y = 0.85; g.add(body);
      // soft ridges on the back
      for (let i = 0; i < 5; i++) {
        const r = new THREE.Mesh(new THREE.SphereGeometry(0.22, 20, 14), skin);
        const a = -0.9 + i * 0.45;
        r.scale.set(1, 0.6, 1.4); r.position.set(Math.sin(a) * 0.3, 1.45 - Math.abs(a) * 0.15, -0.35 - Math.cos(a) * 0.1); g.add(r);
      }
      const belly = new THREE.Mesh(new THREE.SphereGeometry(0.6, 40, 28), G.mat(0xf2e2c4, { roughness: 0.7 }));
      belly.scale.set(1, 0.8, 0.5); belly.position.set(0, 0.62, 0.5); g.add(belly);
      const eye = new THREE.Mesh(new THREE.SphereGeometry(0.34, 40, 30), G.mat(0xffffff, { roughness: 0.12 }));
      eye.scale.set(1, 1.1, 0.6); eye.position.set(0, 1.08, 0.66); g.add(eye);
      const lid = new THREE.Mesh(new THREE.SphereGeometry(0.37, 40, 20, 0, Math.PI * 2, 0, Math.PI * 0.42), skin);
      lid.scale.set(1, 1.1, 0.66); lid.position.set(0, 1.1, 0.64); lid.rotation.x = -0.35; g.add(lid);
      const pup = new THREE.Mesh(new THREE.SphereGeometry(0.15, 24, 18), G.mat(0x111111, { roughness: 0.1 }));
      pup.position.set(0, 1.06, 0.86); pup.userData.keep = true; g.add(pup); this.pupil = pup;
      const brow = new THREE.Mesh(G.bevelBox(0.7, 0.12, 0.12, 0.05), G.mat(0x3a1a60));
      brow.position.set(0, 1.42, 0.7); brow.userData.keep = true; g.add(brow); this.brow = brow;
      [-1, 1].forEach((s) => { // little fangs
        const f = new THREE.Mesh(new THREE.ConeGeometry(0.06, 0.16, 12), G.mat(0xfff8e8, { roughness: 0.3 }));
        f.rotation.x = Math.PI; f.position.set(0.16 * s, 0.7, 0.8); g.add(f);
      });
      const sprout = new THREE.Mesh(new THREE.SphereGeometry(0.12, 16, 12).scale(1, 2.6, 0.5), G.mat(0x4ccf4a, { roughness: 0.6 }));
      sprout.position.set(0.05, 1.8, 0); sprout.rotation.z = 0.3; g.add(sprout);
      const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.04, 0.3, 10), G.mat(0x3a8a30));
      stem.position.set(0, 1.62, 0); g.add(stem);
      this.feet = [-1, 1].map((s) => {
        const f = new THREE.Mesh(new THREE.SphereGeometry(0.28, 28, 20), G.mat(0x4a2a18, { roughness: 0.8 }));
        f.scale.set(1, 0.6, 1.4); f.position.set(0.38 * s, 0.15, 0.1); f.userData.keep = true; g.add(f); return f;
      });
      this.walkPhase = Math.random() * 6;
    }
    think(dt) {
      const tp = this.toPlayer();
      const sees = this.canSee(this.detect);
      switch (this.state) {
        case 'patrol': {
          const w = this.wp[this.wi];
          const dx = w[0] - this.pos.x, dz = w[1] - this.pos.z, d = Math.hypot(dx, dz);
          if (d < 1.2 || (this.blocked && this.t > 0.5)) { this.wi = (this.wi + 1) % this.wp.length; this.setState('idle'); break; }
          this.steer(Math.atan2(dx, dz), 2.8, dt, 4);
          if (sees) this.setState('alert');
          break;
        }
        case 'idle':
          this.brake(dt);
          this.face += Math.sin(this.t * 3) * dt * 1.5; // look around
          if (sees) this.setState('alert');
          else if (this.t > 1.2) this.setState('patrol');
          break;
        case 'alert':
          this.brake(dt, 12);
          this.face = U.angleStep(this.face, tp.yaw, 10 * dt);
          if (this.t < 0.05 && this.body.grounded) { this.vel.y = 7; G.audio.sfx.alert(); }
          this.showIcon(E.alertMat, true);
          if (this.t > 0.55) { this.showIcon(E.alertMat, false); this.setState('chase'); }
          break;
        case 'chase': {
          const fromHome = Math.hypot(this.pos.x - this.home.x, this.pos.z - this.home.z);
          if (tp.d > this.lose || fromHome > this.leash || G.player.state === 'dead') { this.setState('return'); this.lostT = 1.2; break; }
          if (!sees) { this.sawPlayer += dt; if (this.sawPlayer > 2.5) { this.setState('return'); this.lostT = 1.2; break; } }
          else this.sawPlayer = 0;
          this.steer(tp.yaw, 6.8, dt, 7);
          break;
        }
        case 'return': {
          if (this.lostT > 0) { this.lostT -= dt; this.showIcon(E.lostMat, true); this.brake(dt); break; }
          this.showIcon(E.lostMat, false);
          // head to the nearest waypoint then resume
          let best = 0, bd = 1e9;
          this.wp.forEach((w, i) => { const d = Math.hypot(w[0] - this.pos.x, w[1] - this.pos.z); if (d < bd) { bd = d; best = i; } });
          const w = this.wp[best];
          this.steer(Math.atan2(w[0] - this.pos.x, w[1] - this.pos.z), 3.4, dt, 5);
          if (bd < 1.5 || (this.blocked && this.t > 3)) { this.wi = best; this.setState('patrol'); }
          if (sees && this.t > 1.5 && tp.d < this.detect * 0.7) this.setState('alert');
          break;
        }
        case 'recover':
          this.brake(dt, 3);
          this.showIcon(E.starMat, true);
          if (this.t > 1.4) { this.showIcon(E.starMat, false); this.setState(sees ? 'chase' : 'return'); }
          break;
      }
    }
    onShock(x, z, d) {
      this.knock((this.pos.x - x) / (d || 1), (this.pos.z - z) / (d || 1), 6, 8);
      this.setState('recover');
    }
    canGrab() { return this.body.grounded && this.state !== 'alert'; }
    onTouch(dx, dz, d) {
      super.onTouch(dx, dz, d);
      // bumping the player: bounce back a little and reposition
      this.knock(-dx / (d || 1), -dz / (d || 1), 5, 4);
    }
    animate() {
      const sp = Math.hypot(this.vel.x, this.vel.z);
      this.walkPhase += sp * 0.1 + 0.02;
      const k = Math.min(1, sp / 3);
      this.feet[0].position.z = 0.1 + Math.sin(this.walkPhase * 2) * 0.3 * k;
      this.feet[1].position.z = 0.1 - Math.sin(this.walkPhase * 2) * 0.3 * k;
      this.model.position.y = Math.abs(Math.sin(this.walkPhase * 2)) * 0.12 * k;
      this.model.rotation.z = Math.sin(this.walkPhase * 2) * 0.08 * k;
      const angry = this.state === 'chase' || this.state === 'alert';
      this.brow.rotation.z = 0; this.brow.position.y = angry ? 1.34 : 1.44;
      this.pupil.scale.setScalar(angry ? 0.8 : 1);
      if (this.state === 'recover') this.model.rotation.y += 0.3; else this.model.rotation.y = 0;
    }
  }

  // =====================================================================
  // HORNBUCK — spots the player, paws the ground, charges in a straight line,
  // gets dizzy if it rams a wall or misses, then retreats and repositions.
  // States: idle, alert, charge, retreat, recover, return
  // =====================================================================
  class Hornbuck extends Enemy {
    constructor(x, z) {
      super(x, z, { r: 1.05, h: 1.6, detect: 20, lose: 32, leash: 38, coins: 4, touchDamage: 1 });
      this.setState('idle');
      this.wander = [x, z];
      this.build();
    }
    build() {
      const g = new THREE.Group(); this.root.add(g); this.model = g;
      const hide = G.mat(0xc8662a, { roughness: 0.75 }), dark = G.mat(0x7a3a14, { roughness: 0.9 });
      const body = new THREE.Mesh(G.bevelBox(1.5, 1.1, 2.1, 0.38), hide);
      body.position.y = 1.05; g.add(body);
      const hump = new THREE.Mesh(new THREE.SphereGeometry(0.8, 32, 24), hide);
      hump.scale.set(1, 0.7, 1.2); hump.position.set(0, 1.5, 0.35); g.add(hump);
      const mane = new THREE.Mesh(G.bevelBox(1.6, 0.4, 1.2, 0.18), dark);
      mane.position.set(0, 1.72, 0.2); g.add(mane);
      for (let i = 0; i < 7; i++) { // bristles along the spine
        const b = new THREE.Mesh(new THREE.ConeGeometry(0.09, 0.4, 10), dark);
        b.position.set((i % 2 ? 0.08 : -0.08), 1.95, -0.7 + i * 0.25); b.rotation.x = -0.4; g.add(b);
      }
      const tail = new THREE.Mesh(new THREE.CapsuleGeometry(0.06, 0.45, 6, 10), dark);
      tail.position.set(0, 1.25, -1.2); tail.rotation.x = 0.9; g.add(tail);
      // head group: head, snout, horns and eyes move together
      const head = new THREE.Group(); head.position.set(0, 1.1, 1.3); g.add(head); this.head = head;
      const skull = new THREE.Mesh(G.bevelBox(1.1, 0.9, 0.8, 0.28), G.mat(0xd8783a, { roughness: 0.7 }));
      head.add(skull);
      const snout = new THREE.Mesh(new THREE.CylinderGeometry(0.34, 0.38, 0.4, 32).rotateX(Math.PI / 2), G.mat(0xf0a080, { roughness: 0.55 }));
      snout.position.set(0, -0.15, 0.5); head.add(snout);
      [-1, 1].forEach((s) => {
        const nos = new THREE.Mesh(new THREE.SphereGeometry(0.06, 12, 8), G.mat(0x4a1a10));
        nos.position.set(0.12 * s, -0.12, 0.71); head.add(nos);
        const horn = new THREE.Mesh(new THREE.ConeGeometry(0.16, 0.9, 20, 4), G.mat(0xfff4dc, { roughness: 0.35 }));
        horn.position.set(0.45 * s, 0.45, 0.15); horn.rotation.set(0.9, 0, -0.5 * s); head.add(horn);
        const eye = new THREE.Mesh(new THREE.SphereGeometry(0.1, 16, 12), G.mat(0x111111, { roughness: 0.1 }));
        eye.position.set(0.3 * s, 0.2, 0.41); head.add(eye);
        const ear = new THREE.Mesh(new THREE.SphereGeometry(0.16, 16, 12).scale(0.5, 1, 1.4), hide);
        ear.position.set(0.55 * s, 0.35, -0.2); ear.rotation.z = 0.6 * s; head.add(ear);
      });
      this.legs = [];
      [[-0.5, 0.7], [0.5, 0.7], [-0.5, -0.7], [0.5, -0.7]].forEach(([lx, lz]) => {
        const l = new THREE.Group(); l.position.set(lx, 0.62, lz); g.add(l);
        const leg = new THREE.Mesh(new THREE.CapsuleGeometry(0.16, 0.36, 6, 14), G.mat(0x5a2a10, { roughness: 0.85 }));
        leg.position.y = -0.26; l.add(leg);
        const hoof = new THREE.Mesh(new THREE.CylinderGeometry(0.17, 0.2, 0.14, 16), G.mat(0x2a1a10, { roughness: 0.5 }));
        hoof.position.y = -0.56; l.add(hoof);
        this.legs.push(l);
      });
      this.phase = 0;
    }
    think(dt) {
      const tp = this.toPlayer();
      const sees = this.canSee(this.detect);
      const fromHome = Math.hypot(this.pos.x - this.home.x, this.pos.z - this.home.z);
      switch (this.state) {
        case 'idle': { // graze & amble around home
          const dx = this.wander[0] - this.pos.x, dz = this.wander[1] - this.pos.z;
          if (Math.hypot(dx, dz) < 1.5 || this.t > 5) {
            const a = Math.random() * Math.PI * 2, r = 4 + Math.random() * 6;
            this.wander = [this.home.x + Math.cos(a) * r, this.home.z + Math.sin(a) * r]; this.t = 0;
          }
          this.steer(Math.atan2(dx, dz), this.t < 2 ? 0 : 2.2, dt, 3);
          if (sees) this.setState('alert');
          break;
        }
        case 'alert':
          this.brake(dt, 10);
          this.face = U.angleStep(this.face, tp.yaw, 5 * dt);
          this.showIcon(E.alertMat, this.t < 0.6);
          if (this.t < 0.02) G.audio.sfx.alert();
          if (Math.floor(this.t * 6) !== Math.floor((this.t - dt) * 6)) G.fx.dust(this.pos.x - Math.sin(this.face) * 0.8, this.pos.y, this.pos.z - Math.cos(this.face) * 0.8, 2);
          if (!sees && this.t > 1.5) { this.setState('return'); break; }
          if (this.t > 0.85 && Math.abs(U.wrap(tp.yaw - this.face)) < 0.25) {
            this.chargeYaw = this.face; this.setState('charge'); G.audio.sfx.charge();
          }
          break;
        case 'charge': {
          this.showIcon(E.alertMat, false);
          this.face = U.angleStep(this.face, tp.yaw, 0.5 * dt); // barely steers
          const edge = this.unsafeAhead(this.face, this.r + 1.5);
          if (edge) { this.brake(dt, 20); if (this.t > 0.2) { this.setState('recover'); break; } }
          else {
            const k = 1 - Math.exp(-6 * dt);
            this.vel.x += (Math.sin(this.face) * 17 - this.vel.x) * k;
            this.vel.z += (Math.cos(this.face) * 17 - this.vel.z) * k;
          }
          if (this.t % 0.08 < dt) G.fx.dust(this.pos.x, this.pos.y, this.pos.z, 1);
          if (this.body.hitWall && this.t > 0.2) { G.audio.sfx.bonk(); G.camera.shake(0.2); this.knock(-Math.sin(this.face), -Math.cos(this.face), 5, 5); this.setState('recover'); this.dizzy = 2.4; break; }
          if (this.t > 1.4) { this.setState('recover'); this.dizzy = 1.0; }
          break;
        }
        case 'retreat': { // back off after an attack, then line up again
          const away = tp.yaw + Math.PI;
          this.steer(away, 5, dt, 6);
          if (this.blocked || this.t > 1.1) this.setState(sees && fromHome < this.leash ? 'alert' : 'return');
          break;
        }
        case 'recover':
          this.brake(dt, 4);
          this.showIcon(E.starMat, true);
          if (this.t > (this.dizzy || 1.4)) { this.showIcon(E.starMat, false); this.dizzy = 0; this.setState(sees && fromHome < this.leash ? 'retreat' : 'return'); }
          break;
        case 'return': {
          this.showIcon(E.lostMat, this.t < 1);
          const dx = this.home.x - this.pos.x, dz = this.home.z - this.pos.z;
          this.steer(Math.atan2(dx, dz), 4, dt, 4);
          if (Math.hypot(dx, dz) < 2 || (this.blocked && this.t > 4)) { this.showIcon(E.lostMat, false); this.setState('idle'); }
          if (sees && this.t > 1.2 && tp.d < this.detect * 0.8) this.setState('alert');
          break;
        }
      }
    }
    onTouch(dx, dz, d) {
      if (this.state === 'charge') {
        G.player.hurt(2, this.pos.x, this.pos.z, 15);
        this.setState('retreat');
      } else if (this.state === 'recover') {
        // bumping a dizzy hornbuck just nudges it
        this.knock(-dx / (d || 1), -dz / (d || 1), 3, 2);
      } else super.onTouch(dx, dz, d);
    }
    canGrab() { return this.state === 'recover' && this.body.grounded; }
    onAttacked(a, dx, dz, d) {
      const n = d || 1;
      if (this.state === 'recover' || a.kind === 'pound' || a.kind === 'throw' || this.hp === 1) { super.onAttacked(a, dx, dz, d); return; }
      // horns deflect a punch while alert: knocked back and stunned
      this.knock(-dx / n, -dz / n, 9, 6);
      this.hp = 1;
      G.audio.sfx.hit();
      this.setState('recover'); this.dizzy = 1.8;
    }
    onShock(x, z, d) { this.knock((this.pos.x - x) / (d || 1), (this.pos.z - z) / (d || 1), 6, 7); this.setState('recover'); this.dizzy = 2; }
    animate() {
      const sp = Math.hypot(this.vel.x, this.vel.z);
      this.phase += sp * 0.06;
      this.legs.forEach((l, i) => { l.rotation.x = Math.sin(this.phase * 3 + (i % 2) * Math.PI) * Math.min(0.9, sp * 0.08); });
      this.model.rotation.x = this.state === 'charge' ? 0.12 : 0;
      this.model.rotation.z = this.state === 'recover' ? Math.sin(this.t * 10) * 0.15 : 0;
      this.head.position.y = this.state === 'idle' && sp < 0.5 ? 0.8 + Math.sin(this.t * 2) * 0.1 : 1.1;
      this.head.rotation.x = this.state === 'charge' ? 0.25 : 0;
    }
  }

  // =====================================================================
  // PEBBLESHOT — keeps its distance, aims with lead and lobs rocks; hops away
  // when the player gets close. States: idle, alert, aim, cooldown, hop, return
  // =====================================================================
  class Pebbleshot extends Enemy {
    constructor(x, z, o) {
      o = o || {};
      super(x, z, { r: 0.9, h: 1.6, detect: o.detect || 30, lose: 38, leash: o.leash || 14, coins: 3 });
      this.setState('idle');
      this.build();
    }
    build() {
      const g = new THREE.Group(); this.root.add(g); this.model = g;
      const shell = G.mat(0x2f8fd8, { roughness: 0.35, metalness: 0.1 });
      const body = new THREE.Mesh(new THREE.SphereGeometry(0.9, 48, 36), shell);
      body.position.y = 0.95; g.add(body);
      const band = new THREE.Mesh(new THREE.TorusGeometry(0.88, 0.1, 16, 64), G.mat(0xffd21f, { roughness: 0.3, metalness: 0.6 }));
      band.rotation.x = Math.PI / 2; band.position.y = 0.8; g.add(band);
      for (let i = 0; i < 8; i++) { // rivets on the band
        const a = (i / 8) * Math.PI * 2;
        const r = new THREE.Mesh(new THREE.SphereGeometry(0.06, 12, 8), G.mat(0xb08a20, { metalness: 0.8, roughness: 0.3 }));
        r.position.set(Math.cos(a) * 0.97, 0.8, Math.sin(a) * 0.97); g.add(r);
      }
      const snout = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.36, 0.8, 32, 3, true), G.mat(0x1b3d6a, { roughness: 0.4, metalness: 0.4, side: THREE.DoubleSide }));
      snout.rotation.x = Math.PI / 2; snout.position.set(0, 1.05, 0.95); snout.userData.keep = true; g.add(snout); this.snout = snout;
      const muzzle = new THREE.Mesh(new THREE.TorusGeometry(0.3, 0.06, 12, 32), G.mat(0x0f2a4a, { metalness: 0.5, roughness: 0.4 }));
      muzzle.position.set(0, 0, -0.42); snout.add(muzzle);
      [-1, 1].forEach((s) => {
        const eye = new THREE.Mesh(new THREE.SphereGeometry(0.18, 24, 18), G.mat(0xffffff, { roughness: 0.12 }));
        eye.position.set(0.35 * s, 1.45, 0.62); g.add(eye);
        const p = new THREE.Mesh(new THREE.SphereGeometry(0.08, 16, 12), G.mat(0x111111, { roughness: 0.1 }));
        p.position.set(0.35 * s, 1.45, 0.78); g.add(p);
        const foot = new THREE.Mesh(new THREE.SphereGeometry(0.3, 24, 18), G.mat(0xffa21f, { roughness: 0.6 }));
        foot.scale.set(1, 0.5, 1.4); foot.position.set(0.45 * s, 0.12, 0.1); g.add(foot);
      });
      const fin = new THREE.Mesh(new THREE.ConeGeometry(0.3, 0.7, 24, 3).scale(0.45, 1, 1.3), G.mat(0xffd21f, { roughness: 0.4 }));
      fin.position.set(0, 1.9, -0.1); g.add(fin);
      this.glow = new THREE.Mesh(new THREE.SphereGeometry(0.2, 20, 14), G.mat(0xff5030, { emissive: 0xff3010, emissiveIntensity: 2 }));
      this.glow.position.set(0, 1.05, 1.36); this.glow.visible = false; this.glow.userData.keep = true; g.add(this.glow);
    }
    think(dt) {
      const tp = this.toPlayer();
      const sees = this.canSee(this.detect);
      const fromHome = Math.hypot(this.pos.x - this.home.x, this.pos.z - this.home.z);
      if (this.state !== 'hop') this.brake(dt, 6);
      switch (this.state) {
        case 'idle':
          this.face += Math.sin(this.t * 1.3) * dt;
          if (sees) this.setState('alert');
          break;
        case 'alert':
          this.showIcon(E.alertMat, this.t < 0.5);
          if (this.t < 0.02) G.audio.sfx.alert();
          this.face = U.angleStep(this.face, tp.yaw, 6 * dt);
          if (this.t > 0.5) this.setState('aim');
          break;
        case 'aim':
          this.showIcon(E.alertMat, false);
          if (!sees) { if (this.t > 1.5) this.setState(fromHome > 2 ? 'return' : 'idle'); break; }
          if (tp.d < 8.5 && this.body.grounded) { this.hopAway(tp); break; }
          if (tp.d > 24 && fromHome < this.leash && this.body.grounded && this.t > 0.4) { this.hopToward(tp); break; }
          this.face = U.angleStep(this.face, tp.yaw, 5 * dt);
          this.glow.visible = this.t > 0.35 && Math.floor(this.t * 10) % 2 === 0;
          if (this.t > 0.85) { this.shoot(tp); this.setState('cooldown'); }
          break;
        case 'cooldown':
          this.glow.visible = false;
          this.face = U.angleStep(this.face, tp.yaw, 3 * dt);
          if (tp.d < 7 && this.body.grounded) { this.hopAway(tp); break; }
          if (this.t > 1.3) this.setState(sees ? 'aim' : 'idle');
          break;
        case 'hop':
          if (this.body.grounded && this.t > 0.15) { this.brake(dt, 20); G.fx.dust(this.pos.x, this.pos.y, this.pos.z, 3); this.setState('aim'); }
          break;
        case 'return': {
          const dx = this.home.x - this.pos.x, dz = this.home.z - this.pos.z;
          if (this.body.grounded && this.t > 0.6) {
            const yaw = Math.atan2(dx, dz);
            this.face = yaw; this.vel.set(Math.sin(yaw) * 4, 8, Math.cos(yaw) * 4); this.body.grounded = false; this.t = 0;
          }
          if (Math.hypot(dx, dz) < 1.5) this.setState('idle');
          if (sees) this.setState('alert');
          break;
        }
        case 'recover':
          this.showIcon(E.starMat, true);
          if (this.t > 1.5) { this.showIcon(E.starMat, false); this.setState('aim'); }
          break;
      }
    }
    hopAway(tp) {
      // pick the safest of: straight away, away-left, away-right
      const cands = [0, 0.8, -0.8, 1.6, -1.6].map((o) => tp.yaw + Math.PI + o);
      let yaw = null;
      for (const c of cands) if (!this.unsafeAhead(c, 3) && !this.unsafeAhead(c, 6)) { yaw = c; break; }
      if (yaw == null) { this.setState('aim'); this.t = 0.5; return; } // cornered: stand and fight
      this.vel.set(Math.sin(yaw) * 7.5, 12, Math.cos(yaw) * 7.5); this.body.grounded = false;
      this.setState('hop'); G.audio.sfx.jump();
    }
    hopToward(tp) {
      if (this.unsafeAhead(tp.yaw, 4)) { this.t = 0; return; }
      this.vel.set(Math.sin(tp.yaw) * 5, 9, Math.cos(tp.yaw) * 5); this.body.grounded = false;
      this.setState('hop');
    }
    shoot(tp) {
      const pl = G.player;
      const sx = this.pos.x + Math.sin(this.face) * 1.3, sy = this.pos.y + 1.1, sz = this.pos.z + Math.cos(this.face) * 1.3;
      const hs = 15;
      const T = Math.max(0.35, tp.d / hs);
      // lead the target a little
      const tx = pl.pos.x + pl.vel.x * T * 0.6, tz = pl.pos.z + pl.vel.z * T * 0.6, ty = pl.pos.y + 0.9;
      const dx = tx - sx, dz = tz - sz, d = Math.hypot(dx, dz) || 1;
      const T2 = Math.max(0.35, d / hs);
      const g = P.GRAVITY * 0.6;
      const vy = (ty - sy - 0.5 * g * T2 * T2) / T2;
      E.fire(sx, sy, sz, (dx / d) * hs, vy, (dz / d) * hs, { dmg: 1 });
      G.audio.sfx.shoot();
      this.snout.position.z = 0.7;
    }
    onShock(x, z, d) { this.setState('recover'); this.vel.y = 6; }
    animate() {
      this.snout.position.z = U.lerp(this.snout.position.z, 0.95, 0.15);
      const sq = this.state === 'aim' ? 1 + Math.sin(this.t * 20) * 0.03 : 1;
      this.model.scale.set(sq, 1 / sq, sq);
    }
  }

  // =====================================================================
  // ROLLING BOULDERS — spawned near the summit, roll down the spiral path
  // following the terrain, then tumble off the edge and shatter.
  // =====================================================================
  function BoulderSpawner(scene, tStart, tEnd, interval) {
    const MT = G.terrain.mtn;
    const geo = G.decor.blob(1.4, 9, 4.2, 0.16, 1);
    const mat = G.mat(0x8c7f72, { roughness: 0.92 });
    const list = [];
    let timer = 1;
    const sp = { always: true, list };
    sp.update = function (dt) {
      const pl = G.player;
      const near = Math.hypot(pl.pos.x - MT.x, pl.pos.z - MT.z) < MT.R0 + 30 && pl.pos.y > 20;
      timer -= dt;
      if (timer <= 0 && near && list.length < 6) {
        timer = interval + Math.random() * 1.5;
        const m = new THREE.Mesh(geo, mat); scene.add(m); m.scale.setScalar(0.2);
        const b = { m, t: tStart, speed: 5, lat: (Math.random() - 0.5) * 3.2, free: false, life: 0, pos: m.position, vel: new THREE.Vector3(), r: 1.4, h: 2.8, grounded: false, bounce: 0.3, friction: 0.5, noWalls: true, shadow: G.fx.makeShadow(1.8) };
        list.push(b);
      }
      for (let i = list.length - 1; i >= 0; i--) {
        const b = list[i];
        b.life += dt;
        if (b.m.scale.x < 1) b.m.scale.setScalar(Math.min(1, b.m.scale.x + dt * 2.5));
        if (!b.free) {
          b.speed = Math.min(11, b.speed + dt * 3);
          b.t -= (b.speed * dt) / MT.rp(b.t);
          const hw = MT.hw(b.t);
          const lat = U.clamp(b.lat, -(hw - 1.5), hw - 1.5);
          const p = MT.point(b.t, lat);
          const prev = b.pos.clone();
          b.pos.set(p.x, G.terrain.heightAt(p.x, p.z) + b.r, p.z);
          const dx = b.pos.x - prev.x, dz = b.pos.z - prev.z, dl = Math.hypot(dx, dz);
          if (dl > 0) { // roll: rotate about the axis perpendicular to travel
            const ax = new THREE.Vector3(dz / dl, 0, -dx / dl);
            b.m.rotateOnWorldAxis(ax, dl / b.r);
            b.vel.set(dx / dt, 0, dz / dt);
          }
          if (b.t < tEnd) { // leave the path: tumble outward off the ledge
            b.free = true;
            const a = MT.theta0 + b.t;
            b.vel.x += Math.cos(a) * 7; b.vel.z += Math.sin(a) * 7; b.vel.y = 4;
          }
          if (Math.random() < dt * 3 && Math.hypot(pl.pos.x - b.pos.x, pl.pos.z - b.pos.z) < 30) G.audio.sfx.rumble();
        } else {
          b.vel.y += P.GRAVITY * dt;
          b.pos.addScaledVector(b.vel, dt);
          b.m.rotation.x += dt * 3;
          const gh = G.terrain.heightAt(b.pos.x, b.pos.z);
          if (b.pos.y - b.r < gh && b.vel.y < 0) { b.dead = true; }
        }
        // hit the player
        const d = Math.hypot(pl.pos.x - b.pos.x, pl.pos.y + 0.8 - b.pos.y, pl.pos.z - b.pos.z);
        if (d < b.r + 0.6) {
          if (pl.state === 'gpFall' && pl.pos.y > b.pos.y + 0.8) { b.dead = true; pl.bounce(16); G.audio.sfx.stomp(); }
          else pl.hurt(2, b.pos.x, b.pos.z, 15);
        }
        if (pl.attack && pl.attack.kind === 'pound' && pl.attackOverlap(b.pos.x, b.pos.y, b.pos.z, b.r)) b.dead = true;
        G.fx.placeShadow(b.shadow, b.pos.x, b.pos.y - b.r + 0.1, b.pos.z, 1.5);
        if (b.dead || b.life > 60 || b.pos.y < (G.terrain.waterLevelAt(b.pos.x, b.pos.z) ?? -999)) {
          G.fx.burst(b.pos.x, b.pos.y, b.pos.z, 16, 0x8c7f72, 8, 0.6, 0.9, -25);
          if (Math.hypot(pl.pos.x - b.pos.x, pl.pos.z - b.pos.z) < 40) G.audio.sfx.explode();
          scene.remove(b.m); scene.remove(b.shadow);
          list.splice(i, 1);
        }
      }
    };
    sp.render = function () {};
    return sp;
  }

  // =====================================================================
  // PUFFER — an underwater patroller: cruises along a loop, puffs up into a spiky ball when the
  // player swims close. It cannot be stomped or punched; touching it hurts.
  // States: cruise, puff
  // =====================================================================
  class Puffer extends Enemy {
    constructor(x, z, y, path) {
      super(x, z, { r: 0.95, h: 1.7, coins: 0, detect: 7 });
      this.aquatic = true;
      this.pos.y = y; this.home.y = y;
      this.path = path; this.pi = 0; this.puff = 0; this.bob = Math.random() * 6;
      this.setState('cruise');
      this.build();
    }
    build() {
      const g = new THREE.Group(); this.root.add(g); this.model = g;
      const skin = G.mat(0xffd23f, { roughness: 0.45 }), belly = G.mat(0xfff4d0, { roughness: 0.5 });
      const body = new THREE.Mesh(new THREE.SphereGeometry(0.8, 40, 30), skin); body.position.y = 0.85; g.add(body);
      const bel = new THREE.Mesh(new THREE.SphereGeometry(0.62, 32, 24), belly); bel.scale.set(1, 0.7, 0.9); bel.position.set(0, 0.62, 0.18); g.add(bel);
      const spikeMat = G.mat(0xfff8e8, { roughness: 0.35 });
      for (let i = 0; i < 26; i++) { // Fibonacci sphere of spikes
        const k = (i + 0.5) / 26, phi = Math.acos(1 - 2 * k), th = Math.PI * (1 + Math.sqrt(5)) * i;
        const dir = new THREE.Vector3(Math.cos(th) * Math.sin(phi), Math.cos(phi), Math.sin(th) * Math.sin(phi));
        const sp = new THREE.Mesh(new THREE.ConeGeometry(0.08, 0.34, 8), spikeMat);
        sp.position.copy(dir).multiplyScalar(0.8).add(new THREE.Vector3(0, 0.85, 0));
        sp.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir);
        g.add(sp);
      }
      [-1, 1].forEach((s) => {
        const eye = new THREE.Mesh(new THREE.SphereGeometry(0.2, 24, 18), G.mat(0xffffff, { roughness: 0.1 }));
        eye.position.set(0.3 * s, 1.05, 0.62); g.add(eye);
        const pup = new THREE.Mesh(new THREE.SphereGeometry(0.09, 16, 12), G.mat(0x111111, { roughness: 0.1 }));
        pup.position.set(0.32 * s, 1.05, 0.79); g.add(pup);
        const fin = new THREE.Mesh(new THREE.SphereGeometry(0.22, 16, 10), G.mat(0xff8a3d, { roughness: 0.5 }));
        fin.scale.set(0.25, 0.8, 1.2); fin.position.set(0.82 * s, 0.8, 0.05); g.add(fin);
      });
      const mouth = new THREE.Mesh(new THREE.TorusGeometry(0.09, 0.035, 8, 16), G.mat(0xd8503a));
      mouth.position.set(0, 0.72, 0.8); g.add(mouth);
      const tail = new THREE.Mesh(new THREE.ConeGeometry(0.32, 0.5, 4), G.mat(0xff8a3d, { roughness: 0.5 }));
      tail.rotation.x = -Math.PI / 2; tail.scale.set(0.3, 1, 1); tail.position.set(0, 0.85, -0.95); tail.userData.keep = true; g.add(tail);
      this.tail = tail;
    }
    think(dt) {
      const pl = G.player;
      const d3 = Math.hypot(pl.pos.x - this.pos.x, pl.pos.y + 0.8 - (this.pos.y + 0.85), pl.pos.z - this.pos.z);
      const near = d3 < 6 && pl.isSwimming();
      this.puff = U.damp(this.puff, near ? 1 : 0, near ? 9 : 2.5, dt);
      const w = this.path[this.pi];
      const dx = w[0] - this.pos.x, dz = w[1] - this.pos.z, d = Math.hypot(dx, dz);
      if (d < 1.5) this.pi = (this.pi + 1) % this.path.length;
      const sp = near ? 0.6 : 2.2;
      this.face = U.angleStep(this.face, near ? Math.atan2(pl.pos.x - this.pos.x, pl.pos.z - this.pos.z) : Math.atan2(dx, dz), 2.2 * dt);
      this.vel.x = U.damp(this.vel.x, Math.sin(this.face) * sp, 3, dt);
      this.vel.z = U.damp(this.vel.z, Math.cos(this.face) * sp, 3, dt);
      this.bob += dt;
      this.vel.y = (this.home.y + Math.sin(this.bob * 0.9) * 0.8 - this.pos.y) * 1.5;
    }
    physics(dt) {
      this.pos.addScaledVector(this.vel, dt);
      const g = G.terrain.heightAt(this.pos.x, this.pos.z), wl = G.terrain.waterLevelAt(this.pos.x, this.pos.z);
      this.pos.y = Math.max(this.pos.y, g + 0.4);
      if (wl !== null) this.pos.y = Math.min(this.pos.y, wl - 2);
      this.r = 0.95 + this.puff * 0.7;
    }
    onStomp() { this.onTouch(G.player.pos.x - this.pos.x, G.player.pos.z - this.pos.z, 1); }
    onAttacked(a, dx, dz, d) { if (a && a.kind === 'throw') { G.audio.sfx.bonk(); this.puff = 1; return; } this.onTouch(dx, dz, d); }
    onTouch(dx, dz, d) {
      const pl = G.player;
      if (pl.invuln > 0) return;
      pl.hurt(1, this.pos.x, this.pos.z, 9);
      G.audio.sfx.bonk();
    }
    animate() {
      const k = 1 + this.puff * 0.75;
      this.model.scale.set(k, k, k);
      this.model.position.y = -0.85 * (k - 1);
      this.tail.rotation.y = Math.sin(this.bob * 9) * 0.5;
    }
  }

  E.Bumblet = Bumblet;
  E.Hornbuck = Hornbuck;
  E.Pebbleshot = Pebbleshot;
  E.BoulderSpawner = BoulderSpawner;
  E.Puffer = Puffer;
})(window.G);

// hud.js — health pie, counters, area banners, toasts, signs, boss bar and menu screens.
(function (G) {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const H = { signT: 0, toastT: 0, areaT: 0, lastHp: -1, lastCoins: -1 };

  H.init = function () {
    H.pie = $('hp-pie').getContext('2d');
    H.el = {
      coins: $('c-coins'), shards: $('c-shards'), gems: $('c-gems'), time: $('c-time'),
      toast: $('toast'), sign: $('sign'), area: $('area'), boss: $('bossbar'), bossPips: $('boss-pips'),
      gemget: $('gemget'), gemname: $('gem-name'), title: $('screen-title'), pause: $('screen-pause'),
      victory: $('screen-victory'), fade: $('fade'), hud: $('hud'), vstats: $('v-stats'), loading: $('loading'),
      gemlist: $('p-gems'), air: $('air-wrap'), airFill: $('air-fill'), prompt: $('prompt'),
    };
    H.promptText = '';
    H.lastAir = -1;
  };

  function drawPie(hp) {
    const c = H.pie, s = 96, cx = s / 2, cy = s / 2;
    c.clearRect(0, 0, s, s);
    const col = hp >= 6 ? '#3ec8ff' : hp >= 4 ? '#46d65a' : hp >= 2 ? '#ffd23a' : '#ff4a3a';
    c.beginPath(); c.arc(cx, cy, 44, 0, Math.PI * 2); c.fillStyle = '#1b2440'; c.fill();
    for (let i = 0; i < 8; i++) {
      const a0 = -Math.PI / 2 + (i / 8) * Math.PI * 2 + 0.05, a1 = -Math.PI / 2 + ((i + 1) / 8) * Math.PI * 2 - 0.05;
      c.beginPath(); c.moveTo(cx, cy); c.arc(cx, cy, 39, a0, a1); c.closePath();
      c.fillStyle = i < hp ? col : '#3a4566'; c.fill();
    }
    c.beginPath(); c.arc(cx, cy, 14, 0, Math.PI * 2); c.fillStyle = '#fff4d0'; c.fill();
    c.fillStyle = '#1b2440'; c.font = '800 16px "Lilita One", sans-serif'; c.textAlign = 'center'; c.textBaseline = 'middle';
    c.fillText(hp, cx, cy + 1);
  }

  H.update = function (dt) {
    const S = G.game.stats, pl = G.player;
    if (pl.hp !== H.lastHp) { drawPie(pl.hp); H.lastHp = pl.hp; }
    if (S.coins !== H.lastCoins) {
      H.el.coins.textContent = S.coins; H.lastCoins = S.coins;
      H.el.coins.parentElement.classList.remove('bump'); void H.el.coins.offsetWidth; H.el.coins.parentElement.classList.add('bump');
    }
    H.el.shards.textContent = S.shards + '/8';
    // air meter: only while submerged or refilling
    const air = pl.air == null ? 1 : pl.air, showAir = pl.state === 'uw' || air < 0.995;
    if (Math.abs(air - H.lastAir) > 0.003 || showAir !== H.airShown) {
      H.lastAir = air; H.airShown = showAir;
      H.el.air.classList.toggle('show', showAir);
      H.el.air.classList.toggle('low', air < 0.28);
      H.el.airFill.style.transform = 'scaleX(' + air.toFixed(3) + ')';
    }
    if (pl.state === 'uw' && air < 0.28) {
      H.airBeep = (H.airBeep || 0) - dt;
      if (H.airBeep <= 0) { H.airBeep = 0.9; G.audio.sfx.airLow(); }
    }
    H.el.gems.textContent = S.gems.length + '/' + G.level.GEMS.length;
    const t = Math.floor(G.game.time);
    H.el.time.textContent = Math.floor(t / 60) + ':' + String(t % 60).padStart(2, '0');
    // contextual button prompt (what E / Space would do right now)
    const pt = G.game.state === 'play' ? (pl.promptText || '') : '';
    if (pt !== H.promptText) {
      H.promptText = pt;
      if (pt) H.el.prompt.innerHTML = pt;
      H.el.prompt.classList.toggle('show', !!pt);
    }
    if (H.toastT > 0) { H.toastT -= dt; if (H.toastT <= 0) H.el.toast.classList.remove('show'); }
    if (H.signT > 0) { H.signT -= dt; if (H.signT <= 0) H.el.sign.classList.remove('show'); }
    if (H.areaT > 0) { H.areaT -= dt; if (H.areaT <= 0) H.el.area.classList.remove('show'); }
  };

  H.toast = function (text, dur) {
    H.el.toast.textContent = text; H.el.toast.classList.add('show'); H.toastT = dur || 2.6;
  };
  H.showSign = function (text) {
    if (H.el.sign.textContent !== text) H.el.sign.textContent = text;
    H.el.sign.classList.add('show'); H.signT = 0.25;
  };
  H.area = function (name) {
    H.el.area.textContent = name; H.el.area.classList.add('show'); H.areaT = 2.8;
  };
  H.bossBar = function (show, hp, max) {
    H.el.boss.classList.toggle('show', !!show);
    if (show) {
      H.el.bossPips.innerHTML = '';
      for (let i = 0; i < max; i++) {
        const d = document.createElement('span'); d.className = 'pip' + (i < hp ? ' on' : ''); H.el.bossPips.appendChild(d);
      }
    }
  };
  H.gemGet = function (name, show) {
    H.el.gemname.textContent = name || '';
    H.el.gemget.classList.toggle('show', show !== false);
  };
  H.screen = function (which) {
    ['title', 'pause', 'victory'].forEach((k) => { H.el[k].hidden = k !== which; });
    H.el.hud.classList.toggle('dim', !!which);
    if (which === 'pause') {
      const got = G.game.stats.gems;
      H.el.gemlist.innerHTML = G.level.GEMS.map((g) => `<li class="${got.includes(g.id) ? 'got' : ''}">${got.includes(g.id) ? '★' : '☆'} ${g.name}</li>`).join('');
    }
  };
  H.victory = function (stats) {
    const t = Math.floor(stats.time);
    H.el.vstats.innerHTML = `
      <div><dt>Time</dt><dd>${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}</dd></div>
      <div><dt>Sparks</dt><dd>${stats.coins}</dd></div>
      <div><dt>Sky Shards</dt><dd>${stats.shards}/8</dd></div>
      <div><dt>Sun Gems</dt><dd>${stats.gems.length}/${G.level.GEMS.length}</dd></div>
      <div><dt>Falls</dt><dd>${stats.deaths}</dd></div>`;
    H.screen('victory');
  };
  H.fade = function (on) { H.el.fade.classList.toggle('on', !!on); };

  G.hud = H;
})(window.G);

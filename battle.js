/* THE HEAT FRONT — a small turn-based tactics battle in the Shining Force
   mould. Four of the party take a 12x8 field against Heat Waves, a Frost
   Sprite and the Porch Sun. Move on a grid, attack in range, use a special,
   then the enemy takes its turn. Reachable from GORT or the roster.

   Opened by characters.js, which hands over the sprite generators so the
   fighters are the same pixel people who wander the page. Purely a game:
   it never touches the tool's state. */
(function () {
  'use strict';
  var COLS = 12, ROWS = 8;
  var MAP = [
    "....ff......",
    "..r.ff...r..",
    "............",
    "===========.",
    "............",
    "..r....ff...",
    ".......ff.r.",
    "............"
  ];
  var COST = { '.': 1, 'f': 2, '=': 1, 'r': 99 };
  var DEF_BONUS = { 'f': 1 };

  var ROSTER = {
    max:   { hp: 18, atk: 7, def: 3, mov: 5, range: 1, special: null },
    khris: { hp: 14, atk: 4, def: 2, mov: 4, range: 1, special: 'heal' },
    gort:  { hp: 24, atk: 6, def: 5, mov: 3, range: 1, special: 'insulate' },
    anri:  { hp: 12, atk: 5, def: 1, mov: 4, range: 2, special: null }
  };
  var SPECIAL_NAME = { heal: 'HEAL', insulate: 'INSULATE' };

  var WAVE = ["......rr........","....rrrrrr......","...rrryrrrr.....","..rryyyyyrrr....","..ryyeeyyrrr....","..ryyyyyyrrrr...","...rryyyrrrrr...","....rrrrrrr.....","...rrrrrrrrr....","..rrrr..rrrrr...","..rrr....rrrr...","................"];
  var SUN  = ["....yyyyyyy.....","...yyooooooyy...","..yyoorrrrooyy..","..yoorreerroy...","..yoorrrrrrooy..","..yyoorrrrooyy..","...yyooooooyy...","....yyyyyyy.....","..y...y.y...y...","................","................","................"];
  var ENEMIES = [
    { id: 'wave1', name: 'HEAT WAVE',   map: WAVE, pal: { r:'#e2453c', y:'#ffb347', e:'#16191c' }, hp: 10, atk: 5, def: 1, mov: 4, range: 1 },
    { id: 'wave2', name: 'HEAT WAVE',   map: WAVE, pal: { r:'#e2453c', y:'#ffb347', e:'#16191c' }, hp: 10, atk: 5, def: 1, mov: 4, range: 1 },
    { id: 'wave3', name: 'HEAT WAVE',   map: WAVE, pal: { r:'#e2453c', y:'#ffb347', e:'#16191c' }, hp: 10, atk: 5, def: 1, mov: 4, range: 1 },
    { id: 'frost', name: 'FROST SPRITE', map: WAVE, pal: { r:'#4aa3d8', y:'#d8f4ff', e:'#16191c' }, hp: 12, atk: 6, def: 2, mov: 3, range: 2 },
    { id: 'sun',   name: 'PORCH SUN',   map: SUN,  pal: { y:'#ffd34d', o:'#ff8c2b', r:'#e2453c', e:'#16191c' }, hp: 26, atk: 8, def: 3, mov: 2, range: 1, boss: true }
  ];
  var START_P = [[1, 2], [1, 4], [0, 3], [1, 6]];
  var START_E = [[10, 1], [11, 4], [10, 6], [9, 3], [11, 2]];

  function open(opts) {
    var stage = opts.stage, api = opts;
    var root = document.createElement('div');
    root.className = 'sfb';
    root.innerHTML =
      '<div class="sfb-frame">' +
        '<div class="sfb-top"><span class="sfb-title">&#9876; THE HEAT FRONT</span><span class="sfb-turn"></span><button type="button" class="sfb-close" aria-label="Leave the battle">&#10005;</button></div>' +
        '<div class="sfb-grid"></div>' +
        '<div class="sfb-bottom">' +
          '<div class="sfb-card"><div class="sfb-portrait"></div><div class="sfb-cardtext"><div class="sfb-name"></div><div class="sfb-stats"></div></div></div>' +
          '<div class="sfb-log"></div>' +
          '<div class="sfb-actions"></div>' +
        '</div>' +
        '<div class="sfb-banner"></div>' +
      '</div>';
    stage.appendChild(root);
    var grid = root.querySelector('.sfb-grid'), turnEl = root.querySelector('.sfb-turn');
    var cardP = root.querySelector('.sfb-portrait'), cardN = root.querySelector('.sfb-name'), cardS = root.querySelector('.sfb-stats');
    var logEl = root.querySelector('.sfb-log'), actEl = root.querySelector('.sfb-actions'), banner = root.querySelector('.sfb-banner');
    grid.style.gridTemplateColumns = 'repeat(' + COLS + ', var(--sfb-tile))';

    var tiles = [];
    for (var y = 0; y < ROWS; y++) for (var x = 0; x < COLS; x++) {
      var t = document.createElement('div');
      var ch = MAP[y][x];
      t.className = 'sfb-tile ' + ({ '.': 'grass', 'f': 'forest', 'r': 'rock', '=': 'road' })[ch];
      t.dataset.x = x; t.dataset.y = y;
      grid.appendChild(t); tiles.push(t);
    }
    function tileAt(x, y) { return tiles[y * COLS + x]; }

    var units = [];
    var castById = {}; opts.cast.forEach(function (c) { castById[c.id] = c; });
    Object.keys(ROSTER).forEach(function (id, i) {
      var ch = castById[id], base = ROSTER[id], sh = api.sheetFor(ch);
      units.push({ id: id, name: ch.name, side: 'p', hp: base.hp, maxHp: base.hp, atk: base.atk, def: base.def, mov: base.mov, range: base.range,
                   special: base.special, x: START_P[i][0], y: START_P[i][1], sprite: sh.url, sw: sh.w, sh: sh.h, n: sh.n, portrait: api.portraitFor(ch), acted: false, buff: 0 });
    });
    ENEMIES.forEach(function (e, i) {
      var url = api.svgUrl(api.rects(e.map, e.pal, 0, 0, 16), 16, 12);
      units.push({ id: e.id, name: e.name, side: 'e', hp: e.hp, maxHp: e.hp, atk: e.atk, def: e.def, mov: e.mov, range: e.range, boss: !!e.boss,
                   x: START_E[i][0], y: START_E[i][1], sprite: url, sw: 16, sh: 12, n: 1, portrait: url, acted: false, buff: 0 });
    });
    units.forEach(function (u) {
      var el = document.createElement('div');
      el.className = 'sfb-unit ' + (u.side === 'p' ? 'ally' : 'foe') + (u.boss ? ' boss' : '');
      el.style.backgroundImage = u.sprite;
      el.style.backgroundSize = (u.n * 100) + '% 100%';
      el.innerHTML = '<i class="sfb-hp"><b></b></i>';
      u.el = el; u.hpEl = el.querySelector('b');
      grid.appendChild(el);
      place(u);
    });

    var turn = 1, phase = 'select', active = null, reach = null, targets = [], over = false, busy = false;
    var log = function (msg) { logEl.textContent = msg; };

    function place(u) {
      u.el.style.setProperty('--gx', u.x); u.el.style.setProperty('--gy', u.y);
      u.hpEl.style.width = Math.max(0, Math.round(u.hp / u.maxHp * 100)) + '%';
      u.el.classList.toggle('low', u.hp <= u.maxHp / 3);
    }
    function alive(side) { return units.filter(function (u) { return u.hp > 0 && (!side || u.side === side); }); }
    function unitAt(x, y) { return units.filter(function (u) { return u.hp > 0 && u.x === x && u.y === y; })[0]; }
    function dist(a, b) { return Math.abs(a.x - b.x) + Math.abs(a.y - b.y); }
    function defOf(u) { return u.def + (DEF_BONUS[MAP[u.y][u.x]] || 0) + u.buff; }

    // reachable tiles by movement cost; allies can be passed through, enemies not
    function reachable(u) {
      var best = {}; best[u.x + ',' + u.y] = 0;
      var q = [[u.x, u.y, 0]];
      while (q.length) {
        var cur = q.shift();
        [[1,0],[-1,0],[0,1],[0,-1]].forEach(function (d) {
          var nx = cur[0] + d[0], ny = cur[1] + d[1];
          if (nx < 0 || ny < 0 || nx >= COLS || ny >= ROWS) return;
          var c = COST[MAP[ny][nx]]; if (c > 10) return;
          var occ = unitAt(nx, ny);
          if (occ && occ.side !== u.side) return;
          var nc = cur[2] + c; if (nc > u.mov) return;
          var k = nx + ',' + ny;
          if (best[k] !== undefined && best[k] <= nc) return;
          best[k] = nc; q.push([nx, ny, nc]);
        });
      }
      var out = {};
      Object.keys(best).forEach(function (k) { var p = k.split(',').map(Number); if (!unitAt(p[0], p[1]) || (p[0] === u.x && p[1] === u.y)) out[k] = true; });
      return out;
    }
    function clearMarks() { tiles.forEach(function (t) { t.classList.remove('reach', 'target', 'ally-target'); }); }
    function setCard(u) {
      if (!u) { cardP.style.backgroundImage = ''; cardN.textContent = ''; cardS.textContent = ''; return; }
      cardP.style.backgroundImage = u.portrait; cardP.style.backgroundSize = u.side === 'p' ? '100% 100%' : '100% 100%';
      cardN.textContent = u.name;
      cardS.textContent = 'HP ' + u.hp + '/' + u.maxHp + '  ATK ' + u.atk + '  DEF ' + defOf(u) + '  MOV ' + u.mov + (u.range > 1 ? '  RNG ' + u.range : '');
    }
    function turnText() { turnEl.textContent = 'TURN ' + turn + (phase === 'enemy' ? ' · THE HEAT FRONT MOVES' : ' · YOUR MOVE'); }

    /* ---- player phase ---- */
    function nextPlayer() {
      if (over) return;
      var pending = alive('p').filter(function (u) { return !u.acted; });
      if (!pending.length) { enemyPhase(); return; }
      active = pending[0]; phase = 'move';
      units.forEach(function (u) { u.el.classList.toggle('active', u === active); });
      reach = reachable(active);
      clearMarks();
      Object.keys(reach).forEach(function (k) { var p = k.split(',').map(Number); tileAt(p[0], p[1]).classList.add('reach'); });
      setCard(active); turnText();
      log(active.name + ': choose where to move, or stay put.');
      actEl.innerHTML = '';
      addAction('STAY HERE', function () { finishMove(); });
    }
    function addAction(label, fn, cls) {
      var b = document.createElement('button'); b.type = 'button'; b.className = 'sfb-btn' + (cls ? ' ' + cls : ''); b.textContent = label;
      b.addEventListener('click', function (ev) { ev.stopPropagation(); if (!busy && !over) fn(); });
      actEl.appendChild(b); return b;
    }
    function moveActive(x, y) {
      if (phase !== 'move' || !reach[x + ',' + y]) return;
      active.x = x; active.y = y; place(active);
      finishMove();
    }
    function finishMove() {
      phase = 'act'; clearMarks();
      targets = alive('e').filter(function (e) { return dist(active, e) <= active.range; });
      targets.forEach(function (e) { tileAt(e.x, e.y).classList.add('target'); });
      actEl.innerHTML = '';
      if (targets.length) log(active.name + ': pick a target' + (active.special ? ', use a special' : '') + ', or stay.');
      else log(active.name + ': nothing in range.' + (active.special ? ' A special, or stay.' : ''));
      targets.forEach(function (e) { addAction('ATTACK ' + e.name, function () { attack(active, e, endAction); }, 'atk'); });
      if (active.special === 'heal') {
        var hurt = alive('p').filter(function (u) { return dist(active, u) <= 1 && u.hp < u.maxHp; });
        hurt.forEach(function (u) { tileAt(u.x, u.y).classList.add('ally-target'); addAction('HEAL ' + u.name, function () { heal(active, u); }, 'sp'); });
      }
      if (active.special === 'insulate') addAction('INSULATE', function () { insulate(active); }, 'sp');
      addAction('STAY', function () { endAction(); });
    }
    function endAction() {
      active.acted = true; active.el.classList.remove('active');
      if (checkEnd()) return;
      nextPlayer();
    }

    /* ---- combat ---- */
    function attack(att, tgt, done) {
      busy = true;
      var dmg = Math.max(1, att.atk - defOf(tgt) + Math.floor(Math.random() * 3));
      var crit = Math.random() < 0.12; if (crit) dmg *= 2;
      att.el.classList.add(att.x <= tgt.x ? 'lunge-r' : 'lunge-l');
      setTimeout(function () {
        att.el.classList.remove('lunge-r', 'lunge-l');
        tgt.hp = Math.max(0, tgt.hp - dmg); place(tgt);
        tgt.el.classList.add('hit'); setTimeout(function () { tgt.el.classList.remove('hit'); }, 220);
        log(att.name + ' hits ' + tgt.name + ' for ' + dmg + (crit ? '. Critical!' : '.') + (tgt.hp <= 0 ? ' ' + tgt.name + (tgt.side === 'e' ? ' dissolves.' : ' falls.') : ''));
        if (tgt.hp <= 0) { tgt.el.classList.add('dead'); setTimeout(function () { tgt.el.style.display = 'none'; }, 400); }
        setTimeout(function () { busy = false; done(); }, 520);
      }, 240);
    }
    function heal(h, u) {
      busy = true;
      var amt = Math.min(u.maxHp - u.hp, 8);
      u.hp += amt; place(u);
      u.el.classList.add('healed'); setTimeout(function () { u.el.classList.remove('healed'); }, 500);
      log(h.name + ' heals ' + u.name + ' for ' + amt + '.');
      setTimeout(function () { busy = false; endAction(); }, 520);
    }
    function insulate(g) {
      busy = true;
      var who = alive('p').filter(function (u) { return dist(g, u) <= 1; });
      who.forEach(function (u) { u.buff = 3; u.el.classList.add('healed'); setTimeout(function () { u.el.classList.remove('healed'); }, 500); });
      log(g.name + ' insulates ' + who.length + ' of the party. DEF up until next turn.');
      setTimeout(function () { busy = false; endAction(); }, 520);
    }

    /* ---- enemy phase ---- */
    function enemyPhase() {
      phase = 'enemy'; active = null; clearMarks(); actEl.innerHTML = ''; setCard(null); turnText();
      units.forEach(function (u) { u.el.classList.remove('active'); });
      var foes = alive('e'), i = 0;
      function step() {
        if (over) return;
        if (i >= foes.length) {
          alive('p').forEach(function (u) { u.acted = false; u.buff = 0; });
          turn++; phase = 'select'; nextPlayer(); return;
        }
        var e = foes[i++]; if (e.hp <= 0) { step(); return; }
        var ps = alive('p'); if (!ps.length) { checkEnd(); return; }
        // walk toward the nearest player, then hit if in range
        var target = ps.slice().sort(function (a, b) { return dist(e, a) - dist(e, b); })[0];
        var r = reachable(e), bestK = e.x + ',' + e.y, bestD = dist(e, target);
        Object.keys(r).forEach(function (k) { var p = k.split(',').map(Number); var d = Math.abs(p[0] - target.x) + Math.abs(p[1] - target.y); if (d < bestD) { bestD = d; bestK = k; } });
        var np = bestK.split(',').map(Number); e.x = np[0]; e.y = np[1]; place(e);
        setCard(e);
        setTimeout(function () {
          var inRange = ps.filter(function (p) { return dist(e, p) <= e.range; }).sort(function (a, b) { return a.hp - b.hp; })[0];
          if (inRange) attack(e, inRange, function () { if (!checkEnd()) setTimeout(step, 200); });
          else { log(e.name + ' advances.'); setTimeout(step, 420); }
        }, 320);
      }
      setTimeout(step, 500);
    }

    /* ---- end states ---- */
    function checkEnd() {
      if (over) return true;
      if (!alive('e').length) { finish('win'); return true; }
      if (!alive('p').length) { finish('loss'); return true; }
      return false;
    }
    function finish(result) {
      over = true; phase = 'over'; clearMarks(); actEl.innerHTML = '';
      var exp = alive('p').map(function (u) { return u.name + ' +' + (12 + Math.floor(Math.random() * 9)) + ' EXP'; }).join('  ');
      banner.innerHTML = '<div class="sfb-banner-title">' + (result === 'win' ? 'VICTORY' : 'DEFEAT') + '</div>' +
        '<div class="sfb-banner-sub">' + (result === 'win' ? 'The Heat Front is broken. ' + exp : 'The party falls back to the dock.') + '</div>' +
        '<button type="button" class="sfb-btn sfb-banner-btn">RETURN</button>';
      banner.classList.add('on');
      banner.querySelector('.sfb-banner-btn').addEventListener('click', function (ev) { ev.stopPropagation(); close(result); });
    }
    function close(result) {
      if (root.parentNode) root.parentNode.removeChild(root);
      document.removeEventListener('keydown', onKey);
      if (opts.onClose) opts.onClose(result || 'quit');
    }
    function onKey(e) { if (e.key === 'Escape') close('quit'); }

    grid.addEventListener('click', function (ev) {
      ev.stopPropagation();
      if (busy || over) return;
      var t = ev.target.closest('.sfb-tile'), u = ev.target.closest('.sfb-unit');
      var x, y;
      if (u) { var hit = units.filter(function (q) { return q.el === u; })[0]; x = hit.x; y = hit.y; }
      else if (t) { x = +t.dataset.x; y = +t.dataset.y; }
      else return;
      var who = unitAt(x, y);
      if (phase === 'move') {
        if (who === active) { finishMove(); return; }
        if (who && who.side === 'e') { setCard(who); log(who.name + ' — HP ' + who.hp + '/' + who.maxHp + ', ATK ' + who.atk + ', DEF ' + defOf(who) + '.'); return; }
        moveActive(x, y);
      } else if (phase === 'act') {
        if (who && who.side === 'e' && targets.indexOf(who) >= 0) attack(active, who, endAction);
        else if (who && who.side === 'p' && active.special === 'heal' && who.hp < who.maxHp && dist(active, who) <= 1) heal(active, who);
      }
    });
    root.querySelector('.sfb-close').addEventListener('click', function (ev) { ev.stopPropagation(); close('quit'); });
    root.addEventListener('click', function (ev) { ev.stopPropagation(); });
    document.addEventListener('keydown', onKey);

    log('The Heat Front waits across the road. Move MAX first.');
    nextPlayer();

    var handle = { close: function () { close('quit'); } };
    // test hooks: read state, or nudge it, without touching the DOM
    handle.debug = { units: units, get phase() { return phase; }, get turn() { return turn; }, get active() { return active; },
                     moveTo: moveActive, finishMove: finishMove, endAction: endAction, attack: function (id) { var e = units.filter(function (u) { return u.id === id; })[0]; if (e) attack(active, e, endAction); } };
    window.SFBattle.current = handle;
    return handle;
  }

  window.SFBattle = { open: open, current: null };
})();

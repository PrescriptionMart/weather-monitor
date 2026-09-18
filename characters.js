/* A small Shining Force style party that lives along the bottom of the page.
   Four characters walk a strip of grass, react to what the tool just decided,
   and open a dialogue box when you click them.

   Every sprite and the terrain are generated here from pixel maps, so there
   are no image assets to ship or lose. The whole thing is decorative: it
   never blocks a click, never gates a verdict, and does not exist at all when
   the device asks for reduced motion. */
(function () {
  'use strict';
  if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

  var W = 16, H = 18, SCALE = 3, FRAME_MS = 120;

  /* ---- shared anatomy --------------------------------------------------
     Only the legs change between frames, so each character supplies a torso
     and everyone borrows the same gait. */
  var LEGS = {
    stride: ["......llll......", "......llll......", ".....oooooo....."],
    apart:  [".....ll..ll.....", ".....ll..ll.....", "....ooo..ooo...."],
    wide:   [".....ll..ll.....", "....ll....ll....", "...ooo....ooo..."],
    tuck:   ["....ll....ll....", "....oo....oo....", "................"]
  };
  var GAIT = ['apart', 'stride', 'wide', 'stride'];

  var CAST = [
    { id: 'max', name: 'MAX', role: 'Courier', speed: 0.055,
      pal: { c:'#1ebfbf', s:'#f0c08a', e:'#16191c', b:'#23405e', a:'#f0c08a', p:'#a9702f', t:'#e0c088', l:'#2f2f38', o:'#16191c' },
      body: ["......cccccc....",".....cccccccc...",".....cccccccc...",".....ssssssss...",
             ".....sessssss...",".....ssssssss...","......ssssss....","....bbbbbbbb....",
             "...abbbbbbbb....","...appppppp.....","...apttttpp.....","...apppppppp....",
             "....bbbbbbbb....",".....bbbbbb....."],
      lines: ['Next-day air, every day.', 'Packs still had ice. I checked.',
              'Two days late is usually nothing.', 'Mind the porch after dark.'] },

    { id: 'khris', name: 'KHRIS', role: 'Pharmacist', speed: 0.042,
      pal: { c:'#8b5a2b', s:'#f0c08a', e:'#16191c', b:'#f2f4f6', a:'#f0c08a', p:'#3fa34d', t:'#bfe8c6', l:'#4a5560', o:'#16191c' },
      body: [".....cccccc.....","....cccccccc....","....ccssssss....",".....ssssssss...",
             ".....sessssss...",".....ssssssss...","......ssssss....","....bbbbbbbb....",
             "...abbbbbbbb....","..tpbbbbbbbb....","..ppbbbbbbbb....","...bbbbbbbbb....",
             "....bbbbbbbb....",".....bbbbbb....."],
      lines: ['Slushy is the good one.', 'The label decides, not the weather.',
              'Ask when it went in the fridge.', 'Frozen solid? Check for crystals.'] },

    { id: 'gort', name: 'GORT', role: 'Pack Knight', speed: 0.032,
      pal: { c:'#9aa4ad', s:'#f0c08a', e:'#16191c', b:'#6e7a85', a:'#f0c08a', p:'#4aa3d8', t:'#bfe4f5', l:'#39434c', o:'#16191c' },
      body: [".....cccccc.....","....cccccccc....","....cccccccc....","....ccsssssc....",
             "....ccsessec....","....cccccccc....","......cccc......","...bbbbbbbbb....",
             "..abbbbbbbbb....","..apppppppp.....","..apttttttp.....","..appppppppp....",
             "...bbbbbbbbb....","....bbbbbbb....."],
      lines: ['Rated for forty-eight hours.', 'This cooler has never failed me.',
              'Winter pack at thirty-five.', 'Heavy, but it holds.'] },

    { id: 'anri', name: 'ANRI', role: 'Forecaster', speed: 0.048,
      pal: { c:'#6b4fa8', s:'#f0c08a', e:'#16191c', b:'#8464c4', a:'#f0c08a', p:'#c9a227', t:'#6ad3ff', l:'#463765', o:'#16191c' },
      body: [".......cc.......","......cccc......",".....cccccc.....","....cccccccc....",
             ".....ssssss.....",".....sesss......","......ssss......","....bbbbbbbb....",
             "...abbbbbbbb....","..tabbbbbbbb....","..pabbbbbbbbb...","..p.bbbbbbbbb...",
             "..p..bbbbbbbb...","......bbbbbb...."],
      lines: ['Memphis looks clear tonight.', 'I read the hourly, not the daily.',
              'A van in the sun runs hotter.', 'Station air is only a proxy.'] }
  ];

  function rects(rows, pal, ox, oy) {
    var out = '';
    rows.forEach(function (row, y) {
      var x = 0;
      while (x < W) {
        var ch = row[x];
        if (ch === '.' || ch === undefined) { x++; continue; }
        var run = 1;
        while (x + run < W && row[x + run] === ch) run++;
        out += '<rect x="' + (ox + x) + '" y="' + (oy + y) + '" width="' + run + '" height="1" fill="' + pal[ch] + '"/>';
        x += run;
      }
    });
    return out;
  }
  function svgUrl(inner, w, h) {
    return 'url("data:image/svg+xml;utf8,' + encodeURIComponent(
      '<svg xmlns="http://www.w3.org/2000/svg" width="' + w + '" height="' + h +
      '" shape-rendering="crispEdges">' + inner + '</svg>') + '")';
  }
  // six frames: four of gait, then idle, then a tucked hop
  function sheetFor(ch) {
    var poses = GAIT.concat(['stride', 'tuck']);
    var inner = '';
    poses.forEach(function (legKey, i) {
      var lift = legKey === 'tuck' ? 0 : 1;
      var rows = [];
      for (var k = 0; k < lift; k++) rows.push("................");
      rows = rows.concat(ch.body, LEGS[legKey]);
      while (rows.length < H) rows.push("................");
      inner += rects(rows.slice(0, H), ch.pal, i * W, 0);
    });
    return svgUrl(inner, W * poses.length, H);
  }
  // the head, blown up, is the dialogue portrait
  function portraitFor(ch) { return svgUrl(rects(ch.body.slice(0, 7), ch.pal, 0, 0), W, 7); }

  /* ---- terrain ----------------------------------------------------------
     The tile is plain turf only. Flowers and stones are scattered as separate
     sprites at random positions, because baking them into the tile makes the
     repeat obvious as a grid the moment it lays down more than twice. */
  function turfUrl() {
    var g = '<rect width="32" height="14" fill="#4f9c42"/>' +
            '<rect width="32" height="2" fill="#6ab357"/>';
    var blades = [[2,4],[7,9],[13,3],[19,11],[24,6],[29,8],[5,12],[16,5],[10,10],[26,4]];
    blades.forEach(function (b) {
      g += '<rect x="' + b[0] + '" y="' + b[1] + '" width="1" height="2" fill="#3d7d34"/>';
      g += '<rect x="' + (b[0] + 1) + '" y="' + (b[1] + 1) + '" width="1" height="1" fill="#5fa84f"/>';
    });
    return svgUrl(g, 32, 14);
  }
  var DECOR = {
    flower: '<rect x="1" y="2" width="1" height="3" fill="#3d7d34"/><rect x="0" y="1" width="3" height="1" fill="#f2d24b"/>' +
            '<rect x="1" y="0" width="1" height="1" fill="#fff3b0"/><rect x="1" y="2" width="1" height="1" fill="#fff3b0"/>',
    pink:   '<rect x="1" y="2" width="1" height="3" fill="#3d7d34"/><rect x="0" y="1" width="3" height="1" fill="#e57ba8"/>' +
            '<rect x="1" y="0" width="1" height="1" fill="#ffd0e4"/>',
    stone:  '<rect x="0" y="2" width="5" height="2" fill="#8d8f96"/><rect x="1" y="1" width="3" height="1" fill="#a9abb2"/>' +
            '<rect x="1" y="4" width="3" height="1" fill="#6d6f76"/>'
  };
  function scatter(stageEl) {
    var kinds = Object.keys(DECOR);
    var n = Math.max(6, Math.round(window.innerWidth / 130));
    for (var i = 0; i < n; i++) {
      var k = kinds[Math.floor(Math.random() * kinds.length)];
      var d = document.createElement('div');
      d.className = 'sf-decor';
      d.style.backgroundImage = svgUrl(DECOR[k], 5, 5);
      d.style.left = Math.round(Math.random() * 98) + '%';
      d.style.bottom = (3 + Math.round(Math.random() * 22)) + 'px';
      stageEl.appendChild(d);
    }
  }

  /* ---- build ------------------------------------------------------------ */
  var stage, box, boxPortrait, boxName, boxRole, boxText, boxChoices, actors = [], raf, last = 0;

  /* Dialogue queue. Two things often happen at once — a choice is made and a
     verdict follows from it — so lines take turns rather than one stomping
     the other. Clicking advances, which is what an RPG box is for. */
  var queue = [], showing = null, holdUntil = 0;
  function say(ch, text, choices) {
    if (choices) { queue = []; render(ch, text, choices); return; }   // a question jumps the line
    queue.push({ ch: ch, text: text });
    if (!showing) advance();
  }
  function advance() {
    var next = queue.shift();
    if (!next) { showing = null; closeBox(); return; }
    showing = next;
    holdUntil = Date.now() + 2400;
    render(next.ch, next.text, null);
  }
  function pumpQueue() {
    if (!showing || box.classList.contains('has-choices')) return;
    if (Date.now() >= holdUntil) advance();
  }
  function openBox(ch, text, choices) { say(ch, text, choices); }
  function render(ch, text, choices) {
    boxPortrait.style.backgroundImage = portraitFor(ch);
    boxName.textContent = ch.name;
    boxRole.textContent = ch.role;
    boxText.textContent = text;
    boxChoices.innerHTML = '';
    if (choices && choices.length) {
      choices.forEach(function (c) {
        var b = document.createElement('button');
        b.type = 'button'; b.className = 'sf-choice'; b.textContent = c.label;
        b.addEventListener('click', function (ev) { ev.stopPropagation(); closeBox(); c.fn(); });
        boxChoices.appendChild(b);
      });
    }
    box.classList.toggle('has-choices', !!(choices && choices.length));
    box.classList.add('on');
  }
  function closeBox() { if (box) { box.classList.remove('on'); box.classList.remove('has-choices'); } }

  function build() {
    stage = document.createElement('div');
    stage.className = 'sf-stage';
    var turf = document.createElement('div');
    turf.className = 'sf-turf';
    turf.style.backgroundImage = turfUrl();
    stage.appendChild(turf);
    scatter(stage);

    CAST.forEach(function (ch, i) {
      var el = document.createElement('button');
      el.type = 'button';
      el.className = 'sf-actor';
      el.setAttribute('aria-label', 'Talk to ' + ch.name + ', ' + ch.role);
      el.style.width = (W * SCALE) + 'px';
      el.style.height = (H * SCALE) + 'px';
      el.style.backgroundImage = sheetFor(ch);
      el.style.backgroundSize = (W * 6 * SCALE) + 'px ' + (H * SCALE) + 'px';
      stage.appendChild(el);
      var a = { ch: ch, el: el, x: 30 + i * 70, dir: 1, mode: 'walk', hold: 0, f: 0, acc: 0 };
      el.addEventListener('click', function (ev) {
        ev.stopPropagation();
        a.mode = 'hop'; a.hold = 520;
        if (ch.id === 'anri' && !game) {
          openBox(ch, 'Fancy a round of Ice Run? Catch the parcels before they land.',
            [{ label: 'YES', fn: startGame }, { label: 'NOT NOW', fn: closeBox }]);
        } else {
          openBox(ch, ch.lines[Math.floor(Math.random() * ch.lines.length)]);
        }
      });
      actors.push(a);
    });

    box = document.createElement('div');
    box.className = 'sf-box';
    box.innerHTML = '<div class="sf-portrait"></div><div class="sf-body">' +
      '<div class="sf-head"><span class="sf-name"></span><span class="sf-role"></span></div>' +
      '<p class="sf-text"></p><div class="sf-choices"></div></div><span class="sf-more">&#9660;</span>';
    boxPortrait = box.querySelector('.sf-portrait');
    boxName = box.querySelector('.sf-name');
    boxRole = box.querySelector('.sf-role');
    boxText = box.querySelector('.sf-text');
    boxChoices = box.querySelector('.sf-choices');
    box.addEventListener('click', function (ev) {
      ev.stopPropagation();
      if (box.classList.contains('has-choices')) return;   // answer it, do not skip it
      advance();
    });
    document.addEventListener('click', function () {
      if (!box.classList.contains('has-choices')) { queue = []; showing = null; closeBox(); }
    });

    stage.appendChild(box);
    document.body.appendChild(stage);
    raf = requestAnimationFrame(tick);
  }

  function tick(ts) {
    raf = requestAnimationFrame(tick);
    if (!last) last = ts;
    var dt = Math.min(64, ts - last); last = ts;
    var limit = window.innerWidth - W * SCALE - 10;
    stepGame(dt);
    pumpQueue();

    actors.forEach(function (a) {
      if (a.hold > 0) { a.hold -= dt; if (a.hold <= 0) a.mode = 'walk'; }
      if (a.mode === 'walk') {
        a.x += a.dir * dt * a.ch.speed;
        if (a.x > limit) { a.x = limit; a.dir = -1; }
        if (a.x < 6) { a.x = 6; a.dir = 1; }
        a.acc += dt;
        if (a.acc > FRAME_MS) { a.acc = 0; a.f = (a.f + 1) % 4; }
        if (Math.random() < 0.0012) { a.mode = 'idle'; a.hold = 1600 + Math.random() * 3000; }
      } else {
        a.f = a.mode === 'hop' ? 5 : 4;
      }
      a.el.style.transform = 'translateX(' + Math.round(a.x) + 'px) scaleX(' + a.dir + ')' +
        (a.mode === 'hop' ? ' translateY(-9px)' : '');
      a.el.style.backgroundPosition = '-' + (a.f * W * SCALE) + 'px 0';
    });
  }

  /* Named commentary: a page can hand a specific character a line, so the
     party reacts to what was just picked rather than only to the verdict. */
  window.partySay = function (who, text) {
    var a = actors.filter(function (x) { return x.ch.id === who; })[0];
    if (!a || !text) return;
    a.mode = 'idle'; a.hold = 2200;
    openBox(a.ch, text);
  };
  window.partyReady = function () { return actors.length > 0; };

  /* ---- ICE RUN ----------------------------------------------------------
     A small round of catch. Parcels arc across the turf and you click them
     before they land. Purely for fun, and only reachable from the party. */
  var PARCEL = '<rect width="9" height="9" fill="#a9702f"/><rect y="3" width="9" height="2" fill="#e0c088"/>' +
               '<rect x="3" width="2" height="9" fill="#e0c088"/><rect width="9" height="1" fill="#c98e42"/>' +
               '<rect y="8" width="9" height="1" fill="#7d5322"/>';
  var game = null;

  function rank(score) {
    if (score >= 14) return 'HERO OF THE COLD CHAIN';
    if (score >= 10) return 'PROMOTED';
    if (score >= 6) return 'STEADY HANDS';
    if (score >= 3) return 'APPRENTICE';
    return 'BACK TO THE DOCK';
  }

  function spawnParcel() {
    if (!game || !stage) return;
    var el = document.createElement('button');
    el.type = 'button';
    el.className = 'sf-parcel';
    el.setAttribute('aria-label', 'Catch the parcel');
    el.style.backgroundImage = svgUrl(PARCEL, 9, 9);
    var fromLeft = Math.random() < 0.5;
    var p = { el: el, t: 0, dur: 1500 + Math.random() * 900,
              x0: fromLeft ? -30 : window.innerWidth + 30,
              x1: fromLeft ? window.innerWidth + 30 : -30,
              peak: 90 + Math.random() * 70, done: false };
    el.addEventListener('click', function (ev) {
      ev.stopPropagation();
      if (p.done) return;
      p.done = true; game.score++;
      el.classList.add('caught');
      setTimeout(function () { el.remove(); }, 180);
      updateHud();
    });
    stage.appendChild(el);
    game.parcels.push(p);
  }

  function updateHud() {
    if (!game || !game.hud) return;
    game.hud.textContent = 'CAUGHT ' + game.score + '   MISSED ' + game.missed +
      '   ' + Math.max(0, Math.ceil(game.left / 1000)) + 's';
  }

  function endGame() {
    if (!game) return;
    var score = game.score;
    game.parcels.forEach(function (p) { p.el.remove(); });
    if (game.hud) game.hud.remove();
    game = null;
    var anri = actors.filter(function (x) { return x.ch.id === 'anri'; })[0];
    if (anri) openBox(anri.ch, 'Caught ' + score + '. ' + rank(score) + '!');
  }

  function startGame() {
    if (game || !stage) return;
    closeBox();
    game = { score: 0, missed: 0, left: 20000, next: 0, parcels: [], hud: document.createElement('div') };
    game.hud.className = 'sf-hud';
    stage.appendChild(game.hud);
    updateHud();
  }

  function stepGame(dt) {
    if (!game) return;
    game.left -= dt;
    game.next -= dt;
    if (game.next <= 0) { spawnParcel(); game.next = 620 + Math.random() * 520; }
    game.parcels.forEach(function (p) {
      if (p.done) return;
      p.t += dt;
      var k = p.t / p.dur;
      if (k >= 1) {
        p.done = true; game.missed++;
        p.el.remove();
        updateHud();
        return;
      }
      var x = p.x0 + (p.x1 - p.x0) * k;
      var y = Math.sin(Math.PI * k) * p.peak;
      p.el.style.transform = 'translate(' + Math.round(x) + 'px,' + Math.round(-y) + 'px) rotate(' + Math.round(k * 360) + 'deg)';
    });
    game.parcels = game.parcels.filter(function (p) { return !p.done; });
    updateHud();
    if (game.left <= 0) endGame();
  }

  /* Pages call this so the party responds to the tool rather than just
     looping. Whoever fits the moment speaks. */
  window.courierReact = function (mood, text) {
    if (!actors.length) return;
    var who = mood === 'good' ? 'max' : (mood === 'bad' ? 'khris' : 'anri');
    var a = actors.filter(function (x) { return x.ch.id === who; })[0] || actors[0];
    a.mode = mood === 'good' ? 'hop' : 'idle';
    a.hold = mood === 'good' ? 700 : 2600;
    if (text) openBox(a.ch, text);
  };

  function destroy() {
    if (raf) cancelAnimationFrame(raf);
    raf = null; last = 0; actors = []; game = null; queue = []; showing = null;
    if (stage && stage.parentNode) stage.parentNode.removeChild(stage);
    stage = null;
  }
  // The party is part of retro mode, so the page stays plain until someone
  // finds the code. Toggling the mode builds or tears it down live.
  function sync() {
    var on = document.documentElement.getAttribute('data-retro') === 'on';
    if (on && !stage) build();
    else if (!on && stage) destroy();
  }
  new MutationObserver(sync).observe(document.documentElement, { attributes: true, attributeFilter: ['data-retro'] });
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', sync);
  else sync();
})();

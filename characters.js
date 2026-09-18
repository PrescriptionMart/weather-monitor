/* A Shining Force style party that follows you around the Excursion Check.
   Nine characters wander the lower half of the page on their own, pair up to
   chat, charge a Heat Wave when a verdict says REPLACE, cheer when it says OK,
   and open a dialogue box when clicked. ANRI runs Ice Run; GORT runs the
   tactics battle in battle.js.

   Every sprite, tree, portrait and particle is generated here from pixel
   maps, so nothing ships as an image. It only exists in retro mode, it never
   intercepts a click meant for the page (only the sprites themselves are
   clickable), and it does not exist at all under prefers-reduced-motion. */
(function () {
  'use strict';
  if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

  var SCALE = 3;
  // The walk cycle advances per pixel travelled rather than per millisecond,
  // so a fast character strides faster instead of skating across the floor.
  var STRIDE_PX = 12;

  /* ---- shared anatomy ---------------------------------------------------- */
  var LEGS = {
    stride: ["......llll......", "......llll......", ".....oooooo....."],
    apart:  [".....ll..ll.....", ".....ll..ll.....", "....ooo..ooo...."],
    wide:   [".....ll..ll.....", "....ll....ll....", "...ooo....ooo..."],
    tuck:   ["....ll....ll....", "....oo....oo....", "................"]
  };
  var GAIT = ['apart', 'stride', 'wide', 'stride'];
  var SKIN = '#f0c08a', EYE = '#16191c', BOOT = '#16191c';

  var CAST = [
    { id:'max', name:'MAX', role:'Courier', speed:0.40, kind:'biped',
      pal:{ c:'#1ebfbf', s:SKIN, e:EYE, b:'#23405e', a:SKIN, p:'#a9702f', t:'#e0c088', l:'#2f2f38', o:BOOT },
      body:["......cccccc....",".....cccccccc...",".....cccccccc...",".....ssssssss...",".....sessssss...",".....ssssssss...","......ssssss....","....bbbbbbbb....","...abbbbbbbb....","...appppppp.....","...apttttpp.....","...apppppppp....","....bbbbbbbb....",".....bbbbbb....."],
      lines:['Next-day air, every day.','Packs still had ice. I checked.','Two days late is usually nothing.','Mind the porch after dark.','Lead on. I know the route.'] },
    { id:'khris', name:'KHRIS', role:'Pharmacist', speed:0.34, kind:'biped',
      pal:{ c:'#8b5a2b', s:SKIN, e:EYE, b:'#f2f4f6', a:SKIN, p:'#3fa34d', t:'#bfe8c6', l:'#4a5560', o:BOOT },
      body:[".....cccccc.....","....cccccccc....","....ccssssss....",".....ssssssss...",".....sessssss...",".....ssssssss...","......ssssss....","....bbbbbbbb....","...abbbbbbbb....","..tpbbbbbbbb....","..ppbbbbbbbb....","...bbbbbbbbb....","....bbbbbbbb....",".....bbbbbb....."],
      lines:['Slushy is the good one.','The label decides, not the weather.','Ask when it went in the fridge.','Frozen solid? Check for crystals.','I have a vial for everything.'] },
    { id:'gort', name:'GORT', role:'Pack Knight', speed:0.28, kind:'biped',
      pal:{ c:'#9aa4ad', s:SKIN, e:EYE, b:'#6e7a85', a:SKIN, p:'#4aa3d8', t:'#bfe4f5', l:'#39434c', o:BOOT },
      body:[".....cccccc.....","....cccccccc....","....cccccccc....","....ccsssssc....","....ccsessec....","....cccccccc....","......cccc......","...bbbbbbbbb....","..abbbbbbbbb....","..apppppppp.....","..apttttttp.....","..appppppppp....","...bbbbbbbbb....","....bbbbbbb....."],
      lines:['Rated for forty-eight hours.','This cooler has never failed me.','Winter pack at thirty-five.','Heavy, but it holds.','Stand behind me. I insulate.'] },
    { id:'anri', name:'ANRI', role:'Forecaster', speed:0.36, kind:'biped',
      pal:{ c:'#6b4fa8', s:SKIN, e:EYE, b:'#8464c4', a:SKIN, p:'#c9a227', t:'#6ad3ff', l:'#463765', o:BOOT },
      body:[".......cc.......","......cccc......",".....cccccc.....","....cccccccc....",".....ssssss.....",".....sesss......","......ssss......","....bbbbbbbb....","...abbbbbbbb....","..tabbbbbbbb....","..pabbbbbbbbb...","..p.bbbbbbbbb...","..p..bbbbbbbb...","......bbbbbb...."],
      lines:['Memphis looks clear tonight.','I read the hourly, not the daily.','A van in the sun runs hotter.','Station air is only a proxy.','Care for a game? Ask me.'] },
    { id:'hans', name:'HANS', role:'Route Scout', speed:0.42, kind:'biped',
      pal:{ c:'#2f7d3a', s:SKIN, e:EYE, b:'#4b6b3a', a:SKIN, p:'#8b5a2b', t:'#e0c088', l:'#33402a', o:BOOT },
      body:["......cccc......",".....cccccc.....","....cccccccc....","....ccssssss....","....ccsessss....","....ccssssss....",".....cssss......","....bbbbbbbb....","...abbbbbbbb....","..pabbbbbbbb....","..p.bbbbbbbb....","..p.bbbbbbbb....","..p.bbbbbbbb....",".....bbbbbb....."],
      lines:['I scouted the hub. All quiet.','Sort window is ten to four.','Ground stop at Memphis? Not tonight.','I see the whole lane from here.'] },
    { id:'luke', name:'LUKE', role:'Freezer Keeper', speed:0.26, kind:'biped',
      pal:{ c:'#c9a227', s:SKIN, e:EYE, b:'#6b3e26', a:SKIN, p:'#d2691e', t:'#d2691e', l:'#3a2a1c', o:BOOT },
      body:["................","................",".....cccccc.....","....cccccccc....","....ssssssss....","....sessssss....","....pppppppp....","....pppppppp....","...bbbbbbbbbb...","..abbbbbbbbbba..","..abbbbbbbbbba..","...bbbbbbbbbb...","...bbbbbbbbbb...","....bbbbbbbb...."],
      lines:['Thirty-six to forty-six. Always.','Polymer ice. Melts at thirty-two.','Nobody touches my freezer.','Short legs, cold hands.'] },
    { id:'zylo', name:'ZYLO', role:'Night Shift', speed:0.45, kind:'biped',
      pal:{ c:'#8a8f99', s:'#8a8f99', e:'#ffcc33', b:'#3d4553', a:'#8a8f99', p:'#3d4553', t:'#3d4553', l:'#5a606b', o:'#2a2f38' },
      body:["...cc....cc.....","...cccccccc.....","....cccccc......","....cecccc......","....cccccc......",".....cccc.......",".....cccc.......","....bbbbbbbb....","...abbbbbbbb....","...abbbbbbbb....","...abbbbbbbb....","....bbbbbbbb....","....bbbbbbbb....",".....bbbbbb....."],
      lines:['The sort runs while you sleep.','I can smell a warm parcel.','Overnight lows are my business.','Howl if you need me.'] },
    { id:'adam', name:'ADAM', role:'Pack-out Engine', speed:0.30, kind:'biped',
      pal:{ c:'#b8c0c8', s:'#b8c0c8', e:'#4ad1ff', b:'#7f8a94', a:'#b8c0c8', p:'#7f8a94', t:'#ff5c5c', l:'#5f6a74', o:'#3a4249' },
      body:[".......t........",".......t........","....cccccccc....","....cccccccc....","....ceeccee.....","....cccccccc....",".....cccccc.....","...bbbbbbbbbb...","..abbbbbbbbbba..","..abbttbbbttba..","..abbbbbbbbbba..","...bbbbbbbbbb...","...bbbbbbbbbb...","....bbbbbbbb...."],
      lines:['QUALIFIED. ISTA 7E. SUMMER AND WINTER.','GEL PACKS CONDITIONED.','I DO NOT SLEEP. I INSULATE.','MARGIN: FIVE DEGREES.'] },
    { id:'amon', name:'AMON', role:'Sky Scout', speed:0.50, kind:'bird',
      pal:{ w:'#e8e8f0', b:'#5a4e8c', e:'#ffd34d', t:'#f2a33a', l:'#f2a33a' },
      frames:[
        ["................","...w........w...","..www......www..","...wwwbbbbwww...","......bbbbbb....",".....bebbbbb....","....bbbbbbbbb...",".....tbbbbbb....","......bbbb......",".......bb.......","......l..l......","................"],
        ["................","................","................","......bbbb......",".....bebbbbb....","....bbbbbbbbb...","..wwwbbbbbbwww..","...wwwwbbwwww...","....ww.bb.ww....",".......bb.......","......l..l......","................"]],
      lines:['Clear skies over Louisville.','I can see the porch from here.','Hot roof on that van.','Wind out of the south, twelve knots.'] }
  ];

  /* ---- sprite generation -------------------------------------------------- */
  function rects(rows, pal, ox, oy, w) {
    var out = '';
    rows.forEach(function (row, y) {
      var x = 0;
      while (x < w) {
        var ch = row[x];
        if (ch === '.' || ch === undefined) { x++; continue; }
        var run = 1;
        while (x + run < w && row[x + run] === ch) run++;
        out += '<rect x="' + (ox + x) + '" y="' + (oy + y) + '" width="' + run + '" height="1" fill="' + pal[ch] + '"/>';
        x += run;
      }
    });
    return out;
  }
  function svgUrl(inner, w, h) {
    return 'url("data:image/svg+xml;utf8,' + encodeURIComponent(
      '<svg xmlns="http://www.w3.org/2000/svg" width="' + w + '" height="' + h + '" shape-rendering="crispEdges">' + inner + '</svg>') + '")';
  }
  function bipedFrames(ch) {
    var poses = GAIT.concat(['stride', 'tuck']);
    return poses.map(function (legKey) {
      var rows = legKey === 'tuck' ? [] : ["................"];
      rows = rows.concat(ch.body, LEGS[legKey]);
      while (rows.length < 18) rows.push("................");
      return rows.slice(0, 18);
    });
  }
  function sheetFor(ch) {
    var frames = ch.kind === 'bird' ? ch.frames : bipedFrames(ch);
    var w = 16, h = frames[0].length, inner = '';
    frames.forEach(function (rows, i) { inner += rects(rows, ch.pal, i * w, 0, w); });
    return { url: svgUrl(inner, w * frames.length, h), w: w, h: h, n: frames.length };
  }
  function portraitFor(ch) {
    var rows = ch.kind === 'bird' ? ch.frames[0].slice(2, 10) : ch.body.slice(0, 7);
    return svgUrl(rects(rows, ch.pal, 0, 0, 16), 16, rows.length);
  }

  /* ---- scenery ------------------------------------------------------------ */
  function turfUrl() {
    var g = '<rect width="32" height="14" fill="#4f9c42"/><rect width="32" height="2" fill="#6ab357"/>';
    [[2,4],[7,9],[13,3],[19,11],[24,6],[29,8],[5,12],[16,5],[10,10],[26,4]].forEach(function (b) {
      g += '<rect x="' + b[0] + '" y="' + b[1] + '" width="1" height="2" fill="#3d7d34"/>' +
           '<rect x="' + (b[0] + 1) + '" y="' + (b[1] + 1) + '" width="1" height="1" fill="#5fa84f"/>';
    });
    return svgUrl(g, 32, 14);
  }
  var TREE = ["......ccccc.....",".....ccccccc....","....ccccccccc...","...cccccccccccc.","...cdcccccccdcc.","....ccccccccc...","....dccccccccd..",".....ccccccc....","......ccccc.....","........tt......","........tt......","........tt......",".......tttt.....","......tttttt...."];
  var TREE_PAL = { c:'#3d8f3a', d:'#2f6b2c', t:'#6b3e26' };
  var DECOR = {
    flower: '<rect x="1" y="2" width="1" height="3" fill="#3d7d34"/><rect x="0" y="1" width="3" height="1" fill="#f2d24b"/><rect x="1" y="0" width="1" height="1" fill="#fff3b0"/>',
    pink:   '<rect x="1" y="2" width="1" height="3" fill="#3d7d34"/><rect x="0" y="1" width="3" height="1" fill="#e57ba8"/><rect x="1" y="0" width="1" height="1" fill="#ffd0e4"/>',
    stone:  '<rect x="0" y="2" width="5" height="2" fill="#8d8f96"/><rect x="1" y="1" width="3" height="1" fill="#a9abb2"/><rect x="1" y="4" width="3" height="1" fill="#6d6f76"/>',
    tuft:   '<rect x="0" y="3" width="1" height="2" fill="#3d7d34"/><rect x="2" y="2" width="1" height="3" fill="#3d7d34"/><rect x="4" y="3" width="1" height="2" fill="#5fa84f"/>'
  };
  var ENEMY = ["......rr........","....rrrrrr......","...rrryrrrr.....","..rryyyyyrrr....","..ryyeeyyrrr....","..ryyyyyyrrrr...","...rryyyrrrrr...","....rrrrrrr.....","...rrrrrrrrr....","..rrrr..rrrrr...","..rrr....rrrr...","................"];
  var ENEMY_PAL = { r:'#e2453c', y:'#ffb347', e:'#16191c' };
  var PARCEL = '<rect width="9" height="9" fill="#a9702f"/><rect y="3" width="9" height="2" fill="#e0c088"/><rect x="3" width="2" height="9" fill="#e0c088"/><rect width="9" height="1" fill="#c98e42"/><rect y="8" width="9" height="1" fill="#7d5322"/>';

  /* ---- state -------------------------------------------------------------- */
  var stage, box, boxPortrait, boxName, boxRole, boxText, boxChoices, roster, hud;
  var actors = [], raf = null, last = 0;
  var home = { x: 0, y: 0 };   // where the party gathers when nothing is happening
  var enemy = null, game = null, battleOpen = null;
  function openBattle() {
    if (!window.SFBattle || battleOpen || !stage) return;
    closeBox();
    battleOpen = window.SFBattle.open({
      stage: stage, cast: CAST, sheetFor: sheetFor, portraitFor: portraitFor, svgUrl: svgUrl, rects: rects,
      onClose: function (result) {
        battleOpen = null;
        var g = actorById('gort');
        if (result === 'win') { cheer(); if (g) openBox(g.ch, 'The Heat Front breaks! Every parcel on this lane arrives cold.'); }
        else if (result === 'loss') { if (g) openBox(g.ch, 'We fall back to the dock. The packs will be re-conditioned by morning.'); }
      }
    });
  }
  var queue = [], showing = null, holdUntil = 0;
  var chatterAt = 0;

  /* ---- dialogue queue ----------------------------------------------------- */
  function say(ch, text, choices) {
    if (choices) { queue = []; render(ch, text, choices); return; }
    queue.push({ ch: ch, text: text });
    if (!showing) advance();
  }
  function advance() {
    var next = queue.shift();
    if (!next) { showing = null; closeBox(); return; }
    showing = next; holdUntil = Date.now() + 2400;
    render(next.ch, next.text, null);
  }
  function pumpQueue() { if (showing && !box.classList.contains('has-choices') && Date.now() >= holdUntil) advance(); }
  function render(ch, text, choices) {
    boxPortrait.style.backgroundImage = portraitFor(ch);
    boxName.textContent = ch.name; boxRole.textContent = ch.role; boxText.textContent = text;
    boxChoices.innerHTML = '';
    (choices || []).forEach(function (c) {
      var b = document.createElement('button');
      b.type = 'button'; b.className = 'sf-choice'; b.textContent = c.label;
      b.addEventListener('click', function (ev) { ev.stopPropagation(); closeBox(); c.fn(); });
      boxChoices.appendChild(b);
    });
    box.classList.toggle('has-choices', !!(choices && choices.length));
    box.classList.add('on');
  }
  function openBox(ch, text, choices) { say(ch, text, choices); }
  function closeBox() { if (box) { box.classList.remove('on'); box.classList.remove('has-choices'); } }

  /* small over-head bubble for ambient chatter and reactions */
  function bubble(a, text, ms) {
    a.bub.textContent = text; a.bub.classList.add('on');
    clearTimeout(a.bubT);
    a.bubT = setTimeout(function () { a.bub.classList.remove('on'); }, ms || 2200);
  }

  /* ---- particles ------------------------------------------------------------ */
  function puff(x, y) {
    var d = document.createElement('div');
    d.className = 'sf-dust';
    d.style.transform = 'translate(' + Math.round(x) + 'px,' + Math.round(y) + 'px)';
    stage.appendChild(d);
    setTimeout(function () { d.remove(); }, 420);
  }
  function sparkle(x, y, n) {
    for (var i = 0; i < (n || 6); i++) {
      var s = document.createElement('div');
      s.className = 'sf-spark';
      s.style.setProperty('--dx', (Math.random() * 60 - 30) + 'px');
      s.style.setProperty('--dy', (-20 - Math.random() * 50) + 'px');
      s.style.transform = 'translate(' + Math.round(x) + 'px,' + Math.round(y) + 'px)';
      stage.appendChild(s);
      (function (el) { setTimeout(function () { el.remove(); }, 700); })(s);
    }
  }

  /* ---- build -------------------------------------------------------------- */
  function build() {
    stage = document.createElement('div');
    stage.className = 'sf-stage';

    var turf = document.createElement('div');
    turf.className = 'sf-turf'; turf.style.backgroundImage = turfUrl();
    stage.appendChild(turf);
    scenery();

    home.x = window.innerWidth / 2; home.y = window.innerHeight - 130;

    CAST.forEach(function (ch, i) {
      var sh = sheetFor(ch);
      var el = document.createElement('button');
      el.type = 'button'; el.className = 'sf-actor' + (ch.kind === 'bird' ? ' sf-bird' : '');
      el.setAttribute('aria-label', 'Talk to ' + ch.name + ', ' + ch.role);
      el.style.width = (sh.w * SCALE) + 'px'; el.style.height = (sh.h * SCALE) + 'px';
      el.style.backgroundImage = sh.url;
      el.style.backgroundSize = (sh.w * sh.n * SCALE) + 'px ' + (sh.h * SCALE) + 'px';
      var bub = document.createElement('div'); bub.className = 'sf-bubble';
      stage.appendChild(el); stage.appendChild(bub);
      var a = { ch: ch, el: el, bub: bub, sh: sh, x: 40 + (i / CAST.length) * (window.innerWidth - 100), y: home.y + (i % 2) * 30,
                dir: 1, f: 0, acc: 0, moving: false, hop: 0, bob: Math.random() * 6, stepAcc: 0,
                tx: 0, ty: 0, wait: 800 + Math.random() * 3000, ang: Math.random() * 6.28 };
      a.tx = a.x; a.ty = a.y;
      el.addEventListener('click', function (ev) {
        ev.stopPropagation();
        a.hop = 480;
        if (ch.id === 'anri' && !game) {
          openBox(ch, 'Fancy a round of Ice Run? Catch the parcels before they land.',
            [{ label: 'YES', fn: startGame }, { label: 'NOT NOW', fn: closeBox }]);
        } else if (ch.id === 'gort' && window.SFBattle && !battleOpen) {
          openBox(ch, 'The Heat Front is massing past the porch. Shall we take the field?',
            [{ label: 'TO BATTLE', fn: openBattle }, { label: 'NOT NOW', fn: closeBox }]);
        } else {
          openBox(ch, ch.lines[Math.floor(Math.random() * ch.lines.length)]);
        }
      });
      actors.push(a);
    });

    box = document.createElement('div');
    box.className = 'sf-box';
    box.innerHTML = '<div class="sf-portrait"></div><div class="sf-body"><div class="sf-head"><span class="sf-name"></span><span class="sf-role"></span></div><p class="sf-text"></p><div class="sf-choices"></div></div><span class="sf-more">&#9660;</span>';
    boxPortrait = box.querySelector('.sf-portrait'); boxName = box.querySelector('.sf-name');
    boxRole = box.querySelector('.sf-role'); boxText = box.querySelector('.sf-text'); boxChoices = box.querySelector('.sf-choices');
    box.addEventListener('click', function (ev) { ev.stopPropagation(); if (!box.classList.contains('has-choices')) advance(); });
    document.addEventListener('click', onDocClick);
    stage.appendChild(box);

    roster = document.createElement('div');
    roster.className = 'sf-roster';
    roster.innerHTML = '<div class="sf-roster-title">PARTY</div><button type="button" class="sf-roster-battle">&#9876; BATTLE</button>' + CAST.map(function (ch) {
      return '<button type="button" class="sf-roster-row" data-id="' + ch.id + '"><span class="sf-roster-dot"></span>' + ch.name + '<span class="sf-roster-role">' + ch.role + '</span></button>';
    }).join('');
    roster.addEventListener('click', function (ev) {
      if (ev.target.closest('.sf-roster-battle')) { ev.stopPropagation(); openBattle(); return; }
      var row = ev.target.closest('.sf-roster-row');
      if (!row) return;
      ev.stopPropagation();
      var a = actorById(row.getAttribute('data-id'));
      if (a) { a.hop = 480; sparkle(a.x + 24, a.y + 10, 5); openBox(a.ch, a.ch.lines[Math.floor(Math.random() * a.ch.lines.length)]); }
    });
    stage.appendChild(roster);
    CAST.forEach(function (ch) {
      var dot = roster.querySelector('[data-id="' + ch.id + '"] .sf-roster-dot');
      if (dot) dot.style.backgroundImage = portraitFor(ch);
    });

    document.body.appendChild(stage);
    last = 0; chatterAt = Date.now() + 5000;
    raf = requestAnimationFrame(tick);
  }

  function scenery() {
    var w = window.innerWidth, h = window.innerHeight;
    var treeUrl = svgUrl(rects(TREE, TREE_PAL, 0, 0, 16), 16, 14);
    var spots = [];
    // a line of trees along the bottom, and columns in the gutters on wide screens
    for (var x = 10; x < w; x += 140 + Math.random() * 120) spots.push([x, h - 44 - Math.random() * 8]);
    if (w > 1150) {
      var gutter = (w - 1200) / 2;
      for (var y = 120; y < h - 120; y += 110 + Math.random() * 90) {
        spots.push([Math.random() * Math.max(10, gutter - 60), y]);
        spots.push([w - 60 - Math.random() * Math.max(10, gutter - 60), y]);
      }
    }
    spots.forEach(function (s) {
      var t = document.createElement('div');
      t.className = 'sf-tree'; t.style.backgroundImage = treeUrl;
      t.style.transform = 'translate(' + Math.round(s[0]) + 'px,' + Math.round(s[1] - 42) + 'px)';
      stage.appendChild(t);
    });
    var kinds = Object.keys(DECOR), n = Math.max(10, Math.round(w / 90));
    for (var i = 0; i < n; i++) {
      var d = document.createElement('div');
      d.className = 'sf-decor';
      d.style.backgroundImage = svgUrl(DECOR[kinds[Math.floor(Math.random() * kinds.length)]], 5, 5);
      d.style.left = Math.round(Math.random() * 98) + '%';
      d.style.bottom = (3 + Math.round(Math.random() * 24)) + 'px';
      stage.appendChild(d);
    }
  }

  function actorById(id) { return actors.filter(function (a) { return a.ch.id === id; })[0]; }
  function onDocClick() { if (box && !box.classList.contains('has-choices')) { queue = []; showing = null; closeBox(); } }

  /* ---- movement: they wander on their own ----------------------------------
     Each character picks a spot in the lower half of the page, ambles there,
     waits a while, picks another. Now and then two of them meet up and trade a
     line. Nothing here reads the cursor. */
  function clampY(y) { return Math.max(70, Math.min(window.innerHeight - 70, y)); }
  function clampX(x) { return Math.max(4, Math.min(window.innerWidth - 52, x)); }
  function pickSpot(a) {
    var w = window.innerWidth, h = window.innerHeight;
    if (Math.random() < 0.25 && actors.length > 1) {          // go visit someone
      var other = actors[Math.floor(Math.random() * actors.length)];
      if (other !== a && other.ch.kind !== 'bird') { a.tx = clampX(other.x + (Math.random() < 0.5 ? -46 : 46)); a.ty = clampY(other.y); a.visiting = other; return; }
    }
    a.visiting = null;
    a.tx = clampX(20 + Math.random() * (w - 70));
    a.ty = clampY(h * 0.5 + Math.random() * (h * 0.5 - 90));
  }

  function tick(ts) {
    raf = requestAnimationFrame(tick);
    if (!last) last = ts;
    var dt = Math.min(64, ts - last); last = ts;
    var now = Date.now();
    var paused = !!battleOpen;

    actors.forEach(function (a) {
      var tx, ty, stop;
      if (paused) { tx = a.x; ty = a.y; stop = 0; }
      else if (enemy && a.charge) { tx = enemy.x - (a.dir > 0 ? 40 : -40); ty = enemy.y; stop = 6; }
      else if (a.ch.kind === 'bird') {
        a.ang += dt * 0.0006;
        tx = home.x + Math.cos(a.ang) * (window.innerWidth * 0.32); ty = home.y - 150 + Math.sin(a.ang * 2) * 40; stop = 4;
      } else {
        if (a.wait > 0) { a.wait -= dt; }
        else if (!a.moving && Math.hypot(a.tx - a.x, a.ty - a.y) < 6) { pickSpot(a); }
        tx = a.tx; ty = a.ty; stop = 3;
        if (a.wait > 0) { tx = a.x; ty = a.y; }
      }
      ty = clampY(ty); tx = clampX(tx);
      var dx = tx - a.x, dy = ty - a.y, dist = Math.sqrt(dx * dx + dy * dy);
      var wasMoving = a.moving;
      a.moving = dist > stop;
      if (a.moving) {
        var step = Math.min(dist - stop, a.ch.speed * dt);
        a.x += dx / dist * step; a.y += dy / dist * step;
        if (Math.abs(dx) > 2) a.dir = dx > 0 ? 1 : -1;
        a.acc += step;
        if (a.acc > STRIDE_PX) { a.acc = 0; a.f = (a.f + 1) % 4; }
        a.stepAcc += step;
        if (a.ch.kind !== 'bird' && a.stepAcc > 26) { a.stepAcc = 0; puff(a.x + 16, a.y + 46); }
      } else {
        a.f = a.ch.kind === 'bird' ? a.f : 4;
        if (wasMoving && a.ch.kind !== 'bird') {
          a.wait = 1500 + Math.random() * 4000;
          if (a.visiting) { a.dir = a.visiting.x > a.x ? 1 : -1; a.visiting.dir = -a.dir; bubble(a, a.ch.lines[Math.floor(Math.random() * a.ch.lines.length)]); }
        }
        if (a.ch.kind !== 'bird' && Math.random() < 0.0012) a.dir = -a.dir;   // idle glance
      }
      if (a.ch.kind === 'bird') { a.bob += dt; if (a.bob > 140) { a.bob = 0; a.f = (a.f + 1) % 2; } }
      if (a.hop > 0) { a.hop -= dt; }

      var lift = a.hop > 0 ? -10 : 0;
      var frame = a.hop > 0 && a.ch.kind !== 'bird' ? 5 : a.f;
      a.el.style.transform = 'translate(' + Math.round(a.x) + 'px,' + Math.round(a.y + lift) + 'px) scaleX(' + a.dir + ')';
      a.el.style.backgroundPosition = '-' + (frame * a.sh.w * SCALE) + 'px 0';
      a.bub.style.transform = 'translate(' + Math.round(a.x + 24) + 'px,' + Math.round(a.y - 10) + 'px)';
    });

    stepEnemy(dt);
    stepGame(dt);
    pumpQueue();

    // the party talks among itself now and then
    if (now > chatterAt && !game && !enemy) {
      var a = actors[Math.floor(Math.random() * actors.length)];
      bubble(a, a.ch.lines[Math.floor(Math.random() * a.ch.lines.length)]);
      chatterAt = now + 7000 + Math.random() * 9000;
    }
  }

  /* ---- Heat Wave encounter ------------------------------------------------ */
  function spawnEnemy() {
    if (enemy || !stage) return;
    var v = document.getElementById('verdict');
    var r = v ? v.getBoundingClientRect() : { left: window.innerWidth / 2, top: window.innerHeight / 2, width: 0, height: 0 };
    var el = document.createElement('div');
    el.className = 'sf-enemy';
    el.style.backgroundImage = svgUrl(rects(ENEMY, ENEMY_PAL, 0, 0, 16), 16, 12);
    stage.appendChild(el);
    enemy = { el: el, x: clampX(r.left + r.width / 2 + 60), y: clampY(r.top + r.height / 2), hp: 3, hitAt: 0, bornAt: Date.now() };
    el.style.transform = 'translate(' + Math.round(enemy.x) + 'px,' + Math.round(enemy.y) + 'px)';
    actors.forEach(function (a, i) { a.charge = i < 4 && a.ch.kind !== 'bird'; });
    var g = actorById('gort'); if (g) bubble(g, 'Heat wave! On me!');
  }
  function stepEnemy(dt) {
    if (!enemy) return;
    var now = Date.now();
    actors.forEach(function (a) {
      if (!a.charge || now - enemy.hitAt < 320) return;
      var d = Math.hypot(a.x - enemy.x, a.y - enemy.y);
      if (d < 52) {
        enemy.hp--; enemy.hitAt = now; a.hop = 300;
        enemy.el.classList.add('hit'); setTimeout(function () { enemy && enemy.el.classList.remove('hit'); }, 200);
        sparkle(enemy.x + 24, enemy.y + 10, 4);
        if (enemy.hp <= 0) { defeatEnemy(); }
      }
    });
    if (enemy && now - enemy.bornAt > 9000) defeatEnemy();   // never let one linger
  }
  function defeatEnemy() {
    if (!enemy) return;
    var e = enemy; enemy = null;
    e.el.classList.add('down');
    sparkle(e.x + 24, e.y + 10, 12);
    setTimeout(function () { e.el.remove(); }, 500);
    actors.forEach(function (a) { a.charge = false; a.hop = 500; });
    var g = actorById('gort'); if (g) openBox(g.ch, 'Heat wave down. Replacement is on its way.');
  }
  function cheer() {
    actors.forEach(function (a, i) { setTimeout(function () { a.hop = 480; sparkle(a.x + 24, a.y + 6, 4); }, i * 70); });
  }

  /* ---- Ice Run ----------------------------------------------------------- */
  function rank(s) { return s >= 14 ? 'HERO OF THE COLD CHAIN' : s >= 10 ? 'PROMOTED' : s >= 6 ? 'STEADY HANDS' : s >= 3 ? 'APPRENTICE' : 'BACK TO THE DOCK'; }
  function startGame() {
    if (game || !stage) return;
    closeBox();
    game = { score: 0, missed: 0, left: 20000, next: 0, parcels: [] };
    hud = document.createElement('div'); hud.className = 'sf-hud'; stage.appendChild(hud); updateHud();
  }
  function updateHud() { if (game && hud) hud.textContent = 'CAUGHT ' + game.score + '   MISSED ' + game.missed + '   ' + Math.max(0, Math.ceil(game.left / 1000)) + 's'; }
  function spawnParcel() {
    var el = document.createElement('button');
    el.type = 'button'; el.className = 'sf-parcel'; el.setAttribute('aria-label', 'Catch the parcel');
    el.style.backgroundImage = svgUrl(PARCEL, 9, 9);
    var fromLeft = Math.random() < 0.5;
    var p = { el: el, t: 0, dur: 1500 + Math.random() * 900, x0: fromLeft ? -30 : window.innerWidth + 30,
              x1: fromLeft ? window.innerWidth + 30 : -30, peak: 90 + Math.random() * 70, done: false };
    el.addEventListener('click', function (ev) {
      ev.stopPropagation(); if (p.done) return;
      p.done = true; game.score++; el.classList.add('caught');
      setTimeout(function () { el.remove(); }, 180); updateHud();
    });
    stage.appendChild(el); game.parcels.push(p);
  }
  function stepGame(dt) {
    if (!game) return;
    game.left -= dt; game.next -= dt;
    if (game.next <= 0) { spawnParcel(); game.next = 620 + Math.random() * 520; }
    game.parcels.forEach(function (p) {
      if (p.done) return;
      p.t += dt; var k = p.t / p.dur;
      if (k >= 1) { p.done = true; game.missed++; p.el.remove(); return; }
      var x = p.x0 + (p.x1 - p.x0) * k, y = Math.sin(Math.PI * k) * p.peak;
      p.el.style.transform = 'translate(' + Math.round(x) + 'px,' + Math.round(-y) + 'px) rotate(' + Math.round(k * 360) + 'deg)';
    });
    game.parcels = game.parcels.filter(function (p) { return !p.done; });
    updateHud();
    if (game.left <= 0) endGame();
  }
  function endGame() {
    if (!game) return;
    var score = game.score;
    game.parcels.forEach(function (p) { p.el.remove(); });
    if (hud) hud.remove(); hud = null; game = null;
    var a = actorById('anri'); if (a) openBox(a.ch, 'Caught ' + score + '. ' + rank(score) + '!');
    if (score >= 6) cheer();
  }

  /* ---- page hooks ------------------------------------------------------------ */
  window.partySay = function (who, text) {
    var a = actorById(who); if (!a || !text) return;
    a.hop = 300; openBox(a.ch, text);
  };
  window.partyReady = function () { return actors.length > 0; };
  window.courierReact = function (mood, text) {
    if (!actors.length) return;
    if (mood === 'bad') { spawnEnemy(); return; }
    if (mood === 'good') { cheer(); }
    var who = mood === 'good' ? 'max' : 'anri';
    var a = actorById(who) || actors[0];
    if (text) bubble(a, text, 2600);
  };

  /* ---- lifecycle ------------------------------------------------------------- */
  function destroy() {
    if (raf) cancelAnimationFrame(raf);
    if (battleOpen && battleOpen.close) battleOpen.close();
    raf = null; last = 0; actors = []; game = null; enemy = null; queue = []; showing = null; hud = null; battleOpen = null;
    document.removeEventListener('click', onDocClick);
    if (stage && stage.parentNode) stage.parentNode.removeChild(stage);
    stage = null;
  }
  function sync() {
    var on = document.documentElement.getAttribute('data-retro') === 'on';
    if (on && !stage) build(); else if (!on && stage) destroy();
  }
  new MutationObserver(sync).observe(document.documentElement, { attributes: true, attributeFilter: ['data-retro'] });
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', sync); else sync();
})();

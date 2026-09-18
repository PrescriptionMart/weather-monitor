/* Playful extras, all optional and all reversible.
   - Konami code, or five taps on the logo mark for phones, flips retro mode.
   - Retro mode is remembered per browser and announced with a title card.
   - The pixel parcel sprite is inlined here so no image file is needed. */
(function () {
  'use strict';
  var KEY = 'retro-mode';
  var FONT = 'https://fonts.googleapis.com/css2?family=Press+Start+2P&display=swap';
  var CODE = ['arrowup','arrowup','arrowdown','arrowdown','arrowleft','arrowright','arrowleft','arrowright','b','a'];
  var pos = 0, taps = 0, tapTimer = null;

  // The pixel font is only ever needed in retro mode, so it is fetched on
  // demand rather than on every page load.
  function ensureFont() {
    if (document.getElementById('retro-font')) return;
    var l = document.createElement('link');
    l.id = 'retro-font'; l.rel = 'stylesheet'; l.href = FONT;
    document.head.appendChild(l);
  }

  function announce(on) {
    var t = document.createElement('div');
    t.className = 'retro-toast';
    t.innerHTML = '<span>' + (on ? '&#9733; RETRO MODE &#9733;<br>ENGAGED' : 'RETRO MODE<br>OFF') + '</span>';
    document.body.appendChild(t);
    setTimeout(function () { t.remove(); }, 1900);
  }

  function setRetro(on, quiet) {
    if (on) { ensureFont(); document.documentElement.setAttribute('data-retro', 'on'); }
    else { document.documentElement.removeAttribute('data-retro'); }
    try { localStorage.setItem(KEY, on ? 'on' : 'off'); } catch (e) {}
    if (!quiet) announce(on);
  }

  function toggle() { setRetro(document.documentElement.getAttribute('data-retro') !== 'on'); }

  document.addEventListener('keydown', function (e) {
    if (!e.key) return;
    var k = e.key.toLowerCase();
    // a wrong key restarts the sequence, unless it is the first key again
    pos = (k === CODE[pos]) ? pos + 1 : (k === CODE[0] ? 1 : 0);
    if (pos === CODE.length) { pos = 0; toggle(); }
  });

  // phones have no keyboard: five taps on the header mark does the same
  document.addEventListener('click', function (e) {
    var h1 = e.target.closest && e.target.closest('.header .h1');
    if (!h1) { taps = 0; return; }
    taps++;
    clearTimeout(tapTimer);
    tapTimer = setTimeout(function () { taps = 0; }, 1200);
    if (taps >= 5) { taps = 0; toggle(); }
  });

  // restore silently on load
  try { if (localStorage.getItem(KEY) === 'on') setRetro(true, true); } catch (e) {}

  // a small brown parcel with lighter tape, drawn at 9x9 so it stays crisp
  // encodeURIComponent handles the # itself — pre-escaping it to %23 here
  // would come back out as %2523 and the whole sprite would render black.
  window.PIXEL_PARCEL = 'data:image/svg+xml;utf8,' + encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" width="9" height="9" shape-rendering="crispEdges">' +
    '<rect width="9" height="9" fill="#a9702f"/>' +
    '<rect y="3" width="9" height="2" fill="#e0c088"/>' +
    '<rect x="3" width="2" height="9" fill="#e0c088"/>' +
    '<rect width="9" height="1" fill="#c98e42"/>' +
    '<rect y="8" width="9" height="1" fill="#7d5322"/></svg>');

  // fill any pixel loader on the page
  document.addEventListener('DOMContentLoaded', function () {
    Array.prototype.forEach.call(document.querySelectorAll('.pixel-loader .parcel'), function (el) {
      el.style.backgroundImage = 'url("' + window.PIXEL_PARCEL + '")';
      el.style.backgroundSize = '100% 100%';
    });
  });
})();

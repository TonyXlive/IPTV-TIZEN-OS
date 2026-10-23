/*
 * Test de bout en bout de Canapé TV (Samsung Tizen), dans Chromium à 1920×1080.
 * On imite ce que fournit la TV : l'objet « tizen » (touches, sortie) et le lecteur « webapis.avplay ».
 * Chromium est lancé sans contrôle CORS, comme le moteur des applis Tizen avec <access origin="*">.
 * Pré-requis : node tests/fake-provider.js (port 9100).   Usage : node tests/e2e-tizen.js [m3u|xtream]
 */
'use strict';
var path = require('path');
var fs = require('fs');
var playwright = require(process.env.PW_PATH || 'playwright');

var SCENARIO = process.argv[2] || 'm3u';
var APP = 'file://' + path.resolve(__dirname, '../app/index.html');
var SHOTS = path.resolve(__dirname, 'captures');
var PROVIDER = 'http://127.0.0.1:9100';
fs.mkdirSync(SHOTS, { recursive: true });

var KEYS = { LEFT: 37, UP: 38, RIGHT: 39, DOWN: 40, OK: 13, BACK: 10009, RED: 403, GREEN: 404, CHUP: 427, CHDOWN: 428, PLAYPAUSE: 10252 };

var passed = 0, failed = 0;
function ok(cond, label) {
  if (cond) { passed++; console.log('  ✓ ' + label); } else { failed++; console.log('  ✗ ÉCHEC : ' + label); }
}
function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }

var TIZEN_MOCK = function () {
  var log = window.__av = [];
  window.__keys = [];
  window.__exited = 0;
  window.tizen = {
    tvinputdevice: {
      getSupportedKeys: function () { return ['ColorF0Red', 'ColorF1Green', 'ChannelUp', 'ChannelDown', 'MediaPlayPause', '0', '1'].map(function (n) { return { name: n }; }); },
      registerKeyBatch: function (l) { window.__keys = l.slice(); }
    },
    application: { getCurrentApplication: function () { return { exit: function () { window.__exited++; } }; } }
  };
  var listener = null, state = 'NONE', timer = null, t = 0, url = '';
  var tracks = [
    { type: 'VIDEO', index: 0, extra_info: '{}' },
    { type: 'AUDIO', index: 1, extra_info: '{"language":"fre"}' },
    { type: 'AUDIO', index: 2, extra_info: '{"language":"eng"}' },
    { type: 'TEXT', index: 3, extra_info: '{"language":"fre"}' }
  ];
  window.webapis = { avplay: {
    open: function (u) { url = u; state = 'IDLE'; t = 0; log.push('open ' + u); },
    close: function () { clearInterval(timer); state = 'NONE'; log.push('close'); },
    stop: function () { clearInterval(timer); state = 'IDLE'; log.push('stop'); },
    setDisplayRect: function () {}, setDisplayMethod: function () {}, setTimeoutForBuffering: function () {},
    setListener: function (l) { listener = l; },
    prepareAsync: function (ok, ko) {
      setTimeout(function () {
        if (/introuvable|9999/.test(url)) return ko && ko('PLAYER_ERROR_CONNECTION_FAILED');
        state = 'READY'; ok();
      }, 50);
    },
    play: function () {
      state = 'PLAYING'; log.push('play');
      listener.onbufferingstart(); setTimeout(function () { listener.onbufferingcomplete(); }, 30);
      clearInterval(timer);
      timer = setInterval(function () { t += 250; listener.oncurrentplaytime(t); }, 250);
    },
    pause: function () { state = 'PAUSED'; clearInterval(timer); log.push('pause'); },
    seekTo: function (ms, ok) { t = ms; log.push('seek ' + ms); setTimeout(ok, 10); },
    getDuration: function () { return /\/live\//.test(url) || /\.m3u8$/.test(url) ? 0 : 3600000; },
    getCurrentTime: function () { return t; },
    getState: function () { return state; },
    getTotalTrackInfo: function () { return tracks; },
    getCurrentStreamInfo: function () { return [{ type: 'AUDIO', index: 1 }]; },
    setSelectTrack: function (type, i) { log.push('track ' + type + ' ' + i); },
    setSilentSubtitle: function (b) { log.push('silent ' + b); if (!b) setTimeout(function () { listener.onsubtitlechange(2000, 'Bonjour le monde'); }, 50); },
    suspend: function () { log.push('suspend'); }, restore: function () { log.push('restore'); }
  } };
};

async function main() {
  var browser = await playwright.chromium.launch({
    executablePath: process.env.CHROMIUM || undefined,
    args: ['--disable-web-security', '--allow-file-access-from-files']
  });
  var page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
  var errors = [];
  page.on('pageerror', function (e) { errors.push(e.message); });
  page.on('console', function (m) { if (m.type() === 'error' && !/Failed to load resource|ERR_FILE_NOT_FOUND|webapis/.test(m.text())) errors.push(m.text()); });
  await page.addInitScript(TIZEN_MOCK);
  var profile = SCENARIO === 'xtream'
    ? { id: 'p1', name: 'Xtream test', type: 'xtream', server: PROVIDER, username: 'demo', password: 'secret' }
    : { id: 'p1', name: 'M3U test', type: 'm3u', url: PROVIDER + '/playlist.m3u' };
  await page.addInitScript(function (p) {
    if (!localStorage.getItem('canape.profiles')) {
      localStorage.setItem('canape.profiles', JSON.stringify([p]));
      localStorage.setItem('canape.activeProfile', JSON.stringify(p.id));
    }
  }, profile);
  await page.goto(APP);
  var cdp = await page.context().newCDPSession(page);
  async function key(name, wait) {
    var code = KEYS[name];
    await cdp.send('Input.dispatchKeyEvent', { type: 'rawKeyDown', windowsVirtualKeyCode: code, nativeVirtualKeyCode: code });
    await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', windowsVirtualKeyCode: code, nativeVirtualKeyCode: code });
    await sleep(wait === undefined ? 200 : wait);
  }
  async function waitFor(fn, timeout) {
    var end = Date.now() + (timeout || 15000);
    while (Date.now() < end) { try { if (await page.evaluate(fn)) return true; } catch (e) { /* rien */ } await sleep(150); }
    return false;
  }

  console.log('Scénario ' + SCENARIO);
  ok(await waitFor(function () { var t = window.App && App.top(); return t && t.constructor === Screens.Browse; }), 'accueil affiché');
  ok(await page.evaluate(function () { return window.__keys.indexOf('ColorF0Red') !== -1 && window.__keys.indexOf('ChannelUp') !== -1; }), 'touches de la télécommande demandées à Tizen');
  ok(await waitFor(function () { return Epg.ready; }, 20000), 'guide des programmes (.gz) lu par le worker');
  var cnt = await page.evaluate(function () { return EpgEngine.count; });
  ok(cnt > 50, 'programmes chargés : ' + cnt);
  var nowOk = await page.evaluate(function () {
    return new Promise(function (res) {
      var c = Library.data.live[0];
      Epg.now([c], function (m) { var l = m[c.epgKey]; res(!!(l && l.length && l[0].t)); });
    });
  });
  ok(nowOk, 'programme en cours d\'une chaîne');
  await page.screenshot({ path: path.join(SHOTS, 'tizen-' + SCENARIO + '-accueil.png') });

  // --- direct
  await page.evaluate(function () { var c = Library.data.live[0]; Player.play(c, null, 0); });
  ok(await waitFor(function () { return window.__av.indexOf('play') !== -1; }), 'AVPlay : flux ouvert et lancé');
  var st = await page.evaluate(function () {
    return { cls: document.documentElement.className, bg: getComputedStyle(document.body).backgroundColor, pbg: getComputedStyle(document.querySelector('.player')).backgroundColor, obj: !!document.querySelector('object.avplayer') };
  });
  ok(st.obj && /avplay-on/.test(st.cls), 'objet AVPlay dans la page');
  ok(st.bg === 'rgba(0, 0, 0, 0)' && st.pbg === 'rgba(0, 0, 0, 0)', 'fond transparent pour voir la vidéo');
  ok(await waitFor(function () { return document.querySelector('.spinner-wrap').style.display === 'none'; }), 'chargement terminé (événement playing)');
  await page.evaluate(function () { window.__av.length = 0; });
  await key('CHUP', 400);
  var zap = await page.evaluate(function () { return window.__av.join(','); });
  ok(/close,open [^,]+,.*play/.test(zap), 'CH+ : zapping (fermeture puis ouverture) ' + zap);
  await key('BACK', 300);
  ok(await page.evaluate(function () { return window.__av.indexOf('close') !== -1 && !/avplay-on/.test(document.documentElement.className); }), 'RETOUR : lecteur fermé');

  // --- erreur puis bascule HLS <-> TS (Xtream)
  if (SCENARIO === 'xtream') {
    await page.evaluate(function () { window.__av.length = 0; var c = Library.data.live[0]; c = JSON.parse(JSON.stringify(c)); c.url = c.url.replace(/\d+\.(m3u8|ts)$/, '9999.$1'); Player.play(c, null, 0); });
    ok(await waitFor(function () { return window.__av.filter(function (x) { return /^open /.test(x); }).length >= 2; }), 'flux refusé : nouvel essai dans l\'autre format');
    ok(await waitFor(function () { return document.querySelector('.player-error').style.display === 'block'; }), 'message d\'erreur affiché');
    await key('BACK', 300);
  }

  // --- film : reprise, pistes, sous-titres
  var movie = await page.evaluate(function () { return !!(Library.data.movies && Library.data.movies.length); });
  if (movie) {
    await page.evaluate(function () { window.__av.length = 0; Player.play(Library.data.movies[0], null, 120); });
    ok(await waitFor(function () { return window.__av.indexOf('seek 120000') !== -1; }), 'reprise à 2 min (seekTo)');
    ok(await waitFor(function () { var t = App.top(); return t.video.audioTracks.length === 2 && t.video.textTracks.length === 1; }), 'pistes audio et sous-titres lues');
    await key('GREEN', 300);
    ok(await page.evaluate(function () { return document.querySelector('.player').className.indexOf('tracks-on') !== -1; }), 'VERT : panneau Audio et sous-titres');
    await key('DOWN'); await key('OK');
    ok(await page.evaluate(function () { return window.__av.indexOf('track AUDIO 2') !== -1; }), 'piste audio anglaise choisie');
    await key('RIGHT'); await key('DOWN'); await key('OK', 400);
    ok(await page.evaluate(function () { return window.__av.indexOf('track TEXT 3') !== -1 && document.querySelector('.subtitles').textContent === 'Bonjour le monde'; }), 'sous-titres affichés');
    await page.screenshot({ path: path.join(SHOTS, 'tizen-' + SCENARIO + '-pistes.png') });
    await key('BACK');
    await page.evaluate(function () { window.__av.length = 0; });
    await key('PLAYPAUSE', 300);
    ok(await page.evaluate(function () { return window.__av.indexOf('pause') !== -1 && App.top().video.paused; }), 'Lecture/Pause');
    await key('BACK', 300);
    var prog = await page.evaluate(function () { return UserData.getProgress(Library.data.movies[0].id); });
    ok(prog && prog.pos >= 100, 'position du film gardée');
  }

  // --- quitter
  for (var b = 0; b < 4 && !(await page.evaluate(function () { return !!App.modal; })); b++) await key('BACK', 300);
  ok(await page.evaluate(function () { return !!App.modal; }), 'RETOUR depuis l\'accueil : proposition de quitter');
  await page.evaluate(function () { var m = App.modal; for (var i = 0; i < 3; i++) { m.onKey('down'); m.onKey('right'); } });
  var sel = await page.evaluate(function () { return document.querySelector('.dialog .focus, .dialog .on, .modal .focus') ? document.querySelector('.dialog .focus, .dialog .on, .modal .focus').textContent : ''; });
  await page.evaluate(function () { App.modal.onKey('enter'); });
  ok(await page.evaluate(function () { return window.__exited === 1; }), 'Quitter : appli fermée par Tizen (' + sel + ')');

  ok(errors.length === 0, 'aucune erreur JavaScript' + (errors.length ? ' : ' + errors.join(' | ') : ''));
  await browser.close();
  console.log((failed ? 'ÉCHEC' : 'OK') + ' : ' + passed + ' réussis, ' + failed + ' échoués');
  process.exit(failed ? 1 : 0);
}
main().catch(function (e) { console.error(e); process.exit(1); });

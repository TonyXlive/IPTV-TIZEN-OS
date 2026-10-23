/* Canapé TV — outils communs (ES5 : compatible avec les TV Samsung Tizen 2.4 / 3.0 de 2016-2017). */
(function (global) {
  'use strict';

  var U = {};

  U.$ = function (sel, root) { return (root || document).querySelector(sel); };

  U.el = function (tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text !== undefined && text !== null) e.textContent = text;
    return e;
  };

  U.clear = function (node) { while (node && node.firstChild) node.removeChild(node.firstChild); };

  U.esc = function (s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  };

  U.each = function (arr, fn) { for (var i = 0; i < arr.length; i++) fn(arr[i], i); };

  U.find = function (arr, fn) {
    for (var i = 0; i < arr.length; i++) if (fn(arr[i], i)) return arr[i];
    return null;
  };

  U.extend = function (target) {
    for (var i = 1; i < arguments.length; i++) {
      var src = arguments[i];
      if (!src) continue;
      for (var k in src) if (Object.prototype.hasOwnProperty.call(src, k)) target[k] = src[k];
    }
    return target;
  };

  U.clamp = function (v, min, max) { return v < min ? min : v > max ? max : v; };

  U.hash = function (s) {
    var h = 0;
    s = String(s || '');
    for (var i = 0; i < s.length; i++) { h = ((h << 5) - h + s.charCodeAt(i)) | 0; }
    return Math.abs(h);
  };

  U.initials = function (name) {
    var words = String(name || '?').replace(/[^\w\sÀ-ÿ]/g, ' ').split(/\s+/);
    var out = '';
    for (var i = 0; i < words.length && out.length < 3; i++) if (words[i]) out += words[i].charAt(0);
    return (out || '?').toUpperCase();
  };

  U.pad = function (n) { return n < 10 ? '0' + n : '' + n; };

  U.hhmm = function (ms) {
    var d = new Date(ms);
    return U.pad(d.getHours()) + ':' + U.pad(d.getMinutes());
  };

  U.duration = function (sec) {
    sec = Math.max(0, Math.floor(sec || 0));
    var h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
    return (h ? h + ':' + U.pad(m) : m) + ':' + U.pad(s);
  };

  // "00:22:10" ou "22:10" ou "95 min" -> secondes
  U.parseDuration = function (v) {
    if (v === undefined || v === null || v === '') return 0;
    if (typeof v === 'number') return v > 0 ? v : 0;
    var s = String(v).trim();
    var m = /^(\d+):(\d{1,2})(?::(\d{1,2}))?$/.exec(s);
    if (m) return m[3] !== undefined ? (+m[1]) * 3600 + (+m[2]) * 60 + (+m[3]) : (+m[1]) * 60 + (+m[2]);
    var mm = /^(\d+)\s*min/i.exec(s);
    if (mm) return (+mm[1]) * 60;
    return /^\d+$/.test(s) ? +s : 0;
  };

  // Adresse de secours d'une image. Sur LG, on passait par le service de la TV ; sur Samsung il n'y en a pas :
  // seule l'adresse en http (au lieu de https) est retentée, pour les sites dont la TV refuse le certificat.
  U.proxied = function (src) {
    if (!src || !/^https:/i.test(src)) return '';
    return 'http:' + src.slice(6);
  };

  // Image de fond (bannière, fiches) avec le même secours.
  U.bgImage = function (el, src, onFail) {
    if (!src) { el.style.backgroundImage = 'none'; if (onFail) onFail(); return; }
    var token = {};
    el.__bgToken = token;
    function set(url) { if (el.__bgToken === token) el.style.backgroundImage = 'url("' + url.replace(/"/g, '%22') + '")'; }
    var probe = new Image();
    probe.onload = function () { set(src); };
    probe.onerror = function () {
      var alt = U.proxied(src);
      if (!alt) { if (el.__bgToken === token) { el.style.backgroundImage = 'none'; if (onFail) onFail(); } return; }
      var p2 = new Image();
      p2.onload = function () { set(alt); };
      p2.onerror = function () { if (el.__bgToken === token) { el.style.backgroundImage = 'none'; if (onFail) onFail(); } };
      p2.src = alt;
    };
    probe.src = src;
  };

  U.debounce = function (fn, ms) {
    var t = null;
    return function () {
      var self = this, args = arguments;
      clearTimeout(t);
      t = setTimeout(function () { fn.apply(self, args); }, ms);
    };
  };

  // ------------------------------------------------------------ stockage local

  U.store = {
    get: function (key, fallback) {
      try {
        var v = global.localStorage.getItem('canape.' + key);
        return v == null ? fallback : JSON.parse(v);
      } catch (e) { return fallback; }
    },
    set: function (key, value) {
      try { global.localStorage.setItem('canape.' + key, JSON.stringify(value)); return true; } catch (e) { return false; }
    },
    remove: function (key) {
      try { global.localStorage.removeItem('canape.' + key); } catch (e) { /* rien */ }
    }
  };

  // ------------------------------------------------------------ réseau

  U.xhr = function (url, opts, cb) {
    opts = opts || {};
    var x = new XMLHttpRequest();
    var finished = false;
    function finish(err, text, status) {
      if (finished) return;
      finished = true;
      cb(err, text, status);
    }
    try { x.open('GET', url, true); } catch (e) { return finish(e); }
    x.timeout = opts.timeout || 45000;
    x.onload = function () {
      if (x.status >= 200 && x.status < 300) finish(null, x.responseText, x.status);
      else finish(new Error('Erreur ' + x.status), x.responseText, x.status);
    };
    x.onerror = function () { finish(new Error('Connexion impossible')); };
    x.ontimeout = function () { finish(new Error('Délai dépassé')); };
    x.send();
    return x;
  };

  U.json = function (url, opts, cb) {
    U.xhr(url, opts, function (err, text, status) {
      if (err) return cb(err, null, status);
      var data;
      try { data = JSON.parse(text); } catch (e) { return cb(new Error('Réponse illisible'), null, status); }
      cb(null, data, status);
    });
  };

  // ------------------------------------------------------------ touches de la télécommande

  // Codes des touches de la télécommande Samsung (Tizen). RETOUR = 10009 (461 chez LG, gardé par sécurité).
  U.KEY = {
    LEFT: 37, UP: 38, RIGHT: 39, DOWN: 40, ENTER: 13,
    BACK: 461, BACK_SAMSUNG: 10009, BACKSPACE: 8, ESC: 27,
    PLAY: 415, PAUSE: 19, PLAYPAUSE: 10252, STOP: 413, FF: 417, RW: 412,
    CH_UP: 427, CH_DOWN: 428, PAGE_UP: 33, PAGE_DOWN: 34,
    RED: 403, GREEN: 404, YELLOW: 405, BLUE: 406,
    INFO: 457, DONE: 65376, CANCEL: 65385, SPACE: 32
  };

  U.keyName = function (e) {
    var k = e.keyCode;
    var K = U.KEY;
    if (k === K.LEFT) return 'left';
    if (k === K.RIGHT) return 'right';
    if (k === K.UP) return 'up';
    if (k === K.DOWN) return 'down';
    if (k === K.ENTER || k === K.DONE) return 'enter';
    if (k === K.BACK || k === K.BACK_SAMSUNG || k === K.ESC || k === K.CANCEL) return 'back';
    if (k === K.BACKSPACE) return 'backspace';
    if (k === K.PLAY) return 'play';
    if (k === K.PAUSE) return 'pause';
    if (k === K.PLAYPAUSE || k === K.SPACE) return 'playpause';
    if (k === K.STOP) return 'stop';
    if (k === K.FF) return 'ff';
    if (k === K.RW) return 'rw';
    if (k === K.CH_UP || k === K.PAGE_UP) return 'chup';
    if (k === K.CH_DOWN || k === K.PAGE_DOWN) return 'chdown';
    if (k === K.RED) return 'red';
    if (k === K.GREEN) return 'green';
    if (k === K.YELLOW) return 'yellow';
    if (k === K.BLUE) return 'blue';
    if (k === K.INFO || k === 73) return 'info';
    if (k >= 48 && k <= 57) return 'digit' + (k - 48);
    if (k >= 96 && k <= 105) return 'digit' + (k - 96);
    return '';
  };

  // ------------------------------------------------------------ pointeur (souris branchée sur la TV)

  // Rend un élément « pointable » : survol = sélection, clic = OK (ou action dédiée).
  U.pointer = function (el, hover, click) {
    if (el) el.__pt = { hover: hover || null, click: click || null };
    return el;
  };

  // ------------------------------------------------------------ images avec repli

  // src peut être une liste d'adresses : on essaie la suivante si une image ne se charge pas.
  U.img = function (src, cls, fallbackText) {
    var list = [];
    if (src && typeof src === 'object' && src.length !== undefined) { for (var n = 0; n < src.length; n++) if (src[n] && list.indexOf(src[n]) === -1) list.push(src[n]); }
    else if (src) list.push(src);
    var box = U.el('div', cls);
    var fb = U.el('div', 'img-fallback', U.initials(fallbackText));
    var hue = U.hash(fallbackText) % 360;
    fb.style.background = 'linear-gradient(135deg, hsl(' + hue + ',35%,28%), hsl(' + ((hue + 40) % 360) + ',40%,16%))';
    box.appendChild(fb);
    if (list.length) {
      var im = document.createElement('img');
      var idx = 0, retried = false;
      im.onload = function () { fb.style.display = 'none'; im.style.opacity = 1; };
      im.onerror = function () {
        var alt = !retried && U.proxied(list[idx]);
        if (alt) { retried = true; im.src = alt; return; }
        idx++;
        retried = false;
        if (idx < list.length) { im.src = list[idx]; return; }
        if (im.parentNode) im.parentNode.removeChild(im);
      };
      im.src = list[0];
      box.appendChild(im);
    }
    return box;
  };

  global.U = U;
})(window);

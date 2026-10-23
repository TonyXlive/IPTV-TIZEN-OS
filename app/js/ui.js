/* Canapé TV (Samsung Tizen) — briques d'interface : pile d'écrans, pointeur (souris), rangées façon plateforme de streaming, fenêtres, PIN. */
(function (global) {
  'use strict';
  var U = global.U;

  // =============================================================== pile d'écrans

  var App = {
    root: null,
    stack: [],
    modal: null,

    rem: function () { return parseFloat(global.getComputedStyle(document.documentElement).fontSize) || 16; },

    push: function (screen) {
      var top = App.top();
      if (top && top.onHide) top.onHide();
      if (top) top.el.style.display = 'none';
      App.stack.push(screen);
      App.root.appendChild(screen.el);
      if (screen.onShow) screen.onShow(true);
    },

    pop: function () {
      var s = App.stack.pop();
      if (s) {
        if (s.onHide) s.onHide();
        if (s.destroy) s.destroy();
        if (s.el.parentNode) s.el.parentNode.removeChild(s.el);
      }
      var top = App.top();
      if (top) {
        top.el.style.display = '';
        if (top.onShow) top.onShow(false);
      }
    },

    // Remplace toute la pile (ex. après un changement de playlist).
    reset: function (screen) {
      while (App.stack.length) App.pop();
      App.push(screen);
    },

    top: function () { return App.stack[App.stack.length - 1] || null; },

    // Pendant un écran d'erreur, Main prend les touches à sa place.
    interceptor: null,

    key: function (e) {
      var active = document.activeElement;
      var typing = active && (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA');
      var name = U.keyName(e);
      if (typing) {
        // Pendant la saisie, le clavier de la TV garde les touches, sauf pour sortir du champ.
        if (name === 'up' || name === 'down' || name === 'back' || name === 'enter') {
          if (name === 'back' && e.keyCode === U.KEY.BACKSPACE) return;
          e.preventDefault();
          active.blur();
          if (name === 'enter' || name === 'back') return;
        } else return;
      }
      if (!name) return;
      if (name === 'backspace') name = 'back';
      e.preventDefault();
      var P = App.pointerState;
      if (name === 'left' || name === 'right' || name === 'up' || name === 'down') P.on = false;
      if (name === 'enter') {
        // Pointeur : un appui sur OK peut envoyer à la fois un clic et la touche OK. On ne compte qu'une fois.
        if (Date.now() - P.lastClick < 450) return;
        P.lastEnter = Date.now();
      }
      App.dispatch(name, e);
    },

    dispatch: function (name, e) {
      if (App.interceptor) return App.interceptor(name, e);
      if (App.modal) return App.modal.onKey(name, e);
      var top = App.top();
      if (top && top.onKey) top.onKey(name, e);
    },

    exit: function () { global.Platform.exit(); },

    // ------------------------------------------------------------ pointeur (souris branchée sur la TV)
    // Survoler un élément le sélectionne, cliquer vaut OK. Le pointeur n'agit que lorsqu'il bouge vraiment,
    // pour ne rien déranger quand on navigue avec les flèches.
    pointerState: { on: false, x: -1, y: -1, lastClick: 0, lastEnter: 0, lastWheel: 0 },

    pointTarget: function (node) {
      while (node && node !== document) {
        if (node.__pt) {
          if (App.modal && !App.modal.el.contains(node)) return null;
          if (!App.modal && App.interceptor && !node.__ptAlways) return null;
          return node;
        }
        node = node.parentNode;
      }
      return null;
    },

    initPointer: function () {
      var P = App.pointerState;
      document.addEventListener('mousemove', function (e) {
        if (e.clientX === P.x && e.clientY === P.y) return; // faux mouvement après un changement d'écran
        P.x = e.clientX; P.y = e.clientY;
        P.on = true;
        var top = App.top();
        if (!App.modal && !App.interceptor && top && top.onPointerMove) top.onPointerMove();
      }, true);
      document.addEventListener('mouseover', function (e) {
        if (!P.on) return;
        var t = App.pointTarget(e.target);
        if (t && t.__pt.hover) t.__pt.hover(e);
      }, true);
      document.addEventListener('click', function (e) {
        var now = Date.now();
        if (now - P.lastEnter < 450) return; // déjà traité par la touche OK
        var t = App.pointTarget(e.target);
        if (!t) return;
        P.lastClick = now;
        if (t.__pt.hover) t.__pt.hover(e);
        if (t.__pt.click) t.__pt.click(e);
        else App.dispatch('enter', e);
      }, true);
      function wheel(e) {
        var dy = e.deltaY !== undefined ? e.deltaY : -(e.wheelDelta || 0);
        if (e.preventDefault) e.preventDefault();
        if (!dy) return;
        var now = Date.now();
        if (now - P.lastWheel < 180) return;
        P.lastWheel = now;
        P.on = false; // le contenu défile : on attend que le pointeur bouge pour le suivre à nouveau
        var name = dy > 0 ? 'down' : 'up';
        var top = App.top();
        if (App.modal || App.interceptor) return;
        if (top && top.onWheel) top.onWheel(name);
        else App.dispatch(name);
      }
      // Les navigateurs récents rendent la molette « passive » par défaut : on la déclare active.
      var active = false;
      try {
        var probe = Object.defineProperty({}, 'passive', { get: function () { active = { passive: false }; return false; } });
        global.addEventListener('canape-probe', null, probe);
        global.removeEventListener('canape-probe', null, probe);
      } catch (err) { active = false; }
      if ('onwheel' in document) document.addEventListener('wheel', wheel, active);
      else document.addEventListener('mousewheel', wheel, active);
      // (TV LG : signale l'apparition et la disparition du pointeur ; sans effet sur Samsung)
      document.addEventListener('cursorStateChange', function (e) {
        var vis = e && e.detail && e.detail.visibility;
        if (!vis) P.on = false;
      }, false);
    }
  };

  // =============================================================== message éphémère

  var toastTimer = null;
  function toast(msg) {
    var t = U.$('#toast');
    t.textContent = msg;
    t.className = 'toast show';
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { t.className = 'toast'; }, 2600);
  }

  // =============================================================== fenêtre de choix

  function Dialog(opts) {
    var self = this;
    this.opts = opts;
    this.index = opts.defaultIndex || 0;
    this.el = U.el('div', 'modal');
    var box = U.el('div', 'modal-box');
    box.appendChild(U.el('div', 'modal-title', opts.title));
    if (opts.text) box.appendChild(U.el('div', 'modal-text', opts.text));
    var btns = U.el('div', 'modal-buttons');
    this.buttons = opts.buttons.map(function (b, i) {
      var be = U.el('div', 'btn', b.label);
      U.pointer(be, function () { if (self.index !== i) { self.index = i; self.paint(); } });
      btns.appendChild(be);
      return be;
    });
    box.appendChild(btns);
    this.el.appendChild(box);
    this.paint();
    this.close = function () {
      App.modal = null;
      if (self.el.parentNode) self.el.parentNode.removeChild(self.el);
    };
  }
  Dialog.prototype.paint = function () {
    for (var i = 0; i < this.buttons.length; i++) this.buttons[i].className = 'btn' + (i === this.index ? ' focus' : '');
  };
  Dialog.prototype.onKey = function (k) {
    if (k === 'left') this.index = Math.max(0, this.index - 1);
    else if (k === 'right') this.index = Math.min(this.buttons.length - 1, this.index + 1);
    else if (k === 'back') { this.close(); if (this.opts.onCancel) this.opts.onCancel(); return; }
    else if (k === 'enter') {
      var b = this.opts.buttons[this.index];
      this.close();
      if (b.action) b.action();
      return;
    }
    this.paint();
  };
  Dialog.show = function (opts) {
    var d = new Dialog(opts);
    document.body.appendChild(d.el);
    App.modal = d;
    return d;
  };

  // =============================================================== code PIN (chiffres de la télécommande ou haut/bas)

  function PinDialog(title, onDone) {
    var self = this;
    this.digits = [0, 0, 0, 0];
    this.pos = 0;
    this.onDone = onDone;
    this.el = U.el('div', 'modal');
    var box = U.el('div', 'modal-box');
    box.appendChild(U.el('div', 'modal-title', title));
    box.appendChild(U.el('div', 'modal-text', 'Chiffres de la télécommande, ou ▲▼ pour changer et ◀▶ pour avancer. OK pour valider.'));
    var row = U.el('div', 'pin-row');
    this.cells = [0, 1, 2, 3].map(function () { var c = U.el('div', 'pin-cell'); row.appendChild(c); return c; });
    box.appendChild(row);
    this.el.appendChild(box);
    this.paint();
    this.close = function () { App.modal = null; if (self.el.parentNode) self.el.parentNode.removeChild(self.el); };
  }
  PinDialog.prototype.paint = function () {
    for (var i = 0; i < 4; i++) {
      this.cells[i].textContent = i < this.pos ? '•' : (i === this.pos ? this.digits[i] : '');
      this.cells[i].className = 'pin-cell' + (i === this.pos ? ' focus' : '');
    }
  };
  PinDialog.prototype.onKey = function (k) {
    if (k.indexOf('digit') === 0) {
      this.digits[this.pos] = +k.slice(5);
      if (this.pos < 3) this.pos++;
      else return this.finish();
    } else if (k === 'up') this.digits[this.pos] = (this.digits[this.pos] + 1) % 10;
    else if (k === 'down') this.digits[this.pos] = (this.digits[this.pos] + 9) % 10;
    else if (k === 'right') { if (this.pos < 3) this.pos++; }
    else if (k === 'left') { if (this.pos > 0) this.pos--; }
    else if (k === 'enter') { if (this.pos < 3) this.pos++; else return this.finish(); }
    else if (k === 'back') { this.close(); this.onDone(null); return; }
    this.paint();
  };
  PinDialog.prototype.finish = function () {
    this.close();
    this.onDone(this.digits.join(''));
  };
  PinDialog.ask = function (title, cb) {
    var d = new PinDialog(title, cb);
    document.body.appendChild(d.el);
    App.modal = d;
  };

  // =============================================================== tuiles

  var TILE = {
    live: { w: 17.5, h: 9.85, cap: 3.9 },
    poster: { w: 11.6, h: 17.4, cap: 2.6 },
    wide: { w: 20, h: 11.25, cap: 3.9 }
  };
  var GAP = 1.3;
  var ROW_TITLE = 3.1;
  var ROW_GAP = 1.6;

  function tileType(item) {
    if (item.kind === 'live') return 'live';
    if (item.kind === 'episode') return 'wide';
    return 'poster';
  }

  function buildTile(item, type) {
    var t = U.el('div', 'tile tile-' + type);
    var art = U.img(item.logo, 'tile-art', item.kind === 'episode' ? (item.seriesName || item.name) : item.name);
    t.appendChild(art);
    if (type === 'live') {
      if (item.num) art.appendChild(U.el('div', 'tile-num', item.num));
      var cap = U.el('div', 'tile-cap');
      cap.appendChild(U.el('div', 'tile-name', item.name));
      var now = U.el('div', 'tile-sub', '');
      cap.appendChild(now);
      var bar = U.el('div', 'tile-bar');
      bar.appendChild(U.el('div', 'tile-bar-fill'));
      cap.appendChild(bar);
      t.appendChild(cap);
    } else if (type === 'wide') {
      var cw = U.el('div', 'tile-cap');
      var label = item.kind === 'episode'
        ? (item.seriesName ? item.seriesName + ' · ' : '') + 'S' + U.pad(item.season || 1) + 'E' + U.pad(item.episode || 1)
        : item.name;
      cw.appendChild(U.el('div', 'tile-name', label));
      cw.appendChild(U.el('div', 'tile-sub', item.kind === 'episode' ? item.name : (item.group || '')));
      t.appendChild(cw);
      if (item.progress) {
        var pb = U.el('div', 'tile-progress');
        var f = U.el('div', 'tile-progress-fill');
        f.style.width = Math.round(item.progress * 100) + '%';
        pb.appendChild(f);
        art.appendChild(pb);
      }
    } else {
      t.appendChild(U.el('div', 'tile-title', item.name));
      if (item.resumeLabel) art.appendChild(U.el('div', 'tile-resume', item.resumeLabel));
      if (item.progress) {
        var pp = U.el('div', 'tile-progress');
        var pf = U.el('div', 'tile-progress-fill');
        pf.style.width = Math.round(item.progress * 100) + '%';
        pp.appendChild(pf);
        art.appendChild(pp);
      }
    }
    if (global.UserData.isFavorite(item.id)) t.appendChild(U.el('div', 'tile-fav', '♥'));
    return t;
  }

  // Remplit "en ce moment" sur les tuiles de chaînes affichées.
  function fillNow(tile, item, epgMap) {
    var list = epgMap[item.epgKey];
    var sub = tile.querySelector('.tile-sub');
    var bar = tile.querySelector('.tile-bar');
    if (!sub) return;
    var now = Date.now();
    var cur = list && list[0] && list[0].s <= now ? list[0] : null;
    if (cur) {
      sub.textContent = cur.t;
      bar.style.display = 'block';
      bar.firstChild.style.width = U.clamp((now - cur.s) / (cur.e - cur.s), 0, 1) * 100 + '%';
    } else {
      sub.textContent = item.group || '';
      bar.style.display = 'none';
    }
  }

  // =============================================================== rangées (défilement horizontal et vertical, virtualisé)

  function Rows(container, handlers) {
    this.container = container;
    this.h = handlers || {};
    this.rows = [];
    this.r = 0;
    this.rowEls = {};
    this.inner = U.el('div', 'rows-inner');
    container.appendChild(this.inner);
    this.epgTimer = null;
  }

  Rows.prototype.setRows = function (rows, keepPosition) {
    var oldR = this.r;
    var oldTitle = this.rows[oldR] ? this.rows[oldR].title : null;
    var oldIdx = {};
    if (keepPosition) U.each(this.rows, function (row) { oldIdx[row.title] = row.index; });
    this.rows = rows.filter(function (row) { return row.items && row.items.length; });
    var off = 0;
    var self = this;
    U.each(this.rows, function (row) {
      row.type = row.type || tileType(row.items[0]);
      row.index = keepPosition && oldIdx[row.title] !== undefined ? Math.min(oldIdx[row.title], row.items.length - 1) : 0;
      row.scroll = row.index;
      row.top = off;
      row.height = ROW_TITLE + TILE[row.type].h + TILE[row.type].cap + ROW_GAP;
      off += row.height;
      row.tiles = {};
    });
    this.r = keepPosition ? Math.min(oldR, Math.max(0, this.rows.length - 1)) : 0;
    // on reste sur la même rangée (par son nom) même si une rangée est apparue ou a disparu au-dessus
    if (keepPosition && oldTitle) {
      for (var ri = 0; ri < this.rows.length; ri++) if (this.rows[ri].title === oldTitle) { this.r = ri; break; }
    }
    U.each(Object.keys(this.rowEls), function (k) { var e = self.rowEls[k]; if (e.parentNode) e.parentNode.removeChild(e); });
    this.rowEls = {};
    this.render();
  };

  Rows.prototype.empty = function () { return !this.rows.length; };
  Rows.prototype.current = function () {
    var row = this.rows[this.r];
    return row ? row.items[row.index] : null;
  };
  Rows.prototype.currentRow = function () { return this.rows[this.r] || null; };

  // keepView : on garde le défilement actuel (sélection au pointeur : rien ne doit bouger sous la flèche).
  Rows.prototype.render = function (keepView) {
    var rem = App.rem();
    var self = this;
    var cr = this.rows[this.r];
    if (!keepView || this.viewR === undefined) {
      this.viewR = this.r;
      if (cr) cr.scroll = cr.index;
    }
    if (this.viewR > this.rows.length - 1) this.viewR = Math.max(0, this.rows.length - 1);
    var vr = this.viewR;
    var first = Math.max(0, vr - 1), last = Math.min(this.rows.length - 1, vr + 3);
    // retire les rangées hors fenêtre
    U.each(Object.keys(this.rowEls), function (k) {
      var i = +k;
      if (i < first || i > last) {
        var e = self.rowEls[k];
        if (e.parentNode) e.parentNode.removeChild(e);
        delete self.rowEls[k];
        self.rows[i].tiles = {};
      }
    });
    for (var i = first; i <= last; i++) this.renderRow(i, rem);
    var cur = this.rows[vr];
    var y = cur ? cur.top : 0;
    this.inner.style.transform = 'translate3d(0,' + (-y * rem) + 'px,0)';
    this.inner.style.webkitTransform = this.inner.style.transform;
    this.scheduleEpg();
  };

  Rows.prototype.renderRow = function (i, rem) {
    var row = this.rows[i];
    var el = this.rowEls[i];
    var focusedRow = i === this.r;
    if (!el) {
      el = U.el('div', 'row');
      el.style.top = row.top + 'rem';
      var title = U.el('div', 'row-title');
      title.appendChild(U.el('span', '', row.title));
      title.appendChild(U.el('span', 'row-count', row.items.length > 1 ? row.items.length + '' : ''));
      el.appendChild(title);
      var track = U.el('div', 'track');
      track.style.height = (TILE[row.type].h + TILE[row.type].cap) + 'rem';
      el.appendChild(track);
      this.inner.appendChild(el);
      this.rowEls[i] = el;
    }
    el.className = 'row' + (focusedRow ? ' row-focus' : '') + (i < this.viewR ? ' row-past' : '');
    var trk = el.lastChild;
    var dims = TILE[row.type];
    var step = dims.w + GAP;
    var viewW = (this.container.offsetWidth || global.innerWidth) / rem;
    var visible = Math.ceil(viewW / step) + 1;
    if (row.scroll === undefined) row.scroll = row.index;
    var sc = row.scroll;
    var from = Math.max(0, Math.min(sc, row.index) - 2), to = Math.min(row.items.length - 1, Math.max(sc + visible, row.index));
    for (var k in row.tiles) {
      if (row.tiles.hasOwnProperty(k) && (+k < from || +k > to)) {
        trk.removeChild(row.tiles[k]);
        delete row.tiles[k];
      }
    }
    for (var j = from; j <= to; j++) {
      var tile = row.tiles[j];
      if (!tile) {
        tile = buildTile(row.items[j], row.type);
        tile.style.left = (j * step) + 'rem';
        U.pointer(tile, this.hoverFn(i, j));
        trk.appendChild(tile);
        row.tiles[j] = tile;
        if (row.type === 'live' && this.epgMap) fillNow(tile, row.items[j], this.epgMap);
      }
      var on = focusedRow && j === row.index && !this.blurred;
      if (on !== (tile.className.indexOf(' focus') !== -1)) tile.className = 'tile tile-' + row.type + (on ? ' focus' : '');
    }
    var x = sc * step;
    trk.style.transform = 'translate3d(' + (-x * rem) + 'px,0,0)';
    trk.style.webkitTransform = trk.style.transform;
  };

  // Le programme en cours sur les chaînes visibles (après une courte pause dans la navigation).
  Rows.prototype.scheduleEpg = function () {
    var self = this;
    clearTimeout(this.epgTimer);
    this.epgTimer = setTimeout(function () {
      var want = [];
      U.each(Object.keys(self.rowEls), function (k) {
        var row = self.rows[+k];
        if (!row || row.type !== 'live') return;
        for (var j in row.tiles) if (row.tiles.hasOwnProperty(j)) want.push(row.items[+j]);
      });
      if (!want.length) return;
      global.Epg.now(want, function (map) {
        self.epgMap = U.extend(self.epgMap || {}, map);
        U.each(Object.keys(self.rowEls), function (k) {
          var row = self.rows[+k];
          if (!row || row.type !== 'live') return;
          for (var j in row.tiles) if (row.tiles.hasOwnProperty(j)) fillNow(row.tiles[j], row.items[+j], self.epgMap);
        });
        if (self.h.onEpg) self.h.onEpg(self.epgMap);
      });
    }, 350);
  };

  Rows.prototype.setBlurred = function (b) {
    this.blurred = b;
    this.render(true);
  };

  Rows.prototype.hoverFn = function (r, j) {
    var self = this;
    return function () { self.pointTo(r, j); };
  };

  // Sélection au pointeur : la tuile survolée devient la tuile sélectionnée, sans faire défiler.
  Rows.prototype.pointTo = function (r, j) {
    var row = this.rows[r];
    if (!row || j > row.items.length - 1) return;
    var same = this.r === r && row.index === j && !this.blurred;
    this.r = r;
    row.index = j;
    if (this.h.onPoint) this.h.onPoint();
    if (same) return;
    this.render(true);
    if (this.h.onFocus) this.h.onFocus(this.current(), this.currentRow());
  };

  // Rafraîchit une tuile (ex. cœur des favoris).
  Rows.prototype.refreshCurrent = function () {
    var row = this.rows[this.r];
    if (!row) return;
    var t = row.tiles[row.index];
    if (t && t.parentNode) t.parentNode.removeChild(t);
    delete row.tiles[row.index];
    this.render(true);
  };

  // Renvoie false quand on sort par le haut (pour remonter au menu).
  Rows.prototype.key = function (k) {
    var row = this.rows[this.r];
    if (!row) return false;
    if (k === 'left') { if (row.index > 0) row.index--; }
    else if (k === 'right') { if (row.index < row.items.length - 1) row.index++; }
    else if (k === 'up') { if (this.r === 0) return false; this.r--; }
    else if (k === 'down') { if (this.r < this.rows.length - 1) this.r++; }
    else if (k === 'chup') { row.index = Math.max(0, row.index - 8); }
    else if (k === 'chdown') { row.index = Math.min(row.items.length - 1, row.index + 8); }
    else if (k === 'enter') { if (this.h.onSelect) this.h.onSelect(this.current(), this.currentRow()); return true; }
    else return true;
    this.render();
    if (this.h.onFocus) this.h.onFocus(this.current(), this.currentRow());
    return true;
  };

  Rows.prototype.destroy = function () { clearTimeout(this.epgTimer); };

  // =============================================================== liste verticale simple (réglages, formulaires)

  // box : conteneur à faire défiler pour garder l'élément sélectionné visible (facultatif).
  function VList(items, onEnter, box) {
    var self = this;
    this.items = items;
    this.i = 0;
    this.onEnter = onEnter;
    this.box = box || null;
    this.onMove = null;
    U.each(items, function (it, idx) {
      if (!it.el || it.skip) return;
      U.pointer(it.el, function () {
        if (self.i === idx) return;
        self.i = idx;
        self.paint(true);
        if (self.onMove) self.onMove();
      }, function () { if (it.action) it.action('enter'); });
    });
  }
  VList.prototype.paint = function (noScroll) {
    for (var i = 0; i < this.items.length; i++) {
      var el = this.items[i].el;
      if (!el) continue;
      if (i === this.i) el.classList.add('focus'); else el.classList.remove('focus');
    }
    var cur = this.items[this.i] && this.items[this.i].el;
    var box = this.box;
    if (cur && box && !noScroll) {
      // (scrollIntoView({block:'nearest'}) n'existe pas sur les TV de 2016 : on calcule nous-mêmes)
      var top = cur.offsetTop - box.offsetTop, bottom = top + cur.offsetHeight;
      if (cur.offsetParent === box) { top = cur.offsetTop; bottom = top + cur.offsetHeight; }
      var margin = 40;
      if (top - margin < box.scrollTop) box.scrollTop = Math.max(0, top - margin);
      else if (bottom + margin > box.scrollTop + box.clientHeight) box.scrollTop = bottom + margin - box.clientHeight;
    }
  };
  VList.prototype.key = function (k) {
    var start = this.i;
    if (k === 'up') {
      do { this.i--; } while (this.i >= 0 && this.items[this.i].skip);
      if (this.i < 0) this.i = start;
    } else if (k === 'down') {
      do { this.i++; } while (this.i < this.items.length && this.items[this.i].skip);
      if (this.i >= this.items.length) this.i = start;
    } else if (k === 'enter' || k === 'left' || k === 'right') {
      var it = this.items[this.i];
      if (it && it.action) it.action(k);
      return true;
    } else return false;
    this.paint();
    return true;
  };

  global.App = App;
  global.toast = toast;
  global.Dialog = Dialog;
  global.PinDialog = PinDialog;
  global.Rows = Rows;
  global.VList = VList;
  global.buildTile = buildTile;
})(window);

/* Canapé TV (Samsung Tizen) — lecteur : direct (zapping, liste des chaînes, guide) et vidéo à la demande (reprise, avance rapide). */
(function (global) {
  'use strict';
  var U = global.U, App = global.App, UserData = global.UserData;

  function PlayerScreen(item, context, startPos) {
    var self = this;
    this.el = U.el('div', 'screen player');
    // sur la TV : lecteur natif AVPlay (voir tizen.js), ailleurs une balise <video>
    this.video = global.Platform.createVideo();
    this.native = !!this.video.node;
    this.el.appendChild(this.video.node || this.video);

    this.spinner = U.el('div', 'spinner-wrap');
    this.spinner.appendChild(U.el('div', 'spinner'));
    this.el.appendChild(this.spinner);

    this.errorBox = U.el('div', 'player-error');
    this.el.appendChild(this.errorBox);

    // bandeau du haut (direct)
    this.top = U.el('div', 'osd osd-top');
    this.el.appendChild(this.top);
    // bandeau du bas
    this.bottom = U.el('div', 'osd osd-bottom');
    this.el.appendChild(this.bottom);
    // numéro tapé
    this.numBox = U.el('div', 'num-entry');
    this.el.appendChild(this.numBox);
    // liste des chaînes
    this.list = U.el('div', 'chan-list');
    this.el.appendChild(this.list);
    // sous-titres (affichés par l'appli, pour que ça marche sur toutes les TV)
    this.subBox = U.el('div', 'subtitles');
    this.el.appendChild(this.subBox);
    // panneau « Audio et sous-titres »
    this.trackBox = U.el('div', 'track-panel');
    this.el.appendChild(this.trackBox);
    this.tracksOpen = false;
    // carte « Épisode suivant » (dernières secondes d'un épisode)
    this.nextCard = U.el('div', 'next-card');
    this.el.appendChild(this.nextCard);
    U.pointer(this.nextCard, null, function () { self.goNext(); });

    this.listOpen = false;
    this.digits = '';
    this.seekTarget = null;

    // pointeur (souris) : un clic sur l'image vaut OK ; un clic hors de la liste la referme.
    U.pointer(this.el, null, function () {
      if (self.listOpen) { self.closeList(); self.showOsd(true); return; }
      if (self.tracksOpen) { self.closeTracks(); return; }
      if (!self.isLive()) return self.togglePause();
      self.onKey('enter');
    });

    var v = this.video;
    v.addEventListener('waiting', function () { self.loading(true); });
    v.addEventListener('playing', function () { self.loading(false); self.errorBox.style.display = 'none'; self.retried = false; self.applyStart(); });
    v.addEventListener('canplay', function () { self.loading(false); });
    v.addEventListener('timeupdate', function () { self.onTime(); });
    v.addEventListener('loadedmetadata', function () { self.applyStart(); self.applyTrackPrefs(); });
    if (v.audioTracks && v.audioTracks.addEventListener) v.audioTracks.addEventListener('addtrack', function () { self.applyTrackPrefs(); });
    if (v.textTracks && v.textTracks.addEventListener) v.textTracks.addEventListener('addtrack', function () { self.applyTrackPrefs(); });
    v.addEventListener('canplay', function () { self.applyStart(); });
    v.addEventListener('pause', function () { self.saveProgress(); self.paintControls(); });
    v.addEventListener('play', function () { self.paintControls(); });
    v.addEventListener('seeked', function () { self.saveProgress(); });
    v.addEventListener('error', function () { self.onError(); });
    v.addEventListener('ended', function () { self.onEnded(); });

    this.load(item, context, startPos);
  }

  PlayerScreen.prototype.isLive = function () { return this.item.kind === 'live'; };

  // Durée de la vidéo : celle donnée par la TV, sinon celle annoncée par le fournisseur.
  PlayerScreen.prototype.duration = function () {
    var v = this.video;
    if (v.duration && isFinite(v.duration) && v.duration > 0) return v.duration;
    return (this.item && this.item.durationSec) || 0;
  };

  // Reprise : on se place à la position enregistrée, et on réessaie si la TV l'a ignorée.
  PlayerScreen.prototype.applyStart = function () {
    var target = this.startPos;
    if (!target || this.isLive()) return;
    var v = this.video;
    if (v.currentTime >= target - 5) { this.startPos = 0; return; }
    var dur = this.duration();
    if (dur && target >= dur - 5) { this.startPos = 0; return; }
    this.startTries = (this.startTries || 0) + 1;
    if (this.startTries > 4) { this.startPos = 0; return; }
    try { v.currentTime = target; } catch (e) { /* pas encore possible : on réessaiera */ }
  };

  PlayerScreen.prototype.load = function (item, context, startPos) {
    var self = this;
    this.saveProgress();
    this.item = item;
    if (context) this.context = context;
    if (!this.context || !this.context.items) this.context = { items: [item] };
    this.index = 0;
    for (var i = 0; i < this.context.items.length; i++) if (this.context.items[i].id === item.id) this.index = i;
    this.startPos = startPos || 0;
    this.startTries = 0;
    this.retried = false;
    this.prefsApplied = { audio: false, sub: false };
    this.nextDismissed = false;
    this.hideNextCard();
    this.setSubTrack(null);
    if (this.tracksOpen) this.closeTracks();
    this.errorBox.style.display = 'none';
    this.loading(true);
    this.el.className = 'screen player ' + (this.isLive() ? 'is-live' : 'is-vod') + (this.native ? ' is-avplay' : '');
    this.playUrl(item.url);
    if (this.isLive()) UserData.addRecent(item);
    this.renderOsd();
    this.showOsd(true);
    clearInterval(this.saveTimer);
    if (!this.isLive()) this.saveTimer = setInterval(function () { self.saveProgress(); }, 10000);
    if (this.listOpen) this.renderList();
  };

  PlayerScreen.prototype.playUrl = function (url) {
    var v = this.video;
    this.currentUrl = url;
    try { v.pause(); } catch (e) { /* rien */ }
    v.src = url;
    try { v.load(); } catch (e) { /* rien */ }
    var p = v.play();
    if (p && p.then) p.then(null, function () { /* la lecture démarrera quand le flux sera prêt */ });
  };

  PlayerScreen.prototype.loading = function (on) {
    this.spinner.style.display = on ? 'flex' : 'none';
    clearTimeout(this.stallTimer);
    var self = this;
    if (on) {
      this.stallTimer = setTimeout(function () {
        self.showError('Le flux met du temps à répondre…', 'La chaîne est peut-être hors ligne ou ton nombre d\'écrans est atteint.');
      }, 25000);
    }
  };

  PlayerScreen.prototype.onError = function () {
    // Un flux Xtream refusé en HLS passe souvent en MPEG-TS (et inversement) : on essaie une fois.
    var url = this.currentUrl || '';
    if (this.isLive() && !this.retried && /\/live\/[^/]+\/[^/]+\/\d+\.(m3u8|ts)$/.test(url)) {
      this.retried = true;
      this.playUrl(/\.m3u8$/.test(url) ? url.replace(/\.m3u8$/, '.ts') : url.replace(/\.ts$/, '.m3u8'));
      return;
    }
    this.loading(false);
    this.showError('Impossible de lire ' + (this.isLive() ? 'cette chaîne' : 'cette vidéo'),
      this.isLive() ? 'Essaie une autre chaîne, ou change le format des chaînes dans les Réglages.' : 'Le format du fichier n\'est peut-être pas pris en charge par la TV.');
  };

  PlayerScreen.prototype.showError = function (title, text) {
    U.clear(this.errorBox);
    this.errorBox.appendChild(U.el('div', 'player-error-title', title));
    this.errorBox.appendChild(U.el('div', 'player-error-text', text));
    this.errorBox.appendChild(U.el('div', 'player-error-text dim', this.isLive() ? '▲▼ chaîne suivante · RETOUR pour quitter' : 'RETOUR pour quitter'));
    this.errorBox.style.display = 'block';
  };

  PlayerScreen.prototype.onEnded = function () {
    this.ended = true;
    if (!this.isLive()) UserData.markWatched(this.item);
    if (this.item.kind === 'episode') {
      UserData.setProgress(this.item, 0, 0);
      var next = this.context.items[this.index + 1];
      if (!next && this.item.seriesRef) UserData.markSeriesDone(this.item.seriesRef);
      if (next) {
        next.seriesRef = this.item.seriesRef;
        next.seriesName = this.item.seriesName;
        global.toast('Épisode suivant : ' + next.name);
        this.load(next, null, 0);
        return;
      }
    }
    if (!this.isLive()) { UserData.setProgress(this.item, 0, 0); App.pop(); }
  };

  PlayerScreen.prototype.saveProgress = function () {
    if (!this.item || this.isLive()) return;
    var v = this.video;
    if (this.startPos) return; // la reprise n'est pas encore faite : ne pas écraser la position enregistrée
    if (this.ended) { this.ended = false; return; }
    if (v.currentTime > 0) UserData.setProgress(this.item, v.currentTime, this.duration());
    // dernier épisode regardé jusqu'au bout : la série est terminée
    if (this.item.kind === 'episode' && this.item.seriesRef && UserData.isWatched(this.item.id) && !this.context.items[this.index + 1]) UserData.markSeriesDone(this.item.seriesRef);
  };

  // ------------------------------------------------------------ bandeaux d'information

  PlayerScreen.prototype.renderOsd = function () {
    var it = this.item;
    U.clear(this.top);
    U.clear(this.bottom);
    if (this.isLive()) {
      var left = U.el('div', 'osd-chan');
      left.appendChild(U.img(it.logo, 'osd-logo', it.name));
      var t = U.el('div', 'osd-chan-text');
      t.appendChild(U.el('div', 'osd-num', it.num ? 'Chaîne ' + it.num : ''));
      t.appendChild(U.el('div', 'osd-name', it.name));
      t.appendChild(U.el('div', 'osd-group', this.context.title || it.group || ''));
      left.appendChild(t);
      this.top.appendChild(left);
      this.top.appendChild(U.el('div', 'osd-clock', U.hhmm(Date.now())));
      if (UserData.isFavorite(it.id)) this.top.appendChild(U.el('div', 'osd-fav', '♥'));
      this.epgNow = U.el('div', 'osd-epg');
      this.epgNow.appendChild(U.el('div', 'osd-epg-empty', 'Pas d\'informations sur le programme'));
      this.bottom.appendChild(this.epgNow);
      this.bottom.appendChild(this.trackButton());
      this.bottom.appendChild(U.el('div', 'osd-keys', 'OK  Liste des chaînes     ▲▼  Zapper     ROUGE  Ma liste     VERT  Audio et sous-titres     RETOUR  Quitter'));
      this.loadEpg();
    } else {
      var title = it.kind === 'episode'
        ? (it.seriesName ? it.seriesName + ' — ' : '') + 'S' + U.pad(it.season || 1) + 'E' + U.pad(it.episode || 1) + ' · ' + it.name
        : it.name;
      this.bottom.appendChild(U.el('div', 'osd-title', title));
      var bar = U.el('div', 'vod-bar');
      var self = this;
      // clic sur la barre : aller à cet endroit du film
      U.pointer(bar, null, function (e) {
        var v = self.video;
        var dur = self.duration();
        var r = bar.getBoundingClientRect();
        if (!dur || !r.width || !e || e.clientX === undefined) return;
        var ratio = U.clamp((e.clientX - r.left) / r.width, 0, 1);
        self.seekTarget = null;
        try { v.currentTime = U.clamp(ratio * dur, 0, dur - 2); } catch (err) { /* rien */ }
        self.onTime();
        self.showOsd(true);
      });
      this.vodFill = U.el('div', 'vod-fill');
      this.vodSeek = U.el('div', 'vod-seek');
      bar.appendChild(this.vodFill);
      bar.appendChild(this.vodSeek);
      var times = U.el('div', 'vod-times');
      this.vodCur = U.el('span', '', '0:00');
      this.vodState = U.el('span', 'vod-state', '');
      this.vodDur = U.el('span', '', '');
      times.appendChild(this.vodCur);
      times.appendChild(this.vodState);
      times.appendChild(this.vodDur);
      this.bottom.appendChild(bar);
      this.bottom.appendChild(times);
      this.vodBar = bar;
      this.buildControls();
      this.bottom.appendChild(U.el('div', 'osd-keys', '◀▶  Choisir un bouton     OK  Valider     ▲  Barre de lecture (◀▶ pour avancer)' +
        (this.item.kind === 'episode' ? '     CH ▲▼  Épisode précédent / suivant' : '') + '     RETOUR  Quitter'));
    }
  };

  PlayerScreen.prototype.loadEpg = function () {
    var self = this, it = this.item;
    global.Epg.now([it], function (map) {
      if (self.item !== it) return;
      var list = map[it.epgKey] || [];
      var now = Date.now();
      var cur = list[0] && list[0].s <= now ? list[0] : null;
      var next = cur ? list[1] : list[0];
      if (!cur && !next) return;
      U.clear(self.epgNow);
      if (cur) {
        var line = U.el('div', 'osd-epg-line');
        line.appendChild(U.el('span', 'osd-epg-time', U.hhmm(cur.s) + ' – ' + U.hhmm(cur.e)));
        line.appendChild(U.el('span', 'osd-epg-title', cur.t));
        self.epgNow.appendChild(line);
        var bar = U.el('div', 'epg-bar');
        var f = U.el('div', 'epg-fill');
        f.style.width = U.clamp((now - cur.s) / (cur.e - cur.s), 0, 1) * 100 + '%';
        bar.appendChild(f);
        self.epgNow.appendChild(bar);
        if (cur.d) self.epgNow.appendChild(U.el('div', 'osd-epg-desc', cur.d));
      }
      if (next) self.epgNow.appendChild(U.el('div', 'osd-epg-next', 'Ensuite  ' + U.hhmm(next.s) + '   ' + next.t));
    });
  };

  PlayerScreen.prototype.showOsd = function (autoHide) {
    var self = this;
    this.el.classList.add('osd-on');
    clearTimeout(this.osdTimer);
    if (autoHide !== false) {
      this.osdTimer = setTimeout(function () {
        if (!self.video.paused || self.isLive()) {
          self.el.classList.remove('osd-on');
          if (self.ctrls) { self.ctrlFocus = 'pause'; self.paintControls(); }
        }
      }, this.isLive() ? 5000 : 4000);
    }
  };

  // ------------------------------------------------------------ barre de commandes (films et épisodes)

  var ICONS = {
    play: '<path d="M8 5v14l11-7z"/>',
    pause: '<path d="M6 5h4v14H6zM14 5h4v14h-4z"/>',
    prev: '<path d="M6 6h2v12H6zM9.5 12L18 18V6z"/>',
    next: '<path d="M16 6h2v12h-2zM6 18l8.5-6L6 6z"/>',
    back10: '<path d="M12 5V2L7 6l5 4V7a6 6 0 1 1-6 6H4a8 8 0 1 0 8-8z"/><text x="12" y="16.3" font-size="6.5" font-weight="800" text-anchor="middle" font-family="Arial, sans-serif">10</text>',
    fwd10: '<path d="M12 5V2l5 4-5 4V7a6 6 0 1 0 6 6h2a8 8 0 1 1-8-8z"/><text x="12" y="16.3" font-size="6.5" font-weight="800" text-anchor="middle" font-family="Arial, sans-serif">10</text>',
    subs: '<path fill-rule="evenodd" d="M4 5h16a1 1 0 0 1 1 1v12a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1zm2 8v2h5v-2H6zm7 0v2h5v-2h-5zm-7-3v2h8v-2H6zm10 0v2h2v-2h-2z"/>'
  };
  function icon(name) {
    return '<svg viewBox="0 0 24 24" width="100%" height="100%" fill="currentColor" xmlns="http://www.w3.org/2000/svg">' + ICONS[name] + '</svg>';
  }

  PlayerScreen.prototype.prevItem = function () {
    if (!this.item || this.item.kind !== 'episode' || !this.context || this.index < 1) return null;
    return this.context.items[this.index - 1] || null;
  };

  PlayerScreen.prototype.goPrev = function () {
    var prev = this.prevItem();
    if (!prev) return;
    prev.seriesRef = this.item.seriesRef; prev.seriesName = this.item.seriesName;
    this.saveProgress();
    global.toast('Épisode précédent : ' + prev.name);
    this.load(prev, null, 0);
  };

  PlayerScreen.prototype.buildControls = function () {
    var self = this;
    var row = U.el('div', 'ctrl-row');
    var list = [];
    function add(id, iconName, label, big, action) {
      var b = U.el('div', 'ctrl ctrl-' + id + (big ? ' ctrl-big' : ' ctrl-pill'));
      var ic = U.el('span', 'ctrl-icon');
      ic.innerHTML = icon(iconName);
      b.appendChild(ic);
      if (label) b.appendChild(U.el('span', 'ctrl-label', label));
      U.pointer(b, function () {
        if (self.ctrlFocus === id) return;
        self.ctrlFocus = id; self.paintControls(); self.keepOsd();
      }, function () { self.ctrlFocus = id; self.paintControls(); action(); });
      row.appendChild(b);
      list.push({ id: id, el: b, icon: ic, action: action });
    }
    if (this.prevItem()) add('prev', 'prev', 'Épisode précédent', false, function () { self.goPrev(); });
    add('back10', 'back10', '', true, function () { self.seek(-10); self.ctrlFocus = 'back10'; });
    add('pause', this.video.paused ? 'play' : 'pause', '', true, function () { self.togglePause(); });
    add('fwd10', 'fwd10', '', true, function () { self.seek(10); self.ctrlFocus = 'fwd10'; });
    if (this.nextItem()) add('next', 'next', 'Épisode suivant', false, function () { self.goNext(); });
    add('audio', 'subs', 'Audio et sous-titres', false, function () { self.openTracks(); });
    this.ctrls = list;
    this.ctrlFocus = 'pause';
    this.bottom.appendChild(row);
    this.paintControls();
  };

  PlayerScreen.prototype.paintControls = function () {
    if (!this.ctrls) return;
    for (var i = 0; i < this.ctrls.length; i++) {
      var c = this.ctrls[i];
      if (c.id === this.ctrlFocus) c.el.classList.add('focus'); else c.el.classList.remove('focus');
      if (c.id === 'pause') {
        var want = this.video.paused ? 'play' : 'pause';
        if (c.shown !== want) { c.icon.innerHTML = icon(want); c.shown = want; }
      }
    }
    if (this.vodBar) {
      if (this.ctrlFocus === 'bar') this.vodBar.classList.add('focus'); else this.vodBar.classList.remove('focus');
    }
  };

  PlayerScreen.prototype.moveControl = function (delta) {
    var ids = (this.ctrls || []).map(function (c) { return c.id; });
    var i = ids.indexOf(this.ctrlFocus);
    if (i < 0) i = ids.indexOf('pause');
    this.ctrlFocus = ids[U.clamp(i + delta, 0, ids.length - 1)];
  };

  // Garde le bandeau affiché (et relance le délai avant qu'il disparaisse).
  PlayerScreen.prototype.keepOsd = function () { this.showOsd(!this.video.paused); };

  PlayerScreen.prototype.nextItem = function () {
    if (!this.item || this.item.kind !== 'episode' || !this.context) return null;
    return this.context.items[this.index + 1] || null;
  };

  PlayerScreen.prototype.goNext = function () {
    var next = this.nextItem();
    if (!next) return;
    next.seriesRef = this.item.seriesRef; next.seriesName = this.item.seriesName;
    this.saveProgress();
    global.toast('Épisode suivant : ' + next.name);
    this.load(next, null, 0);
  };

  PlayerScreen.prototype.hideNextCard = function () {
    this.nextCardOn = false;
    if (this.nextCard) this.nextCard.style.display = 'none';
  };

  // Dans les dernières secondes (générique), on propose de passer tout de suite à l'épisode suivant.
  PlayerScreen.prototype.checkNextCard = function () {
    var next = this.nextItem();
    var v = this.video, dur = this.duration();
    if (!next || !dur || this.nextDismissed || this.seekTarget !== null) { if (this.nextCardOn && !next) this.hideNextCard(); return; }
    var left = dur - v.currentTime;
    var zone = Math.min(45, dur * 0.1);
    if (left <= zone && left > 0.3) {
      if (!this.nextCardOn) {
        U.clear(this.nextCard);
        this.nextCard.appendChild(U.el('div', 'next-card-kicker', 'Épisode suivant'));
        this.nextCard.appendChild(U.el('div', 'next-card-title', 'S' + U.pad(next.season || 1) + 'E' + U.pad(next.episode || 1) + ' · ' + next.name));
        this.nextCardBtn = U.el('div', 'next-card-btn', '▶  Lancer');
        this.nextCard.appendChild(this.nextCardBtn);
        this.nextCard.appendChild(U.el('div', 'next-card-keys', 'OK  Lancer     RETOUR  Continuer à regarder'));
        this.nextCard.style.display = 'block';
        this.nextCardOn = true;
      }
      this.nextCardBtn.textContent = '▶  Lancer dans ' + Math.ceil(left) + ' s';
    } else if (this.nextCardOn) this.hideNextCard();
  };

  PlayerScreen.prototype.onTime = function () {
    if (!this.isLive()) this.checkNextCard();
    if (this.isLive() || !this.vodFill) return;
    var v = this.video;
    var dur = this.duration();
    var cur = this.seekTarget !== null ? this.seekTarget : v.currentTime;
    this.vodFill.style.width = dur ? (v.currentTime / dur * 100) + '%' : '0';
    this.vodSeek.style.left = dur ? (cur / dur * 100) + '%' : '0';
    this.vodCur.textContent = U.duration(cur);
    this.vodDur.textContent = dur ? '-' + U.duration(dur - cur) : '';
    this.vodState.textContent = this.seekTarget !== null ? (this.seekTarget > v.currentTime ? '▶▶' : '◀◀') : (v.paused ? '❚❚  Pause' : '');
  };

  // ------------------------------------------------------------ liste des chaînes

  PlayerScreen.prototype.openList = function () {
    this.listOpen = true;
    this.listIndex = this.index;
    this.el.classList.add('list-on');
    this.el.classList.remove('osd-on');
    this.renderList();
  };

  PlayerScreen.prototype.closeList = function () {
    this.listOpen = false;
    this.el.classList.remove('list-on');
  };

  // keepWindow : sélection au pointeur, la liste ne défile pas sous la flèche.
  PlayerScreen.prototype.renderList = function (keepWindow) {
    var self = this;
    var items = this.context.items;
    U.clear(this.list);
    this.list.appendChild(U.el('div', 'chan-list-title', this.context.title || this.item.group || 'Chaînes'));
    var from = Math.max(0, Math.min(this.listIndex - 5, items.length - 11));
    if (keepWindow && this.listFrom !== undefined && this.listIndex >= this.listFrom && this.listIndex <= this.listFrom + 10) from = this.listFrom;
    this.listFrom = from;
    var to = Math.min(items.length - 1, from + 10);
    var shown = [];
    for (var i = from; i <= to; i++) {
      var c = items[i];
      var row = U.el('div', 'chan-row' + (i === this.listIndex ? ' focus' : '') + (i === this.index ? ' playing' : ''));
      U.pointer(row, this.listHover(i));
      row.appendChild(U.el('div', 'chan-row-num', c.num || ''));
      row.appendChild(U.img(c.logo, 'chan-row-logo', c.name));
      var tx = U.el('div', 'chan-row-text');
      tx.appendChild(U.el('div', 'chan-row-name', c.name));
      var sub = U.el('div', 'chan-row-sub', '');
      sub.setAttribute('data-key', c.epgKey || '');
      tx.appendChild(sub);
      row.appendChild(tx);
      this.list.appendChild(row);
      shown.push(c);
    }
    this.list.appendChild(U.el('div', 'chan-list-foot', (this.listIndex + 1) + ' / ' + items.length));
    global.Epg.now(shown, function (map) {
      if (!self.listOpen) return;
      var subs = self.list.querySelectorAll('.chan-row-sub');
      var now = Date.now();
      for (var j = 0; j < subs.length; j++) {
        var l = map[subs[j].getAttribute('data-key')];
        if (l && l[0] && l[0].s <= now) subs[j].textContent = l[0].t;
      }
    });
  };

  PlayerScreen.prototype.listHover = function (i) {
    var self = this;
    return function () {
      if (!self.listOpen || self.listIndex === i) return;
      self.listIndex = i;
      self.renderList(true);
    };
  };

  // ------------------------------------------------------------ pointeur (souris branchée sur la TV)

  PlayerScreen.prototype.onPointerMove = function () {
    if (!this.listOpen) this.showOsd(true);
  };

  // La molette fait défiler la liste des chaînes, mais ne zappe pas (pour éviter les accidents).
  PlayerScreen.prototype.onWheel = function (k) {
    if (this.tracksOpen) return this.tracksKey(k);
    if (this.isLive() && this.listOpen) this.onKey(k);
  };

  // ------------------------------------------------------------ appli en arrière-plan (bouton Accueil de la TV)

  PlayerScreen.prototype.suspend = function () {
    if (this.suspended) return;
    this.suspended = true;
    this.saveProgress();
    this.resumeAt = this.isLive() ? 0 : (this.video.currentTime || 0);
    this.wasPaused = this.video.paused;
    clearTimeout(this.stallTimer);
    if (this.isLive()) {
      // en direct, on coupe le flux pour ne pas consommer la connexion (ni un écran de l'abonnement)
      try { this.video.pause(); this.video.removeAttribute('src'); this.video.load(); } catch (e) { /* rien */ }
    } else {
      try { this.video.pause(); } catch (e2) { /* rien */ }
      // AVPlay : on rend le lecteur au système pendant que l'appli est en arrière-plan
      if (this.video.suspend) this.video.suspend();
    }
  };

  PlayerScreen.prototype.resume = function () {
    if (!this.suspended) return;
    this.suspended = false;
    if (this.isLive()) {
      this.loading(true);
      this.playUrl(this.currentUrl || this.item.url);
      this.showOsd(true);
    } else {
      if (this.video.restore) this.video.restore();
      if (this.wasPaused) return;
      var p = this.video.play();
      if (p && p.then) p.then(null, function () {});
    }
  };

  // ------------------------------------------------------------ zapping

  PlayerScreen.prototype.zap = function (delta) {
    var items = this.context.items;
    if (items.length < 2) return;
    var i = (this.index + delta + items.length) % items.length;
    this.load(items[i], null, 0);
  };

  PlayerScreen.prototype.typeDigit = function (d) {
    var self = this;
    this.digits = (this.digits + d).slice(-4);
    this.numBox.textContent = this.digits;
    this.numBox.style.display = 'block';
    clearTimeout(this.digitTimer);
    this.digitTimer = setTimeout(function () {
      var n = +self.digits;
      self.digits = '';
      self.numBox.style.display = 'none';
      var all = (global.Library.data && global.Library.data.live) || [];
      var hit = U.find(all, function (c) { return c.num === n; });
      if (hit) {
        // on zappe dans la catégorie de la chaîne trouvée
        var g = U.find(global.Library.data.liveGroups || [], function (x) { return x.name === hit.group; });
        self.load(hit, g ? { title: g.name, items: g.items } : { items: [hit] }, 0);
      } else global.toast('Aucune chaîne n° ' + n);
    }, 1600);
  };

  // ------------------------------------------------------------ déplacement dans une vidéo

  PlayerScreen.prototype.seek = function (delta) {
    var v = this.video;
    var dur = this.duration();
    if (!dur) return;
    var self = this;
    this.seekTarget = U.clamp((this.seekTarget !== null ? this.seekTarget : v.currentTime) + delta, 0, dur - 2);
    this.showOsd(false);
    this.onTime();
    clearTimeout(this.seekTimer);
    this.seekTimer = setTimeout(function () {
      try { v.currentTime = self.seekTarget; } catch (e) { /* rien */ }
      self.seekTarget = null;
      self.onTime();
      self.showOsd(true);
    }, 800);
  };

  PlayerScreen.prototype.togglePause = function () {
    var v = this.video;
    if (v.paused) { var p = v.play(); if (p && p.then) p.then(null, function () {}); }
    else v.pause();
    this.onTime();
    this.paintControls();
    this.showOsd(!v.paused);
  };

  // ------------------------------------------------------------ touches

  PlayerScreen.prototype.onKey = function (k) {
    if (this.tracksOpen) return this.tracksKey(k);
    if (k === 'green') return this.openTracks();
    if (this.isLive()) return this.liveKey(k);
    return this.vodKey(k);
  };

  PlayerScreen.prototype.liveKey = function (k) {
    if (this.listOpen) {
      var n = this.context.items.length;
      if (k === 'up') this.listIndex = (this.listIndex - 1 + n) % n;
      else if (k === 'down') this.listIndex = (this.listIndex + 1) % n;
      else if (k === 'chup') this.listIndex = Math.max(0, this.listIndex - 10);
      else if (k === 'chdown') this.listIndex = Math.min(n - 1, this.listIndex + 10);
      else if (k === 'enter') {
        if (this.listIndex !== this.index) this.load(this.context.items[this.listIndex], null, 0);
        this.closeList();
        this.showOsd(true);
        return;
      } else if (k === 'back' || k === 'right' || k === 'left') { this.closeList(); return; }
      this.renderList();
      return;
    }
    if (k === 'back' || k === 'stop') return App.pop();
    if (k === 'up' || k === 'chup') return this.zap(-1);
    if (k === 'down' || k === 'chdown') return this.zap(1);
    if (k === 'enter' || k === 'left') return this.openList();
    if (k === 'info' || k === 'right') { this.renderOsd(); return this.showOsd(true); }
    if (k === 'red') {
      var on = UserData.toggleFavorite(this.item);
      global.toast(on ? 'Ajoutée à Ma liste' : 'Retirée de Ma liste');
      this.renderOsd();
      return this.showOsd(true);
    }
    if (k.indexOf('digit') === 0) return this.typeDigit(k.slice(5));
  };

  PlayerScreen.prototype.vodKey = function (k) {
    if (this.nextCardOn) {
      if (k === 'enter') return this.goNext();
      if (k === 'back') { this.nextDismissed = true; return this.hideNextCard(); }
    }
    if (k === 'back' || k === 'stop') { this.saveProgress(); return App.pop(); }
    if (k === 'playpause') return this.togglePause();
    if (k === 'play') { if (this.video.paused) this.togglePause(); return; }
    if (k === 'pause') { if (!this.video.paused) this.togglePause(); return; }
    if (k === 'rw' || k === 'ff') { this.ctrlFocus = 'bar'; this.paintControls(); return this.seek(k === 'ff' ? 60 : -60); }
    if (k === 'chdown') return this.goNext();
    if (k === 'chup') return this.goPrev();
    var osdOn = this.el.className.indexOf('osd-on') !== -1;
    if (!osdOn) {
      // bandeau masqué : OK = pause, ◀▶ = reculer / avancer de 10 s, ▲▼ = afficher les commandes
      if (k === 'enter') { this.ctrlFocus = 'pause'; this.paintControls(); return this.togglePause(); }
      if (k === 'left' || k === 'right') { this.ctrlFocus = 'bar'; this.paintControls(); return this.seek(k === 'right' ? 10 : -10); }
      if (k === 'up' || k === 'down' || k === 'info') { this.ctrlFocus = 'pause'; this.paintControls(); return this.keepOsd(); }
      return;
    }
    if (this.ctrlFocus === 'bar') {
      // sur la barre de lecture
      if (k === 'left' || k === 'right') return this.seek(k === 'right' ? 10 : -10);
      if (k === 'enter') return this.togglePause();
      if (k === 'down') this.ctrlFocus = 'pause';
    } else {
      // sur les boutons
      if (k === 'left') this.moveControl(-1);
      else if (k === 'right') this.moveControl(1);
      else if (k === 'up') this.ctrlFocus = 'bar';
      else if (k === 'enter') {
        var id = this.ctrlFocus;
        for (var i = 0; i < this.ctrls.length; i++) if (this.ctrls[i].id === id) { this.ctrls[i].action(); break; }
        if (id === 'prev' || id === 'next' || id === 'audio') return;
      }
    }
    this.paintControls();
    this.keepOsd();
  };;

  // =============================================================== audio et sous-titres

  var LANGS = {
    fr: 'Français', en: 'Anglais', es: 'Espagnol', de: 'Allemand', it: 'Italien', pt: 'Portugais', ar: 'Arabe',
    ja: 'Japonais', tr: 'Turc', nl: 'Néerlandais', pl: 'Polonais', ru: 'Russe', zh: 'Chinois', ko: 'Coréen',
    hi: 'Hindi', el: 'Grec', ro: 'Roumain', sv: 'Suédois', da: 'Danois', no: 'Norvégien', fi: 'Finnois', he: 'Hébreu'
  };
  var ISO3 = {
    fre: 'fr', fra: 'fr', eng: 'en', spa: 'es', ger: 'de', deu: 'de', ita: 'it', por: 'pt', ara: 'ar', jpn: 'ja',
    tur: 'tr', dut: 'nl', nld: 'nl', pol: 'pl', rus: 'ru', chi: 'zh', zho: 'zh', kor: 'ko', hin: 'hi', gre: 'el',
    ell: 'el', rum: 'ro', ron: 'ro', swe: 'sv', dan: 'da', nor: 'no', fin: 'fi', heb: 'he'
  };
  function langCode(l) {
    l = String(l || '').toLowerCase().split(/[-_]/)[0];
    return ISO3[l] || l;
  }
  function trackLabel(t, i, kind) {
    var code = langCode(t.language);
    var name = LANGS[code] || (t.language ? String(t.language).toUpperCase() : '');
    var extra = t.label && t.label.toLowerCase() !== String(t.language).toLowerCase() && t.label !== name ? t.label : '';
    if (name && extra) return name + ' — ' + extra;
    return name || extra || (kind === 'audio' ? 'Piste audio ' : 'Sous-titres ') + (i + 1);
  }

  // Pistes disponibles : {audio: [...], subs: [...]}
  PlayerScreen.prototype.tracks = function () {
    var v = this.video, audio = [], subs = [], i;
    var at = v.audioTracks;
    if (at && at.length) for (i = 0; i < at.length; i++) audio.push({ i: i, label: trackLabel(at[i], i, 'audio'), on: !!at[i].enabled, lang: langCode(at[i].language) });
    var tt = v.textTracks;
    if (tt && tt.length) {
      for (i = 0; i < tt.length; i++) {
        var k = tt[i].kind;
        if (k && k !== 'subtitles' && k !== 'captions') continue;
        subs.push({ i: i, label: trackLabel(tt[i], i, 'sub'), on: tt[i] === this.subTrack, lang: langCode(tt[i].language) });
      }
    }
    return { audio: audio, subs: subs };
  };

  PlayerScreen.prototype.setAudio = function (idx) {
    var at = this.video.audioTracks;
    if (!at || !at[idx]) return;
    for (var i = 0; i < at.length; i++) at[i].enabled = i === idx;
    global.Settings.set({ audioLang: langCode(at[idx].language) || '' });
  };

  // Sous-titres : on lit les répliques nous-mêmes et on les affiche (idx = null : désactivés).
  PlayerScreen.prototype.setSubTrack = function (track) {
    var self = this;
    var tt = this.video.textTracks;
    if (tt) for (var i = 0; i < tt.length; i++) if (tt[i] !== track) { try { tt[i].mode = 'disabled'; } catch (e) { /* rien */ } }
    if (this.subTrack && this.subHandler) {
      try { this.subTrack.removeEventListener('cuechange', this.subHandler); } catch (e2) { /* rien */ }
    }
    this.subTrack = track || null;
    this.subBox.textContent = '';
    if (!track) return;
    try { track.mode = 'hidden'; } catch (e3) { /* rien */ }
    this.subHandler = function () { self.showCues(); };
    track.addEventListener('cuechange', this.subHandler);
    this.showCues();
  };

  PlayerScreen.prototype.showCues = function () {
    var t = this.subTrack, out = [];
    var cues = t && t.activeCues;
    if (cues) for (var i = 0; i < cues.length; i++) out.push(String(cues[i].text || '').replace(/<[^>]+>/g, '').replace(/\{[^}]*\}/g, ''));
    this.subBox.textContent = out.join('\n');
    this.subBox.style.display = out.length ? 'block' : 'none';
  };

  // Rappelle les derniers choix (langue audio, sous-titres) sur chaque nouvelle vidéo.
  PlayerScreen.prototype.applyTrackPrefs = function () {
    var st = global.Settings.get(), tr = this.tracks(), i;
    if (!this.prefsApplied.audio && st.audioLang && tr.audio.length > 1) {
      for (i = 0; i < tr.audio.length; i++) {
        if (tr.audio[i].lang === st.audioLang) { if (!tr.audio[i].on) this.setAudio(tr.audio[i].i); this.prefsApplied.audio = true; break; }
      }
    }
    if (!this.prefsApplied.sub && st.subLang && st.subLang !== 'off' && tr.subs.length) {
      for (i = 0; i < tr.subs.length; i++) {
        if (tr.subs[i].lang === st.subLang) { this.setSubTrack(this.video.textTracks[tr.subs[i].i]); this.prefsApplied.sub = true; break; }
      }
    }
  };

  PlayerScreen.prototype.trackButton = function () {
    var self = this;
    var b = U.el('div', 'osd-btn', '◫  Audio et sous-titres');
    U.pointer(b, null, function () { self.openTracks(); });
    return b;
  };

  PlayerScreen.prototype.openTracks = function () {
    if (this.listOpen) this.closeList();
    var tr = this.tracks();
    this.tracksOpen = true;
    this.tcol = tr.audio.length > 1 || !tr.subs.length ? 0 : 1;
    this.trow = [0, 0];
    for (var i = 0; i < tr.audio.length; i++) if (tr.audio[i].on) this.trow[0] = i;
    for (var j = 0; j < tr.subs.length; j++) if (tr.subs[j].on) this.trow[1] = j + 1;
    this.el.classList.add('tracks-on');
    this.showOsd(false);
    this.renderTracks();
  };

  PlayerScreen.prototype.closeTracks = function () {
    this.tracksOpen = false;
    this.el.classList.remove('tracks-on');
    this.showOsd(true);
  };

  PlayerScreen.prototype.renderTracks = function () {
    var self = this, tr = this.tracks();
    U.clear(this.trackBox);
    var cols = U.el('div', 'track-cols');
    function column(ci, title, items, empty) {
      var c = U.el('div', 'track-col');
      c.appendChild(U.el('div', 'track-title', title));
      if (!items.length) c.appendChild(U.el('div', 'track-empty', empty));
      U.each(items, function (it, r) {
        var e = U.el('div', 'track-item' + (it.on ? ' on' : '') + (self.tcol === ci && self.trow[ci] === r ? ' focus' : ''), (it.on ? '✓  ' : '') + it.label);
        U.pointer(e, function () {
          if (self.tcol === ci && self.trow[ci] === r) return;
          self.tcol = ci; self.trow[ci] = r; self.renderTracks();
        }, function () { self.tcol = ci; self.trow[ci] = r; self.pickTrack(); });
        c.appendChild(e);
      });
      cols.appendChild(c);
    }
    var audio = tr.audio;
    if (audio.length < 2) audio = []; // une seule langue : rien à choisir
    column(0, 'Audio', audio, 'Une seule langue dans cette vidéo');
    var subs = [{ i: -1, label: 'Désactivés', on: !this.subTrack }].concat(tr.subs);
    column(1, 'Sous-titres', tr.subs.length ? subs : [], 'Aucun sous-titre dans cette vidéo');
    this.trackBox.appendChild(cols);
    this.trackBox.appendChild(U.el('div', 'track-keys', '◀▶  Audio / Sous-titres     OK  Choisir     RETOUR  Fermer'));
    this.trackData = { audio: audio, subs: tr.subs.length ? subs : [] };
  };

  PlayerScreen.prototype.pickTrack = function () {
    var d = this.trackData;
    if (this.tcol === 0) {
      var a = d.audio[this.trow[0]];
      if (a && this.video.audioTracks && this.video.audioTracks.length > 1) { this.setAudio(a.i); global.toast('Audio : ' + a.label); }
    } else {
      var sItem = d.subs[this.trow[1]];
      if (!sItem) return;
      if (sItem.i < 0) { this.setSubTrack(null); global.Settings.set({ subLang: 'off' }); global.toast('Sous-titres désactivés'); }
      else {
        this.setSubTrack(this.video.textTracks[sItem.i]);
        global.Settings.set({ subLang: langCode(this.video.textTracks[sItem.i].language) || 'off' });
        global.toast('Sous-titres : ' + sItem.label);
      }
    }
    this.renderTracks();
  };

  PlayerScreen.prototype.tracksKey = function (k) {
    var d = this.trackData || { audio: [], subs: [] };
    var len = [d.audio.length, d.subs.length];
    if (k === 'back' || k === 'green' || k === 'stop') return this.closeTracks();
    if (k === 'left' && len[0]) this.tcol = 0;
    else if (k === 'right' && len[1]) this.tcol = 1;
    else if (k === 'up') this.trow[this.tcol] = Math.max(0, this.trow[this.tcol] - 1);
    else if (k === 'down') this.trow[this.tcol] = Math.min(Math.max(0, len[this.tcol] - 1), this.trow[this.tcol] + 1);
    else if (k === 'enter') return this.pickTrack();
    else if (k === 'playpause' || k === 'play' || k === 'pause') return this.isLive() ? null : this.togglePause();
    this.renderTracks();
  };

  PlayerScreen.prototype.onWheelTracks = function (k) { if (this.tracksOpen) this.tracksKey(k); };

  // pendant la lecture, les messages s'affichent en haut (pour ne pas cacher les boutons)
  PlayerScreen.prototype.onShow = function () { document.body.classList.add('playing'); };
  PlayerScreen.prototype.onHide = function () { document.body.classList.remove('playing'); };

  PlayerScreen.prototype.destroy = function () {
    document.body.classList.remove('playing');
    this.suspended = false;
    this.setSubTrack(null);
    this.saveProgress();
    clearInterval(this.saveTimer);
    clearTimeout(this.osdTimer);
    clearTimeout(this.stallTimer);
    clearTimeout(this.digitTimer);
    clearTimeout(this.seekTimer);
    var v = this.video;
    try { v.pause(); v.removeAttribute('src'); v.load(); } catch (e) { /* rien */ }
  };

  var Player = {
    play: function (item, context, startPos) {
      if (!item || !item.url) return global.toast('Adresse du flux manquante');
      var top = App.top();
      if (top instanceof PlayerScreen) return top.load(item, context, startPos);
      var ctx = context && context.items ? { title: context.title, items: context.items } : null;
      // un film ou une chaîne ouverte depuis « Ma liste » : on zappe dans sa catégorie
      if (item.kind === 'live' && (!ctx || ctx.items.length < 2 || ctx.items[0].kind !== 'live')) {
        var g = U.find((global.Library.data && global.Library.data.liveGroups) || [], function (x) { return x.name === item.group; });
        if (g) ctx = { title: g.name, items: g.items };
      }
      App.push(new PlayerScreen(item, ctx, startPos));
    },
    Screen: PlayerScreen
  };

  global.Player = Player;
})(window);

/* Canapé TV (Samsung Tizen) — écrans : accueil et rubriques, fiche film, fiche série, recherche, réglages, ajout de playlist. */
(function (global) {
  'use strict';
  var U = global.U, App = global.App, Library = global.Library, UserData = global.UserData;

  var TABS = [
    { id: 'home', label: 'Accueil' },
    { id: 'live', label: 'TV en direct' },
    { id: 'movies', label: 'Films' },
    { id: 'series', label: 'Séries' },
    { id: 'mylist', label: 'Ma liste' },
    { id: 'search', label: 'Recherche' },
    { id: 'settings', label: 'Réglages' }
  ];

  // Ouvre ce qu'il faut selon le type d'élément.
  function openItem(item, context) {
    if (!item) return;
    if (item.realItem) item = item.realItem;
    if (item.kind === 'live') return global.Player.play(item, context || null);
    if (item.kind === 'movie') return App.push(new Detail(item));
    if (item.kind === 'series') return App.push(new SeriesScreen(item));
    if (item.kind === 'episode') {
      var s = item.seriesRef && Library.byId(item.seriesRef);
      if (s) return App.push(new SeriesScreen(s, item));
      return global.Player.play(item, null);
    }
  }

  function toggleFav(item, after) {
    if (!item || item.kind === 'episode') return;
    var on = UserData.toggleFavorite(item);
    global.toast(on ? 'Ajouté à Ma liste' : 'Retiré de Ma liste');
    if (after) after();
  }

  function askExit() {
    global.Dialog.show({
      title: 'Quitter Canapé TV ?', buttons: [
        { label: 'Rester' },
        { label: 'Quitter', action: function () { App.exit(); } }
      ]
    });
  }

  function stars(r) {
    if (!r) return '';
    var n = Math.round(r);
    var out = '';
    for (var i = 0; i < 5; i++) out += i < n ? '★' : '☆';
    return out;
  }

  // =============================================================== écran principal

  function Browse() {
    var self = this;
    this.el = U.el('div', 'screen browse');
    this.tab = 0;
    this.zone = 'rows';

    // menu du haut
    var nav = U.el('div', 'nav');
    nav.appendChild(U.el('div', 'brand', 'canapé'));
    var tabs = U.el('div', 'nav-tabs');
    this.tabEls = TABS.map(function (t, i) {
      var e = U.el('div', 'nav-tab', t.label);
      U.pointer(e, function () {
        if (self.zone === 'nav' && self.navIndex() === i) return;
        self.zone = 'nav';
        self.navI = i;
        self.paintNav();
      });
      tabs.appendChild(e);
      return e;
    });
    nav.appendChild(tabs);
    this.clock = U.el('div', 'clock');
    nav.appendChild(this.clock);
    this.el.appendChild(nav);

    // grande bannière
    this.hero = U.el('div', 'hero');
    this.heroBg = U.el('div', 'hero-bg');
    this.heroLogo = U.el('div', 'hero-logo');
    var heroText = U.el('div', 'hero-text');
    this.heroKicker = U.el('div', 'hero-kicker');
    this.heroTitle = U.el('div', 'hero-title');
    this.heroMeta = U.el('div', 'hero-meta');
    this.heroDesc = U.el('div', 'hero-desc');
    this.heroNext = U.el('div', 'hero-next');
    heroText.appendChild(this.heroKicker);
    heroText.appendChild(this.heroTitle);
    heroText.appendChild(this.heroMeta);
    heroText.appendChild(this.heroDesc);
    heroText.appendChild(this.heroNext);
    this.hero.appendChild(this.heroBg);
    this.hero.appendChild(U.el('div', 'hero-shade'));
    this.hero.appendChild(this.heroLogo);
    this.hero.appendChild(heroText);
    this.el.appendChild(this.hero);

    this.rowsBox = U.el('div', 'rows');
    this.el.appendChild(this.rowsBox);
    this.empty = U.el('div', 'empty');
    this.el.appendChild(this.empty);
    this.hint = U.el('div', 'hint', '');
    this.el.appendChild(this.hint);

    this.rows = new global.Rows(this.rowsBox, {
      onFocus: U.debounce(function (item) { self.showHero(item); }, 180),
      onSelect: function (item, row) { openItem(item, row); },
      onEpg: function () { self.showHero(self.rows.current(), true); },
      onPoint: function () {
        if (self.zone === 'rows') return;
        self.zone = 'rows';
        self.navI = undefined;
        self.paintNav();
      }
    });

    this.tick();
    this.clockTimer = setInterval(function () { self.tick(); }, 20000);
    global.Epg.onReady = function () { self.rows.epgMap = {}; self.rows.scheduleEpg(); };
  }

  Browse.prototype.tick = function () { this.clock.textContent = U.hhmm(Date.now()); };

  Browse.prototype.onShow = function (first) {
    if (first) this.showTab(0, true);
    else this.refresh();
  };

  Browse.prototype.destroy = function () {
    clearInterval(this.clockTimer);
    this.rows.destroy();
  };

  // Après retour d'un autre écran : favoris, reprise et récents ont pu changer.
  Browse.prototype.refresh = function () {
    var id = TABS[this.tab].id;
    if (id === 'search' || id === 'settings') return;
    this.rows.setRows(this.buildRows(id), true);
    this.afterRows();
  };

  Browse.prototype.showTab = function (i, focusRows) {
    var id = TABS[i].id;
    if (id === 'search') { App.push(new SearchScreen()); return; }
    if (id === 'settings') { App.push(new SettingsScreen()); return; }
    this.tab = i;
    this.rows.setRows(this.buildRows(id), false);
    this.afterRows();
    if (focusRows && !this.rows.empty()) this.zone = 'rows';
    else this.zone = 'nav';
    this.paintNav();
  };

  Browse.prototype.afterRows = function () {
    var id = TABS[this.tab].id;
    var isEmpty = this.rows.empty();
    this.empty.style.display = isEmpty ? 'block' : 'none';
    this.empty.textContent = isEmpty ? ({
      mylist: 'Ta liste est vide. Sur une chaîne, un film ou une série, appuie sur le bouton ROUGE pour l\'ajouter.',
      live: 'Aucune chaîne dans cette playlist.',
      movies: 'Aucun film dans cette playlist.',
      series: 'Aucune série dans cette playlist.'
    }[id] || 'Rien à afficher pour le moment.') : '';
    this.hero.style.visibility = isEmpty ? 'hidden' : 'visible';
    if (isEmpty) this.zone = 'nav';
    this.showHero(this.rows.current());
    this.paintNav();
  };

  Browse.prototype.buildRows = function (id) {
    var d = Library.data || { liveGroups: [], movieGroups: [], seriesGroups: [], live: [] };
    var rows = [];
    var hideAdult = global.Settings.get().hideAdult;
    function visible(list) { return list.filter(function (x) { return !(hideAdult && Library.isAdult(x.group)); }); }
    function liveFresh(list) {
      // reprend la version à jour de la chaîne (adresse, logo)
      return list.map(function (x) { return Library.byId(x.id) || x; });
    }
    var cont = visible(UserData.continueWatching());
    var recents = visible(liveFresh(UserData.recents()));
    var favs = visible(liveFresh(UserData.favorites()));
    var groups;

    if (id === 'home') {
      rows.push({ title: 'Reprendre la lecture', items: cont, type: 'wide' });
      rows.push({ title: 'Chaînes regardées récemment', items: recents.filter(function (x) { return x.kind === 'live'; }), type: 'live' });
      rows.push({ title: 'Ma liste', items: favs.filter(function (x) { return x.kind !== 'live'; }), type: 'poster' });
      rows.push({ title: 'Mes chaînes', items: favs.filter(function (x) { return x.kind === 'live'; }), type: 'live' });
      rows.push({ title: 'Films récemment ajoutés', items: d.latestMovies || [], type: 'poster' });
      rows.push({ title: 'Séries récemment mises à jour', items: d.latestSeries || [], type: 'poster' });
      groups = (d.liveGroups || []).slice(0, 4).concat((d.movieGroups || []).slice(0, 3)).concat((d.seriesGroups || []).slice(0, 3));
      U.each(groups, function (g) { rows.push({ title: g.name, items: g.items }); });
    } else if (id === 'live') {
      rows.push({ title: 'Récemment regardées', items: recents.filter(function (x) { return x.kind === 'live'; }), type: 'live' });
      rows.push({ title: 'Mes chaînes', items: favs.filter(function (x) { return x.kind === 'live'; }), type: 'live' });
      U.each(d.liveGroups || [], function (g) { rows.push({ title: g.name, items: g.items, type: 'live' }); });
    } else if (id === 'movies') {
      rows.push({ title: 'Reprendre', items: cont.filter(function (x) { return x.kind === 'movie'; }), type: 'wide' });
      rows.push({ title: 'Récemment ajoutés', items: d.latestMovies || [], type: 'poster' });
      U.each(d.movieGroups || [], function (g) { rows.push({ title: g.name, items: g.items, type: 'poster' }); });
    } else if (id === 'series') {
      // « À reprendre » : les séries commencées et pas terminées, comme sur les plateformes de streaming
      var started = [];
      U.each(UserData.seriesInProgress(), function (sp) {
        var s = Library.byId(sp.ref);
        if (!s || (hideAdult && Library.isAdult(s.group))) return;
        var code = 'S' + U.pad(sp.season || 1) + 'E' + U.pad(sp.episode || 1);
        var x = U.extend({}, s);
        x.resumeLabel = sp.mode === 'resume' ? '▶ ' + code + ' · ' + U.duration(sp.pos) : 'Après ' + code;
        x.realItem = s;
        started.push(x);
      });
      rows.push({ title: 'À reprendre', items: started, type: 'poster' });
      rows.push({ title: 'Récemment mises à jour', items: d.latestSeries || [], type: 'poster' });
      U.each(d.seriesGroups || [], function (g) { rows.push({ title: g.name, items: g.items, type: 'poster' }); });
    } else if (id === 'mylist') {
      rows.push({ title: 'Reprendre la lecture', items: cont, type: 'wide' });
      rows.push({ title: 'Mes chaînes', items: favs.filter(function (x) { return x.kind === 'live'; }), type: 'live' });
      rows.push({ title: 'Mes films', items: favs.filter(function (x) { return x.kind === 'movie'; }), type: 'poster' });
      rows.push({ title: 'Mes séries', items: favs.filter(function (x) { return x.kind === 'series'; }), type: 'poster' });
    }
    return rows;
  };

  Browse.prototype.paintNav = function () {
    for (var i = 0; i < this.tabEls.length; i++) {
      var cls = 'nav-tab';
      if (i === this.tab) cls += ' active';
      if (this.zone === 'nav' && i === this.navIndex()) cls += ' focus';
      this.tabEls[i].className = cls;
    }
    this.rows.setBlurred(this.zone === 'nav');
    this.el.className = 'screen browse' + (this.zone === 'nav' ? ' in-nav' : '');
    this.hint.innerHTML = this.zone === 'rows'
      ? '<span class="k k-red"></span> Ma liste &nbsp; <span class="k">OK</span> Ouvrir &nbsp; <span class="k">CH ▲▼</span> Défiler vite'
      : '';
  };

  Browse.prototype.navIndex = function () { return this.navI === undefined ? this.tab : this.navI; };

  Browse.prototype.showHero = function (item, epgOnly) {
    if (!item) return;
    var same = this.heroItem === item;
    if (epgOnly && !same) return;
    this.heroItem = item;
    var self = this;
    var kind = { live: 'En direct', movie: 'Film', series: 'Série', episode: 'Épisode' }[item.kind] || '';
    this.heroKicker.textContent = kind + (item.group ? '  ·  ' + item.group : '');
    this.heroTitle.textContent = item.kind === 'episode' ? (item.seriesName || item.name) : item.name;
    var meta = [];
    if (item.kind === 'live' && item.num) meta.push('Chaîne ' + item.num);
    if (item.year) meta.push(item.year);
    if (item.rating) meta.push(stars(item.rating));
    if (item.kind === 'episode') meta.push('Saison ' + (item.season || 1) + ' · Épisode ' + (item.episode || 1));
    if (item.progress) meta.push('Vu à ' + Math.round(item.progress * 100) + ' %');
    if (UserData.isFavorite(item.id)) meta.push('♥ Dans ma liste');
    this.heroMeta.textContent = meta.join('   ·   ');
    this.heroDesc.textContent = item.plot || '';
    this.heroNext.textContent = '';

    if (!same) {
      var art = item.backdrop || item.logo;
      U.bgImage(this.heroBg, art);
      this.heroBg.className = 'hero-bg ' + (item.kind === 'live' ? 'is-logo' : 'is-poster') + (item.backdrop ? ' is-backdrop' : '');
      U.clear(this.heroLogo);
      if (item.kind === 'live' || !item.backdrop) {
        this.heroLogo.appendChild(U.img(item.logo, 'hero-logo-img ' + (item.kind === 'live' ? 'logo' : 'poster'), item.name));
      }
    }

    if (item.kind === 'live') {
      var map = this.rows.epgMap || {};
      var list = map[item.epgKey];
      var now = Date.now();
      if (list && list.length) {
        var cur = list[0].s <= now ? list[0] : null;
        var next = cur ? list[1] : list[0];
        if (cur) {
          this.heroDesc.textContent = '';
          this.heroDesc.appendChild(U.el('span', 'live-dot', ''));
          this.heroDesc.appendChild(document.createTextNode(U.hhmm(cur.s) + ' – ' + U.hhmm(cur.e) + '   ' + cur.t));
          if (cur.d) this.heroDesc.appendChild(U.el('div', 'hero-desc-small', cur.d));
        }
        if (next) this.heroNext.textContent = 'Ensuite à ' + U.hhmm(next.s) + ' : ' + next.t;
      } else if (!epgOnly) {
        this.heroDesc.textContent = 'Appuie sur OK pour regarder.';
      }
    }

    // résumé des films (chargé à la demande, une seule fois)
    if (item.kind === 'movie' && !item.plot && !item.infoLoaded && !epgOnly) {
      clearTimeout(this.infoTimer);
      this.infoTimer = setTimeout(function () {
        if (self.heroItem !== item) return;
        Library.movieInfo(item, function (err, info) {
          item.infoLoaded = true;
          if (info) {
            item.plot = info.plot; item.year = item.year || info.year; item.genre = info.genre;
            item.duration = info.duration; item.backdrop = item.backdrop || info.backdrop;
            item.cast = info.cast; item.director = info.director;
            if (!item.rating && info.rating) item.rating = info.rating;
          }
          if (self.heroItem === item) { self.heroItem = null; self.showHero(item); }
        });
      }, 700);
    }
  };

  Browse.prototype.onKey = function (k) {
    var self = this;
    if (this.zone === 'nav') {
      var n = this.navIndex();
      if (k === 'left') this.navI = Math.max(0, n - 1);
      else if (k === 'right') this.navI = Math.min(TABS.length - 1, n + 1);
      else if (k === 'enter' || k === 'down') {
        var target = this.navIndex();
        this.navI = undefined;
        if (TABS[target].id === 'search' || TABS[target].id === 'settings') { this.showTab(target); return; }
        if (target !== this.tab) this.showTab(target, true);
        else if (!this.rows.empty()) this.zone = 'rows';
      } else if (k === 'back') {
        if (this.navIndex() !== 0) { this.navI = undefined; this.showTab(0, false); return; }
        askExit();
        return;
      }
      this.paintNav();
      return;
    }
    // zone des rangées
    if (k === 'back') { this.zone = 'nav'; this.navI = this.tab; this.paintNav(); return; }
    if (k === 'red') {
      toggleFav(this.rows.current(), function () {
        if (TABS[self.tab].id === 'mylist' || TABS[self.tab].id === 'home') self.refresh();
        else self.rows.refreshCurrent();
        self.heroItem = null;
        self.showHero(self.rows.current());
      });
      return;
    }
    if (k === 'info') {
      var it = this.rows.current();
      if (it && it.kind === 'movie') App.push(new Detail(it));
      return;
    }
    if (!this.rows.key(k)) { this.zone = 'nav'; this.navI = this.tab; this.paintNav(); }
  };

  // =============================================================== fiche d'un film

  function Detail(item) {
    var self = this;
    this.item = item;
    this.el = U.el('div', 'screen detail');
    this.bg = U.el('div', 'detail-bg');
    this.el.appendChild(this.bg);
    this.el.appendChild(U.el('div', 'detail-shade'));
    var body = U.el('div', 'detail-body');
    this.poster = U.img(item.logo, 'detail-poster', item.name);
    body.appendChild(this.poster);
    var info = U.el('div', 'detail-info');
    info.appendChild(U.el('div', 'hero-kicker', 'Film' + (item.group ? '  ·  ' + item.group : '')));
    info.appendChild(U.el('div', 'detail-title', item.name));
    this.meta = U.el('div', 'hero-meta');
    info.appendChild(this.meta);
    this.plot = U.el('div', 'detail-plot', 'Chargement des informations…');
    info.appendChild(this.plot);
    this.credits = U.el('div', 'detail-credits');
    info.appendChild(this.credits);
    this.btnBox = U.el('div', 'detail-buttons');
    info.appendChild(this.btnBox);
    body.appendChild(info);
    this.el.appendChild(body);
    this.buildButtons();
    Library.movieInfo(item, function (err, inf) {
      if (inf) {
        item.infoLoaded = true;
        item.plot = item.plot || inf.plot; item.year = item.year || inf.year; item.genre = inf.genre || item.genre;
        item.duration = inf.duration || item.duration; item.backdrop = item.backdrop || inf.backdrop;
        item.cast = inf.cast || item.cast; item.director = inf.director || item.director;
        if (!item.rating && inf.rating) item.rating = inf.rating;
      }
      self.fill();
    });
    this.fill();
  }

  Detail.prototype.fill = function () {
    var it = this.item;
    var meta = [];
    if (it.year) meta.push(it.year);
    if (it.duration) meta.push(it.duration);
    if (it.genre) meta.push(it.genre);
    if (it.rating) meta.push(stars(it.rating));
    this.meta.textContent = meta.join('   ·   ');
    this.plot.textContent = it.plot || (it.infoLoaded ? 'Pas de résumé disponible.' : 'Chargement des informations…');
    var cr = [];
    if (it.director) cr.push('Réalisation : ' + it.director);
    if (it.cast) cr.push('Avec : ' + it.cast);
    this.credits.textContent = cr.join('\n');
    var art = it.backdrop || it.logo;
    if (art !== this.bgArt) { this.bgArt = art; U.bgImage(this.bg, art); }
    this.bg.className = 'detail-bg' + (it.backdrop ? ' is-backdrop' : '');
  };

  Detail.prototype.buildButtons = function () {
    var self = this, it = this.item;
    var prog = UserData.getProgress(it.id);
    var btns = [];
    if (prog) {
      btns.push({ label: '▶  Reprendre à ' + U.duration(prog.pos), action: function () { global.Player.play(it, null, prog.pos); } });
      btns.push({ label: '↺  Depuis le début', action: function () { global.Player.play(it, null, 0); } });
    } else {
      btns.push({ label: '▶  Lecture', action: function () { global.Player.play(it, null, 0); } });
    }
    btns.push({
      label: UserData.isFavorite(it.id) ? '♥  Dans ma liste' : '♡  Ajouter à ma liste',
      action: function () { toggleFav(it, function () { self.buildButtons(); }); }
    });
    U.clear(this.btnBox);
    this.buttons = btns;
    this.bi = Math.min(this.bi || 0, btns.length - 1);
    this.btnEls = btns.map(function (b, i) {
      var e = U.el('div', 'btn', b.label);
      U.pointer(e, function () { if (self.bi !== i) { self.bi = i; self.paint(); } });
      self.btnBox.appendChild(e);
      return e;
    });
    this.paint();
  };

  Detail.prototype.paint = function () {
    for (var i = 0; i < this.btnEls.length; i++) this.btnEls[i].className = 'btn' + (i === this.bi ? ' focus' : '');
  };

  Detail.prototype.onShow = function (first) { if (!first) this.buildButtons(); };

  Detail.prototype.onKey = function (k) {
    if (k === 'back') return App.pop();
    if (k === 'left') this.bi = Math.max(0, this.bi - 1);
    else if (k === 'right') this.bi = Math.min(this.buttons.length - 1, this.bi + 1);
    else if (k === 'enter') return this.buttons[this.bi].action();
    else if (k === 'red') return toggleFav(this.item, this.buildButtons.bind(this));
    else if (k === 'play' || k === 'playpause') return this.buttons[0].action();
    this.paint();
  };

  // =============================================================== fiche d'une série

  function SeriesScreen(series, focusEpisode) {
    var self = this;
    this.series = series;
    this.focusEpisode = focusEpisode || null;
    this.el = U.el('div', 'screen detail series');
    this.bg = U.el('div', 'detail-bg');
    this.el.appendChild(this.bg);
    this.el.appendChild(U.el('div', 'detail-shade'));
    var head = U.el('div', 'series-head');
    head.appendChild(U.el('div', 'hero-kicker', 'Série' + (series.group ? '  ·  ' + series.group : '')));
    head.appendChild(U.el('div', 'detail-title', series.name));
    this.meta = U.el('div', 'hero-meta');
    head.appendChild(this.meta);
    this.plot = U.el('div', 'detail-plot short', '');
    head.appendChild(this.plot);
    this.btnBox = U.el('div', 'detail-buttons');
    head.appendChild(this.btnBox);
    this.el.appendChild(head);
    this.seasonBox = U.el('div', 'season-tabs');
    this.el.appendChild(this.seasonBox);
    this.epBox = U.el('div', 'episodes');
    this.el.appendChild(this.epBox);
    this.zone = 'buttons';
    this.bi = 0; this.si = 0; this.ei = 0;
    this.seasons = [];
    this.plot.textContent = 'Chargement des épisodes…';
    this.buildButtons();
    this.fill();
    Library.seriesInfo(series, function (err) {
      if (err) { self.plot.textContent = 'Impossible de charger les épisodes : ' + err.message; return; }
      self.seasons = Object.keys(series.seasons || {}).sort(function (a, b) { return a - b; });
      var target = self.focusEpisode || (self.resumeTarget() || {}).ep;
      if (target) {
        var si = self.seasons.indexOf(String(target.season));
        if (si >= 0) self.si = si;
      }
      // tous les épisodes vus : la série ne doit plus apparaître dans « À reprendre »
      if (!self.resumeTarget()) {
        var anySeen = false, seenMap = UserData.watched();
        U.each(self.allEpisodes(), function (ep) { if (seenMap[ep.id]) anySeen = true; });
        if (anySeen) UserData.markSeriesDone(series.id);
      }
      self.fill();
      self.buildSeasons();
      self.buildEpisodes(true);
      self.buildButtons();
      self.paint();
    });
  }

  SeriesScreen.prototype.fill = function () {
    var s = this.series;
    var meta = [];
    if (s.year) meta.push(s.year);
    if (s.genre) meta.push(s.genre);
    if (s.rating) meta.push(stars(s.rating));
    if (this.seasons.length) meta.push(this.seasons.length + ' saison' + (this.seasons.length > 1 ? 's' : ''));
    this.meta.textContent = meta.join('   ·   ');
    if (s.seasons) this.plot.textContent = s.plot || '';
    var art = s.backdrop || s.logo;
    if (art !== this.bgArt) { this.bgArt = art; U.bgImage(this.bg, art); }
    this.bg.className = 'detail-bg' + (s.backdrop ? ' is-backdrop' : '');
  };

  SeriesScreen.prototype.episodes = function () {
    var s = this.series;
    return (s.seasons && s.seasons[this.seasons[this.si]]) || [];
  };

  // Tous les épisodes dans l'ordre (saison 1, 2…, bonus à la fin).
  SeriesScreen.prototype.allEpisodes = function () {
    var s = this.series, out = [];
    var keys = Object.keys(s.seasons || {}).sort(function (a, b) {
      if (+a === 0) return 1; if (+b === 0) return -1; return a - b;
    });
    U.each(keys, function (k) { U.each(s.seasons[k] || [], function (ep) { out.push(ep); }); });
    return out;
  };

  // Où reprendre : l'épisode commencé le plus récemment, ou celui qui suit le dernier épisode terminé.
  SeriesScreen.prototype.resumeTarget = function () {
    var prog = UserData.progress(), seen = UserData.watched();
    var eps = this.allEpisodes();
    var best = null;
    U.each(eps, function (ep, i) {
      var p = prog[ep.id], w = seen[ep.id];
      if (p && (!best || p.at > best.at)) best = { at: p.at, ep: ep, p: p, mode: 'resume' };
      if (w && (!best || w.at > best.at)) best = { at: w.at, ep: eps[i + 1] || null, p: null, mode: 'next', done: ep };
    });
    if (best && !best.ep) return null; // série terminée
    return best;
  };

  SeriesScreen.prototype.buildButtons = function () {
    var self = this, s = this.series;
    var btns = [];
    var r = this.resumeTarget();
    var first = this.allEpisodes()[0] || null;
    var code = function (ep) { return 'S' + U.pad(ep.season) + 'E' + U.pad(ep.episode); };
    if (r && r.mode === 'resume') {
      btns.push({ label: '▶  Reprendre ' + code(r.ep) + ' à ' + U.duration(r.p.pos), action: function () { self.play(r.ep, r.p.pos); } });
      btns.push({ label: '↺  Depuis le début', action: function () { self.play(r.ep, 0); } });
    } else if (r && r.mode === 'next') btns.push({ label: '▶  Épisode suivant ' + code(r.ep), action: function () { self.play(r.ep, 0); } });
    else if (first) btns.push({ label: '▶  Regarder S' + U.pad(first.season) + 'E' + U.pad(first.episode), action: function () { self.play(first, 0); } });
    btns.push({
      label: UserData.isFavorite(s.id) ? '♥  Dans ma liste' : '♡  Ajouter à ma liste',
      action: function () { toggleFav(s, function () { self.buildButtons(); }); }
    });
    U.clear(this.btnBox);
    this.buttons = btns;
    this.bi = Math.min(this.bi, btns.length - 1);
    this.btnEls = btns.map(function (b, i) {
      var e = U.el('div', 'btn', b.label);
      U.pointer(e, function () {
        if (self.zone === 'buttons' && self.bi === i) return;
        self.zone = 'buttons'; self.bi = i; self.paint(true);
      });
      self.btnBox.appendChild(e);
      return e;
    });
    this.paint();
  };

  SeriesScreen.prototype.buildSeasons = function () {
    var self = this;
    U.clear(this.seasonBox);
    this.seasonEls = this.seasons.map(function (n, i) {
      var e = U.el('div', 'season-tab', n === '0' ? 'Bonus' : 'Saison ' + n);
      U.pointer(e, function () {
        if (self.zone === 'seasons' && self.si === i) return;
        self.zone = 'seasons';
        if (self.si !== i) { self.si = i; self.buildEpisodes(); }
        self.paint(true);
      }, function () { if (self.epEls.length) { self.zone = 'episodes'; self.ei = 0; self.paint(); } });
      self.seasonBox.appendChild(e);
      return e;
    });
  };

  SeriesScreen.prototype.buildEpisodes = function (useFocus) {
    var self = this;
    var eps = this.episodes();
    var prog = UserData.progress();
    var seen = UserData.watched();
    U.clear(this.epBox);
    this.ei = 0;
    if (useFocus && this.focusEpisode) {
      for (var i = 0; i < eps.length; i++) if (eps[i].id === this.focusEpisode.id) this.ei = i;
      this.zone = 'episodes';
    }
    this.epEls = eps.map(function (ep, i) {
      var row = U.el('div', 'episode');
      U.pointer(row, function () {
        if (self.zone === 'episodes' && self.ei === i) return;
        self.zone = 'episodes'; self.ei = i; self.focusEpisode = null; self.paint(true);
      });
      // image de l'épisode, sinon l'affiche ou le fond de la série
      var thumb = U.img([ep.logo, self.series.backdrop, self.series.logo], 'episode-thumb', self.series.name);
      var p = prog[ep.id];
      if (p) {
        var pb = U.el('div', 'tile-progress');
        var f = U.el('div', 'tile-progress-fill');
        f.style.width = (p.dur ? Math.round(p.pos / p.dur * 100) : 3) + '%';
        pb.appendChild(f);
        thumb.appendChild(pb);
      }
      row.appendChild(thumb);
      var txt = U.el('div', 'episode-text');
      txt.appendChild(U.el('div', 'episode-title', ep.episode + '.  ' + ep.name));
      var metaTxt = [];
      if (seen[ep.id]) metaTxt.push('✓ Vu');
      else if (p) metaTxt.push('Reprendre à ' + U.duration(p.pos));
      if (ep.duration) metaTxt.push(ep.duration);
      txt.appendChild(U.el('div', 'episode-meta' + (seen[ep.id] ? ' seen' : ''), metaTxt.join('   ·   ')));
      txt.appendChild(U.el('div', 'episode-plot', ep.plot || ''));
      row.appendChild(txt);
      self.epBox.appendChild(row);
      return row;
    });
    if (!eps.length && this.series.seasons) this.epBox.appendChild(U.el('div', 'empty-inline', 'Aucun épisode trouvé.'));
  };

  SeriesScreen.prototype.play = function (ep, pos) {
    ep.seriesRef = this.series.id;
    ep.seriesName = this.series.name;
    // toute la série : l'épisode suivant s'enchaîne aussi d'une saison à l'autre
    var eps = this.allEpisodes();
    if (!eps.length) eps = this.episodes();
    U.each(eps, function (x) { x.seriesRef = ep.seriesRef; x.seriesName = ep.seriesName; });
    global.Player.play(ep, { title: this.series.name, items: eps, series: this.series }, pos || 0);
  };

  SeriesScreen.prototype.paint = function (noScroll) {
    var i;
    for (i = 0; i < (this.btnEls || []).length; i++) this.btnEls[i].className = 'btn' + (this.zone === 'buttons' && i === this.bi ? ' focus' : '');
    for (i = 0; i < (this.seasonEls || []).length; i++) {
      this.seasonEls[i].className = 'season-tab' + (i === this.si ? ' active' : '') + (this.zone === 'seasons' && i === this.si ? ' focus' : '');
    }
    for (i = 0; i < (this.epEls || []).length; i++) this.epEls[i].className = 'episode' + (this.zone === 'episodes' && i === this.ei ? ' focus' : '');
    var cur = this.zone === 'episodes' && this.epEls && this.epEls[this.ei];
    if (noScroll) { /* pointeur : rien ne bouge */ } else if (cur) {
      // l'épisode sélectionné reste entièrement visible
      var top = cur.offsetTop, bottom = top + cur.offsetHeight, box = this.epBox;
      if (top < box.scrollTop) box.scrollTop = top;
      else if (bottom > box.scrollTop + box.clientHeight) box.scrollTop = bottom - box.clientHeight;
    } else if (this.zone !== 'episodes') this.epBox.scrollTop = 0;
    this.el.className = 'screen detail series zone-' + this.zone;
  };

  SeriesScreen.prototype.onShow = function (first) {
    if (!first) { this.buildButtons(); var keep = this.ei; this.buildEpisodes(false); this.ei = Math.min(keep, this.epEls.length - 1); this.paint(); }
  };

  SeriesScreen.prototype.onKey = function (k) {
    if (k === 'back') return App.pop();
    if (k === 'red') return toggleFav(this.series, this.buildButtons.bind(this));
    var hasSeasons = this.seasons.length > 0;
    if (this.zone === 'buttons') {
      if (k === 'left') this.bi = Math.max(0, this.bi - 1);
      else if (k === 'right') this.bi = Math.min(this.buttons.length - 1, this.bi + 1);
      else if (k === 'down' && hasSeasons) this.zone = this.seasons.length > 1 ? 'seasons' : 'episodes';
      else if (k === 'enter') return this.buttons[this.bi].action();
    } else if (this.zone === 'seasons') {
      if (k === 'left' && this.si > 0) { this.si--; this.buildEpisodes(); }
      else if (k === 'right' && this.si < this.seasons.length - 1) { this.si++; this.buildEpisodes(); }
      else if (k === 'up') this.zone = 'buttons';
      else if (k === 'down' || k === 'enter') { if (this.epEls.length) this.zone = 'episodes'; }
    } else if (this.zone === 'episodes') {
      this.focusEpisode = null;
      var eps = this.episodes();
      if (k === 'up') { if (this.ei > 0) this.ei--; else this.zone = this.seasons.length > 1 ? 'seasons' : 'buttons'; }
      else if (k === 'down') this.ei = Math.min(eps.length - 1, this.ei + 1);
      else if (k === 'chup') this.ei = Math.max(0, this.ei - 5);
      else if (k === 'chdown') this.ei = Math.min(eps.length - 1, this.ei + 5);
      else if (k === 'enter' || k === 'play' || k === 'playpause') {
        var ep = eps[this.ei];
        var p = UserData.getProgress(ep.id);
        return this.play(ep, p ? p.pos : 0);
      }
    }
    this.paint();
  };

  // =============================================================== recherche

  function SearchScreen() {
    var self = this;
    this.el = U.el('div', 'screen search');
    var top = U.el('div', 'search-top');
    top.appendChild(U.el('div', 'brand', 'canapé'));
    this.inputWrap = U.el('div', 'search-input');
    this.input = document.createElement('input');
    this.input.type = 'text';
    this.input.placeholder = 'Chaîne, film, série…';
    this.input.setAttribute('autocomplete', 'off');
    this.inputWrap.appendChild(U.el('span', 'search-icon', '⌕'));
    this.inputWrap.appendChild(this.input);
    top.appendChild(this.inputWrap);
    this.el.appendChild(top);
    this.status = U.el('div', 'search-status', 'Appuie sur OK pour écrire.');
    this.el.appendChild(this.status);
    this.rowsBox = U.el('div', 'rows search-rows');
    this.el.appendChild(this.rowsBox);
    this.rows = new global.Rows(this.rowsBox, {
      onSelect: function (it, row) { openItem(it, row); },
      onPoint: function () { if (self.zone !== 'rows') { self.zone = 'rows'; self.paint(); } }
    });
    U.pointer(this.inputWrap, function () {
      if (self.zone !== 'input') { self.zone = 'input'; self.paint(); }
    }, function () { self.input.focus(); });
    this.zone = 'input';
    var run = U.debounce(function () { self.run(); }, 350);
    this.input.addEventListener('input', run);
    this.paint();
  }

  SearchScreen.prototype.run = function () {
    var q = this.input.value.trim();
    if (q.length < 2) {
      this.rows.setRows([]);
      this.status.textContent = q ? 'Encore une lettre…' : 'Appuie sur OK pour écrire.';
      return;
    }
    var r = Library.search(q);
    var total = r.live.length + r.movies.length + r.series.length;
    this.rows.setRows([
      { title: 'Chaînes', items: r.live, type: 'live' },
      { title: 'Films', items: r.movies, type: 'poster' },
      { title: 'Séries', items: r.series, type: 'poster' }
    ]);
    this.status.textContent = total ? total + ' résultat' + (total > 1 ? 's' : '') + ' — ▼ pour parcourir' : 'Aucun résultat pour « ' + q + ' ».';
    this.paint();
  };

  SearchScreen.prototype.paint = function () {
    this.inputWrap.className = 'search-input' + (this.zone === 'input' ? ' focus' : '');
    this.rows.setBlurred(this.zone !== 'rows');
  };

  SearchScreen.prototype.onShow = function (first) {
    if (first) { var inp = this.input; setTimeout(function () { inp.focus(); }, 60); }
    else this.rows.render();
  };
  SearchScreen.prototype.destroy = function () { this.rows.destroy(); };

  SearchScreen.prototype.onKey = function (k) {
    if (this.zone === 'input') {
      if (k === 'enter') { this.input.focus(); return; }
      if (k === 'down' && !this.rows.empty()) { this.zone = 'rows'; this.paint(); return; }
      if (k === 'back') return App.pop();
      return;
    }
    if (k === 'back') { this.zone = 'input'; this.paint(); return; }
    if (k === 'red') { toggleFav(this.rows.current(), this.rows.refreshCurrent.bind(this.rows)); return; }
    if (!this.rows.key(k)) { this.zone = 'input'; this.paint(); }
  };

  // =============================================================== réglages

  function SettingsScreen() {
    this.el = U.el('div', 'screen settings');
    var head = U.el('div', 'settings-head');
    head.appendChild(U.el('div', 'brand', 'canapé'));
    head.appendChild(U.el('div', 'settings-title', 'Réglages'));
    this.el.appendChild(head);
    this.list = U.el('div', 'settings-list');
    this.el.appendChild(this.list);
    this.build();
  }

  SettingsScreen.prototype.build = function () {
    var self = this;
    var st = global.Settings.get();
    var active = global.Profiles.active();
    var items = [];
    U.clear(this.list);

    function section(t) {
      var e = U.el('div', 'settings-section', t);
      self.list.appendChild(e);
      items.push({ el: e, skip: true });
    }
    function item(label, value, action) {
      var e = U.el('div', 'settings-item');
      e.appendChild(U.el('div', 'settings-label', label));
      if (value !== undefined) e.appendChild(U.el('div', 'settings-value', value));
      self.list.appendChild(e);
      items.push({ el: e, action: action });
    }

    section('Playlists');
    U.each(global.Profiles.list(), function (p) {
      var isActive = active && active.id === p.id;
      item((isActive ? '● ' : '○ ') + p.name, p.type === 'xtream' ? 'Xtream' : 'M3U', function () {
        App.push(new EditorScreen(p));
      });
    });
    item('+  Ajouter une playlist', undefined, function () { App.push(new EditorScreen(null)); });
    if (active) item('Recharger la playlist', 'Récupère les dernières chaînes', function () { global.Main.reload(); });

    var acc = Library.data && Library.data.account;
    if (acc) {
      var exp = acc.expires ? new Date(acc.expires) : null;
      item('Abonnement', (acc.status || '') + (exp ? ' · expire le ' + U.pad(exp.getDate()) + '/' + U.pad(exp.getMonth() + 1) + '/' + exp.getFullYear() : '') +
        (acc.connections ? ' · ' + acc.connections + ' écran' + (+acc.connections > 1 ? 's' : '') : ''), function () {});
    }

    section('Lecture');
    item('Format des chaînes (Xtream)', st.streamFormat === 'ts' ? 'MPEG-TS (.ts)' : 'HLS (.m3u8)', function () {
      global.Settings.set({ streamFormat: st.streamFormat === 'ts' ? 'm3u8' : 'ts' });
      global.toast('Format changé : rechargement de la playlist');
      self.build();
      global.Main.reload(true);
    });

    section('Contrôle parental');
    item('Masquer les catégories adultes', st.hideAdult ? 'Oui' : 'Non', function () {
      function apply() {
        global.Settings.set({ hideAdult: !st.hideAdult });
        Library.regroup();
        self.build();
      }
      if (st.hideAdult && st.pin) {
        global.PinDialog.ask('Code PIN', function (code) {
          if (code === null) return;
          if (code === st.pin) apply(); else global.toast('Code incorrect');
        });
      } else apply();
    });
    item('Code PIN', st.pin ? 'Défini' : 'Aucun', function () {
      function setNew() {
        global.PinDialog.ask('Nouveau code PIN', function (code) {
          if (code === null) return;
          global.Settings.set({ pin: code });
          global.toast('Code PIN enregistré');
          self.build();
        });
      }
      if (st.pin) {
        global.PinDialog.ask('Code PIN actuel', function (code) {
          if (code === null) return;
          if (code !== st.pin) return global.toast('Code incorrect');
          global.Dialog.show({
            title: 'Code PIN', buttons: [
              { label: 'Changer', action: setNew },
              { label: 'Supprimer', action: function () { global.Settings.set({ pin: '' }); self.build(); global.toast('Code PIN supprimé'); } },
              { label: 'Annuler' }
            ]
          });
        });
      } else setNew();
    });

    section('Données');
    item('Effacer l\'historique', 'Chaînes récentes et reprise de lecture', function () {
      global.Dialog.show({
        title: 'Effacer l\'historique ?', buttons: [
          { label: 'Annuler' },
          {
            label: 'Effacer', action: function () {
              var p = Library.profile;
              U.store.remove('recent.' + (p ? p.id : 'none'));
              U.store.remove('progress.' + (p ? p.id : 'none'));
              global.toast('Historique effacé');
            }
          }
        ]
      });
    });
    item('Lecteur vidéo', global.webapis && global.webapis.avplay ? 'Lecteur Samsung (AVPlay)' : 'Lecteur du navigateur', function () {});
    var ee = global.EpgEngine;
    item('Guide des programmes', global.Epg.ready ? 'Chargé (' + ee.count + ' programmes)' : (Library.data && Library.data.epgUrl ?
      (ee.state === 'error' ? 'Échec : ' + ee.error : ee.available() ? 'En cours de chargement' : 'Indisponible sur cette TV') : 'Aucune adresse'), function () {});
    item('Version', 'Canapé TV 1.0 pour Samsung', function () {});

    this.vlist = new global.VList(items, null, this.list);
    this.vlist.onMove = function () { self.keepIndex = self.vlist.i; };
    var firstReal = 0;
    while (items[firstReal] && items[firstReal].skip) firstReal++;
    this.vlist.i = Math.min(this.keepIndex || firstReal, items.length - 1);
    if (items[this.vlist.i] && items[this.vlist.i].skip) this.vlist.i = firstReal;
    this.vlist.paint();
  };

  SettingsScreen.prototype.onShow = function (first) { if (!first) this.build(); };

  SettingsScreen.prototype.onKey = function (k) {
    if (k === 'back') return App.pop();
    if (k === 'left' || k === 'right') return;
    this.vlist.key(k);
    this.keepIndex = this.vlist.i;
  };

  // =============================================================== ajout / modification d'une playlist

  function EditorScreen(profile, welcome) {
    this.isNew = !profile;
    this.p = U.extend({ type: 'm3u', name: '', url: '', server: '', username: '', password: '', epgUrl: '' }, profile || {});
    this.welcome = !!welcome;
    this.el = U.el('div', 'screen editor');
    this.build();
  }

  EditorScreen.prototype.build = function () {
    var self = this, p = this.p;
    U.clear(this.el);
    var box = U.el('div', 'editor-box');
    box.appendChild(U.el('div', 'brand big', 'canapé'));
    box.appendChild(U.el('div', 'editor-title', this.welcome ? 'Bienvenue ! Ajoute ta playlist IPTV' : (this.isNew ? 'Nouvelle playlist' : 'Modifier la playlist')));
    if (this.welcome) {
      box.appendChild(U.el('div', 'editor-help', 'Utilise l\'adresse M3U ou les identifiants Xtream fournis par ton abonnement IPTV. Sur un champ, appuie sur OK pour ouvrir le clavier, puis ▼ pour passer au suivant.'));
    }
    var form = U.el('div', 'editor-form');
    var items = [];

    function field(label, key, placeholder, secret) {
      var row = U.el('div', 'field');
      row.appendChild(U.el('div', 'field-label', label));
      var inp = document.createElement('input');
      inp.type = secret ? 'password' : 'text';
      inp.value = p[key] || '';
      inp.placeholder = placeholder || '';
      inp.setAttribute('autocomplete', 'off');
      inp.setAttribute('autocapitalize', 'off');
      inp.setAttribute('spellcheck', 'false');
      inp.addEventListener('input', function () { p[key] = inp.value; });
      inp.addEventListener('change', function () { p[key] = inp.value; });
      row.appendChild(inp);
      form.appendChild(row);
      items.push({ el: row, action: function (k) { if (k === 'enter') inp.focus(); } });
    }

    var typeRow = U.el('div', 'field');
    typeRow.appendChild(U.el('div', 'field-label', 'Type'));
    var seg = U.el('div', 'segmented');
    var o1 = U.el('div', 'seg' + (p.type === 'm3u' ? ' on' : ''), 'Adresse M3U');
    var o2 = U.el('div', 'seg' + (p.type === 'xtream' ? ' on' : ''), 'Xtream Codes');
    seg.appendChild(o1); seg.appendChild(o2);
    typeRow.appendChild(seg);
    form.appendChild(typeRow);
    var typeItem = {
      el: typeRow, action: function (k) {
        var next = k === 'left' ? 'm3u' : k === 'right' ? 'xtream' : (p.type === 'm3u' ? 'xtream' : 'm3u');
        if (next !== p.type) { p.type = next; self.keep = 0; self.build(); }
      }
    };
    items.push(typeItem);
    function segHover() { if (self.vlist && self.vlist.i !== 0) { self.vlist.i = 0; self.keep = 0; self.vlist.paint(true); } }
    U.pointer(o1, segHover, function () { typeItem.action('left'); });
    U.pointer(o2, segHover, function () { typeItem.action('right'); });

    field('Nom', 'name', 'Ex. : Ma TV');
    if (p.type === 'm3u') field('Adresse de la playlist', 'url', 'http://…/playlist.m3u');
    else {
      field('Serveur', 'server', 'http://serveur.exemple:8080');
      field('Identifiant', 'username', '');
      field('Mot de passe', 'password', '', true);
    }
    field('Guide des programmes (facultatif)', 'epgUrl', 'Adresse XMLTV, sinon celle de la playlist');

    var actions = U.el('div', 'editor-actions');
    var save = U.el('div', 'btn primary', 'Enregistrer et ouvrir');
    actions.appendChild(save);
    form.appendChild(actions);
    items.push({ el: save, action: function (k) { if (k === 'enter') self.save(); } });
    if (!this.isNew) {
      var del = U.el('div', 'btn danger', 'Supprimer cette playlist');
      var act2 = U.el('div', 'editor-actions');
      act2.appendChild(del);
      form.appendChild(act2);
      items.push({ el: del, action: function (k) { if (k === 'enter') self.remove(); } });
    }

    box.appendChild(form);
    this.el.appendChild(box);
    this.vlist = new global.VList(items);
    this.vlist.onMove = function () { self.keep = self.vlist.i; };
    this.vlist.i = Math.min(this.keep || 0, items.length - 1);
    this.vlist.paint();
  };

  EditorScreen.prototype.save = function () {
    var p = this.p;
    p.name = (p.name || '').trim() || (p.type === 'xtream' ? 'Xtream' : 'Ma playlist');
    p.url = (p.url || '').trim();
    p.server = (p.server || '').trim();
    p.username = (p.username || '').trim();
    p.epgUrl = (p.epgUrl || '').trim();
    if (p.type === 'm3u' && !/^https?:\/\//i.test(p.url)) return global.toast('L\'adresse doit commencer par http:// ou https://');
    if (p.type === 'xtream' && (!p.server || !p.username || !p.password)) return global.toast('Serveur, identifiant et mot de passe sont nécessaires');
    if (p.type === 'm3u') { delete p.server; delete p.username; delete p.password; } else delete p.url;
    var saved = global.Profiles.upsert(p);
    global.Profiles.setActive(saved.id);
    global.Main.reload(true);
  };

  EditorScreen.prototype.remove = function () {
    var self = this;
    global.Dialog.show({
      title: 'Supprimer « ' + this.p.name + ' » ?', buttons: [
        { label: 'Annuler' },
        {
          label: 'Supprimer', action: function () {
            global.Profiles.remove(self.p.id);
            global.Main.reload(true);
          }
        }
      ]
    });
  };

  EditorScreen.prototype.onKey = function (k) {
    if (k === 'back') {
      if (App.stack.length <= 1) {
        // seul écran ouvert (premier lancement ou après une erreur)
        if (global.Profiles.list().length) global.Main.reload();
        else askExit();
        return;
      }
      return App.pop();
    }
    this.vlist.key(k);
    this.keep = this.vlist.i;
  };

  global.Screens = {
    Browse: Browse, Detail: Detail, SeriesScreen: SeriesScreen,
    SearchScreen: SearchScreen, SettingsScreen: SettingsScreen, EditorScreen: EditorScreen,
    openItem: openItem, askExit: askExit
  };
})(window);

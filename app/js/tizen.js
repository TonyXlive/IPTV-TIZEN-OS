/* Canapé TV — ce qui est propre aux TV Samsung (Tizen) : touches de la télécommande, sortie,
   mise en arrière-plan, et le lecteur vidéo natif AVPlay présenté comme une balise <video>. */
(function (global) {
  'use strict';

  function tizenApi() { return global.tizen || null; }
  function avplay() { return (global.webapis && global.webapis.avplay) || null; }

  // Touches à demander au système : sans ça, Tizen garde pour lui les touches couleur, chiffres, lecture…
  var KEYS = [
    'MediaPlayPause', 'MediaPlay', 'MediaPause', 'MediaStop', 'MediaFastForward', 'MediaRewind',
    'ColorF0Red', 'ColorF1Green', 'ColorF2Yellow', 'ColorF3Blue',
    'ChannelUp', 'ChannelDown', 'Info',
    '0', '1', '2', '3', '4', '5', '6', '7', '8', '9'
  ];

  var Platform = {
    isTizen: !!(global.tizen || /tizen/i.test(global.navigator.userAgent || '')),

    registerKeys: function () {
      var t = tizenApi();
      if (!t || !t.tvinputdevice) return;
      var supported = {};
      try {
        var all = t.tvinputdevice.getSupportedKeys();
        for (var i = 0; i < all.length; i++) supported[all[i].name] = true;
      } catch (e) { supported = null; }
      var wanted = [];
      for (var j = 0; j < KEYS.length; j++) if (!supported || supported[KEYS[j]]) wanted.push(KEYS[j]);
      try {
        if (t.tvinputdevice.registerKeyBatch) { t.tvinputdevice.registerKeyBatch(wanted); return; }
      } catch (e2) { /* une touche refusée : on les prend une par une */ }
      for (var k = 0; k < wanted.length; k++) {
        try { t.tvinputdevice.registerKey(wanted[k]); } catch (e3) { /* touche absente de cette télécommande */ }
      }
    },

    // Ferme l'appli et revient à l'écran de la TV.
    exit: function () {
      try {
        var t = tizenApi();
        if (t && t.application) { t.application.getCurrentApplication().exit(); return; }
      } catch (e) { /* on tente autre chose */ }
      try { global.close(); } catch (e2) { /* rien */ }
    },

    // Appelé quand l'appli passe en arrière-plan (bouton Accueil) ou revient au premier plan.
    onVisibility: function (cb) {
      var prop = typeof document.hidden !== 'undefined' ? 'hidden' : (typeof document.webkitHidden !== 'undefined' ? 'webkitHidden' : null);
      var evt = prop === 'webkitHidden' ? 'webkitvisibilitychange' : 'visibilitychange';
      if (!prop) return;
      document.addEventListener(evt, function () { cb(!document[prop]); });
    },

    // Lecteur : AVPlay sur la TV (lit HLS, MPEG-TS, MKV… et donne accès aux pistes), <video> ailleurs.
    createVideo: function () {
      if (avplay()) return new AvVideo();
      var v = document.createElement('video');
      v.setAttribute('playsinline', '');
      v.preload = 'auto';
      return v;
    }
  };

  // =============================================================== AVPlay vu comme une balise <video>

  // Liste de pistes qui ressemble à video.audioTracks / video.textTracks.
  function TrackList() { this.length = 0; this.listeners = {}; }
  TrackList.prototype.addEventListener = function (type, fn) { (this.listeners[type] = this.listeners[type] || []).push(fn); };
  TrackList.prototype.removeEventListener = function (type, fn) {
    var l = this.listeners[type] || [];
    for (var i = 0; i < l.length; i++) if (l[i] === fn) { l.splice(i, 1); return; }
  };
  TrackList.prototype.fire = function (type) { var l = (this.listeners[type] || []).slice(); for (var i = 0; i < l.length; i++) l[i]({ type: type }); };
  TrackList.prototype.reset = function () { for (var i = 0; i < this.length; i++) delete this[i]; this.length = 0; };
  TrackList.prototype.push = function (t) { this[this.length++] = t; };

  function AudioTrack(owner, index, language, label) {
    this.owner = owner; this.index = index; this.language = language; this.label = label; this._on = false;
  }
  Object.defineProperty(AudioTrack.prototype, 'enabled', {
    get: function () { return this._on; },
    set: function (on) {
      on = !!on;
      if (on === this._on) return;
      this._on = on;
      if (on) this.owner.selectTrack('AUDIO', this.index);
    }
  });

  function TextTrack(owner, index, language, label) {
    this.owner = owner; this.index = index; this.kind = 'subtitles'; this.language = language; this.label = label;
    this.activeCues = []; this._mode = 'disabled'; this.listeners = [];
  }
  TextTrack.prototype.addEventListener = function (type, fn) { if (type === 'cuechange') this.listeners.push(fn); };
  TextTrack.prototype.removeEventListener = function (type, fn) {
    for (var i = 0; i < this.listeners.length; i++) if (this.listeners[i] === fn) { this.listeners.splice(i, 1); return; }
  };
  TextTrack.prototype.setCues = function (list) {
    this.activeCues = list;
    var l = this.listeners.slice();
    for (var i = 0; i < l.length; i++) l[i]({ type: 'cuechange' });
  };
  Object.defineProperty(TextTrack.prototype, 'mode', {
    get: function () { return this._mode; },
    set: function (m) {
      if (m === this._mode) return;
      this._mode = m;
      this.owner.textModeChanged(this);
    }
  });

  function parseExtra(t) {
    var x = t.extra_info;
    if (typeof x === 'string') { try { x = JSON.parse(x); } catch (e) { x = {}; } }
    return x || {};
  }

  function AvVideo() {
    this.node = document.createElement('object');
    this.node.setAttribute('type', 'application/avplayer');
    this.node.className = 'avplayer';
    this.listeners = {};
    this.audioTracks = new TrackList();
    this.textTracks = new TrackList();
    this.paused = true;
    this.duration = NaN;
    this._time = 0;
    this._url = '';
    this._state = 'none'; // none | opening | ready | error
    this._pendingSeek = null;
    this._token = 0;
    this._lastTick = 0;
    this._subTimer = null;
  }

  AvVideo.prototype.setAttribute = function () {};
  AvVideo.prototype.addEventListener = function (type, fn) { (this.listeners[type] = this.listeners[type] || []).push(fn); };
  AvVideo.prototype.emit = function (type) {
    var l = (this.listeners[type] || []).slice();
    for (var i = 0; i < l.length; i++) { try { l[i]({ type: type, target: this }); } catch (e) { if (global.console) console.log(e); } }
  };

  Object.defineProperty(AvVideo.prototype, 'src', {
    get: function () { return this._url; },
    set: function (url) { this._url = url || ''; this._dirty = true; }
  });

  Object.defineProperty(AvVideo.prototype, 'currentTime', {
    get: function () { return this._pendingSeek !== null ? this._pendingSeek : this._time; },
    set: function (sec) {
      sec = Math.max(0, +sec || 0);
      if (this._state !== 'ready') { this._pendingSeek = sec; return; }
      this.seekTo(sec);
    }
  });

  AvVideo.prototype.seekTo = function (sec) {
    var self = this, token = this._token;
    this._pendingSeek = sec;
    try {
      avplay().seekTo(Math.floor(sec * 1000), function () {
        if (token !== self._token) return;
        self._pendingSeek = null;
        self._time = sec;
        self.emit('timeupdate');
        self.emit('seeked');
      }, function () {
        if (token !== self._token) return;
        self._pendingSeek = null;
      });
    } catch (e) { this._pendingSeek = null; }
  };

  AvVideo.prototype.removeAttribute = function (name) { if (name === 'src') { this._url = ''; this._dirty = true; } };

  // Ferme le flux en cours (rien à l'écran ensuite).
  AvVideo.prototype.close = function () {
    this._token++;
    this.clearSubs();
    try { avplay().stop(); } catch (e) { /* rien */ }
    try { avplay().close(); } catch (e2) { /* rien */ }
    this._state = 'none';
    this.paused = true;
    document.documentElement.classList.remove('avplay-on');
  };

  // load() ouvre l'adresse donnée par src (comme une balise <video>).
  AvVideo.prototype.load = function () {
    if (!this._dirty) return;
    this._dirty = false;
    this.close();
    this._time = 0;
    this.duration = NaN;
    this._pendingSeek = null;
    this.audioTracks.reset();
    this.textTracks.reset();
    if (!this._url) return;
    this.open(this._url);
  };

  AvVideo.prototype.open = function (url) {
    var self = this, av = avplay(), token = ++this._token;
    this._state = 'opening';
    document.documentElement.classList.add('avplay-on');
    function alive() { return token === self._token; }
    function fail() {
      if (!alive()) return;
      self._state = 'error';
      self.paused = true;
      self.emit('error');
    }
    try {
      av.open(url);
      av.setDisplayRect(0, 0, 1920, 1080);
      try { av.setDisplayMethod('PLAYER_DISPLAY_MODE_LETTER_BOX'); } catch (e) { /* ancienne TV */ }
      // le délai de connexion par défaut est long : on garde la main pour afficher un message
      try { av.setTimeoutForBuffering(20); } catch (e1) { /* rien */ }
      av.setListener({
        onbufferingstart: function () { if (alive()) self.emit('waiting'); },
        onbufferingprogress: function () {},
        onbufferingcomplete: function () {
          if (!alive()) return;
          self.emit('canplay');
          if (!self.paused) self.emit('playing');
        },
        oncurrentplaytime: function (ms) {
          if (!alive()) return;
          self._time = ms / 1000;
          if (self._firstTick) { self._firstTick = false; if (!self.paused) self.emit('playing'); }
          var now = Date.now();
          if (now - self._lastTick > 240) { self._lastTick = now; self.emit('timeupdate'); }
        },
        onstreamcompleted: function () {
          if (!alive()) return;
          self.paused = true;
          try { av.stop(); } catch (e) { /* rien */ }
          self._state = 'none'; // play() rouvrira le flux depuis le début
          self.emit('ended');
        },
        onevent: function () {},
        onerror: function () { fail(); },
        ondrmevent: function () {},
        onsubtitlechange: function (duration, text) { if (alive()) self.showSub(text, duration); }
      });
      av.prepareAsync(function () {
        if (!alive()) return;
        self._state = 'ready';
        self.readDuration();
        self.readTracks();
        self.emit('loadedmetadata');
        // une reprise demandée avant la fin de l'ouverture
        if (self._pendingSeek !== null) self.seekTo(self._pendingSeek);
        if (!self.paused) self.startPlayback();
      }, function () { fail(); });
    } catch (e) {
      setTimeout(fail, 0);
    }
  };

  AvVideo.prototype.readDuration = function () {
    var d = 0;
    try { d = avplay().getDuration() / 1000; } catch (e) { d = 0; }
    // en direct, AVPlay renvoie 0 (ou une valeur absurde) : la durée est inconnue
    this.duration = d > 0 && d < 24 * 3600 ? d : NaN;
  };

  AvVideo.prototype.readTracks = function () {
    var info = [];
    try { info = avplay().getTotalTrackInfo() || []; } catch (e) { info = []; }
    var current = {};
    try {
      var cur = avplay().getCurrentStreamInfo() || [];
      for (var c = 0; c < cur.length; c++) current[cur[c].type] = cur[c].index;
    } catch (e2) { /* rien */ }
    this.audioTracks.reset();
    this.textTracks.reset();
    for (var i = 0; i < info.length; i++) {
      var t = info[i], x = parseExtra(t);
      var lang = x.language || x.lang || '';
      if (t.type === 'AUDIO') {
        var a = new AudioTrack(this, t.index, lang, x.label || '');
        a._on = current.AUDIO !== undefined ? current.AUDIO === t.index : this.audioTracks.length === 0;
        this.audioTracks.push(a);
      } else if (t.type === 'TEXT' || t.type === 'SUBTITLE') {
        this.textTracks.push(new TextTrack(this, t.index, lang, x.label || ''));
      }
    }
    // pas de sous-titres affichés tant qu'on n'en choisit pas
    try { avplay().setSilentSubtitle(true); } catch (e3) { /* rien */ }
    if (this.audioTracks.length) this.audioTracks.fire('addtrack');
    if (this.textTracks.length) this.textTracks.fire('addtrack');
  };

  AvVideo.prototype.selectTrack = function (type, index) {
    for (var i = 0; type === 'AUDIO' && i < this.audioTracks.length; i++) {
      if (this.audioTracks[i].index !== index) this.audioTracks[i]._on = false;
    }
    try { avplay().setSelectTrack(type, index); } catch (e) { /* piste refusée par la TV */ }
  };

  // Le lecteur passe une piste en « hidden » pour en recevoir les répliques, « disabled » pour les couper.
  AvVideo.prototype.textModeChanged = function (track) {
    var shown = null;
    for (var i = 0; i < this.textTracks.length; i++) if (this.textTracks[i]._mode !== 'disabled') shown = this.textTracks[i];
    this.clearSubs();
    try {
      if (shown) { avplay().setSelectTrack('TEXT', shown.index); avplay().setSilentSubtitle(false); }
      else avplay().setSilentSubtitle(true);
    } catch (e) { /* rien */ }
    this.subTrack = shown;
    if (track) { /* rien d'autre à faire */ }
  };

  AvVideo.prototype.showSub = function (text, duration) {
    var t = this.subTrack;
    if (!t) return;
    clearTimeout(this._subTimer);
    t.setCues(text ? [{ text: String(text) }] : []);
    var self = this;
    this._subTimer = setTimeout(function () { if (self.subTrack === t) t.setCues([]); }, Math.max(500, +duration || 3000));
  };

  AvVideo.prototype.clearSubs = function () {
    clearTimeout(this._subTimer);
    for (var i = 0; i < this.textTracks.length; i++) if (this.textTracks[i].activeCues.length) this.textTracks[i].setCues([]);
  };

  AvVideo.prototype.startPlayback = function () {
    this._firstTick = true;
    try { avplay().play(); } catch (e) { return; }
    this.emit('play');
  };

  AvVideo.prototype.play = function () {
    if (this._dirty) this.load();
    if (!this.paused) return;
    this.paused = false;
    if (this._state === 'ready') this.startPlayback();
    else if (this._state === 'none' && this._url) this.open(this._url);
  };

  AvVideo.prototype.pause = function () {
    if (this.paused) return;
    this.paused = true;
    if (this._state === 'ready') { try { avplay().pause(); } catch (e) { /* rien */ } }
    this.emit('pause');
  };

  // Bouton Accueil de la TV : on libère le lecteur, et on le rouvre au même endroit au retour.
  AvVideo.prototype.suspend = function () {
    if (this._state !== 'ready') return;
    this._resumeAt = this._time;
    try { avplay().suspend(); this._suspended = true; } catch (e) { this._suspended = false; }
  };

  AvVideo.prototype.restore = function () {
    if (!this._suspended) return;
    this._suspended = false;
    try { avplay().restore(this._url, Math.floor((this._resumeAt || 0) * 1000), true); }
    catch (e) {
      // restore() absent ou refusé : on rouvre le flux et on se replace
      this._dirty = true;
      var wasPaused = this.paused;
      this.load();
      this._pendingSeek = this._resumeAt || 0;
      if (!wasPaused) { this.paused = true; this.play(); }
    }
  };

  global.Platform = Platform;
  global.AvVideo = AvVideo;
})(window);

/* Canapé TV (Samsung Tizen) — démarrage. */
(function (global) {
  'use strict';
  var U = global.U, App = global.App;

  // Taille de base : 16 px pour un écran de 1920 px de large (tout est en rem).
  function scale() {
    var w = global.innerWidth || 1920, h = global.innerHeight || 1080;
    var s = Math.min(w / 1920, h / 1080);
    document.documentElement.style.fontSize = (16 * s) + 'px';
  }

  var loader = {
    show: function (msg) {
      var l = U.$('#loader');
      l.style.display = 'flex';
      U.$('#loader-msg').textContent = msg || 'Chargement…';
      U.$('#loader-error').style.display = 'none';
      U.$('#loader .spinner').style.display = '';
    },
    hide: function () { U.$('#loader').style.display = 'none'; },
    error: function (msg) {
      U.$('#loader-msg').textContent = 'Le chargement a échoué';
      var e = U.$('#loader-error');
      e.style.display = 'block';
      U.$('#loader .spinner').style.display = 'none';
      U.$('#loader-error-text').textContent = msg;
    }
  };

  var Main = {
    failed: false,

    start: function () {
      scale();
      global.addEventListener('resize', scale);
      App.root = U.$('#app');
      // touches couleur, chiffres, lecture… : Tizen ne les envoie à l'appli que si on les demande
      global.Platform.registerKeys();
      document.addEventListener('keydown', function (e) { App.key(e); });
      App.initPointer();
      // boutons de l'écran d'erreur, utilisables aussi avec le pointeur
      var retry = U.$('#loader-retry'), edit = U.$('#loader-edit');
      U.pointer(retry, null, function () { Main.failedKey('enter'); });
      U.pointer(edit, null, function () { Main.failedKey('down'); });
      retry.__ptAlways = true;
      edit.__ptAlways = true;
      // bouton Accueil de la TV : on met la lecture en pause, et on reprend au retour
      global.Platform.onVisibility(function (visible) {
        var top = App.top();
        if (!top) return;
        if (!visible && top.suspend) top.suspend();
        if (visible && top.resume) top.resume();
      });
      loader.show('Démarrage…');
      global.Net.detect(function () { Main.reload(false); });
    },

    reload: function () {
      var profile = global.Profiles.active();
      Main.setFailed(false);
      if (!profile) {
        loader.hide();
        App.reset(new global.Screens.EditorScreen(null, true));
        return;
      }
      global.Profiles.setActive(profile.id);
      while (App.stack.length) App.pop();
      loader.show('Chargement de « ' + profile.name + ' »…');
      global.Library.load(profile, function (msg) { loader.show(msg); }, function (err) {
        if (err) {
          Main.setFailed(true);
          loader.error(err.message);
          return;
        }
        loader.hide();
        global.Epg.start();
        App.reset(new global.Screens.Browse());
      });
    },

    setFailed: function (on) {
      Main.failed = on;
      App.interceptor = on ? Main.failedKey : null;
    },

    // Écran d'erreur : OK pour réessayer, ▼ / ROUGE / BLEU pour modifier la playlist, RETOUR pour quitter.
    failedKey: function (k, e) {
      if (e && e.preventDefault) e.preventDefault();
      if (App.modal) return App.modal.onKey(k, e);
      if (k === 'enter') Main.reload();
      else if (k === 'red' || k === 'down' || k === 'blue') {
        Main.setFailed(false);
        loader.hide();
        App.reset(new global.Screens.EditorScreen(global.Profiles.active(), false));
      } else if (k === 'back') global.Screens.askExit();
    }
  };

  global.Main = Main;
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', Main.start);
  else Main.start();
})(window);

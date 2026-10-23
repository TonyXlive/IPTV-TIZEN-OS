/*
 * Faux fournisseur IPTV pour les tests : playlist M3U, API Xtream Codes, guide XMLTV (.gz), flux vidéo.
 * Il n'envoie AUCUN en-tête CORS (comme beaucoup de vrais fournisseurs), sauf sous /cors/...
 * Usage : node tests/fake-provider.js [port]
 */
'use strict';
var http = require('http');
var fs = require('fs');
var path = require('path');
var zlib = require('zlib');
var urlLib = require('url');

var PORT = +(process.argv[2] || process.env.PROVIDER_PORT || 9100);
var HOST = 'http://127.0.0.1:' + PORT;
var MEDIA = path.join(__dirname, 'media');
var USER = 'demo', PASS = 'secret';

// ------------------------------------------------------------ catalogue
var liveCats = [
  { category_id: '10', category_name: 'Généralistes' },
  { category_id: '11', category_name: 'Info' },
  { category_id: '12', category_name: 'Sport' },
  { category_id: '13', category_name: 'Cinéma' },
  { category_id: '14', category_name: 'Jeunesse' },
  { category_id: '19', category_name: 'Adulte +18' }
];
var channelNames = {
  '10': ['Première Test', 'Deuxième Test', 'Canal Essai', 'Télé Locale', 'France Démo', 'Chaîne Pilote', 'Antenne Libre', 'Télé Soleil'],
  '11': ['Info Continue', 'Flash Actu', 'Le Direct Info', 'Monde 24'],
  '12': ['Sport Direct', 'Foot Plus', 'Rugby TV', 'Vélo Max'],
  '13': ['Ciné Club', 'Ciné Frisson', 'Ciné Famille'],
  '14': ['Dessins Animés', 'Kids Fun'],
  '19': ['Nuit Rouge']
};
var live = [];
var n = 1;
liveCats.forEach(function (c) {
  channelNames[c.category_id].forEach(function (name) {
    live.push({
      num: n, name: name, stream_id: 1000 + n, category_id: c.category_id,
      stream_icon: n % 4 === 0 ? '' : HOST + '/img/logo' + (n % 6) + '.png',
      epg_channel_id: 'ch' + n + '.test'
    });
    n++;
  });
});

var vodCats = [
  { category_id: '20', category_name: 'Action' },
  { category_id: '21', category_name: 'Comédie' },
  { category_id: '22', category_name: 'Documentaires' },
  { category_id: '29', category_name: 'Adultes XXX' }
];
var movieTitles = {
  '20': ['La Dernière Course', 'Opération Minuit', 'Le Pont des Ombres', 'Vertige Rouge', 'Code Atlas', 'Tempête Nord', 'Fuite à Lyon'],
  '21': ['Mon Voisin le Chef', 'Vacances Ratées', 'Le Mariage de Paul', 'Tout Doit Disparaître', 'Un Été à Pusignan'],
  '22': ['Les Alpes Vues du Ciel', 'Océans Secrets', 'Le Rhône, Fleuve Roi'],
  '29': ['Film Interdit']
};
var vod = [];
var m = 1;
vodCats.forEach(function (c) {
  movieTitles[c.category_id].forEach(function (t) {
    vod.push({
      num: m, name: t, stream_id: 5000 + m, category_id: c.category_id, container_extension: 'webm',
      stream_icon: m % 5 === 0 ? '' : HOST + '/img/poster' + (m % 6) + '.png',
      rating_5based: (m % 5) + 0.5, added: String(1760000000 + m * 3600)
    });
    m++;
  });
});

var seriesCats = [
  { category_id: '30', category_name: 'Séries françaises' },
  { category_id: '31', category_name: 'Séries policières' }
];
var series = [
  { series_id: 700, name: 'Les Voisins du Dessus', category_id: '30', cover: HOST + '/img/poster1.png', plot: 'Une colocation lyonnaise où rien ne se passe comme prévu.', genre: 'Comédie', releaseDate: '2024-03-01', rating_5based: 4, last_modified: '1761000000', backdrop_path: [HOST + '/img/backdrop.png'] },
  { series_id: 701, name: 'Brigade Confluence', category_id: '31', cover: HOST + '/img/poster2.png', plot: 'Enquêtes au cœur de Lyon.', genre: 'Policier', releaseDate: '2023-09-12', rating_5based: 3.5, last_modified: '1760500000' },
  { series_id: 702, name: 'Saison des Vendanges', category_id: '30', cover: '', plot: 'Une famille de vignerons du Beaujolais.', genre: 'Drame', releaseDate: '2022-01-01', rating_5based: 3, last_modified: '1759000000' }
];
function episodes(id) {
  var seasons = id === 700 ? { '1': 3, '2': 2 } : { '1': 2 };
  var out = {};
  Object.keys(seasons).forEach(function (s) {
    out[s] = [];
    for (var e = 1; e <= seasons[s]; e++) {
      out[s].push({
        id: String(id * 100 + (+s) * 10 + e), episode_num: e, title: 'Épisode ' + e + ' — ' + ['Le départ', 'La dispute', 'Le retour'][(e - 1) % 3],
        container_extension: 'webm',
        // images d'épisode sous des noms différents selon les fournisseurs ; une image que seule la TV (service) peut charger
        info: id === 701
          ? { plot: 'Épisode long ' + e + '.', duration: '00:04:00', duration_secs: 240, cover_big: HOST + '/imgblock/poster' + e + '.png' }
          : { plot: 'Résumé de l\'épisode ' + e + ' de la saison ' + s + '.', duration: '00:00:06', movie_image: e === 2 ? '' : HOST + '/img/logo' + e + '.png' }
      });
    }
  });
  return out;
}

// ------------------------------------------------------------ guide des programmes
var SHOWS = ['Journal de 13h', 'Météo locale', 'Le Grand Débat', 'Documentaire nature', 'Film du soir', 'Magazine sport', 'Dessins animés', 'Jeu : Questions pour un test', 'Série policière', 'Concert live'];
function pad(x) { return x < 10 ? '0' + x : '' + x; }
function xmltvDate(ms) {
  var d = new Date(ms);
  return d.getUTCFullYear() + pad(d.getUTCMonth() + 1) + pad(d.getUTCDate()) + pad(d.getUTCHours()) + pad(d.getUTCMinutes()) + '00 +0000';
}
function esc(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
function slotStart() { var now = Date.now(); return now - (now % 1800000) - 2 * 3600000; }
function buildXmltv() {
  var out = ['<?xml version="1.0" encoding="UTF-8"?>', '<tv generator-info-name="faux-fournisseur">'];
  live.forEach(function (c) {
    out.push('<channel id="' + c.epg_channel_id + '"><display-name>' + esc(c.name) + '</display-name></channel>');
  });
  var t0 = slotStart();
  live.forEach(function (c, ci) {
    for (var i = 0; i < 30; i++) {
      var s = t0 + i * 1800000;
      var title = SHOWS[(i + ci) % SHOWS.length];
      out.push('<programme start="' + xmltvDate(s) + '" stop="' + xmltvDate(s + 1800000) + '" channel="' + c.epg_channel_id + '">' +
        '<title lang="fr">' + esc(title) + '</title><desc lang="fr">' + esc('Programme « ' + title + ' » sur ' + c.name + ' — émission d\'exemple & test.') + '</desc></programme>');
    }
  });
  out.push('</tv>');
  return out.join('\n');
}
function shortEpg(streamId, limit) {
  var c = live.filter(function (x) { return x.stream_id === streamId; })[0];
  if (!c) return { epg_listings: [] };
  var now = Date.now(), t = now - (now % 1800000), ci = live.indexOf(c);
  var list = [];
  for (var i = 0; i < limit; i++) {
    var title = SHOWS[(i + 4 + ci) % SHOWS.length];
    list.push({ title: Buffer.from(title).toString('base64'), description: Buffer.from('Résumé de ' + title).toString('base64'), start_timestamp: String((t + i * 1800000) / 1000), stop_timestamp: String((t + (i + 1) * 1800000) / 1000) });
  }
  return { epg_listings: list };
}

// ------------------------------------------------------------ M3U
function buildM3U(prefix) {
  var base = HOST + (prefix || '');
  var lines = ['#EXTM3U url-tvg="' + base + '/epg.xml.gz"'];
  var cat = {};
  liveCats.forEach(function (c) { cat[c.category_id] = c.category_name; });
  live.forEach(function (c) {
    lines.push('#EXTINF:-1 tvg-id="' + c.epg_channel_id + '" tvg-name="' + c.name + '" tvg-logo="' + c.stream_icon + '" tvg-chno="' + c.num + '" group-title="' + cat[c.category_id] + '",' + c.name);
    lines.push(base + '/stream/live/' + c.stream_id);
  });
  var vcat = {};
  vodCats.forEach(function (c) { vcat[c.category_id] = c.category_name; });
  vod.forEach(function (v) {
    lines.push('#EXTINF:-1 tvg-logo="' + v.stream_icon + '" group-title="Films ' + vcat[v.category_id] + '",' + v.name);
    lines.push(base + '/stream/vod/' + v.stream_id + '.webm');
  });
  ['Les Voisins du Dessus', 'Brigade Confluence'].forEach(function (s, si) {
    for (var e = 1; e <= 3; e++) {
      lines.push('#EXTINF:-1 tvg-logo="' + HOST + '/img/poster' + (si + 1) + '.png" group-title="Séries",' + s + ' S01E0' + e);
      lines.push(base + '/stream/series/' + (si + 1) + '_' + e + '.webm');
    }
  });
  return lines.join('\r\n') + '\r\n';
}

// ------------------------------------------------------------ serveur
var log = [];
function file(res, req, f, type) {
  var p = path.join(MEDIA, f);
  if (!fs.existsSync(p)) { res.writeHead(404); return res.end(); }
  var size = fs.statSync(p).size;
  var range = req.headers.range;
  if (range) {
    var mm = /bytes=(\d*)-(\d*)/.exec(range);
    var start = mm[1] ? +mm[1] : 0, end = mm[2] ? +mm[2] : size - 1;
    if (start >= size) { res.writeHead(416, { 'Content-Range': 'bytes */' + size }); return res.end(); }
    res.writeHead(206, { 'Content-Type': type, 'Content-Range': 'bytes ' + start + '-' + end + '/' + size, 'Accept-Ranges': 'bytes', 'Content-Length': end - start + 1 });
    return fs.createReadStream(p, { start: start, end: end }).pipe(res);
  }
  res.writeHead(200, { 'Content-Type': type, 'Content-Length': size, 'Accept-Ranges': 'bytes' });
  fs.createReadStream(p).pipe(res);
}
function json(res, obj, cors) {
  var h = { 'Content-Type': 'application/json; charset=utf-8' };
  if (cors) h['Access-Control-Allow-Origin'] = '*';
  res.writeHead(200, h);
  res.end(JSON.stringify(obj));
}

var server = http.createServer(function (req, res) {
  var u = urlLib.parse(req.url, true);
  var p = u.pathname, q = u.query;
  var cors = false;
  if (p.indexOf('/cors/') === 0) { cors = true; p = p.slice(5); }
  if (p.indexOf('/__') !== 0) log.push({ path: p, origin: req.headers.origin || '', ua: req.headers['user-agent'] || '', at: Date.now() });
  if (cors) res.setHeader('Access-Control-Allow-Origin', '*');

  if (p === '/__log') return json(res, log, true);
  if (p === '/__reset') { log = []; return json(res, { ok: true }, true); }

  if (p === '/playlist.m3u') {
    res.writeHead(200, { 'Content-Type': 'audio/x-mpegurl; charset=utf-8' });
    return res.end(buildM3U(cors ? '/cors' : ''));
  }
  if (p === '/epg.xml.gz' || p === '/xmltv.php') {
    // compressé, sans le signaler (le service doit le deviner)
    if (p === '/xmltv.php' && (q.username !== USER || q.password !== PASS)) { res.writeHead(401); return res.end(); }
    res.writeHead(200, { 'Content-Type': 'application/octet-stream' });
    return res.end(zlib.gzipSync(Buffer.from(buildXmltv(), 'utf8')));
  }
  if (p === '/epg.xml') {
    // compressé et signalé (Content-Encoding: gzip)
    res.writeHead(200, { 'Content-Type': 'text/xml; charset=utf-8', 'Content-Encoding': 'gzip' });
    return res.end(zlib.gzipSync(Buffer.from(buildXmltv(), 'utf8')));
  }
  if (p === '/redirect/playlist.m3u') { res.writeHead(302, { Location: '/playlist.m3u' }); return res.end(); }
  if (p === '/empty.m3u') { res.writeHead(200); return res.end('#EXTM3U\n'); }
  if (p === '/notfound.m3u') { res.writeHead(404); return res.end('introuvable'); }

  var img = /^\/img\/(\w+)\.png$/.exec(p);
  if (img) return file(res, req, 'img/' + img[1] + '.png', 'image/png');
  // refuse les navigateurs (comme un site d'images dont la TV n'accepte pas le certificat), accepte le service
  var imgb = /^\/imgblock\/(\w+)\.png$/.exec(p);
  if (imgb) {
    if (/image\//.test(req.headers.accept || '')) { res.writeHead(403); return res.end(); }
    return file(res, req, 'img/' + imgb[1] + '.png', 'image/png');
  }

  // flux
  var mLive = /^\/stream\/live\/(\d+)$/.exec(p) || /^\/live\/[^/]+\/[^/]+\/(\d+)\.(m3u8|ts)$/.exec(p);
  if (mLive) {
    var id = +mLive[1];
    if (id === 1004) { res.writeHead(404); return res.end(); } // une chaîne hors ligne
    return file(res, req, 'live' + (1 + (id % 3)) + '.webm', 'video/webm');
  }
  // film avec 2 langues audio (VF / VO) et 2 sous-titres (fr / en)
  if (/^\/movie\/[^/]+\/[^/]+\/5001\.webm$/.test(p) || p === '/stream/vod/5001.webm') return file(res, req, 'multi.webm', 'video/webm');
  if (/^\/stream\/vod\/\d+\.webm$/.test(p) || /^\/movie\/[^/]+\/[^/]+\/\d+\.webm$/.test(p)) return file(res, req, 'movie.webm', 'video/webm');
  if (/^\/series\/[^/]+\/[^/]+\/701\d+\.webm$/.test(p)) return file(res, req, 'movie.webm', 'video/webm'); // épisodes longs
  var mEp = /^\/stream\/series\/\d+_(\d+)\.webm$/.exec(p) || /^\/series\/[^/]+\/[^/]+\/\d*(\d)\.webm$/.exec(p);
  if (mEp) return file(res, req, 'ep' + (1 + ((+mEp[1] - 1) % 3)) + '.webm', 'video/webm');

  // API Xtream
  if (p === '/player_api.php') {
    if (q.username !== USER || q.password !== PASS) return json(res, { user_info: { auth: 0 } }, cors);
    var a = q.action;
    if (!a) return json(res, { user_info: { auth: 1, status: 'Active', exp_date: '1830297600', max_connections: '2', username: USER }, server_info: { url: '127.0.0.1', port: String(PORT) } }, cors);
    if (a === 'get_live_categories') return json(res, liveCats, cors);
    if (a === 'get_live_streams') return json(res, live, cors);
    if (a === 'get_vod_categories') return json(res, vodCats, cors);
    if (a === 'get_vod_streams') return json(res, vod, cors);
    if (a === 'get_series_categories') return json(res, seriesCats, cors);
    if (a === 'get_series') return json(res, series, cors);
    if (a === 'get_series_info') {
      var s = series.filter(function (x) { return String(x.series_id) === String(q.series_id); })[0];
      if (!s) return json(res, {}, cors);
      return json(res, { info: { plot: s.plot, genre: s.genre, backdrop_path: s.backdrop_path || [] }, episodes: episodes(s.series_id) }, cors);
    }
    if (a === 'get_vod_info') {
      var v = vod.filter(function (x) { return String(x.stream_id) === String(q.vod_id); })[0];
      if (!v) return json(res, {}, cors);
      return json(res, { info: { plot: 'Résumé du film « ' + v.name + ' ». Une histoire captivante tournée entre Lyon et les Alpes.', genre: 'Aventure', releasedate: '2021-05-04', duration: '01:42:00', cast: 'Acteur Un, Actrice Deux', director: 'Réalisatrice Test', rating: '7.4', backdrop_path: [HOST + '/img/backdrop.png'] } }, cors);
    }
    if (a === 'get_short_epg') return json(res, shortEpg(+q.stream_id, +(q.limit || 2)), cors);
    return json(res, [], cors);
  }

  res.writeHead(404); res.end('introuvable');
});
server.listen(PORT, '127.0.0.1', function () { console.log('faux fournisseur prêt : ' + HOST); });
module.exports = { server: server, HOST: HOST, live: live, vod: vod };

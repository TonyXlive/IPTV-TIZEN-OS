/*
 * Canapé TV — guide des programmes (XMLTV), lu en tâche de fond pour ne pas faire ramer l'interface.
 * Sur LG, ce travail était fait par le service Node.js de la TV ; Tizen n'en a pas pour les applis
 * installées à la main, alors on le fait ici, dans un « Web Worker » de la page.
 *
 * Messages reçus :  {cmd: 'parse', buf: ArrayBuffer}       -> {type: 'ready', count} ou {type: 'error', error}
 *                   {cmd: 'now', id, keys: [...], limit}   -> {type: 'reply', id, data: {clé: [prog, …]}}
 *                   {cmd: 'channel', id, key}              -> {type: 'reply', id, data: [prog, …]}
 * Un programme : {s: début en ms, e: fin en ms, t: titre, d: résumé}
 */
'use strict';

var MAX_OUT = 300 * 1024 * 1024; // au-delà, la TV risque de manquer de mémoire

// ---------------------------------------------------------------- décompression (gzip / zlib / deflate brut)

var LEN_BASE = [3, 4, 5, 6, 7, 8, 9, 10, 11, 13, 15, 17, 19, 23, 27, 31, 35, 43, 51, 59, 67, 83, 99, 115, 131, 163, 195, 227, 258];
var LEN_EXTRA = [0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 2, 2, 2, 2, 3, 3, 3, 3, 4, 4, 4, 4, 5, 5, 5, 5, 0];
var DIST_BASE = [1, 2, 3, 4, 5, 7, 9, 13, 17, 25, 33, 49, 65, 97, 129, 193, 257, 385, 513, 769, 1025, 1537, 2049, 3073,
  4097, 6145, 8193, 12289, 16385, 24577];
var DIST_EXTRA = [0, 0, 0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6, 7, 7, 8, 8, 9, 9, 10, 10, 11, 11, 12, 12, 13, 13];
var CL_ORDER = [16, 17, 18, 0, 8, 7, 9, 6, 10, 5, 11, 4, 12, 3, 13, 2, 14, 1, 15];

// Arbre de Huffman canonique : nombre de codes par longueur + symboles triés.
// fast : table indexée par les 9 prochains bits (longueur << 16 | symbole), 0 si le code est plus long.
var FAST = 9;
function buildTree(lengths, off, n) {
  var counts = new Uint16Array(16), offs = new Uint16Array(16), symbols = new Uint16Array(n), i;
  for (i = 0; i < n; i++) counts[lengths[off + i]]++;
  counts[0] = 0;
  for (i = 1; i < 16; i++) offs[i] = offs[i - 1] + counts[i - 1];
  for (i = 0; i < n; i++) if (lengths[off + i]) symbols[offs[lengths[off + i]]++] = i;
  var fast = new Uint32Array(1 << FAST);
  var code = 0, index = 0;
  for (var len = 1; len <= FAST; len++) {
    for (var k = 0; k < counts[len]; k++) {
      // les bits arrivent à l'envers dans le flux deflate
      var rev = 0, c = code;
      for (var b = 0; b < len; b++) { rev = (rev << 1) | (c & 1); c >>= 1; }
      var entry = (len << 16) | symbols[index];
      for (var fill = rev; fill < (1 << FAST); fill += (1 << len)) fast[fill] = entry;
      code++; index++;
    }
    code <<= 1;
  }
  return { counts: counts, symbols: symbols, fast: fast };
}

function inflate(src) {
  var pos = 0, bitbuf = 0, bitcnt = 0, pad = 0;
  var out = new Uint8Array(guessSize(src)), outPos = 0;

  function need(n) {
    while (bitcnt < n) {
      if (pos >= src.length) {
        // fin des données : on complète avec des zéros (la table rapide lit parfois quelques bits de trop)
        if (++pad > 4) throw new Error('Guide des programmes tronqué');
        bitcnt += 8;
        continue;
      }
      bitbuf |= src[pos++] << bitcnt;
      bitcnt += 8;
    }
  }
  // retour au début d'un octet : la table rapide a pu lire un ou deux octets d'avance, on les rend
  function align() {
    var back = (bitcnt >> 3) - pad;
    if (back > 0) pos -= back;
    bitbuf = 0; bitcnt = 0; pad = 0;
  }
  function bits(n) {
    if (!n) return 0;
    need(n);
    var v = bitbuf & ((1 << n) - 1);
    bitbuf >>>= n;
    bitcnt -= n;
    return v;
  }
  function decode(t) {
    need(FAST);
    var e = t.fast[bitbuf & ((1 << FAST) - 1)];
    if (e) { var l = e >>> 16; bitbuf >>>= l; bitcnt -= l; return e & 0xffff; }
    // code long : lecture bit à bit (méthode de « puff », de Mark Adler)
    var code = 0, first = 0, index = 0;
    for (var len = 1; len < 16; len++) {
      code |= bits(1);
      var count = t.counts[len];
      if (code - count < first) return t.symbols[index + (code - first)];
      index += count; first += count; first <<= 1; code <<= 1;
    }
    throw new Error('Guide des programmes illisible');
  }
  function grow(min) {
    var size = out.length * 2;
    while (size < min) size *= 2;
    if (size > MAX_OUT) size = Math.max(min, MAX_OUT);
    if (min > MAX_OUT) throw new Error('Guide des programmes trop volumineux pour la TV');
    var n = new Uint8Array(size);
    n.set(out.subarray(0, outPos));
    out = n;
  }

  var fixedLit = null, fixedDist = null;
  function fixed() {
    if (fixedLit) return;
    var l = new Uint8Array(288), i;
    for (i = 0; i < 144; i++) l[i] = 8;
    for (; i < 256; i++) l[i] = 9;
    for (; i < 280; i++) l[i] = 7;
    for (; i < 288; i++) l[i] = 8;
    fixedLit = buildTree(l, 0, 288);
    var d = new Uint8Array(30);
    for (i = 0; i < 30; i++) d[i] = 5;
    fixedDist = buildTree(d, 0, 30);
  }

  function block(lit, dist) {
    for (;;) {
      var sym = decode(lit);
      if (sym < 256) {
        if (outPos >= out.length) grow(outPos + 1);
        out[outPos++] = sym;
      } else if (sym === 256) {
        return;
      } else {
        sym -= 257;
        if (sym >= 29) throw new Error('Guide des programmes illisible');
        var len = LEN_BASE[sym] + bits(LEN_EXTRA[sym]);
        var ds = decode(dist);
        if (ds >= 30) throw new Error('Guide des programmes illisible');
        var d = DIST_BASE[ds] + bits(DIST_EXTRA[ds]);
        if (d > outPos) throw new Error('Guide des programmes illisible');
        if (outPos + len > out.length) grow(outPos + len);
        for (var i = 0; i < len; i++, outPos++) out[outPos] = out[outPos - d];
      }
    }
  }

  function dynamic() {
    var hlit = bits(5) + 257, hdist = bits(5) + 1, hclen = bits(4) + 4, i;
    var cl = new Uint8Array(19);
    for (i = 0; i < hclen; i++) cl[CL_ORDER[i]] = bits(3);
    var clTree = buildTree(cl, 0, 19);
    var lengths = new Uint8Array(hlit + hdist);
    for (i = 0; i < hlit + hdist;) {
      var sym = decode(clTree);
      if (sym < 16) { lengths[i++] = sym; continue; }
      var rep, val = 0;
      if (sym === 16) { if (!i) throw new Error('Guide des programmes illisible'); val = lengths[i - 1]; rep = 3 + bits(2); }
      else if (sym === 17) rep = 3 + bits(3);
      else rep = 11 + bits(7);
      if (i + rep > hlit + hdist) throw new Error('Guide des programmes illisible');
      while (rep--) lengths[i++] = val;
    }
    block(buildTree(lengths, 0, hlit), buildTree(lengths, hlit, hdist));
  }

  function deflateStream() {
    var last;
    do {
      last = bits(1);
      var type = bits(2);
      if (type === 0) {
        align();
        if (pos + 4 > src.length) throw new Error('Guide des programmes tronqué');
        var len = src[pos] | (src[pos + 1] << 8);
        pos += 4;
        if (pos + len > src.length) throw new Error('Guide des programmes tronqué');
        if (outPos + len > out.length) grow(outPos + len);
        out.set(src.subarray(pos, pos + len), outPos);
        pos += len; outPos += len;
      } else if (type === 1) { fixed(); block(fixedLit, fixedDist); }
      else if (type === 2) dynamic();
      else throw new Error('Guide des programmes illisible');
    } while (!last);
    align();
  }

  if (src[0] === 0x1f && src[1] === 0x8b) {
    // gzip, éventuellement plusieurs morceaux à la suite
    while (pos + 10 <= src.length && src[pos] === 0x1f && src[pos + 1] === 0x8b) {
      var flags = src[pos + 3];
      pos += 10;
      if (flags & 4) pos += 2 + (src[pos] | (src[pos + 1] << 8));
      if (flags & 8) { while (pos < src.length && src[pos]) pos++; pos++; }
      if (flags & 16) { while (pos < src.length && src[pos]) pos++; pos++; }
      if (flags & 2) pos += 2;
      deflateStream();
      pos += 8; // CRC et taille
    }
  } else if ((src[0] & 0x0f) === 8 && ((src[0] << 8) | src[1]) % 31 === 0) {
    pos = 2; // zlib
    deflateStream();
  } else {
    deflateStream();
  }
  return out.subarray(0, outPos);
}

function guessSize(src) {
  var n = src.length;
  if (n > 18 && src[0] === 0x1f && src[1] === 0x8b) {
    // taille d'origine notée à la fin du fichier gzip (modulo 4 Go)
    var isize = (src[n - 4] | (src[n - 3] << 8) | (src[n - 2] << 16) | (src[n - 1] << 24)) >>> 0;
    if (isize >= n && isize <= MAX_OUT) return isize + 1024;
  }
  return Math.min(MAX_OUT, Math.max(65536, n * 6));
}

// ---------------------------------------------------------------- UTF-8 -> texte, par morceaux

function Utf8() {
  this.native = null;
  try { if (typeof TextDecoder !== 'undefined') this.native = new TextDecoder('utf-8'); } catch (e) { this.native = null; }
  this.rest = null;
}
// Décode bytes[from, to) ; les octets d'un caractère coupé en deux sont gardés pour le morceau suivant.
Utf8.prototype.decode = function (bytes, from, to, last) {
  if (this.native) return this.native.decode(bytes.subarray(from, to), { stream: !last });
  var b = bytes, i = from, parts = [], codes = [];
  if (this.rest) {
    var joined = new Uint8Array(this.rest.length + (to - from));
    joined.set(this.rest, 0);
    joined.set(bytes.subarray(from, to), this.rest.length);
    b = joined; i = 0; to = joined.length;
    this.rest = null;
  }
  while (i < to) {
    var c = b[i], n = c < 0x80 ? 1 : c >= 0xf0 ? 4 : c >= 0xe0 ? 3 : c >= 0xc0 ? 2 : 1;
    if (i + n > to) {
      if (!last) { this.rest = b.slice ? b.slice(i, to) : new Uint8Array(Array.prototype.slice.call(b, i, to)); break; }
      codes.push(0xfffd); break;
    }
    var cp;
    if (n === 1) cp = c < 0x80 ? c : 0xfffd;
    else if (n === 2) cp = ((c & 0x1f) << 6) | (b[i + 1] & 0x3f);
    else if (n === 3) cp = ((c & 0x0f) << 12) | ((b[i + 1] & 0x3f) << 6) | (b[i + 2] & 0x3f);
    else cp = ((c & 0x07) << 18) | ((b[i + 1] & 0x3f) << 12) | ((b[i + 2] & 0x3f) << 6) | (b[i + 3] & 0x3f);
    i += n;
    if (cp > 0xffff) { cp -= 0x10000; codes.push(0xd800 + (cp >> 10), 0xdc00 + (cp & 0x3ff)); }
    else codes.push(cp);
    if (codes.length > 8000) { parts.push(String.fromCharCode.apply(null, codes)); codes = []; }
  }
  if (codes.length) parts.push(String.fromCharCode.apply(null, codes));
  return parts.join('');
};

// ---------------------------------------------------------------- lecture du XMLTV (même code que le service LG)

var ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
function decodeXml(s) {
  if (!s) return '';
  return s
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&(#x[0-9a-fA-F]+|#\d+|\w+);/g, function (m, e) {
      if (e.charAt(0) === '#') {
        var n = e.charAt(1) === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
        return isNaN(n) ? m : String.fromCharCode(n);
      }
      return ENTITIES.hasOwnProperty(e) ? ENTITIES[e] : m;
    })
    .trim();
}

function attr(tag, name) {
  var m = new RegExp('\\s' + name + '\\s*=\\s*"([^"]*)"').exec(tag) || new RegExp('\\s' + name + "\\s*=\\s*'([^']*)'").exec(tag);
  return m ? decodeXml(m[1]) : '';
}

// "20261022093000 +0200" -> millisecondes UTC
function xmltvTime(v) {
  var m = /^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})?\s*([+-]\d{2})?:?(\d{2})?/.exec(v || '');
  if (!m) return 0;
  var t = Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +(m[6] || 0));
  if (m[7]) {
    var sign = m[7].charAt(0) === '-' ? -1 : 1;
    var off = (Math.abs(+m[7]) * 60 + +(m[8] || 0)) * 60000 * sign;
    t -= off;
  }
  return t;
}

var epg = { programmes: {}, names: {}, count: 0 };

function parseXmltv(bytes) {
  var programmes = {}, names = {}, count = 0;
  var now = Date.now();
  var minEnd = now - 2 * 3600000;
  var maxStart = now + 36 * 3600000;
  var buf = '';

  function parse(final) {
    // chaînes
    var re = /<channel\b([^>]*)>([\s\S]*?)<\/channel>/g;
    var m, lastIndex = 0;
    while ((m = re.exec(buf))) {
      var id = attr(m[1], 'id');
      var dn = /<display-name[^>]*>([\s\S]*?)<\/display-name>/g;
      var d;
      while ((d = dn.exec(m[2]))) {
        var n = decodeXml(d[1]).toLowerCase();
        if (n && !names[n]) names[n] = id;
      }
      lastIndex = re.lastIndex;
    }
    // programmes
    var rp = /<programme\b([^>]*)>([\s\S]*?)<\/programme>/g;
    var lastP = 0;
    while ((m = rp.exec(buf))) {
      lastP = rp.lastIndex;
      var s = xmltvTime(attr(m[1], 'start'));
      var e = xmltvTime(attr(m[1], 'stop')) || s + 3600000;
      if (e < minEnd || s > maxStart) continue;
      var ch = attr(m[1], 'channel');
      var t = /<title[^>]*>([\s\S]*?)<\/title>/.exec(m[2]);
      var de = /<desc[^>]*>([\s\S]*?)<\/desc>/.exec(m[2]);
      var list = programmes[ch] || (programmes[ch] = []);
      list.push({ s: s, e: e, t: t ? decodeXml(t[1]) : '', d: de ? decodeXml(de[1]).slice(0, 400) : '' });
      count++;
    }
    var cut = Math.max(lastIndex, lastP);
    if (final) { buf = ''; return; }
    if (cut > 0) buf = buf.slice(cut);
    // garde-fou : un bloc incomplet ne peut pas faire plus de quelques centaines de Ko
    else if (buf.length > 4000000) buf = buf.slice(buf.length - 200000);
  }

  var dec = new Utf8();
  var CHUNK = 1024 * 1024;
  for (var off = 0; off < bytes.length; off += CHUNK) {
    var end = Math.min(bytes.length, off + CHUNK);
    buf += dec.decode(bytes, off, end, end >= bytes.length);
    parse(end >= bytes.length);
  }
  if (!bytes.length) parse(true);
  for (var k in programmes) {
    if (programmes.hasOwnProperty(k)) programmes[k].sort(function (a, b) { return a.s - b.s; });
  }
  epg.programmes = programmes;
  epg.names = names;
  epg.count = count;
  return count;
}

function epgFor(key) {
  if (!key) return null;
  if (epg.programmes[key]) return epg.programmes[key];
  var id = epg.names[String(key).toLowerCase()];
  return id ? epg.programmes[id] || null : null;
}

function upcoming(list, limit) {
  var now = Date.now();
  var out = [];
  for (var i = 0; i < list.length && out.length < limit; i++) {
    if (list[i].e > now) out.push(list[i]);
  }
  return out;
}

// ---------------------------------------------------------------- messages

function handle(msg) {
  if (msg.cmd === 'parse') {
    var bytes = new Uint8Array(msg.buf);
    // .xml.gz servi tel quel (sans « Content-Encoding ») : on décompresse nous-mêmes
    if (bytes.length > 1 && bytes[0] === 0x1f && bytes[1] === 0x8b) bytes = inflate(bytes);
    return { type: 'ready', count: parseXmltv(bytes) };
  }
  if (msg.cmd === 'now') {
    var out = {}, keys = msg.keys || [];
    for (var i = 0; i < keys.length; i++) {
      var list = epgFor(keys[i]);
      if (list) out[keys[i]] = upcoming(list, +(msg.limit || 2));
    }
    return { type: 'reply', id: msg.id, data: out };
  }
  if (msg.cmd === 'channel') {
    var l = epgFor(msg.key);
    return { type: 'reply', id: msg.id, data: l ? upcoming(l, 40) : [] };
  }
  return { type: 'reply', id: msg.id, data: null };
}

if (typeof self !== 'undefined' && typeof self.postMessage === 'function' && typeof module === 'undefined') {
  self.onmessage = function (e) {
    var msg = e.data || {};
    var res;
    try { res = handle(msg); } catch (err) { res = { type: msg.cmd === 'parse' ? 'error' : 'reply', id: msg.id, error: err.message, data: null }; }
    self.postMessage(res);
  };
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { inflate: inflate, Utf8: Utf8, parseXmltv: parseXmltv, handle: handle, xmltvTime: xmltvTime, decodeXml: decodeXml };
}

// Vérifie que le code n'utilise rien d'absent des vieilles TV Samsung (Tizen 2.4 / 3.0 : WebKit / Chromium 47).
var fs = require('fs'), path = require('path');
var root = path.join(__dirname, '..');
var bad = 0;
function scan(file, rules) {
  var src = fs.readFileSync(path.join(root, file), 'utf8');
  var lines = src.split('\n');
  lines.forEach(function (l, i) {
    var code = l.replace(/\/\/.*$/, '');
    rules.forEach(function (r) {
      if (r[0].test(code)) { bad++; console.log(file + ':' + (i + 1) + '  ' + r[1] + '  →  ' + l.trim()); }
    });
  });
}
var jsRules = [
  [/\.closest\(/, 'Element.closest (Chrome 41)'],
  [/\.includes\(/, 'includes (Chrome 47)'],
  [/\.startsWith\(|\.endsWith\(/, 'startsWith/endsWith (Chrome 41)'],
  [/Object\.assign|Object\.values|Object\.entries/, 'Object.assign/values (Chrome 45+)'],
  [/Array\.from|Array\.of|\.findIndex\(|(?<!self|this)\.fill\(/, 'Array.from/findIndex (Chrome 45)'],
  [/\bfetch\(/, 'fetch (Chrome 42)'],
  [/\.forEach\(/, 'forEach (à vérifier : NodeList.forEach = Chrome 51)'],
  [/\.append\(|\.prepend\(|(?<!self|this)\.remove\(\)|\.replaceWith\(/, 'ChildNode.append/remove (Chrome 54)'],
  [/scrollIntoView\(\{/, 'scrollIntoView avec options (Chrome 61)'],
  [/\.dataset\b/, 'dataset (ok mais à éviter)'],
  [/new URL\(|URLSearchParams/, 'URL / URLSearchParams (Chrome 49+)'],
  [/padStart|padEnd|\.repeat\(/, 'padStart/repeat'],
  [/\bSymbol\b|\bMap\(|\bSet\(|WeakMap/, 'Map/Set/Symbol'],
  [/requestIdleCallback|IntersectionObserver|ResizeObserver/, 'API récente']
];
var nodeRules = [
  [/Buffer\.from|Buffer\.alloc/, 'Buffer.from/alloc (Node 4.5+)'],
  [/\.includes\(|\.startsWith\(|\.endsWith\(/, 'includes/startsWith (Node 4+)'],
  [/Object\.assign|Array\.from/, 'Object.assign/Array.from (Node 4+)'],
  [/\bclass\s|\blet\s|\bconst\s|=>|`/, 'syntaxe ES6'],
  [/require\(['"](?:fs\/promises|worker_threads|stream\/promises)/, 'module Node récent'],
  [/\bPromise\b/, 'Promise (absent de Node 0.10 et fragile en 0.12)']
];
fs.readdirSync(path.join(root, 'app/js')).forEach(function (f) { if (/\.js$/.test(f)) scan('app/js/' + f, jsRules); });
var cssRules = [
  [/(^|[\s;{])gap\s*:/, 'gap (Chrome 84 en flex)'],
  [/display\s*:\s*grid|grid-template/, 'grid (Chrome 57)'],
  [/var\(--|^\s*--/, 'variables CSS (Chrome 49)'],
  [/(^|[\s;{])inset\s*:/, 'inset (Chrome 87)'],
  [/aspect-ratio/, 'aspect-ratio (Chrome 88)'],
  [/position\s*:\s*sticky/, 'sticky (Chrome 56)'],
  [/::placeholder/, '::placeholder (Chrome 57)'],
  [/(^|[\s;{])filter\s*:|backdrop-filter/, 'filter non préfixé (Chrome 53)'],
  [/clamp\(|min\(|max\(/, 'fonctions CSS min/max/clamp (Chrome 79)']
];
scan('app/css/style.css', cssRules);
// @keyframes doit exister en version -webkit- pour Chromium 38
var css = fs.readFileSync(path.join(root, 'app/css/style.css'), 'utf8');
var kf = css.match(/@keyframes\s+(\w+)/g) || [];
kf.forEach(function (k) {
  var name = k.split(/\s+/)[1];
  if (css.indexOf('@-webkit-keyframes ' + name) === -1) { bad++; console.log('style.css : @-webkit-keyframes ' + name + ' manquant'); }
});
(css.match(/[^-]animation\s*:[^;]+;/g) || []).forEach(function (a) {
  if (css.indexOf('-webkit-' + a.trim().replace(/^[{;\s]*/, '')) === -1) { bad++; console.log('style.css : -webkit-animation manquant pour ' + a.trim()); }
});
console.log(bad ? bad + ' problème(s)' : 'OK : rien d\'incompatible avec les TV Samsung de 2016-2017 détecté');
process.exit(bad ? 1 : 0);

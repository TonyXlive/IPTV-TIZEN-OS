# Canapé TV — installation sur une TV Samsung (Tizen) en mode développeur, depuis Windows.
# Lancé par « Installer Canape TV.bat ». Nécessite Tizen Studio (gratuit, Samsung) et un certificat Samsung
# (voir le README, étapes 1 à 4).

$ErrorActionPreference = 'Stop'
$AppId = 'CanapeTVfr.CanapeTV'
$PackageId = 'CanapeTVfr'
$TvPort = 26101

function Write-Title($text) {
  Write-Host ''
  Write-Host "  $text" -ForegroundColor Yellow
  Write-Host ('  ' + ('-' * $text.Length)) -ForegroundColor DarkYellow
}
function Write-Step($text) { Write-Host "  > $text" -ForegroundColor Cyan }
function Write-Ok($text) { Write-Host "    OK : $text" -ForegroundColor Green }
function Write-Info($text) { Write-Host "    $text" }
function Stop-WithMessage($text) {
  Write-Host ''
  Write-Host "  PROBLÈME : $text" -ForegroundColor Red
  Write-Host ''
  throw 'CANAPE_STOP'
}

# Dossier où l'on garde l'adresse de la TV et le profil de certificat choisi.
function Get-StateDir {
  $dir = Join-Path $env:LOCALAPPDATA 'CanapeTV'
  if (-not (Test-Path $dir)) { New-Item -ItemType Directory -Path $dir | Out-Null }
  return $dir
}

# Tizen Studio : emplacements habituels, ou dossier indiqué par TIZEN_STUDIO.
function Find-TizenStudio {
  $candidates = @()
  if ($env:TIZEN_STUDIO) { $candidates += $env:TIZEN_STUDIO }
  $candidates += @('C:\tizen-studio', (Join-Path $env:USERPROFILE 'tizen-studio'), 'D:\tizen-studio')
  foreach ($c in $candidates) {
    if ($c -and (Test-Path (Join-Path $c 'tools\ide\bin\tizen.bat')) -and (Test-Path (Join-Path $c 'tools\sdb.exe'))) { return $c }
  }
  return $null
}

# Lance une commande et renvoie sa sortie (texte) et son code.
function Invoke-Tool([string]$Exe, [string[]]$Arguments) {
  $out = & $Exe @Arguments 2>&1 | Out-String
  return @{ Out = $out; Code = $LASTEXITCODE }
}

try {
  Write-Title 'Canapé TV — installation sur TV Samsung (Tizen)'

  # 1. Les outils Samsung
  $studio = Find-TizenStudio
  if (-not $studio) {
    Stop-WithMessage ("Tizen Studio est introuvable (cherché dans C:\tizen-studio et " + (Join-Path $env:USERPROFILE 'tizen-studio') + ").`n" +
      "    Installe-le (README, étape 2), ou indique son dossier : set TIZEN_STUDIO=D:\mon\dossier")
  }
  $tizen = Join-Path $studio 'tools\ide\bin\tizen.bat'
  $sdb = Join-Path $studio 'tools\sdb.exe'
  Write-Ok ("Tizen Studio trouvé : " + $studio)

  # 2. L'appli
  $appDir = Join-Path $PSScriptRoot '..\app'
  if (-not (Test-Path (Join-Path $appDir 'config.xml'))) { Stop-WithMessage "Le dossier « app » est introuvable. Garde ce script dans le dossier installation-windows du projet." }
  $appDir = (Resolve-Path $appDir).Path

  # 3. La TV
  $state = Get-StateDir
  $ipFile = Join-Path $state 'tv-samsung.txt'
  $lastIp = ''
  if (Test-Path $ipFile) { $lastIp = (Get-Content $ipFile -Raw).Trim() }
  $prompt = '  Adresse IP de la TV (ex. 192.168.1.42)'
  if ($lastIp) { $prompt += " [Entrée = $lastIp]" }
  $ip = (Read-Host $prompt).Trim()
  if (-not $ip) { $ip = $lastIp }
  if ($ip -notmatch '^\d{1,3}(\.\d{1,3}){3}$') { Stop-WithMessage "Adresse IP invalide : « $ip »." }
  Set-Content -Path $ipFile -Value $ip
  $serial = "${ip}:$TvPort"

  Write-Step "Connexion à la TV ($serial)"
  $r = Invoke-Tool $sdb @('connect', $serial)
  $dev = Invoke-Tool $sdb @('devices')
  if ($dev.Out -notmatch [regex]::Escape($serial) + '\s+device') {
    Write-Host $r.Out
    Stop-WithMessage ("La TV ne répond pas. Vérifie que :`n" +
      "    - la TV est allumée et sur la même box que l'ordinateur ;`n" +
      "    - le mode développeur est activé avec l'adresse IP de CET ordinateur (README, étape 1) ;`n" +
      "    - la TV a bien été redémarrée après l'activation (bouton marche appuyé 3 secondes).")
  }
  Write-Ok 'TV connectée'

  # 4. Le certificat Samsung
  Write-Step 'Recherche du certificat Samsung'
  $profFile = Join-Path $state 'profil-tizen.txt'
  $list = (Invoke-Tool $tizen @('security-profiles', 'list')).Out
  $profiles = @()
  foreach ($line in ($list -split "`r?`n")) {
    $l = $line.Trim()
    if (-not $l -or $l -match '^(\[|Profile|-+$|Name|Active|Loaded)' -or $l -match 'security-profiles') { continue }
    $name = ($l -split '\s+')[0]
    if ($name -and $profiles -notcontains $name) { $profiles += $name }
  }
  if ($profiles.Count -eq 0) {
    Write-Host $list
    Stop-WithMessage "Aucun certificat trouvé. Crée un certificat Samsung dans le Certificate Manager de Tizen Studio (README, étape 3)."
  }
  $certProfile = $null
  $saved = ''
  if (Test-Path $profFile) { $saved = (Get-Content $profFile -Raw).Trim() }
  if ($profiles.Count -eq 1) { $certProfile = $profiles[0] }
  elseif ($saved -and ($profiles -contains $saved)) { $certProfile = $saved }
  else {
    Write-Info 'Certificats disponibles :'
    for ($i = 0; $i -lt $profiles.Count; $i++) { Write-Info ("  " + ($i + 1) + '. ' + $profiles[$i]) }
    $n = [int](Read-Host '  Numéro du certificat Samsung à utiliser')
    if ($n -lt 1 -or $n -gt $profiles.Count) { Stop-WithMessage 'Choix invalide.' }
    $certProfile = $profiles[$n - 1]
  }
  Set-Content -Path $profFile -Value $certProfile
  Write-Ok ("certificat : " + $certProfile)

  # 5. Fabrication du paquet signé
  Write-Step "Fabrication du paquet de l'appli"
  $build = Join-Path $env:TEMP ('canape-tizen-' + [guid]::NewGuid().ToString('N').Substring(0, 8))
  $outDir = Join-Path $build 'out'
  $src = Join-Path $build 'app'
  New-Item -ItemType Directory -Path $outDir | Out-Null
  Copy-Item -Path $appDir -Destination $src -Recurse
  $r = Invoke-Tool $tizen @('package', '-t', 'wgt', '-s', $certProfile, '-o', $outDir, '--', $src)
  $wgt = Get-ChildItem -Path $outDir -Filter '*.wgt' -ErrorAction SilentlyContinue | Select-Object -First 1
  if (-not $wgt) {
    Write-Host $r.Out
    Stop-WithMessage "La fabrication du paquet a échoué (mot de passe du certificat ? voir ci-dessus)."
  }
  $final = Join-Path $outDir 'CanapeTV.wgt'
  if ($wgt.FullName -ne $final) { Move-Item -Path $wgt.FullName -Destination $final -Force }
  Write-Ok 'paquet prêt'

  # 6. Installation et lancement
  Write-Step 'Installation sur la TV (jusqu''à une minute)'
  $r = Invoke-Tool $tizen @('install', '-s', $serial, '-n', 'CanapeTV.wgt', '--', $outDir)
  if ($r.Out -match '(?i)(fail|error|not installed)' -and $r.Out -notmatch '(?i)successfully') {
    Write-Host $r.Out
    if ($r.Out -match '(?i)(certificate|signature|author|distributor)') {
      Stop-WithMessage ("La TV refuse le certificat. Le certificat Samsung doit avoir été créé APRÈS avoir connecté cette TV`n" +
        "    dans le Device Manager (son numéro DUID est alors inclus). Recrée-le (README, étape 3) et relance ce script.")
    }
    Stop-WithMessage "La TV a refusé l'installation (voir le détail ci-dessus)."
  }
  Write-Ok 'Canapé TV est installée.'
  $null = Invoke-Tool $tizen @('run', '-s', $serial, '-p', $AppId)
  Remove-Item -Path $build -Recurse -Force -ErrorAction SilentlyContinue

  Write-Host ''
  Write-Host '  Terminé ! Canapé TV se lance sur la TV ; elle est aussi dans Accueil > Applis.' -ForegroundColor Green
  Write-Host ''
  exit 0
} catch {
  if ($_.Exception.Message -ne 'CANAPE_STOP') {
    Write-Host ''
    Write-Host ('  Erreur inattendue : ' + $_.Exception.Message) -ForegroundColor Red
  }
  exit 1
}

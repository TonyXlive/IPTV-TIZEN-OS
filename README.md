# Canapé TV pour TV Samsung (Tizen)

Lecteur IPTV pour les TV Samsung sous **Tizen** (modèles 2017 et plus récents ; 2016 en principe), avec la même
interface que la version LG : grande bannière, rangées par catégorie, TV en direct avec le guide des programmes,
films, séries, Ma liste, reprise de lecture.

Il lit les playlists **M3U** et les comptes **Xtream Codes** de ton abonnement IPTV.
**Il ne contient aucune chaîne** : il lit uniquement la playlist que tu saisis.

---

## Ce qu'il te faut

- Une TV Samsung sous Tizen, connectée à Internet.
- Un ordinateur (**Windows 10 ou 11** pour le script ; macOS et Linux possibles avec Tizen Studio) branché sur la **même box** que la TV.
- Un **compte Samsung** (gratuit) : celui de la TV ou un autre.

Deux méthodes. La **méthode A** est la plus simple ; la **méthode B** n'utilise que les outils officiels de Samsung.

---

## Étape 1 — Activer le mode développeur (sur la TV)

1. Note l'**adresse IP de l'ordinateur** : sous Windows, touche Windows → tape `cmd` → Entrée → tape `ipconfig` →
   ligne « Adresse IPv4 » (ex. 192.168.1.20).
2. Sur la TV, ouvre **Accueil → Applis** (l'écran des applications).
3. Avec la télécommande, tape **1 2 3 4 5** (sur une télécommande sans chiffres : touche **123** ou **···** pour faire
   apparaître le pavé numérique). Une fenêtre « Developer mode » s'ouvre.
4. Mets **Developer mode** sur **On**, saisis l'**adresse IP de l'ordinateur**, puis **OK**.
5. **Redémarre la TV pour de vrai** : appuie sur le bouton marche **pendant 3 secondes** jusqu'à ce qu'elle s'éteigne
   et se rallume (un simple appui ne fait que la mettre en veille).
6. Note l'**adresse IP de la TV** : **Paramètres → Général → Réseau → État du réseau → Paramètres IP**.

Après le redémarrage, l'écran Applis affiche « Developer Mode » en haut : c'est bon.

---

## Méthode A — avec Apps2Samsung (le plus simple)

**Apps2Samsung** (anciennement « Samsung Jellyfin Installer ») est un petit logiciel gratuit qui crée le certificat Samsung
et installe n'importe quel fichier `.wgt` sur la TV.

1. Télécharge la dernière version sur **github.com/Apps2Samsung/Apps2Samsung** (page *Releases*),
   ou sur **github.com/PatrickSt1991/Samsung-Jellyfin-Installer**.
   - Certains antivirus le signalent à tort : télécharge-le uniquement depuis ces pages GitHub.
2. Lance-le, laisse-le trouver la TV (ou saisis son IP).
3. Choisis une appli **personnalisée (custom .wgt)** et sélectionne le fichier **`dist/CanapeTV.wgt`** de ce dossier.
4. Connecte-toi avec ton **compte Samsung** quand il le demande (c'est ce qui crée le certificat de ta TV).
5. Attends la fin : Canapé TV apparaît dans **Accueil → Applis**.

> C'est un outil tiers (non Samsung), qui évolue souvent. Si un bouton n'a pas le nom indiqué ici,
> cherche l'option permettant d'installer un fichier `.wgt` personnalisé.

---

## Méthode B — avec Tizen Studio (outil officiel Samsung)

### B1. Installer Tizen Studio (une seule fois, sur l'ordinateur)

1. Va sur **developer.tizen.org → Tizen Studio** (ou **developer.samsung.com/smarttv → Tizen Studio**) et télécharge
   l'installeur « **Tizen Studio with IDE installer** » pour Windows.
2. Installe-le dans le dossier proposé (**C:\tizen-studio**).
3. À la fin, le **Package Manager** s'ouvre (sinon : *C:\tizen-studio\package-manager\package-manager.exe*) :
   - onglet **Main SDK** : installe **Tizen SDK tools** ;
   - onglet **Extension SDK** : installe **TV Extensions** (la plus récente) et **Samsung Certificate Extension**.

### B2. Connecter la TV dans Tizen Studio

1. Ouvre **Tizen Studio** → menu **Tools → Device Manager**.
2. Clique sur **Remote Device Manager** (icône d'écran avec un +), puis **+** :
   nom libre, **adresse IP de la TV**, port **26101** → **Add**.
3. Active l'interrupteur **Connection** : la TV apparaît dans la liste.
   Si un message s'affiche sur la TV, accepte-le.

### B3. Créer le certificat Samsung (une seule fois)

La TV n'accepte que les applis signées avec un certificat **Samsung** qui contient son numéro (DUID). La TV doit donc être
**connectée (étape B2) avant** de créer le certificat.

1. Dans Tizen Studio : **Tools → Certificate Manager** → **+**.
2. Choisis **Samsung** → type d'appareil **TV** → donne un nom au profil (ex. `CanapeTV`).
3. **Create a new author certificate** : un nom, un mot de passe (note-le) → connexion avec ton **compte Samsung**.
4. **Distributor certificate** : laisse **Public**, vérifie que le **DUID de la TV** est dans la liste → **Next** → **Finish**.

### B4. Installer Canapé TV

1. Ouvre le dossier **installation-windows**.
2. Double-clique sur **Installer Canape TV.bat**.
   - Si Windows affiche « Windows a protégé votre ordinateur » : **Informations complémentaires** → **Exécuter quand même**.
3. Tape l'**adresse IP de la TV**.
4. Attends **« Terminé ! »** : Canapé TV se lance sur la TV.

Le script trouve Tizen Studio, se connecte à la TV, signe l'appli avec ton certificat Samsung, l'installe et la lance.
L'adresse de la TV et le certificat sont mémorisés : la prochaine fois, appuie simplement sur Entrée.

**Sans le script (macOS, Linux ou à la main)**, dans un terminal (`tizen` et `sdb` sont dans `tizen-studio/tools/ide/bin`
et `tizen-studio/tools`) :

```
sdb connect 192.168.1.42:26101
tizen package -t wgt -s CanapeTV -- chemin/vers/app
tizen install -s 192.168.1.42:26101 -n "Canapé TV.wgt" -- chemin/vers/app
tizen run -s 192.168.1.42:26101 -p CanapeTVfr.CanapeTV
```

(le nom exact du `.wgt` est affiché par `tizen package`).

---

## Premier lancement (sur la TV)

Canapé TV est dans **Accueil → Applis**. Au premier lancement, ajoute ta playlist :

- **Adresse M3U** : colle l'adresse fournie par ton abonnement ;
- ou **Xtream Codes** : serveur, identifiant et mot de passe (▶ sur la ligne « Type » pour choisir).

Sur un champ, appuie sur **OK** pour ouvrir le clavier, puis **▼** pour passer au suivant.

Astuce : pour la retrouver plus vite, va sur son icône dans Applis, appui long sur **OK** → **Ajouter à l'accueil**.

---

## Différences avec la version LG

- **Pas d'expiration tous les 41 jours** : contrairement au mode développeur LG, l'appli reste installée.
  Il faut la réinstaller seulement après une réinitialisation de la TV, ou si le certificat Samsung expire
  (il est valable plusieurs années).
- **Pas de service en arrière-plan** : sur Samsung, l'appli joint directement le fournisseur (c'est autorisé pour les
  applis installées). Le guide des programmes XMLTV (même en `.gz`) est lu en tâche de fond par l'appli elle-même.
- **Lecteur Samsung (AVPlay)** : il lit les flux HLS (`.m3u8`), MPEG-TS (`.ts`), MP4, MKV… et donne accès aux pistes
  audio et sous-titres intégrés.
- **Pas de Magic Remote** : tout se fait avec les flèches. Une souris USB branchée sur la TV fonctionne aussi.

---

## Télécommande

| Touche | Dans les menus | Pendant une chaîne | Pendant un film ou un épisode |
|---|---|---|---|
| Flèches | Se déplacer | ▲▼ zapper, ◀ liste des chaînes | ◀▶ choisir un bouton de la barre, ▲ barre de lecture |
| OK | Ouvrir | Liste des chaînes | Valider le bouton choisi (Pause au départ) |
| CH ▲▼ (P+ / P−) | Défiler vite | Zapper | Épisode précédent / suivant |
| Chiffres | — | Aller à la chaîne n° | — |
| ROUGE (A) | Ajouter / retirer de Ma liste | Ajouter / retirer de Ma liste | — |
| VERT (B) | — | Audio et sous-titres | Audio et sous-titres |
| ▶❚❚ | — | — | Lecture / Pause |
| ◀◀ ▶▶ | — | — | Reculer / avancer d'une minute |
| RETOUR | Revenir en arrière ; depuis l'Accueil, propose de quitter | Quitter le lecteur | Quitter (la position est gardée) |

Sur la **Smart Remote** (télécommande fine sans touches de couleur ni chiffres), appuie sur **123** ou **···** pour faire
apparaître à l'écran le pavé numérique et les touches de couleur. Dans les fiches des films et séries, le bouton
**« Ajouter à ma liste »** remplace le bouton ROUGE.

## Ce que fait l'appli

- **Accueil** : reprendre la lecture, chaînes récentes, Ma liste, nouveautés, puis les catégories.
- **TV en direct** : une rangée par catégorie, programme en cours et suivant sur chaque chaîne.
- **Films / Séries** : affiches, résumé, saisons et épisodes, reprise là où tu t'étais arrêté (même après avoir éteint
  la TV), épisode suivant enchaîné automatiquement, épisodes vus marqués « ✓ Vu ».
- **Barre de commandes du lecteur** : Épisode précédent, −10 s, Pause / Lecture, +10 s, Épisode suivant,
  Audio et sous-titres. Pendant le générique, une carte « Épisode suivant » apparaît.
- **Audio et sous-titres** : bouton VERT. Ton choix de langue est retenu pour les vidéos suivantes.
- **Recherche** dans les chaînes, films et séries (sans se soucier des accents).
- **Plusieurs playlists**, avec des favoris séparés pour chacune.
- **Contrôle parental** : catégories adultes masquées par défaut, déblocage protégé par un code PIN.
- **Guide des programmes** : celui de la playlist, celui du serveur Xtream, ou une adresse XMLTV de ton choix (même `.gz`).
- Quand tu appuies sur le bouton **Accueil** de la TV, le direct est coupé et le film mis en pause ; tout reprend au retour.

## Si quelque chose ne marche pas

- **Le script dit « La TV ne répond pas »** : refais l'étape 1 en vérifiant que l'IP saisie sur la TV est bien celle de
  l'ordinateur, et redémarre la TV avec un appui de **3 secondes** sur le bouton marche.
- **« La TV refuse le certificat »** (ou erreur *signature* / *author* / *distributor*) : le certificat a été créé alors que
  la TV n'était pas connectée. Connecte-la (B2) puis recrée le certificat (B3).
- **Une chaîne ne se lance pas** : dans Réglages → *Format des chaînes (Xtream)*, passe de HLS à MPEG-TS (ou l'inverse).
  L'appli essaie déjà l'autre format une fois toute seule.
- **« Connexion impossible »** : vérifie l'adresse de la playlist (et que la TV a bien Internet).
- **Le guide des programmes ne s'affiche pas** : Réglages → ligne « Guide des programmes » indique où ça bloque.
- **Mettre à jour l'appli** : relance simplement **Installer Canape TV.bat** (ou réinstalle le `.wgt` avec Apps2Samsung).

---

## Contenu du dossier

| Dossier / fichier | Rôle |
|---|---|
| `app/` | L'appli (écrans, lecteur, réglages) ; `config.xml` est sa fiche d'identité Tizen |
| `app/js/tizen.js` | Ce qui est propre à Samsung : touches, sortie, lecteur AVPlay |
| `app/js/epg-worker.js` | Lecture du guide des programmes XMLTV (et décompression `.gz`) en tâche de fond |
| `dist/CanapeTV.wgt` | L'appli empaquetée, **non signée** (Apps2Samsung ou Tizen Studio la signent avec ton certificat) |
| `installation-windows/` | Le script à double-cliquer (méthode B) |
| `tests/` | Faux fournisseur IPTV et test de bout en bout avec une TV Samsung simulée ; `captures/` : images d'écran |
| `tools/` | Fabrication de l'icône et du `.wgt`, contrôle de compatibilité avec les vieilles TV |

### Pour les développeurs

```
node tests/fake-provider.js &                         # faux fournisseur IPTV (port 9100)
PW_PATH=$(npm root -g)/playwright node tests/e2e-tizen.js m3u
PW_PATH=$(npm root -g)/playwright node tests/e2e-tizen.js xtream
node tools/check-old-tv.js                            # rien d'incompatible avec les TV de 2016-2017
./tools/build-wgt.sh                                  # dist/CanapeTV.wgt (signé si PROFILE=… et Tizen Studio présent)
```

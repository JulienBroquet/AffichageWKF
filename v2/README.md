# Affichage Kumite – version 2 (réseau, plusieurs tatamis)

Version en ligne de l'affichage kumite : un **serveur PHP + MySQL** (hébergement Infomaniak, sous-domaine) gère des **tournois complets** avec plusieurs tatamis en simultané.

- Chaque tournoi a une **clé unique** (ex. `Z94B-PFZZ`) et reste conservé (historique, archivage).
- **Organisation centrale** : inscriptions (CSV), pesée, création des pools (manuels / automatiques, poule ou élimination directe avec repêchage), répartition sur les tatamis, suivi en direct, classements, exports.
- **Tables de marque** : une par tatami, avec l'écran TV ; elles reçoivent automatiquement leurs pools et renvoient les résultats.
- **Page publique** (téléphones des parents / coachs) : tatamis en direct, pools, classements – nom et club uniquement.
- **Mode hors ligne** : si Internet coupe, la table continue ; les résultats partent dès le retour du réseau.

## Rôles et accès

| Rôle | Accès | Peut faire |
|---|---|---|
| Super-admin | `admin.html` + mot de passe | créer / modifier / archiver / supprimer des tournois, entrer dans n'importe quel tournoi |
| Organisateur | clé + **code organisateur** | compétiteurs, pools, attribution aux tatamis, règles de combat, résultats, exports |
| Table de marque | clé + **code des tables** + n° de tatami | faire tourner les combats des pools de **son** tatami uniquement |
| Public | lien `public.html#CLÉ` | lecture seule (nom + club) |

Pour un seul code, il suffit de mettre le même code organisateur et tables.

## Installation sur Infomaniak

Prérequis : un hébergement Web avec **PHP 8.1 ou plus** et une base **MySQL / MariaDB**.

1. **Créer le sous-domaine** (ex. `kumite.votreclub.ch`) dans le Manager Infomaniak, pointant vers un dossier dédié (ex. `/sites/kumite`). Choisir PHP 8.2 ou plus récent.
2. **Activer le certificat SSL** (Let's Encrypt) pour ce sous-domaine : les codes et mots de passe doivent passer en HTTPS.
3. **Créer une base de données** MariaDB et un utilisateur avec tous les droits sur cette base. Noter : serveur (ex. `xxxx.myd.infomaniak.com`), nom de la base, utilisateur, mot de passe.
   *La base de WordPress peut aussi être réutilisée : les tables sont préfixées `kt_`.*
4. **Envoyer les fichiers** du dossier `v2/` dans le dossier du sous-domaine (FTP ou gestionnaire de fichiers du Manager).
5. **Configurer** : copier `config.sample.php` en `config.php` et y inscrire les accès à la base.
6. **Installer** : ouvrir `https://kumite.votreclub.ch/install.php` → les tables sont créées, puis choisir le **mot de passe super-admin**.
7. **Créer un tournoi** : `https://kumite.votreclub.ch/admin.html` → « Nouveau tournoi » → la **clé** s'affiche.

## Déroulement d'un tournoi

**Avant** (organisateur, depuis la maison) : `index.html` → clé → *Organisation* → code.
1. Onglet **Compétiteurs** : import CSV (même format que la V1) ou saisie.
2. Onglet **Pools** : créer les pools (automatiques par sexe / âge / poids / grade, ou manuels), choisir poule ou élimination directe, et le **tatami**.
3. **Vue d'ensemble** : vérifier la répartition et l'ordre des pools par tatami.
4. **Paramètres** : durées, atoshi baraku, écart de victoire… envoyés à toutes les tables.

**Le jour J** :
1. Sur chaque PC de table : Chrome ou Edge → `index.html` → clé → *Table de marque* → n° du tatami → code des tables.
2. « Ouvrir l'affichage ↗ » → glisser la fenêtre sur la TV → cliquer pour le plein écran et le son.
3. Onglet « Pools du tatami » → « ▶ Sur le tatami » → « Lancer le pool » : la suite est identique à la V1 (appel, score, pool suivant).
4. L'organisateur suit tous les tatamis en direct (vue d'ensemble), corrige / déplace les pools si besoin.
5. Le public suit sur `public.html#CLÉ` (à afficher en QR code dans la salle).

**Après** : *Résultats* → classements et historique ; *Sauvegarde & export* → CSV Excel et archive `.json`. Le super-admin peut **archiver** le tournoi (lecture seule, toujours consultable).

## Fonctionnement technique

- `api.php` : API JSON unique (POST). Les clients se synchronisent toutes les 2–3 s par **numéro de révision** (seules les modifications sont transférées).
- Chaque pool est **versionné** : en cas de modification simultanée (organisation + table), la table fusionne ses résultats avec la version du serveur et renvoie (aucun résultat perdu).
- La table de marque garde tout en local (navigateur) : combat en cours, pools de son tatami, file d'attente des résultats non envoyés.
- L'écran TV est piloté localement par la table (même PC, comme la V1) : le chrono reste fluide même si le réseau est lent.
- Sécurité : codes et mot de passe hachés (`password_hash`), sessions par jeton (72 h par défaut), limitation à 10 essais de code / 15 min / IP, tables limitées à leur tatami, tournois archivés en lecture seule, `config.php` et `lib/` inaccessibles depuis le web (`.htaccess`).

| Fichier | Rôle |
|---|---|
| `index.html` | accueil : clé du tournoi, choix du rôle |
| `admin.html` | super-admin : tournois |
| `orga.html` + `assets/orga.js` | organisation |
| `table.html` + `assets/table.js` | table de marque |
| `display.html` | écran TV d'un tatami |
| `public.html` | résultats publics |
| `assets/core.js` | logique commune (affichage, pools, élimination directe, classements, CSV) |
| `api.php`, `lib/bootstrap.php` | serveur |
| `install.php` | installation des tables + mot de passe super-admin |

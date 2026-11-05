# Affichage Kumite – version 2 (réseau, plusieurs tatamis)

Version en ligne de l'affichage kumite : un **serveur PHP + MySQL** (hébergement Infomaniak, sous-domaine) gère des **tournois complets** avec plusieurs tatamis en simultané.

- Chaque tournoi a une **clé unique** (ex. `Z94B-PFZZ`) et reste conservé (historique, archivage).
- **Organisation centrale** : inscriptions (CSV), pesée, création des pools (manuels ou automatiques, poule ou élimination directe avec repêchage), répartition sur les tatamis, suivi en direct, classements, diplômes, exports.
- **Tables de marque** : une par tatami, avec l'écran TV ; elles reçoivent automatiquement leurs pools et renvoient les résultats.
- **Appel des combattants** : son d'appel et lecture des noms par synthèse vocale.
- **Page publique** (téléphones des parents et des coachs) : tatamis en direct, pools, classements – nom et club uniquement.
- **Mode hors ligne** : si Internet coupe, la table continue ; les résultats partent dès le retour du réseau.

## Rôles et accès

| Rôle | Accès | Peut faire |
|---|---|---|
| Super-admin | `admin.html` + mot de passe | créer, modifier, archiver, supprimer des tournois ; ouvrir n'importe quel tournoi |
| Organisateur | clé + **code organisateur** | compétiteurs, pools, attribution aux tatamis, règles de combat, sons, résultats, diplômes, exports |
| Table de marque | clé + **code des tables** + n° de tatami | faire tourner les combats des pools de **son** tatami uniquement |
| Public | lien `public.html#CLÉ` | lecture seule (nom + club) |

Pour n'utiliser qu'un seul code, mettez le même code organisateur et tables.

## Installation sur Infomaniak

Prérequis : un hébergement Web avec **PHP 8.1 ou plus** et une base **MySQL / MariaDB**.

1. **Créer le sous-domaine** (ex. `kumite.votreclub.ch`) dans le Manager Infomaniak, pointant vers un dossier dédié. Choisir PHP 8.2 ou plus récent.
2. **Activer le certificat SSL** (Let's Encrypt) pour ce sous-domaine : les codes et mots de passe doivent passer en HTTPS.
3. **Créer une base de données** MariaDB et un utilisateur, puis donner à cet utilisateur **tous les droits** sur cette base (lecture, écriture, création et modification de structure). Noter : le serveur (ex. `xxxx.myd.infomaniak.com`), le nom de la base et l'utilisateur **avec le préfixe ajouté par Infomaniak** (ex. `abcd_kumite`), le mot de passe.
   *La base de WordPress peut aussi être réutilisée : les tables de l'application sont préfixées `kt_`.*
4. **Envoyer les fichiers** du dossier `v2/` dans le dossier du sous-domaine (FTP ou gestionnaire de fichiers du Manager), y compris le fichier caché `.htaccess` et le dossier `assets/fonts/`.
5. **Configurer** : copier `config.sample.php` sous le nom `config.php` et y inscrire les accès à la base. Ce fichier **doit rester sur le serveur** (droits 644 suffisants).
6. **Installer** : ouvrir `https://kumite.votreclub.ch/install.php` → les tables sont créées, puis choisir le **mot de passe super-admin** (8 caractères minimum).
7. Facultatif : supprimer `install.php` et `config.sample.php` du serveur, qui ne servent plus.

### En cas d'erreur à l'installation

`install.php` indique la cause :

| Message | Que faire |
|---|---|
| `config.php` introuvable | Le fichier doit s'appeler exactement `config.php` (attention à Windows qui crée parfois `config.php.txt`) et être dans le même dossier que `install.php`. |
| Utilisateur ou mot de passe refusé | Vérifier `db_user` et `db_pass` dans `config.php`. |
| Base inconnue | Vérifier `db_name`, préfixe Infomaniak compris. |
| Serveur introuvable | `db_host` n'est pas `localhost` chez Infomaniak : reprendre l'adresse indiquée dans le Manager. |
| « command denied » | L'utilisateur n'a pas tous les droits sur la base : les lui donner dans le Manager, puis recharger la page. |

### Mise à jour

Déposer les nouveaux fichiers par-dessus les anciens, **sans toucher à `config.php`**. Si une version ajoute des tables, elles sont créées automatiquement au premier accès : il n'y a pas besoin de relancer `install.php`.

## Tutoriel : déroulement d'un tournoi

### 1. Créer le tournoi (super-admin)

`admin.html` → mot de passe → bloc **« Créer un tournoi »** : nom, date, lieu, nombre de tatamis, code organisateur, code des tables → **« Créer le tournoi »**. La **clé** du tournoi s'affiche ; elle apparaît aussi dans la liste des tournois.

### 2. Préparer (organisateur, avant la compétition)

Accueil (`index.html`) → clé → **Organisation** → code organisateur. Le menu de gauche donne accès à toutes les sections.

1. **Compétiteurs** : **« Importer un CSV… »** (même format que la V1 ; un **« Modèle CSV »** est téléchargeable) ou saisie dans le formulaire. Le bouton ✎ d'une ligne permet de corriger une fiche, par exemple après la pesée.
2. **Pools** → **« Nouveau pool »** :
   - type **automatique** (sexe, âge, poids, grade) ou **manuel** (cases à cocher) ;
   - **tatami**, **mode de combat** (WKF, 4 × 15, Promo), **format** (poule ou élimination directe, avec ou sans repêchage) ;
   - → **« Enregistrer le pool »**. Des alertes signalent les compétiteurs sans pool ou présents dans plusieurs pools, et les pools sans tatami.
3. **Tatamis** : vérifier l'**ordre des pools par tatami** (flèches ↑ ↓, ou changer de tatami avec la liste déroulante).
4. **Paramètres** :
   - **Règles de combat** (durées, atoshi baraku, écart de victoire…) → **« Envoyer les règles aux tables »** ;
   - **Sons et appel des combattants** : son d'atoshi baraku, de fin de match et d'appel (sons proposés ou fichier MP3, WAV ou OGG d'1 Mo maximum, bouton **« ▶ Écouter »**), lecture des noms (texte lu, voix, vitesse, bouton **« ▶ Tester l'appel »**) → **« Enregistrer les sons »**.
5. **Copier le lien des tables** (en bas du menu) et l'envoyer aux responsables des tables avec le code des tables.

### 3. Le jour J

**Sur chaque PC de table de marque** (Chrome ou Edge, TV branchée en écran étendu) :
1. Accueil → clé → **Table de marque** → numéro du tatami → code des tables.
2. **« Ouvrir l'affichage ↗ »** (autoriser les fenêtres pop-up si le navigateur les bloque) → glisser la fenêtre sur la TV → cliquer dedans pour passer en plein écran et activer le son.
3. Onglet **« Pools du tatami »** → **« ▶ Sur le tatami »** sur le premier pool → **« ▶ Lancer le pool »**.
4. Pour chaque combat :
   - l'écran affiche l'**appel** ; la table joue le son d'appel et lit les noms (**« 🔔 Appeler »** pour répéter) ;
   - **démarrer le chrono** : l'écran passe au score. Raccourcis clavier : Espace (chrono), A / S / D (points AKA), J / K / L (points AO) ;
   - **« Déclarer vainqueur »** puis **« Terminer le combat ▶ suivant »**.
5. À la fin du pool, le classement s'affiche ; **« Pool suivant ▶ »** enchaîne.

Si Internet coupe, la table affiche **« Hors ligne »** : on continue normalement, les résultats sont envoyés automatiquement au retour du réseau. Il ne faut pas fermer la page tant que des résultats sont **« en attente »**.

**Organisateur** : la section **Tatamis** montre chaque écran en direct. On peut y déplacer un pool vers un tatami moins chargé.

**Public** : `public.html#CLÉ` (lien **« Page publique »** du menu). Pour l'afficher dans la salle, générez un QR code de ce lien avec n'importe quel générateur de QR code.

### 4. Diplômes

Menu **Diplômes** :
1. Cocher les **pools** (les pools terminés sont cochés d'office) et les **types** : 1re, 2e, 3e place (repêchage compris), participation. La participation peut aller aux non-médaillés ou à tous les compétiteurs ; avec « tous », on peut l'imprimer avant les combats en cochant aussi « Inclure les pools pas encore terminés ».
2. Personnaliser dans le panneau de gauche : cadre, couleurs, logo, ligne d'en-tête, médaille, textes de chaque type (champs `{nom}` `{club}` `{pool}` `{rang}` `{tournoi}` `{date}` `{lieu}`), deux signatures. L'aperçu se met à jour en direct et le modèle est **enregistré automatiquement**.
3. **« Imprimer ou enregistrer en PDF »** → dans la fenêtre d'impression : destination = imprimante ou **« Enregistrer au format PDF »**, marges **Aucune**, cocher **« Graphiques d'arrière-plan »** (pour les couleurs du cadre et des médailles), échelle 100 %. Résultat : une page A4 paysage par diplôme.

### 5. Après le tournoi

- **Résultats** : classements de chaque pool et historique de tous les combats.
- **Sauvegarde et export** : archive `.json` complète (compétiteurs, pools, résultats, sons, modèle de diplôme) et fichiers CSV pour Excel (classements, combats, compétiteurs). Une sauvegarde de la V1 peut aussi être importée.
- Le super-admin peut **archiver** le tournoi : il passe en lecture seule et reste consultable (organisation et page publique).

## Fonctionnement technique

- `api.php` : API JSON unique (POST). Les clients se synchronisent toutes les 2 à 3 s par **numéro de révision** (seules les modifications sont transférées).
- Chaque pool est **versionné** : en cas de modification simultanée (organisation et table), la table fusionne ses résultats avec la version du serveur et renvoie (aucun résultat perdu).
- La table de marque garde tout en local (navigateur) : combat en cours, pools de son tatami, sons personnalisés, file d'attente des résultats non envoyés.
- L'écran TV est piloté localement par la table (même PC, comme la V1) : le chrono reste fluide même si le réseau est lent.
- La lecture des noms utilise la synthèse vocale du navigateur (voix française de Windows, de macOS ou de Chrome) : elle varie selon le PC.
- Sécurité : codes et mot de passe hachés (`password_hash`), sessions par jeton (72 h par défaut), limitation à 10 essais de code par quart d'heure et par adresse IP, tables limitées à leur tatami, tournois archivés en lecture seule, `config.php` et `lib/` inaccessibles depuis le web (`.htaccess`).

| Fichier | Rôle |
|---|---|
| `index.html` | accueil : clé du tournoi, choix du rôle |
| `admin.html` | super-admin : tournois |
| `orga.html` + `assets/orga.js` | organisation |
| `table.html` + `assets/table.js` | table de marque |
| `display.html` | écran TV d'un tatami |
| `public.html` | résultats publics |
| `diplomas.html` + `assets/diplomas.js` + `assets/diplomas.css` | studio de diplômes (A4 paysage) |
| `assets/core.js` | logique commune (affichage, pools, élimination directe, classements, sons, voix, CSV) |
| `assets/app.css`, `assets/fonts/` | style et police Archivo (licence OFL) |
| `api.php`, `lib/bootstrap.php` | serveur |
| `install.php` | installation des tables et du mot de passe super-admin |

# Affichage WKF – tableau de score pour compétitions de karaté (kumite)

> **Version 2 (réseau, plusieurs tatamis, PHP + MySQL)** : voir le dossier [`v2/`](v2/README.md).
> La version 1 ci-dessous reste la version autonome, hors ligne, en un seul fichier.

Application de tableau de score et de gestion de compétition, en **un seul fichier HTML** (`affichage-kumite.html`).
Elle fonctionne **hors ligne**, sans installation, dans Chrome ou Edge.

## Démarrage rapide

1. Ouvrir `affichage-kumite.html` dans Chrome ou Edge sur le PC de la table de marque.
2. Cliquer sur **« Ouvrir l'affichage ↗ »** et glisser la fenêtre sur la TV (écran étendu).
3. Cliquer dans la fenêtre d'affichage pour passer en plein écran et activer le son (double-clic pour sortir du plein écran).

## Fonctions

### Combat
- Scores AKA / AO : Yuko (1), Waza-ari (2), Ippon (3), avec le détail affiché
- Pénalités : C1, C2, C3, HC, H (une catégorie en WKF, deux catégories en Promo / 4 × 15)
- Senshu (automatique au premier point en WKF), déclaration du vainqueur, annulation (Ctrl+Z)
- Chronomètre : départ / arrêt / reprise, ajustement ±1 s / ±10 s, réglage précis
- Signaux sonores : **atoshi baraku** et **fin du temps**
- Victoire automatique à 8 points d'écart (WKF)

### Modes de combat
| Mode | Déroulement |
|---|---|
| **WKF** | 3 min (réglable), atoshi baraku à 15 s, écart de 8 points |
| **4 × 15** | 4 assauts de 15 s (AKA attaque, AO attaque, AKA attaque / AO contre, AO attaque / AKA contre) |
| **Promo** | 4 échanges sans chronomètre (chronomètre optionnel) |

Durées et signaux modifiables dans l'onglet **Réglages**.

### Compétiteurs
- Saisie manuelle ou import **CSV** (séparateur `;` ou `,`, export Excel accepté)
- Champs : nom, prénom, dojo/club, sexe, âge ou année de naissance, poids, grade (kyu/dan ou couleur de ceinture), catégorie
- Modèle CSV téléchargeable dans l'application

Exemple de CSV :
```csv
Nom;Prénom;Dojo;Sexe;Année de naissance;Poids;Grade;Catégorie
Muller;Léa;Karaté Club Lausanne;F;2014;41.5;5e kyu;
Rossi;Marco;Dojo Genève;M;2013;38;jaune;
```

### Pools (préparés à l'avance)
- **Pool manuel** (on coche les compétiteurs) ou **automatique** (fourchettes de sexe, âge, poids, grade)
- Alertes : compétiteurs sans pool ou dans plusieurs pools
- Format **Poule** (chacun contre chacun) – classement standard (victoires) ou aux points
- Format **Élimination directe**, avec ou sans **repêchage WKF** (tirage au sort automatique, exempts, 2 bronzes)
- Enchaînement à l'écran : **Liste → Appel des combattants → Score → … → Classement**, puis **Pool suivant**
- Écran **Tableau** pour l'élimination directe (3 derniers tours affichés pour les grands tableaux)

### Sauvegarde et export
- **💾 Sauvegarder** : un fichier `.json` contenant tout (compétiteurs, pools, résultats, réglages)
- **Restaurer** une sauvegarde sur n'importe quel PC
- Exports **CSV** pour Excel : classements, tous les combats, liste des compétiteurs

## Raccourcis clavier (page de gestion)

| Touche | Action |
|---|---|
| Espace | Démarrer / arrêter le chrono |
| A / S / D | Yuko / Waza-ari / Ippon pour AKA |
| J / K / L | Yuko / Waza-ari / Ippon pour AO |
| Maj + touche | Retirer le point |
| N | Phase / assaut suivant (Promo, 4 × 15) |
| Ctrl + Z | Annuler |

## Bon à savoir
- Les données sont enregistrées dans le navigateur (localStorage) : elles restent après fermeture, mais sont propres à **ce navigateur sur ce PC**. Faites des sauvegardes `.json` régulières (après la pesée, entre les pools) sur une clé USB.
- La fenêtre d'affichage doit être ouverte depuis le **même navigateur sur le même PC** que la gestion.
- Plusieurs tatamis : un PC par tatami ; préparer les pools sur un PC, sauvegarder, puis restaurer sur chaque PC.

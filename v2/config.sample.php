<?php
/*
 * Affichage Kumite V2 – configuration
 * 1. Copiez ce fichier sous le nom  config.php
 * 2. Renseignez les accès à la base MySQL / MariaDB (Manager Infomaniak → Bases de données)
 * 3. Ouvrez  https://votre-sous-domaine/install.php  pour créer les tables et le mot de passe super-admin
 */
return [
    'db_host'   => 'xxxxx.myd.infomaniak.com',   // serveur MySQL indiqué par Infomaniak
    'db_name'   => 'xxxxx_kumite',               // nom de la base
    'db_user'   => 'xxxxx_kumite',               // utilisateur
    'db_pass'   => 'mot-de-passe',               // mot de passe
    'db_prefix' => 'kt_',                        // préfixe des tables (permet de partager la base avec WordPress)

    // Durée de validité d'une connexion (organisateur / table / admin), en heures
    'session_hours' => 72,

    // Fuseau horaire pour les dates affichées
    'timezone' => 'Europe/Zurich',
];

<?php
/* Affichage Kumite V2 – installation (création des tables + mot de passe super-admin) */
declare(strict_types=1);
require __DIR__ . '/lib/bootstrap.php';
header('Content-Type: text/html; charset=utf-8');
$msg = ''; $err = ''; $step = 'ok';
try {
    app_config();
    db();
    install_schema();
    if (meta_get('admin_hash') === null) {
        $step = 'password';
        if ($_SERVER['REQUEST_METHOD'] === 'POST') {
            $p = (string)($_POST['password'] ?? ''); $p2 = (string)($_POST['password2'] ?? '');
            if (mb_strlen($p) < 8) $err = 'Le mot de passe doit contenir au moins 8 caractères.';
            elseif ($p !== $p2) $err = 'Les deux mots de passe ne correspondent pas.';
            else { meta_set('admin_hash', password_hash($p, PASSWORD_DEFAULT)); $step = 'done'; }
        }
    }
} catch (PDOException $e) {
    // (PDOException hérite de RuntimeException : il faut la traiter en premier)
    $step = 'error';
    $m = $e->getMessage();
    $hint = '';
    if (str_contains($m, 'Access denied')) $hint = "Utilisateur ou mot de passe refusé : vérifiez <b>db_user</b> et <b>db_pass</b>, et que cet utilisateur a bien les droits sur la base.";
    elseif (str_contains($m, 'Unknown database')) $hint = "La base indiquée dans <b>db_name</b> n'existe pas (attention au préfixe ajouté par Infomaniak, ex. <code>abcd_kumite</code>).";
    elseif (str_contains($m, 'getaddrinfo') || str_contains($m, 'No such file') || str_contains($m, 'Connection refused') || str_contains($m, 'timed out'))
        $hint = "Serveur de base introuvable : vérifiez <b>db_host</b> (chez Infomaniak, de la forme <code>xxxx.myd.infomaniak.com</code>, pas <code>localhost</code>).";
    $err = 'Le fichier config.php a bien été trouvé, mais la connexion à la base de données a échoué.<br>' . ($hint ? $hint . '<br>' : '')
         . '<small>Détail technique : ' . htmlspecialchars($m) . '</small>';
} catch (RuntimeException $e) {
    $step = 'error';
    $dir = __DIR__;
    $similar = array_map('basename', glob($dir . '/config*') ?: []);
    $err = "Fichier <b>config.php</b> introuvable dans le dossier <code>" . htmlspecialchars($dir) . "</code>.<br>"
         . "Fichiers « config… » présents : <b>" . ($similar ? htmlspecialchars(implode(', ', $similar)) : 'aucun') . "</b>.<br>"
         . "Le fichier doit s'appeler exactement <code>config.php</code> (attention à Windows qui peut cacher l'extension et produire <code>config.php.php</code> ou <code>config.php.txt</code>), et être dans le même dossier que <code>install.php</code>.";
}
?><!DOCTYPE html>
<html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Installation – Affichage Kumite</title><link rel="stylesheet" href="assets/app.css"></head>
<body class="page"><main class="narrow card">
<h1>Installation</h1>
<?php if ($step === 'error'): ?>
  <p class="alertbox"><?= $err ?></p>
<?php elseif ($step === 'password'): ?>
  <p>La base de données est prête. Choisissez le <b>mot de passe super-administrateur</b> (création et archivage des tournois).</p>
  <?php if ($err): ?><p class="alertbox"><?= htmlspecialchars($err) ?></p><?php endif; ?>
  <form method="post" class="stack">
    <label>Mot de passe (8 caractères min.)<input type="password" name="password" required minlength="8" autocomplete="new-password"></label>
    <label>Confirmer<input type="password" name="password2" required minlength="8" autocomplete="new-password"></label>
    <button class="btn primary">Enregistrer</button>
  </form>
<?php elseif ($step === 'done'): ?>
  <p>✅ Installation terminée.</p>
  <p><a class="btn primary" href="admin.html">Aller à l'administration</a></p>
<?php else: ?>
  <p>✅ L'application est déjà installée (tables à jour, version <?= APP_VERSION ?>).</p>
  <p><a class="btn" href="index.html">Accueil</a> <a class="btn" href="admin.html">Administration</a></p>
<?php endif; ?>
</main></body></html>

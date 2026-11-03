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
} catch (RuntimeException $e) {
    $step = 'error'; $err = "Fichier config.php introuvable. Copiez config.sample.php en config.php et renseignez les accès à la base.";
} catch (PDOException $e) {
    $step = 'error'; $err = 'Connexion à la base impossible : ' . htmlspecialchars($e->getMessage());
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

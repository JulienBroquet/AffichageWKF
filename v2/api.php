<?php
/* Affichage Kumite V2 – API JSON (POST, corps JSON : { "action": "...", ... }) */
declare(strict_types=1);
require __DIR__ . '/lib/bootstrap.php';

/* ------------------------------------------------------------------ helpers */
function in_str(array $in, string $k, int $max = 200, string $def = ''): string {
    $v = $in[$k] ?? $def;
    if (!is_scalar($v)) fail("Champ invalide : $k", 'bad_input');
    return mb_substr(trim((string)$v), 0, $max);
}
function in_int(array $in, string $k, ?int $def = null): ?int {
    if (!isset($in[$k]) || $in[$k] === '' || $in[$k] === null) return $def;
    if (!is_numeric($in[$k])) fail("Champ invalide : $k", 'bad_input');
    return (int)$in[$k];
}
function load_tournament_by_key(string $key): array {
    $st = db()->prepare("SELECT * FROM " . T('tournaments') . " WHERE tkey = ?");
    $st->execute([normalize_key($key)]);
    $t = $st->fetch();
    if (!$t) fail('Tournoi introuvable. Vérifiez la clé.', 'not_found', 404);
    return $t;
}
function load_tournament(int $id): array {
    $st = db()->prepare("SELECT * FROM " . T('tournaments') . " WHERE id = ?");
    $st->execute([$id]);
    $t = $st->fetch();
    if (!$t) fail('Tournoi introuvable.', 'not_found', 404);
    return $t;
}
function public_tournament(array $t): array {
    return [
        'id' => (int)$t['id'], 'key' => $t['tkey'], 'name' => $t['name'], 'date' => $t['tdate'], 'place' => $t['place'],
        'tatamis' => (int)$t['tatamis'], 'status' => $t['status'], 'rev' => (int)$t['rev'],
        'settings' => $t['settings'] ? json_decode($t['settings'], true) : null,
    ];
}
function session(?string $token): ?array {
    if (!$token || !preg_match('/^[a-f0-9]{48}$/', $token)) return null;
    $st = db()->prepare("SELECT * FROM " . T('sessions') . " WHERE token = ? AND expires_at > ?");
    $st->execute([$token, now_sql()]);
    return $st->fetch() ?: null;
}
function open_session(?int $tid, string $role, ?int $tatami = null): string {
    $token = new_token();
    $h = (int)app_config()['session_hours'];
    db()->prepare("DELETE FROM " . T('sessions') . " WHERE expires_at < ?")->execute([now_sql()]);
    db()->prepare("INSERT INTO " . T('sessions') . " (token, tournament_id, role, tatami, expires_at, created_at) VALUES (?,?,?,?,?,?)")
        ->execute([$token, $tid, $role, $tatami, gmdate('Y-m-d H:i:s', time() + $h * 3600), now_sql()]);
    return $token;
}
function require_role(?array $s, array $roles): array {
    if (!$s) fail('Session expirée ou invalide. Reconnectez-vous.', 'auth', 401);
    if (!in_array($s['role'], $roles, true)) fail('Action non autorisée pour ce rôle.', 'forbidden', 403);
    return $s;
}
function require_writable(array $t): void {
    if ($t['status'] !== 'active') fail('Ce tournoi est archivé : il est en lecture seule.', 'archived', 403);
}
function clean_competitor(array $c): array {
    $id = preg_replace('/[^A-Za-z0-9_-]/', '', (string)($c['id'] ?? ''));
    if ($id === '' || strlen($id) > 24) fail('Identifiant de compétiteur invalide.', 'bad_input');
    $name = mb_substr(trim((string)($c['name'] ?? '')), 0, 200);
    if ($name === '') fail('Nom de compétiteur manquant.', 'bad_input');
    $sex = in_array($c['sex'] ?? '', ['F', 'M'], true) ? $c['sex'] : '';
    $num = fn($v, $min, $max) => (is_numeric($v) && $v >= $min && $v <= $max) ? $v : null;
    return [
        'id' => $id, 'name' => $name, 'dojo' => mb_substr(trim((string)($c['dojo'] ?? '')), 0, 200), 'sex' => $sex,
        'age' => ($a = $num($c['age'] ?? null, 0, 120)) === null ? null : (int)$a,
        'weight' => ($w = $num($c['weight'] ?? null, 0, 400)) === null ? null : round((float)$w, 1),
        'grade' => ($g = $num($c['grade'] ?? null, 1, 20)) === null ? null : (int)$g,
        'category' => mb_substr(trim((string)($c['category'] ?? '')), 0, 120),
    ];
}
function competitor_out(array $r): array {
    return ['id' => $r['id'], 'name' => $r['name'], 'dojo' => $r['dojo'], 'sex' => $r['sex'],
        'age' => $r['age'] === null ? null : (int)$r['age'], 'weight' => $r['weight'] === null ? null : (float)$r['weight'],
        'grade' => $r['grade'] === null ? null : (int)$r['grade'], 'category' => $r['category'], 'deleted' => (int)$r['deleted'] === 1];
}
function pool_out(array $r, bool $public = false): array {
    $data = json_decode($r['data'], true) ?: [];
    if ($public) unset($data['memberIds'], $data['draw']);
    return ['id' => $r['id'], 'version' => (int)$r['version'], 'deleted' => (int)$r['deleted'] === 1, 'data' => $data];
}
function upsert_competitors(int $tid, array $items): int {
    $rev = bump_rev($tid);
    $sql = "INSERT INTO " . T('competitors') . " (tournament_id, id, name, dojo, sex, age, weight, grade, category, deleted, rev, updated_at)
            VALUES (?,?,?,?,?,?,?,?,?,0,?,?)
            ON DUPLICATE KEY UPDATE name=VALUES(name), dojo=VALUES(dojo), sex=VALUES(sex), age=VALUES(age), weight=VALUES(weight),
              grade=VALUES(grade), category=VALUES(category), deleted=0, rev=VALUES(rev), updated_at=VALUES(updated_at)";
    $st = db()->prepare($sql);
    foreach ($items as $c) {
        $c = clean_competitor(is_array($c) ? $c : []);
        $st->execute([$tid, $c['id'], $c['name'], $c['dojo'], $c['sex'], $c['age'], $c['weight'], $c['grade'], $c['category'], $rev, now_sql()]);
    }
    return $rev;
}
function save_pool(int $tid, array $pool, ?int $baseVersion, bool $force = false): array {
    $id = preg_replace('/[^A-Za-z0-9_-]/', '', (string)($pool['id'] ?? ''));
    if ($id === '' || strlen($id) > 24) fail('Identifiant de pool invalide.', 'bad_input');
    $pool['id'] = $id;
    $json = json_encode($pool, JSON_UNESCAPED_UNICODE);
    if (strlen($json) > 4_000_000) fail('Pool trop volumineux.', 'too_large');
    $name = mb_substr((string)($pool['name'] ?? ''), 0, 200);
    $tatami = isset($pool['tatami']) && is_numeric($pool['tatami']) && $pool['tatami'] > 0 ? (int)$pool['tatami'] : null;
    $sort = isset($pool['sort']) && is_numeric($pool['sort']) ? (int)$pool['sort'] : 0;
    $pdo = db();
    $st = $pdo->prepare("SELECT version, deleted FROM " . T('pools') . " WHERE tournament_id = ? AND id = ?");
    $st->execute([$tid, $id]);
    $cur = $st->fetch();
    $rev = bump_rev($tid);
    if (!$cur) {
        $pdo->prepare("INSERT INTO " . T('pools') . " (tournament_id, id, name, tatami, sort, data, version, deleted, rev, updated_at) VALUES (?,?,?,?,?,?,1,0,?,?)")
            ->execute([$tid, $id, $name, $tatami, $sort, $json, $rev, now_sql()]);
        return ['version' => 1, 'rev' => $rev];
    }
    if (!$force && $baseVersion !== null && (int)$cur['version'] !== $baseVersion) {
        $st = $pdo->prepare("SELECT * FROM " . T('pools') . " WHERE tournament_id = ? AND id = ?");
        $st->execute([$tid, $id]);
        fail('Ce pool a été modifié ailleurs entre-temps.', 'conflict', 409, ['pool' => pool_out($st->fetch())]);
    }
    $upd = $pdo->prepare("UPDATE " . T('pools') . " SET name=?, tatami=?, sort=?, data=?, version=version+1, deleted=0, rev=?, updated_at=?
                          WHERE tournament_id=? AND id=?" . (!$force && $baseVersion !== null ? " AND version=?" : ""));
    $args = [$name, $tatami, $sort, $json, $rev, now_sql(), $tid, $id];
    if (!$force && $baseVersion !== null) $args[] = $baseVersion;
    $upd->execute($args);
    if ($upd->rowCount() === 0) fail('Ce pool a été modifié ailleurs entre-temps.', 'conflict', 409);
    return ['version' => (int)$cur['version'] + 1, 'rev' => $rev];
}
function log_results(int $tid, array $results, ?int $tatami): void {
    $st = db()->prepare("INSERT IGNORE INTO " . T('results') . " (tournament_id, rid, pool_id, pool_name, label, tatami, aka, aka_dojo, ao, ao_dojo, score_aka, score_ao, winner, detail, created_at)
                         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)");
    foreach (array_slice($results, 0, 50) as $r) {
        if (!is_array($r) || empty($r['rid'])) continue;
        $s = fn($k, $n = 200) => mb_substr((string)($r[$k] ?? ''), 0, $n);
        $st->execute([$tid, $s('rid', 40), $s('pool_id', 24), $s('pool_name'), $s('label', 120), $tatami, $s('aka'), $s('aka_dojo'), $s('ao'), $s('ao_dojo'),
            (int)($r['sa'] ?? 0), (int)($r['sb'] ?? 0), in_array($r['winner'] ?? '', ['aka', 'ao'], true) ? $r['winner'] : '',
            isset($r['detail']) ? json_encode($r['detail'], JSON_UNESCAPED_UNICODE) : null, now_sql()]);
    }
}
function sync_payload(array $t, int $since, string $role, ?int $tatami): array {
    $tid = (int)$t['id'];
    $pdo = db();
    $full = $since <= 0;
    $out = ['ok' => true, 'rev' => (int)$t['rev'], 'now' => now_ms(), 'full' => $full, 'tournament' => public_tournament($t)];
    if ($role === 'orga' || $role === 'admin') {
        $st = $pdo->prepare("SELECT * FROM " . T('competitors') . " WHERE tournament_id = ? AND rev > ?" . ($full ? " AND deleted = 0" : "") . " ORDER BY name");
        $st->execute([$tid, $since]);
        $out['competitors'] = array_map('competitor_out', $st->fetchAll());
    }
    $sql = "SELECT * FROM " . T('pools') . " WHERE tournament_id = ? AND rev > ?" . ($full ? " AND deleted = 0" : "");
    $args = [$tid, $since];
    $st = $pdo->prepare($sql . " ORDER BY sort, name");
    $st->execute($args);
    $out['pools'] = array_map(fn($r) => pool_out($r, $role === 'public'), $st->fetchAll());
    $st = $pdo->prepare("SELECT tatami, data, updated_ms FROM " . T('live') . " WHERE tournament_id = ?");
    $st->execute([$tid]);
    $out['live'] = array_map(fn($r) => ['tatami' => (int)$r['tatami'], 'data' => json_decode($r['data'], true), 'updated_ms' => (int)$r['updated_ms']], $st->fetchAll());
    return $out;
}

/* ------------------------------------------------------------------ routing */
try {
    if ($_SERVER['REQUEST_METHOD'] !== 'POST') fail('Utiliser POST.', 'method', 405);
    $raw = file_get_contents('php://input', false, null, 0, 20_000_000);
    $in = json_decode($raw ?: '{}', true);
    if (!is_array($in)) fail('Requête invalide.', 'bad_json');
    try { app_config(); } catch (RuntimeException $e) { fail("Le serveur n'est pas encore configuré (config.php manquant).", 'not_configured', 503); }
    try { db(); } catch (PDOException $e) { fail('Connexion à la base de données impossible. Vérifiez config.php.', 'db', 503); }
    if (meta_get('schema_version') === null) fail("La base n'est pas installée. Ouvrez install.php.", 'not_installed', 503);

    $action = (string)($in['action'] ?? '');
    $token = $_SERVER['HTTP_X_KUMITE_TOKEN'] ?? ($in['token'] ?? null);
    $sess = session(is_string($token) ? $token : null);

    switch ($action) {

    /* ---------- public ---------- */
    case 'ping':
        json_out(['ok' => true, 'version' => APP_VERSION, 'now' => now_ms()]);

    case 'info': {
        $t = load_tournament_by_key(in_str($in, 'key', 20));
        json_out(['ok' => true, 'tournament' => public_tournament($t)]);
    }

    case 'public_sync': {
        $t = load_tournament_by_key(in_str($in, 'key', 20));
        json_out(sync_payload($t, (int)($in['since'] ?? 0), 'public', null));
    }

    case 'login': {
        check_rate_limit();
        $t = load_tournament_by_key(in_str($in, 'key', 20));
        $role = in_str($in, 'role', 10);
        if (!in_array($role, ['orga', 'table'], true)) fail('Rôle invalide.', 'bad_input');
        $pin = (string)($in['pin'] ?? '');
        $hash = $role === 'orga' ? $t['pin_orga'] : $t['pin_table'];
        if (!password_verify($pin, $hash)) { record_failure(); fail('Code incorrect.', 'bad_pin', 401); }
        $tatami = null;
        if ($role === 'table') {
            $tatami = in_int($in, 'tatami', 1);
            if ($tatami < 1 || $tatami > (int)$t['tatamis']) fail('Numéro de tatami invalide.', 'bad_input');
        }
        $tok = open_session((int)$t['id'], $role, $tatami);
        json_out(['ok' => true, 'token' => $tok, 'role' => $role, 'tatami' => $tatami, 'tournament' => public_tournament($t)]);
    }

    case 'admin_login': {
        check_rate_limit();
        $hash = meta_get('admin_hash');
        if (!$hash || !password_verify((string)($in['password'] ?? ''), $hash)) { record_failure(); fail('Mot de passe incorrect.', 'bad_pin', 401); }
        json_out(['ok' => true, 'token' => open_session(null, 'admin')]);
    }

    case 'logout':
        if ($sess) db()->prepare("DELETE FROM " . T('sessions') . " WHERE token = ?")->execute([$sess['token']]);
        json_out(['ok' => true]);

    /* ---------- super-admin ---------- */
    case 'admin_list': {
        require_role($sess, ['admin']);
        $p = app_config()['db_prefix'];
        $rows = db()->query("SELECT t.id, t.tkey, t.name, t.tdate, t.place, t.tatamis, t.status, t.created_at, t.updated_at,
            (SELECT COUNT(*) FROM {$p}competitors c WHERE c.tournament_id = t.id AND c.deleted = 0) AS n_comp,
            (SELECT COUNT(*) FROM {$p}pools q WHERE q.tournament_id = t.id AND q.deleted = 0) AS n_pools,
            (SELECT COUNT(*) FROM {$p}results r WHERE r.tournament_id = t.id) AS n_results
            FROM {$p}tournaments t ORDER BY COALESCE(t.tdate, DATE(t.created_at)) DESC, t.id DESC")->fetchAll();
        json_out(['ok' => true, 'tournaments' => $rows]);
    }

    case 'admin_create': {
        require_role($sess, ['admin']);
        $name = in_str($in, 'name');
        if ($name === '') fail('Nom du tournoi obligatoire.', 'bad_input');
        $po = (string)($in['pin_orga'] ?? ''); $pt = (string)($in['pin_table'] ?? '');
        if (mb_strlen($po) < 4 || mb_strlen($pt) < 4) fail('Les codes doivent contenir au moins 4 caractères.', 'bad_input');
        $tat = max(1, min(20, in_int($in, 'tatamis', 1)));
        $date = in_str($in, 'date', 10);
        if ($date !== '' && !preg_match('/^\d{4}-\d{2}-\d{2}$/', $date)) fail('Date invalide.', 'bad_input');
        $key = new_tournament_key();
        db()->prepare("INSERT INTO " . T('tournaments') . " (tkey, name, tdate, place, tatamis, pin_orga, pin_table, settings, status, rev, created_at, updated_at)
                       VALUES (?,?,?,?,?,?,?,NULL,'active',1,?,?)")
            ->execute([$key, $name, $date ?: null, in_str($in, 'place'), $tat, password_hash($po, PASSWORD_DEFAULT), password_hash($pt, PASSWORD_DEFAULT), now_sql(), now_sql()]);
        json_out(['ok' => true, 'key' => $key, 'id' => (int)db()->lastInsertId()]);
    }

    case 'admin_update': {
        require_role($sess, ['admin']);
        $t = load_tournament(in_int($in, 'id', 0));
        $f = []; $a = [];
        foreach (['name' => 200, 'place' => 200] as $k => $max) if (isset($in[$k])) { $f[] = "$k = ?"; $a[] = in_str($in, $k, $max); }
        if (isset($in['date'])) { $d = in_str($in, 'date', 10); if ($d !== '' && !preg_match('/^\d{4}-\d{2}-\d{2}$/', $d)) fail('Date invalide.', 'bad_input'); $f[] = 'tdate = ?'; $a[] = $d ?: null; }
        if (isset($in['tatamis'])) { $f[] = 'tatamis = ?'; $a[] = max(1, min(20, in_int($in, 'tatamis', 1))); }
        if (isset($in['status'])) { $s = in_str($in, 'status', 16); if (!in_array($s, ['active', 'archived'], true)) fail('Statut invalide.', 'bad_input'); $f[] = 'status = ?'; $a[] = $s; }
        foreach (['pin_orga', 'pin_table'] as $k) if (!empty($in[$k])) {
            if (mb_strlen((string)$in[$k]) < 4) fail('Les codes doivent contenir au moins 4 caractères.', 'bad_input');
            $f[] = "$k = ?"; $a[] = password_hash((string)$in[$k], PASSWORD_DEFAULT);
        }
        if (!$f) json_out(['ok' => true]);
        $a[] = (int)$t['id'];
        db()->prepare("UPDATE " . T('tournaments') . " SET " . implode(', ', $f) . " WHERE id = ?")->execute($a);
        bump_rev((int)$t['id']);
        if (!empty($in['pin_orga']) || !empty($in['pin_table'])) db()->prepare("DELETE FROM " . T('sessions') . " WHERE tournament_id = ?")->execute([(int)$t['id']]);
        json_out(['ok' => true]);
    }

    case 'admin_delete': {
        require_role($sess, ['admin']);
        $t = load_tournament(in_int($in, 'id', 0));
        if (normalize_key(in_str($in, 'confirm_key', 20)) !== $t['tkey']) fail('Clé de confirmation incorrecte.', 'bad_input');
        foreach (['competitors', 'pools', 'live', 'results', 'sessions'] as $tb) db()->prepare("DELETE FROM " . T($tb) . " WHERE tournament_id = ?")->execute([(int)$t['id']]);
        db()->prepare("DELETE FROM " . T('tournaments') . " WHERE id = ?")->execute([(int)$t['id']]);
        json_out(['ok' => true]);
    }

    case 'admin_enter': {
        require_role($sess, ['admin']);
        $t = load_tournament(in_int($in, 'id', 0));
        json_out(['ok' => true, 'token' => open_session((int)$t['id'], 'orga'), 'key' => $t['tkey']]);
    }

    case 'admin_password': {
        require_role($sess, ['admin']);
        $p = (string)($in['password'] ?? '');
        if (mb_strlen($p) < 8) fail('Le mot de passe doit contenir au moins 8 caractères.', 'bad_input');
        meta_set('admin_hash', password_hash($p, PASSWORD_DEFAULT));
        json_out(['ok' => true]);
    }
    }

    /* ---------- actions liées à un tournoi (organisateur / table) ---------- */
    $s = require_role($sess, ['orga', 'table']);
    $t = load_tournament((int)$s['tournament_id']);
    $tid = (int)$t['id'];
    $role = $s['role'];
    $myTatami = $s['tatami'] === null ? null : (int)$s['tatami'];

    switch ($action) {

    case 'sync':
        json_out(sync_payload($t, (int)($in['since'] ?? 0), $role, $myTatami));

    case 'pool_save': {
        require_writable($t);
        $pool = $in['pool'] ?? null;
        if (!is_array($pool)) fail('Pool manquant.', 'bad_input');
        if ($role === 'table') {
            $st = db()->prepare("SELECT tatami, data FROM " . T('pools') . " WHERE tournament_id = ? AND id = ? AND deleted = 0");
            $st->execute([$tid, (string)($pool['id'] ?? '')]);
            $cur = $st->fetch();
            if (!$cur) fail("Ce pool n'existe plus.", 'not_found', 404);
            if ((int)$cur['tatami'] !== $myTatami) fail("Ce pool n'est pas attribué à votre tatami.", 'forbidden', 403);
            // la table ne peut pas changer la définition du pool, seulement son déroulement
            $old = json_decode($cur['data'], true) ?: [];
            foreach (['name', 'type', 'mode', 'ranking', 'format', 'repechage', 'criteria', 'memberIds', 'tatami', 'sort'] as $k)
                if (array_key_exists($k, $old)) $pool[$k] = $old[$k];
        }
        $r = save_pool($tid, $pool, isset($in['baseVersion']) ? (int)$in['baseVersion'] : null, !empty($in['force']) && $role === 'orga');
        if (!empty($in['results']) && is_array($in['results'])) log_results($tid, $in['results'], $role === 'table' ? $myTatami : (isset($pool['tatami']) ? (int)$pool['tatami'] : null));
        json_out(['ok' => true] + $r);
    }

    case 'live_push': {
        if ($t['status'] !== 'active') json_out(['ok' => true]);
        $tat = $role === 'table' ? $myTatami : in_int($in, 'tatami', 0);
        if (!$tat || $tat < 1 || $tat > (int)$t['tatamis']) fail('Tatami invalide.', 'bad_input');
        $data = $in['state'] ?? null;
        if (!is_array($data)) fail('État manquant.', 'bad_input');
        // on ne garde que ce qui sert à l'affichage public
        $keep = array_intersect_key($data, array_flip(['mode', 'aka', 'ao', 'winner', 'timer', 'phase', 'screen', 'category', 'poolId', 'poolName', 'matchLabel', 'remainingAtPush', 'online']));
        db()->prepare("INSERT INTO " . T('live') . " (tournament_id, tatami, data, updated_ms) VALUES (?,?,?,?) ON DUPLICATE KEY UPDATE data = VALUES(data), updated_ms = VALUES(updated_ms)")
            ->execute([$tid, $tat, json_encode($keep, JSON_UNESCAPED_UNICODE), now_ms()]);
        json_out(['ok' => true, 'now' => now_ms()]);
    }
    }

    /* ---------- organisateur uniquement ---------- */
    require_role($s, ['orga']);

    switch ($action) {

    case 'tournament_update': {
        require_writable($t);
        $f = []; $a = [];
        foreach (['name' => 200, 'place' => 200] as $k => $max) if (isset($in[$k])) { $f[] = "$k = ?"; $a[] = in_str($in, $k, $max); }
        if (isset($in['tatamis'])) { $f[] = 'tatamis = ?'; $a[] = max(1, min(20, in_int($in, 'tatamis', 1))); }
        if (isset($in['settings']) && is_array($in['settings'])) { $f[] = 'settings = ?'; $a[] = json_encode($in['settings'], JSON_UNESCAPED_UNICODE); }
        if ($f) { $a[] = $tid; db()->prepare("UPDATE " . T('tournaments') . " SET " . implode(', ', $f) . " WHERE id = ?")->execute($a); }
        json_out(['ok' => true, 'rev' => bump_rev($tid)]);
    }

    case 'comp_save': {
        require_writable($t);
        $items = $in['items'] ?? [];
        if (!is_array($items) || count($items) > 5000) fail('Liste invalide.', 'bad_input');
        $pdo = db(); $pdo->beginTransaction();
        $rev = upsert_competitors($tid, $items);
        $pdo->commit();
        json_out(['ok' => true, 'rev' => $rev]);
    }

    case 'comp_delete': {
        require_writable($t);
        $ids = $in['ids'] ?? [];
        if (!is_array($ids)) fail('Liste invalide.', 'bad_input');
        $rev = bump_rev($tid);
        $st = db()->prepare("UPDATE " . T('competitors') . " SET deleted = 1, rev = ?, updated_at = ? WHERE tournament_id = ? AND id = ?");
        foreach ($ids as $id) $st->execute([$rev, now_sql(), $tid, (string)$id]);
        json_out(['ok' => true, 'rev' => $rev]);
    }

    case 'pool_delete': {
        require_writable($t);
        $rev = bump_rev($tid);
        db()->prepare("UPDATE " . T('pools') . " SET deleted = 1, rev = ?, updated_at = ?, version = version + 1 WHERE tournament_id = ? AND id = ?")
            ->execute([$rev, now_sql(), $tid, in_str($in, 'id', 24)]);
        json_out(['ok' => true, 'rev' => $rev]);
    }

    case 'history': {
        $st = db()->prepare("SELECT pool_id, pool_name, label, tatami, aka, aka_dojo, ao, ao_dojo, score_aka, score_ao, winner, detail, created_at
                             FROM " . T('results') . " WHERE tournament_id = ? ORDER BY id DESC LIMIT 2000");
        $st->execute([$tid]);
        json_out(['ok' => true, 'results' => $st->fetchAll()]);
    }

    case 'export': {
        $p = sync_payload($t, 0, 'orga', null);
        $st = db()->prepare("SELECT * FROM " . T('results') . " WHERE tournament_id = ? ORDER BY id");
        $st->execute([$tid]);
        json_out(['ok' => true, 'backup' => ['app' => 'affichage-kumite', 'version' => 2, 'date' => gmdate('c'),
            'tournament' => $p['tournament'], 'competitors' => $p['competitors'], 'pools' => array_map(fn($x) => $x['data'], $p['pools']),
            'results' => $st->fetchAll()]]);
    }

    case 'import': {
        require_writable($t);
        $comps = $in['competitors'] ?? []; $pools = $in['pools'] ?? [];
        if (!is_array($comps) || !is_array($pools)) fail('Sauvegarde invalide.', 'bad_input');
        $pdo = db(); $pdo->beginTransaction();
        $rev = bump_rev($tid);
        $pdo->prepare("UPDATE " . T('competitors') . " SET deleted = 1, rev = ? WHERE tournament_id = ?")->execute([$rev, $tid]);
        $pdo->prepare("UPDATE " . T('pools') . " SET deleted = 1, rev = ?, version = version + 1 WHERE tournament_id = ?")->execute([$rev, $tid]);
        upsert_competitors($tid, $comps);
        foreach ($pools as $pl) if (is_array($pl)) save_pool($tid, $pl, null, true);
        $pdo->commit();
        json_out(['ok' => true]);
    }

    default:
        fail('Action inconnue : ' . $action, 'unknown_action', 404);
    }

} catch (ApiError $e) {
    if (db_in_tx()) db()->rollBack();
    json_out(['ok' => false, 'error' => $e->getMessage(), 'code' => $e->codeName] + $e->extra, $e->http);
} catch (Throwable $e) {
    if (db_in_tx()) db()->rollBack();
    error_log('[kumite] ' . $e->getMessage() . ' @ ' . $e->getFile() . ':' . $e->getLine());
    json_out(['ok' => false, 'error' => 'Erreur interne du serveur.', 'code' => 'internal'], 500);
}

function db_in_tx(): bool {
    try { return db()->inTransaction(); } catch (Throwable $e) { return false; }
}

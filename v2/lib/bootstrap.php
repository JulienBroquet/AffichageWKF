<?php
/* Affichage Kumite V2 – connexion à la base, schéma et fonctions communes */
declare(strict_types=1);

const APP_VERSION = '2.0.0';
const KEY_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';   // sans 0/O, 1/I pour éviter les confusions

function app_config(): array {
    static $cfg = null;
    if ($cfg !== null) return $cfg;
    $file = dirname(__DIR__) . '/config.php';
    if (!is_file($file)) throw new RuntimeException('config_missing');
    $cfg = array_merge(['db_prefix' => 'kt_', 'session_hours' => 72, 'timezone' => 'Europe/Zurich', 'db_port' => 3306], require $file);
    date_default_timezone_set($cfg['timezone']);
    return $cfg;
}

function db(): PDO {
    static $pdo = null;
    if ($pdo) return $pdo;
    $c = app_config();
    $dsn = "mysql:host={$c['db_host']};port={$c['db_port']};dbname={$c['db_name']};charset=utf8mb4";
    $pdo = new PDO($dsn, $c['db_user'], $c['db_pass'], [
        PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
        PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
        PDO::ATTR_EMULATE_PREPARES => false,
    ]);
    $pdo->exec("SET time_zone = '+00:00'");
    return $pdo;
}

function T(string $name): string { return app_config()['db_prefix'] . $name; }

function schema_sql(): array {
    $e = 'ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci';
    return [
        "CREATE TABLE IF NOT EXISTS " . T('meta') . " (
            k VARCHAR(64) NOT NULL PRIMARY KEY,
            v TEXT NOT NULL
        ) $e",
        "CREATE TABLE IF NOT EXISTS " . T('tournaments') . " (
            id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
            tkey CHAR(9) NOT NULL,
            name VARCHAR(200) NOT NULL,
            tdate DATE NULL,
            place VARCHAR(200) NOT NULL DEFAULT '',
            tatamis TINYINT UNSIGNED NOT NULL DEFAULT 1,
            pin_orga VARCHAR(255) NOT NULL,
            pin_table VARCHAR(255) NOT NULL,
            settings MEDIUMTEXT NULL,
            status VARCHAR(16) NOT NULL DEFAULT 'active',
            rev BIGINT UNSIGNED NOT NULL DEFAULT 0,
            created_at DATETIME NOT NULL,
            updated_at DATETIME NOT NULL,
            UNIQUE KEY uk_tkey (tkey)
        ) $e",
        "CREATE TABLE IF NOT EXISTS " . T('competitors') . " (
            tournament_id INT UNSIGNED NOT NULL,
            id VARCHAR(24) NOT NULL,
            name VARCHAR(200) NOT NULL,
            dojo VARCHAR(200) NOT NULL DEFAULT '',
            sex CHAR(1) NOT NULL DEFAULT '',
            age SMALLINT NULL,
            weight DECIMAL(5,1) NULL,
            grade TINYINT NULL,
            category VARCHAR(120) NOT NULL DEFAULT '',
            deleted TINYINT(1) NOT NULL DEFAULT 0,
            rev BIGINT UNSIGNED NOT NULL DEFAULT 0,
            updated_at DATETIME NOT NULL,
            PRIMARY KEY (tournament_id, id),
            KEY k_rev (tournament_id, rev)
        ) $e",
        "CREATE TABLE IF NOT EXISTS " . T('pools') . " (
            tournament_id INT UNSIGNED NOT NULL,
            id VARCHAR(24) NOT NULL,
            name VARCHAR(200) NOT NULL DEFAULT '',
            tatami TINYINT UNSIGNED NULL,
            sort INT NOT NULL DEFAULT 0,
            data MEDIUMTEXT NOT NULL,
            version INT UNSIGNED NOT NULL DEFAULT 1,
            deleted TINYINT(1) NOT NULL DEFAULT 0,
            rev BIGINT UNSIGNED NOT NULL DEFAULT 0,
            updated_at DATETIME NOT NULL,
            PRIMARY KEY (tournament_id, id),
            KEY k_rev (tournament_id, rev)
        ) $e",
        "CREATE TABLE IF NOT EXISTS " . T('live') . " (
            tournament_id INT UNSIGNED NOT NULL,
            tatami TINYINT UNSIGNED NOT NULL,
            data MEDIUMTEXT NOT NULL,
            updated_ms BIGINT UNSIGNED NOT NULL,
            PRIMARY KEY (tournament_id, tatami)
        ) $e",
        "CREATE TABLE IF NOT EXISTS " . T('results') . " (
            id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
            tournament_id INT UNSIGNED NOT NULL,
            rid VARCHAR(40) NOT NULL,
            pool_id VARCHAR(24) NOT NULL,
            pool_name VARCHAR(200) NOT NULL DEFAULT '',
            label VARCHAR(120) NOT NULL DEFAULT '',
            tatami TINYINT UNSIGNED NULL,
            aka VARCHAR(200) NOT NULL DEFAULT '',
            aka_dojo VARCHAR(200) NOT NULL DEFAULT '',
            ao VARCHAR(200) NOT NULL DEFAULT '',
            ao_dojo VARCHAR(200) NOT NULL DEFAULT '',
            score_aka SMALLINT NOT NULL DEFAULT 0,
            score_ao SMALLINT NOT NULL DEFAULT 0,
            winner CHAR(3) NOT NULL DEFAULT '',
            detail TEXT NULL,
            created_at DATETIME NOT NULL,
            UNIQUE KEY uk_rid (tournament_id, rid),
            KEY k_t (tournament_id, created_at)
        ) $e",
        "CREATE TABLE IF NOT EXISTS " . T('sessions') . " (
            token CHAR(48) NOT NULL PRIMARY KEY,
            tournament_id INT UNSIGNED NULL,
            role VARCHAR(10) NOT NULL,
            tatami TINYINT UNSIGNED NULL,
            expires_at DATETIME NOT NULL,
            created_at DATETIME NOT NULL,
            KEY k_exp (expires_at)
        ) $e",
        "CREATE TABLE IF NOT EXISTS " . T('attempts') . " (
            id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
            ip VARCHAR(64) NOT NULL,
            at DATETIME NOT NULL,
            KEY k_ip (ip, at)
        ) $e",
    ];
}

function install_schema(): void {
    foreach (schema_sql() as $sql) db()->exec($sql);
    meta_set('schema_version', '1');
}

function meta_get(string $k): ?string {
    $st = db()->prepare("SELECT v FROM " . T('meta') . " WHERE k = ?");
    $st->execute([$k]);
    $v = $st->fetchColumn();
    return $v === false ? null : (string)$v;
}
function meta_set(string $k, string $v): void {
    db()->prepare("INSERT INTO " . T('meta') . " (k, v) VALUES (?, ?) ON DUPLICATE KEY UPDATE v = VALUES(v)")->execute([$k, $v]);
}

function now_sql(): string { return gmdate('Y-m-d H:i:s'); }
function now_ms(): int { return (int)floor(microtime(true) * 1000); }

function new_token(): string { return bin2hex(random_bytes(24)); }

function new_tournament_key(): string {
    for ($tries = 0; $tries < 50; $tries++) {
        $s = '';
        for ($i = 0; $i < 8; $i++) $s .= KEY_ALPHABET[random_int(0, strlen(KEY_ALPHABET) - 1)];
        $key = substr($s, 0, 4) . '-' . substr($s, 4);
        $st = db()->prepare("SELECT 1 FROM " . T('tournaments') . " WHERE tkey = ?");
        $st->execute([$key]);
        if (!$st->fetchColumn()) return $key;
    }
    throw new RuntimeException('key_generation_failed');
}

function normalize_key(string $k): string {
    $k = strtoupper(preg_replace('/[^A-Za-z0-9]/', '', $k));
    return strlen($k) === 8 ? substr($k, 0, 4) . '-' . substr($k, 4) : $k;
}

/* incrémente la révision d'un tournoi et la renvoie (atomique) */
function bump_rev(int $tid): int {
    $pdo = db();
    $pdo->prepare("UPDATE " . T('tournaments') . " SET rev = LAST_INSERT_ID(rev + 1), updated_at = ? WHERE id = ?")->execute([now_sql(), $tid]);
    return (int)$pdo->query("SELECT LAST_INSERT_ID()")->fetchColumn();
}

function client_ip(): string { return substr($_SERVER['REMOTE_ADDR'] ?? '0.0.0.0', 0, 64); }

/* limite de tentatives de connexion : 10 échecs / 15 minutes / IP */
function check_rate_limit(): void {
    db()->prepare("DELETE FROM " . T('attempts') . " WHERE at < ?")->execute([gmdate('Y-m-d H:i:s', time() - 3600)]);
    $st = db()->prepare("SELECT COUNT(*) FROM " . T('attempts') . " WHERE ip = ? AND at > ?");
    $st->execute([client_ip(), gmdate('Y-m-d H:i:s', time() - 900)]);
    if ((int)$st->fetchColumn() >= 10) fail('Trop de tentatives. Réessayez dans 15 minutes.', 'rate_limited', 429);
}
function record_failure(): void {
    db()->prepare("INSERT INTO " . T('attempts') . " (ip, at) VALUES (?, ?)")->execute([client_ip(), now_sql()]);
}

class ApiError extends Exception {
    public string $codeName; public int $http; public array $extra;
    public function __construct(string $msg, string $code = 'error', int $http = 400, array $extra = []) {
        parent::__construct($msg); $this->codeName = $code; $this->http = $http; $this->extra = $extra;
    }
}
function fail(string $msg, string $code = 'error', int $http = 400, array $extra = []): never {
    throw new ApiError($msg, $code, $http, $extra);
}

function json_out(array $data, int $http = 200): never {
    http_response_code($http);
    header('Content-Type: application/json; charset=utf-8');
    header('Cache-Control: no-store');
    echo json_encode($data, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    exit;
}

-- iQPanel database schema
-- Tables are created with IF NOT EXISTS so this file is idempotent.
-- Structural changes go into numbered migration files.

CREATE TABLE IF NOT EXISTS sites (
  id             TEXT    PRIMARY KEY,
  name           TEXT    NOT NULL,
  slug           TEXT    NOT NULL UNIQUE,
  type           TEXT    NOT NULL CHECK(type IN ('laravel','php','node','static','docker')),
  repo_url       TEXT,
  deploy_key_pub TEXT,
  domain         TEXT,
  port           INTEGER,
  php_version    TEXT    NOT NULL DEFAULT '8.3',
  webserver      TEXT    NOT NULL DEFAULT 'nginx',
  ssl_status     TEXT    NOT NULL DEFAULT 'none',
  ssl_expires_at TEXT,
  run_as_user    TEXT    NOT NULL DEFAULT '',
  directory      TEXT    NOT NULL DEFAULT '',
  status         TEXT    NOT NULL DEFAULT 'provisioning'
                         CHECK(status IN ('provisioning','online','offline','error')),
  deploy_branch  TEXT    NOT NULL DEFAULT 'main',
  webhook_secret TEXT    NOT NULL DEFAULT '',
  server_id      TEXT    NOT NULL DEFAULT 'local',
  created_at     TEXT    NOT NULL,
  updated_at     TEXT    NOT NULL
);

CREATE TABLE IF NOT EXISTS site_deploy_steps (
  id              TEXT    PRIMARY KEY,
  site_id         TEXT    NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
  position        INTEGER NOT NULL DEFAULT 0,
  cmd             TEXT    NOT NULL,
  first_only      INTEGER NOT NULL DEFAULT 0,
  enabled         INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS deployments (
  id           TEXT    PRIMARY KEY,
  site_id      TEXT    NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
  commit_sha   TEXT,
  commit_msg   TEXT,
  status       TEXT    NOT NULL CHECK(status IN ('queued','running','success','failed')),
  log_path     TEXT,
  triggered_by TEXT    NOT NULL DEFAULT 'admin',
  created_at   TEXT    NOT NULL,
  finished_at  TEXT
);

CREATE TABLE IF NOT EXISTS webhook_deliveries (
  id          TEXT PRIMARY KEY,
  site_id     TEXT NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
  delivery_id TEXT NOT NULL UNIQUE,
  created_at  TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS databases (
  id           TEXT PRIMARY KEY,
  site_id      TEXT REFERENCES sites(id) ON DELETE CASCADE,
  engine       TEXT NOT NULL CHECK(engine IN ('mysql','mariadb','postgres')),
  db_name      TEXT NOT NULL UNIQUE,
  db_user      TEXT NOT NULL,
  db_pass_enc  TEXT NOT NULL DEFAULT '',
  granted      INTEGER NOT NULL DEFAULT 0,
  created_at   TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS cron_jobs (
  id          TEXT    PRIMARY KEY,
  site_id     TEXT    REFERENCES sites(id) ON DELETE CASCADE,
  run_as_user TEXT    NOT NULL DEFAULT 'www-data',
  schedule    TEXT    NOT NULL,
  command     TEXT    NOT NULL,
  enabled     INTEGER NOT NULL DEFAULT 1,
  created_at  TEXT    NOT NULL
);

CREATE TABLE IF NOT EXISTS systemd_units (
  id          TEXT    PRIMARY KEY,
  site_id     TEXT    NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
  unit_name   TEXT    NOT NULL UNIQUE,
  template    TEXT    NOT NULL,
  config      TEXT    NOT NULL DEFAULT '{}',
  status      TEXT    NOT NULL DEFAULT 'stopped',
  created_at  TEXT    NOT NULL
);

CREATE TABLE IF NOT EXISTS backups (
  id          TEXT    PRIMARY KEY,
  site_id     TEXT    NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
  path        TEXT,
  size        INTEGER NOT NULL DEFAULT 0,
  status      TEXT    NOT NULL DEFAULT 'queued'
                      CHECK(status IN ('queued','running','done','failed')),
  created_at  TEXT    NOT NULL
);

CREATE TABLE IF NOT EXISTS users (
  id                       TEXT    PRIMARY KEY,
  email                    TEXT    NOT NULL UNIQUE,
  name                     TEXT    NOT NULL,
  role                     TEXT    NOT NULL
                                   CHECK(role IN ('owner','admin','operator','readonly')),
  password_hash            TEXT    NOT NULL,
  password_salt            TEXT    NOT NULL,
  totp_secret_enc          TEXT    NOT NULL DEFAULT '',
  totp_enabled             INTEGER NOT NULL DEFAULT 0,
  backup_codes_enc         TEXT    NOT NULL DEFAULT '',
  failed_login             INTEGER NOT NULL DEFAULT 0,
  locked_until             TEXT,
  created_at               TEXT    NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
  token        TEXT    PRIMARY KEY,
  user_id      TEXT    REFERENCES users(id) ON DELETE CASCADE,
  reauth_until INTEGER NOT NULL DEFAULT 0,
  expires      INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS command_runs (
  id          TEXT    PRIMARY KEY,
  site_id     TEXT    REFERENCES sites(id) ON DELETE CASCADE,
  user_id     TEXT    REFERENCES users(id) ON DELETE SET NULL,
  cmd         TEXT    NOT NULL,
  exit_code   INTEGER,
  log_path    TEXT,
  created_at  TEXT    NOT NULL
);

CREATE TABLE IF NOT EXISTS jobs (
  id           TEXT    PRIMARY KEY,
  type         TEXT    NOT NULL,
  payload      TEXT    NOT NULL DEFAULT '{}',
  status       TEXT    NOT NULL DEFAULT 'queued'
                       CHECK(status IN ('queued','running','done','failed')),
  attempts     INTEGER NOT NULL DEFAULT 0,
  max_attempts INTEGER NOT NULL DEFAULT 3,
  last_error   TEXT    NOT NULL DEFAULT '',
  run_after    TEXT    NOT NULL,
  created_at   TEXT    NOT NULL,
  updated_at   TEXT    NOT NULL
);

CREATE TABLE IF NOT EXISTS audit_log (
  id         TEXT    PRIMARY KEY,
  user_id    TEXT    REFERENCES users(id) ON DELETE SET NULL,
  action     TEXT    NOT NULL,
  target     TEXT    NOT NULL DEFAULT '',
  detail     TEXT    NOT NULL DEFAULT '{}',
  ip         TEXT,
  created_at TEXT    NOT NULL
);

CREATE TABLE IF NOT EXISTS settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS alert_config (
  id          TEXT    PRIMARY KEY,
  channel     TEXT    NOT NULL,
  webhook_enc TEXT    NOT NULL DEFAULT '',
  cpu_pct     REAL    NOT NULL DEFAULT 90,
  mem_pct     REAL    NOT NULL DEFAULT 90,
  disk_pct    REAL    NOT NULL DEFAULT 85,
  enabled     INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS metrics_history (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  cpu_pct    REAL,
  mem_pct    REAL,
  disk_pct   REAL,
  load_1     REAL,
  ts         INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_sessions_expires    ON sessions(expires);
CREATE INDEX IF NOT EXISTS idx_jobs_status         ON jobs(status, run_after);
CREATE INDEX IF NOT EXISTS idx_deployments_site    ON deployments(site_id, created_at);
CREATE INDEX IF NOT EXISTS idx_audit_created       ON audit_log(created_at);
CREATE INDEX IF NOT EXISTS idx_metrics_ts          ON metrics_history(ts);

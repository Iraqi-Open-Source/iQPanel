CREATE TABLE IF NOT EXISTS deployment_steps (
  id            TEXT    PRIMARY KEY,
  deployment_id TEXT    NOT NULL REFERENCES deployments(id) ON DELETE CASCADE,
  position      INTEGER NOT NULL DEFAULT 0,
  name          TEXT    NOT NULL,
  cmd           TEXT    NOT NULL DEFAULT '',
  status        TEXT    NOT NULL DEFAULT 'pending'
                        CHECK(status IN ('pending','running','success','failed','skipped')),
  exit_code     INTEGER,
  output        TEXT    NOT NULL DEFAULT '',
  started_at    TEXT,
  finished_at   TEXT
);

CREATE INDEX IF NOT EXISTS idx_deployment_steps_deploy ON deployment_steps(deployment_id, position);

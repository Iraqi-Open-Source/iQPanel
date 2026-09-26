CREATE TABLE IF NOT EXISTS cloudflare_dns_records (
  id             TEXT    PRIMARY KEY,
  site_id        TEXT    REFERENCES sites(id) ON DELETE SET NULL,
  zone_id        TEXT    NOT NULL,
  zone_name      TEXT    NOT NULL,
  record_id      TEXT    NOT NULL,
  record_type    TEXT    NOT NULL DEFAULT 'A',
  record_name    TEXT    NOT NULL,
  record_content TEXT    NOT NULL,
  proxied        INTEGER NOT NULL DEFAULT 1,
  created_at     TEXT    NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_cf_dns_site ON cloudflare_dns_records(site_id);
CREATE INDEX IF NOT EXISTS idx_cf_dns_zone ON cloudflare_dns_records(zone_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_cf_dns_record ON cloudflare_dns_records(record_id);

CREATE TABLE IF NOT EXISTS downloads (
  platform TEXT,
  module TEXT,
  total INTEGER,
  year_month TEXT
);

-- CREATE TABLE IF NOT EXISTS manifest (
--   platform TEXT,
--   module TEXT,
--   total INTEGER,
--   year_month TEXT
-- );

CREATE TABLE IF NOT EXISTS manifests (
  module TEXT,
  data TEXT
);

-- requires the a row inserted before updates can occur
-- INSERT OR IGNORE INTO manifests (module, data) VALUES ('terminal', '{\"ok\": 123}')

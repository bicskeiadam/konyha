-- Shared family collection. Every row belongs to one family (hash of its private code).
-- tipus: 'recept' | 'hozzavalo' (her own ingredient) | 'feluliras' (corrected values) | 'kep' (photo, data URL)
CREATE TABLE IF NOT EXISTS elemek (
  csalad TEXT NOT NULL,
  tipus TEXT NOT NULL,
  id TEXT NOT NULL,
  adat TEXT,
  torolve INTEGER NOT NULL DEFAULT 0,
  letrehozta TEXT,
  letrehozva INTEGER,
  modositotta TEXT,
  modositva INTEGER NOT NULL,
  PRIMARY KEY (csalad, tipus, id)
);
CREATE INDEX IF NOT EXISTS elemek_modositva ON elemek (csalad, modositva);

-- Activity log: "Anna hozzáadta: Proteines brownie".
CREATE TABLE IF NOT EXISTS naplo (
  csalad TEXT NOT NULL,
  ido INTEGER NOT NULL,
  ki TEXT,
  mit TEXT NOT NULL,
  tipus TEXT NOT NULL,
  elem_id TEXT,
  cimke TEXT
);
CREATE INDEX IF NOT EXISTS naplo_ido ON naplo (csalad, ido);

-- Families made from the app (codes in the CSALAD_KODOK secret work without a row here).
CREATE TABLE IF NOT EXISTS csaladok (
  csalad TEXT PRIMARY KEY,
  letrehozva INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS csaladok_ido ON csaladok (letrehozva);

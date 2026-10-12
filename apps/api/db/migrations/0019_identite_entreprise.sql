-- Identité légale de l'entreprise : imprimée sur les factures, proformas et reçus, et reprise dans les
-- mentions légales du site. Les valeurs vides sont à compléter dans le back-office (Réglages).
INSERT INTO settings (key, value) VALUES
  ('company.legal_name',           '"GROUPIREX"'),
  ('company.legal_form',           '""'),
  ('company.capital',              '""'),
  ('company.address',              '""'),
  ('company.rccm',                 '""'),
  ('company.tax_id',               '""'),
  ('company.phone',                '""'),
  ('company.email',                '""'),
  ('company.publication_director', '""'),
  ('company.host',                 '""')
ON CONFLICT (key) DO NOTHING;

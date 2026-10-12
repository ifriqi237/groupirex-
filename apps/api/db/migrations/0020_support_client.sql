-- Coordonnées du support client, affichées sur la page Support du site.
-- Modifiables dans le back-office (Réglages → Support client). Un champ vide masque le moyen de contact.
INSERT INTO settings (key, value) VALUES
  ('support.email',    '"support@groupirex.com"'),
  ('support.phone',    '"+237 621 730 350"'),
  ('support.whatsapp', '"+237 621 730 350"')
ON CONFLICT (key) DO NOTHING;

-- Les mentions légales reprennent ces coordonnées tant que l'entreprise n'en a pas saisi d'autres.
UPDATE settings SET value = '"support@groupirex.com"' WHERE key = 'company.email' AND value = '""';
UPDATE settings SET value = '"+237 621 730 350"' WHERE key = 'company.phone' AND value = '""';

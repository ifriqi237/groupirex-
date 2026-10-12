-- Sécurité (alerte Supabase « Function Search Path Mutable ») : ces deux fonctions de déclencheur
-- n'utilisent que NEW, now() et RAISE. On fige leur chemin de recherche sur pg_catalog pour qu'aucun
-- objet du même nom, créé dans un autre schéma, ne puisse se substituer à ceux du système.
ALTER FUNCTION set_updated_at() SET search_path = pg_catalog;
ALTER FUNCTION audit_logs_immutable() SET search_path = pg_catalog;

-- Ciblage géographique des campagnes.
--
-- geographic_scope :
--   INTERNATIONAL : tous les pays actifs où le produit est livré (comportement des
--                   campagnes existantes, qui gardent donc exactement leur visibilité) ;
--   NATIONAL      : un seul pays, listé dans group_deal_countries ;
--   MULTI_COUNTRY : plusieurs pays, listés dans group_deal_countries.
-- Une campagne internationale n'a AUCUNE ligne dans group_deal_countries : la règle
-- « pays actifs + produit livré » s'applique, sans dupliquer la liste des pays.
--
-- goal_scope :
--   GLOBAL      : un objectif commun (target_quantity de la campagne) ;
--   PER_COUNTRY : chaque pays a son objectif (group_deal_countries.target_quantity) ;
--                 target_quantity de la campagne vaut alors leur somme.
-- Retour arrière : db/rollback/0023_ciblage_geographique.down.sql

ALTER TABLE group_deals
  ADD COLUMN geographic_scope TEXT NOT NULL DEFAULT 'INTERNATIONAL'
    CHECK (geographic_scope IN ('NATIONAL', 'MULTI_COUNTRY', 'INTERNATIONAL')),
  ADD COLUMN goal_scope TEXT NOT NULL DEFAULT 'GLOBAL'
    CHECK (goal_scope IN ('GLOBAL', 'PER_COUNTRY'));

CREATE TABLE group_deal_countries (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  deal_id         UUID NOT NULL REFERENCES group_deals(id) ON DELETE CASCADE,
  country_code    CHAR(2) NOT NULL REFERENCES countries(code),
  target_quantity INTEGER CHECK (target_quantity IS NULL OR target_quantity > 0),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (deal_id, country_code)
);
-- « Quelles campagnes sont ouvertes dans ce pays ? » : la question posée à chaque page du catalogue.
CREATE INDEX group_deal_countries_country_idx ON group_deal_countries (country_code, deal_id);
CREATE INDEX group_deals_geographic_scope_idx ON group_deals (geographic_scope) WHERE geographic_scope <> 'INTERNATIONAL';
-- Suivi des objectifs par pays.
CREATE INDEX IF NOT EXISTS orders_deal_country_idx ON orders (deal_id, country_code);

-- Pays de référence du client : date du dernier changement, pour limiter les changements répétés.
ALTER TABLE users ADD COLUMN country_changed_at TIMESTAMPTZ;

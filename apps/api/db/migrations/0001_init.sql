-- GROUPDEALS — schéma initial (PostgreSQL 14+)
--
-- Conventions :
--   * tout montant est un BIGINT exprimé dans la plus petite unité de sa devise,
--     toujours accompagné de son code devise ;
--   * les règles qui ne doivent jamais être violées sont portées par des contraintes
--     (CHECK, UNIQUE, clés étrangères), pas seulement par le code ;
--   * les statuts sont des TEXT contrôlés par CHECK : plus simples à faire évoluer
--     que des types ENUM.

CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS citext;
CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE FUNCTION set_updated_at() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END $$;

-- ---------------------------------------------------------------------------
-- Référentiels : devises, taux, pays, langues, réglages
-- ---------------------------------------------------------------------------

CREATE TABLE currencies (
  code          CHAR(3) PRIMARY KEY,
  name          TEXT NOT NULL,
  symbol        TEXT NOT NULL,
  decimals      SMALLINT NOT NULL CHECK (decimals BETWEEN 0 AND 3),
  rounding_step INTEGER NOT NULL DEFAULT 1 CHECK (rounding_step >= 1),
  is_active     BOOLEAN NOT NULL DEFAULT true
);

-- Historique complet des taux : on n'écrase jamais, on ajoute.
-- Le taux courant d'une devise est la ligne la plus récente (as_of).
CREATE TABLE exchange_rates (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  currency_code CHAR(3) NOT NULL REFERENCES currencies(code),
  rate          NUMERIC(20,8) NOT NULL CHECK (rate > 0), -- unités de devise pour 1 unité de référence
  as_of         TIMESTAMPTZ NOT NULL,
  source        TEXT NOT NULL,
  created_by    UUID,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX exchange_rates_current_idx ON exchange_rates (currency_code, as_of DESC);

CREATE TABLE languages (
  code        TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  native_name TEXT NOT NULL,
  is_rtl      BOOLEAN NOT NULL DEFAULT false,
  is_active   BOOLEAN NOT NULL DEFAULT false,
  sort_order  INTEGER NOT NULL DEFAULT 0
);

-- Textes d'interface : ajouter une langue = ajouter des lignes, sans toucher au code.
CREATE TABLE translations (
  language_code TEXT NOT NULL REFERENCES languages(code) ON DELETE CASCADE,
  key           TEXT NOT NULL,
  value         TEXT NOT NULL,
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (language_code, key)
);

CREATE TABLE countries (
  code             CHAR(2) PRIMARY KEY,
  name             TEXT NOT NULL,
  i18n             JSONB NOT NULL DEFAULT '{}',
  currency_code    CHAR(3) NOT NULL REFERENCES currencies(code),
  phone_prefix     TEXT NOT NULL,
  default_language TEXT NOT NULL REFERENCES languages(code),
  fx_buffer_bps    INTEGER CHECK (fx_buffer_bps BETWEEN 0 AND 5000), -- NULL = réglage global
  is_active        BOOLEAN NOT NULL DEFAULT true
);

CREATE TABLE settings (
  key        TEXT PRIMARY KEY,
  value      JSONB NOT NULL,
  updated_by UUID,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- Utilisateurs, rôles, sessions
-- ---------------------------------------------------------------------------

CREATE TABLE users (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email                CITEXT NOT NULL UNIQUE,
  password_hash        TEXT NOT NULL,
  first_name           TEXT NOT NULL,
  last_name            TEXT NOT NULL,
  country_code         CHAR(2) NOT NULL REFERENCES countries(code),
  whatsapp             TEXT NOT NULL,
  avatar_url           TEXT,
  language_code        TEXT NOT NULL DEFAULT 'fr' REFERENCES languages(code),
  email_verified_at    TIMESTAMPTZ,
  whatsapp_verified_at TIMESTAMPTZ,
  totp_secret_enc      TEXT,          -- secret 2FA chiffré (AES-256-GCM), jamais en clair
  totp_enabled_at      TIMESTAMPTZ,
  status               TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','SUSPENDED','DELETED')),
  failed_login_count   INTEGER NOT NULL DEFAULT 0,
  locked_until         TIMESTAMPTZ,
  last_login_at        TIMESTAMPTZ,
  notification_prefs   JSONB NOT NULL DEFAULT '{"push":true,"email":true,"whatsapp":true}',
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX users_country_idx ON users (country_code);
CREATE INDEX users_name_trgm_idx ON users USING gin ((first_name || ' ' || last_name) gin_trgm_ops);
CREATE TRIGGER users_updated BEFORE UPDATE ON users FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE roles (
  code  TEXT PRIMARY KEY,
  label TEXT NOT NULL
);
CREATE TABLE permissions (
  code TEXT PRIMARY KEY
);
CREATE TABLE role_permissions (
  role_code       TEXT NOT NULL REFERENCES roles(code) ON DELETE CASCADE,
  permission_code TEXT NOT NULL REFERENCES permissions(code) ON DELETE CASCADE,
  PRIMARY KEY (role_code, permission_code)
);
CREATE TABLE user_roles (
  user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role_code  TEXT NOT NULL REFERENCES roles(code),
  granted_by UUID REFERENCES users(id),
  granted_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, role_code)
);

-- Jetons de rafraîchissement : stockés hachés, avec rotation. La réutilisation d'un
-- jeton déjà remplacé révoque toute sa famille (détection de vol).
CREATE TABLE refresh_tokens (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  family_id   UUID NOT NULL,
  token_hash  TEXT NOT NULL UNIQUE,
  expires_at  TIMESTAMPTZ NOT NULL,
  revoked_at  TIMESTAMPTZ,
  replaced_by UUID,
  mfa         BOOLEAN NOT NULL DEFAULT false,  -- double authentification validée pour cette session
  user_agent  TEXT,
  ip          INET,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX refresh_tokens_user_idx ON refresh_tokens (user_id);
CREATE INDEX refresh_tokens_family_idx ON refresh_tokens (family_id);

-- Jetons à usage unique : vérification d'email, mot de passe oublié, code WhatsApp.
CREATE TABLE auth_tokens (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind       TEXT NOT NULL CHECK (kind IN ('EMAIL_VERIFY','PASSWORD_RESET','WHATSAPP_OTP')),
  token_hash TEXT NOT NULL UNIQUE,
  expires_at TIMESTAMPTZ NOT NULL,
  used_at    TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX auth_tokens_user_idx ON auth_tokens (user_id, kind);

CREATE TABLE device_tokens (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token      TEXT NOT NULL UNIQUE,
  platform   TEXT NOT NULL CHECK (platform IN ('WEB','ANDROID','IOS')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- Catalogue
-- ---------------------------------------------------------------------------

CREATE TABLE categories (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  slug        TEXT NOT NULL UNIQUE,
  name        TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  icon        TEXT,
  image_url   TEXT,
  video_url   TEXT,
  sort_order  INTEGER NOT NULL DEFAULT 0,
  is_active   BOOLEAN NOT NULL DEFAULT true,
  i18n        JSONB NOT NULL DEFAULT '{}',   -- {"en": {"name": "...", "description": "..."}}
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at  TIMESTAMPTZ
);
CREATE TRIGGER categories_updated BEFORE UPDATE ON categories FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE products (
  id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  category_id            UUID NOT NULL REFERENCES categories(id),
  slug                   TEXT NOT NULL UNIQUE,
  name                   TEXT NOT NULL,
  description            TEXT NOT NULL DEFAULT '',
  features               JSONB NOT NULL DEFAULT '[]',  -- caractéristiques : ["...", "..."]
  specifications         JSONB NOT NULL DEFAULT '[]',  -- [{"label": "...", "value": "..."}]
  origin_country         TEXT,
  lead_time_days_min     INTEGER CHECK (lead_time_days_min >= 0),
  lead_time_days_max     INTEGER,
  sale_unit              TEXT NOT NULL DEFAULT 'UNIT' CHECK (sale_unit IN ('UNIT','LOT','CARTON','PALLET')),
  pieces_per_sale_unit   INTEGER NOT NULL DEFAULT 1 CHECK (pieces_per_sale_unit >= 1),
  moq                    INTEGER NOT NULL DEFAULT 1 CHECK (moq >= 1),
  max_per_order          INTEGER,
  -- Composants du prix : toujours conservés séparément (§17).
  base_price_amount      BIGINT NOT NULL CHECK (base_price_amount >= 0),
  base_price_currency    CHAR(3) NOT NULL REFERENCES currencies(code),
  compare_at_amount      BIGINT CHECK (compare_at_amount >= 0),  -- ancien prix barré, hors livraison
  supplier_cost_amount   BIGINT CHECK (supplier_cost_amount >= 0),
  supplier_cost_currency CHAR(3) REFERENCES currencies(code),
  is_active              BOOLEAN NOT NULL DEFAULT true,
  i18n                   JSONB NOT NULL DEFAULT '{}',
  created_by             UUID REFERENCES users(id),
  created_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at             TIMESTAMPTZ,
  CHECK (max_per_order IS NULL OR max_per_order >= moq),
  CHECK (lead_time_days_max IS NULL OR lead_time_days_min IS NULL OR lead_time_days_max >= lead_time_days_min),
  CHECK ((supplier_cost_amount IS NULL) = (supplier_cost_currency IS NULL))
);
CREATE INDEX products_category_idx ON products (category_id) WHERE deleted_at IS NULL;
CREATE INDEX products_name_trgm_idx ON products USING gin (name gin_trgm_ops);
CREATE TRIGGER products_updated BEFORE UPDATE ON products FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Variantes (taille, couleur…) : indispensables pour la mode.
CREATE TABLE product_variants (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id         UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  sku                TEXT NOT NULL UNIQUE,
  label              TEXT NOT NULL,                  -- "Noir / 42"
  attributes         JSONB NOT NULL DEFAULT '{}',    -- {"couleur": "Noir", "taille": "42"}
  price_delta_amount BIGINT NOT NULL DEFAULT 0,      -- écart sur le prix de base, même devise
  sort_order         INTEGER NOT NULL DEFAULT 0,
  is_active          BOOLEAN NOT NULL DEFAULT true
);
CREATE INDEX product_variants_product_idx ON product_variants (product_id);

CREATE TABLE product_media (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id    UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  kind          TEXT NOT NULL CHECK (kind IN ('IMAGE','VIDEO')),
  url           TEXT NOT NULL,
  thumbnail_url TEXT,           -- obligatoire en pratique pour les vidéos : jamais de vidéo pleine résolution en liste
  alt           TEXT NOT NULL DEFAULT '',
  sort_order    INTEGER NOT NULL DEFAULT 0,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX product_media_product_idx ON product_media (product_id, sort_order);

-- Pays où le produit est proposé.
CREATE TABLE product_countries (
  product_id   UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  country_code CHAR(2) NOT NULL REFERENCES countries(code),
  PRIMARY KEY (product_id, country_code)
);

-- Livraison par produit et par pays. Chaque tarif porte SA devise.
-- Historisé : un changement de tarif ferme la ligne courante et en ouvre une nouvelle.
CREATE TABLE shipping_rates (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id    UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  country_code  CHAR(2) NOT NULL REFERENCES countries(code),
  amount        BIGINT NOT NULL CHECK (amount >= 0),          -- facturé au client, par unité de vente
  currency_code CHAR(3) NOT NULL REFERENCES currencies(code),
  freight_cost  BIGINT NOT NULL DEFAULT 0 CHECK (freight_cost >= 0),  -- coût réel estimé (interne)
  customs_cost  BIGINT NOT NULL DEFAULT 0 CHECK (customs_cost >= 0),  -- droits et taxes estimés (interne)
  is_current    BOOLEAN NOT NULL DEFAULT true,
  created_by    UUID REFERENCES users(id),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  closed_at     TIMESTAMPTZ
);
CREATE UNIQUE INDEX shipping_rates_current_uq ON shipping_rates (product_id, country_code) WHERE is_current;

CREATE TABLE favorites (
  user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  product_id UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, product_id)
);

-- ---------------------------------------------------------------------------
-- Campagnes d'achat groupé
-- ---------------------------------------------------------------------------

CREATE TABLE group_deals (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id          UUID NOT NULL REFERENCES products(id),
  slug                TEXT NOT NULL UNIQUE,
  title               TEXT,
  -- Seules les décisions humaines sont stockées ; UPCOMING / ACTIVE / TARGET_REACHED /
  -- EXPIRED sont dérivés des dates et des quantités par le serveur.
  stored_status       TEXT NOT NULL DEFAULT 'DRAFT'
                      CHECK (stored_status IN ('DRAFT','PUBLISHED','COMPLETED','CANCELLED')),
  base_price_amount   BIGINT NOT NULL CHECK (base_price_amount >= 0),
  base_price_currency CHAR(3) NOT NULL REFERENCES currencies(code),
  compare_at_amount   BIGINT CHECK (compare_at_amount >= 0),
  target_quantity     INTEGER NOT NULL CHECK (target_quantity >= 1),
  min_quantity        INTEGER NOT NULL CHECK (min_quantity >= 1),   -- MOQ individuel
  max_per_order       INTEGER,
  max_quantity        INTEGER,                                      -- plafond de la campagne
  paid_quantity       INTEGER NOT NULL DEFAULT 0 CHECK (paid_quantity >= 0),
  held_quantity       INTEGER NOT NULL DEFAULT 0 CHECK (held_quantity >= 0),
  participants_count  INTEGER NOT NULL DEFAULT 0 CHECK (participants_count >= 0),
  starts_at           TIMESTAMPTZ NOT NULL,
  ends_at             TIMESTAMPTZ NOT NULL,
  is_featured         BOOLEAN NOT NULL DEFAULT false,
  ending_notified_at  TIMESTAMPTZ,   -- notification « bientôt terminée » déjà envoyée
  decided_at          TIMESTAMPTZ,
  decided_by          UUID REFERENCES users(id),
  cancel_reason       TEXT,
  created_by          UUID REFERENCES users(id),
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (ends_at > starts_at),
  CHECK (max_per_order IS NULL OR max_per_order >= min_quantity),
  CHECK (max_quantity IS NULL OR max_quantity >= target_quantity),
  -- Dernier rempart contre la survente : même un bug applicatif ne peut pas dépasser le plafond.
  CONSTRAINT group_deals_no_oversell CHECK (max_quantity IS NULL OR paid_quantity + held_quantity <= max_quantity)
);
CREATE INDEX group_deals_listing_idx ON group_deals (stored_status, ends_at);
CREATE INDEX group_deals_product_idx ON group_deals (product_id);
CREATE TRIGGER group_deals_updated BEFORE UPDATE ON group_deals FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE group_deal_participants (
  deal_id       UUID NOT NULL REFERENCES group_deals(id) ON DELETE CASCADE,
  user_id       UUID NOT NULL REFERENCES users(id),
  paid_quantity INTEGER NOT NULL DEFAULT 0 CHECK (paid_quantity >= 0),
  orders_count  INTEGER NOT NULL DEFAULT 0,
  joined_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (deal_id, user_id)
);

-- ---------------------------------------------------------------------------
-- Bureaux locaux
-- ---------------------------------------------------------------------------

CREATE TABLE local_offices (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  country_code  CHAR(2) NOT NULL REFERENCES countries(code),
  name          TEXT NOT NULL,
  city          TEXT NOT NULL,
  address       TEXT NOT NULL,
  phone         TEXT,
  whatsapp      TEXT,
  email         TEXT,
  opening_hours JSONB NOT NULL DEFAULT '{}',  -- {"mon": [["08:00","17:00"]], ...}
  timezone      TEXT NOT NULL DEFAULT 'Africa/Douala',
  latitude      NUMERIC(9,6) CHECK (latitude BETWEEN -90 AND 90),
  longitude     NUMERIC(9,6) CHECK (longitude BETWEEN -180 AND 180),
  accepts_payments BOOLEAN NOT NULL DEFAULT true,
  is_pickup_point  BOOLEAN NOT NULL DEFAULT true,
  is_active     BOOLEAN NOT NULL DEFAULT true,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX local_offices_country_idx ON local_offices (country_code, city) WHERE is_active;
CREATE TRIGGER local_offices_updated BEFORE UPDATE ON local_offices FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE local_office_agents (
  office_id  UUID NOT NULL REFERENCES local_offices(id) ON DELETE CASCADE,
  user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  position   TEXT NOT NULL CHECK (position IN ('MANAGER','AGENT')),
  is_active  BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (office_id, user_id)
);
CREATE INDEX local_office_agents_user_idx ON local_office_agents (user_id) WHERE is_active;

-- ---------------------------------------------------------------------------
-- Expéditions : une campagne × un pays de destination
-- ---------------------------------------------------------------------------

CREATE TABLE shipments (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  reference        TEXT NOT NULL UNIQUE,
  deal_id          UUID NOT NULL REFERENCES group_deals(id),
  country_code     CHAR(2) NOT NULL REFERENCES countries(code),
  current_step     SMALLINT NOT NULL DEFAULT 0 CHECK (current_step BETWEEN 0 AND 7),
  transport_mode   TEXT NOT NULL DEFAULT 'SEA' CHECK (transport_mode IN ('SEA','AIR','ROAD')),
  vessel_name      TEXT,
  vessel_imo       TEXT,
  container_number TEXT,
  bill_of_lading   TEXT,
  departure_port   TEXT,
  arrival_port     TEXT,
  eta              TIMESTAMPTZ,
  vessel_position  JSONB,   -- {latitude, longitude, progressPercent, updatedAt, source}
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (deal_id, country_code)
);
CREATE TRIGGER shipments_updated BEFORE UPDATE ON shipments FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ---------------------------------------------------------------------------
-- Commandes
-- ---------------------------------------------------------------------------

CREATE SEQUENCE order_number_seq;
CREATE SEQUENCE reservation_number_seq;
CREATE SEQUENCE invoice_number_seq;
CREATE SEQUENCE shipment_number_seq;

CREATE TABLE payment_methods (
  code               TEXT PRIMARY KEY CHECK (code IN ('ONLINE','OFFICE')),
  label              TEXT NOT NULL,
  is_active          BOOLEAN NOT NULL DEFAULT true,
  min_total_amount   BIGINT CHECK (min_total_amount >= 0),   -- seuil d'éligibilité (bureau : 500 000 XAF)
  min_total_currency CHAR(3) REFERENCES currencies(code),
  CHECK ((min_total_amount IS NULL) = (min_total_currency IS NULL))
);

CREATE TABLE orders (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  number           TEXT NOT NULL UNIQUE,                    -- GD-2026-00000125
  user_id          UUID NOT NULL REFERENCES users(id),
  deal_id          UUID NOT NULL REFERENCES group_deals(id),
  -- Le pays et la devise sont FIGÉS à la création : changer de pays dans son profil
  -- ne modifie jamais une commande existante.
  country_code     CHAR(2) NOT NULL REFERENCES countries(code),
  currency_code    CHAR(3) NOT NULL REFERENCES currencies(code),
  total_quantity   INTEGER NOT NULL CHECK (total_quantity >= 1),
  total_amount     BIGINT NOT NULL CHECK (total_amount >= 0),
  payment_method   TEXT NOT NULL REFERENCES payment_methods(code),
  payment_status   TEXT NOT NULL DEFAULT 'PENDING'
                   CHECK (payment_status IN ('PENDING','PAID','FAILED','EXPIRED','CANCELLED','REFUND_PENDING','REFUNDED')),
  tx_ref           TEXT NOT NULL UNIQUE,                    -- référence transmise au prestataire de paiement
  expires_at       TIMESTAMPTZ NOT NULL,                    -- date limite de paiement
  holds_quantity   BOOLEAN NOT NULL DEFAULT true,           -- vrai tant que la commande retient des quantités non payées
  paid_at          TIMESTAMPTZ,
  cancelled_at     TIMESTAMPTZ,
  cancel_reason    TEXT,
  -- Logistique : étapes 1 à 7 lues sur l'expédition ; 8 et 9 portées par la commande.
  shipment_id      UUID REFERENCES shipments(id),
  pickup_office_id UUID REFERENCES local_offices(id),
  pickup_step      SMALLINT NOT NULL DEFAULT 0 CHECK (pickup_step IN (0, 8, 9)),
  pickup_code      TEXT,                                    -- code remis au client pour le retrait
  picked_up_at     TIMESTAMPTZ,
  idempotency_key  TEXT,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (payment_status <> 'PAID' OR paid_at IS NOT NULL),
  UNIQUE (user_id, idempotency_key)
);
CREATE INDEX orders_user_idx ON orders (user_id, created_at DESC);
CREATE INDEX orders_deal_idx ON orders (deal_id, payment_status);
CREATE INDEX orders_shipment_idx ON orders (shipment_id);
CREATE INDEX orders_expiry_idx ON orders (expires_at) WHERE holds_quantity;
CREATE TRIGGER orders_updated BEFORE UPDATE ON orders FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Chaque ligne conserve l'INSTANTANÉ complet du calcul de prix (§17) :
-- la commande reste exacte même si le tarif, le taux ou le produit changent ensuite.
CREATE TABLE order_items (
  id                        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id                  UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  product_id                UUID NOT NULL REFERENCES products(id),
  variant_id                UUID REFERENCES product_variants(id),
  product_name              TEXT NOT NULL,
  variant_label             TEXT,
  sale_unit                 TEXT NOT NULL,
  pieces_per_sale_unit      INTEGER NOT NULL,
  quantity                  INTEGER NOT NULL CHECK (quantity >= 1),
  unit_final_amount         BIGINT NOT NULL CHECK (unit_final_amount >= 0),  -- seul prix montré au client
  line_total_amount         BIGINT NOT NULL,
  -- Composants internes
  base_source_amount        BIGINT NOT NULL,
  base_source_currency      CHAR(3) NOT NULL,
  base_converted_amount     BIGINT NOT NULL,
  shipping_source_amount    BIGINT NOT NULL,
  shipping_source_currency  CHAR(3) NOT NULL,
  shipping_converted_amount BIGINT NOT NULL,
  rounding_adjustment       BIGINT NOT NULL,
  fx_buffer_bps             INTEGER NOT NULL,
  reference_currency        CHAR(3) NOT NULL,
  rates_used                JSONB NOT NULL,   -- {"XAF": {"rate": "...", "asOf": "...", "source": "..."}}
  shipping_rate_id          UUID REFERENCES shipping_rates(id),
  estimated_unit_margin     BIGINT,
  computed_at               TIMESTAMPTZ NOT NULL,
  CHECK (line_total_amount = unit_final_amount * quantity),
  CHECK (unit_final_amount = base_converted_amount + shipping_converted_amount + rounding_adjustment)
);
CREATE INDEX order_items_order_idx ON order_items (order_id);

-- ---------------------------------------------------------------------------
-- Paiements
-- ---------------------------------------------------------------------------

CREATE TABLE payments (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id       UUID NOT NULL REFERENCES orders(id),
  provider       TEXT NOT NULL CHECK (provider IN ('FLUTTERWAVE','SANDBOX','OFFICE')),
  provider_tx_id TEXT,
  tx_ref         TEXT NOT NULL,
  status         TEXT NOT NULL CHECK (status IN ('INITIATED','SUCCESSFUL','FAILED','REJECTED','REFUND_REQUIRED','REFUNDED')),
  amount         BIGINT NOT NULL CHECK (amount >= 0),
  currency_code  CHAR(3) NOT NULL REFERENCES currencies(code),
  channel        TEXT,            -- mobilemoney, card, cash…
  reject_reason  TEXT,
  raw            JSONB,           -- réponse vérifiée du prestataire
  verified_at    TIMESTAMPTZ,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
-- Idempotence : une transaction du prestataire ne peut être enregistrée qu'une fois.
CREATE UNIQUE INDEX payments_provider_tx_uq ON payments (provider, provider_tx_id) WHERE provider_tx_id IS NOT NULL;
-- Une commande ne peut avoir qu'UN paiement réussi.
CREATE UNIQUE INDEX payments_one_success_uq ON payments (order_id) WHERE status = 'SUCCESSFUL';
CREATE INDEX payments_order_idx ON payments (order_id);
CREATE TRIGGER payments_updated BEFORE UPDATE ON payments FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Tous les webhooks reçus, valides ou non : rejouables et auditables.
CREATE TABLE webhook_events (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  provider        TEXT NOT NULL,
  dedupe_key      TEXT NOT NULL,
  signature_valid BOOLEAN NOT NULL,
  payload         JSONB NOT NULL,
  result          TEXT,
  received_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  processed_at    TIMESTAMPTZ,
  UNIQUE (provider, dedupe_key)
);

CREATE TABLE refunds (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id      UUID NOT NULL REFERENCES orders(id),
  payment_id    UUID REFERENCES payments(id),
  amount        BIGINT NOT NULL CHECK (amount > 0),
  currency_code CHAR(3) NOT NULL REFERENCES currencies(code),
  reason        TEXT NOT NULL,
  status        TEXT NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING','DONE','FAILED')),
  provider_ref  TEXT,
  processed_by  UUID REFERENCES users(id),
  processed_at  TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX refunds_status_idx ON refunds (status);

CREATE TABLE cash_closings (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  office_id       UUID NOT NULL REFERENCES local_offices(id),
  business_date   DATE NOT NULL,
  currency_code   CHAR(3) NOT NULL REFERENCES currencies(code),
  expected_amount BIGINT NOT NULL,   -- somme des encaissements enregistrés
  declared_amount BIGINT NOT NULL,   -- somme comptée en caisse
  difference      BIGINT GENERATED ALWAYS AS (declared_amount - expected_amount) STORED,
  payments_count  INTEGER NOT NULL,
  note            TEXT,
  closed_by       UUID NOT NULL REFERENCES users(id),
  closed_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (office_id, business_date, currency_code)
);

-- Réservation de paiement en bureau (§24).
CREATE TABLE office_payments (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  number          TEXT NOT NULL UNIQUE,              -- RB-2026-00000042
  order_id        UUID NOT NULL UNIQUE REFERENCES orders(id),
  office_id       UUID NOT NULL REFERENCES local_offices(id),
  status          TEXT NOT NULL DEFAULT 'PENDING_PAYMENT'
                  CHECK (status IN ('PENDING_PAYMENT','CONFIRMED','PAID','EXPIRED','CANCELLED')),
  amount          BIGINT NOT NULL CHECK (amount >= 0),
  currency_code   CHAR(3) NOT NULL REFERENCES currencies(code),
  qr_token        TEXT NOT NULL UNIQUE,              -- valeur aléatoire encodée dans le QR Code
  expires_at      TIMESTAMPTZ NOT NULL,
  channel         TEXT CHECK (channel IN ('CASH','BANK_TRANSFER','CHEQUE','MOBILE_MONEY')),
  paid_at         TIMESTAMPTZ,
  recorded_by     UUID REFERENCES users(id),
  cash_closing_id UUID REFERENCES cash_closings(id),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK ((status = 'PAID') = (paid_at IS NOT NULL AND recorded_by IS NOT NULL))
);
CREATE INDEX office_payments_office_idx ON office_payments (office_id, status);
CREATE TRIGGER office_payments_updated BEFORE UPDATE ON office_payments FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE invoices (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  number        TEXT NOT NULL UNIQUE,
  kind          TEXT NOT NULL CHECK (kind IN ('PROFORMA','INVOICE','RECEIPT')),
  order_id      UUID NOT NULL REFERENCES orders(id),
  amount        BIGINT NOT NULL,
  currency_code CHAR(3) NOT NULL REFERENCES currencies(code),
  data          JSONB NOT NULL,       -- instantané des lignes affichées (jamais de ligne de livraison)
  pdf_key       TEXT,
  issued_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (order_id, kind)
);

-- ---------------------------------------------------------------------------
-- Suivi logistique : historique des 9 étapes
-- ---------------------------------------------------------------------------

CREATE TABLE logistics_tracking (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  shipment_id     UUID REFERENCES shipments(id) ON DELETE CASCADE,
  order_id        UUID REFERENCES orders(id) ON DELETE CASCADE,
  step            SMALLINT NOT NULL CHECK (step BETWEEN 1 AND 9),
  status          TEXT NOT NULL CHECK (status IN ('VALIDATED','SKIPPED','REVERTED')),
  note            TEXT,
  is_override     BOOLEAN NOT NULL DEFAULT false,
  override_reason TEXT,
  actor_id        UUID REFERENCES users(id),
  occurred_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- Étapes 1 à 7 sur une expédition, 8 et 9 sur une commande, jamais les deux.
  CHECK ((shipment_id IS NOT NULL AND order_id IS NULL AND step <= 7)
      OR (shipment_id IS NULL AND order_id IS NOT NULL AND step >= 8)),
  CHECK (NOT is_override OR length(trim(coalesce(override_reason, ''))) > 0)
);
CREATE INDEX logistics_tracking_shipment_idx ON logistics_tracking (shipment_id, occurred_at);
CREATE INDEX logistics_tracking_order_idx ON logistics_tracking (order_id, occurred_at);

-- ---------------------------------------------------------------------------
-- Matching
-- ---------------------------------------------------------------------------

CREATE TABLE matching_requests (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id              UUID NOT NULL REFERENCES users(id),
  title                TEXT NOT NULL CHECK (length(title) BETWEEN 5 AND 140),
  description          TEXT NOT NULL DEFAULT '',
  category_id          UUID REFERENCES categories(id),
  country_code         CHAR(2) NOT NULL REFERENCES countries(code),
  desired_quantity     INTEGER CHECK (desired_quantity >= 1),
  image_url            TEXT,
  status               TEXT NOT NULL DEFAULT 'PENDING_REVIEW'
                       CHECK (status IN ('PENDING_REVIEW','PUBLISHED','REJECTED','CONVERTED','CLOSED')),
  interest_count       INTEGER NOT NULL DEFAULT 0 CHECK (interest_count >= 0),
  total_quantity       INTEGER NOT NULL DEFAULT 0 CHECK (total_quantity >= 0),
  threshold_alerted_at TIMESTAMPTZ,
  moderated_by         UUID REFERENCES users(id),
  moderated_at         TIMESTAMPTZ,
  rejection_reason     TEXT,
  converted_deal_id    UUID REFERENCES group_deals(id),
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX matching_requests_listing_idx ON matching_requests (status, interest_count DESC);
CREATE TRIGGER matching_requests_updated BEFORE UPDATE ON matching_requests FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE matching_interests (
  request_id UUID NOT NULL REFERENCES matching_requests(id) ON DELETE CASCADE,
  user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  quantity   INTEGER CHECK (quantity >= 1),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- §47 : un utilisateur exprime son intérêt une seule fois par demande.
  PRIMARY KEY (request_id, user_id)
);

-- ---------------------------------------------------------------------------
-- Notifications
-- ---------------------------------------------------------------------------

CREATE TABLE notifications (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type       TEXT NOT NULL,          -- DEAL_NEW, DEAL_ENDING, PAYMENT_CONFIRMED, LOGISTICS_STEP…
  params     JSONB NOT NULL DEFAULT '{}',  -- le texte est construit dans la langue de l'utilisateur
  link       TEXT,
  read_at    TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX notifications_user_idx ON notifications (user_id, created_at DESC);
CREATE INDEX notifications_unread_idx ON notifications (user_id) WHERE read_at IS NULL;

-- File d'envoi par canal : l'envoi est découplé de l'action métier et rejoué en cas d'échec.
CREATE TABLE notification_outbox (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  notification_id UUID NOT NULL REFERENCES notifications(id) ON DELETE CASCADE,
  channel         TEXT NOT NULL CHECK (channel IN ('PUSH','EMAIL','WHATSAPP')),
  status          TEXT NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING','SENT','FAILED','SKIPPED')),
  attempts        INTEGER NOT NULL DEFAULT 0,
  last_error      TEXT,
  next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  sent_at         TIMESTAMPTZ,
  UNIQUE (notification_id, channel)
);
CREATE INDEX notification_outbox_due_idx ON notification_outbox (next_attempt_at) WHERE status = 'PENDING';

-- ---------------------------------------------------------------------------
-- Journal d'audit (en ajout seul) et mesures d'audience
-- ---------------------------------------------------------------------------

CREATE TABLE audit_logs (
  id          BIGSERIAL PRIMARY KEY,
  actor_id    UUID,
  actor_roles TEXT[] NOT NULL DEFAULT '{}',
  action      TEXT NOT NULL,       -- ex. office_payment.record, logistics.override, shipping_rate.update
  entity_type TEXT NOT NULL,
  entity_id   TEXT,
  before      JSONB,
  after       JSONB,
  reason      TEXT,
  ip          INET,
  user_agent  TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX audit_logs_entity_idx ON audit_logs (entity_type, entity_id);
CREATE INDEX audit_logs_actor_idx ON audit_logs (actor_id, created_at DESC);
CREATE INDEX audit_logs_action_idx ON audit_logs (action, created_at DESC);

CREATE FUNCTION audit_logs_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Le journal d''audit est en ajout seul';
END $$;
CREATE TRIGGER audit_logs_no_change BEFORE UPDATE OR DELETE ON audit_logs
  FOR EACH ROW EXECUTE FUNCTION audit_logs_immutable();
CREATE TRIGGER audit_logs_no_truncate BEFORE TRUNCATE ON audit_logs
  FOR EACH STATEMENT EXECUTE FUNCTION audit_logs_immutable();

CREATE TABLE analytics_events (
  id           BIGSERIAL PRIMARY KEY,
  type         TEXT NOT NULL,       -- product_view, deal_view, participate_click, checkout_start…
  user_id      UUID,
  session_id   TEXT,
  country_code CHAR(2),
  entity_type  TEXT,
  entity_id    UUID,
  data         JSONB NOT NULL DEFAULT '{}',
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX analytics_events_type_idx ON analytics_events (type, created_at);
CREATE INDEX analytics_events_entity_idx ON analytics_events (entity_type, entity_id);

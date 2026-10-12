-- Vérifie que la base refuse d'elle-même les états interdits, indépendamment du code.
-- Usage : psql -v ON_ERROR_STOP=1 -f constraints.test.sql   (tout est annulé à la fin)

BEGIN;

CREATE FUNCTION pg_temp.expect_fail(label TEXT, stmt TEXT) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  BEGIN
    EXECUTE stmt;
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'OK   refusé  : % (%)', label, SQLSTATE;
    RETURN;
  END;
  RAISE EXCEPTION 'ECHEC : "%" aurait dû être refusé', label;
END $$;

CREATE FUNCTION pg_temp.expect_ok(label TEXT, stmt TEXT) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  EXECUTE stmt;
  RAISE NOTICE 'OK   accepté : %', label;
END $$;

-- Jeu de données minimal
INSERT INTO users (id, email, password_hash, first_name, last_name, country_code, whatsapp) VALUES
  ('00000000-0000-0000-0000-0000000000a1', 'awa@example.com', 'x', 'Awa', 'Ndiaye', 'CM', '+237600000001'),
  ('00000000-0000-0000-0000-0000000000a2', 'agent@example.com', 'x', 'Paul', 'Agent', 'CM', '+237600000002');
INSERT INTO products (id, category_id, slug, name, moq, base_price_amount, base_price_currency)
  SELECT '00000000-0000-0000-0000-0000000000b1', id, 'sandales', 'Sandales', 10, 10000, 'XAF' FROM categories WHERE slug = 'mode-femme';
INSERT INTO shipping_rates (product_id, country_code, amount, currency_code)
  VALUES ('00000000-0000-0000-0000-0000000000b1', 'CM', 1500, 'XAF');
INSERT INTO group_deals (id, product_id, slug, stored_status, base_price_amount, base_price_currency,
                         target_quantity, min_quantity, max_quantity, starts_at, ends_at)
  VALUES ('00000000-0000-0000-0000-0000000000c1', '00000000-0000-0000-0000-0000000000b1', 'sandales-oct',
          'PUBLISHED', 10000, 'XAF', 100, 10, 200, now() - interval '1 day', now() + interval '10 days');
INSERT INTO local_offices (id, country_code, name, city, address)
  VALUES ('00000000-0000-0000-0000-0000000000d1', 'CM', 'Bureau Douala', 'Douala', 'Akwa');
INSERT INTO orders (id, number, user_id, deal_id, country_code, currency_code, total_quantity, total_amount,
                    payment_method, tx_ref, expires_at, idempotency_key)
  VALUES ('00000000-0000-0000-0000-0000000000e1', 'GD-2026-00000001', '00000000-0000-0000-0000-0000000000a1',
          '00000000-0000-0000-0000-0000000000c1', 'CM', 'XAF', 20, 230000, 'ONLINE', 'GD-2026-00000001-A',
          now() + interval '30 minutes', 'cle-1');

-- Email insensible à la casse
SELECT pg_temp.expect_fail('email en double (casse différente)',
  $$INSERT INTO users (email, password_hash, first_name, last_name, country_code, whatsapp)
    VALUES ('AWA@Example.com', 'x', 'A', 'B', 'CM', '+2376')$$);

-- Survente
SELECT pg_temp.expect_ok('retenue dans la limite du plafond',
  $$UPDATE group_deals SET held_quantity = 200 WHERE slug = 'sandales-oct'$$);
SELECT pg_temp.expect_fail('survente : payé + retenu > plafond',
  $$UPDATE group_deals SET paid_quantity = 1 WHERE slug = 'sandales-oct'$$);
SELECT pg_temp.expect_fail('quantité payée négative',
  $$UPDATE group_deals SET paid_quantity = -1 WHERE slug = 'sandales-oct'$$);
SELECT pg_temp.expect_fail('campagne qui finit avant de commencer',
  $$UPDATE group_deals SET ends_at = starts_at - interval '1 hour' WHERE slug = 'sandales-oct'$$);

-- Tarif de livraison : un seul tarif courant par produit et par pays
SELECT pg_temp.expect_fail('deux tarifs courants pour le même produit et le même pays',
  $$INSERT INTO shipping_rates (product_id, country_code, amount, currency_code)
    VALUES ('00000000-0000-0000-0000-0000000000b1', 'CM', 2000, 'XAF')$$);
SELECT pg_temp.expect_ok('nouveau tarif après clôture de l''ancien',
  $$WITH closed AS (UPDATE shipping_rates SET is_current = false, closed_at = now()
                    WHERE product_id = '00000000-0000-0000-0000-0000000000b1' AND country_code = 'CM' RETURNING 1)
    INSERT INTO shipping_rates (product_id, country_code, amount, currency_code)
    SELECT '00000000-0000-0000-0000-0000000000b1', 'CM', 2000, 'XAF' FROM closed$$);

-- Instantané de prix cohérent
SELECT pg_temp.expect_ok('ligne de commande cohérente : 10 000 + 1 500 = 11 500 ; × 20 = 230 000',
  $$INSERT INTO order_items (order_id, product_id, product_name, sale_unit, pieces_per_sale_unit, quantity,
      unit_final_amount, line_total_amount, base_source_amount, base_source_currency, base_converted_amount,
      shipping_source_amount, shipping_source_currency, shipping_converted_amount, rounding_adjustment,
      fx_buffer_bps, reference_currency, rates_used, computed_at)
    VALUES ('00000000-0000-0000-0000-0000000000e1', '00000000-0000-0000-0000-0000000000b1', 'Sandales', 'UNIT', 1, 20,
      11500, 230000, 10000, 'XAF', 10000, 1500, 'XAF', 1500, 0, 200, 'USD', '{}', now())$$);
SELECT pg_temp.expect_fail('total de ligne différent de prix × quantité',
  $$INSERT INTO order_items (order_id, product_id, product_name, sale_unit, pieces_per_sale_unit, quantity,
      unit_final_amount, line_total_amount, base_source_amount, base_source_currency, base_converted_amount,
      shipping_source_amount, shipping_source_currency, shipping_converted_amount, rounding_adjustment,
      fx_buffer_bps, reference_currency, rates_used, computed_at)
    VALUES ('00000000-0000-0000-0000-0000000000e1', '00000000-0000-0000-0000-0000000000b1', 'Sandales', 'UNIT', 1, 20,
      11500, 229000, 10000, 'XAF', 10000, 1500, 'XAF', 1500, 0, 200, 'USD', '{}', now())$$);
SELECT pg_temp.expect_fail('prix final différent de base + livraison + arrondi',
  $$INSERT INTO order_items (order_id, product_id, product_name, sale_unit, pieces_per_sale_unit, quantity,
      unit_final_amount, line_total_amount, base_source_amount, base_source_currency, base_converted_amount,
      shipping_source_amount, shipping_source_currency, shipping_converted_amount, rounding_adjustment,
      fx_buffer_bps, reference_currency, rates_used, computed_at)
    VALUES ('00000000-0000-0000-0000-0000000000e1', '00000000-0000-0000-0000-0000000000b1', 'Sandales', 'UNIT', 1, 20,
      11500, 230000, 10000, 'XAF', 10000, 1000, 'XAF', 1000, 0, 200, 'USD', '{}', now())$$);

-- Commandes
SELECT pg_temp.expect_fail('même clé d''idempotence pour le même client',
  $$INSERT INTO orders (number, user_id, deal_id, country_code, currency_code, total_quantity, total_amount,
      payment_method, tx_ref, expires_at, idempotency_key)
    VALUES ('GD-2026-00000002', '00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000c1',
      'CM', 'XAF', 20, 230000, 'ONLINE', 'GD-2026-00000002-A', now(), 'cle-1')$$);
SELECT pg_temp.expect_fail('commande marquée payée sans date de paiement',
  $$UPDATE orders SET payment_status = 'PAID' WHERE number = 'GD-2026-00000001'$$);
SELECT pg_temp.expect_fail('statut de paiement inconnu',
  $$UPDATE orders SET payment_status = 'OK' WHERE number = 'GD-2026-00000001'$$);

-- Paiements : idempotence
SELECT pg_temp.expect_ok('premier paiement réussi',
  $$INSERT INTO payments (order_id, provider, provider_tx_id, tx_ref, status, amount, currency_code)
    VALUES ('00000000-0000-0000-0000-0000000000e1', 'FLUTTERWAVE', 'FLW-1', 'GD-2026-00000001-A', 'SUCCESSFUL', 230000, 'XAF')$$);
SELECT pg_temp.expect_fail('même transaction du prestataire enregistrée deux fois',
  $$INSERT INTO payments (order_id, provider, provider_tx_id, tx_ref, status, amount, currency_code)
    VALUES ('00000000-0000-0000-0000-0000000000e1', 'FLUTTERWAVE', 'FLW-1', 'GD-2026-00000001-A', 'FAILED', 230000, 'XAF')$$);
SELECT pg_temp.expect_fail('second paiement réussi sur la même commande',
  $$INSERT INTO payments (order_id, provider, provider_tx_id, tx_ref, status, amount, currency_code)
    VALUES ('00000000-0000-0000-0000-0000000000e1', 'FLUTTERWAVE', 'FLW-2', 'GD-2026-00000001-A', 'SUCCESSFUL', 230000, 'XAF')$$);
SELECT pg_temp.expect_ok('second paiement enregistré comme « à rembourser »',
  $$INSERT INTO payments (order_id, provider, provider_tx_id, tx_ref, status, amount, currency_code)
    VALUES ('00000000-0000-0000-0000-0000000000e1', 'FLUTTERWAVE', 'FLW-2', 'GD-2026-00000001-A', 'REFUND_REQUIRED', 230000, 'XAF')$$);
SELECT pg_temp.expect_ok('webhook enregistré',
  $$INSERT INTO webhook_events (provider, dedupe_key, signature_valid, payload) VALUES ('FLUTTERWAVE', 'evt-1', true, '{}')$$);
SELECT pg_temp.expect_fail('même webhook reçu deux fois',
  $$INSERT INTO webhook_events (provider, dedupe_key, signature_valid, payload) VALUES ('FLUTTERWAVE', 'evt-1', true, '{}')$$);

-- Réservation bureau
SELECT pg_temp.expect_ok('réservation bureau créée',
  $$INSERT INTO office_payments (number, order_id, office_id, amount, currency_code, qr_token, expires_at)
    VALUES ('RB-2026-00000001', '00000000-0000-0000-0000-0000000000e1', '00000000-0000-0000-0000-0000000000d1',
            230000, 'XAF', 'qr-abc', now() + interval '72 hours')$$);
SELECT pg_temp.expect_fail('deux réservations pour la même commande',
  $$INSERT INTO office_payments (number, order_id, office_id, amount, currency_code, qr_token, expires_at)
    VALUES ('RB-2026-00000002', '00000000-0000-0000-0000-0000000000e1', '00000000-0000-0000-0000-0000000000d1',
            230000, 'XAF', 'qr-def', now())$$);
SELECT pg_temp.expect_fail('réservation payée sans agent identifié',
  $$UPDATE office_payments SET status = 'PAID', paid_at = now() WHERE number = 'RB-2026-00000001'$$);
SELECT pg_temp.expect_ok('réservation payée, agent identifié',
  $$UPDATE office_payments SET status = 'PAID', paid_at = now(), channel = 'CASH',
      recorded_by = '00000000-0000-0000-0000-0000000000a2' WHERE number = 'RB-2026-00000001'$$);

-- Logistique
INSERT INTO shipments (id, reference, deal_id, country_code)
  VALUES ('00000000-0000-0000-0000-0000000000f1', 'EX-2026-00000001', '00000000-0000-0000-0000-0000000000c1', 'CM');
SELECT pg_temp.expect_fail('deux expéditions pour la même campagne et le même pays',
  $$INSERT INTO shipments (reference, deal_id, country_code)
    VALUES ('EX-2026-00000002', '00000000-0000-0000-0000-0000000000c1', 'CM')$$);
SELECT pg_temp.expect_fail('expédition à l''étape 8 (réservée aux commandes)',
  $$UPDATE shipments SET current_step = 8 WHERE reference = 'EX-2026-00000001'$$);
SELECT pg_temp.expect_fail('étape 8 enregistrée sur une expédition',
  $$INSERT INTO logistics_tracking (shipment_id, step, status) VALUES ('00000000-0000-0000-0000-0000000000f1', 8, 'VALIDATED')$$);
SELECT pg_temp.expect_fail('étape forcée sans motif',
  $$INSERT INTO logistics_tracking (shipment_id, step, status, is_override, override_reason)
    VALUES ('00000000-0000-0000-0000-0000000000f1', 7, 'VALIDATED', true, '  ')$$);
SELECT pg_temp.expect_ok('étape forcée avec motif',
  $$INSERT INTO logistics_tracking (shipment_id, step, status, is_override, override_reason)
    VALUES ('00000000-0000-0000-0000-0000000000f1', 7, 'VALIDATED', true, 'Fret aérien')$$);

-- Matching : un seul intérêt par utilisateur et par demande (§47)
INSERT INTO matching_requests (id, user_id, title, country_code, status)
  VALUES ('00000000-0000-0000-0000-000000000011', '00000000-0000-0000-0000-0000000000a1',
          'Panneaux solaires 550W', 'CM', 'PUBLISHED');
SELECT pg_temp.expect_ok('premier intérêt',
  $$INSERT INTO matching_interests (request_id, user_id)
    VALUES ('00000000-0000-0000-0000-000000000011', '00000000-0000-0000-0000-0000000000a2')$$);
SELECT pg_temp.expect_fail('second intérêt du même utilisateur',
  $$INSERT INTO matching_interests (request_id, user_id)
    VALUES ('00000000-0000-0000-0000-000000000011', '00000000-0000-0000-0000-0000000000a2')$$);

-- Journal d'audit en ajout seul
INSERT INTO audit_logs (action, entity_type, entity_id) VALUES ('test.action', 'order', 'x');
SELECT pg_temp.expect_fail('modification du journal d''audit', $$UPDATE audit_logs SET action = 'autre'$$);
SELECT pg_temp.expect_fail('suppression dans le journal d''audit', $$DELETE FROM audit_logs$$);

-- Référentiel
SELECT pg_temp.expect_fail('seuil bureau sans devise',
  $$UPDATE payment_methods SET min_total_currency = NULL WHERE code = 'OFFICE'$$);
SELECT pg_temp.expect_fail('taux de change nul',
  $$INSERT INTO exchange_rates (currency_code, rate, as_of, source) VALUES ('XAF', 0, now(), 'test')$$);

ROLLBACK;

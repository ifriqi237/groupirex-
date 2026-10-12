/**
 * Outils en ligne de commande :
 *   migrate                      applique les migrations
 *   seed-demo                    charge le jeu de démonstration (jamais en production)
 *   create-admin <email> <mdp>   crée le premier super-administrateur
 *   test-email <adresse>         envoie un email d'essai (vérifie la configuration SMTP)
 */

import { createApp } from './app';
import { loadConfig } from './config';
import { hashPassword } from './lib/crypto';
import { syncTranslations } from './modules/reference';
import { DEMO_PASSWORD, seedDemo } from './seed-demo';
import { composeEmail, sendMail } from './services/email';

async function main(): Promise<void> {
  const [command, ...args] = process.argv.slice(2);
  const app = await createApp(loadConfig({ RUN_JOBS: 'false' }), { migrate: true });
  try {
    switch (command) {
      case 'migrate': {
        const added = await syncTranslations(app);
        console.log(`Migrations appliquées. ${added} texte(s) d'interface ajouté(s).`);
        break;
      }
      case 'seed-demo':
        await seedDemo(app);
        console.log(`Jeu de démonstration chargé. Mot de passe de tous les comptes : ${DEMO_PASSWORD}`);
        break;
      case 'create-admin': {
        const [email, password] = args;
        if (!email || !password || password.length < 12) throw new Error('Usage : create-admin <email> <mot de passe de 12 caractères au moins>');
        const hash = await hashPassword(password);
        await app.db.tx(async (tx) => {
          const u = await tx.one(
            `INSERT INTO users (email, password_hash, first_name, last_name, country_code, whatsapp, email_verified_at)
             VALUES ($1, $2, 'Super', 'Admin', $3, '+000000000', now()) RETURNING id`,
            [email.toLowerCase(), hash, app.config.defaultCountry],
          );
          await tx.query(`INSERT INTO user_roles (user_id, role_code) VALUES ($1, 'CUSTOMER'), ($1, 'SUPER_ADMIN')`, [u!.id]);
        });
        console.log(`Super-administrateur créé : ${email}. Activez la double authentification à la première connexion.`);
        break;
      }
      case 'test-email': {
        const [to] = args;
        if (!to) throw new Error('Usage : test-email <adresse>');
        if (!app.config.smtp) throw new Error('SMTP_HOST n’est pas renseigné : aucun email ne peut partir.');
        const mail = composeEmail(
          { channel: 'EMAIL', type: 'WELCOME', params: {}, link: '/deals', user: { id: '', email: to, whatsapp: '', firstName: '', languageCode: 'fr' }, deviceTokens: [] },
          app.config.publicUrl,
        )!;
        await sendMail(app.config.smtp, { ...mail, subject: 'GROUPDEALS — email d’essai' });
        console.log(`Email d'essai envoyé à ${to} par ${app.config.smtp.host}:${app.config.smtp.port}.`);
        break;
      }
      default:
        console.log('Commandes : migrate | seed-demo | create-admin <email> <mot de passe> | test-email <adresse>');
        process.exitCode = 1;
    }
  } finally {
    await app.stop();
  }
}

main().catch((e) => {
  console.error((e as Error)?.message ?? e);
  process.exit(1);
});

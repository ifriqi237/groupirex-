/**
 * Les 54 pays d'Afrique (États membres de l'ONU), avec leur nom en français et en anglais.
 *
 * Cette liste sert à l'annuaire des partenaires locaux, qui présente tout le continent.
 * Elle est distincte des pays desservis (table `countries`) : ouvrir un pays à la vente
 * demande en plus une devise, un taux de change et des frais de livraison.
 */
export interface AfricanCountry {
  code: string;
  fr: string;
  en: string;
}

export const AFRICAN_COUNTRIES: readonly AfricanCountry[] = [
  { code: 'ZA', fr: 'Afrique du Sud', en: 'South Africa' },
  { code: 'DZ', fr: 'Algérie', en: 'Algeria' },
  { code: 'AO', fr: 'Angola', en: 'Angola' },
  { code: 'BJ', fr: 'Bénin', en: 'Benin' },
  { code: 'BW', fr: 'Botswana', en: 'Botswana' },
  { code: 'BF', fr: 'Burkina Faso', en: 'Burkina Faso' },
  { code: 'BI', fr: 'Burundi', en: 'Burundi' },
  { code: 'CM', fr: 'Cameroun', en: 'Cameroon' },
  { code: 'CV', fr: 'Cap-Vert', en: 'Cape Verde' },
  { code: 'CF', fr: 'Centrafrique', en: 'Central African Republic' },
  { code: 'KM', fr: 'Comores', en: 'Comoros' },
  { code: 'CG', fr: 'Congo', en: 'Congo' },
  { code: 'CI', fr: "Côte d'Ivoire", en: "Côte d'Ivoire" },
  { code: 'DJ', fr: 'Djibouti', en: 'Djibouti' },
  { code: 'EG', fr: 'Égypte', en: 'Egypt' },
  { code: 'ER', fr: 'Érythrée', en: 'Eritrea' },
  { code: 'SZ', fr: 'Eswatini', en: 'Eswatini' },
  { code: 'ET', fr: 'Éthiopie', en: 'Ethiopia' },
  { code: 'GA', fr: 'Gabon', en: 'Gabon' },
  { code: 'GM', fr: 'Gambie', en: 'Gambia' },
  { code: 'GH', fr: 'Ghana', en: 'Ghana' },
  { code: 'GN', fr: 'Guinée', en: 'Guinea' },
  { code: 'GQ', fr: 'Guinée équatoriale', en: 'Equatorial Guinea' },
  { code: 'GW', fr: 'Guinée-Bissau', en: 'Guinea-Bissau' },
  { code: 'KE', fr: 'Kenya', en: 'Kenya' },
  { code: 'LS', fr: 'Lesotho', en: 'Lesotho' },
  { code: 'LR', fr: 'Liberia', en: 'Liberia' },
  { code: 'LY', fr: 'Libye', en: 'Libya' },
  { code: 'MG', fr: 'Madagascar', en: 'Madagascar' },
  { code: 'MW', fr: 'Malawi', en: 'Malawi' },
  { code: 'ML', fr: 'Mali', en: 'Mali' },
  { code: 'MA', fr: 'Maroc', en: 'Morocco' },
  { code: 'MU', fr: 'Maurice', en: 'Mauritius' },
  { code: 'MR', fr: 'Mauritanie', en: 'Mauritania' },
  { code: 'MZ', fr: 'Mozambique', en: 'Mozambique' },
  { code: 'NA', fr: 'Namibie', en: 'Namibia' },
  { code: 'NE', fr: 'Niger', en: 'Niger' },
  { code: 'NG', fr: 'Nigeria', en: 'Nigeria' },
  { code: 'UG', fr: 'Ouganda', en: 'Uganda' },
  { code: 'CD', fr: 'RD Congo', en: 'DR Congo' },
  { code: 'RW', fr: 'Rwanda', en: 'Rwanda' },
  { code: 'ST', fr: 'Sao Tomé-et-Principe', en: 'São Tomé and Príncipe' },
  { code: 'SN', fr: 'Sénégal', en: 'Senegal' },
  { code: 'SC', fr: 'Seychelles', en: 'Seychelles' },
  { code: 'SL', fr: 'Sierra Leone', en: 'Sierra Leone' },
  { code: 'SO', fr: 'Somalie', en: 'Somalia' },
  { code: 'SD', fr: 'Soudan', en: 'Sudan' },
  { code: 'SS', fr: 'Soudan du Sud', en: 'South Sudan' },
  { code: 'TZ', fr: 'Tanzanie', en: 'Tanzania' },
  { code: 'TD', fr: 'Tchad', en: 'Chad' },
  { code: 'TG', fr: 'Togo', en: 'Togo' },
  { code: 'TN', fr: 'Tunisie', en: 'Tunisia' },
  { code: 'ZM', fr: 'Zambie', en: 'Zambia' },
  { code: 'ZW', fr: 'Zimbabwe', en: 'Zimbabwe' },
];

const BY_CODE = new Map(AFRICAN_COUNTRIES.map((c) => [c.code, c]));

export const africanCountry = (code: string): AfricanCountry | undefined => BY_CODE.get(code.toUpperCase());

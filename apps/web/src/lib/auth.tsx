/**
 * Session de l'utilisateur et réglages publics.
 */

import { ReactNode, createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { get, post, prefs, refreshSession, session } from './api';
import { store } from './env';
import { useI18n } from './i18n';

export interface User {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  whatsapp: string;
  avatarUrl: string | null;
  country: { code: string; name: string; currency: string };
  languageCode: string;
  emailVerified: boolean;
  twoFactorEnabled: boolean;
  twoFactorRequired: boolean;
  roles: string[];
  permissions: string[];
  officeIds: string[];
  notificationPrefs: { push: boolean; email: boolean; whatsapp: boolean };
}

export interface Country {
  code: string;
  name: string;
  currency: string;
  currencySymbol: string;
  phonePrefix: string;
  defaultLanguage: string;
}

interface Auth {
  user: User | null;
  /** Faux tant qu'on ne sait pas si une session existe. */
  ready: boolean;
  countries: Country[];
  /** Pays utilisé pour les prix : celui du profil, sinon celui choisi par le visiteur. */
  country: string;
  setVisitorCountry(code: string): void;
  accept(data: { accessToken: string; user: User }): void;
  setUser(user: User): void;
  logout(): Promise<void>;
  can(permission: string): boolean;
  isStaff: boolean;
  unread: number;
  refreshUnread(): void;
}

const Ctx = createContext<Auth>(null as unknown as Auth);

export function AuthProvider({ children }: { children: ReactNode }) {
  const { setLang } = useI18n();
  const [user, setUserState] = useState<User | null>(null);
  const [ready, setReady] = useState(false);
  const [countries, setCountries] = useState<Country[]>([]);
  const [visitorCountry, setVisitor] = useState<string>(prefs.country ?? '');
  const [defaultCountry, setDefault] = useState('CM');
  const [unread, setUnread] = useState(0);

  const refreshUnread = useCallback(() => {
    if (!session.token) return;
    get<{ unread: number }>('/me/notifications?pageSize=1')
      .then((r) => setUnread(r.unread))
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    session.listen((data) => {
      if (!data) store.remove('gd_session');
      setUserState(data?.user ?? null);
    });
    // Le cookie de session est illisible en JavaScript : un simple témoin local évite
    // un appel inutile (et une erreur 401) pour les visiteurs jamais connectés.
    if (store.get('gd_session')) refreshSession().finally(() => setReady(true));
    else setReady(true);
    get<{ countries: Country[]; defaultCountry: string }>('/countries')
      .then((r) => {
        setCountries(r.countries);
        setDefault(r.defaultCountry);
      })
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    if (!user) {
      setUnread(0);
      return;
    }
    refreshUnread();
    const timer = setInterval(refreshUnread, 60_000);
    return () => clearInterval(timer);
  }, [user?.id, refreshUnread]);

  const value = useMemo<Auth>(
    () => ({
      user,
      ready,
      countries,
      country: user?.country.code ?? (visitorCountry || defaultCountry),
      setVisitorCountry(code) {
        prefs.country = code;
        setVisitor(code);
      },
      accept(data) {
        session.set(data.accessToken);
        store.set('gd_session', '1');
        setUserState(data.user);
        if (data.user.languageCode) setLang(data.user.languageCode);
      },
      setUser: setUserState,
      async logout() {
        await post('/auth/logout').catch(() => undefined);
        session.set(null);
        store.remove('gd_session');
        setUserState(null);
      },
      can: (p) => !!user?.permissions.includes(p),
      isStaff: !!user && user.roles.some((r) => r !== 'CUSTOMER'),
      unread,
      refreshUnread,
    }),
    [user, ready, countries, visitorCountry, defaultCountry, unread, refreshUnread, setLang],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export const useAuth = () => useContext(Ctx);

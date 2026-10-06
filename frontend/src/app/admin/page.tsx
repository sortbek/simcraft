'use client';

import { useEffect, useState } from 'react';
import { useIsDesktop } from '../lib/useIsDesktop';
import { useLanguage } from '../lib/i18n';
import { getAdminToken, clearAdminToken, adminFetch } from '../lib/adminAuth';
import AdminLogin from './AdminLogin';
import AdminPanel from './AdminPanel';
import PageHeader from '../components/ui/PageHeader';

export default function AdminPage() {
  const { t } = useLanguage();
  const isDesktop = useIsDesktop();
  const [authed, setAuthed] = useState(false);
  const [checking, setChecking] = useState(true);

  useEffect(() => {
    const token = getAdminToken();
    if (!token) {
      setChecking(false);
      return;
    }
    adminFetch('/api/admin/auth/check')
      .then((res) => {
        if (res.ok) {
          setAuthed(true);
        } else {
          clearAdminToken();
        }
      })
      .catch(() => clearAdminToken())
      .finally(() => setChecking(false));
  }, []);

  if (isDesktop) {
    return (
      <div className="mx-auto max-w-4xl pt-20">
        <p className="text-sm text-on-surface-variant/60">
          Admin panel is only available on the web version. Use Settings for desktop configuration.
        </p>
      </div>
    );
  }

  if (checking) {
    return null;
  }

  return (
    <div className="mx-auto max-w-4xl space-y-8 pb-20">
      <header className="mb-10">
        <PageHeader
          eyebrow={t('nav.app')}
          title="Admin"
          subtitle="Server configuration and SimC engine management."
        />
      </header>

      {authed ? (
        <AdminPanel onLogout={() => setAuthed(false)} />
      ) : (
        <AdminLogin onSuccess={() => setAuthed(true)} />
      )}
    </div>
  );
}

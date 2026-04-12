'use client';

import { clearAdminToken } from '../lib/adminAuth';
import AdminLimitsSection from './AdminLimitsSection';

interface AdminPanelProps {
  onLogout: () => void;
}

export default function AdminPanel({ onLogout }: AdminPanelProps) {
  return (
    <div className="space-y-8">
      <AdminLimitsSection />

      <div className="border-t border-outline-variant/10 pt-6">
        <button
          onClick={() => {
            clearAdminToken();
            onLogout();
          }}
          className="rounded-lg border border-outline-variant/20 px-4 py-2 text-xs font-bold uppercase tracking-wider text-on-surface-variant transition-colors hover:bg-surface-container-high hover:text-on-surface"
        >
          Sign Out
        </button>
      </div>
    </div>
  );
}

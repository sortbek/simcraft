'use client';

import { clearAdminToken } from '../lib/adminAuth';
import AdminLimitsSection from './AdminLimitsSection';
import Button from '../components/ui/Button';

interface AdminPanelProps {
  onLogout: () => void;
}

export default function AdminPanel({ onLogout }: AdminPanelProps) {
  return (
    <div className="space-y-8">
      <AdminLimitsSection />

      <div className="border-t border-line/[0.06] pt-6">
        <Button
          variant="quiet"
          onClick={() => {
            clearAdminToken();
            onLogout();
          }}
        >
          Sign Out
        </Button>
      </div>
    </div>
  );
}

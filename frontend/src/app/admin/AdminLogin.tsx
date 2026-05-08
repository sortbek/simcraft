'use client';

import { useState } from 'react';
import { API_URL } from '../lib/api';
import { setAdminToken } from '../lib/adminAuth';

interface AdminLoginProps {
  onSuccess: () => void;
}

export default function AdminLogin({ onSuccess }: AdminLoginProps) {
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      const res = await fetch(`${API_URL}/api/admin/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password }),
      });
      const data = await res.json();

      if (!res.ok) {
        setError(data.detail || 'Login failed');
        return;
      }

      setAdminToken(data.token);
      onSuccess();
    } catch {
      setError('Could not reach server');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex items-center justify-center pt-32">
      <form
        onSubmit={handleSubmit}
        className="w-full max-w-sm space-y-6 rounded-xl border border-outline-variant/10 bg-surface-container-low p-8"
      >
        <div>
          <h2 className="font-headline text-xl font-extrabold uppercase tracking-tight text-on-surface">
            Admin Login
          </h2>
          <p className="mt-1 text-xs text-on-surface-variant">
            Enter the admin password to access server settings.
          </p>
        </div>

        <div>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Password"
            autoFocus
            className="h-11 w-full rounded-lg border border-outline-variant/20 bg-surface-container-highest px-4 text-sm text-on-surface placeholder:text-on-surface-variant/40 focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
          />
        </div>

        {error && <p className="text-xs font-medium text-error">{error}</p>}

        <button
          type="submit"
          disabled={loading || !password}
          className="h-11 w-full rounded-lg bg-primary font-headline text-sm font-bold uppercase tracking-wider text-on-primary transition-all hover:bg-primary/90 disabled:opacity-50"
        >
          {loading ? 'Signing in...' : 'Sign In'}
        </button>
      </form>
    </div>
  );
}

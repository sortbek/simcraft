'use client';

import { useState } from 'react';
import { API_URL } from '../lib/api';
import { setAdminToken } from '../lib/adminAuth';
import Button from '../components/ui/Button';

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
      <form onSubmit={handleSubmit} className="card w-full max-w-sm space-y-6 p-8">
        <div>
          <h2 className="h-card">Admin Login</h2>
          <p className="mt-2 text-xs text-on-surface-variant">
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
            className="input-field"
          />
        </div>

        {error && <p className="text-xs font-medium text-negative">{error}</p>}

        <Button type="submit" variant="solid" disabled={loading || !password} className="w-full">
          {loading ? 'Signing in...' : 'Sign In'}
        </Button>
      </form>
    </div>
  );
}

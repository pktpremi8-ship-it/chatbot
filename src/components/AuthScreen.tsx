import React, { useState } from 'react';
import { ArrowLeft, Eye, EyeOff } from 'lucide-react';
import { apiRequest, setSessionToken } from '../lib/api';

interface AuthScreenProps {
  initialMode: 'login' | 'register';
  onBack: () => void;
  onAuthenticated: () => Promise<void>;
}

export const AuthScreen: React.FC<AuthScreenProps> = ({
  initialMode,
  onBack,
  onAuthenticated,
}) => {
  const [mode, setMode] = useState<'login' | 'register'>(initialMode);
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [workspaceName, setWorkspaceName] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setSubmitting(true);
    try {
      const endpoint = mode === 'register' ? '/api/auth/register' : '/api/auth/login';
      const payload =
        mode === 'register'
          ? { email, name, workspaceName, password }
          : { email, password };
      const res = await apiRequest<{ token: string }>(endpoint, {
        method: 'POST',
        body: JSON.stringify(payload),
      });
      setSessionToken(res.token);
      await onAuthenticated();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Authentication failed.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleDemoLogin = async () => {
    setError('');
    setSubmitting(true);
    try {
      const res = await apiRequest<{ token: string }>('/api/auth/demo', {
        method: 'POST',
      });
      setSessionToken(res.token);
      await onAuthenticated();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to open demo workspace.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 px-6 py-12">
      <div className="mx-auto max-w-md">
        <button
          type="button"
          onClick={onBack}
          className="inline-flex items-center gap-2 text-sm font-medium text-slate-600 hover:text-slate-900"
        >
          <ArrowLeft className="h-4 w-4" aria-hidden="true" />
          Back to KRESNA overview
        </button>

        <div className="mt-6 rounded-xl border border-slate-200 bg-white p-8">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-xl font-bold text-slate-950">
                {mode === 'login' ? 'Sign in to KRESNA' : 'Create your workspace'}
              </h1>
              <p className="mt-1 text-sm text-slate-600">
                {mode === 'login'
                  ? 'Access your chatbots, Gemini models, and conversation analytics.'
                  : 'Set up an isolated multi-tenant workspace in seconds.'}
              </p>
            </div>
          </div>

          <div className="mt-6 grid grid-cols-2 gap-1 rounded-lg bg-slate-100 p-1">
            <button
              type="button"
              onClick={() => {
                setMode('login');
                setError('');
              }}
              className={`rounded-md py-2 text-xs font-semibold transition-colors ${
                mode === 'login'
                  ? 'bg-white text-slate-900 shadow-xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              Sign In
            </button>
            <button
              type="button"
              onClick={() => {
                setMode('register');
                setError('');
              }}
              className={`rounded-md py-2 text-xs font-semibold transition-colors ${
                mode === 'register'
                  ? 'bg-white text-slate-900 shadow-xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              Create Account
            </button>
          </div>

          {error && (
            <div
              role="alert"
              className="mt-4 rounded-lg border border-red-200 bg-red-50 px-3.5 py-2.5 text-sm text-red-800"
            >
              {error}
            </div>
          )}

          <form onSubmit={handleSubmit} className="mt-5 space-y-4">
            {mode === 'register' && (
              <>
                <div>
                  <label htmlFor="auth-name" className="block text-xs font-medium text-slate-700">
                    Full Name
                  </label>
                  <input
                    id="auth-name"
                    type="text"
                    required
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="Alex Rivera"
                    className="mt-1.5 w-full rounded-lg border border-slate-300 px-3.5 py-2.5 text-sm text-slate-900 focus:border-blue-700 focus:outline-none"
                  />
                </div>
                <div>
                  <label htmlFor="auth-workspace" className="block text-xs font-medium text-slate-700">
                    Workspace / Company Name
                  </label>
                  <input
                    id="auth-workspace"
                    type="text"
                    value={workspaceName}
                    onChange={(e) => setWorkspaceName(e.target.value)}
                    placeholder="Acme Customer Ops"
                    className="mt-1.5 w-full rounded-lg border border-slate-300 px-3.5 py-2.5 text-sm text-slate-900 focus:border-blue-700 focus:outline-none"
                  />
                </div>
              </>
            )}

            <div>
              <label htmlFor="auth-email" className="block text-xs font-medium text-slate-700">
                Work Email
              </label>
              <input
                id="auth-email"
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@company.com"
                className="mt-1.5 w-full rounded-lg border border-slate-300 px-3.5 py-2.5 text-sm text-slate-900 focus:border-blue-700 focus:outline-none"
              />
            </div>

            <div>
              <label htmlFor="auth-password" className="block text-xs font-medium text-slate-700">
                Password
              </label>
              <div className="relative mt-1.5">
                <input
                  id="auth-password"
                  type={showPassword ? 'text' : 'password'}
                  required
                  minLength={8}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Minimum 8 characters"
                  className="w-full rounded-lg border border-slate-300 px-3.5 py-2.5 pr-10 text-sm text-slate-900 focus:border-blue-700 focus:outline-none"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((prev) => !prev)}
                  aria-label={showPassword ? 'Hide password' : 'Show password'}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 rounded p-1 text-slate-500 hover:text-slate-800"
                >
                  {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
            </div>

            <button
              type="submit"
              disabled={submitting}
              className="w-full rounded-lg bg-blue-700 px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-blue-800 disabled:opacity-60"
            >
              {submitting
                ? 'Please wait...'
                : mode === 'login'
                  ? 'Sign In'
                  : 'Create Workspace'}
            </button>
          </form>

          <div className="mt-6 border-t border-slate-200 pt-5">
            <button
              type="button"
              onClick={handleDemoLogin}
              disabled={submitting}
              className="w-full rounded-lg border border-slate-300 bg-slate-50 px-4 py-2.5 text-sm font-medium text-slate-900 transition-colors hover:bg-slate-100 disabled:opacity-60"
            >
              Continue with Demo Workspace (Northwind Operations)
            </button>
            <p className="mt-2 text-center text-xs text-slate-500">
              Signs into a live seeded workspace with sample chatbots and persisted conversation logs.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
};

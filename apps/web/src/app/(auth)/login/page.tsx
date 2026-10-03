'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { CheckCircle2, FlaskConical } from 'lucide-react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { Alert, Button, Field, Input } from '@/components/ui';
import { ApiError } from '@/lib/api';
import { useAuth } from '@/lib/auth';

const schema = z.object({ email: z.string().min(1, 'Enter your email address').email('Enter a valid email address'), password: z.string().min(1, 'Enter your password'), rememberMe: z.boolean() });
type Form = z.infer<typeof schema>;

// Seeded test accounts. They exist only in the sandbox database and hold fictional data.
const DEMO_PASSWORD = 'PayBridge-Demo-2026!';
const DEMO = [
  ['maker@acme.test', 'Maker'],
  ['approver@acme.test', 'Approver'],
  ['admin@acme.test', 'Company admin'],
  ['platform.admin@paybridge.test', 'Platform admin'],
] as const;

function signInMessage(err: unknown): string {
  if (err instanceof ApiError) {
    if (err.code === 'INVALID_CREDENTIALS') return 'Please check your email and password.';
    if (err.code === 'RATE_LIMITED') return 'Too many attempts. Please wait a minute and try again.';
    if (err.status >= 500 || err.code === 'NETWORK_ERROR') return 'The sandbox is not responding right now. Please try again shortly.';
    return err.message;
  }
  return 'Please try again.';
}

function LoginForm() {
  const { login, me, loading } = useAuth();
  const router = useRouter();
  const next = useSearchParams().get('next');
  const [error, setError] = useState<unknown>(null);
  const [pending, setPending] = useState<string | null>(null); // which action is in flight
  const [done, setDone] = useState(false);
  const { register, handleSubmit, formState } = useForm<Form>({ resolver: zodResolver(schema), defaultValues: { rememberMe: false } });
  const [forgot, setForgot] = useState(false);
  const target = next && next.startsWith('/') && !next.startsWith('//') ? next : '/dashboard';

  useEffect(() => {
    if (!loading && me && !done) router.replace(target);
  }, [loading, me, done, router, target]);

  const signIn = async (email: string, password: string, action: string, rememberMe = false) => {
    setError(null);
    setPending(action);
    try {
      const user = await login(email, password, rememberMe);
      setDone(true);
      // A brief confirmation before the redirect, so the transition does not feel abrupt.
      setTimeout(() => router.replace(!user.company && !user.isPlatformAdmin ? '/company' : target), 450);
    } catch (err) {
      setError(err);
      setPending(null);
    }
  };
  const busy = pending !== null;

  return (
    <div>
      <h1 className="text-[28px] leading-tight">Welcome back</h1>
      <p className="mt-2 text-muted-foreground">Sign in to your sandbox</p>

      <form onSubmit={handleSubmit((v) => signIn(v.email, v.password, 'form', v.rememberMe))} className="mt-8 space-y-5" noValidate>
        <Field label="Email address" htmlFor="email" error={formState.errors.email?.message}>
          <Input id="email" type="email" autoComplete="username" placeholder="you@example.test" invalid={Boolean(formState.errors.email)} disabled={busy} {...register('email')} />
        </Field>
        <Field label="Password" htmlFor="password" error={formState.errors.password?.message}>
          <Input id="password" type="password" autoComplete="current-password" invalid={Boolean(formState.errors.password)} disabled={busy} {...register('password')} />
        </Field>
        <div className="flex items-center justify-between gap-3">
          <label className="flex min-h-[44px] cursor-pointer items-center gap-2 text-sm">
            <input type="checkbox" className="h-4 w-4 rounded border-border text-primary focus-visible:ring-2 focus-visible:ring-primary/40" disabled={busy} {...register('rememberMe')} />
            Remember me
          </label>
          <button type="button" className="min-h-[44px] text-sm font-medium text-primary hover:underline" aria-expanded={forgot} aria-controls="forgot-help" onClick={() => setForgot((f) => !f)}>
            Forgot password?
          </button>
        </div>
        {forgot && (
          <div id="forgot-help" className="animate-fade-up">
            <Alert tone="info" title="No password reset in the sandbox">
              PayBridge sends no email, so there is no reset link. The demo accounts below all share one published password. For an account you registered yourself, register again with a new email.
            </Alert>
          </div>
        )}
        {error ? <Alert tone="bad" title="Unable to sign in." testId="error">{signInMessage(error)}</Alert> : null}
        {done ? (
          <div role="status" className="flex min-h-11 items-center justify-center gap-2 rounded-md bg-success-soft font-medium text-success">
            <CheckCircle2 aria-hidden="true" className="h-4 w-4" /> Signed in. Opening your workspace…
          </div>
        ) : (
          <Button type="submit" size="lg" className="w-full" loading={pending === 'form'} loadingLabel="Signing in…" disabled={busy}>
            Sign in
          </Button>
        )}
      </form>

      <div className="mt-8 rounded-xl border border-border bg-background p-4">
        <p className="flex items-center gap-2 text-sm font-semibold"><FlaskConical aria-hidden="true" className="h-4 w-4 text-primary" /> Sandbox Demo</p>
        <p className="mt-1 text-[13px] text-muted-foreground">Use demo credentials to explore the platform. All data is fictional.</p>
        <div className="mt-4">

      <Button variant="secondary" size="lg" className="w-full" loading={pending === 'demo'} loadingLabel="Signing in…" disabled={busy || done} onClick={() => signIn('maker@acme.test', DEMO_PASSWORD, 'demo')}>
        Continue with demo account
      </Button>
      <div className="mt-4">
        <p className="text-xs text-muted-foreground">Or sign in as a specific role:</p>
        <div className="mt-2 flex flex-wrap gap-2">
          {DEMO.map(([email, label]) => (
            <Button key={email} variant="secondary" size="sm" loading={pending === email} disabled={busy || done} onClick={() => signIn(email, DEMO_PASSWORD, email)}>
              {label}
            </Button>
          ))}
        </div>
      </div>
        </div>
      </div>

      <p className="mt-8 text-muted-foreground">
        New here?{' '}
        <Link href="/register" className="link">Register and onboard a company</Link>
      </p>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense>
      <LoginForm />
    </Suspense>
  );
}

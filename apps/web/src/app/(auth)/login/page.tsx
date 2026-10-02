'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { CheckCircle2 } from 'lucide-react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { Alert, Button, Field, Input } from '@/components/ui';
import { ApiError } from '@/lib/api';
import { useAuth } from '@/lib/auth';

const schema = z.object({ email: z.string().min(1, 'Enter your email address').email('Enter a valid email address'), password: z.string().min(1, 'Enter your password') });
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
  const { register, handleSubmit, formState } = useForm<Form>({ resolver: zodResolver(schema) });
  const target = next && next.startsWith('/') && !next.startsWith('//') ? next : '/dashboard';

  useEffect(() => {
    if (!loading && me && !done) router.replace(target);
  }, [loading, me, done, router, target]);

  const signIn = async (email: string, password: string, action: string) => {
    setError(null);
    setPending(action);
    try {
      const user = await login(email, password);
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

      <form onSubmit={handleSubmit((v) => signIn(v.email, v.password, 'form'))} className="mt-8 space-y-5" noValidate>
        <Field label="Email address" htmlFor="email" error={formState.errors.email?.message}>
          <Input id="email" type="email" autoComplete="username" placeholder="you@example.test" invalid={Boolean(formState.errors.email)} disabled={busy} {...register('email')} />
        </Field>
        <Field label="Password" htmlFor="password" error={formState.errors.password?.message}>
          <Input id="password" type="password" autoComplete="current-password" invalid={Boolean(formState.errors.password)} disabled={busy} {...register('password')} />
        </Field>
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

      <div className="my-8 flex items-center gap-3 text-xs font-medium uppercase tracking-wider text-ink-faint">
        <span className="h-px flex-1 bg-border" /> Sandbox access <span className="h-px flex-1 bg-border" />
      </div>

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

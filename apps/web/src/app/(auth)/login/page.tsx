'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { ErrorNote, Field } from '@/components/ui';
import { useAuth } from '@/lib/auth';

const schema = z.object({ email: z.string().email('Enter a valid email address'), password: z.string().min(1, 'Enter your password') });
type Form = z.infer<typeof schema>;

// Seeded test accounts. They exist only in the sandbox database and hold fictional data.
const DEMO = [
  ['maker@acme.test', 'Maker'],
  ['approver@acme.test', 'Approver'],
  ['admin@acme.test', 'Company admin'],
  ['platform.admin@paybridge.test', 'Platform admin'],
] as const;
const DEMO_PASSWORD = 'PayBridge-Demo-2026!';

function LoginForm() {
  const { login, me, loading } = useAuth();
  const router = useRouter();
  const next = useSearchParams().get('next');
  const [error, setError] = useState<unknown>(null);
  const { register, handleSubmit, setValue, formState } = useForm<Form>({ resolver: zodResolver(schema) });
  const target = next && next.startsWith('/') && !next.startsWith('//') ? next : '/dashboard';

  useEffect(() => {
    if (!loading && me) router.replace(target);
  }, [loading, me, router, target]);

  const submit = handleSubmit(async (values) => {
    setError(null);
    try {
      const user = await login(values.email, values.password);
      router.replace(!user.company && !user.isPlatformAdmin ? '/company' : target);
    } catch (err) {
      setError(err);
    }
  });

  return (
    <div className="card p-6">
      <h1>Sign in</h1>
      <p className="mt-1 text-ink-muted">Use a seeded test account or one you registered.</p>
      <form onSubmit={submit} className="mt-5 space-y-4" noValidate>
        <Field label="Email" htmlFor="email" error={formState.errors.email?.message}>
          <input id="email" type="email" autoComplete="username" className="input" {...register('email')} />
        </Field>
        <Field label="Password" htmlFor="password" error={formState.errors.password?.message}>
          <input id="password" type="password" autoComplete="current-password" className="input" {...register('password')} />
        </Field>
        <ErrorNote error={error} />
        <button type="submit" className="btn-primary w-full" disabled={formState.isSubmitting}>
          {formState.isSubmitting ? 'Signing in…' : 'Sign in'}
        </button>
      </form>
      <p className="mt-4 text-ink-muted">
        New here?{' '}
        <Link href="/register" className="link">
          Register and onboard a company
        </Link>
      </p>
      <div className="mt-5 border-t border-surface-line pt-4">
        <p className="text-xs font-semibold uppercase tracking-wide text-ink-muted">Sandbox test accounts</p>
        <div className="mt-2 flex flex-wrap gap-2">
          {DEMO.map(([email, label]) => (
            <button
              key={email}
              type="button"
              className="btn-secondary !min-h-0 !px-2.5 !py-1 text-xs"
              onClick={() => {
                setValue('email', email, { shouldValidate: true });
                setValue('password', DEMO_PASSWORD, { shouldValidate: true });
              }}
            >
              {label}
            </button>
          ))}
        </div>
        <p className="mt-2 text-xs text-ink-faint">Choosing one fills in the form. These accounts are available once the seed script has run.</p>
      </div>
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

'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { ErrorNote, Field } from '@/components/ui';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';

const schema = z
  .object({
    fullName: z.string().trim().min(2, 'Enter your name').max(120),
    email: z.string().email('Enter a valid email address'),
    password: z.string().min(12, 'Use at least 12 characters').max(128),
    confirm: z.string(),
  })
  .refine((v) => v.password === v.confirm, { path: ['confirm'], message: 'Passwords do not match' });
type Form = z.infer<typeof schema>;

export default function RegisterPage() {
  const { login } = useAuth();
  const router = useRouter();
  const [error, setError] = useState<unknown>(null);
  const { register, handleSubmit, formState } = useForm<Form>({ resolver: zodResolver(schema) });

  const submit = handleSubmit(async (values) => {
    setError(null);
    try {
      await api.post('/auth/register', { fullName: values.fullName, email: values.email, password: values.password }, { noRetry: true });
      await login(values.email, values.password);
      router.replace('/company');
    } catch (err) {
      setError(err);
    }
  });

  return (
    <div className="card p-6">
      <h1>Create an account</h1>
      <p className="mt-1 text-ink-muted">Next you will register a company and submit it for simulated KYB.</p>
      <form onSubmit={submit} className="mt-5 space-y-4" noValidate>
        <Field label="Full name" htmlFor="fullName" error={formState.errors.fullName?.message}>
          <input id="fullName" autoComplete="name" className="input" {...register('fullName')} />
        </Field>
        <Field label="Email" htmlFor="email" error={formState.errors.email?.message} hint="Use a made-up address such as you@example.test — no email is ever sent.">
          <input id="email" type="email" autoComplete="username" className="input" {...register('email')} />
        </Field>
        <Field label="Password" htmlFor="password" error={formState.errors.password?.message} hint="At least 12 characters. Do not reuse a real password.">
          <input id="password" type="password" autoComplete="new-password" className="input" {...register('password')} />
        </Field>
        <Field label="Confirm password" htmlFor="confirm" error={formState.errors.confirm?.message}>
          <input id="confirm" type="password" autoComplete="new-password" className="input" {...register('confirm')} />
        </Field>
        <ErrorNote error={error} />
        <button type="submit" className="btn-primary w-full" disabled={formState.isSubmitting}>
          {formState.isSubmitting ? 'Creating account…' : 'Create account'}
        </button>
      </form>
      <p className="mt-4 text-ink-muted">
        Already registered?{' '}
        <Link href="/login" className="link">
          Sign in
        </Link>
      </p>
    </div>
  );
}

'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { Button, ErrorNote, Field, Input } from '@/components/ui';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';

const schema = z
  .object({
    fullName: z.string().trim().min(2, 'Enter your name').max(120),
    email: z.string().min(1, 'Enter an email address').email('Enter a valid email address'),
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
  const e = formState.errors;

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
    <div>
      <h1 className="text-[28px] leading-tight">Create an account</h1>
      <p className="mt-2 text-muted-foreground">Next you will register a company and submit it for simulated KYB.</p>
      <form onSubmit={submit} className="mt-8 space-y-5" noValidate>
        <Field label="Full name" htmlFor="fullName" error={e.fullName?.message}>
          <Input id="fullName" autoComplete="name" invalid={Boolean(e.fullName)} {...register('fullName')} />
        </Field>
        <Field label="Email address" htmlFor="email" error={e.email?.message} hint="Use a made-up address such as you@example.test. No email is ever sent.">
          <Input id="email" type="email" autoComplete="username" invalid={Boolean(e.email)} {...register('email')} />
        </Field>
        <Field label="Password" htmlFor="password" error={e.password?.message} hint="At least 12 characters. Do not reuse a real password.">
          <Input id="password" type="password" autoComplete="new-password" invalid={Boolean(e.password)} {...register('password')} />
        </Field>
        <Field label="Confirm password" htmlFor="confirm" error={e.confirm?.message}>
          <Input id="confirm" type="password" autoComplete="new-password" invalid={Boolean(e.confirm)} {...register('confirm')} />
        </Field>
        <ErrorNote error={error} />
        <Button type="submit" size="lg" className="w-full" loading={formState.isSubmitting} loadingLabel="Creating account…">
          Create account
        </Button>
      </form>
      <p className="mt-8 text-muted-foreground">
        Already registered?{' '}
        <Link href="/login" className="link">Sign in</Link>
      </p>
    </div>
  );
}

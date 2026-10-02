export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <main className="mx-auto flex min-h-[calc(100vh-2rem)] w-full max-w-md flex-col justify-center px-4 py-10">
      <div className="mb-6 flex items-center gap-2">
        <span aria-hidden="true" className="flex h-8 w-8 items-center justify-center rounded-md bg-ink text-sm font-bold text-white">
          PB
        </span>
        <span className="text-lg font-semibold tracking-tight">PayBridge</span>
      </div>
      {children}
      <p className="mt-6 text-xs text-ink-faint">
        PayBridge is a learning project. It is not a bank or a licensed payment service, it moves no money, and nothing entered here should be real financial or identity data.
      </p>
    </main>
  );
}

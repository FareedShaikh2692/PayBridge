import type { Metadata } from 'next';
import { Footer } from '@/components/marketing/footer';
import { Navbar } from '@/components/marketing/navbar';
import { Container } from '@/components/ui';

export const metadata: Metadata = { title: 'Educational use, privacy and terms' };

const SECTIONS = [
  {
    id: 'educational-use',
    title: 'Educational use',
    body: [
      'PayBridge is a simulation built for learning and as an engineering portfolio project. It does not move money, is not connected to any bank, card network or payment rail, and cannot be used to send a remittance.',
      'PayBridge is not a bank, a money transmitter or a licensed financial institution, and it makes no claim of compliance with any regulation. The KYB, sanctions and PEP checks are deterministic mocks that verify nothing and must never be used to screen real people or companies.',
    ],
  },
  {
    id: 'privacy',
    title: 'Privacy',
    body: [
      'Do not enter real personal, identity or financial information. Use made-up names, an address such as you@example.test, and test account numbers.',
      'The sandbox stores what you type into it — account details you create, and an audit trail that includes your IP address and browser user agent — in a shared demonstration database. Demo accounts are public, so anything saved under them is visible to anyone else who signs in. Data may be reset at any time.',
      'A single first-party cookie keeps you signed in. There is no advertising, analytics or third-party tracking.',
    ],
  },
  {
    id: 'terms',
    title: 'Terms',
    body: [
      'The sandbox is provided as is, without warranty of any kind, for demonstration only. It may be unavailable, change or be removed without notice.',
      'Use it only for its intended purpose: exploring how a payment platform is built. Do not attempt to disrupt it or to store anything unlawful or sensitive in it.',
    ],
  },
];

export default function LegalPage() {
  return (
    <>
      <Navbar />
      <main className="py-12 md:py-16">
        <Container>
          <article className="mx-auto max-w-3xl">
            <p className="eyebrow">Legal</p>
            <h1 className="mt-3 text-3xl md:text-4xl">Educational use, privacy and terms</h1>
            <p className="mt-4 text-base text-muted-foreground">Plain-language notes for a learning project. This is not legal advice.</p>
            {SECTIONS.map((s) => (
              <section key={s.id} id={s.id} className="mt-12 scroll-mt-24">
                <h2 className="text-xl font-semibold tracking-tight">{s.title}</h2>
                {s.body.map((p) => <p key={p.slice(0, 24)} className="mt-3 text-muted-foreground">{p}</p>)}
              </section>
            ))}
          </article>
        </Container>
      </main>
      <Footer />
    </>
  );
}

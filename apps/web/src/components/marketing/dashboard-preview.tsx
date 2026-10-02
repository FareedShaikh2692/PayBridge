import { ArrowLeftRight, BookOpenCheck, FileClock, LayoutDashboard, Send, ShieldCheck, Users } from 'lucide-react';
import { LogoMark } from '@/components/brand';
import { StatusDonut, VolumeChart } from '@/components/charts';
import { StatusBadge } from '@/components/ui';

// Fictional figures for the preview.
const NAV = [[LayoutDashboard, 'Dashboard'], [Send, 'Payments'], [Users, 'Beneficiaries'], [ArrowLeftRight, 'Quotes'], [BookOpenCheck, 'Ledger'], [ShieldCheck, 'Compliance'], [FileClock, 'Audit']] as const;
const VOLUME = ['10000.00', '0.00', '18500.00', '0.00', '42000.00', '26400.00', '7300.00', '3250.50', '0.00', '26400.00', '15750.00', '5600.00', '31200.00', '22000.00'].map((amount, i) => ({ date: new Date(Date.UTC(2026, 8, 19 + i)).toISOString().slice(0, 10), amount, count: amount === '0.00' ? 0 : 1 }));
const STATUS = [{ status: 'PAID', count: 14 }, { status: 'PROCESSING', count: 2 }, { status: 'COMPLIANCE_REVIEW', count: 1 }, { status: 'FAILED', count: 1 }];
const PAYMENTS: [string, string, string, string][] = [['Rahul Sharma', '10,000.00', '225,865.00', 'PAID'], ['Priya Enterprises', '7,500.00', '169,398.75', 'PROCESSING'], ['Mumbai Supplies Pvt Ltd', '75,000.00', '1,693,987.50', 'COMPLIANCE_REVIEW'], ['Kolkata Textiles', '7,300.00', '164,881.45', 'FAILED']];

/** A static, faithful miniature of the application's dashboard, built from the same components the app uses. */
export function DashboardPreview() {
  return (
    <div className="card overflow-hidden shadow-overlay" role="img" aria-label="Preview of the PayBridge dashboard showing balance, payment volume, status breakdown and recent payments">
      <div className="flex items-center gap-2 border-b border-border bg-muted/60 px-4 py-2.5" aria-hidden="true">
        <span className="h-2.5 w-2.5 rounded-full bg-border" /><span className="h-2.5 w-2.5 rounded-full bg-border" /><span className="h-2.5 w-2.5 rounded-full bg-border" />
        <span className="num ml-3 truncate rounded-md border border-border bg-card px-3 py-0.5 text-[11px] text-muted-foreground">paybridge · /dashboard</span>
      </div>
      <div className="grid md:grid-cols-[190px_1fr]" aria-hidden="true">
        <aside className="hidden border-r border-border bg-card p-3 md:block">
          <div className="mb-4 flex items-center gap-2 px-2 pt-1"><LogoMark size={22} /><span className="text-sm font-semibold">PayBridge</span></div>
          <ul className="space-y-0.5">
            {NAV.map(([Icon, label], i) => (
              <li key={label} className={`flex items-center gap-2.5 rounded-md px-2 py-1.5 text-[13px] font-medium ${i === 0 ? 'bg-primary-soft text-primary' : 'text-muted-foreground'}`}>
                <Icon className="h-4 w-4" /> {label}
              </li>
            ))}
          </ul>
        </aside>
        <div className="min-w-0 bg-background p-4 md:p-5">
          <div className="mb-4 flex items-center justify-between gap-3">
            <div>
              <p className="text-base font-semibold tracking-tight">Good afternoon, Omar</p>
              <p className="text-xs text-muted-foreground">Acme Trading LLC · KYB approved</p>
            </div>
            <span className="btn-primary btn-sm pointer-events-none">New payment</span>
          </div>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            {[['Available balance', 'AED 296,899.50', 'AED 87,050.00 reserved'], ['Total sent', 'AED 115,900.50', '14 payments'], ['Pending', '3', '1 awaiting approval'], ['Fees', 'AED 350.00', 'On paid payments']].map(([label, value, sub]) => (
              <div key={label} className="card p-3.5">
                <p className="text-[11px] font-medium text-muted-foreground">{label}</p>
                <p className="num mt-1 truncate text-lg font-semibold tracking-tight">{value}</p>
                <p className="mt-0.5 truncate text-[11px] text-muted-foreground">{sub}</p>
              </div>
            ))}
          </div>
          <div className="mt-3 grid gap-3 lg:grid-cols-[1.5fr_1fr]">
            <div className="card p-4">
              <p className="mb-2 text-[13px] font-semibold">Payment volume</p>
              <VolumeChart data={VOLUME} currency="AED" compact />
            </div>
            <div className="card p-4">
              <p className="mb-3 text-[13px] font-semibold">Payment status</p>
              <StatusDonut data={STATUS} size={112} />
            </div>
          </div>
          <div className="card mt-3 overflow-hidden">
            <p className="border-b border-border px-4 py-2.5 text-[13px] font-semibold">Recent payments</p>
            <div className="table-wrap">
              <table className="table text-[13px]">
                <tbody>
                  {PAYMENTS.map(([name, aed, inr, status]) => (
                    <tr key={name}>
                      <td className="font-medium">{name}</td>
                      <td className="num text-right"><span className="mr-1 text-[11px] text-muted-foreground">AED</span>{aed}</td>
                      <td className="num hidden text-right sm:table-cell"><span className="mr-1 text-[11px] text-muted-foreground">INR</span>{inr}</td>
                      <td className="text-right"><StatusBadge value={status} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

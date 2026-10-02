import { Injectable } from '@nestjs/common';
import { LedgerTransactionType, Prisma } from '@paybridge/database';
import { ACCOUNTS, AccountKey, TemplateEntry, checkBalanced, dec, money, postingKey, postings } from '@paybridge/shared';
import { randomUUID } from 'node:crypto';
import { Actor, assertCompanyAccess, tenantWhere } from '../../common/actor';
import { DomainError } from '../../common/errors';
import { PageQuery, paged, skipTake } from '../../common/pagination';
import { Db, PrismaService, Tx } from '../../common/prisma.service';
import { AuditService } from '../audit/audit.service';

export interface PostingInput {
  postingKey: string;
  type: LedgerTransactionType;
  description: string;
  entries: TemplateEntry[];
  companyId?: string | null;
  paymentId?: string | null;
  reversesTransactionId?: string | null;
  createdById?: string | null;
}

interface LockedAccount {
  id: string;
  balance: Prisma.Decimal;
  normal_balance: 'DEBIT' | 'CREDIT';
  company_id: string | null;
}

/**
 * Double-entry ledger (docs/LEDGER.md). The only code path that changes a balance.
 * Every posting is balanced per currency, idempotent by posting key, and append-only.
 */
@Injectable()
export class LedgerService {
  private readonly systemAccountIds = new Map<string, string>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  /** Creates the wallet and hold accounts for a company. Idempotent. */
  async provisionCompanyAccounts(tx: Tx, companyId: string): Promise<void> {
    for (const acc of Object.values(ACCOUNTS)) {
      if (acc.scope !== 'COMPANY') continue;
      await tx.ledgerAccount.upsert({
        where: { companyId_code: { companyId, code: acc.code } },
        update: {},
        create: { companyId, code: acc.code, name: acc.name, type: acc.type, normalBalance: acc.normal, currency: acc.currency },
      });
    }
  }

  private async resolveAccountId(db: Db, key: AccountKey, companyId: string | null | undefined): Promise<string> {
    const def = ACCOUNTS[key];
    if (def.scope === 'SYSTEM') {
      const cached = this.systemAccountIds.get(def.code);
      if (cached) return cached;
      const acc = await db.ledgerAccount.findFirst({ where: { companyId: null, code: def.code }, select: { id: true } });
      if (!acc) throw new Error(`System ledger account ${def.code} is missing; run the reference-data bootstrap.`);
      this.systemAccountIds.set(def.code, acc.id);
      return acc.id;
    }
    if (!companyId) throw new Error(`Posting to ${key} requires a company.`);
    const acc = await db.ledgerAccount.findUnique({ where: { companyId_code: { companyId, code: def.code } }, select: { id: true } });
    if (!acc) throw new DomainError('KYB_NOT_APPROVED', 'The company has no wallet yet. Wallets are created when KYB is approved.');
    return acc.id;
  }

  /** LEDGER.md §7. Must be called inside the caller's transaction so the posting commits with the state change. */
  async post(tx: Tx, input: PostingInput) {
    const check = checkBalanced(input.entries);
    if (!check.balanced) throw new DomainError('LEDGER_IMBALANCE', undefined, check.problems);

    const existing = await tx.ledgerTransaction.findUnique({ where: { postingKey: input.postingKey }, include: { entries: true } });
    if (existing) return existing; // idempotent: this step was already posted

    const resolved = [] as { accountId: string; entry: TemplateEntry }[];
    for (const entry of input.entries) {
      resolved.push({ accountId: await this.resolveAccountId(tx, entry.account, input.companyId), entry });
    }

    // Lock every touched account in a fixed order so concurrent postings cannot deadlock.
    const ids = [...new Set(resolved.map((r) => r.accountId))].sort();
    const locked = await tx.$queryRaw<LockedAccount[]>`
      SELECT id, balance, normal_balance, company_id FROM ledger_accounts
      WHERE id IN (${Prisma.join(ids.map((id) => Prisma.sql`${id}::uuid`))})
      ORDER BY id FOR UPDATE`;
    const running = new Map(locked.map((a) => [a.id, { balance: dec(a.balance.toString()), normal: a.normal_balance, customer: a.company_id !== null }]));

    const rows = resolved.map(({ accountId, entry }) => {
      const acc = running.get(accountId)!;
      const amount = dec(entry.amount);
      acc.balance = entry.direction === acc.normal ? acc.balance.plus(amount) : acc.balance.minus(amount);
      if (acc.customer && acc.balance.isNegative()) throw new DomainError('INSUFFICIENT_FUNDS');
      return { accountId, direction: entry.direction, amount: entry.amount, currency: entry.currency, balanceAfter: acc.balance.toFixed(2) };
    });

    const created = await tx.ledgerTransaction.create({
      data: {
        postingKey: input.postingKey,
        type: input.type,
        description: input.description,
        companyId: input.companyId ?? null,
        paymentId: input.paymentId ?? null,
        reversesTransactionId: input.reversesTransactionId ?? null,
        createdById: input.createdById ?? null,
      },
    });
    await tx.ledgerEntry.createMany({ data: rows.map((r) => ({ ...r, transactionId: created.id })) });
    for (const [id, acc] of running) {
      await tx.ledgerAccount.update({ where: { id }, data: { balance: acc.balance.toFixed(2), version: { increment: 1 } } });
    }
    await this.audit.record(tx, {
      action: 'LEDGER_POSTED',
      entityType: 'ledger_transaction',
      entityId: created.id,
      companyId: input.companyId ?? null,
      newValue: { postingKey: input.postingKey, type: input.type, paymentId: input.paymentId ?? null, totals: check.byCurrency },
    });
    return { ...created, entries: rows };
  }

  // ── Sandbox funding ──

  async topup(actor: Actor, companyId: string, amount: string, idempotencyKey?: string) {
    const value = dec(amount);
    if (value.lte(0) || value.gt('1000000')) throw new DomainError('AMOUNT_OUT_OF_RANGE', 'Top-up must be between 0.01 and 1,000,000.00 AED.');
    const id = idempotencyKey ? `${companyId}:${idempotencyKey}` : randomUUID();
    return this.prisma.transaction(async (tx) => {
      const posted = await this.post(tx, {
        postingKey: postingKey.topup(id),
        type: 'WALLET_TOPUP',
        description: 'Simulated wallet funding (sandbox)',
        entries: postings.walletTopup(amount),
        companyId,
        createdById: actor.userId,
      });
      await this.audit.record(tx, { action: 'WALLET_TOPPED_UP', entityType: 'company', entityId: companyId, companyId, newValue: { amount: money(amount) } });
      return { transactionId: posted.id, ...(await this.balance(tx, companyId)) };
    });
  }

  // ── Reads ──

  async balance(db: Db, companyId: string) {
    const accounts = await db.ledgerAccount.findMany({ where: { companyId, code: { in: [ACCOUNTS.CUSTOMER_WALLET_AED.code, ACCOUNTS.CUSTOMER_HOLD_AED.code] } } });
    const wallet = accounts.find((a) => a.code === ACCOUNTS.CUSTOMER_WALLET_AED.code);
    const hold = accounts.find((a) => a.code === ACCOUNTS.CUSTOMER_HOLD_AED.code);
    return { companyId, currency: 'AED', available: money(wallet?.balance ?? '0'), reserved: money(hold?.balance ?? '0'), provisioned: Boolean(wallet) };
  }

  async getBalance(actor: Actor, companyId: string) {
    assertCompanyAccess(actor, companyId);
    return this.balance(this.prisma.client, companyId);
  }

  async listAccounts(actor: Actor, companyId?: string) {
    const where = actor.isPlatformAdmin ? (companyId ? { companyId } : {}) : tenantWhere(actor);
    const accounts = await this.prisma.client.ledgerAccount.findMany({ where, orderBy: [{ code: 'asc' }, { createdAt: 'asc' }], include: { company: { select: { name: true } } } });
    return accounts.map((a) => this.accountView(a));
  }

  async getAccount(actor: Actor, id: string, q: PageQuery) {
    const account = await this.prisma.client.ledgerAccount.findFirst({
      where: { id, ...(actor.isPlatformAdmin ? {} : tenantWhere(actor)) },
      include: { company: { select: { name: true } } },
    });
    if (!account) throw new DomainError('NOT_FOUND', 'The ledger account was not found.');
    const [entries, total] = await Promise.all([
      this.prisma.client.ledgerEntry.findMany({ where: { accountId: id }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], ...skipTake(q), include: { transaction: true } }),
      this.prisma.client.ledgerEntry.count({ where: { accountId: id } }),
    ]);
    return {
      account: this.accountView(account),
      entries: entries.map((e) => ({
        id: e.id,
        direction: e.direction,
        amount: money(e.amount),
        currency: e.currency,
        balanceAfter: money(e.balanceAfter),
        createdAt: e.createdAt,
        transaction: { id: e.transaction.id, type: e.transaction.type, description: e.transaction.description, paymentId: e.transaction.paymentId, postingKey: e.transaction.postingKey },
      })),
      meta: paged([], total, q).meta,
    };
  }

  async listTransactions(actor: Actor, q: PageQuery & { paymentId?: string; type?: LedgerTransactionType; companyId?: string }) {
    // Company users see transactions that touch their company; system-only postings are platform-internal.
    const where: Prisma.LedgerTransactionWhereInput = {
      ...(actor.isPlatformAdmin ? (q.companyId ? { companyId: q.companyId } : {}) : tenantWhere(actor)),
      ...(q.paymentId ? { paymentId: q.paymentId } : {}),
      ...(q.type ? { type: q.type } : {}),
    };
    const [items, total] = await Promise.all([
      this.prisma.client.ledgerTransaction.findMany({
        where,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        ...skipTake(q),
        include: { entries: { include: { account: { select: { code: true, name: true, companyId: true } } } }, payment: { select: { reference: true } } },
      }),
      this.prisma.client.ledgerTransaction.count({ where }),
    ]);
    return paged(items.map((t) => this.transactionView(t)), total, q);
  }

  transactionView(t: any) {
    const entries = (t.entries as any[]).map((e) => ({
      id: e.id,
      accountId: e.accountId,
      accountCode: e.account?.code,
      accountName: e.account?.name,
      direction: e.direction,
      amount: money(e.amount),
      currency: e.currency,
    }));
    return {
      id: t.id,
      postingKey: t.postingKey,
      type: t.type,
      description: t.description,
      companyId: t.companyId,
      paymentId: t.paymentId,
      paymentReference: t.payment?.reference ?? null,
      reversesTransactionId: t.reversesTransactionId,
      createdAt: t.createdAt,
      entries: entries.sort((a, b) => (a.direction === b.direction ? 0 : a.direction === 'DEBIT' ? -1 : 1)),
      totals: checkBalanced(entries).byCurrency,
      balanced: checkBalanced(entries).balanced,
    };
  }

  private accountView(a: any) {
    return {
      id: a.id,
      code: a.code,
      name: a.name,
      type: a.type,
      normalBalance: a.normalBalance,
      currency: a.currency,
      balance: money(a.balance),
      companyId: a.companyId,
      companyName: a.company?.name ?? null,
      scope: a.companyId ? 'COMPANY' : 'SYSTEM',
    };
  }

  /** Whole-ledger proof: debits equal credits per currency, and every cached balance equals the sum of its entries. */
  async trialBalance(db: Db = this.prisma.client) {
    const totals = await db.$queryRaw<{ currency: string; debit: Prisma.Decimal; credit: Prisma.Decimal }[]>`
      SELECT currency,
             COALESCE(SUM(amount) FILTER (WHERE direction = 'DEBIT'), 0) AS debit,
             COALESCE(SUM(amount) FILTER (WHERE direction = 'CREDIT'), 0) AS credit
      FROM ledger_entries GROUP BY currency ORDER BY currency`;
    const drift = await db.$queryRaw<{ id: string; code: string; cached: Prisma.Decimal; computed: Prisma.Decimal }[]>`
      SELECT a.id, a.code, a.balance AS cached,
             COALESCE(SUM(CASE WHEN e.direction = a.normal_balance THEN e.amount ELSE -e.amount END), 0) AS computed
      FROM ledger_accounts a LEFT JOIN ledger_entries e ON e.account_id = a.id
      GROUP BY a.id HAVING a.balance <> COALESCE(SUM(CASE WHEN e.direction = a.normal_balance THEN e.amount ELSE -e.amount END), 0)`;
    const unbalanced = await db.$queryRaw<{ transaction_id: string; currency: string }[]>`
      SELECT transaction_id, currency FROM ledger_entries GROUP BY transaction_id, currency
      HAVING SUM(CASE WHEN direction = 'DEBIT' THEN amount ELSE -amount END) <> 0`;
    const currencies = totals.map((t) => ({
      currency: t.currency.trim(),
      debit: money(t.debit),
      credit: money(t.credit),
      difference: money(dec(t.debit.toString()).minus(t.credit.toString())),
    }));
    return {
      balanced: currencies.every((c) => dec(c.difference).isZero()) && unbalanced.length === 0,
      currencies,
      unbalancedTransactions: unbalanced.map((u) => ({ transactionId: u.transaction_id, currency: u.currency.trim() })),
      cachedBalanceDrift: drift.map((d) => ({ accountId: d.id, code: d.code, cached: money(d.cached), computed: money(d.computed) })),
    };
  }
}

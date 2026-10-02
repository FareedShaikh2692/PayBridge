export interface Me {
  user: { id: string; email: string; fullName: string };
  role: string | null;
  isPlatformAdmin: boolean;
  permissions: string[];
  company: { id: string; name: string; kybStatus: string; kybProfileId: string | null; makerCheckerEnabled: boolean } | null;
}

export interface Beneficiary {
  id: string;
  companyId: string;
  name: string;
  country: string;
  bankName: string;
  accountNumberMasked: string;
  ifsc: string;
  accountHolderName: string;
  status: 'ACTIVE' | 'INACTIVE' | 'BLOCKED';
  screeningResult: string | null;
  createdAt: string;
  paymentCount?: number;
  companyName?: string;
}

export interface Quote {
  id: string;
  baseCurrency: string;
  quoteCurrency: string;
  baseAmount: string;
  midMarketRate: string;
  spreadPercentage: string;
  customerRate: string;
  feeAmount: string;
  fxMarginAmount: string;
  totalDebitAmount: string;
  recipientAmount: string;
  status: 'ACTIVE' | 'EXPIRED' | 'USED' | 'CANCELLED';
  createdAt: string;
  expiresAt: string;
  secondsRemaining: number;
  serverTime: string;
  paymentId: string | null;
  paymentReference: string | null;
  createdByName: string | null;
}

export interface LedgerEntryView {
  id: string;
  accountCode: string;
  accountName: string;
  direction: 'DEBIT' | 'CREDIT';
  amount: string;
  currency: string;
}
export interface LedgerTransaction {
  id: string;
  postingKey: string;
  type: string;
  description: string;
  companyId: string | null;
  paymentId: string | null;
  paymentReference: string | null;
  reversesTransactionId: string | null;
  createdAt: string;
  entries: LedgerEntryView[];
  totals: Record<string, { debit: string; credit: string }>;
  balanced: boolean;
}

export interface Payment {
  id: string;
  reference: string;
  companyId: string;
  companyName: string | null;
  beneficiaryId: string;
  quoteId: string;
  sourceCurrency: string;
  sourceAmount: string;
  destinationCurrency: string;
  destinationAmount: string;
  feeAmount: string;
  totalDebitAmount: string;
  exchangeRate: string;
  status: string;
  complianceStatus: string;
  approvalStatus: string;
  displayStatus: string;
  cancellationReason: string | null;
  failureReason: string | null;
  purpose: string | null;
  providerPaymentId: string | null;
  createdById: string;
  createdByName: string | null;
  beneficiary?: { id: string; name: string; bankName: string; accountNumberMasked: string; ifsc: string; country: string };
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
}

export interface PaymentDetail extends Payment {
  timeline: { id: string; fromStatus: string | null; toStatus: string; reason: string | null; actorType: string; createdAt: string }[];
  complianceChecks: { id: string; ruleCode: string; ruleName: string; triggered: boolean; outcome: string; details: any; decidedByName: string | null; decisionNote: string | null; createdAt: string }[];
  approval: { id: string; status: string; requestedByName: string; createdAt: string; resolvedAt: string | null; actions: { id: string; action: string; actorName: string; reason: string | null; createdAt: string }[] } | null;
  ledgerTransactions: LedgerTransaction[];
}

export interface Company {
  id: string;
  name: string;
  country: string;
  tradeLicenseNumber: string;
  tradeLicenseExpiry: string;
  registrationNumber: string;
  businessType: string;
  registeredAddress: string;
  contactEmail: string;
  contactPhone: string;
  website: string | null;
  status: string;
  makerCheckerEnabled: boolean;
  kybStatus: string;
  kybProfileId: string | null;
  kybRiskLevel: string | null;
  kybSubmittedAt: string | null;
  createdAt: string;
  memberCount?: number;
  paymentCount?: number;
}

export interface Kyb {
  id: string;
  companyId: string;
  status: string;
  submittedAt: string | null;
  reviewedAt: string | null;
  reviewedByName: string | null;
  riskLevel: string | null;
  verificationResult: { provider: string; result: string; riskLevel: string; reasons: string[]; checkedAt: string } | null;
  rejectionReason: string | null;
  expiresAt: string | null;
}

export interface Balance {
  companyId: string;
  currency: string;
  available: string;
  reserved: string;
  provisioned: boolean;
}

export interface DashboardSummary {
  balance: { available: string; reserved: string; currency: string; provisioned: boolean } | null;
  totals: { totalSent: string; totalFees: string; totalDelivered: string; pendingPayments: number; completedPayments: number; failedPayments: number; cancelledPayments: number; complianceReviews: number; awaitingApproval: number };
  statusDistribution: { status: string; count: number }[];
  volume: { date: string; amount: string; count: number }[];
  recentPayments: Payment[];
  fx: { midMarketRate: string; spreadPercentage: string; customerRate: string; feeAmount: string; minAmount: string; maxAmount: string; quoteTtlSeconds: number; source: string; asOf: string };
  alerts: { level: 'warning' | 'danger' | 'info'; message: string; href: string }[];
  platform: { companies: number; kybPending: number; deadLetters: number; lastReconciliation: { id: string; startedAt: string; totalItems: number; issueCount: number } | null } | null;
}

export type HouseholdRole = 'CONSUMER' | 'PROSUMER' | 'HYBRID';
export type MeterStatus = 'ONLINE' | 'LOW_RESERVE' | 'ISLANDED';
export type TransactionType =
  | 'C2B_STK_DEPOSIT'
  | 'P2P_METER_DEDUCTION'
  | 'P2P_PROSUMER_CREDIT'
  | 'B2C_MPESA_WITHDRAWAL';
export type TransactionStatus = 'PENDING' | 'COMPLETED' | 'FAILED';

export interface DailyMetricRecord {
  dateStr: string;
  dayLabel: string;
  consumedKwh: number;
  exportedKwh: number;
  costKes: number;
  revenueKes: number;
  peakHourKw: number;
}

export interface EnergyTransactionRecord {
  id: string;
  ownerId: string;
  householdId: string;
  txType: TransactionType;
  amountKwh: number;
  amountKes: number;
  mpesaReceipt: string;
  counterpartyMeter: string;
  status: TransactionStatus;
  createdAtIso: string;
}

export interface HouseholdNodeState {
  id: string;
  ownerId: string;
  meterNumber: string;
  houseName: string;
  neighborhood: string;
  role: HouseholdRole;
  tokenBalanceKwh: number;
  withdrawableBalanceKes: number;
  totalExportedKwh: number;
  totalConsumedKwh: number;
  tariffKesPerKwh: number;
  status: MeterStatus;
  updatedAtIso: string;
}

export interface SmartDepositPrediction {
  averageDailyUsageKwh: number;
  daysRemainingInMonth: number;
  safetyBufferDays: number;
  projectedKwhNeeded: number;
  currentBalanceKwh: number;
  netDeficitKwh: number;
  suggestedDepositKes: number;
  suggestedTokensKwh: number;
  estimatedAutonomyDays: number;
  urgencyLevel: 'OPTIMAL' | 'MODERATE' | 'CRITICAL';
}

export function normalizeMpesaPhone(rawInput: string): string | null {
  const cleaned = rawInput.replace(/[\s\-()]/g, '');
  if (/^0[17][0-9]{8}$/.test(cleaned)) {
    return `+254${cleaned.slice(1)}`;
  }
  if (/^254[17][0-9]{8}$/.test(cleaned)) {
    return `+${cleaned}`;
  }
  if (/^\+?254[17][0-9]{8}$/.test(cleaned)) {
    return cleaned.startsWith('+') ? cleaned : `+${cleaned}`;
  }
  return null;
}

export function generateDarajaReceipt(prefix: string = 'SJK'): string {
  const chars = '0123456789ABCDEFGHJKLMNPQRSTUVWXYZ';
  let out = prefix;
  for (let i = 0; i < 7; i++) {
    out += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return out;
}

export function calculateSmartDepositPrediction(params: {
  dailyMetrics: Pick<DailyMetricRecord, 'consumedKwh'>[];
  currentBalanceKwh: number;
  tariffKesPerKwh: number;
  currentDate?: Date;
  safetyBufferDays?: number;
}): SmartDepositPrediction {
  const {
    dailyMetrics,
    currentBalanceKwh,
    tariffKesPerKwh,
    currentDate = new Date(),
    safetyBufferDays = 3,
  } = params;

  const validDays = dailyMetrics.filter((d) => d.consumedKwh >= 0);
  const totalUsage = validDays.reduce((acc, item) => acc + item.consumedKwh, 0);
  const averageDailyUsageKwh =
    validDays.length > 0 ? Number((totalUsage / validDays.length).toFixed(2)) : 6.5;

  const year = currentDate.getUTCFullYear();
  const month = currentDate.getUTCMonth();
  const todayDay = currentDate.getUTCDate();
  const daysInMonth = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  const daysRemainingInMonth = Math.max(1, daysInMonth - todayDay + 1);

  const targetCoverageDays = daysRemainingInMonth + Math.max(0, safetyBufferDays);
  const projectedKwhNeeded = Number((averageDailyUsageKwh * targetCoverageDays).toFixed(2));
  const rawDeficit = Math.max(0, projectedKwhNeeded - Math.max(0, currentBalanceKwh));

  const suggestedTokensKwh =
    rawDeficit > 0
      ? Number((Math.ceil(rawDeficit * 2) / 2).toFixed(2))
      : Number((averageDailyUsageKwh * 3).toFixed(1));

  const rawKes = suggestedTokensKwh * tariffKesPerKwh;
  const suggestedDepositKes = Math.max(50, Math.ceil(rawKes / 10) * 10);
  const alignedTokensKwh = Number((suggestedDepositKes / tariffKesPerKwh).toFixed(2));

  const estimatedAutonomyDays =
    averageDailyUsageKwh > 0
      ? Number((currentBalanceKwh / averageDailyUsageKwh).toFixed(1))
      : 99;

  let urgencyLevel: 'OPTIMAL' | 'MODERATE' | 'CRITICAL' = 'OPTIMAL';
  if (estimatedAutonomyDays < 3) {
    urgencyLevel = 'CRITICAL';
  } else if (estimatedAutonomyDays < daysRemainingInMonth) {
    urgencyLevel = 'MODERATE';
  }

  return {
    averageDailyUsageKwh,
    daysRemainingInMonth,
    safetyBufferDays,
    projectedKwhNeeded,
    currentBalanceKwh: Number(currentBalanceKwh.toFixed(2)),
    netDeficitKwh: Number(rawDeficit.toFixed(2)),
    suggestedDepositKes,
    suggestedTokensKwh: alignedTokensKwh,
    estimatedAutonomyDays,
    urgencyLevel,
  };
}

export const INITIAL_METRICS: DailyMetricRecord[] = [
  { dateStr: '2026-10-23', dayLabel: 'Oct 23', consumedKwh: 6.8, exportedKwh: 13.6, costKes: 125.8, revenueKes: 245.3, peakHourKw: 3.8 },
  { dateStr: '2026-10-24', dayLabel: 'Oct 24', consumedKwh: 7.2, exportedKwh: 14.8, costKes: 133.2, revenueKes: 267.0, peakHourKw: 4.1 },
  { dateStr: '2026-10-25', dayLabel: 'Oct 25', consumedKwh: 6.4, exportedKwh: 12.5, costKes: 118.4, revenueKes: 225.5, peakHourKw: 3.5 },
  { dateStr: '2026-10-26', dayLabel: 'Oct 26', consumedKwh: 8.0, exportedKwh: 15.2, costKes: 148.0, revenueKes: 274.2, peakHourKw: 4.3 },
  { dateStr: '2026-10-27', dayLabel: 'Oct 27', consumedKwh: 7.5, exportedKwh: 14.1, costKes: 138.75, revenueKes: 254.3, peakHourKw: 3.9 },
  { dateStr: '2026-10-28', dayLabel: 'Oct 28', consumedKwh: 7.1, exportedKwh: 15.0, costKes: 131.35, revenueKes: 270.6, peakHourKw: 4.2 },
  { dateStr: '2026-10-29', dayLabel: 'Oct 29', consumedKwh: 6.9, exportedKwh: 13.9, costKes: 127.65, revenueKes: 250.7, peakHourKw: 4.0 },
];

export const INITIAL_HOUSEHOLD: HouseholdNodeState = {
  id: 'house_kilimani_b4',
  ownerId: 'demo_local_owner',
  meterNumber: 'KPLC-882104',
  houseName: 'Kilimani Solar Court B4',
  neighborhood: 'Kilimani Feeder #04 · Nairobi',
  role: 'HYBRID',
  tokenBalanceKwh: 54.6,
  withdrawableBalanceKes: 6840.0,
  totalExportedKwh: 382.9,
  totalConsumedKwh: 218.9,
  tariffKesPerKwh: 18.5,
  status: 'ONLINE',
  updatedAtIso: new Date().toISOString(),
};

export const INITIAL_TRANSACTIONS: EnergyTransactionRecord[] = [
  {
    id: 'tx_01',
    ownerId: 'demo_local_owner',
    householdId: 'house_kilimani_b4',
    txType: 'C2B_STK_DEPOSIT',
    amountKwh: 32.43,
    amountKes: 600,
    mpesaReceipt: 'SJK72N48QP',
    counterpartyMeter: 'MPESA-PAYBILL-409200',
    status: 'COMPLETED',
    createdAtIso: '2026-10-29T10:14:00Z',
  },
  {
    id: 'tx_02',
    ownerId: 'demo_local_owner',
    householdId: 'house_kilimani_b4',
    txType: 'P2P_METER_DEDUCTION',
    amountKwh: 4.5,
    amountKes: 83.25,
    mpesaReceipt: 'P2P-8821-4921',
    counterpartyMeter: 'KPLC-882105 (Block A)',
    status: 'COMPLETED',
    createdAtIso: '2026-10-29T08:30:00Z',
  },
  {
    id: 'tx_03',
    ownerId: 'demo_local_owner',
    householdId: 'house_kilimani_b4',
    txType: 'B2C_MPESA_WITHDRAWAL',
    amountKwh: 0,
    amountKes: 1500,
    mpesaReceipt: 'SJI93M11XY',
    counterpartyMeter: '+254712345678',
    status: 'COMPLETED',
    createdAtIso: '2026-10-28T16:45:00Z',
  },
];

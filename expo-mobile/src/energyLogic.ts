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
      ? Number(Math.ceil(rawDeficit * 2) / 2)
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

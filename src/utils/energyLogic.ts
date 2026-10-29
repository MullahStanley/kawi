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
  webhookVerified?: boolean;
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

export interface IoTMeterReadingPayload {
  consumerMeter: string;
  prosumerMeter: string;
  deltaKwh: number;
  voltageV: number;
  frequencyHz: number;
  timestampIso: string;
}

export interface PeerNodeSummary {
  meterNumber: string;
  houseName: string;
  role: 'PROSUMER' | 'CONSUMER';
  distanceMeters: number;
  currentOutputKw: number;
  sharedTodayKwh: number;
  tariffKes: number;
}

// Validation constants synchronized verbatim with firebase-blueprint.json
export const VALIDATION_CONSTRAINTS = {
  ID_MAX_LEN: 128,
  ID_PATTERN: /^[a-zA-Z0-9_\-]+$/,
  METER_MIN_LEN: 4,
  METER_MAX_LEN: 32,
  METER_PATTERN: /^[A-Z0-9\-]+$/,
  HOUSE_NAME_MIN_LEN: 2,
  HOUSE_NAME_MAX_LEN: 80,
  MPESA_PHONE_PATTERN: /^\+?254[17][0-9]{8}$/,
  RECEIPT_PATTERN: /^[A-Z0-9\-_]+$/,
};

/**
 * Normalizes a Kenyan phone number (e.g. 0712345678, 254712345678, +254712345678)
 * to strict E.164 format (+2547XXXXXXXX or +2541XXXXXXXX) matching firebase-blueprint.json.
 */
export function normalizeMpesaPhone(rawInput: string): string | null {
  const cleaned = rawInput.replace(/[\s\-()]/g, '');
  if (/^0[17][0-9]{8}$/.test(cleaned)) {
    return `+254${cleaned.slice(1)}`;
  }
  if (/^254[17][0-9]{8}$/.test(cleaned)) {
    return `+${cleaned}`;
  }
  if (VALIDATION_CONSTRAINTS.MPESA_PHONE_PATTERN.test(cleaned)) {
    return cleaned.startsWith('+') ? cleaned : `+${cleaned}`;
  }
  return null;
}

/**
 * Calculates Smart Deposit Prediction based on historical daily usage,
 * days remaining in the current calendar month, current token balance,
 * and configurable safety reserve buffer days.
 */
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
    currentDate = new Date('2026-10-23T12:00:00Z'),
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

  // Minimum practical top-up suggestion of 10 kWh if balance is already high, or exact deficit rounded up
  const suggestedTokensKwh =
    rawDeficit > 0
      ? Number(Math.ceil(rawDeficit * 2) / 2)
      : Number((averageDailyUsageKwh * 3).toFixed(1));

  // Round suggested KES to nearest 10 KES for clean M-Pesa STK Push entry
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

/**
 * Pure settlement engine for IoT Smart Meter P2P energy transfer.
 * Deducts kWh tokens from Consumer balance and credits KES value to Prosumer escrow wallet.
 */
export function settleIoTMeterTransfer(params: {
  household: HouseholdNodeState;
  deltaKwh: number;
  platformFeePercent?: number;
}): {
  updatedHousehold: HouseholdNodeState;
  consumerCostKes: number;
  prosumerNetCreditKes: number;
  platformFeeKes: number;
} {
  const { household, deltaKwh, platformFeePercent = 2.5 } = params;
  if (deltaKwh <= 0 || Number.isNaN(deltaKwh)) {
    throw new Error('Meter reading deltaKwh must be greater than zero.');
  }
  if (deltaKwh > household.tokenBalanceKwh) {
    throw new Error(
      `Insufficient token balance (${household.tokenBalanceKwh.toFixed(2)} kWh) for ${deltaKwh.toFixed(2)} kWh load.`
    );
  }

  const grossKes = deltaKwh * household.tariffKesPerKwh;
  const platformFeeKes = Number(((grossKes * platformFeePercent) / 100).toFixed(2));
  const prosumerNetCreditKes = Number((grossKes - platformFeeKes).toFixed(2));

  const nextTokenBalance = Number((household.tokenBalanceKwh - deltaKwh).toFixed(2));
  const nextWithdrawableKes = Number(
    (household.withdrawableBalanceKes + prosumerNetCreditKes).toFixed(2)
  );
  const nextConsumed = Number((household.totalConsumedKwh + deltaKwh).toFixed(2));
  const nextExported = Number((household.totalExportedKwh + deltaKwh).toFixed(2));

  const nextStatus: MeterStatus = nextTokenBalance < 20 ? 'LOW_RESERVE' : 'ONLINE';

  return {
    updatedHousehold: {
      ...household,
      tokenBalanceKwh: nextTokenBalance,
      withdrawableBalanceKes: nextWithdrawableKes,
      totalConsumedKwh: nextConsumed,
      totalExportedKwh: nextExported,
      status: nextStatus,
      updatedAtIso: new Date().toISOString(),
    },
    consumerCostKes: Number(grossKes.toFixed(2)),
    prosumerNetCreditKes,
    platformFeeKes,
  };
}

/**
 * Pure settlement calculation for Safaricom M-Pesa C2B STK Push Deposit.
 */
export function settleMpesaStkDeposit(params: {
  household: HouseholdNodeState;
  depositKes: number;
}): {
  updatedHousehold: HouseholdNodeState;
  purchasedKwh: number;
} {
  const { household, depositKes } = params;
  if (depositKes < 20 || depositKes > 250000 || Number.isNaN(depositKes)) {
    throw new Error('M-Pesa STK Push deposit must be between KES 20 and KES 250,000.');
  }

  const purchasedKwh = Number((depositKes / household.tariffKesPerKwh).toFixed(2));
  const nextTokenBalance = Number((household.tokenBalanceKwh + purchasedKwh).toFixed(2));
  const nextStatus: MeterStatus = nextTokenBalance < 20 ? 'LOW_RESERVE' : 'ONLINE';

  return {
    updatedHousehold: {
      ...household,
      tokenBalanceKwh: nextTokenBalance,
      status: nextStatus,
      updatedAtIso: new Date().toISOString(),
    },
    purchasedKwh,
  };
}

/**
 * Pure settlement calculation for Safaricom M-Pesa B2C Prosumer Withdrawal.
 */
export function settleMpesaB2CWithdrawal(params: {
  household: HouseholdNodeState;
  withdrawalKes: number;
}): {
  updatedHousehold: HouseholdNodeState;
  b2cFeeKes: number;
  netPayoutKes: number;
} {
  const { household, withdrawalKes } = params;
  if (withdrawalKes < 50 || Number.isNaN(withdrawalKes)) {
    throw new Error('Minimum M-Pesa B2C withdrawal is KES 50.');
  }
  if (withdrawalKes > household.withdrawableBalanceKes) {
    throw new Error(
      `Withdrawal amount (KES ${withdrawalKes.toLocaleString()}) exceeds withdrawable balance (KES ${household.withdrawableBalanceKes.toLocaleString()}).`
    );
  }

  const b2cFeeKes = withdrawalKes <= 1000 ? 15 : withdrawalKes <= 5000 ? 25 : 45;
  const netPayoutKes = Number((withdrawalKes - b2cFeeKes).toFixed(2));
  const nextWithdrawableKes = Number((household.withdrawableBalanceKes - withdrawalKes).toFixed(2));

  return {
    updatedHousehold: {
      ...household,
      withdrawableBalanceKes: nextWithdrawableKes,
      updatedAtIso: new Date().toISOString(),
    },
    b2cFeeKes,
    netPayoutKes,
  };
}

/**
 * Generates an authentic-format Safaricom Daraja receipt code (e.g. SJK84M92LP).
 */
export function generateDarajaReceipt(prefix = 'SJ'): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let suffix = '';
  for (let i = 0; i < 8; i++) {
    suffix += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return `${prefix}${suffix}`;
}

/**
 * Generates deterministic 30-day historical usage & export telemetry ending on 2026-10-23.
 */
export function createInitialDailyMetrics(tariffKesPerKwh = 18.5): DailyMetricRecord[] {
  const baseDate = new Date('2026-10-23T00:00:00Z');
  const records: DailyMetricRecord[] = [];

  // Realistic daily consumption & solar export curves for a Nairobi microgrid household
  const consumptionPattern = [
    6.4, 7.1, 5.8, 6.9, 8.2, 9.4, 7.8, 6.2, 6.7, 7.3,
    5.9, 6.8, 8.5, 9.1, 7.4, 6.5, 6.9, 7.6, 6.1, 7.0,
    8.8, 9.6, 7.2, 6.6, 7.1, 7.9, 6.3, 7.4, 8.1, 6.8,
  ];
  const exportPattern = [
    11.2, 12.8, 9.5, 13.4, 14.1, 10.6, 12.0, 13.8, 15.2, 11.9,
    8.7, 12.4, 14.6, 13.1, 11.5, 12.9, 14.8, 15.5, 10.2, 12.7,
    13.9, 11.4, 12.6, 14.3, 15.0, 13.2, 11.8, 14.4, 15.1, 13.6,
  ];

  for (let i = 29; i >= 0; i--) {
    const d = new Date(baseDate.getTime() - i * 86400000);
    const dateStr = d.toISOString().slice(0, 10);
    const monthShort = d.toLocaleString('en-US', { month: 'short', timeZone: 'UTC' });
    const dayNum = d.getUTCDate();
    const idx = 29 - i;
    const consumedKwh = consumptionPattern[idx];
    const exportedKwh = exportPattern[idx];
    const costKes = Number((consumedKwh * tariffKesPerKwh).toFixed(2));
    const revenueKes = Number((exportedKwh * tariffKesPerKwh * 0.975).toFixed(2));
    const peakHourKw = Number((Math.max(consumedKwh, exportedKwh) * 0.28).toFixed(2));

    records.push({
      dateStr,
      dayLabel: `${monthShort} ${dayNum}`,
      consumedKwh,
      exportedKwh,
      costKes,
      revenueKes,
      peakHourKw,
    });
  }

  return records;
}

export const INITIAL_HOUSEHOLD_STATE: HouseholdNodeState = {
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
  updatedAtIso: '2026-10-23T10:45:00.000Z',
};

export const INITIAL_TRANSACTIONS: EnergyTransactionRecord[] = [
  {
    id: 'tx_seed_01',
    ownerId: 'demo_local_owner',
    householdId: 'house_kilimani_b4',
    txType: 'P2P_PROSUMER_CREDIT',
    amountKwh: 6.4,
    amountKes: 115.44,
    mpesaReceipt: 'IOT-PULSE-9941A',
    counterpartyMeter: 'KPLC-774019',
    status: 'COMPLETED',
    createdAtIso: '2026-10-23T09:30:00.000Z',
    webhookVerified: true,
  },
  {
    id: 'tx_seed_02',
    ownerId: 'demo_local_owner',
    householdId: 'house_kilimani_b4',
    txType: 'C2B_STK_DEPOSIT',
    amountKwh: 32.43,
    amountKes: 600.0,
    mpesaReceipt: 'SJK72N48QP',
    counterpartyMeter: 'MPESA-PAYBILL-409200',
    status: 'COMPLETED',
    createdAtIso: '2026-10-22T18:14:00.000Z',
    webhookVerified: true,
  },
  {
    id: 'tx_seed_03',
    ownerId: 'demo_local_owner',
    householdId: 'house_kilimani_b4',
    txType: 'P2P_METER_DEDUCTION',
    amountKwh: 4.8,
    amountKes: 88.8,
    mpesaReceipt: 'IOT-PULSE-9812C',
    counterpartyMeter: 'KPLC-551902',
    status: 'COMPLETED',
    createdAtIso: '2026-10-22T14:05:00.000Z',
    webhookVerified: true,
  },
  {
    id: 'tx_seed_04',
    ownerId: 'demo_local_owner',
    householdId: 'house_kilimani_b4',
    txType: 'B2C_MPESA_WITHDRAWAL',
    amountKwh: 0,
    amountKes: 2500.0,
    mpesaReceipt: 'SJI49L11KW',
    counterpartyMeter: 'MPESA-B2C-254712345678',
    status: 'COMPLETED',
    createdAtIso: '2026-10-21T16:40:00.000Z',
    webhookVerified: true,
  },
];

export const PEER_GRID_NODES: PeerNodeSummary[] = [
  {
    meterNumber: 'KPLC-551902',
    houseName: 'Lavington SunRoof Residence #12',
    role: 'PROSUMER',
    distanceMeters: 140,
    currentOutputKw: 4.8,
    sharedTodayKwh: 14.2,
    tariffKes: 18.5,
  },
  {
    meterNumber: 'KPLC-774019',
    houseName: 'Yaya Gardens Apartment 3A',
    role: 'CONSUMER',
    distanceMeters: 85,
    currentOutputKw: -1.9,
    sharedTodayKwh: 6.4,
    tariffKes: 18.5,
  },
  {
    meterNumber: 'KPLC-619384',
    houseName: 'Kindaruma Court Duplex #07',
    role: 'CONSUMER',
    distanceMeters: 210,
    currentOutputKw: -2.4,
    sharedTodayKwh: 5.1,
    tariffKes: 18.5,
  },
  {
    meterNumber: 'KPLC-903118',
    houseName: 'Ngong Rd Eco-Bungalow #02',
    role: 'PROSUMER',
    distanceMeters: 320,
    currentOutputKw: 3.6,
    sharedTodayKwh: 11.8,
    tariffKes: 18.0,
  },
];

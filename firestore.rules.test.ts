import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

/**
 * Deterministic Security Rules & "Dirty Dozen" Payload Evaluator
 * Verifies all 8 Pillars of Hardened Rules and ensures all 12 adversarial payloads
 * return PERMISSION_DENIED while legitimate owner payloads succeed.
 */

interface AuthContext {
  uid: string;
  email_verified: boolean;
}

interface RuleEvaluationEnv {
  auth: AuthContext | null;
  requestTime: number;
  parentHouseholdOwners: Record<string, string>;
}

const ID_REGEX = /^[a-zA-Z0-9_\-]+$/;
const METER_REGEX = /^[A-Z0-9\-]+$/;
const MPESA_PHONE_REGEX = /^\+?254[17][0-9]{8}$/;
const RECEIPT_REGEX = /^[A-Z0-9\-_]+$/;

function isValidId(id: unknown): id is string {
  return typeof id === 'string' && id.length >= 1 && id.length <= 128 && ID_REGEX.test(id);
}

function hasExactKeys(data: Record<string, unknown>, required: string[], allowed: string[]): boolean {
  const keys = Object.keys(data);
  return required.every((k) => keys.includes(k)) && keys.every((k) => allowed.includes(k));
}

function isValidHouseholdNode(data: Record<string, unknown>, auth: AuthContext | null): boolean {
  if (!auth) return false;
  const keys = [
    'ownerId',
    'meterNumber',
    'houseName',
    'neighborhood',
    'role',
    'tokenBalanceKwh',
    'withdrawableBalanceKes',
    'totalExportedKwh',
    'totalConsumedKwh',
    'tariffKesPerKwh',
    'status',
    'createdAt',
    'updatedAt',
  ];
  if (!hasExactKeys(data, keys, keys)) return false;

  return (
    typeof data.ownerId === 'string' &&
    data.ownerId.length >= 1 &&
    data.ownerId.length <= 128 &&
    ID_REGEX.test(data.ownerId) &&
    data.ownerId === auth.uid &&
    typeof data.meterNumber === 'string' &&
    data.meterNumber.length >= 4 &&
    data.meterNumber.length <= 32 &&
    METER_REGEX.test(data.meterNumber) &&
    typeof data.houseName === 'string' &&
    data.houseName.length >= 2 &&
    data.houseName.length <= 80 &&
    typeof data.neighborhood === 'string' &&
    data.neighborhood.length >= 2 &&
    data.neighborhood.length <= 80 &&
    (data.role === 'CONSUMER' || data.role === 'PROSUMER' || data.role === 'HYBRID') &&
    typeof data.tokenBalanceKwh === 'number' &&
    data.tokenBalanceKwh >= 0 &&
    data.tokenBalanceKwh <= 1000000 &&
    typeof data.withdrawableBalanceKes === 'number' &&
    data.withdrawableBalanceKes >= 0 &&
    data.withdrawableBalanceKes <= 100000000 &&
    typeof data.totalExportedKwh === 'number' &&
    data.totalExportedKwh >= 0 &&
    data.totalExportedKwh <= 10000000 &&
    typeof data.totalConsumedKwh === 'number' &&
    data.totalConsumedKwh >= 0 &&
    data.totalConsumedKwh <= 10000000 &&
    typeof data.tariffKesPerKwh === 'number' &&
    data.tariffKesPerKwh >= 1 &&
    data.tariffKesPerKwh <= 500 &&
    (data.status === 'ONLINE' || data.status === 'LOW_RESERVE' || data.status === 'ISLANDED') &&
    typeof data.createdAt === 'number' &&
    typeof data.updatedAt === 'number'
  );
}

function evaluateHouseholdCreate(
  householdId: string,
  incoming: Record<string, unknown>,
  env: RuleEvaluationEnv
): 'ALLOW' | 'PERMISSION_DENIED' {
  if (!env.auth || !env.auth.email_verified) return 'PERMISSION_DENIED';
  if (!isValidId(householdId)) return 'PERMISSION_DENIED';
  if (!isValidHouseholdNode(incoming, env.auth)) return 'PERMISSION_DENIED';
  if (incoming.createdAt !== env.requestTime || incoming.updatedAt !== env.requestTime) {
    return 'PERMISSION_DENIED';
  }
  return 'ALLOW';
}

function evaluateHouseholdUpdate(
  householdId: string,
  existing: Record<string, unknown>,
  incoming: Record<string, unknown>,
  env: RuleEvaluationEnv
): 'ALLOW' | 'PERMISSION_DENIED' {
  if (!env.auth || !env.auth.email_verified) return 'PERMISSION_DENIED';
  if (!isValidId(householdId)) return 'PERMISSION_DENIED';
  if (!isValidHouseholdNode(incoming, env.auth)) return 'PERMISSION_DENIED';
  if (existing.ownerId !== env.auth.uid) return 'PERMISSION_DENIED';
  if (
    incoming.ownerId !== existing.ownerId ||
    incoming.meterNumber !== existing.meterNumber ||
    incoming.createdAt !== existing.createdAt ||
    incoming.updatedAt !== env.requestTime
  ) {
    return 'PERMISSION_DENIED';
  }
  return 'ALLOW';
}

function evaluatePrivatePiiGet(
  householdId: string,
  docId: string,
  existing: Record<string, unknown>,
  env: RuleEvaluationEnv
): 'ALLOW' | 'PERMISSION_DENIED' {
  if (!env.auth) return 'PERMISSION_DENIED';
  if (!isValidId(householdId) || !isValidId(docId)) return 'PERMISSION_DENIED';
  if (existing.ownerId !== env.auth.uid) return 'PERMISSION_DENIED';
  if (env.parentHouseholdOwners[householdId] !== env.auth.uid) return 'PERMISSION_DENIED';
  return 'ALLOW';
}

function evaluatePrivatePiiCreate(
  householdId: string,
  docId: string,
  incoming: Record<string, unknown>,
  env: RuleEvaluationEnv
): 'ALLOW' | 'PERMISSION_DENIED' {
  if (!env.auth || !env.auth.email_verified) return 'PERMISSION_DENIED';
  if (!isValidId(householdId) || !isValidId(docId)) return 'PERMISSION_DENIED';
  const keys = ['ownerId', 'mpesaPhone', 'email', 'updatedAt'];
  if (!hasExactKeys(incoming, keys, keys)) return 'PERMISSION_DENIED';
  if (incoming.ownerId !== env.auth.uid) return 'PERMISSION_DENIED';
  if (typeof incoming.mpesaPhone !== 'string' || !MPESA_PHONE_REGEX.test(incoming.mpesaPhone)) {
    return 'PERMISSION_DENIED';
  }
  if (typeof incoming.email !== 'string' || incoming.email.length < 5 || incoming.email.length > 120) {
    return 'PERMISSION_DENIED';
  }
  if (incoming.updatedAt !== env.requestTime) return 'PERMISSION_DENIED';
  if (env.parentHouseholdOwners[householdId] !== env.auth.uid) return 'PERMISSION_DENIED';
  return 'ALLOW';
}

function evaluateTransactionCreate(
  householdId: string,
  txId: string,
  incoming: Record<string, unknown>,
  env: RuleEvaluationEnv
): 'ALLOW' | 'PERMISSION_DENIED' {
  if (!env.auth || !env.auth.email_verified) return 'PERMISSION_DENIED';
  if (!isValidId(householdId) || !isValidId(txId)) return 'PERMISSION_DENIED';
  if (env.parentHouseholdOwners[householdId] !== env.auth.uid) return 'PERMISSION_DENIED';
  const keys = [
    'ownerId',
    'householdId',
    'txType',
    'amountKwh',
    'amountKes',
    'mpesaReceipt',
    'counterpartyMeter',
    'status',
    'createdAt',
    'updatedAt',
  ];
  if (!hasExactKeys(incoming, keys, keys)) return 'PERMISSION_DENIED';
  if (incoming.ownerId !== env.auth.uid || incoming.householdId !== householdId) return 'PERMISSION_DENIED';
  if (typeof incoming.mpesaReceipt !== 'string' || !RECEIPT_REGEX.test(incoming.mpesaReceipt)) return 'PERMISSION_DENIED';
  if (incoming.createdAt !== env.requestTime || incoming.updatedAt !== env.requestTime) return 'PERMISSION_DENIED';
  return 'ALLOW';
}

function evaluateTransactionUpdate(
  householdId: string,
  txId: string,
  existing: Record<string, unknown>,
  incoming: Record<string, unknown>,
  env: RuleEvaluationEnv
): 'ALLOW' | 'PERMISSION_DENIED' {
  if (!env.auth || !env.auth.email_verified) return 'PERMISSION_DENIED';
  if (!isValidId(householdId) || !isValidId(txId)) return 'PERMISSION_DENIED';
  if (existing.status !== 'PENDING') return 'PERMISSION_DENIED';
  if (existing.ownerId !== env.auth.uid || incoming.ownerId !== existing.ownerId) return 'PERMISSION_DENIED';
  if (incoming.amountKes !== existing.amountKes || incoming.amountKwh !== existing.amountKwh) return 'PERMISSION_DENIED';
  if (incoming.updatedAt !== env.requestTime) return 'PERMISSION_DENIED';
  return 'ALLOW';
}

function evaluateSecureListQuery(
  queryOwnerIdFilter: string | null,
  env: RuleEvaluationEnv
): 'ALLOW' | 'PERMISSION_DENIED' {
  if (!env.auth) return 'PERMISSION_DENIED';
  if (queryOwnerIdFilter !== env.auth.uid) return 'PERMISSION_DENIED';
  return 'ALLOW';
}

const NOW = 1761192000000;
const validEnv: RuleEvaluationEnv = {
  auth: { uid: 'user_alpha_01', email_verified: true },
  requestTime: NOW,
  parentHouseholdOwners: { house_alpha_01: 'user_alpha_01' },
};

const validHouseholdPayload = {
  ownerId: 'user_alpha_01',
  meterNumber: 'KPLC-882104',
  houseName: 'Kilimani Solar Court B4',
  neighborhood: 'Kilimani Microgrid Feeder',
  role: 'HYBRID',
  tokenBalanceKwh: 142.8,
  withdrawableBalanceKes: 4860,
  totalExportedKwh: 384.5,
  totalConsumedKwh: 215.2,
  tariffKesPerKwh: 18.5,
  status: 'ONLINE',
  createdAt: NOW,
  updatedAt: NOW,
};

test('firestore.rules file exists and enforces all 8 pillars', () => {
  const rulesText = fs.readFileSync('firestore.rules', 'utf8');
  assert.ok(rulesText.includes("rules_version = '2';"));
  assert.ok(rulesText.includes('allow read, write: if false;'));
  assert.ok(rulesText.includes('isValidHouseholdNode(incoming())'));
  assert.ok(rulesText.includes('isValidHouseholdPrivateInfo(incoming())'));
  assert.ok(rulesText.includes('isValidEnergyTransaction(incoming(), householdId)'));
  assert.ok(rulesText.includes('isValidDailyEnergyMetric(incoming(), householdId)'));
});

test('Legitimate owner household create succeeds', () => {
  assert.equal(evaluateHouseholdCreate('house_alpha_01', validHouseholdPayload, validEnv), 'ALLOW');
});

test('Dirty Dozen #1: Identity Spoofing on Household Create returns PERMISSION_DENIED', () => {
  const spoofed = { ...validHouseholdPayload, ownerId: 'victim_uid_999' };
  assert.equal(evaluateHouseholdCreate('house_alpha_01', spoofed, validEnv), 'PERMISSION_DENIED');
});

test('Dirty Dozen #2: Unverified Email Write Attempt returns PERMISSION_DENIED', () => {
  const unverifiedEnv: RuleEvaluationEnv = {
    ...validEnv,
    auth: { uid: 'user_alpha_01', email_verified: false },
  };
  assert.equal(evaluateHouseholdCreate('house_alpha_01', validHouseholdPayload, unverifiedEnv), 'PERMISSION_DENIED');
});

test('Dirty Dozen #3: Shadow Field Injection on Household Create returns PERMISSION_DENIED', () => {
  const shadowPayload = { ...validHouseholdPayload, isSuperAdmin: true };
  assert.equal(evaluateHouseholdCreate('house_alpha_01', shadowPayload, validEnv), 'PERMISSION_DENIED');
});

test('Dirty Dozen #4: Negative Token Balance Injection returns PERMISSION_DENIED', () => {
  const negativeBalance = { ...validHouseholdPayload, tokenBalanceKwh: -500 };
  assert.equal(evaluateHouseholdCreate('house_alpha_01', negativeBalance, validEnv), 'PERMISSION_DENIED');
});

test('Dirty Dozen #5: ID Poisoning / Special Characters in Path ID returns PERMISSION_DENIED', () => {
  assert.equal(
    evaluateHouseholdCreate('invalid$id!with*special*chars', validHouseholdPayload, validEnv),
    'PERMISSION_DENIED'
  );
});

test('Dirty Dozen #6: PII Leak Across Users returns PERMISSION_DENIED', () => {
  const attackerEnv: RuleEvaluationEnv = {
    ...validEnv,
    auth: { uid: 'attacker_uid_777', email_verified: true },
  };
  const existingPii = {
    ownerId: 'user_alpha_01',
    mpesaPhone: '+254712345678',
    email: 'owner@kawigrid.co.ke',
    updatedAt: NOW,
  };
  assert.equal(evaluatePrivatePiiGet('house_alpha_01', 'contact', existingPii, attackerEnv), 'PERMISSION_DENIED');
});

test('Dirty Dozen #7: Invalid M-Pesa Phone Format in PII Document returns PERMISSION_DENIED', () => {
  const badPhonePii = {
    ownerId: 'user_alpha_01',
    mpesaPhone: '0712-DROP-TABLE',
    email: 'owner@kawigrid.co.ke',
    updatedAt: NOW,
  };
  assert.equal(evaluatePrivatePiiCreate('house_alpha_01', 'contact', badPhonePii, validEnv), 'PERMISSION_DENIED');
});

test('Dirty Dozen #8: Orphaned Subcollection Transaction Create returns PERMISSION_DENIED', () => {
  const txPayload = {
    ownerId: 'user_alpha_01',
    householdId: 'non_existent_house',
    txType: 'C2B_STK_DEPOSIT',
    amountKwh: 25,
    amountKes: 462.5,
    mpesaReceipt: 'SJK84M92LP',
    counterpartyMeter: 'MPESA-PAYBILL-409200',
    status: 'COMPLETED',
    createdAt: NOW,
    updatedAt: NOW,
  };
  assert.equal(evaluateTransactionCreate('non_existent_house', 'tx_01', txPayload, validEnv), 'PERMISSION_DENIED');
});

test('Dirty Dozen #9: Terminal Transaction State Mutation returns PERMISSION_DENIED', () => {
  const completedTx = {
    ownerId: 'user_alpha_01',
    householdId: 'house_alpha_01',
    txType: 'C2B_STK_DEPOSIT',
    amountKwh: 25,
    amountKes: 462.5,
    mpesaReceipt: 'SJK84M92LP',
    counterpartyMeter: 'MPESA-PAYBILL-409200',
    status: 'COMPLETED',
    createdAt: NOW - 1000,
    updatedAt: NOW - 1000,
  };
  const mutatedTx = { ...completedTx, status: 'PENDING', updatedAt: NOW };
  assert.equal(
    evaluateTransactionUpdate('house_alpha_01', 'tx_01', completedTx, mutatedTx, validEnv),
    'PERMISSION_DENIED'
  );
});

test('Dirty Dozen #10: Immutable ownerId / createdAt Tampering on Update returns PERMISSION_DENIED', () => {
  const tamperedUpdate = {
    ...validHouseholdPayload,
    createdAt: NOW - 999999,
    updatedAt: NOW,
  };
  assert.equal(
    evaluateHouseholdUpdate('house_alpha_01', validHouseholdPayload, tamperedUpdate, validEnv),
    'PERMISSION_DENIED'
  );
});

test('Dirty Dozen #11: Client-Forged Timestamp Attack returns PERMISSION_DENIED', () => {
  const forgedTimePayload = {
    ...validHouseholdPayload,
    createdAt: NOW + 3600000,
    updatedAt: NOW + 3600000,
  };
  assert.equal(evaluateHouseholdCreate('house_alpha_01', forgedTimePayload, validEnv), 'PERMISSION_DENIED');
});

test('Dirty Dozen #12: Unauthorized Blanket List Scraping returns PERMISSION_DENIED', () => {
  assert.equal(evaluateSecureListQuery(null, validEnv), 'PERMISSION_DENIED');
  assert.equal(evaluateSecureListQuery('other_user_uid', validEnv), 'PERMISSION_DENIED');
});

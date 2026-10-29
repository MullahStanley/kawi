import test from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeMpesaPhone,
  calculateSmartDepositPrediction,
  settleIoTMeterTransfer,
  settleMpesaStkDeposit,
  settleMpesaB2CWithdrawal,
  createInitialDailyMetrics,
  INITIAL_HOUSEHOLD_STATE,
} from './energyLogic';

test('normalizeMpesaPhone normalizes Kenyan phone formats and rejects invalid numbers', () => {
  assert.equal(normalizeMpesaPhone('0712345678'), '+254712345678');
  assert.equal(normalizeMpesaPhone('0112345678'), '+254112345678');
  assert.equal(normalizeMpesaPhone('254722998877'), '+254722998877');
  assert.equal(normalizeMpesaPhone('+254722998877'), '+254722998877');
  assert.equal(normalizeMpesaPhone('0812345678'), null);
  assert.equal(normalizeMpesaPhone('12345'), null);
});

test('calculateSmartDepositPrediction computes daily average, deficit, and suggested KES deposit', () => {
  const metrics = [{ consumedKwh: 8.0 }, { consumedKwh: 10.0 }, { consumedKwh: 6.0 }];
  // Average = 8.0 kWh/day. On Oct 23 (31 days in Oct), daysRemaining = 31 - 23 + 1 = 9 days.
  // With safetyBufferDays = 3 => 12 days coverage => 96.0 kWh needed.
  // Current balance = 40.0 kWh => deficit = 56.0 kWh.
  const prediction = calculateSmartDepositPrediction({
    dailyMetrics: metrics,
    currentBalanceKwh: 40.0,
    tariffKesPerKwh: 20.0,
    currentDate: new Date('2026-10-23T12:00:00Z'),
    safetyBufferDays: 3,
  });

  assert.equal(prediction.averageDailyUsageKwh, 8.0);
  assert.equal(prediction.daysRemainingInMonth, 9);
  assert.equal(prediction.projectedKwhNeeded, 96.0);
  assert.equal(prediction.netDeficitKwh, 56.0);
  assert.equal(prediction.suggestedDepositKes, 1120);
  assert.equal(prediction.estimatedAutonomyDays, 5.0);
  assert.equal(prediction.urgencyLevel, 'MODERATE');
});

test('settleIoTMeterTransfer deducts Consumer tokens and credits Prosumer escrow wallet', () => {
  const result = settleIoTMeterTransfer({
    household: {
      ...INITIAL_HOUSEHOLD_STATE,
      tokenBalanceKwh: 50.0,
      withdrawableBalanceKes: 1000.0,
      tariffKesPerKwh: 20.0,
    },
    deltaKwh: 5.0,
    platformFeePercent: 2.5,
  });

  assert.equal(result.updatedHousehold.tokenBalanceKwh, 45.0);
  assert.equal(result.consumerCostKes, 100.0);
  assert.equal(result.platformFeeKes, 2.5);
  assert.equal(result.prosumerNetCreditKes, 97.5);
  assert.equal(result.updatedHousehold.withdrawableBalanceKes, 1097.5);
});

test('settleMpesaStkDeposit converts KES deposit to energy tokens accurately', () => {
  const result = settleMpesaStkDeposit({
    household: {
      ...INITIAL_HOUSEHOLD_STATE,
      tokenBalanceKwh: 10.0,
      tariffKesPerKwh: 20.0,
      status: 'LOW_RESERVE',
    },
    depositKes: 500,
  });

  assert.equal(result.purchasedKwh, 25.0);
  assert.equal(result.updatedHousehold.tokenBalanceKwh, 35.0);
  assert.equal(result.updatedHousehold.status, 'ONLINE');
});

test('settleMpesaB2CWithdrawal deducts withdrawable balance and calculates B2C fee', () => {
  const result = settleMpesaB2CWithdrawal({
    household: {
      ...INITIAL_HOUSEHOLD_STATE,
      withdrawableBalanceKes: 4000.0,
    },
    withdrawalKes: 1500,
  });

  assert.equal(result.b2cFeeKes, 25);
  assert.equal(result.netPayoutKes, 1475);
  assert.equal(result.updatedHousehold.withdrawableBalanceKes, 2500.0);
});

test('createInitialDailyMetrics produces 30 days of historical telemetry', () => {
  const history = createInitialDailyMetrics(18.5);
  assert.equal(history.length, 30);
  assert.equal(history[29].dateStr, '2026-10-23');
  assert.ok(history.every((d) => d.consumedKwh > 0 && d.exportedKwh > 0));
});

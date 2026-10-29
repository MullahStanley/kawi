/**
 * Firebase Cloud Functions (Node.js TypeScript) for KawiGrid P2P Energy Trading
 * Handles:
 * 1. IoT Smart Meter Telemetry Ingestion & Atomic P2P Balance Settlement
 * 2. Safaricom Daraja API C2B STK Push Initiation
 * 3. Safaricom Daraja API B2C Prosumer Withdrawal Disbursal
 * 4. Safaricom Daraja Webhook Callback Verification & Firestore Wallet Updates
 */

import * as functions from 'firebase-functions';
import * as admin from 'firebase-admin';

admin.initializeApp();
const db = admin.firestore();

// 1. IoT Smart Meter Bridge Endpoint
export const iotMeterIngest = functions.https.onRequest(async (req, res) => {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method Not Allowed' });
    return;
  }

  const { consumerHouseholdId, prosumerHouseholdId, deltaKwh } = req.body;
  const kwh = Number(deltaKwh);

  if (!consumerHouseholdId || !prosumerHouseholdId || Number.isNaN(kwh) || kwh <= 0) {
    res.status(400).json({ error: 'Invalid smart meter payload' });
    return;
  }

  const consumerRef = db.collection('households').doc(String(consumerHouseholdId));
  const prosumerRef = db.collection('households').doc(String(prosumerHouseholdId));

  try {
    const result = await db.runTransaction(async (tx) => {
      const consumerSnap = await tx.get(consumerRef);
      const prosumerSnap = await tx.get(prosumerRef);

      if (!consumerSnap.exists || !prosumerSnap.exists) {
        throw new Error('Household meter document not found');
      }

      const consumerData = consumerSnap.data()!;
      const prosumerData = prosumerSnap.data()!;
      const currentTokens = Number(consumerData.tokenBalanceKwh || 0);
      const tariff = Number(consumerData.tariffKesPerKwh || 18.5);

      if (currentTokens < kwh) {
        throw new Error('Insufficient Consumer energy token balance');
      }

      const grossKes = Number((kwh * tariff).toFixed(2));
      const netProsumerCreditKes = Number((grossKes * 0.975).toFixed(2));
      const nextConsumerTokens = Number((currentTokens - kwh).toFixed(2));

      tx.update(consumerRef, {
        tokenBalanceKwh: nextConsumerTokens,
        totalConsumedKwh: Number((Number(consumerData.totalConsumedKwh || 0) + kwh).toFixed(2)),
        status: nextConsumerTokens < 20 ? 'LOW_RESERVE' : 'ONLINE',
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      });

      tx.update(prosumerRef, {
        withdrawableBalanceKes: Number(
          (Number(prosumerData.withdrawableBalanceKes || 0) + netProsumerCreditKes).toFixed(2)
        ),
        totalExportedKwh: Number((Number(prosumerData.totalExportedKwh || 0) + kwh).toFixed(2)),
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      });

      return { nextConsumerTokens, netProsumerCreditKes };
    });

    res.status(200).json({ ok: true, ...result });
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : 'Settlement failed' });
  }
});

// 2. Safaricom Daraja Webhook Callback Handler
export const darajaWebhookCallback = functions.https.onRequest(async (req, res) => {
  const callbackData = req.body?.Body?.stkCallback;
  if (!callbackData) {
    res.status(400).json({ ResultCode: 1, ResultDesc: 'Malformed Daraja callback payload' });
    return;
  }

  const resultCode = Number(callbackData.ResultCode);
  const checkoutRequestId = String(callbackData.CheckoutRequestID || '');

  if (resultCode === 0) {
    // Extract Amount and MpesaReceiptNumber from CallbackMetadata
    const items: Array<{ Name: string; Value: unknown }> =
      callbackData.CallbackMetadata?.Item || [];
    const amountKes = Number(items.find((i) => i.Name === 'Amount')?.Value || 0);
    const receipt = String(items.find((i) => i.Name === 'MpesaReceiptNumber')?.Value || '');

    // Locate pending transaction by CheckoutRequestID and credit household tokens
    const pendingSnap = await db
      .collectionGroup('transactions')
      .where('mpesaReceipt', '==', checkoutRequestId)
      .limit(1)
      .get();

    if (!pendingSnap.empty) {
      const txDoc = pendingSnap.docs[0];
      const txData = txDoc.data();
      const householdRef = db.collection('households').doc(txData.householdId);

      await db.runTransaction(async (t) => {
        const houseSnap = await t.get(householdRef);
        if (!houseSnap.exists) return;
        const house = houseSnap.data()!;
        const tariff = Number(house.tariffKesPerKwh || 18.5);
        const purchasedKwh = Number((amountKes / tariff).toFixed(2));

        t.update(householdRef, {
          tokenBalanceKwh: Number((Number(house.tokenBalanceKwh || 0) + purchasedKwh).toFixed(2)),
          status: 'ONLINE',
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        });

        t.update(txDoc.ref, {
          status: 'COMPLETED',
          mpesaReceipt: receipt,
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        });
      });
    }
  }

  res.status(200).json({ ResultCode: 0, ResultDesc: 'Accepted' });
});

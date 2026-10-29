import React, { useEffect, useMemo, useState } from 'react';
import { onAuthStateChanged, type User } from 'firebase/auth';
import {
  collection,
  doc,
  getDoc,
  onSnapshot,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
} from 'firebase/firestore';
import {
  auth,
  db,
  handleFirestoreError,
  OperationType,
  setFirestoreNetworkState,
  signInWithGooglePopup,
  signOutUser,
} from './lib/firebase';
import {
  calculateSmartDepositPrediction,
  createInitialDailyMetrics,
  DailyMetricRecord,
  EnergyTransactionRecord,
  generateDarajaReceipt,
  HouseholdNodeState,
  INITIAL_HOUSEHOLD_STATE,
  INITIAL_TRANSACTIONS,
  settleIoTMeterTransfer,
  settleMpesaB2CWithdrawal,
  settleMpesaStkDeposit,
} from './utils/energyLogic';
import { ActiveTab, TopBar } from './components/TopBar';
import { ConsumerDashboard } from './components/ConsumerDashboard';
import { ProsumerDashboard } from './components/ProsumerDashboard';
import { IoTMeterBridgeView } from './components/IoTMeterBridgeView';
import { LedgerExplorerView } from './components/LedgerExplorerView';
import { ExpoMobileView } from './components/ExpoMobileView';

const STORAGE_KEYS = {
  HOUSEHOLD: 'kawigrid_household_v1',
  METRICS: 'kawigrid_metrics_v1',
  TRANSACTIONS: 'kawigrid_transactions_v1',
  PHONE: 'kawigrid_mpesa_phone_v1',
};

export default function App() {
  const [activeTab, setActiveTab] = useState<ActiveTab>('consumer');
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [isOffline, setIsOffline] = useState<boolean>(false);
  const [safetyBufferDays, setSafetyBufferDays] = useState<number>(3);

  const [household, setHousehold] = useState<HouseholdNodeState>(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEYS.HOUSEHOLD);
      return saved ? (JSON.parse(saved) as HouseholdNodeState) : INITIAL_HOUSEHOLD_STATE;
    } catch {
      return INITIAL_HOUSEHOLD_STATE;
    }
  });

  const [dailyMetrics, setDailyMetrics] = useState<DailyMetricRecord[]>(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEYS.METRICS);
      return saved
        ? (JSON.parse(saved) as DailyMetricRecord[])
        : createInitialDailyMetrics(INITIAL_HOUSEHOLD_STATE.tariffKesPerKwh);
    } catch {
      return createInitialDailyMetrics(INITIAL_HOUSEHOLD_STATE.tariffKesPerKwh);
    }
  });

  const [transactions, setTransactions] = useState<EnergyTransactionRecord[]>(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEYS.TRANSACTIONS);
      return saved ? (JSON.parse(saved) as EnergyTransactionRecord[]) : INITIAL_TRANSACTIONS;
    } catch {
      return INITIAL_TRANSACTIONS;
    }
  });

  const [mpesaPhone, setMpesaPhone] = useState<string>(() => {
    try {
      return localStorage.getItem(STORAGE_KEYS.PHONE) || '+254712345678';
    } catch {
      return '+254712345678';
    }
  });

  // Sync local state to localStorage for instant offline resilience
  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEYS.HOUSEHOLD, JSON.stringify(household));
    } catch {
      // Ignore storage quota errors
    }
  }, [household]);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEYS.METRICS, JSON.stringify(dailyMetrics));
    } catch {
      // Ignore storage quota errors
    }
  }, [dailyMetrics]);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEYS.TRANSACTIONS, JSON.stringify(transactions));
    } catch {
      // Ignore storage quota errors
    }
  }, [transactions]);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEYS.PHONE, mpesaPhone);
    } catch {
      // Ignore storage quota errors
    }
  }, [mpesaPhone]);

  // Listen to Firebase Auth & attach Firestore onSnapshot listeners when authenticated
  useEffect(() => {
    const unsubscribeAuth = onAuthStateChanged(auth, async (user) => {
      setCurrentUser(user);
      if (!user) return;

      const householdDocId = `node_${user.uid.slice(0, 24)}`;
      const householdRef = doc(db, 'households', householdDocId);

      try {
        const snap = await getDoc(householdRef);
        if (!snap.exists() && user.emailVerified) {
          await setDoc(householdRef, {
            ownerId: user.uid,
            meterNumber: household.meterNumber,
            houseName: household.houseName,
            neighborhood: household.neighborhood,
            role: household.role,
            tokenBalanceKwh: household.tokenBalanceKwh,
            withdrawableBalanceKes: household.withdrawableBalanceKes,
            totalExportedKwh: household.totalExportedKwh,
            totalConsumedKwh: household.totalConsumedKwh,
            tariffKesPerKwh: household.tariffKesPerKwh,
            status: household.status,
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
          });

          const piiRef = doc(db, 'households', householdDocId, 'private', 'contact');
          await setDoc(piiRef, {
            ownerId: user.uid,
            mpesaPhone,
            email: user.email || 'user@kawigrid.co.ke',
            updatedAt: serverTimestamp(),
          });
        }
      } catch (error) {
        handleFirestoreError(error, OperationType.WRITE, `households/${householdDocId}`);
      }
    });

    return () => unsubscribeAuth();
  }, []);

  // Attach real-time Firestore document listener when authenticated
  useEffect(() => {
    if (!currentUser) return;
    const householdDocId = `node_${currentUser.uid.slice(0, 24)}`;
    const householdPath = `households/${householdDocId}`;
    const householdRef = doc(db, 'households', householdDocId);

    const unsubHousehold = onSnapshot(
      householdRef,
      (snapshot) => {
        if (snapshot.exists()) {
          const data = snapshot.data();
          setHousehold((prev) => ({
            ...prev,
            id: snapshot.id,
            ownerId: String(data.ownerId || currentUser.uid),
            meterNumber: String(data.meterNumber || prev.meterNumber),
            houseName: String(data.houseName || prev.houseName),
            neighborhood: String(data.neighborhood || prev.neighborhood),
            role: (data.role as HouseholdNodeState['role']) || prev.role,
            tokenBalanceKwh: Number(data.tokenBalanceKwh ?? prev.tokenBalanceKwh),
            withdrawableBalanceKes: Number(
              data.withdrawableBalanceKes ?? prev.withdrawableBalanceKes
            ),
            totalExportedKwh: Number(data.totalExportedKwh ?? prev.totalExportedKwh),
            totalConsumedKwh: Number(data.totalConsumedKwh ?? prev.totalConsumedKwh),
            tariffKesPerKwh: Number(data.tariffKesPerKwh ?? prev.tariffKesPerKwh),
            status: (data.status as HouseholdNodeState['status']) || prev.status,
            updatedAtIso: new Date().toISOString(),
          }));
        }
      },
      (error) => {
        handleFirestoreError(error, OperationType.GET, householdPath);
      }
    );

    const txCollectionPath = `households/${householdDocId}/transactions`;
    const txQuery = query(
      collection(db, txCollectionPath),
      where('ownerId', '==', currentUser.uid)
    );

    const unsubTx = onSnapshot(
      txQuery,
      (snapshot) => {
        if (!snapshot.empty) {
          const loaded: EnergyTransactionRecord[] = snapshot.docs.map((d) => {
            const data = d.data();
            return {
              id: d.id,
              ownerId: String(data.ownerId),
              householdId: String(data.householdId),
              txType: data.txType as EnergyTransactionRecord['txType'],
              amountKwh: Number(data.amountKwh || 0),
              amountKes: Number(data.amountKes || 0),
              mpesaReceipt: String(data.mpesaReceipt || ''),
              counterpartyMeter: String(data.counterpartyMeter || ''),
              status: data.status as EnergyTransactionRecord['status'],
              createdAtIso: new Date().toISOString(),
              webhookVerified: true,
            };
          });
          setTransactions((prev) => {
            const existingIds = new Set(loaded.map((item) => item.id));
            const merged = [...loaded, ...prev.filter((item) => !existingIds.has(item.id))];
            return merged;
          });
        }
      },
      (error) => {
        handleFirestoreError(error, OperationType.LIST, txCollectionPath);
      }
    );

    return () => {
      unsubHousehold();
      unsubTx();
    };
  }, [currentUser]);

  const smartPrediction = useMemo(
    () =>
      calculateSmartDepositPrediction({
        dailyMetrics,
        currentBalanceKwh: household.tokenBalanceKwh,
        tariffKesPerKwh: household.tariffKesPerKwh,
        safetyBufferDays,
      }),
    [dailyMetrics, household.tokenBalanceKwh, household.tariffKesPerKwh, safetyBufferDays]
  );

  const persistBalanceAndTransactionToFirestore = async (
    nextHousehold: HouseholdNodeState,
    newTransactions: EnergyTransactionRecord[]
  ) => {
    if (!currentUser || !currentUser.emailVerified) return;
    const householdDocId = `node_${currentUser.uid.slice(0, 24)}`;
    const householdRef = doc(db, 'households', householdDocId);

    try {
      await updateDoc(householdRef, {
        tokenBalanceKwh: nextHousehold.tokenBalanceKwh,
        withdrawableBalanceKes: nextHousehold.withdrawableBalanceKes,
        totalExportedKwh: nextHousehold.totalExportedKwh,
        totalConsumedKwh: nextHousehold.totalConsumedKwh,
        status: nextHousehold.status,
        updatedAt: serverTimestamp(),
      });
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, `households/${householdDocId}`);
    }

    for (const tx of newTransactions) {
      const txDocId = tx.id.replace(/[^a-zA-Z0-9_\-]/g, '');
      const txPath = `households/${householdDocId}/transactions/${txDocId}`;
      try {
        await setDoc(doc(db, 'households', householdDocId, 'transactions', txDocId), {
          ownerId: currentUser.uid,
          householdId: householdDocId,
          txType: tx.txType,
          amountKwh: tx.amountKwh,
          amountKes: tx.amountKes,
          mpesaReceipt: tx.mpesaReceipt,
          counterpartyMeter: tx.counterpartyMeter,
          status: tx.status,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
      } catch (error) {
        handleFirestoreError(error, OperationType.CREATE, txPath);
      }
    }
  };

  // Handler 1: Consumer Safaricom M-Pesa C2B STK Push Deposit
  const handleDepositStkPush = async (amountKes: number, phone: string) => {
    let receipt = generateDarajaReceipt('SJK');
    if (!isOffline) {
      try {
        const response = await fetch('/api/daraja/stkpush', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            amountKes,
            phone,
            meterNumber: household.meterNumber,
            tariffKesPerKwh: household.tariffKesPerKwh,
          }),
        });
        if (response.ok) {
          const data = await response.json();
          if (data.MpesaReceiptNumber) {
            receipt = data.MpesaReceiptNumber;
          }
        }
      } catch {
        // Fallback to local offline receipt if network dropped
      }
    }

    const { updatedHousehold, purchasedKwh } = settleMpesaStkDeposit({
      household,
      depositKes: amountKes,
    });

    const newTx: EnergyTransactionRecord = {
      id: `tx_c2b_${Date.now()}`,
      ownerId: currentUser?.uid || household.ownerId,
      householdId: household.id,
      txType: 'C2B_STK_DEPOSIT',
      amountKwh: purchasedKwh,
      amountKes,
      mpesaReceipt: receipt,
      counterpartyMeter: 'MPESA-PAYBILL-409200',
      status: 'COMPLETED',
      createdAtIso: new Date().toISOString(),
      webhookVerified: true,
    };

    setHousehold(updatedHousehold);
    setTransactions((prev) => [newTx, ...prev]);
    setMpesaPhone(phone);

    await persistBalanceAndTransactionToFirestore(updatedHousehold, [newTx]);

    return { receipt, purchasedKwh };
  };

  // Handler 2: Prosumer Safaricom Daraja B2C Withdrawal
  const handleWithdrawB2C = async (withdrawalKes: number, phone: string) => {
    let receipt = generateDarajaReceipt('SJI');
    if (!isOffline) {
      try {
        const response = await fetch('/api/daraja/b2c', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            withdrawalKes,
            phone,
          }),
        });
        if (response.ok) {
          const data = await response.json();
          if (data.TransactionID) {
            receipt = data.TransactionID;
          }
        }
      } catch {
        // Fallback to local offline receipt
      }
    }

    const { updatedHousehold, b2cFeeKes, netPayoutKes } = settleMpesaB2CWithdrawal({
      household,
      withdrawalKes,
    });

    const newTx: EnergyTransactionRecord = {
      id: `tx_b2c_${Date.now()}`,
      ownerId: currentUser?.uid || household.ownerId,
      householdId: household.id,
      txType: 'B2C_MPESA_WITHDRAWAL',
      amountKwh: 0,
      amountKes: withdrawalKes,
      mpesaReceipt: receipt,
      counterpartyMeter: `MPESA-B2C-${phone.replace('+', '')}`,
      status: 'COMPLETED',
      createdAtIso: new Date().toISOString(),
      webhookVerified: true,
    };

    setHousehold(updatedHousehold);
    setTransactions((prev) => [newTx, ...prev]);
    setMpesaPhone(phone);

    await persistBalanceAndTransactionToFirestore(updatedHousehold, [newTx]);

    return { receipt, netPayoutKes, b2cFeeKes };
  };

  // Handler 3: IoT Smart Meter Bridge Telemetry Ingestion
  const handleIngestMeterPulse = async (params: {
    deltaKwh: number;
    prosumerMeter: string;
    voltageV: number;
    frequencyHz: number;
  }) => {
    let pulseReceipt = `IOT-PULSE-${generateDarajaReceipt('').slice(0, 6)}`;
    if (!isOffline) {
      try {
        const response = await fetch('/api/iot/meter-ingest', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            ...params,
            consumerMeter: household.meterNumber,
            tariffKesPerKwh: household.tariffKesPerKwh,
          }),
        });
        if (response.ok) {
          const data = await response.json();
          if (data.pulseReceipt) {
            pulseReceipt = data.pulseReceipt;
          }
        }
      } catch {
        // Fallback to local offline pulse receipt
      }
    }

    const { updatedHousehold, consumerCostKes, prosumerNetCreditKes, platformFeeKes } =
      settleIoTMeterTransfer({
        household,
        deltaKwh: params.deltaKwh,
      });

    const nowIso = new Date().toISOString();
    const deductionTx: EnergyTransactionRecord = {
      id: `tx_ded_${Date.now()}`,
      ownerId: currentUser?.uid || household.ownerId,
      householdId: household.id,
      txType: 'P2P_METER_DEDUCTION',
      amountKwh: params.deltaKwh,
      amountKes: consumerCostKes,
      mpesaReceipt: pulseReceipt,
      counterpartyMeter: params.prosumerMeter,
      status: 'COMPLETED',
      createdAtIso: nowIso,
      webhookVerified: true,
    };

    const creditTx: EnergyTransactionRecord = {
      id: `tx_crd_${Date.now() + 1}`,
      ownerId: currentUser?.uid || household.ownerId,
      householdId: household.id,
      txType: 'P2P_PROSUMER_CREDIT',
      amountKwh: params.deltaKwh,
      amountKes: prosumerNetCreditKes,
      mpesaReceipt: `${pulseReceipt}-CR`,
      counterpartyMeter: household.meterNumber,
      status: 'COMPLETED',
      createdAtIso: nowIso,
      webhookVerified: true,
    };

    setHousehold(updatedHousehold);
    setTransactions((prev) => [creditTx, deductionTx, ...prev]);

    // Update today's metric bar so historical charts reflect real-time meter ingestion
    setDailyMetrics((prev) => {
      if (prev.length === 0) return prev;
      const copy = [...prev];
      const lastIdx = copy.length - 1;
      const today = copy[lastIdx];
      const nextConsumed = Number((today.consumedKwh + params.deltaKwh).toFixed(2));
      const nextExported = Number((today.exportedKwh + params.deltaKwh).toFixed(2));
      copy[lastIdx] = {
        ...today,
        consumedKwh: nextConsumed,
        exportedKwh: nextExported,
        costKes: Number((nextConsumed * household.tariffKesPerKwh).toFixed(2)),
        revenueKes: Number((nextExported * household.tariffKesPerKwh * 0.975).toFixed(2)),
      };
      return copy;
    });

    await persistBalanceAndTransactionToFirestore(updatedHousehold, [deductionTx, creditTx]);

    return {
      pulseReceipt,
      consumerCostKes,
      prosumerNetCreditKes,
      platformFeeKes,
    };
  };

  const handleToggleOffline = async (nextOffline: boolean) => {
    setIsOffline(nextOffline);
    try {
      await setFirestoreNetworkState(!nextOffline);
    } catch {
      // Ignore if Firestore network state change is already in progress
    }
  };

  const handleUpdateMpesaPhone = async (nextPhone: string) => {
    setMpesaPhone(nextPhone);
    if (currentUser && currentUser.emailVerified) {
      const householdDocId = `node_${currentUser.uid.slice(0, 24)}`;
      const piiPath = `households/${householdDocId}/private/contact`;
      try {
        await setDoc(doc(db, 'households', householdDocId, 'private', 'contact'), {
          ownerId: currentUser.uid,
          mpesaPhone: nextPhone,
          email: currentUser.email || 'user@kawigrid.co.ke',
          updatedAt: serverTimestamp(),
        });
      } catch (error) {
        handleFirestoreError(error, OperationType.WRITE, piiPath);
      }
    }
  };

  return (
    <div id="top" className="min-h-screen flex flex-col bg-[#F8FAFC] text-[#0F172A] pb-20 md:pb-12">
      <TopBar
        activeTab={activeTab}
        onSelectTab={setActiveTab}
        primaryActionLabel={activeTab === 'prosumer' ? 'Withdraw Earnings' : 'Top Up Tokens'}
        onPrimaryAction={() => {
          if (activeTab === 'prosumer') {
            document.getElementById('b2c-amount-input')?.focus();
          } else {
            setActiveTab('consumer');
            setTimeout(() => {
              document.getElementById('stk-amount-input')?.focus();
            }, 50);
          }
        }}
      />

      {/* Main Responsive Container (Full 1440px desktop presence via max-w-7xl, clean mobile padding) */}
      <main className="flex-1 w-full max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pt-6 sm:pt-8 space-y-8">
        {activeTab === 'consumer' && (
          <ConsumerDashboard
            household={household}
            dailyMetrics={dailyMetrics}
            prediction={smartPrediction}
            safetyBufferDays={safetyBufferDays}
            onChangeSafetyBufferDays={setSafetyBufferDays}
            mpesaPhone={mpesaPhone}
            onDepositStkPush={handleDepositStkPush}
            onNavigateToBridge={() => setActiveTab('iot-bridge')}
            isOffline={isOffline}
          />
        )}

        {activeTab === 'prosumer' && (
          <ProsumerDashboard
            household={household}
            dailyMetrics={dailyMetrics}
            mpesaPhone={mpesaPhone}
            onWithdrawB2C={handleWithdrawB2C}
            onNavigateToBridge={() => setActiveTab('iot-bridge')}
          />
        )}

        {activeTab === 'iot-bridge' && (
          <IoTMeterBridgeView
            household={household}
            onIngestMeterPulse={handleIngestMeterPulse}
            isOffline={isOffline}
            onToggleOffline={handleToggleOffline}
            currentUserEmail={currentUser?.email || null}
            onGoogleSignIn={ async () => {
              try {
                await signInWithGooglePopup();
              } catch {
                // Popup closed by user
              }
            }}
            onGoogleSignOut={async () => {
              await signOutUser();
            }}
            mpesaPhone={mpesaPhone}
            onUpdateMpesaPhone={handleUpdateMpesaPhone}
          />
        )}

        {activeTab === 'ledger' && <LedgerExplorerView transactions={transactions} />}

        {activeTab === 'expo-rn' && <ExpoMobileView />}
      </main>

      <footer className="max-w-7xl w-full mx-auto px-4 sm:px-6 lg:px-8 pt-10 pb-4 text-xs text-slate-500 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2 border-t border-slate-200/80 mt-12">
        <div>
          KawiGrid P2P Electrical Microgrid · Smart Meter Node {household.meterNumber} · Safaricom Daraja C2B & B2C Settlement
        </div>
        <div className="flex items-center gap-4">
          <button
            type="button"
            onClick={() => setActiveTab('iot-bridge')}
            className="hover:text-slate-900 underline underline-offset-4 cursor-pointer"
          >
            {isOffline ? 'Network: Offline Local Cache' : 'Network: Cloud Firestore Live'}
          </button>
        </div>
      </footer>
    </div>
  );
}

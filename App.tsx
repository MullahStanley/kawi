import React, { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
  Platform,
} from 'react-native';
import { StatusBar } from 'expo-status-bar';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Ionicons } from '@expo/vector-icons';
import {
  doc,
  onSnapshot,
  serverTimestamp,
  updateDoc,
} from 'firebase/firestore';
import { db, auth, setOfflineNetworkMode } from './src/firebase';
import {
  calculateSmartDepositPrediction,
  DailyMetricRecord,
  EnergyTransactionRecord,
  HouseholdNodeState,
  INITIAL_HOUSEHOLD,
  INITIAL_METRICS,
  INITIAL_TRANSACTIONS,
  normalizeMpesaPhone,
  generateDarajaReceipt,
} from './src/energyLogic';

type TabScreen = 'CONSUMER' | 'PROSUMER' | 'BRIDGE' | 'LEDGER';

const STORAGE_KEYS = {
  HOUSEHOLD: 'kawigrid_node_household_v2',
  TRANSACTIONS: 'kawigrid_node_transactions_v2',
  PHONE: 'kawigrid_node_phone_v2',
};

export default function App() {
  const [activeTab, setActiveTab] = useState<TabScreen>('CONSUMER');
  const [isOffline, setIsOffline] = useState(false);
  const [safetyBufferDays, setSafetyBufferDays] = useState(3);
  const [mpesaPhone, setMpesaPhone] = useState('+254712345678');
  const [depositKesInput, setDepositKesInput] = useState('600');
  const [withdrawKesInput, setWithdrawKesInput] = useState('1500');
  const [pulseKwhInput, setPulseKwhInput] = useState('4.5');
  const [statusBanner, setStatusBanner] = useState<{ type: 'success' | 'error' | 'info'; text: string } | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [ledgerFilter, setLedgerFilter] = useState<'ALL' | 'DEPOSIT' | 'P2P' | 'WITHDRAWAL'>('ALL');

  const [household, setHousehold] = useState<HouseholdNodeState>(INITIAL_HOUSEHOLD);
  const [dailyMetrics] = useState<DailyMetricRecord[]>(INITIAL_METRICS);
  const [transactions, setTransactions] = useState<EnergyTransactionRecord[]>(INITIAL_TRANSACTIONS);

  // Restore state from AsyncStorage on boot
  useEffect(() => {
    (async () => {
      try {
        const [savedHousehold, savedTx, savedPhone] = await Promise.all([
          AsyncStorage.getItem(STORAGE_KEYS.HOUSEHOLD),
          AsyncStorage.getItem(STORAGE_KEYS.TRANSACTIONS),
          AsyncStorage.getItem(STORAGE_KEYS.PHONE),
        ]);
        if (savedHousehold) {
          setHousehold(JSON.parse(savedHousehold));
        }
        if (savedTx) {
          setTransactions(JSON.parse(savedTx));
        }
        if (savedPhone) {
          setMpesaPhone(savedPhone);
        }
      } catch (err) {
        console.warn('AsyncStorage load warning:', err);
      }
    })();
  }, []);

  // Listen to Firestore real-time updates when online
  useEffect(() => {
    try {
      const docRef = doc(db, 'households', household.id);
      const unsubscribe = onSnapshot(
        docRef,
        (snap) => {
          if (snap.exists()) {
            const data = snap.data();
            setHousehold((prev) => ({
              ...prev,
              tokenBalanceKwh: Number(data.tokenBalanceKwh ?? prev.tokenBalanceKwh),
              withdrawableBalanceKes: Number(data.withdrawableBalanceKes ?? prev.withdrawableBalanceKes),
              totalExportedKwh: Number(data.totalExportedKwh ?? prev.totalExportedKwh),
              totalConsumedKwh: Number(data.totalConsumedKwh ?? prev.totalConsumedKwh),
            }));
          }
        },
        (err) => {
          console.log('Firestore listener status (offline or rules):', err.message);
        }
      );
      return () => unsubscribe();
    } catch {
      // Ignored if client is offline
    }
  }, [household.id]);

  const prediction = useMemo(
    () =>
      calculateSmartDepositPrediction({
        dailyMetrics,
        currentBalanceKwh: household.tokenBalanceKwh,
        tariffKesPerKwh: household.tariffKesPerKwh,
        safetyBufferDays,
      }),
    [dailyMetrics, household.tokenBalanceKwh, household.tariffKesPerKwh, safetyBufferDays]
  );

  const persistHousehold = async (nextState: HouseholdNodeState, newTx?: EnergyTransactionRecord) => {
    setHousehold(nextState);
    try {
      await AsyncStorage.setItem(STORAGE_KEYS.HOUSEHOLD, JSON.stringify(nextState));
      if (newTx) {
        const nextList = [newTx, ...transactions];
        setTransactions(nextList);
        await AsyncStorage.setItem(STORAGE_KEYS.TRANSACTIONS, JSON.stringify(nextList));
      }
    } catch (e) {
      console.warn('Storage save error:', e);
    }

    if (!isOffline && auth.currentUser?.emailVerified) {
      try {
        const docRef = doc(db, 'households', nextState.id);
        await updateDoc(docRef, {
          tokenBalanceKwh: nextState.tokenBalanceKwh,
          withdrawableBalanceKes: nextState.withdrawableBalanceKes,
          totalExportedKwh: nextState.totalExportedKwh,
          totalConsumedKwh: nextState.totalConsumedKwh,
          updatedAt: serverTimestamp(),
        });
      } catch (err) {
        console.warn('Firestore sync background notice:', err);
      }
    }
  };

  const handleStkTopUp = async () => {
    const phone = normalizeMpesaPhone(mpesaPhone);
    const amountKes = Number(depositKesInput);

    if (!phone) {
      setStatusBanner({
        type: 'error',
        text: 'Please enter a valid Safaricom phone (+2547... or 07...).',
      });
      return;
    }
    if (Number.isNaN(amountKes) || amountKes < 20) {
      setStatusBanner({
        type: 'error',
        text: 'Minimum STK Push deposit is KES 20.',
      });
      return;
    }

    setIsProcessing(true);
    setStatusBanner({ type: 'info', text: `Initiating Daraja STK Push to ${phone}...` });

    setTimeout(async () => {
      const purchasedKwh = Number((amountKes / household.tariffKesPerKwh).toFixed(2));
      const receipt = generateDarajaReceipt('SJK');

      const nextHousehold: HouseholdNodeState = {
        ...household,
        tokenBalanceKwh: Number((household.tokenBalanceKwh + purchasedKwh).toFixed(2)),
        status: 'ONLINE',
        updatedAtIso: new Date().toISOString(),
      };

      const newTx: EnergyTransactionRecord = {
        id: `tx_${Date.now()}`,
        ownerId: household.ownerId,
        householdId: household.id,
        txType: 'C2B_STK_DEPOSIT',
        amountKwh: purchasedKwh,
        amountKes,
        mpesaReceipt: receipt,
        counterpartyMeter: 'MPESA-PAYBILL-409200',
        status: 'COMPLETED',
        createdAtIso: new Date().toISOString(),
      };

      await persistHousehold(nextHousehold, newTx);
      setIsProcessing(false);
      setStatusBanner({
        type: 'success',
        text: `STK Push Confirmed (${receipt}): +${purchasedKwh} kWh added to smart meter.`,
      });
    }, 600);
  };

  const handleB2CWithdraw = async () => {
    const phone = normalizeMpesaPhone(mpesaPhone);
    const withdrawalKes = Number(withdrawKesInput);

    if (!phone) {
      setStatusBanner({
        type: 'error',
        text: 'Enter a valid Safaricom phone (+2547... or 07...).',
      });
      return;
    }
    if (Number.isNaN(withdrawalKes) || withdrawalKes < 50) {
      setStatusBanner({
        type: 'error',
        text: 'Minimum M-Pesa B2C withdrawal is KES 50.',
      });
      return;
    }
    if (withdrawalKes > household.withdrawableBalanceKes) {
      setStatusBanner({
        type: 'error',
        text: `Insufficient withdrawable balance (Max KES ${household.withdrawableBalanceKes.toFixed(2)}).`,
      });
      return;
    }

    setIsProcessing(true);
    setStatusBanner({ type: 'info', text: `Processing Daraja B2C disbursement of KES ${withdrawalKes}...` });

    setTimeout(async () => {
      const receipt = generateDarajaReceipt('SJI');
      const nextHousehold: HouseholdNodeState = {
        ...household,
        withdrawableBalanceKes: Number((household.withdrawableBalanceKes - withdrawalKes).toFixed(2)),
        updatedAtIso: new Date().toISOString(),
      };

      const newTx: EnergyTransactionRecord = {
        id: `tx_${Date.now()}`,
        ownerId: household.ownerId,
        householdId: household.id,
        txType: 'B2C_MPESA_WITHDRAWAL',
        amountKwh: 0,
        amountKes: withdrawalKes,
        mpesaReceipt: receipt,
        counterpartyMeter: phone,
        status: 'COMPLETED',
        createdAtIso: new Date().toISOString(),
      };

      await persistHousehold(nextHousehold, newTx);
      setIsProcessing(false);
      setStatusBanner({
        type: 'success',
        text: `Daraja B2C Disbursed (${receipt}): KES ${withdrawalKes} sent to ${phone}.`,
      });
    }, 600);
  };

  const handleSimulateMeterPulse = async () => {
    const deltaKwh = Number(pulseKwhInput);
    if (Number.isNaN(deltaKwh) || deltaKwh <= 0) {
      setStatusBanner({ type: 'error', text: 'Enter a valid kWh amount for telemetry pulse.' });
      return;
    }
    if (deltaKwh > household.tokenBalanceKwh) {
      setStatusBanner({
        type: 'error',
        text: `Insufficient token balance (${household.tokenBalanceKwh.toFixed(2)} kWh available).`,
      });
      return;
    }

    setIsProcessing(true);
    setTimeout(async () => {
      const grossKes = Number((deltaKwh * household.tariffKesPerKwh).toFixed(2));
      const netProsumerCreditKes = Number((grossKes * 0.975).toFixed(2));
      const platformFeeKes = Number((grossKes * 0.025).toFixed(2));
      const receipt = `P2P-${Math.floor(1000 + Math.random() * 9000)}`;

      const nextHousehold: HouseholdNodeState = {
        ...household,
        tokenBalanceKwh: Number((household.tokenBalanceKwh - deltaKwh).toFixed(2)),
        withdrawableBalanceKes: Number((household.withdrawableBalanceKes + netProsumerCreditKes).toFixed(2)),
        totalConsumedKwh: Number((household.totalConsumedKwh + deltaKwh).toFixed(2)),
        totalExportedKwh: Number((household.totalExportedKwh + deltaKwh).toFixed(2)),
        status: household.tokenBalanceKwh - deltaKwh < 15 ? 'LOW_RESERVE' : 'ONLINE',
        updatedAtIso: new Date().toISOString(),
      };

      const deductionTx: EnergyTransactionRecord = {
        id: `tx_${Date.now()}`,
        ownerId: household.ownerId,
        householdId: household.id,
        txType: 'P2P_METER_DEDUCTION',
        amountKwh: deltaKwh,
        amountKes: grossKes,
        mpesaReceipt: receipt,
        counterpartyMeter: 'KPLC-882105 (Block A)',
        status: 'COMPLETED',
        createdAtIso: new Date().toISOString(),
      };

      await persistHousehold(nextHousehold, deductionTx);
      setIsProcessing(false);
      setStatusBanner({
        type: 'success',
        text: `IoT Pulse Settled (${receipt}): -${deltaKwh.toFixed(2)} kWh consumed | +KES ${netProsumerCreditKes} prosumer payout (fee: KES ${platformFeeKes}).`,
      });
    }, 400);
  };

  const filteredTransactions = useMemo(() => {
    if (ledgerFilter === 'DEPOSIT') {
      return transactions.filter((t) => t.txType === 'C2B_STK_DEPOSIT');
    }
    if (ledgerFilter === 'P2P') {
      return transactions.filter((t) => t.txType.startsWith('P2P_'));
    }
    if (ledgerFilter === 'WITHDRAWAL') {
      return transactions.filter((t) => t.txType === 'B2C_MPESA_WITHDRAWAL');
    }
    return transactions;
  }, [transactions, ledgerFilter]);

  return (
    <SafeAreaView style={styles.safeContainer}>
      <StatusBar style="light" />

      {/* Top Brand Bar */}
      <View style={styles.header}>
        <View style={styles.brandRow}>
          <View style={styles.brandIconContainer}>
            <Ionicons name="flash" size={20} color="#FFFFFF" />
          </View>
          <View>
            <Text style={styles.brandTitle}>KawiGrid P2P</Text>
            <Text style={styles.brandSubtitle}>
              {household.houseName} · {household.meterNumber}
            </Text>
          </View>
        </View>

        <TouchableOpacity
          style={[styles.statusBadge, isOffline ? styles.statusBadgeOffline : styles.statusBadgeOnline]}
          onPress={async () => {
            const nextOffline = !isOffline;
            setIsOffline(nextOffline);
            await setOfflineNetworkMode(nextOffline);
            setStatusBanner({
              type: 'info',
              text: nextOffline ? 'Simulating Offline Mode (AsyncStorage Cache)' : 'Cloud Firestore Network Reconnected',
            });
          }}
        >
          <View style={[styles.statusDot, isOffline ? styles.statusDotOffline : styles.statusDotOnline]} />
          <Text style={[styles.statusBadgeText, isOffline ? styles.statusBadgeTextOffline : styles.statusBadgeTextOnline]}>
            {isOffline ? 'Offline Cache' : 'Firestore Live'}
          </Text>
        </TouchableOpacity>
      </View>

      {/* Status Banner */}
      {statusBanner && (
        <View
          style={[
            styles.banner,
            statusBanner.type === 'error' && styles.bannerError,
            statusBanner.type === 'info' && styles.bannerInfo,
            statusBanner.type === 'success' && styles.bannerSuccess,
          ]}
        >
          <Ionicons
            name={
              statusBanner.type === 'error'
                ? 'alert-circle'
                : statusBanner.type === 'info'
                ? 'information-circle'
                : 'checkmark-circle'
            }
            size={18}
            color={
              statusBanner.type === 'error'
                ? '#991B1B'
                : statusBanner.type === 'info'
                ? '#1E40AF'
                : '#065F46'
            }
          />
          <Text
            style={[
              styles.bannerText,
              statusBanner.type === 'error' && styles.bannerTextError,
              statusBanner.type === 'info' && styles.bannerTextInfo,
              statusBanner.type === 'success' && styles.bannerTextSuccess,
            ]}
          >
            {statusBanner.text}
          </Text>
          <TouchableOpacity onPress={() => setStatusBanner(null)} style={styles.bannerClose}>
            <Ionicons name="close" size={16} color="#64748B" />
          </TouchableOpacity>
        </View>
      )}

      {/* Main Tab Content ScrollView */}
      <ScrollView contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
        {/* ===================== CONSUMER TAB ===================== */}
        {activeTab === 'CONSUMER' && (
          <View style={styles.tabContent}>
            {/* Energy Meter Hero Card */}
            <View style={styles.heroCard}>
              <View style={styles.cardHeaderRow}>
                <View style={styles.badgePill}>
                  <Text style={styles.badgePillText}>SMART METER · CONSUMER</Text>
                </View>
                <View
                  style={[
                    styles.stateTag,
                    household.tokenBalanceKwh < 15 ? styles.stateTagWarning : styles.stateTagNormal,
                  ]}
                >
                  <Text
                    style={[
                      styles.stateTagText,
                      household.tokenBalanceKwh < 15 ? styles.stateTagTextWarning : styles.stateTagTextNormal,
                    ]}
                  >
                    {household.tokenBalanceKwh < 15 ? 'LOW TOKENS' : 'ACTIVE'}
                  </Text>
                </View>
              </View>

              <Text style={styles.heroNumber}>
                {household.tokenBalanceKwh.toFixed(2)}{' '}
                <Text style={styles.heroUnit}>kWh</Text>
              </Text>

              <View style={styles.heroStatsRow}>
                <View style={styles.statCol}>
                  <Text style={styles.statLabel}>Autonomy Est.</Text>
                  <Text style={styles.statValue}>~{prediction.estimatedAutonomyDays} Days</Text>
                </View>
                <View style={styles.statDivider} />
                <View style={styles.statCol}>
                  <Text style={styles.statLabel}>Current Tariff</Text>
                  <Text style={styles.statValue}>KES {household.tariffKesPerKwh}/kWh</Text>
                </View>
                <View style={styles.statDivider} />
                <View style={styles.statCol}>
                  <Text style={styles.statLabel}>Total Used</Text>
                  <Text style={styles.statValue}>{household.totalConsumedKwh.toFixed(1)} kWh</Text>
                </View>
              </View>
            </View>

            {/* Smart Deposit Prediction Engine Card */}
            <View style={styles.card}>
              <View style={styles.cardTitleRow}>
                <Ionicons name="sparkles" size={18} color="#047857" />
                <Text style={styles.cardTitle}>Smart Deposit Prediction</Text>
              </View>
              <Text style={styles.cardSubtitle}>
                AI predicted monthly requirement based on 7-day telemetry burn rate (
                {prediction.averageDailyUsageKwh} kWh/day).
              </Text>

              <View style={styles.predictionPillContainer}>
                <View style={styles.predictionInfoBlock}>
                  <Text style={styles.predictionSmallLabel}>Days in Month Left</Text>
                  <Text style={styles.predictionLargeVal}>{prediction.daysRemainingInMonth} Days</Text>
                </View>
                <View style={styles.predictionInfoBlock}>
                  <Text style={styles.predictionSmallLabel}>Suggested Deposit</Text>
                  <Text style={[styles.predictionLargeVal, { color: '#047857' }]}>
                    KES {prediction.suggestedDepositKes}
                  </Text>
                </View>
              </View>

              {/* Safety Buffer Selector */}
              <Text style={styles.fieldLabel}>Safety Buffer Days (Weather & Surge)</Text>
              <View style={styles.bufferButtonGroup}>
                {[0, 3, 5, 7].map((days) => (
                  <TouchableOpacity
                    key={days}
                    onPress={() => setSafetyBufferDays(days)}
                    style={[
                      styles.bufferBtn,
                      safetyBufferDays === days && styles.bufferBtnActive,
                    ]}
                  >
                    <Text
                      style={[
                        styles.bufferBtnText,
                        safetyBufferDays === days && styles.bufferBtnTextActive,
                      ]}
                    >
                      +{days}d
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>

              <TouchableOpacity
                style={styles.applySuggestionBtn}
                onPress={() => setDepositKesInput(String(prediction.suggestedDepositKes))}
              >
                <Ionicons name="arrow-down-circle" size={16} color="#047857" />
                <Text style={styles.applySuggestionBtnText}>
                  Use Suggested KES {prediction.suggestedDepositKes} ({prediction.suggestedTokensKwh} kWh)
                </Text>
              </TouchableOpacity>
            </View>

            {/* M-Pesa STK Push Deposit Form */}
            <View style={styles.card}>
              <View style={styles.cardTitleRow}>
                <Ionicons name="phone-portrait-outline" size={18} color="#0F172A" />
                <Text style={styles.cardTitle}>Top Up via M-Pesa (Daraja C2B)</Text>
              </View>
              <Text style={styles.cardSubtitle}>
                Instant STK Push prompt to your mobile device with Paybill 409200.
              </Text>

              <Text style={styles.fieldLabel}>Safaricom Phone Number</Text>
              <TextInput
                style={styles.textInput}
                value={mpesaPhone}
                onChangeText={setMpesaPhone}
                placeholder="+254712345678"
                keyboardType="phone-pad"
              />

              <Text style={styles.fieldLabel}>Deposit Amount (KES)</Text>
              <TextInput
                style={styles.textInput}
                value={depositKesInput}
                onChangeText={setDepositKesInput}
                placeholder="600"
                keyboardType="numeric"
              />

              {/* Quick Amount Chips */}
              <View style={styles.amountChipsRow}>
                {['200', '500', '1000', '2000'].map((amt) => (
                  <TouchableOpacity
                    key={amt}
                    onPress={() => setDepositKesInput(amt)}
                    style={[
                      styles.amountChip,
                      depositKesInput === amt && styles.amountChipActive,
                    ]}
                  >
                    <Text
                      style={[
                        styles.amountChipText,
                        depositKesInput === amt && styles.amountChipTextActive,
                      ]}
                    >
                      KES {amt}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>

              <TouchableOpacity
                style={styles.primaryActionButton}
                onPress={handleStkTopUp}
                disabled={isProcessing}
              >
                {isProcessing ? (
                  <ActivityIndicator color="#FFFFFF" />
                ) : (
                  <>
                    <Ionicons name="flash-outline" size={18} color="#FFFFFF" />
                    <Text style={styles.primaryActionButtonText}>
                      Top Up KES {depositKesInput} via STK Push
                    </Text>
                  </>
                )}
              </TouchableOpacity>
            </View>

            {/* 7-Day Usage History */}
            <View style={styles.card}>
              <View style={styles.cardTitleRow}>
                <Ionicons name="bar-chart-outline" size={18} color="#0F172A" />
                <Text style={styles.cardTitle}>7-Day Consumption Telemetry</Text>
              </View>

              {dailyMetrics.map((item) => (
                <View key={item.dateStr} style={styles.metricRow}>
                  <View>
                    <Text style={styles.metricDay}>{item.dayLabel}</Text>
                    <Text style={styles.metricDate}>{item.dateStr}</Text>
                  </View>
                  <View style={{ alignItems: 'flex-end' }}>
                    <Text style={styles.metricKwh}>{item.consumedKwh} kWh</Text>
                    <Text style={styles.metricCost}>KES {item.costKes}</Text>
                  </View>
                </View>
              ))}
            </View>
          </View>
        )}

        {/* ===================== PROSUMER TAB ===================== */}
        {activeTab === 'PROSUMER' && (
          <View style={styles.tabContent}>
            {/* Prosumer Escrow Hero Card */}
            <View style={[styles.heroCard, { backgroundColor: '#064E3B' }]}>
              <View style={styles.cardHeaderRow}>
                <View style={styles.badgePill}>
                  <Text style={styles.badgePillText}>PROSUMER · SOLAR ESCROW</Text>
                </View>
                <View style={styles.stateTagNormal}>
                  <Text style={styles.stateTagTextNormal}>97.5% SHARE</Text>
                </View>
              </View>

              <Text style={styles.heroNumber}>
                KES {household.withdrawableBalanceKes.toLocaleString('en-US', { minimumFractionDigits: 2 })}{' '}
              </Text>
              <Text style={{ color: '#A7F3D0', fontSize: 13, marginTop: 4 }}>
                Available for instant Daraja B2C withdrawal
              </Text>

              <View style={[styles.heroStatsRow, { marginTop: 16 }]}>
                <View style={styles.statCol}>
                  <Text style={styles.statLabel}>Total Solar Export</Text>
                  <Text style={styles.statValue}>{household.totalExportedKwh.toFixed(1)} kWh</Text>
                </View>
                <View style={styles.statDivider} />
                <View style={styles.statCol}>
                  <Text style={styles.statLabel}>P2P Tariff</Text>
                  <Text style={styles.statValue}>KES {household.tariffKesPerKwh}/kWh</Text>
                </View>
                <View style={styles.statDivider} />
                <View style={styles.statCol}>
                  <Text style={styles.statLabel}>Platform Fee</Text>
                  <Text style={styles.statValue}>2.5% Grid</Text>
                </View>
              </View>
            </View>

            {/* Daraja B2C Withdrawal Form */}
            <View style={styles.card}>
              <View style={styles.cardTitleRow}>
                <Ionicons name="cash-outline" size={18} color="#0F172A" />
                <Text style={styles.cardTitle}>Withdraw Earnings to M-Pesa</Text>
              </View>
              <Text style={styles.cardSubtitle}>
                Direct automated disbursement to your registered Safaricom M-Pesa wallet.
              </Text>

              <Text style={styles.fieldLabel}>Recipient M-Pesa Number</Text>
              <TextInput
                style={styles.textInput}
                value={mpesaPhone}
                onChangeText={setMpesaPhone}
                placeholder="+254712345678"
                keyboardType="phone-pad"
              />

              <Text style={styles.fieldLabel}>Withdrawal Amount (KES)</Text>
              <TextInput
                style={styles.textInput}
                value={withdrawKesInput}
                onChangeText={setWithdrawKesInput}
                placeholder="1500"
                keyboardType="numeric"
              />

              {/* Quick Percentage Chips */}
              <View style={styles.amountChipsRow}>
                {[0.25, 0.5, 1.0].map((ratio) => {
                  const val = Math.floor(household.withdrawableBalanceKes * ratio);
                  const label = ratio === 1 ? 'Max (100%)' : `${ratio * 100}%`;
                  return (
                    <TouchableOpacity
                      key={label}
                      onPress={() => setWithdrawKesInput(String(val))}
                      style={styles.amountChip}
                    >
                      <Text style={styles.amountChipText}>
                        {label} (KES {val})
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </View>

              <TouchableOpacity
                style={[styles.primaryActionButton, { backgroundColor: '#0F172A' }]}
                onPress={handleB2CWithdraw}
                disabled={isProcessing}
              >
                {isProcessing ? (
                  <ActivityIndicator color="#FFFFFF" />
                ) : (
                  <>
                    <Ionicons name="paper-plane-outline" size={18} color="#FFFFFF" />
                    <Text style={styles.primaryActionButtonText}>
                      Disburse KES {withdrawKesInput} to M-Pesa
                    </Text>
                  </>
                )}
              </TouchableOpacity>
            </View>

            {/* 7-Day Solar Export Feed */}
            <View style={styles.card}>
              <View style={styles.cardTitleRow}>
                <Ionicons name="sunny-outline" size={18} color="#D97706" />
                <Text style={styles.cardTitle}>7-Day Solar Generation Telemetry</Text>
              </View>

              {dailyMetrics.map((item) => (
                <View key={item.dateStr} style={styles.metricRow}>
                  <View>
                    <Text style={styles.metricDay}>{item.dayLabel}</Text>
                    <Text style={styles.metricDate}>{item.peakHourKw} kW Peak Load</Text>
                  </View>
                  <View style={{ alignItems: 'flex-end' }}>
                    <Text style={[styles.metricKwh, { color: '#047857' }]}>+{item.exportedKwh} kWh</Text>
                    <Text style={styles.metricCost}>Earned KES {item.revenueKes}</Text>
                  </View>
                </View>
              ))}
            </View>
          </View>
        )}

        {/* ===================== BRIDGE TAB ===================== */}
        {activeTab === 'BRIDGE' && (
          <View style={styles.tabContent}>
            <View style={styles.card}>
              <View style={styles.cardTitleRow}>
                <Ionicons name="hardware-chip-outline" size={18} color="#047857" />
                <Text style={styles.cardTitle}>IoT Smart Meter Telemetry Simulator</Text>
              </View>
              <Text style={styles.cardSubtitle}>
                Simulate smart meter optical pulses sending energy consumption readings over MQTT / HTTP.
                Each pulse atomically debits the consumer tokens and credits the prosumer escrow.
              </Text>

              <Text style={styles.fieldLabel}>Simulated Meter Pulse (kWh)</Text>
              <TextInput
                style={styles.textInput}
                value={pulseKwhInput}
                onChangeText={setPulseKwhInput}
                placeholder="4.5"
                keyboardType="numeric"
              />

              <TouchableOpacity
                style={styles.primaryActionButton}
                onPress={handleSimulateMeterPulse}
                disabled={isProcessing}
              >
                {isProcessing ? (
                  <ActivityIndicator color="#FFFFFF" />
                ) : (
                  <>
                    <Ionicons name="pulse-outline" size={18} color="#FFFFFF" />
                    <Text style={styles.primaryActionButtonText}>
                      Push Smart Meter Reading ({pulseKwhInput} kWh)
                    </Text>
                  </>
                )}
              </TouchableOpacity>
            </View>

            {/* Offline Resilience Card */}
            <View style={styles.card}>
              <View style={styles.cardTitleRow}>
                <Ionicons name="cloud-offline-outline" size={18} color="#0F172A" />
                <Text style={styles.cardTitle}>Network State & Local Persistence</Text>
              </View>
              <Text style={styles.cardSubtitle}>
                KawiGrid uses mobile AsyncStorage and Firestore offline cache so rural nodes can settle transactions without internet.
              </Text>

              <TouchableOpacity
                style={[styles.applySuggestionBtn, { borderColor: isOffline ? '#047857' : '#DC2626' }]}
                onPress={async () => {
                  const next = !isOffline;
                  setIsOffline(next);
                  await setOfflineNetworkMode(next);
                  setStatusBanner({
                    type: 'info',
                    text: next ? 'Simulated Offline Disconnect' : 'Firestore Live Reconnected',
                  });
                }}
              >
                <Ionicons
                  name={isOffline ? 'cloud-done-outline' : 'cloud-offline-outline'}
                  size={16}
                  color={isOffline ? '#047857' : '#DC2626'}
                />
                <Text
                  style={[
                    styles.applySuggestionBtnText,
                    { color: isOffline ? '#047857' : '#DC2626' },
                  ]}
                >
                  {isOffline ? 'Reconnect Live Firestore Network' : 'Simulate Offline Disconnection'}
                </Text>
              </TouchableOpacity>
            </View>

            {/* Node Hardware Diagnostics */}
            <View style={styles.card}>
              <View style={styles.cardTitleRow}>
                <Ionicons name="information-circle-outline" size={18} color="#64748B" />
                <Text style={styles.cardTitle}>Node Diagnostics & Spec</Text>
              </View>

              <View style={styles.diagRow}>
                <Text style={styles.diagKey}>Meter Serial Number</Text>
                <Text style={styles.diagVal}>{household.meterNumber}</Text>
              </View>
              <View style={styles.diagRow}>
                <Text style={styles.diagKey}>Microgrid Feeder</Text>
                <Text style={styles.diagVal}>{household.neighborhood}</Text>
              </View>
              <View style={styles.diagRow}>
                <Text style={styles.diagKey}>Node Role</Text>
                <Text style={styles.diagVal}>{household.role}</Text>
              </View>
              <View style={styles.diagRow}>
                <Text style={styles.diagKey}>Active Tariff</Text>
                <Text style={styles.diagVal}>KES {household.tariffKesPerKwh} / kWh</Text>
              </View>
              <View style={styles.diagRow}>
                <Text style={styles.diagKey}>Sync Architecture</Text>
                <Text style={styles.diagVal}>Expo SDK 52 + Firestore Offline</Text>
              </View>
            </View>
          </View>
        )}

        {/* ===================== LEDGER TAB ===================== */}
        {activeTab === 'LEDGER' && (
          <View style={styles.tabContent}>
            {/* Filter Chips */}
            <View style={styles.ledgerFilterRow}>
              {(['ALL', 'DEPOSIT', 'P2P', 'WITHDRAWAL'] as const).map((filter) => (
                <TouchableOpacity
                  key={filter}
                  onPress={() => setLedgerFilter(filter)}
                  style={[
                    styles.filterChip,
                    ledgerFilter === filter && styles.filterChipActive,
                  ]}
                >
                  <Text
                    style={[
                      styles.filterChipText,
                      ledgerFilter === filter && styles.filterChipTextActive,
                    ]}
                  >
                    {filter}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>

            {/* Transaction List */}
            {filteredTransactions.map((tx) => {
              const isCredit = tx.txType === 'C2B_STK_DEPOSIT' || tx.txType === 'P2P_PROSUMER_CREDIT';
              return (
                <View key={tx.id} style={styles.txCard}>
                  <View style={styles.txHeader}>
                    <View style={styles.txTypeContainer}>
                      <View
                        style={[
                          styles.txIconBubble,
                          isCredit ? styles.txIconCredit : styles.txIconDebit,
                        ]}
                      >
                        <Ionicons
                          name={
                            tx.txType === 'C2B_STK_DEPOSIT'
                              ? 'arrow-down'
                              : tx.txType === 'B2C_MPESA_WITHDRAWAL'
                              ? 'arrow-up'
                              : 'swap-horizontal'
                          }
                          size={14}
                          color={isCredit ? '#047857' : '#B45309'}
                        />
                      </View>
                      <View>
                        <Text style={styles.txTypeText}>
                          {tx.txType.replace(/_/g, ' ')}
                        </Text>
                        <Text style={styles.txReceiptText}>{tx.mpesaReceipt}</Text>
                      </View>
                    </View>

                    <View style={styles.txRight}>
                      <Text
                        style={[
                          styles.txAmountText,
                          isCredit ? styles.txAmountCredit : styles.txAmountDebit,
                        ]}
                      >
                        {isCredit ? '+' : '-'}KES {tx.amountKes.toFixed(2)}
                      </Text>
                      {tx.amountKwh > 0 && (
                        <Text style={styles.txKwhText}>{tx.amountKwh} kWh</Text>
                      )}
                    </View>
                  </View>

                  <View style={styles.txFooter}>
                    <Text style={styles.txPartyText}>Target: {tx.counterpartyMeter}</Text>
                    <Text style={styles.txDateText}>
                      {new Date(tx.createdAtIso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </Text>
                  </View>
                </View>
              );
            })}
          </View>
        )}
      </ScrollView>

      {/* Bottom Navigation Bar */}
      <View style={styles.bottomNav}>
        {[
          { tab: 'CONSUMER' as TabScreen, label: 'Consumer', icon: 'flash' },
          { tab: 'PROSUMER' as TabScreen, label: 'Prosumer', icon: 'sunny' },
          { tab: 'BRIDGE' as TabScreen, label: 'IoT Bridge', icon: 'hardware-chip' },
          { tab: 'LEDGER' as TabScreen, label: 'Ledger', icon: 'receipt' },
        ].map((item) => {
          const isActive = activeTab === item.tab;
          return (
            <TouchableOpacity
              key={item.tab}
              style={styles.navItem}
              onPress={() => setActiveTab(item.tab)}
              accessibilityRole="button"
              accessibilityLabel={item.label}
            >
              <Ionicons
                name={(isActive ? item.icon : `${item.icon}-outline`) as any}
                size={22}
                color={isActive ? '#047857' : '#64748B'}
              />
              <Text style={[styles.navLabel, isActive && styles.navLabelActive]}>
                {item.label}
              </Text>
            </TouchableOpacity>
          );
        })}
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeContainer: {
    flex: 1,
    backgroundColor: '#0F172A',
  },
  header: {
    backgroundColor: '#0F172A',
    paddingHorizontal: 20,
    paddingTop: Platform.OS === 'android' ? 36 : 12,
    paddingBottom: 14,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderBottomWidth: 1,
    borderBottomColor: '#1E293B',
  },
  brandRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  brandIconContainer: {
    width: 38,
    height: 38,
    borderRadius: 10,
    backgroundColor: '#047857',
    alignItems: 'center',
    justifyContent: 'center',
  },
  brandTitle: {
    color: '#F8FAFC',
    fontSize: 17,
    fontWeight: '700',
    letterSpacing: 0.3,
  },
  brandSubtitle: {
    color: '#94A3B8',
    fontSize: 11,
    marginTop: 2,
  },
  statusBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 999,
  },
  statusBadgeOnline: {
    backgroundColor: 'rgba(16, 185, 129, 0.15)',
    borderWidth: 1,
    borderColor: '#059669',
  },
  statusBadgeOffline: {
    backgroundColor: 'rgba(239, 68, 68, 0.15)',
    borderWidth: 1,
    borderColor: '#DC2626',
  },
  statusDot: {
    width: 7,
    height: 7,
    borderRadius: 999,
  },
  statusDotOnline: { backgroundColor: '#10B981' },
  statusDotOffline: { backgroundColor: '#EF4444' },
  statusBadgeText: {
    fontSize: 11,
    fontWeight: '600',
  },
  statusBadgeTextOnline: { color: '#34D399' },
  statusBadgeTextOffline: { color: '#F87171' },

  banner: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 10,
    gap: 10,
  },
  bannerSuccess: { backgroundColor: '#ECFDF5', borderBottomWidth: 1, borderBottomColor: '#A7F3D0' },
  bannerError: { backgroundColor: '#FEF2F2', borderBottomWidth: 1, borderBottomColor: '#FECACA' },
  bannerInfo: { backgroundColor: '#EFF6FF', borderBottomWidth: 1, borderBottomColor: '#BFDBFE' },
  bannerText: { flex: 1, fontSize: 12, fontWeight: '600' },
  bannerTextSuccess: { color: '#065F46' },
  bannerTextError: { color: '#991B1B' },
  bannerTextInfo: { color: '#1E40AF' },
  bannerClose: { padding: 4 },

  scrollContent: {
    backgroundColor: '#F8FAFC',
    padding: 16,
    paddingBottom: 90,
  },
  tabContent: {
    gap: 16,
  },

  heroCard: {
    backgroundColor: '#065F46',
    borderRadius: 20,
    padding: 20,
    shadowColor: '#000',
    shadowOpacity: 0.1,
    shadowRadius: 10,
    elevation: 3,
  },
  cardHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  badgePill: {
    backgroundColor: 'rgba(255, 255, 255, 0.2)',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 6,
  },
  badgePillText: {
    color: '#FFFFFF',
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 0.5,
  },
  stateTag: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
  },
  stateTagNormal: { backgroundColor: '#10B981' },
  stateTagWarning: { backgroundColor: '#F59E0B' },
  stateTagText: {
    fontSize: 10,
    fontWeight: '700',
  },
  stateTagTextNormal: { color: '#FFFFFF' },
  stateTagTextWarning: { color: '#78350F' },

  heroNumber: {
    fontSize: 38,
    fontWeight: '800',
    color: '#FFFFFF',
    marginTop: 14,
  },
  heroUnit: {
    fontSize: 20,
    fontWeight: '500',
    color: '#D1FAE5',
  },
  heroStatsRow: {
    flexDirection: 'row',
    backgroundColor: 'rgba(0, 0, 0, 0.15)',
    borderRadius: 12,
    padding: 12,
    marginTop: 16,
    justifyContent: 'space-around',
    alignItems: 'center',
  },
  statCol: {
    alignItems: 'center',
  },
  statLabel: {
    color: '#A7F3D0',
    fontSize: 10,
    fontWeight: '600',
    textTransform: 'uppercase',
  },
  statValue: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '700',
    marginTop: 3,
  },
  statDivider: {
    width: 1,
    height: 24,
    backgroundColor: 'rgba(255, 255, 255, 0.2)',
  },

  card: {
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    padding: 18,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    shadowColor: '#000',
    shadowOpacity: 0.03,
    shadowRadius: 5,
    elevation: 1,
  },
  cardTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 4,
  },
  cardTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: '#0F172A',
  },
  cardSubtitle: {
    fontSize: 12,
    color: '#64748B',
    marginBottom: 14,
    lineHeight: 17,
  },

  predictionPillContainer: {
    flexDirection: 'row',
    gap: 12,
    marginBottom: 14,
  },
  predictionInfoBlock: {
    flex: 1,
    backgroundColor: '#F8FAFC',
    borderRadius: 10,
    padding: 12,
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  predictionSmallLabel: {
    fontSize: 11,
    color: '#64748B',
    fontWeight: '500',
  },
  predictionLargeVal: {
    fontSize: 16,
    fontWeight: '700',
    color: '#0F172A',
    marginTop: 3,
  },

  fieldLabel: {
    fontSize: 12,
    fontWeight: '600',
    color: '#334155',
    marginBottom: 6,
    marginTop: 6,
  },
  textInput: {
    height: 46,
    borderWidth: 1,
    borderColor: '#CBD5E1',
    borderRadius: 10,
    paddingHorizontal: 14,
    fontSize: 15,
    color: '#0F172A',
    backgroundColor: '#F8FAFC',
    marginBottom: 8,
  },

  bufferButtonGroup: {
    flexDirection: 'row',
    gap: 8,
    marginVertical: 6,
  },
  bufferBtn: {
    flex: 1,
    height: 38,
    backgroundColor: '#F1F5F9',
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  bufferBtnActive: {
    backgroundColor: '#047857',
  },
  bufferBtnText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#475569',
  },
  bufferBtnTextActive: {
    color: '#FFFFFF',
  },

  applySuggestionBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    height: 42,
    backgroundColor: '#ECFDF5',
    borderWidth: 1,
    borderColor: '#A7F3D0',
    borderRadius: 10,
    marginTop: 10,
  },
  applySuggestionBtnText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#065F46',
  },

  amountChipsRow: {
    flexDirection: 'row',
    gap: 8,
    marginVertical: 8,
  },
  amountChip: {
    flex: 1,
    height: 34,
    backgroundColor: '#F1F5F9',
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  amountChipActive: {
    backgroundColor: '#047857',
  },
  amountChipText: {
    fontSize: 11,
    fontWeight: '600',
    color: '#475569',
  },
  amountChipTextActive: {
    color: '#FFFFFF',
  },

  primaryActionButton: {
    height: 48,
    backgroundColor: '#047857',
    borderRadius: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    marginTop: 12,
  },
  primaryActionButtonText: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '700',
  },

  metricRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#F1F5F9',
  },
  metricDay: {
    fontSize: 13,
    fontWeight: '600',
    color: '#0F172A',
  },
  metricDate: {
    fontSize: 11,
    color: '#64748B',
    marginTop: 1,
  },
  metricKwh: {
    fontSize: 13,
    fontWeight: '700',
    color: '#0F172A',
  },
  metricCost: {
    fontSize: 11,
    color: '#64748B',
    marginTop: 1,
  },

  diagRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: '#F1F5F9',
  },
  diagKey: {
    fontSize: 12,
    color: '#64748B',
  },
  diagVal: {
    fontSize: 12,
    fontWeight: '600',
    color: '#0F172A',
  },

  ledgerFilterRow: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 6,
  },
  filterChip: {
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 8,
    backgroundColor: '#E2E8F0',
  },
  filterChipActive: {
    backgroundColor: '#047857',
  },
  filterChipText: {
    fontSize: 11,
    fontWeight: '600',
    color: '#475569',
  },
  filterChipTextActive: {
    color: '#FFFFFF',
  },

  txCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 14,
    padding: 14,
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  txHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  txTypeContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  txIconBubble: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  txIconCredit: { backgroundColor: '#ECFDF5' },
  txIconDebit: { backgroundColor: '#FEF3C7' },
  txTypeText: {
    fontSize: 13,
    fontWeight: '700',
    color: '#0F172A',
  },
  txReceiptText: {
    fontSize: 11,
    color: '#64748B',
    fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace',
    marginTop: 1,
  },
  txRight: {
    alignItems: 'flex-end',
  },
  txAmountText: {
    fontSize: 14,
    fontWeight: '700',
  },
  txAmountCredit: { color: '#047857' },
  txAmountDebit: { color: '#B45309' },
  txKwhText: {
    fontSize: 11,
    color: '#64748B',
    marginTop: 1,
  },
  txFooter: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 10,
    paddingTop: 8,
    borderTopWidth: 1,
    borderTopColor: '#F8FAFC',
  },
  txPartyText: {
    fontSize: 11,
    color: '#64748B',
  },
  txDateText: {
    fontSize: 10,
    color: '#94A3B8',
  },

  bottomNav: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    height: 64,
    backgroundColor: '#FFFFFF',
    borderTopWidth: 1,
    borderTopColor: '#E2E8F0',
    flexDirection: 'row',
    paddingBottom: Platform.OS === 'ios' ? 16 : 4,
  },
  navItem: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 3,
  },
  navLabel: {
    fontSize: 10,
    fontWeight: '600',
    color: '#64748B',
  },
  navLabelActive: {
    color: '#047857',
    fontWeight: '700',
  },
});

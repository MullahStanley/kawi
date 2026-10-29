import React, { useEffect, useMemo, useState } from 'react';
import {
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { StatusBar } from 'expo-status-bar';
import AsyncStorage from '@react-native-async-storage/async-storage';
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
  normalizeMpesaPhone,
} from './src/energyLogic';

type TabScreen = 'CONSUMER' | 'PROSUMER' | 'BRIDGE';

const INITIAL_METRICS: DailyMetricRecord[] = [
  { dateStr: '2026-10-17', dayLabel: 'Oct 17', consumedKwh: 6.6, exportedKwh: 14.3, costKes: 122.1, revenueKes: 257.9, peakHourKw: 4.0 },
  { dateStr: '2026-10-18', dayLabel: 'Oct 18', consumedKwh: 7.1, exportedKwh: 15.0, costKes: 131.35, revenueKes: 270.6, peakHourKw: 4.2 },
  { dateStr: '2026-10-19', dayLabel: 'Oct 19', consumedKwh: 7.9, exportedKwh: 13.2, costKes: 146.15, revenueKes: 238.1, peakHourKw: 3.7 },
  { dateStr: '2026-10-20', dayLabel: 'Oct 20', consumedKwh: 6.3, exportedKwh: 11.8, costKes: 116.55, revenueKes: 212.8, peakHourKw: 3.3 },
  { dateStr: '2026-10-21', dayLabel: 'Oct 21', consumedKwh: 7.4, exportedKwh: 14.4, costKes: 136.9, revenueKes: 259.7, peakHourKw: 4.0 },
  { dateStr: '2026-10-22', dayLabel: 'Oct 22', consumedKwh: 8.1, exportedKwh: 15.1, costKes: 149.85, revenueKes: 272.4, peakHourKw: 4.2 },
  { dateStr: '2026-10-23', dayLabel: 'Oct 23', consumedKwh: 6.8, exportedKwh: 13.6, costKes: 125.8, revenueKes: 245.3, peakHourKw: 3.8 },
];

export default function App() {
  const [activeTab, setActiveTab] = useState<TabScreen>('CONSUMER');
  const [isOffline, setIsOffline] = useState(false);
  const [safetyBufferDays, setSafetyBufferDays] = useState(3);
  const [mpesaPhone, setMpesaPhone] = useState('+254712345678');
  const [depositKesInput, setDepositKesInput] = useState('620');
  const [withdrawKesInput, setWithdrawKesInput] = useState('2000');
  const [pulseKwhInput, setPulseKwhInput] = useState('4.5');
  const [statusBanner, setStatusBanner] = useState<string | null>(null);

  const [household, setHousehold] = useState<HouseholdNodeState>({
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
  });

  const [dailyMetrics, setDailyMetrics] = useState<DailyMetricRecord[]>(INITIAL_METRICS);
  const [transactions, setTransactions] = useState<EnergyTransactionRecord[]>([
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
      createdAtIso: '2026-10-22T18:14:00Z',
    },
  ]);

  // Load cached state from AsyncStorage on device boot
  useEffect(() => {
    (async () => {
      try {
        const cached = await AsyncStorage.getItem('kawigrid_rn_household');
        if (cached) {
          setHousehold(JSON.parse(cached));
        }
      } catch {
        // Ignore cache read error
      }
    })();
  }, []);

  // Attach real-time Firestore listener when user is authenticated
  useEffect(() => {
    const user = auth.currentUser;
    if (!user) return;
    const docId = `node_${user.uid.slice(0, 24)}`;
    const unsubscribe = onSnapshot(doc(db, 'households', docId), (snap) => {
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
    });
    return () => unsubscribe();
  }, []);

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

  const persistHousehold = async (next: HouseholdNodeState) => {
    setHousehold(next);
    await AsyncStorage.setItem('kawigrid_rn_household', JSON.stringify(next));
    if (auth.currentUser?.emailVerified) {
      const docId = `node_${auth.currentUser.uid.slice(0, 24)}`;
      await updateDoc(doc(db, 'households', docId), {
        tokenBalanceKwh: next.tokenBalanceKwh,
        withdrawableBalanceKes: next.withdrawableBalanceKes,
        totalExportedKwh: next.totalExportedKwh,
        totalConsumedKwh: next.totalConsumedKwh,
        updatedAt: serverTimestamp(),
      });
    }
  };

  const handleStkTopUp = async () => {
    const phone = normalizeMpesaPhone(mpesaPhone);
    const amountKes = Number(depositKesInput);
    if (!phone || Number.isNaN(amountKes) || amountKes < 20) {
      setStatusBanner('Enter a valid Safaricom phone (+2547...) and minimum KES 20.');
      return;
    }

    const purchasedKwh = Number((amountKes / household.tariffKesPerKwh).toFixed(2));
    const receipt = `SJK${Math.random().toString(36).substring(2, 10).toUpperCase()}`;
    const nextState: HouseholdNodeState = {
      ...household,
      tokenBalanceKwh: Number((household.tokenBalanceKwh + purchasedKwh).toFixed(2)),
      updatedAtIso: new Date().toISOString(),
    };

    await persistHousehold(nextState);
    setTransactions((prev) => [
      {
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
      },
      ...prev,
    ]);
    setStatusBanner(`STK Push Confirmed (${receipt}): +${purchasedKwh} kWh credited.`);
  };

  const handleB2CWithdraw = async () => {
    const phone = normalizeMpesaPhone(mpesaPhone);
    const withdrawalKes = Number(withdrawKesInput);
    if (!phone || Number.isNaN(withdrawalKes) || withdrawalKes < 50) {
      setStatusBanner('Minimum M-Pesa B2C withdrawal is KES 50.');
      return;
    }
    if (withdrawalKes > household.withdrawableBalanceKes) {
      setStatusBanner('Insufficient withdrawable escrow balance.');
      return;
    }

    const receipt = `SJI${Math.random().toString(36).substring(2, 10).toUpperCase()}`;
    const nextState: HouseholdNodeState = {
      ...household,
      withdrawableBalanceKes: Number((household.withdrawableBalanceKes - withdrawalKes).toFixed(2)),
      updatedAtIso: new Date().toISOString(),
    };

    await persistHousehold(nextState);
    setStatusBanner(`Daraja B2C Disbursed (${receipt}): KES ${withdrawalKes} sent to ${phone}.`);
  };

  const handleSimulateMeterPulse = async () => {
    const deltaKwh = Number(pulseKwhInput);
    if (Number.isNaN(deltaKwh) || deltaKwh <= 0 || deltaKwh > household.tokenBalanceKwh) {
      setStatusBanner('Invalid kWh pulse or insufficient Consumer token balance.');
      return;
    }

    const grossKes = deltaKwh * household.tariffKesPerKwh;
    const netCreditKes = Number((grossKes * 0.975).toFixed(2));
    const nextState: HouseholdNodeState = {
      ...household,
      tokenBalanceKwh: Number((household.tokenBalanceKwh - deltaKwh).toFixed(2)),
      withdrawableBalanceKes: Number((household.withdrawableBalanceKes + netCreditKes).toFixed(2)),
      totalConsumedKwh: Number((household.totalConsumedKwh + deltaKwh).toFixed(2)),
      totalExportedKwh: Number((household.totalExportedKwh + deltaKwh).toFixed(2)),
      updatedAtIso: new Date().toISOString(),
    };

    await persistHousehold(nextState);
    setStatusBanner(
      `IoT Pulse Ingested: -${deltaKwh.toFixed(2)} kWh Consumer / +KES ${netCreditKes} Prosumer.`
    );
  };

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar style="dark" />
      <View style={styles.header}>
        <Text style={styles.brandTitle}>KawiGrid P2P</Text>
        <Text style={styles.meterSubtitle}>
          {household.meterNumber} · {isOffline ? 'Offline Cache' : 'Firestore Live'}
        </Text>
      </View>

      {statusBanner && (
        <View style={styles.banner}>
          <Text style={styles.bannerText}>{statusBanner}</Text>
        </View>
      )}

      <ScrollView contentContainerStyle={styles.scrollContent}>
        {activeTab === 'CONSUMER' && (
          <View style={styles.sectionStack}>
            <View style={styles.card}>
              <Text style={styles.kicker}>CONSUMER TOKEN METER</Text>
              <Text style={styles.heroValue}>{household.tokenBalanceKwh.toFixed(2)} kWh</Text>
              <Text style={styles.captionText}>
                Est. {prediction.estimatedAutonomyDays} Days Autonomy · Tariff KES{' '}
                {household.tariffKesPerKwh.toFixed(2)}/kWh
              </Text>
            </View>

            <View style={styles.card}>
              <Text style={styles.sectionTitle}>Smart Deposit Prediction</Text>
              <Text style={styles.captionText}>
                Avg {prediction.averageDailyUsageKwh} kWh/day · {prediction.daysRemainingInMonth}{' '}
                days left in month
              </Text>
              <View style={styles.bufferRow}>
                {[0, 3, 5, 7].map((d) => (
                  <TouchableOpacity
                    key={d}
                    onPress={() => setSafetyBufferDays(d)}
                    style={[
                      styles.segmentBtn,
                      safetyBufferDays === d && styles.segmentBtnActive,
                    ]}
                  >
                    <Text
                      style={[
                        styles.segmentBtnText,
                        safetyBufferDays === d && styles.segmentBtnTextActive,
                      ]}
                    >
                      +{d}d
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>
              <Text style={styles.highlightMetric}>
                Suggested Deposit: KES {prediction.suggestedDepositKes} ({prediction.suggestedTokensKwh}{' '}
                kWh)
              </Text>
              <TouchableOpacity
                style={styles.secondaryButton}
                onPress={() => setDepositKesInput(String(prediction.suggestedDepositKes))}
              >
                <Text style={styles.secondaryButtonText}>
                  Apply Suggested KES {prediction.suggestedDepositKes}
                </Text>
              </TouchableOpacity>
            </View>

            <View style={styles.card}>
              <Text style={styles.sectionTitle}>Top Up via M-Pesa (STK Push)</Text>
              <Text style={styles.inputLabel}>Safaricom Phone</Text>
              <TextInput
                style={styles.input}
                value={mpesaPhone}
                onChangeText={setMpesaPhone}
                keyboardType="phone-pad"
              />
              <Text style={styles.inputLabel}>Amount (KES)</Text>
              <TextInput
                style={styles.input}
                value={depositKesInput}
                onChangeText={setDepositKesInput}
                keyboardType="numeric"
              />
              <TouchableOpacity style={styles.primaryButton} onPress={handleStkTopUp}>
                <Text style={styles.primaryButtonText}>
                  Top Up KES {depositKesInput} via M-Pesa
                </Text>
              </TouchableOpacity>
            </View>
          </View>
        )}

        {activeTab === 'PROSUMER' && (
          <View style={styles.sectionStack}>
            <View style={styles.card}>
              <Text style={styles.kicker}>PROSUMER ESCROW WALLET</Text>
              <Text style={styles.heroValue}>
                KES {household.withdrawableBalanceKes.toLocaleString()}
              </Text>
              <Text style={styles.captionText}>
                Total Exported: {household.totalExportedKwh.toFixed(2)} kWh · 97.5% Net Share
              </Text>
            </View>

            <View style={styles.card}>
              <Text style={styles.sectionTitle}>Withdraw to M-Pesa (Daraja B2C)</Text>
              <Text style={styles.inputLabel}>Registered M-Pesa Number</Text>
              <TextInput
                style={styles.input}
                value={mpesaPhone}
                onChangeText={setMpesaPhone}
                keyboardType="phone-pad"
              />
              <Text style={styles.inputLabel}>Withdrawal Amount (KES)</Text>
              <TextInput
                style={styles.input}
                value={withdrawKesInput}
                onChangeText={setWithdrawKesInput}
                keyboardType="numeric"
              />
              <TouchableOpacity style={styles.darkButton} onPress={handleB2CWithdraw}>
                <Text style={styles.primaryButtonText}>
                  Withdraw KES {withdrawKesInput} to M-Pesa
                </Text>
              </TouchableOpacity>
            </View>
          </View>
        )}

        {activeTab === 'BRIDGE' && (
          <View style={styles.sectionStack}>
            <View style={styles.card}>
              <Text style={styles.sectionTitle}>IoT Smart Meter Bridge</Text>
              <Text style={styles.inputLabel}>Meter Pulse Consumption (kWh)</Text>
              <TextInput
                style={styles.input}
                value={pulseKwhInput}
                onChangeText={setPulseKwhInput}
                keyboardType="numeric"
              />
              <TouchableOpacity style={styles.primaryButton} onPress={handleSimulateMeterPulse}>
                <Text style={styles.primaryButtonText}>
                  Push Smart Meter Reading ({pulseKwhInput} kWh)
                </Text>
              </TouchableOpacity>
            </View>

            <View style={styles.card}>
              <Text style={styles.sectionTitle}>Offline Firestore Persistence</Text>
              <TouchableOpacity
                style={styles.secondaryButton}
                onPress={async () => {
                  const next = !isOffline;
                  setIsOffline(next);
                  await setOfflineNetworkMode(next);
                }}
              >
                <Text style={styles.secondaryButtonText}>
                  {isOffline ? 'Reconnect Firestore Network' : 'Simulate Offline Network Drop'}
                </Text>
              </TouchableOpacity>
            </View>
          </View>
        )}
      </ScrollView>

      <View style={styles.bottomTabBar}>
        {(['CONSUMER', 'PROSUMER', 'BRIDGE'] as TabScreen[]).map((tab) => (
          <TouchableOpacity
            key={tab}
            style={styles.tabItem}
            onPress={() => setActiveTab(tab)}
          >
            <Text
              style={[
                styles.tabText,
                activeTab === tab && styles.tabTextActive,
              ]}
            >
              {tab}
            </Text>
          </TouchableOpacity>
        ))}
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F8FAFC' },
  header: {
    paddingHorizontal: 20,
    paddingVertical: 14,
    backgroundColor: '#FFFFFF',
    borderBottomWidth: 1,
    borderBottomColor: '#E2E8F0',
  },
  brandTitle: { fontSize: 18, fontWeight: '700', color: '#0F172A' },
  meterSubtitle: { fontSize: 12, color: '#64748B', marginTop: 2 },
  banner: {
    backgroundColor: '#ECFDF5',
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#A7F3D0',
  },
  bannerText: { fontSize: 12, fontWeight: '600', color: '#065F46' },
  scrollContent: { padding: 16, paddingBottom: 96 },
  sectionStack: { gap: 16 },
  card: {
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    padding: 20,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    marginBottom: 16,
  },
  kicker: { fontSize: 11, fontWeight: '600', color: '#64748B', letterSpacing: 0.5 },
  heroValue: { fontSize: 34, fontWeight: '700', color: '#0F172A', marginVertical: 6 },
  sectionTitle: { fontSize: 16, fontWeight: '700', color: '#0F172A', marginBottom: 6 },
  captionText: { fontSize: 12, color: '#64748B', marginBottom: 12 },
  highlightMetric: { fontSize: 14, fontWeight: '700', color: '#047857', marginVertical: 10 },
  bufferRow: { flexDirection: 'row', gap: 8, marginVertical: 8 },
  segmentBtn: {
    flex: 1,
    paddingVertical: 8,
    backgroundColor: '#F1F5F9',
    borderRadius: 8,
    alignItems: 'center',
  },
  segmentBtnActive: { backgroundColor: '#047857' },
  segmentBtnText: { fontSize: 12, fontWeight: '600', color: '#475569' },
  segmentBtnTextActive: { color: '#FFFFFF' },
  inputLabel: { fontSize: 12, fontWeight: '600', color: '#334155', marginBottom: 6, marginTop: 8 },
  input: {
    minHeight: 44,
    borderWidth: 1,
    borderColor: '#CBD5E1',
    borderRadius: 10,
    paddingHorizontal: 12,
    fontSize: 15,
    backgroundColor: '#F8FAFC',
    color: '#0F172A',
  },
  primaryButton: {
    minHeight: 48,
    backgroundColor: '#047857',
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 16,
  },
  darkButton: {
    minHeight: 48,
    backgroundColor: '#0F172A',
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 16,
  },
  primaryButtonText: { color: '#FFFFFF', fontSize: 14, fontWeight: '700' },
  secondaryButton: {
    minHeight: 44,
    backgroundColor: '#ECFDF5',
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 8,
  },
  secondaryButtonText: { color: '#065F46', fontSize: 13, fontWeight: '600' },
  bottomTabBar: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    height: 60,
    backgroundColor: '#FFFFFF',
    borderTopWidth: 1,
    borderTopColor: '#E2E8F0',
    flexDirection: 'row',
  },
  tabItem: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  tabText: { fontSize: 12, fontWeight: '600', color: '#64748B' },
  tabTextActive: { color: '#047857', fontWeight: '700' },
});

import React, { useState } from 'react';
import {
  HouseholdNodeState,
  PEER_GRID_NODES,
  normalizeMpesaPhone,
} from '../utils/energyLogic';
import {
  CheckCircle2,
  AlertTriangle,
  Cpu,
  Wifi,
  WifiOff,
  ShieldCheck,
  LogIn,
  LogOut,
} from 'lucide-react';

interface IoTMeterBridgeViewProps {
  household: HouseholdNodeState;
  onIngestMeterPulse: (params: {
    deltaKwh: number;
    prosumerMeter: string;
    voltageV: number;
    frequencyHz: number;
  }) => Promise<{
    pulseReceipt: string;
    consumerCostKes: number;
    prosumerNetCreditKes: number;
    platformFeeKes: number;
  }>;
  isOffline: boolean;
  onToggleOffline: (nextOffline: boolean) => Promise<void>;
  currentUserEmail: string | null;
  onGoogleSignIn: () => Promise<void>;
  onGoogleSignOut: () => Promise<void>;
  mpesaPhone: string;
  onUpdateMpesaPhone: (nextPhone: string) => Promise<void>;
}

export const IoTMeterBridgeView: React.FC<IoTMeterBridgeViewProps> = ({
  household,
  onIngestMeterPulse,
  isOffline,
  onToggleOffline,
  currentUserEmail,
  onGoogleSignIn,
  onGoogleSignOut,
  mpesaPhone,
  onUpdateMpesaPhone,
}) => {
  const [deltaKwhInput, setDeltaKwhInput] = useState<string>('4.5');
  const [selectedProsumer, setSelectedProsumer] = useState<string>(PEER_GRID_NODES[0].meterNumber);
  const [voltageV] = useState<number>(240.2);
  const [frequencyHz] = useState<number>(50.01);
  const [isPushing, setIsPushing] = useState(false);
  const [bridgeError, setBridgeError] = useState<string | null>(null);
  const [lastPulseResult, setLastPulseResult] = useState<{
    pulseReceipt: string;
    deltaKwh: number;
    consumerCostKes: number;
    prosumerNetCreditKes: number;
    platformFeeKes: number;
    prosumerMeter: string;
  } | null>(null);

  const [piiPhoneInput, setPiiPhoneInput] = useState(mpesaPhone);
  const [piiStatusMsg, setPiiStatusMsg] = useState<string | null>(null);

  const numericDelta = Number(deltaKwhInput);
  const previewGrossKes =
    !Number.isNaN(numericDelta) && numericDelta > 0
      ? Number((numericDelta * household.tariffKesPerKwh).toFixed(2))
      : 0;
  const previewProsumerNet = Number((previewGrossKes * 0.975).toFixed(2));

  const handleMeterSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBridgeError(null);

    const delta = Number(deltaKwhInput);
    if (Number.isNaN(delta) || delta <= 0 || delta > 500) {
      setBridgeError('Smart meter reading deltaKwh must be between 0.1 and 500 kWh.');
      return;
    }

    if (delta > household.tokenBalanceKwh) {
      setBridgeError(
        `Insufficient Consumer token balance (${household.tokenBalanceKwh.toFixed(2)} kWh) to deduct ${delta.toFixed(2)} kWh. Top up tokens first.`
      );
      return;
    }

    setIsPushing(true);
    try {
      const res = await onIngestMeterPulse({
        deltaKwh: delta,
        prosumerMeter: selectedProsumer,
        voltageV,
        frequencyHz,
      });
      setLastPulseResult({
        pulseReceipt: res.pulseReceipt,
        deltaKwh: delta,
        consumerCostKes: res.consumerCostKes,
        prosumerNetCreditKes: res.prosumerNetCreditKes,
        platformFeeKes: res.platformFeeKes,
        prosumerMeter: selectedProsumer,
      });
    } catch (err) {
      setBridgeError(err instanceof Error ? err.message : 'IoT Meter ingestion failed.');
    } finally {
      setIsPushing(false);
    }
  };

  const handleSavePiiPhone = async (e: React.FormEvent) => {
    e.preventDefault();
    setPiiStatusMsg(null);
    const normalized = normalizeMpesaPhone(piiPhoneInput);
    if (!normalized) {
      setPiiStatusMsg('Error: Enter a valid Safaricom number (+2547XXXXXXXX).');
      return;
    }
    await onUpdateMpesaPhone(normalized);
    setPiiPhoneInput(normalized);
    setPiiStatusMsg(`Saved ${normalized} to PII-isolated vault (/households/${household.id}/private/contact).`);
  };

  return (
    <div className="space-y-8">
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-stretch">
        {/* Left 7 Columns: Smart Meter Telemetry Ingest Simulator */}
        <section
          aria-label="IoT Smart Meter Bridge Simulator"
          className="lg:col-span-7 bg-white border border-slate-200 rounded-2xl p-6 sm:p-8 flex flex-col justify-between space-y-6"
        >
          <div className="space-y-2 pb-4 border-b border-slate-100">
            <div className="flex items-center gap-2 text-xs text-slate-500">
              <span>Cloud Function Endpoint: /api/iot/meter-ingest</span>
              <span aria-hidden="true">·</span>
              <span>Atomic Firestore Settlement</span>
            </div>
            <h1 className="text-2xl font-bold text-slate-900 flex items-center gap-2">
              <Cpu className="w-6 h-6 text-emerald-700" />
              <span>IoT Smart Meter Bridge & P2P Settlement</span>
            </h1>
            <p className="text-xs text-slate-600">
              Simulates an optical/RS-485 smart meter pushing a real-time consumption packet to the Cloud Function endpoint, deducting kWh tokens from the Consumer node and crediting KES to the Prosumer escrow wallet.
            </p>
          </div>

          <form onSubmit={handleMeterSubmit} className="space-y-5" noValidate>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label
                  htmlFor="iot-prosumer-select"
                  className="block text-xs font-semibold text-slate-700 mb-1.5"
                >
                  Source Prosumer Node
                </label>
                <select
                  id="iot-prosumer-select"
                  value={selectedProsumer}
                  onChange={(e) => setSelectedProsumer(e.target.value)}
                  className="w-full min-h-[44px] px-3 py-2 text-xs font-mono bg-slate-50 border border-slate-300 rounded-lg text-slate-900 focus:bg-white focus:border-emerald-600 focus:outline-none"
                >
                  {PEER_GRID_NODES.map((node) => (
                    <option key={node.meterNumber} value={node.meterNumber}>
                      {node.meterNumber} — {node.houseName}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <label
                    htmlFor="iot-delta-kwh"
                    className="block text-xs font-semibold text-slate-700"
                  >
                    Metered Energy Transfer (kWh)
                  </label>
                  <span className="text-xs font-mono tabular-nums text-emerald-700 font-semibold">
                    Avail: {household.tokenBalanceKwh.toFixed(2)} kWh
                  </span>
                </div>
                <input
                  id="iot-delta-kwh"
                  type="number"
                  min={0.1}
                  max={500}
                  step={0.5}
                  value={deltaKwhInput}
                  onChange={(e) => setDeltaKwhInput(e.target.value)}
                  className="w-full min-h-[44px] px-3.5 py-2 text-base font-bold font-mono tabular-nums bg-slate-50 border border-slate-300 rounded-lg text-slate-900 focus:bg-white focus:border-emerald-600 focus:outline-none"
                />
              </div>
            </div>

            {/* Quick kWh Pulse Presets */}
            <div className="grid grid-cols-4 gap-2">
              {[1.5, 4.5, 8.0, 12.0].map((val) => (
                <button
                  key={val}
                  type="button"
                  onClick={() => {
                    setDeltaKwhInput(String(val));
                    setBridgeError(null);
                  }}
                  className="min-h-[38px] px-2 py-1.5 text-xs font-mono tabular-nums font-medium bg-slate-100 hover:bg-slate-200 text-slate-800 rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                >
                  {val.toFixed(1)} kWh Pulse
                </button>
              ))}
            </div>

            {/* Grid Line Parameters & Settlement Preview */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 py-4 border-y border-slate-100 text-xs">
              <div>
                <div className="text-slate-500">Consumer Deduction</div>
                <div className="font-mono tabular-nums font-bold text-slate-900 mt-0.5">
                  -{Number(deltaKwhInput || 0).toFixed(2)} kWh
                </div>
              </div>
              <div>
                <div className="text-slate-500">Gross Value</div>
                <div className="font-mono tabular-nums font-bold text-slate-900 mt-0.5">
                  KES {previewGrossKes.toFixed(2)}
                </div>
              </div>
              <div>
                <div className="text-slate-500">Prosumer Credit (97.5%)</div>
                <div className="font-mono tabular-nums font-bold text-emerald-700 mt-0.5">
                  +KES {previewProsumerNet.toFixed(2)}
                </div>
              </div>
              <div>
                <div className="text-slate-500">Line Telemetry</div>
                <div className="font-mono tabular-nums font-semibold text-slate-700 mt-0.5">
                  {voltageV}V · {frequencyHz}Hz
                </div>
              </div>
            </div>

            {bridgeError && (
              <div
                role="alert"
                className="p-3 rounded-lg bg-red-50 border border-red-200 text-xs text-red-800 flex items-start gap-2"
              >
                <AlertTriangle className="w-4 h-4 text-red-600 shrink-0 mt-0.5" />
                <span>{bridgeError}</span>
              </div>
            )}

            {lastPulseResult && (
              <div
                role="status"
                data-testid="iot-pulse-success"
                className="p-3.5 rounded-lg bg-emerald-50 border border-emerald-200 text-xs text-emerald-950 space-y-1"
              >
                <div className="font-semibold flex items-center gap-1.5 text-emerald-800">
                  <CheckCircle2 className="w-4 h-4 shrink-0" />
                  <span>IoT Packet Ingested · Batch {lastPulseResult.pulseReceipt}</span>
                </div>
                <p className="font-mono tabular-nums text-emerald-900">
                  Deducted {lastPulseResult.deltaKwh.toFixed(2)} kWh from Consumer & credited +KES {lastPulseResult.prosumerNetCreditKes.toFixed(2)} to Prosumer Wallet (Fee KES {lastPulseResult.platformFeeKes.toFixed(2)}).
                </p>
              </div>
            )}

            <button
              type="submit"
              disabled={isPushing}
              className="w-full min-h-[48px] px-4 py-3 text-sm font-semibold text-white bg-emerald-700 hover:bg-emerald-800 disabled:opacity-60 rounded-xl transition-colors flex items-center justify-center gap-2 whitespace-nowrap shrink-0 cursor-pointer"
            >
              <Cpu className="w-4 h-4" />
              <span>
                {isPushing
                  ? 'Ingesting Smart Meter Packet...'
                  : `Push Smart Meter Reading (${Number(deltaKwhInput || 0).toFixed(2)} kWh)`}
              </span>
            </button>
          </form>
        </section>

        {/* Right 5 Columns: Offline Cache Controller & Firebase Auth / PII Vault (Single-Elevation Hairline Dividers) */}
        <section
          aria-label="Firestore Offline Persistence and Cloud Sync"
          className="lg:col-span-5 bg-white border border-slate-200 rounded-2xl p-6 sm:p-8 flex flex-col justify-between space-y-6"
        >
          <div className="space-y-6">
            <div className="pb-4 border-b border-slate-100">
              <div className="flex items-center gap-2 text-xs text-slate-500">
                <span>Cloud Firestore Persistence</span>
                <span aria-hidden="true">·</span>
                <span>Zero-Trust PII Vault</span>
              </div>
              <h2 className="text-xl font-bold text-slate-900 mt-1 flex items-center gap-2">
                <ShieldCheck className="w-5 h-5 text-emerald-700" />
                <span>Offline Cache & Cloud Identity</span>
              </h2>
            </div>

            {/* Offline Network Mode Toggle separated by hairline divider */}
            <div className="pb-6 border-b border-slate-100 flex items-center justify-between gap-4">
              <div>
                <div className="text-sm font-semibold text-slate-900 flex items-center gap-2">
                  {isOffline ? (
                    <WifiOff className="w-4 h-4 text-amber-600" />
                  ) : (
                    <Wifi className="w-4 h-4 text-emerald-700" />
                  )}
                  <span>{isOffline ? 'Offline Local Cache Active' : 'Cloud Firestore Network Online'}</span>
                </div>
                <p className="text-xs text-slate-500 mt-1">
                  {isOffline
                    ? 'Mobile network disconnected. Balances and 30-day charts are served from IndexedDB local cache.'
                    : 'Real-time onSnapshot listeners and persistentLocalCache are synchronized.'}
                </p>
              </div>
              <button
                type="button"
                onClick={() => onToggleOffline(!isOffline)}
                className={`min-h-[40px] px-3.5 py-2 text-xs font-semibold rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                  isOffline
                    ? 'bg-emerald-700 text-white hover:bg-emerald-800'
                    : 'bg-slate-100 text-slate-800 hover:bg-slate-200'
                }`}
              >
                {isOffline ? 'Reconnect Network' : 'Simulate Network Drop'}
              </button>
            </div>

            {/* Firebase Authentication Status separated by hairline divider */}
            <div className="pb-6 border-b border-slate-100 space-y-2.5">
              <div className="text-xs font-semibold text-slate-700">
                Firebase Authentication & Multi-Device Sync
              </div>
              {currentUserEmail ? (
                <div className="flex items-center justify-between gap-3">
                  <div className="text-xs text-slate-700 truncate">
                    Signed in as <span className="font-mono font-semibold text-slate-900">{currentUserEmail}</span>
                  </div>
                  <button
                    type="button"
                    onClick={onGoogleSignOut}
                    className="min-h-[38px] px-3 py-1.5 text-xs font-medium text-slate-700 bg-slate-100 rounded-lg hover:bg-slate-200 flex items-center gap-1.5 whitespace-nowrap shrink-0 cursor-pointer"
                  >
                    <LogOut className="w-3.5 h-3.5" />
                    <span>Sign Out</span>
                  </button>
                </div>
              ) : (
                <div className="flex items-center justify-between gap-4">
                  <p className="text-xs text-slate-500">
                    Sign in with Google to bind this household meter to your private Cloud Firestore document.
                  </p>
                  <button
                    type="button"
                    onClick={onGoogleSignIn}
                    className="min-h-[40px] px-3.5 py-2 text-xs font-semibold text-white bg-slate-900 hover:bg-slate-800 rounded-lg flex items-center gap-1.5 whitespace-nowrap shrink-0 cursor-pointer"
                  >
                    <LogIn className="w-3.5 h-3.5" />
                    <span>Sign In with Google</span>
                  </button>
                </div>
              )}
            </div>

            {/* Split-Collection PII M-Pesa Phone Configuration */}
            <form onSubmit={handleSavePiiPhone} className="space-y-2.5">
              <label
                htmlFor="pii-phone-input"
                className="block text-xs font-semibold text-slate-700"
              >
                Isolated M-Pesa Contact (/households/{household.id}/private/contact)
              </label>
              <div className="flex items-center gap-2">
                <input
                  id="pii-phone-input"
                  type="tel"
                  value={piiPhoneInput}
                  onChange={(e) => setPiiPhoneInput(e.target.value)}
                  className="flex-1 min-h-[42px] px-3 py-1.5 text-xs font-mono bg-slate-50 border border-slate-300 rounded-lg text-slate-900 focus:bg-white focus:border-emerald-600 focus:outline-none"
                />
                <button
                  type="submit"
                  className="min-h-[42px] px-3.5 py-1.5 text-xs font-semibold text-slate-900 bg-slate-100 hover:bg-slate-200 rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                >
                  Save Phone
                </button>
              </div>
              {piiStatusMsg && (
                <p className="text-[11px] font-mono text-emerald-800">{piiStatusMsg}</p>
              )}
            </form>
          </div>
        </section>
      </div>
    </div>
  );
};

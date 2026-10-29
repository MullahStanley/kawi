import React, { useState } from 'react';
import {
  DailyMetricRecord,
  HouseholdNodeState,
  SmartDepositPrediction,
  normalizeMpesaPhone,
} from '../utils/energyLogic';
import { CheckCircle2, AlertTriangle, Smartphone, TrendingUp, Zap } from 'lucide-react';

interface ConsumerDashboardProps {
  household: HouseholdNodeState;
  dailyMetrics: DailyMetricRecord[];
  prediction: SmartDepositPrediction;
  safetyBufferDays: number;
  onChangeSafetyBufferDays: (days: number) => void;
  mpesaPhone: string;
  onDepositStkPush: (amountKes: number, phone: string) => Promise<{ receipt: string; purchasedKwh: number }>;
  onNavigateToBridge: () => void;
  isOffline: boolean;
}

export const ConsumerDashboard: React.FC<ConsumerDashboardProps> = ({
  household,
  dailyMetrics,
  prediction,
  safetyBufferDays,
  onChangeSafetyBufferDays,
  mpesaPhone,
  onDepositStkPush,
  onNavigateToBridge,
  isOffline,
}) => {
  const [phoneInput, setPhoneInput] = useState(mpesaPhone);
  const [depositKesInput, setDepositKesInput] = useState<string>(
    String(prediction.suggestedDepositKes)
  );
  const [chartWindow, setChartWindow] = useState<7 | 14 | 30>(14);
  const [selectedBarIndex, setSelectedBarIndex] = useState<number | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [stkReceiptBanner, setStkReceiptBanner] = useState<{
    receipt: string;
    purchasedKwh: number;
    amountKes: number;
    phone: string;
  } | null>(null);

  const visibleMetrics = dailyMetrics.slice(-chartWindow);
  const maxConsumed = Math.max(...visibleMetrics.map((m) => m.consumedKwh), 12);
  const activeBarIdx =
    selectedBarIndex !== null && visibleMetrics[selectedBarIndex]
      ? selectedBarIndex
      : visibleMetrics.length - 1;
  const activeDayMetric = visibleMetrics[activeBarIdx];

  const numericDepositKes = Number(depositKesInput);
  const previewPurchasedKwh =
    !Number.isNaN(numericDepositKes) && numericDepositKes > 0
      ? Number((numericDepositKes / household.tariffKesPerKwh).toFixed(2))
      : 0;

  const handleApplySmartSuggestion = () => {
    setDepositKesInput(String(prediction.suggestedDepositKes));
    setFormError(null);
  };

  const handleStkSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);

    const normalizedPhone = normalizeMpesaPhone(phoneInput);
    if (!normalizedPhone) {
      setFormError('Enter a valid Safaricom M-Pesa number (e.g. +254712345678 or 0712345678).');
      return;
    }

    const amount = Number(depositKesInput);
    if (Number.isNaN(amount) || amount < 20 || amount > 250000) {
      setFormError('M-Pesa STK Push amount must be between KES 20 and KES 250,000.');
      return;
    }

    setIsSubmitting(true);
    try {
      const res = await onDepositStkPush(amount, normalizedPhone);
      setStkReceiptBanner({
        receipt: res.receipt,
        purchasedKwh: res.purchasedKwh,
        amountKes: amount,
        phone: normalizedPhone,
      });
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'STK Push transaction failed.');
    } finally {
      setIsSubmitting(false);
    }
  };

  // Ring gauge math (capacity benchmark 150 kWh)
  const gaugeRatio = Math.min(1, Math.max(0.04, household.tokenBalanceKwh / 150));
  const ringCircumference = 2 * Math.PI * 52;
  const ringDashoffset = ringCircumference * (1 - gaugeRatio);

  // SVG Chart coordinate geometry
  const svgWidth = 840;
  const svgHeight = 190;
  const chartTop = 18;
  const chartBottom = 156;
  const usableHeight = chartBottom - chartTop;
  const slotWidth = svgWidth / visibleMetrics.length;
  const barWidth = Math.min(34, Math.max(12, slotWidth * 0.62));

  return (
    <div className="space-y-8">
      {/* Top Split: Live Token Meter Card + M-Pesa STK Push Instant Top-Up */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-stretch">
        {/* Left 7 Columns: Live Consumer Token Meter & Smart Deposit Prediction */}
        <section
          aria-label="Live Energy Token Balance and Smart Prediction"
          className="lg:col-span-7 bg-white border border-slate-200 rounded-2xl p-6 sm:p-8 flex flex-col justify-between space-y-8"
        >
          {/* Live Token Balance Header & Ring Gauge */}
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-6 pb-6 border-b border-slate-100">
            <div className="space-y-2">
              <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500">
                <span>Meter {household.meterNumber}</span>
                <span aria-hidden="true">·</span>
                <span>{household.neighborhood}</span>
                <span aria-hidden="true">·</span>
                <span className="font-medium text-slate-700">
                  {isOffline ? 'Offline Local Cache' : `Meter Status: ${household.status}`}
                </span>
              </div>
              <h1 className="text-2xl sm:text-3xl font-bold text-slate-900 tracking-tight">
                Consumer Energy Token Balance
              </h1>
              <div className="flex items-baseline gap-3 pt-1">
                <span
                  data-testid="consumer-token-balance"
                  className="text-4xl sm:text-5xl font-bold font-mono tabular-nums text-slate-900 tracking-tight"
                >
                  {household.tokenBalanceKwh.toFixed(2)}
                </span>
                <span className="text-lg font-medium text-slate-500">kWh Available</span>
              </div>
              <p className="text-xs text-slate-500 font-mono tabular-nums">
                Valuation KES {(household.tokenBalanceKwh * household.tariffKesPerKwh).toLocaleString('en-KE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} · P2P Tariff KES {household.tariffKesPerKwh.toFixed(2)}/kWh · Est. {prediction.estimatedAutonomyDays} Days Autonomy
              </p>
            </div>

            {/* SVG Token Ring Gauge */}
            <div className="relative w-32 h-32 shrink-0 flex items-center justify-center self-start sm:self-center">
              <svg className="w-32 h-32 -rotate-90" viewBox="0 0 120 120" aria-hidden="true">
                <circle
                  cx="60"
                  cy="60"
                  r="52"
                  fill="none"
                  stroke="#E2E8F0"
                  strokeWidth="10"
                />
                <circle
                  cx="60"
                  cy="60"
                  r="52"
                  fill="none"
                  stroke={household.tokenBalanceKwh < 20 ? '#D97706' : '#047857'}
                  strokeWidth="10"
                  strokeLinecap="round"
                  strokeDasharray={ringCircumference}
                  strokeDashoffset={ringDashoffset}
                />
              </svg>
              <div className="absolute inset-0 flex flex-col items-center justify-center text-center">
                <span className="text-lg font-bold font-mono tabular-nums text-slate-900">
                  {Math.round(gaugeRatio * 100)}%
                </span>
                <span className="text-[11px] text-slate-500">Reserve</span>
              </div>
            </div>
          </div>

          {/* Smart Deposit Prediction Algorithm Panel */}
          <div className="space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div>
                <h2 className="text-base font-semibold text-slate-900 flex items-center gap-2">
                  <TrendingUp className="w-4 h-4 text-emerald-700" />
                  <span>Smart Deposit Prediction Engine</span>
                </h2>
                <p className="text-xs text-slate-500 mt-0.5">
                  Forecasts required tokens from your 30-day daily average ({prediction.averageDailyUsageKwh} kWh/day) and {prediction.daysRemainingInMonth} days remaining in the month.
                </p>
              </div>

              {/* Buffer Days Segmented Control */}
              <div
                role="group"
                aria-label="Safety Reserve Buffer Days"
                className="flex items-center gap-1 p-1 bg-slate-100 rounded-lg self-start"
              >
                {[0, 3, 5, 7].map((days) => (
                  <button
                    key={days}
                    type="button"
                    onClick={() => onChangeSafetyBufferDays(days)}
                    className={`min-h-[36px] px-2.5 py-1 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                      safetyBufferDays === days
                        ? 'bg-white text-slate-900 shadow-xs'
                        : 'text-slate-600 hover:text-slate-900'
                    }`}
                  >
                    +{days}d Buffer
                  </button>
                ))}
              </div>
            </div>

            {/* Unboxed Tabular Forecast Breakdown (Single-line primary figures + sub-caption) */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 py-4 border-y border-slate-100">
              <div>
                <div className="text-xs text-slate-500">Avg Daily Load</div>
                <div className="text-lg font-bold font-mono tabular-nums text-slate-900 mt-0.5 whitespace-nowrap">
                  {prediction.averageDailyUsageKwh.toFixed(2)} kWh
                </div>
                <div className="text-[11px] font-mono tabular-nums text-slate-500">
                  30-day rolling mean
                </div>
              </div>
              <div>
                <div className="text-xs text-slate-500">Target Coverage</div>
                <div className="text-lg font-bold font-mono tabular-nums text-slate-900 mt-0.5 whitespace-nowrap">
                  {prediction.daysRemainingInMonth + prediction.safetyBufferDays} Days
                </div>
                <div className="text-[11px] font-mono tabular-nums text-slate-500">
                  {prediction.projectedKwhNeeded.toFixed(2)} kWh projected
                </div>
              </div>
              <div>
                <div className="text-xs text-slate-500">Month-End Deficit</div>
                <div className="text-lg font-bold font-mono tabular-nums text-amber-700 mt-0.5 whitespace-nowrap">
                  {prediction.netDeficitKwh.toFixed(2)} kWh
                </div>
                <div className="text-[11px] font-mono tabular-nums text-slate-500">
                  Net token shortfall
                </div>
              </div>
              <div>
                <div className="text-xs text-slate-500">Suggested Deposit</div>
                <div
                  data-testid="smart-suggested-kes"
                  className="text-lg font-bold font-mono tabular-nums text-emerald-700 mt-0.5 whitespace-nowrap"
                >
                  KES {prediction.suggestedDepositKes.toLocaleString()}
                </div>
                <div className="text-[11px] font-mono tabular-nums text-slate-500">
                  +{prediction.suggestedTokensKwh.toFixed(2)} kWh tokens
                </div>
              </div>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
              <div className="text-xs text-slate-600">
                Urgency Status: <span className="font-semibold text-slate-900">{prediction.urgencyLevel}</span> · P2P Feeder: Lavington SunRoof #12
              </div>
              <div className="flex items-center gap-3">
                <button
                  type="button"
                  onClick={onNavigateToBridge}
                  className="min-h-[40px] px-3.5 py-2 text-xs font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                >
                  Simulate Meter Consumption
                </button>
                <button
                  type="button"
                  onClick={handleApplySmartSuggestion}
                  className="min-h-[40px] px-4 py-2 text-xs font-semibold text-emerald-800 bg-emerald-50 hover:bg-emerald-100 rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                >
                  Apply Suggested KES {prediction.suggestedDepositKes}
                </button>
              </div>
            </div>
          </div>
        </section>

        {/* Right 5 Columns: Safaricom M-Pesa Daraja C2B STK Push Top-Up */}
        <section
          aria-label="Safaricom M-Pesa Token Top Up"
          className="lg:col-span-5 bg-white border border-slate-200 rounded-2xl p-6 sm:p-8 flex flex-col justify-between"
        >
          <div className="space-y-5">
            <div className="pb-4 border-b border-slate-100">
              <div className="flex items-center gap-2 text-xs text-slate-500">
                <span>Safaricom Daraja C2B</span>
                <span aria-hidden="true">·</span>
                <span>Paybill 409200</span>
                <span aria-hidden="true">·</span>
                <span>Instant Token Mint</span>
              </div>
              <h2 className="text-xl font-bold text-slate-900 mt-1 flex items-center gap-2">
                <Smartphone className="w-5 h-5 text-emerald-700" />
                <span>Top Up Tokens via M-Pesa</span>
              </h2>
            </div>

            <form onSubmit={handleStkSubmit} className="space-y-4" noValidate>
              <div>
                <label
                  htmlFor="stk-phone-input"
                  className="block text-xs font-semibold text-slate-700 mb-1.5"
                >
                  Safaricom M-Pesa Phone Number
                </label>
                <input
                  id="stk-phone-input"
                  type="tel"
                  value={phoneInput}
                  onChange={(e) => setPhoneInput(e.target.value)}
                  placeholder="+254712345678"
                  className="w-full min-h-[44px] px-3.5 py-2 text-sm font-mono bg-slate-50 border border-slate-300 rounded-lg text-slate-900 focus:bg-white focus:border-emerald-600 focus:outline-none"
                />
              </div>

              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <label
                    htmlFor="stk-amount-input"
                    className="block text-xs font-semibold text-slate-700"
                  >
                    Deposit Amount (KES)
                  </label>
                  <span className="text-xs font-mono tabular-nums text-emerald-700 font-semibold">
                    = {previewPurchasedKwh.toFixed(2)} kWh Tokens
                  </span>
                </div>
                <input
                  id="stk-amount-input"
                  type="number"
                  min={20}
                  max={250000}
                  step={10}
                  value={depositKesInput}
                  onChange={(e) => setDepositKesInput(e.target.value)}
                  className="w-full min-h-[44px] px-3.5 py-2 text-base font-bold font-mono tabular-nums bg-slate-50 border border-slate-300 rounded-lg text-slate-900 focus:bg-white focus:border-emerald-600 focus:outline-none"
                />

                {/* Quick Amount Presets */}
                <div className="grid grid-cols-4 gap-2 mt-2.5">
                  {[250, 500, 1000, prediction.suggestedDepositKes].map((preset, idx) => (
                    <button
                      key={`${preset}-${idx}`}
                      type="button"
                      onClick={() => {
                        setDepositKesInput(String(preset));
                        setFormError(null);
                      }}
                      className="min-h-[38px] px-2 py-1.5 text-xs font-mono tabular-nums font-medium bg-slate-100 hover:bg-slate-200 text-slate-800 rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                    >
                      {idx === 3 ? `Smart ${preset}` : `KES ${preset}`}
                    </button>
                  ))}
                </div>
              </div>

              {formError && (
                <div
                  role="alert"
                  className="p-3 rounded-lg bg-red-50 border border-red-200 text-xs text-red-800 flex items-start gap-2"
                >
                  <AlertTriangle className="w-4 h-4 text-red-600 shrink-0 mt-0.5" />
                  <span>{formError}</span>
                </div>
              )}

              {stkReceiptBanner && (
                <div
                  role="status"
                  data-testid="stk-push-success"
                  className="p-3.5 rounded-lg bg-emerald-50 border border-emerald-200 text-xs text-emerald-950 space-y-1"
                >
                  <div className="font-semibold flex items-center gap-1.5 text-emerald-800">
                    <CheckCircle2 className="w-4 h-4 shrink-0" />
                    <span>Daraja STK Push Confirmed · Receipt {stkReceiptBanner.receipt}</span>
                  </div>
                  <p className="font-mono tabular-nums text-emerald-900">
                    Credited +{stkReceiptBanner.purchasedKwh.toFixed(2)} kWh for KES {stkReceiptBanner.amountKes.toLocaleString()} ({stkReceiptBanner.phone})
                  </p>
                </div>
              )}

              <button
                type="submit"
                disabled={isSubmitting}
                className="w-full min-h-[48px] px-4 py-3 text-sm font-semibold text-white bg-emerald-700 hover:bg-emerald-800 disabled:opacity-60 rounded-xl transition-colors flex items-center justify-center gap-2 whitespace-nowrap shrink-0 cursor-pointer"
              >
                <Zap className="w-4 h-4" />
                <span>
                  {isSubmitting
                    ? 'Sending Safaricom STK Push...'
                    : `Top Up KES ${Number(depositKesInput || 0).toLocaleString()} via M-Pesa`}
                </span>
              </button>
            </form>
          </div>

          <p className="text-[11px] text-slate-500 pt-4 border-t border-slate-100 mt-4">
            Triggers Cloud Function <span className="font-mono">/api/daraja/stkpush</span> and verifies the C2B callback signature before crediting your Firestore meter balance.
          </p>
        </section>
      </div>

      {/* Bottom Section: 30-Day Historical Token Usage Chart & Daily Inspection */}
      <section
        aria-label="Historical Energy Token Usage"
        className="bg-white border border-slate-200 rounded-2xl p-6 sm:p-8 space-y-6"
      >
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-slate-100">
          <div>
            <div className="flex items-center gap-2 text-xs text-slate-500">
              <span>Historical Telemetry</span>
              <span aria-hidden="true">·</span>
              <span>Total 30-Day Consumption: {household.totalConsumedKwh.toFixed(1)} kWh</span>
            </div>
            <h2 className="text-xl font-bold text-slate-900 mt-1">
              Historical Token Usage Over the Last Month
            </h2>
          </div>

          {/* Interactive Range Filter Tabs */}
          <div
            role="group"
            aria-label="Historical Usage Window"
            className="flex items-center gap-1 p-1 bg-slate-100 rounded-lg self-start"
          >
            {([7, 14, 30] as const).map((days) => (
              <button
                key={days}
                type="button"
                onClick={() => {
                  setChartWindow(days);
                  setSelectedBarIndex(null);
                }}
                className={`min-h-[36px] px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                  chartWindow === days
                    ? 'bg-white text-slate-900 shadow-xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                Last {days} Days
              </button>
            ))}
          </div>
        </div>

        {/* Selected Day Inspection Strip */}
        {activeDayMetric && (
          <div className="flex flex-wrap items-center justify-between gap-4 py-3 px-4 bg-slate-50 rounded-xl text-xs">
            <div className="flex flex-wrap items-center gap-2 text-slate-700">
              <span className="font-semibold text-slate-900">{activeDayMetric.dayLabel} ({activeDayMetric.dateStr})</span>
              <span aria-hidden="true">·</span>
              <span className="font-mono tabular-nums font-semibold text-emerald-800">
                Consumed: {activeDayMetric.consumedKwh.toFixed(2)} kWh
              </span>
              <span aria-hidden="true">·</span>
              <span className="font-mono tabular-nums text-slate-600">
                Cost: KES {activeDayMetric.costKes.toFixed(2)}
              </span>
              <span aria-hidden="true">·</span>
              <span className="font-mono tabular-nums text-slate-600">
                Peak Draw: {activeDayMetric.peakHourKw.toFixed(2)} kW
              </span>
            </div>
            <span className="text-slate-500">Select a day below to inspect daily meter telemetry</span>
          </div>
        )}

        {/* High-Precision Responsive SVG Bar Chart */}
        <div className="space-y-3">
          <svg
            viewBox={`0 0 ${svgWidth} ${svgHeight}`}
            className="w-full h-48 sm:h-56 select-none overflow-visible"
            role="img"
            aria-label={`Bar chart showing energy token usage over the last ${chartWindow} days`}
          >
            {/* Horizontal Reference Gridlines */}
            {[0.25, 0.5, 0.75, 1].map((ratio) => {
              const y = chartBottom - usableHeight * ratio;
              return (
                <g key={ratio}>
                  <line
                    x1={0}
                    y1={y}
                    x2={svgWidth}
                    y2={y}
                    stroke="#F1F5F9"
                    strokeWidth="1"
                  />
                </g>
              );
            })}

            {/* Baseline */}
            <line
              x1={0}
              y1={chartBottom}
              x2={svgWidth}
              y2={chartBottom}
              stroke="#CBD5E1"
              strokeWidth="1.5"
            />

            {/* Daily Bars */}
            {visibleMetrics.map((item, idx) => {
              const ratio = Math.max(0.08, item.consumedKwh / maxConsumed);
              const barH = usableHeight * ratio;
              const x = idx * slotWidth + (slotWidth - barWidth) / 2;
              const y = chartBottom - barH;
              const isSelected = idx === activeBarIdx;
              const showDateTick =
                chartWindow <= 14 || idx % 3 === 0 || idx === visibleMetrics.length - 1;

              return (
                <g
                  key={item.dateStr}
                  onClick={() => setSelectedBarIndex(idx)}
                  className="cursor-pointer group"
                >
                  <rect
                    x={x}
                    y={y}
                    width={barWidth}
                    height={barH}
                    rx={5}
                    fill={isSelected ? '#047857' : '#94A3B8'}
                    className="transition-colors group-hover:fill-emerald-600"
                  />
                  {(isSelected || chartWindow <= 14) && (
                    <text
                      x={x + barWidth / 2}
                      y={y - 6}
                      textAnchor="middle"
                      fontSize="10"
                      fontFamily="JetBrains Mono, monospace"
                      fontWeight={isSelected ? '700' : '500'}
                      fill={isSelected ? '#047857' : '#64748B'}
                    >
                      {item.consumedKwh.toFixed(1)}
                    </text>
                  )}
                  {showDateTick && (
                    <text
                      x={x + barWidth / 2}
                      y={chartBottom + 18}
                      textAnchor="middle"
                      fontSize="10"
                      fontFamily="JetBrains Mono, monospace"
                      fill={isSelected ? '#0F172A' : '#64748B'}
                      fontWeight={isSelected ? '700' : '400'}
                    >
                      {item.dayLabel}
                    </text>
                  )}
                </g>
              );
            })}
          </svg>

          {/* Accessible Day Selector Strip for Screen Readers & Touch Ergonomics */}
          <div
            role="list"
            aria-label="Daily Token Consumption Records"
            className="flex items-center gap-1.5 overflow-x-auto pb-1 pt-1"
          >
            {visibleMetrics.slice(-7).map((item, idx) => {
              const actualIdx = visibleMetrics.length - 7 + idx;
              const isSelected = actualIdx === activeBarIdx;
              return (
                <button
                  key={item.dateStr}
                  type="button"
                  role="listitem"
                  onClick={() => setSelectedBarIndex(actualIdx)}
                  className={`min-h-[36px] px-2.5 py-1 text-xs font-mono tabular-nums rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                    isSelected
                      ? 'bg-emerald-700 text-white font-semibold'
                      : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
                  }`}
                >
                  {item.dayLabel}: {item.consumedKwh.toFixed(1)} kWh
                </button>
              );
            })}
          </div>
        </div>
      </section>
    </div>
  );
};

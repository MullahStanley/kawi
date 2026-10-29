import React, { useState } from 'react';
import {
  DailyMetricRecord,
  HouseholdNodeState,
  PEER_GRID_NODES,
  normalizeMpesaPhone,
} from '../utils/energyLogic';
import { ArrowUpRight, CheckCircle2, AlertTriangle, Sun, Wallet } from 'lucide-react';

interface ProsumerDashboardProps {
  household: HouseholdNodeState;
  dailyMetrics: DailyMetricRecord[];
  mpesaPhone: string;
  onWithdrawB2C: (
    withdrawalKes: number,
    phone: string
  ) => Promise<{ receipt: string; netPayoutKes: number; b2cFeeKes: number }>;
  onNavigateToBridge: () => void;
}

export const ProsumerDashboard: React.FC<ProsumerDashboardProps> = ({
  household,
  dailyMetrics,
  mpesaPhone,
  onWithdrawB2C,
  onNavigateToBridge,
}) => {
  const [phoneInput, setPhoneInput] = useState(mpesaPhone);
  const [withdrawalKesInput, setWithdrawalKesInput] = useState<string>('2000');
  const [exportRange, setExportRange] = useState<7 | 14 | 30>(14);
  const [selectedDayIndex, setSelectedDayIndex] = useState<number | null>(null);
  const [isWithdrawing, setIsWithdrawing] = useState(false);
  const [withdrawError, setWithdrawError] = useState<string | null>(null);
  const [b2cReceiptBanner, setB2cReceiptBanner] = useState<{
    receipt: string;
    withdrawalKes: number;
    netPayoutKes: number;
    b2cFeeKes: number;
    phone: string;
  } | null>(null);

  const visibleExports = dailyMetrics.slice(-exportRange);
  const maxExported = Math.max(...visibleExports.map((d) => d.exportedKwh), 18);
  const activeDayIdx =
    selectedDayIndex !== null && visibleExports[selectedDayIndex]
      ? selectedDayIndex
      : visibleExports.length - 1;
  const activeExportDay = visibleExports[activeDayIdx];

  const numericWithdrawal = Number(withdrawalKesInput);
  const previewFeeKes =
    !Number.isNaN(numericWithdrawal) && numericWithdrawal >= 50
      ? numericWithdrawal <= 1000
        ? 15
        : numericWithdrawal <= 5000
          ? 25
          : 45
      : 0;
  const previewNetKes = Math.max(0, numericWithdrawal - previewFeeKes);

  const grossLifetimeRevenueKes = Number(
    (household.totalExportedKwh * household.tariffKesPerKwh * 0.975).toFixed(2)
  );

  const handleQuickPercentage = (ratio: number) => {
    const calculated = Math.floor((household.withdrawableBalanceKes * ratio) / 10) * 10;
    setWithdrawalKesInput(String(Math.max(50, calculated)));
    setWithdrawError(null);
  };

  const handleWithdrawSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setWithdrawError(null);

    const normalizedPhone = normalizeMpesaPhone(phoneInput);
    if (!normalizedPhone) {
      setWithdrawError('Enter a valid Safaricom M-Pesa number (e.g. +254712345678 or 0712345678).');
      return;
    }

    const amount = Number(withdrawalKesInput);
    if (Number.isNaN(amount) || amount < 50) {
      setWithdrawError('Minimum M-Pesa B2C withdrawal is KES 50.');
      return;
    }

    if (amount > household.withdrawableBalanceKes) {
      setWithdrawError(
        `Requested amount (KES ${amount.toLocaleString()}) exceeds withdrawable balance (KES ${household.withdrawableBalanceKes.toLocaleString()}).`
      );
      return;
    }

    setIsWithdrawing(true);
    try {
      const res = await onWithdrawB2C(amount, normalizedPhone);
      setB2cReceiptBanner({
        receipt: res.receipt,
        withdrawalKes: amount,
        netPayoutKes: res.netPayoutKes,
        b2cFeeKes: res.b2cFeeKes,
        phone: normalizedPhone,
      });
    } catch (err) {
      setWithdrawError(err instanceof Error ? err.message : 'B2C withdrawal failed.');
    } finally {
      setIsWithdrawing(false);
    }
  };

  // SVG Chart coordinate geometry
  const svgWidth = 840;
  const svgHeight = 190;
  const chartTop = 18;
  const chartBottom = 156;
  const usableHeight = chartBottom - chartTop;
  const slotWidth = svgWidth / visibleExports.length;
  const barWidth = Math.min(34, Math.max(12, slotWidth * 0.62));

  return (
    <div className="space-y-8">
      {/* Top 2-Column Split: Prosumer Earnings Overview + Daraja B2C Withdrawal System */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-stretch">
        {/* Left 7 Columns: Earnings Dashboard & Export Summary */}
        <section
          aria-label="Prosumer Earnings and Surplus Energy Metrics"
          className="lg:col-span-7 bg-white border border-slate-200 rounded-2xl p-6 sm:p-8 flex flex-col justify-between space-y-8"
        >
          <div className="space-y-3 pb-6 border-b border-slate-100">
            <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500">
              <span>Prosumer Solar Node {household.meterNumber}</span>
              <span aria-hidden="true">·</span>
              <span>6.4 kWp Rooftop Inverter</span>
              <span aria-hidden="true">·</span>
              <span>97.5% Net Payout Share</span>
            </div>
            <h1 className="text-2xl sm:text-3xl font-bold text-slate-900 tracking-tight">
              Prosumer Revenue & Escrow Wallet
            </h1>
            <div className="flex items-baseline gap-3 pt-1">
              <span className="text-xl font-semibold text-slate-500">KES</span>
              <span
                data-testid="prosumer-withdrawable-kes"
                className="text-4xl sm:text-5xl font-bold font-mono tabular-nums text-slate-900 tracking-tight"
              >
                {household.withdrawableBalanceKes.toLocaleString('en-KE', {
                  minimumFractionDigits: 2,
                  maximumFractionDigits: 2,
                })}
              </span>
              <span className="text-sm font-medium text-emerald-700">Withdrawable Balance</span>
            </div>
            <p className="text-xs text-slate-500 font-mono tabular-nums">
              Cumulative Exported: {household.totalExportedKwh.toFixed(2)} kWh · Lifetime P2P Earnings: KES {grossLifetimeRevenueKes.toLocaleString('en-KE', { minimumFractionDigits: 2 })}
            </p>
          </div>

          {/* 4-Column Telemetry Strip inside Prosumer Card */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 py-2">
            <div>
              <div className="text-xs text-slate-500">Total Grid Export</div>
              <div
                data-testid="prosumer-exported-kwh"
                className="text-lg font-bold font-mono tabular-nums text-slate-900 mt-0.5 whitespace-nowrap"
              >
                {household.totalExportedKwh.toFixed(2)} kWh
              </div>
            </div>
            <div>
              <div className="text-xs text-slate-500">Feed-In Tariff</div>
              <div className="text-lg font-bold font-mono tabular-nums text-slate-900 mt-0.5 whitespace-nowrap">
                KES {household.tariffKesPerKwh.toFixed(2)}/kWh
              </div>
            </div>
            <div>
              <div className="text-xs text-slate-500">Solar Array Output</div>
              <div className="text-lg font-bold font-mono tabular-nums text-emerald-700 mt-0.5 whitespace-nowrap">
                4.62 kW Peak
              </div>
            </div>
            <div>
              <div className="text-xs text-slate-500">Connected Peers</div>
              <div className="text-lg font-bold font-mono tabular-nums text-slate-900 mt-0.5 whitespace-nowrap">
                4 Houses
              </div>
            </div>
          </div>

          <div className="pt-4 border-t border-slate-100 flex flex-wrap items-center justify-between gap-3">
            <div className="text-xs text-slate-600">
              Surplus solar energy is automatically metered and credited to your escrow ledger in real time.
            </div>
            <button
              type="button"
              onClick={onNavigateToBridge}
              className="min-h-[40px] px-4 py-2 text-xs font-semibold text-emerald-800 bg-emerald-50 hover:bg-emerald-100 rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              Simulate Surplus Export Pulse
            </button>
          </div>
        </section>

        {/* Right 5 Columns: Withdraw to M-Pesa (Daraja B2C API) */}
        <section
          aria-label="Withdraw to Safaricom M-Pesa B2C"
          className="lg:col-span-5 bg-white border border-slate-200 rounded-2xl p-6 sm:p-8 flex flex-col justify-between"
        >
          <div className="space-y-5">
            <div className="pb-4 border-b border-slate-100">
              <div className="flex items-center gap-2 text-xs text-slate-500">
                <span>Safaricom Daraja B2C API</span>
                <span aria-hidden="true">·</span>
                <span>Instant Wallet Disbursal</span>
              </div>
              <h2 className="text-xl font-bold text-slate-900 mt-1 flex items-center gap-2">
                <Wallet className="w-5 h-5 text-emerald-700" />
                <span>Withdraw to M-Pesa</span>
              </h2>
            </div>

            <form onSubmit={handleWithdrawSubmit} className="space-y-4" noValidate>
              <div>
                <label
                  htmlFor="b2c-phone-input"
                  className="block text-xs font-semibold text-slate-700 mb-1.5"
                >
                  Registered M-Pesa Number
                </label>
                <input
                  id="b2c-phone-input"
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
                    htmlFor="b2c-amount-input"
                    className="block text-xs font-semibold text-slate-700"
                  >
                    Withdrawal Amount (KES)
                  </label>
                  <span className="text-xs font-mono tabular-nums text-slate-600">
                    B2C Fee: KES {previewFeeKes} · Net: KES {previewNetKes.toLocaleString()}
                  </span>
                </div>
                <input
                  id="b2c-amount-input"
                  type="number"
                  min={50}
                  max={household.withdrawableBalanceKes}
                  step={50}
                  value={withdrawalKesInput}
                  onChange={(e) => setWithdrawalKesInput(e.target.value)}
                  className="w-full min-h-[44px] px-3.5 py-2 text-base font-bold font-mono tabular-nums bg-slate-50 border border-slate-300 rounded-lg text-slate-900 focus:bg-white focus:border-emerald-600 focus:outline-none"
                />

                {/* Quick Share Presets */}
                <div className="grid grid-cols-4 gap-2 mt-2.5">
                  {[
                    { label: '25%', ratio: 0.25 },
                    { label: '50%', ratio: 0.5 },
                    { label: '75%', ratio: 0.75 },
                    { label: 'Max', ratio: 1.0 },
                  ].map((item) => (
                    <button
                      key={item.label}
                      type="button"
                      onClick={() => handleQuickPercentage(item.ratio)}
                      className="min-h-[38px] px-2 py-1.5 text-xs font-mono font-medium bg-slate-100 hover:bg-slate-200 text-slate-800 rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                    >
                      {item.label}
                    </button>
                  ))}
                </div>
              </div>

              {withdrawError && (
                <div
                  role="alert"
                  className="p-3 rounded-lg bg-red-50 border border-red-200 text-xs text-red-800 flex items-start gap-2"
                >
                  <AlertTriangle className="w-4 h-4 text-red-600 shrink-0 mt-0.5" />
                  <span>{withdrawError}</span>
                </div>
              )}

              {b2cReceiptBanner && (
                <div
                  role="status"
                  data-testid="b2c-withdraw-success"
                  className="p-3.5 rounded-lg bg-emerald-50 border border-emerald-200 text-xs text-emerald-950 space-y-1"
                >
                  <div className="font-semibold flex items-center gap-1.5 text-emerald-800">
                    <CheckCircle2 className="w-4 h-4 shrink-0" />
                    <span>B2C Disbursal Confirmed · Receipt {b2cReceiptBanner.receipt}</span>
                  </div>
                  <p className="font-mono tabular-nums text-emerald-900">
                    Sent KES {b2cReceiptBanner.netPayoutKes.toLocaleString()} to {b2cReceiptBanner.phone} (Fee KES {b2cReceiptBanner.b2cFeeKes})
                  </p>
                </div>
              )}

              <button
                type="submit"
                disabled={isWithdrawing}
                className="w-full min-h-[48px] px-4 py-3 text-sm font-semibold text-white bg-slate-900 hover:bg-slate-800 disabled:opacity-60 rounded-xl transition-colors flex items-center justify-center gap-2 whitespace-nowrap shrink-0 cursor-pointer"
              >
                <ArrowUpRight className="w-4 h-4" />
                <span>
                  {isWithdrawing
                    ? 'Processing Daraja B2C Transfer...'
                    : `Withdraw KES ${Number(withdrawalKesInput || 0).toLocaleString()} to M-Pesa`}
                </span>
              </button>
            </form>
          </div>

          <p className="text-[11px] text-slate-500 pt-4 border-t border-slate-100 mt-4">
            Disburses earned P2P solar revenue via <span className="font-mono">/api/daraja/b2c</span> directly to your Safaricom M-Pesa wallet.
          </p>
        </section>
      </div>

      {/* Middle Section: Visualized Export Metrics Chart */}
      <section
        aria-label="Solar Energy Export Metrics"
        className="bg-white border border-slate-200 rounded-2xl p-6 sm:p-8 space-y-6"
      >
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-slate-100">
          <div>
            <div className="flex items-center gap-2 text-xs text-slate-500">
              <span>Prosumer Export Telemetry</span>
              <span aria-hidden="true">·</span>
              <span>Microgrid Feeder #04</span>
            </div>
            <h2 className="text-xl font-bold text-slate-900 mt-1 flex items-center gap-2">
              <Sun className="w-5 h-5 text-amber-600" />
              <span>Energy Pushed to the Consumer Network</span>
            </h2>
          </div>

          <div
            role="group"
            aria-label="Export Metrics Window"
            className="flex items-center gap-1 p-1 bg-slate-100 rounded-lg self-start"
          >
            {([7, 14, 30] as const).map((days) => (
              <button
                key={days}
                type="button"
                onClick={() => {
                  setExportRange(days);
                  setSelectedDayIndex(null);
                }}
                className={`min-h-[36px] px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                  exportRange === days
                    ? 'bg-white text-slate-900 shadow-xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                {days} Days
              </button>
            ))}
          </div>
        </div>

        {activeExportDay && (
          <div className="flex flex-wrap items-center justify-between gap-4 py-3 px-4 bg-slate-50 rounded-xl text-xs">
            <div className="flex flex-wrap items-center gap-2 text-slate-700">
              <span className="font-semibold text-slate-900">{activeExportDay.dayLabel} ({activeExportDay.dateStr})</span>
              <span aria-hidden="true">·</span>
              <span className="font-mono tabular-nums font-semibold text-emerald-800">
                Exported: {activeExportDay.exportedKwh.toFixed(2)} kWh
              </span>
              <span aria-hidden="true">·</span>
              <span className="font-mono tabular-nums text-slate-700">
                Net Revenue: KES {activeExportDay.revenueKes.toFixed(2)}
              </span>
              <span aria-hidden="true">·</span>
              <span className="font-mono tabular-nums text-slate-600">
                Consumed Locally: {activeExportDay.consumedKwh.toFixed(2)} kWh
              </span>
            </div>
            <span className="text-slate-500">Select a daily column to inspect solar export revenue</span>
          </div>
        )}

        {/* High-Precision Responsive SVG Export Bar Chart */}
        <div className="space-y-3">
          <svg
            viewBox={`0 0 ${svgWidth} ${svgHeight}`}
            className="w-full h-48 sm:h-56 select-none overflow-visible"
            role="img"
            aria-label={`Bar chart showing solar energy exported over the last ${exportRange} days`}
          >
            {[0.25, 0.5, 0.75, 1].map((ratio) => {
              const y = chartBottom - usableHeight * ratio;
              return (
                <line
                  key={ratio}
                  x1={0}
                  y1={y}
                  x2={svgWidth}
                  y2={y}
                  stroke="#F1F5F9"
                  strokeWidth="1"
                />
              );
            })}

            <line
              x1={0}
              y1={chartBottom}
              x2={svgWidth}
              y2={chartBottom}
              stroke="#CBD5E1"
              strokeWidth="1.5"
            />

            {visibleExports.map((item, idx) => {
              const ratio = Math.max(0.08, item.exportedKwh / maxExported);
              const barH = usableHeight * ratio;
              const x = idx * slotWidth + (slotWidth - barWidth) / 2;
              const y = chartBottom - barH;
              const isSelected = idx === activeDayIdx;
              const showDateTick =
                exportRange <= 14 || idx % 3 === 0 || idx === visibleExports.length - 1;

              return (
                <g
                  key={item.dateStr}
                  onClick={() => setSelectedDayIndex(idx)}
                  className="cursor-pointer group"
                >
                  <rect
                    x={x}
                    y={y}
                    width={barWidth}
                    height={barH}
                    rx={5}
                    fill={isSelected ? '#D97706' : '#94A3B8'}
                    className="transition-colors group-hover:fill-amber-500"
                  />
                  {(isSelected || exportRange <= 14) && (
                    <text
                      x={x + barWidth / 2}
                      y={y - 6}
                      textAnchor="middle"
                      fontSize="10"
                      fontFamily="JetBrains Mono, monospace"
                      fontWeight={isSelected ? '700' : '500'}
                      fill={isSelected ? '#B45309' : '#64748B'}
                    >
                      {item.exportedKwh.toFixed(1)}
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
        </div>
      </section>

      {/* Bottom Section: Active Neighborhood Consumer & Prosumer Peer Nodes */}
      <section
        aria-label="Connected Peer Households"
        className="bg-white border border-slate-200 rounded-2xl p-6 sm:p-8 space-y-4"
      >
        <div className="pb-3 border-b border-slate-100">
          <div className="flex items-center gap-2 text-xs text-slate-500">
            <span>Local Mesh Topology</span>
            <span aria-hidden="true">·</span>
            <span>Kilimani Feeder #04</span>
          </div>
          <h2 className="text-lg font-bold text-slate-900 mt-1">
            Connected P2P Neighborhood Households
          </h2>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse text-sm">
            <thead>
              <tr className="border-b border-slate-200 text-xs font-semibold text-slate-500">
                <th className="py-3 pr-4">Meter ID</th>
                <th className="py-3 px-4">Household Node</th>
                <th className="py-3 px-4">Grid Role</th>
                <th className="py-3 px-4 text-right">Distance</th>
                <th className="py-3 px-4 text-right">Live Flow</th>
                <th className="py-3 pl-4 text-right">Shared Today</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 text-xs">
              {PEER_GRID_NODES.map((peer) => (
                <tr key={peer.meterNumber} className="hover:bg-slate-50/80 transition-colors">
                  <td className="py-3.5 pr-4 font-mono font-semibold text-slate-900 whitespace-nowrap">
                    {peer.meterNumber}
                  </td>
                  <td className="py-3.5 px-4 text-slate-700 font-medium">{peer.houseName}</td>
                  <td className="py-3.5 px-4 text-slate-600">{peer.role}</td>
                  <td className="py-3.5 px-4 text-right font-mono tabular-nums text-slate-600">
                    {peer.distanceMeters} m
                  </td>
                  <td
                    className={`py-3.5 px-4 text-right font-mono tabular-nums font-semibold ${
                      peer.currentOutputKw >= 0 ? 'text-emerald-700' : 'text-amber-700'
                    }`}
                  >
                    {peer.currentOutputKw >= 0
                      ? `+${peer.currentOutputKw.toFixed(1)} kW`
                      : `${peer.currentOutputKw.toFixed(1)} kW`}
                  </td>
                  <td className="py-3.5 pl-4 text-right font-mono tabular-nums font-semibold text-slate-900">
                    {peer.sharedTodayKwh.toFixed(2)} kWh
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
};

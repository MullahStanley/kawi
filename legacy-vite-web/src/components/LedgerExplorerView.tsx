import React, { useState } from 'react';
import { EnergyTransactionRecord, TransactionType } from '../utils/energyLogic';
import { Download, Search } from 'lucide-react';

interface LedgerExplorerViewProps {
  transactions: EnergyTransactionRecord[];
}

type FilterOption = 'ALL' | TransactionType;

const FILTER_TABS: { id: FilterOption; label: string }[] = [
  { id: 'ALL', label: 'All Entries' },
  { id: 'C2B_STK_DEPOSIT', label: 'C2B Deposits' },
  { id: 'P2P_METER_DEDUCTION', label: 'Consumer Deductions' },
  { id: 'P2P_PROSUMER_CREDIT', label: 'Prosumer Credits' },
  { id: 'B2C_MPESA_WITHDRAWAL', label: 'B2C Withdrawals' },
];

function formatTxTypeLabel(txType: TransactionType): string {
  switch (txType) {
    case 'C2B_STK_DEPOSIT':
      return 'M-Pesa STK Deposit';
    case 'P2P_METER_DEDUCTION':
      return 'IoT Meter Consumption';
    case 'P2P_PROSUMER_CREDIT':
      return 'Prosumer Solar Credit';
    case 'B2C_MPESA_WITHDRAWAL':
      return 'M-Pesa B2C Payout';
  }
}

export const LedgerExplorerView: React.FC<LedgerExplorerViewProps> = ({ transactions }) => {
  const [activeFilter, setActiveFilter] = useState<FilterOption>('ALL');
  const [searchQuery, setSearchQuery] = useState('');

  const filteredTransactions = transactions.filter((tx) => {
    const matchesCategory = activeFilter === 'ALL' || tx.txType === activeFilter;
    const q = searchQuery.trim().toLowerCase();
    const matchesSearch =
      !q ||
      tx.mpesaReceipt.toLowerCase().includes(q) ||
      tx.counterpartyMeter.toLowerCase().includes(q) ||
      tx.txType.toLowerCase().includes(q);
    return matchesCategory && matchesSearch;
  });

  const handleExportCsv = () => {
    const headers = ['Timestamp,Receipt,Type,Counterparty,Energy_kWh,Amount_KES,Status'];
    const rows = filteredTransactions.map(
      (tx) =>
        `${tx.createdAtIso},${tx.mpesaReceipt},${tx.txType},${tx.counterpartyMeter},${tx.amountKwh.toFixed(2)},${tx.amountKes.toFixed(2)},${tx.status}`
    );
    const csvContent = 'data:text/csv;charset=utf-8,' + [headers, ...rows].join('\n');
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement('a');
    link.setAttribute('href', encodedUri);
    link.setAttribute('download', `kawigrid-ledger-${new Date().toISOString().slice(0, 10)}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  return (
    <section
      aria-label="Financial and Token Settlement Ledger"
      className="bg-white border border-slate-200 rounded-2xl p-6 sm:p-8 space-y-6"
    >
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-slate-100">
        <div>
          <div className="flex items-center gap-2 text-xs text-slate-500">
            <span>Immutable Daraja & Smart Meter Audit Trail</span>
            <span aria-hidden="true">·</span>
            <span>{filteredTransactions.length} Verified Entries</span>
          </div>
          <h1 className="text-2xl font-bold text-slate-900 mt-1">
            P2P Energy & M-Pesa Financial Ledger
          </h1>
        </div>

        <button
          type="button"
          onClick={handleExportCsv}
          className="min-h-[40px] px-4 py-2 text-xs font-semibold text-slate-800 bg-slate-100 hover:bg-slate-200 rounded-lg transition-colors flex items-center gap-2 self-start whitespace-nowrap shrink-0 cursor-pointer"
        >
          <Download className="w-4 h-4" />
          <span>Download CSV</span>
        </button>
      </div>

      {/* Filter Bar & Search Input */}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
        <div
          role="group"
          aria-label="Filter Ledger by Transaction Type"
          className="flex flex-wrap items-center gap-1 p-1 bg-slate-100 rounded-lg"
        >
          {FILTER_TABS.map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => setActiveFilter(tab.id)}
              className={`min-h-[36px] px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                activeFilter === tab.id
                  ? 'bg-white text-slate-900 shadow-xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        <div className="relative w-full lg:w-72">
          <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
          <input
            type="search"
            aria-label="Search ledger by Daraja receipt or meter ID"
            placeholder="Search receipt or meter ID..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full min-h-[40px] pl-9 pr-3 py-1.5 text-xs font-mono bg-slate-50 border border-slate-300 rounded-lg text-slate-900 focus:bg-white focus:border-emerald-600 focus:outline-none"
          />
        </div>
      </div>

      {/* High-Density Tabular Ledger Grid */}
      {filteredTransactions.length === 0 ? (
        <div className="py-12 text-center space-y-3 border border-dashed border-slate-200 rounded-xl">
          <p className="text-sm font-medium text-slate-700">
            No ledger entries match the current filter.
          </p>
          <button
            type="button"
            onClick={() => {
              setActiveFilter('ALL');
              setSearchQuery('');
            }}
            className="min-h-[40px] px-4 py-2 text-xs font-semibold text-emerald-800 bg-emerald-50 hover:bg-emerald-100 rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer"
          >
            Reset Filters
          </button>
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse text-sm">
            <thead>
              <tr className="border-b border-slate-200 text-xs font-semibold text-slate-500">
                <th className="py-3 pr-4">Daraja / IoT Receipt</th>
                <th className="py-3 px-4">Transaction Type</th>
                <th className="py-3 px-4">Counterparty / Endpoint</th>
                <th className="py-3 px-4 text-right">Energy Delta</th>
                <th className="py-3 px-4 text-right">Financial Settlement</th>
                <th className="py-3 pl-4 text-right">Status & Timestamp</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 text-xs">
              {filteredTransactions.map((tx) => {
                const isPositiveKwh =
                  tx.txType === 'C2B_STK_DEPOSIT' || tx.txType === 'P2P_PROSUMER_CREDIT';
                const isPositiveKes = tx.txType === 'P2P_PROSUMER_CREDIT';

                return (
                  <tr key={tx.id} className="hover:bg-slate-50/80 transition-colors">
                    <td className="py-3.5 pr-4 font-mono font-semibold text-slate-900 whitespace-nowrap">
                      {tx.mpesaReceipt}
                    </td>
                    <td className="py-3.5 px-4 text-slate-800 font-medium whitespace-nowrap">
                      {formatTxTypeLabel(tx.txType)}
                    </td>
                    <td className="py-3.5 px-4 font-mono text-slate-600 whitespace-nowrap">
                      {tx.counterpartyMeter}
                    </td>
                    <td
                      className={`py-3.5 px-4 text-right font-mono tabular-nums font-semibold whitespace-nowrap ${
                        tx.amountKwh === 0
                          ? 'text-slate-400'
                          : isPositiveKwh
                            ? 'text-emerald-700'
                            : 'text-amber-700'
                      }`}
                    >
                      {tx.amountKwh === 0
                        ? '—'
                        : `${tx.txType === 'P2P_METER_DEDUCTION' ? '-' : '+'}${tx.amountKwh.toFixed(2)} kWh`}
                    </td>
                    <td
                      className={`py-3.5 px-4 text-right font-mono tabular-nums font-semibold whitespace-nowrap ${
                        isPositiveKes ? 'text-emerald-700' : 'text-slate-900'
                      }`}
                    >
                      {isPositiveKes ? '+' : ''}KES {tx.amountKes.toLocaleString('en-KE', {
                        minimumFractionDigits: 2,
                        maximumFractionDigits: 2,
                      })}
                    </td>
                    <td className="py-3.5 pl-4 text-right font-mono tabular-nums text-slate-500 whitespace-nowrap">
                      {tx.status} · {tx.createdAtIso.slice(0, 16).replace('T', ' ')}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
};

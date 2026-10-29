import React, { useState } from 'react';
import { Check, Copy, Smartphone, Terminal } from 'lucide-react';

const UBUNTU_BUN_COMMANDS = `# 1. Navigate into the standalone React Native Expo project directory
cd expo-mobile

# 2. Install React Native + Expo SDK 52 + Firebase dependencies with Bun
bun install

# 3. Copy your provisioned Firebase config into expo-mobile/
cp ../firebase-applet-config.json ./firebase-applet-config.json

# 4. Start the Expo Metro bundler (scan QR code with Expo Go on Android/iOS or press 'a' for Android Emulator)
bun run start

# Optional: Launch directly on an Android device/emulator connected via ADB on Ubuntu
bun run android`;

const EXPO_RN_SNIPPET = `// /expo-mobile/App.tsx — React Native (Expo SDK 52 + Cloud Firestore + AsyncStorage)
import React, { useEffect, useMemo, useState } from 'react';
import { SafeAreaView, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { doc, onSnapshot, serverTimestamp, updateDoc } from 'firebase/firestore';
import { db, auth, setOfflineNetworkMode } from './src/firebase';
import { calculateSmartDepositPrediction, normalizeMpesaPhone } from './src/energyLogic';`;

export const ExpoMobileView: React.FC = () => {
  const [copiedBlock, setCopiedBlock] = useState<'cli' | 'rn' | null>(null);

  const handleCopy = async (text: string, id: 'cli' | 'rn') => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedBlock(id);
      setTimeout(() => setCopiedBlock(null), 2000);
    } catch {
      // Clipboard fallback
    }
  };

  return (
    <div className="space-y-8">
      <section
        aria-label="React Native Expo Project Bundle and Ubuntu CLI Instructions"
        className="bg-white border border-slate-200 rounded-2xl p-6 sm:p-8 space-y-6"
      >
        <div className="pb-4 border-b border-slate-100 space-y-2">
          <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500">
            <span>Directory: /expo-mobile</span>
            <span aria-hidden="true">·</span>
            <span>Expo SDK 52 (React Native 0.76)</span>
            <span aria-hidden="true">·</span>
            <span>Ubuntu + Bun Ready</span>
          </div>
          <h1 className="text-2xl font-bold text-slate-900 flex items-center gap-2">
            <Smartphone className="w-6 h-6 text-emerald-700" />
            <span>React Native (Expo) Mobile App & Cloud Functions</span>
          </h1>
          <p className="text-xs text-slate-600">
            A complete standalone React Native Expo project has been generated in the <span className="font-mono font-semibold text-slate-900">/expo-mobile</span> folder of this repository, sharing the same Firestore database (<span className="font-mono">ai-studio-eed94837-f10b-4a43-a94b-5dc8a934cde3</span>), security rules, and Smart Deposit Prediction engine.
          </p>
        </div>

        {/* File Inventory Table */}
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse text-sm">
            <thead>
              <tr className="border-b border-slate-200 text-xs font-semibold text-slate-500">
                <th className="py-3 pr-4">File Path</th>
                <th className="py-3 px-4">Module Role</th>
                <th className="py-3 pl-4 text-right">Runtime</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 text-xs">
              <tr>
                <td className="py-3 pr-4 font-mono font-semibold text-slate-900">/expo-mobile/package.json</td>
                <td className="py-3 px-4 text-slate-700">Expo SDK 52, React Native 0.76, Firebase JS SDK, and AsyncStorage dependencies</td>
                <td className="py-3 pl-4 text-right font-mono text-slate-500">Bun / Metro</td>
              </tr>
              <tr>
                <td className="py-3 pr-4 font-mono font-semibold text-slate-900">/expo-mobile/app.json</td>
                <td className="py-3 px-4 text-slate-700">Android package (ke.co.kawigrid.app) & iOS bundle identifier config</td>
                <td className="py-3 pl-4 text-right font-mono text-slate-500">Expo CLI</td>
              </tr>
              <tr>
                <td className="py-3 pr-4 font-mono font-semibold text-slate-900">/expo-mobile/App.tsx</td>
                <td className="py-3 px-4 text-slate-700">Native SafeAreaView, Consumer & Prosumer screens, STK Push & B2C forms</td>
                <td className="py-3 pl-4 text-right font-mono text-slate-500">React Native</td>
              </tr>
              <tr>
                <td className="py-3 pr-4 font-mono font-semibold text-slate-900">/expo-mobile/src/firebase.ts</td>
                <td className="py-3 px-4 text-slate-700">Firestore real-time listeners & offline network toggle</td>
                <td className="py-3 pl-4 text-right font-mono text-slate-500">Firebase SDK</td>
              </tr>
              <tr>
                <td className="py-3 pr-4 font-mono font-semibold text-slate-900">/expo-mobile/src/energyLogic.ts</td>
                <td className="py-3 px-4 text-slate-700">Smart Deposit Prediction algorithm & M-Pesa E.164 phone validator</td>
                <td className="py-3 pl-4 text-right font-mono text-slate-500">TypeScript</td>
              </tr>
              <tr>
                <td className="py-3 pr-4 font-mono font-semibold text-slate-900">/expo-mobile/functions/index.ts</td>
                <td className="py-3 px-4 text-slate-700">Firebase Cloud Functions for IoT meter bridge & Daraja webhooks</td>
                <td className="py-3 pl-4 text-right font-mono text-slate-500">Node.js</td>
              </tr>
            </tbody>
          </table>
        </div>

        {/* Ubuntu + Bun CLI Commands */}
        <div className="space-y-3 pt-2">
          <div className="flex items-center justify-between">
            <h2 className="text-base font-bold text-slate-900 flex items-center gap-2">
              <Terminal className="w-4 h-4 text-emerald-700" />
              <span>Run on Ubuntu with Bun</span>
            </h2>
            <button
              type="button"
              onClick={() => handleCopy(UBUNTU_BUN_COMMANDS, 'cli')}
              className="min-h-[36px] px-3 py-1.5 text-xs font-semibold text-slate-800 bg-slate-100 hover:bg-slate-200 rounded-lg flex items-center gap-1.5 whitespace-nowrap shrink-0 cursor-pointer"
            >
              {copiedBlock === 'cli' ? <Check className="w-3.5 h-3.5 text-emerald-700" /> : <Copy className="w-3.5 h-3.5" />}
              <span>{copiedBlock === 'cli' ? 'Copied Commands' : 'Copy Ubuntu Commands'}</span>
            </button>
          </div>
          <pre className="p-4 bg-slate-900 text-slate-100 rounded-xl text-xs font-mono overflow-x-auto leading-relaxed">
            {UBUNTU_BUN_COMMANDS}
          </pre>
        </div>

        {/* Entry Point Preview */}
        <div className="space-y-3 pt-2">
          <div className="flex items-center justify-between">
            <h2 className="text-base font-bold text-slate-900">
              React Native Entry Point (/expo-mobile/App.tsx)
            </h2>
            <button
              type="button"
              onClick={() => handleCopy(EXPO_RN_SNIPPET, 'rn')}
              className="min-h-[36px] px-3 py-1.5 text-xs font-semibold text-slate-800 bg-slate-100 hover:bg-slate-200 rounded-lg flex items-center gap-1.5 whitespace-nowrap shrink-0 cursor-pointer"
            >
              {copiedBlock === 'rn' ? <Check className="w-3.5 h-3.5 text-emerald-700" /> : <Copy className="w-3.5 h-3.5" />}
              <span>{copiedBlock === 'rn' ? 'Copied Imports' : 'Copy Header'}</span>
            </button>
          </div>
          <pre className="p-4 bg-slate-900 text-slate-100 rounded-xl text-xs font-mono overflow-x-auto leading-relaxed">
            {EXPO_RN_SNIPPET}
          </pre>
        </div>
      </section>
    </div>
  );
};

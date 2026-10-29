# KawiGrid P2P Energy Trading — React Native (Expo)

Decentralized Peer-to-Peer (P2P) solar energy trading microgrid application built with React Native and Expo SDK 52.

Supports **Android**, **iOS**, and **Web** via Expo Metro bundler, backed by Google Cloud Firestore with real-time listeners and offline resilience (`AsyncStorage`), plus Safaricom Daraja M-Pesa STK Push and B2C payout workflows.

---

## ⚡ Features

- **Consumer Smart Meter Dashboard**:
  - Real-time token balance (`kWh`) and autonomy estimation
  - **Smart Deposit Prediction**: AI-assisted monthly requirement calculation with configurable safety buffer days (`0d`, `3d`, `5d`, `7d`)
  - **Safaricom M-Pesa STK Push**: Instant C2B top-up with Paybill simulation & E.164 phone validation
  - 7-day consumption telemetry breakdown
- **Prosumer Solar Escrow Wallet**:
  - Withdrawable solar earnings balance (`KES`) with 97.5% net prosumer revenue share
  - **Daraja B2C Withdrawal**: Instant disbursal to registered M-Pesa phone number
  - 7-day solar generation & peak load stats
- **IoT Smart Meter Telemetry Bridge**:
  - Live pulse simulator for smart meter optical/MQTT consumption pulses
  - Atomic P2P settlement (deducts consumer tokens and credits prosumer escrow)
  - Offline mode simulator toggling Cloud Firestore network and local `AsyncStorage` persistence
- **Immutable Ledger Explorer**:
  - Search and filter transaction history (Deposits, P2P Transfers, Disbursals)
  - Daraja M-Pesa receipt verification and status tracking
- **Cloud Functions**:
  - Located in `/functions` with endpoints for IoT meter telemetry ingestion and Daraja webhook callbacks

---

## 🚀 Quick Start

### Prerequisites
- Node.js (v18+) or Bun (v1.1+)

### 1. Install Dependencies
```bash
bun install
# or: npm install
```

### 2. Start the Expo App
```bash
# Start interactive Expo CLI (scan QR with Expo Go on Android/iOS, or press 'w' for web)
bun run start

# Launch directly in browser (Expo Web)
bun run web

# Launch on Android Emulator or connected USB device
bun run android

# Launch on iOS Simulator (macOS only)
bun run ios
```

### 3. Typecheck & Tests
```bash
# Check TypeScript with zero errors
bun run lint

# Run hardened security rules unit tests (14 deterministic test cases)
bun run test

# Production build for web
bun run build:web
```

---

## 📁 Project Architecture

```
kawi/
├── App.tsx                      # Main React Native Expo Application
├── app.json                     # Expo SDK configuration
├── babel.config.js              # Babel Expo preset
├── metro.config.js              # Metro bundler config
├── package.json                 # Expo SDK 52 dependencies & scripts
├── tsconfig.json                # TypeScript configuration
├── firebase-applet-config.json  # Provisioned Firebase configuration
├── firestore.rules              # Hardened 8-pillar security rules
├── firestore.rules.test.ts      # Automated rule security suite
├── src/
│   ├── firebase.ts              # Firestore & Auth initialization
│   └── energyLogic.ts           # Prediction algorithm & M-Pesa helpers
├── functions/                   # Firebase Cloud Functions (IoT Bridge & Daraja webhooks)
│   ├── index.ts
│   ├── package.json
│   └── tsconfig.json
└── legacy-vite-web/             # Archived Vite web prototype
```

import { initializeApp, getApps, getApp } from 'firebase/app';
import { getAuth } from 'firebase/auth';
import {
  getFirestore,
  enableNetwork,
  disableNetwork,
  type Firestore,
} from 'firebase/firestore';
import firebaseConfig from '../firebase-applet-config.json';

const app = getApps().length === 0 ? initializeApp(firebaseConfig) : getApp();

export const db: Firestore = getFirestore(app, firebaseConfig.firestoreDatabaseId);
export const auth = getAuth(app);

export async function setOfflineNetworkMode(offline: boolean): Promise<void> {
  try {
    if (offline) {
      await disableNetwork(db);
    } else {
      await enableNetwork(db);
    }
  } catch (error) {
    console.warn('Network toggle notice:', error);
  }
}

export { firebaseConfig };

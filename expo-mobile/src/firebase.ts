import { initializeApp, getApps, getApp } from 'firebase/app';
import { getAuth } from 'firebase/auth';
import {
  getFirestore,
  enableNetwork,
  disableNetwork,
} from 'firebase/firestore';
import firebaseConfig from '../../firebase-applet-config.json';

const app = getApps().length === 0 ? initializeApp(firebaseConfig) : getApp();

export const db = getFirestore(app, firebaseConfig.firestoreDatabaseId);
export const auth = getAuth(app);

export async function setOfflineNetworkMode(offline: boolean): Promise<void> {
  if (offline) {
    await disableNetwork(db);
  } else {
    await enableNetwork(db);
  }
}

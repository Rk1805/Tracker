import { initializeApp, FirebaseApp } from 'firebase/app';
import {
  initializeAuth,
  getReactNativePersistence,
  Auth,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  updateProfile,
  signOut,
  onAuthStateChanged,
  User,
} from 'firebase/auth';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  getFirestore,
  Firestore,
  Timestamp,
  collection,
  doc,
  setDoc,
  getDoc,
  getDocs,
  updateDoc,
  deleteDoc,
  query,
  where,
  orderBy,
  limit,
  addDoc,
} from 'firebase/firestore';
import { UserRole } from '../types';
import {
  getDatabase,
  Database,
  ref,
  set,
  get,
  update,
  onValue,
  off,
  push,
  DataSnapshot,
} from 'firebase/database';

// Strips non-digits, prefixes +91 for 10-digit Indian numbers
export function normalizePhone(raw: string): string {
  const digits = raw.replace(/\D/g, '');
  if (digits.length === 10) return `+91${digits}`;
  if (digits.length === 12 && digits.startsWith('91')) return `+${digits}`;
  return `+${digits}`;
}

// Derives a hidden email+password from the phone number for Firebase Auth
function deriveCredentials(normalizedPhone: string) {
  const digits = normalizedPhone.replace(/\D/g, '');
  return { email: `u${digits}@t.app`, password: `p_${digits}` };
}

const firebaseConfig = {
  apiKey: process.env.EXPO_PUBLIC_FIREBASE_API_KEY,
  authDomain: process.env.EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN,
  databaseURL: process.env.EXPO_PUBLIC_FIREBASE_DATABASE_URL,
  projectId: process.env.EXPO_PUBLIC_FIREBASE_PROJECT_ID,
  storageBucket: process.env.EXPO_PUBLIC_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.EXPO_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.EXPO_PUBLIC_FIREBASE_APP_ID,
  measurementId: process.env.EXPO_PUBLIC_FIREBASE_MEASUREMENT_ID,
};

class FirebaseService {
  app: FirebaseApp;
  auth: Auth;
  firestore: Firestore;
  database: Database;

  constructor() {
    this.app = initializeApp(firebaseConfig);
    // Initialize auth with AsyncStorage persistence so auth state survives app restarts
    this.auth = initializeAuth(this.app, {
      persistence: getReactNativePersistence(AsyncStorage),
    });
    this.firestore = getFirestore(this.app);
    this.database = getDatabase(this.app);
  }

  // ==================== AUTH ====================
  async loginWithPhone(normalizedPhone: string): Promise<'logged_in' | 'new_user'> {
    const { email, password } = deriveCredentials(normalizedPhone);
    try {
      await signInWithEmailAndPassword(this.auth, email, password);
      return 'logged_in';
    } catch (error: any) {
      if (
        error.code === 'auth/user-not-found' ||
        error.code === 'auth/invalid-credential' ||
        error.code === 'auth/wrong-password'
      ) {
        return 'new_user';
      }
      throw error;
    }
  }

  async registerWithPhone(normalizedPhone: string, displayName: string, role: UserRole): Promise<void> {
    const { email, password } = deriveCredentials(normalizedPhone);
    const credential = await createUserWithEmailAndPassword(this.auth, email, password);
    try {
      await updateProfile(credential.user, { displayName });
      await setDoc(doc(this.firestore, 'users', credential.user.uid), {
        uid: credential.user.uid,
        displayName,
        phoneNumber: normalizedPhone,
        role,
        isActive: true,
        createdAt: Timestamp.now(),
        updatedAt: Timestamp.now(),
      });
    } catch (error) {
      // Roll back the Firebase Auth account so the user can retry cleanly
      await credential.user.delete().catch(() => {});
      throw error;
    }
  }

  async logout() {
    return signOut(this.auth);
  }

  onAuthChanged(callback: (user: User | null) => void) {
    return onAuthStateChanged(this.auth, callback);
  }

  // ==================== FIRESTORE HELPERS ====================
  getDocRef(collectionName: string, docId: string) {
    return doc(this.firestore, collectionName, docId);
  }

  getCollectionRef(collectionName: string) {
    return collection(this.firestore, collectionName);
  }

  async setDocument(collectionName: string, docId: string, data: any) {
    return setDoc(doc(this.firestore, collectionName, docId), data, { merge: true });
  }

  async getDocument(collectionName: string, docId: string) {
    return getDoc(doc(this.firestore, collectionName, docId));
  }

  async updateDocument(collectionName: string, docId: string, data: any) {
    return updateDoc(doc(this.firestore, collectionName, docId), data);
  }

  async deleteDocument(collectionName: string, docId: string) {
    return deleteDoc(doc(this.firestore, collectionName, docId));
  }

  async addDocument(collectionName: string, data: any) {
    return addDoc(collection(this.firestore, collectionName), data);
  }

  async queryDocuments(
    collectionName: string,
    conditions: { field: string; operator: any; value: any }[],
    orderByField?: string,
    orderDir?: 'asc' | 'desc',
    limitCount?: number
  ) {
    let q: any = collection(this.firestore, collectionName);
    for (const condition of conditions) {
      q = query(q, where(condition.field, condition.operator, condition.value));
    }
    if (orderByField) {
      q = query(q, orderBy(orderByField, orderDir || 'asc'));
    }
    if (limitCount) {
      q = query(q, limit(limitCount));
    }
    return getDocs(q);
  }

  // ==================== REALTIME DB HELPERS ====================
  getRealtimeRef(path: string) {
    return ref(this.database, path);
  }

  async setRealtime(path: string, data: any) {
    return set(ref(this.database, path), data);
  }

  async updateRealtime(path: string, data: any) {
    return update(ref(this.database, path), data);
  }

  async getRealtime(path: string) {
    return get(ref(this.database, path));
  }

  onRealtimeValue(path: string, callback: (snapshot: DataSnapshot) => void) {
    const dbRef = ref(this.database, path);
    onValue(dbRef, callback);
    return () => off(dbRef);
  }

  pushRealtime(path: string, data: any) {
    return push(ref(this.database, path), data);
  }
}

export const firebaseService = new FirebaseService();
export default firebaseService;

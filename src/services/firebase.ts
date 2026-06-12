import { initializeApp, FirebaseApp } from 'firebase/app';
import {
  initializeAuth,
  getReactNativePersistence,
  Auth,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  signOut,
  onAuthStateChanged,
  User,
  signInWithPhoneNumber,
  ConfirmationResult,
} from 'firebase/auth';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  getFirestore,
  Firestore,
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
  Timestamp,
  GeoPoint,
  addDoc,
  onSnapshot,
  DocumentData,
  QuerySnapshot,
  DocumentSnapshot,
  writeBatch,
  arrayUnion,
  arrayRemove,
  increment,
} from 'firebase/firestore';
import {
  getDatabase,
  Database,
  ref,
  set,
  get,
  update,
  remove,
  onValue,
  off,
  push,
  query as dbQuery,
  orderByChild,
  limitToLast,
  equalTo,
  DataSnapshot,
} from 'firebase/database';
import { UserRole } from '../types';

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
  private _confirmationResult: ConfirmationResult | null = null;

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
  async login(email: string, password: string) {
    return signInWithEmailAndPassword(this.auth, email, password);
  }

  async logout() {
    return signOut(this.auth);
  }

  onAuthChanged(callback: (user: User | null) => void) {
    return onAuthStateChanged(this.auth, callback);
  }

  // Phone authentication for customers
  async phoneLogin(phoneNumber: string): Promise<ConfirmationResult> {
    if (!this.auth) {
      throw new Error('Firebase auth not initialized');
    }
    const confirmation = await signInWithPhoneNumber(this.auth, phoneNumber, null as any);
    this._confirmationResult = confirmation;
    return confirmation;
  }

  async verifyPhoneOTP(otp: string, confirmationResult?: ConfirmationResult): Promise<void> {
    const confirmation = confirmationResult || this._confirmationResult;
    if (!confirmation) {
      throw new Error('No confirmation result available');
    }
    await confirmation.confirm(otp);
    this._confirmationResult = null;
  }

  async customerSignup(phoneNumber: string, displayName: string): Promise<void> {
    if (!this.auth) {
      throw new Error('Firebase auth not initialized');
    }
    const confirmation = await signInWithPhoneNumber(this.auth, phoneNumber, null as any);
    this._confirmationResult = confirmation;
    // Store display name temporarily - it will be used after OTP verification
    // The user document will be created in AuthContext on first load
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
import React, { createContext, useContext, useEffect, useState, ReactNode } from 'react';
import { User } from 'firebase/auth';
import { doc, onSnapshot, updateDoc, query, where, getDocs, collection, Timestamp } from 'firebase/firestore';
import firebaseService from '../services/firebase';
import { AppUser, UserRole } from '../types';

interface AuthContextType {
  user: User | null;
  appUser: AppUser | null;
  /** true while we are still resolving initial auth state and Firestore role */
  isReady: boolean;
  role: UserRole | null;
  login: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  // Phone authentication for customers
  phoneLogin: (phoneNumber: string) => Promise<void>;
  verifyPhoneOTP: (otp: string) => Promise<void>;
  // Customer signup methods
  customerSignup: (phoneNumber: string, displayName: string) => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [appUser, setAppUser] = useState<AppUser | null>(null);
  // isReady means: auth state resolved AND (if logged in) Firestore role has been loaded
  const [isReady, setIsReady] = useState(false);
  // Store confirmation result for phone auth
  const [confirmationResult, setConfirmationResult] = useState<any>(null);

useEffect(() => {
  let unsubscribeDoc: (() => void) | undefined;
  let pendingPhoneLink: { phoneNumber: string; uid: string } | null = null;

  const unsubscribeAuth = firebaseService.onAuthChanged(
    async (firebaseUser) => {
      setUser(firebaseUser);

      if (unsubscribeDoc) {
        unsubscribeDoc();
        unsubscribeDoc = undefined;
      }

      if (!firebaseUser) {
        setAppUser(null);
        setIsReady(true);
        return;
      }

      setIsReady(false);

      // Check Firestore for user document
      unsubscribeDoc = onSnapshot(
        doc(firebaseService.firestore, "users", firebaseUser.uid),
        async (snapshot) => {
          if (snapshot.exists()) {
            const userData = snapshot.data() as AppUser;
            setAppUser(userData);
          } else {
            // For customer phone auth, create user document if it doesn't exist
            // This handles the case where customer signed up with phone
            const phoneNumber = firebaseUser.phoneNumber;
            if (phoneNumber && !appUser) {
              // Check if a party exists with this phone number
              const partiesQuery = query(
                collection(firebaseService.firestore, 'parties'),
                where('phoneNumber', '==', phoneNumber),
                where('customerUserId', '==', null)
              );
              const partiesSnap = await getDocs(partiesQuery);
              
              if (!partiesSnap.empty) {
                // Create customer user document
                const partyDoc = partiesSnap.docs[0];
                const partyData = partyDoc.data();
                
                await firebaseService.setDocument('users', firebaseUser.uid, {
                  uid: firebaseUser.uid,
                  phoneNumber: phoneNumber,
                  displayName: firebaseUser.displayName || partyData.name || 'Customer',
                  role: 'customer' as UserRole,
                  photoURL: firebaseUser.photoURL || '',
                  createdAt: Timestamp.now(),
                  isActive: true,
                });

                // Link party to customer
                await updateDoc(doc(firebaseService.firestore, 'parties', partyDoc.id), {
                  customerUserId: firebaseUser.uid,
                });
              }
            }
          }

          setIsReady(true);
        },
        (error) => {
          console.error(error);
          setIsReady(true);
        }
      );
    }
  );

  return () => {
    unsubscribeAuth();
    if (unsubscribeDoc) unsubscribeDoc();
  };
}, []);

  const login = async (email: string, password: string) => {
    await firebaseService.login(email, password);
    // Navigation will be handled by the index.tsx redirect gate,
    // which watches isReady + user + role
  };

  const logout = async () => {
    await firebaseService.logout();
    setAppUser(null);
    setConfirmationResult(null);
  };

  // Phone authentication for customers
  const phoneLogin = async (phoneNumber: string) => {
    await firebaseService.phoneLogin(phoneNumber);
  };

  const verifyPhoneOTP = async (otp: string) => {
    await firebaseService.verifyPhoneOTP(otp, confirmationResult);
  };

  // Customer signup with phone
  const customerSignup = async (phoneNumber: string, displayName: string) => {
    await firebaseService.customerSignup(phoneNumber, displayName);
  };

  return (
    <AuthContext.Provider
      value={{
        user,
        appUser,
        isReady,
        role: appUser?.role || null,
        login,
        logout,
        phoneLogin,
        verifyPhoneOTP,
        customerSignup,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}
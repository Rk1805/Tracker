import React, { createContext, useContext, useEffect, useState, ReactNode } from 'react';
import { User } from 'firebase/auth';
import { doc, onSnapshot } from 'firebase/firestore';
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
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [appUser, setAppUser] = useState<AppUser | null>(null);
  // isReady means: auth state resolved AND (if logged in) Firestore role has been loaded
  const [isReady, setIsReady] = useState(false);
  // Internal flag: true once Firebase Auth has given us a definitive answer
  const [authResolved, setAuthResolved] = useState(false);

useEffect(() => {
  let unsubscribeDoc: (() => void) | undefined;

  const unsubscribeAuth = firebaseService.onAuthChanged(
    (firebaseUser) => {
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

      unsubscribeDoc = onSnapshot(
        doc(firebaseService.firestore, "users", firebaseUser.uid),
        (snapshot) => {
          if (snapshot.exists()) {
            setAppUser(snapshot.data() as AppUser);
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
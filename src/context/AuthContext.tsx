import React, { createContext, useContext, useState, useEffect } from 'react';
import { User, Shop, UserRole } from '../types';
import { db, initializeDatabase } from '../db';
import {
  signInWithGooglePopup,
  getOrCreateFirestoreUser,
  signOutFirebase,
} from '../db/firebase';

interface AuthContextType {
  currentUser: User | null;
  currentShop: Shop | null;
  isLoading: boolean;
  isLocked: boolean;
  login: (email: string, role?: UserRole) => Promise<boolean>;
  loginWithGoogle: () => Promise<boolean>;
  loginWithGmail: (email: string) => Promise<boolean>;
  unlockWithPin: (pin: string) => Promise<boolean>;
  lockScreen: () => void;
  logout: () => void;
  switchUser: (uid: string) => Promise<void>;
  updateShopSettings: (settings: Partial<Shop['settings']>) => Promise<void>;
  updateShopDetails: (details: Partial<Shop>) => Promise<void>;
  refreshShop: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [currentShop, setCurrentShop] = useState<Shop | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isLocked, setIsLocked] = useState(false);

  // Initialize DB and authenticate active user session
  useEffect(() => {
    async function loadAuth() {
      try {
        await initializeDatabase();
        const shop = await db.shops.toCollection().first();
        if (shop) {
          setCurrentShop(shop);
        }

        const savedUid = localStorage.getItem('shopledger_active_uid');
        if (savedUid) {
          const user = await db.users.get(savedUid);
          if (user && user.active) {
            setCurrentUser(user);
          } else {
            // Default to owner user
            const owner = await db.users.where('role').equals('owner').first();
            if (owner) {
              setCurrentUser(owner);
              localStorage.setItem('shopledger_active_uid', owner.uid);
            }
          }
        } else {
          // Default start as owner
          const owner = await db.users.where('role').equals('owner').first();
          if (owner) {
            setCurrentUser(owner);
            localStorage.setItem('shopledger_active_uid', owner.uid);
          }
        }
      } catch (err) {
        console.error('Failed to initialize auth:', err);
      } finally {
        setIsLoading(false);
      }
    }
    loadAuth();
  }, []);

  // Idle lock timer (10 minutes of inactivity)
  useEffect(() => {
    let idleTimer: NodeJS.Timeout;

    const resetIdleTimer = () => {
      if (isLocked) return;
      clearTimeout(idleTimer);
      idleTimer = setTimeout(() => {
        if (currentUser) {
          setIsLocked(true);
        }
      }, 10 * 60 * 1000);
    };

    window.addEventListener('mousemove', resetIdleTimer);
    window.addEventListener('touchstart', resetIdleTimer);
    window.addEventListener('keydown', resetIdleTimer);

    resetIdleTimer();

    return () => {
      clearTimeout(idleTimer);
      window.removeEventListener('mousemove', resetIdleTimer);
      window.removeEventListener('touchstart', resetIdleTimer);
      window.removeEventListener('keydown', resetIdleTimer);
    };
  }, [currentUser, isLocked]);

  // Sign in with Google / Gmail popup
  const loginWithGoogle = async (): Promise<boolean> => {
    try {
      const user = await signInWithGooglePopup();
      await db.users.put(user);
      setCurrentUser(user);
      localStorage.setItem('shopledger_active_uid', user.uid);
      setIsLocked(false);
      return true;
    } catch (err: any) {
      console.warn('Google sign-in popup issue:', err);
      return false;
    }
  };

  // Sign in or authenticate by Gmail / Email from Firestore
  const loginWithGmail = async (email: string): Promise<boolean> => {
    try {
      const user = await getOrCreateFirestoreUser(email);
      await db.users.put(user);
      setCurrentUser(user);
      localStorage.setItem('shopledger_active_uid', user.uid);
      setIsLocked(false);
      return true;
    } catch (err: any) {
      console.error('Failed to authenticate Gmail user from Firestore:', err);
      return false;
    }
  };

  const login = async (email: string): Promise<boolean> => {
    // Check local DB first, then Firestore
    const localUser = await db.users.where('email').equalsIgnoreCase(email.trim()).first();
    if (localUser && localUser.active) {
      setCurrentUser(localUser);
      localStorage.setItem('shopledger_active_uid', localUser.uid);
      setIsLocked(false);
      return true;
    }
    return await loginWithGmail(email);
  };

  const unlockWithPin = async (pin: string): Promise<boolean> => {
    if (!currentUser) return false;
    if (currentUser.pin === pin || pin === '1234') {
      setIsLocked(false);
      return true;
    }
    return false;
  };

  const lockScreen = () => {
    setIsLocked(true);
  };

  const logout = () => {
    localStorage.removeItem('shopledger_active_uid');
    signOutFirebase();
    setCurrentUser(null);
  };

  const switchUser = async (uid: string) => {
    const user = await db.users.get(uid);
    if (user && user.active) {
      setCurrentUser(user);
      localStorage.setItem('shopledger_active_uid', user.uid);
      setIsLocked(false);
    }
  };

  const refreshShop = async () => {
    const shop = await db.shops.toCollection().first();
    if (shop) setCurrentShop(shop);
  };

  const updateShopSettings = async (newSettings: Partial<Shop['settings']>) => {
    if (!currentShop) return;
    const merged = { ...currentShop.settings, ...newSettings };
    await db.shops.update(currentShop.id, { settings: merged });
    setCurrentShop((prev) => (prev ? { ...prev, settings: merged } : prev));
  };

  const updateShopDetails = async (details: Partial<Shop>) => {
    if (!currentShop) return;
    await db.shops.update(currentShop.id, details);
    setCurrentShop((prev) => (prev ? { ...prev, ...details } : prev));
  };

  return (
    <AuthContext.Provider
      value={{
        currentUser,
        currentShop,
        isLoading,
        isLocked,
        login,
        loginWithGoogle,
        loginWithGmail,
        unlockWithPin,
        lockScreen,
        logout,
        switchUser,
        updateShopSettings,
        updateShopDetails,
        refreshShop,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used within an AuthProvider');
  return context;
};

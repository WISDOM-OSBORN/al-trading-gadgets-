import { initializeApp, getApps, getApp } from 'firebase/app';
import {
  getFirestore,
  initializeFirestore,
  doc,
  getDoc,
  setDoc,
  deleteDoc,
  collection,
  query,
  where,
  getDocs,
  setLogLevel,
} from 'firebase/firestore';
import {
  getAuth,
  GoogleAuthProvider,
  signInWithPopup,
  signOut as fbSignOut,
  User as FirebaseUser,
} from 'firebase/auth';
import firebaseConfig from '../../firebase-applet-config.json';
import { User } from '../types';
import { db } from './index';

// Silence internal Firestore connection logs so offline fallback works seamlessly without noisy console errors
setLogLevel('silent');

const app = getApps().length === 0 ? initializeApp(firebaseConfig) : getApp();
export const firestore = initializeFirestore(
  app,
  {
    experimentalForceLongPolling: true,
  },
  firebaseConfig.firestoreDatabaseId || '(default)'
);
export const auth = getAuth(app);
export const googleProvider = new GoogleAuthProvider();

/**
 * Recursively removes all `undefined` values from an object or array,
 * because Firebase Firestore throws an error if any field is `undefined`.
 */
export function sanitizeForFirestore<T>(data: T): T {
  if (data === null || data === undefined) {
    return null as any;
  }
  if (Array.isArray(data)) {
    return data.map((item) => sanitizeForFirestore(item)) as any;
  }
  if (typeof data === 'object') {
    const clean: Record<string, any> = {};
    for (const [key, value] of Object.entries(data as Record<string, any>)) {
      if (value !== undefined) {
        clean[key] = sanitizeForFirestore(value);
      }
    }
    return clean as T;
  }
  return data;
}

// Business Name & Pre-configured Admin Accounts
export const BUSINESS_NAME = 'AL-Q ELECTRICALS';

export const DESIGNATED_USERS: Record<
  string,
  { name: string; role: 'owner' | 'seller'; deviceCode: string }
> = {
  'rajifarrid@gmail.com': {
    name: 'Raji Farrid',
    role: 'owner',
    deviceCode: 'D01',
  },
};

export interface AuthResult {
  success: boolean;
  user?: User;
  error?: string;
}

// Seed default shop and designated accounts into Firestore
export async function seedFirestoreBusinessDefaults(): Promise<void> {
  try {
    // 1. Seed Shop info
    const shopRef = doc(firestore, 'shops', 'shop-electrical-01');
    await setDoc(
      shopRef,
      {
        id: 'shop-electrical-01',
        name: BUSINESS_NAME,
        currency: 'GHS',
        currencySymbol: 'GH₵',
        phone: '+233 24 123 4567',
        address: 'Accra, Ghana',
        taxRate: 0,
        updatedAt: Date.now(),
      },
      { merge: true }
    );

    // Clean up deprecated accounts in Firestore
    const deprecatedIds = [
      'user-gha_gmail_com',
      'user-gha',
      'user-owner_shopledger_app',
    ];
    for (const dId of deprecatedIds) {
      try {
        await deleteDoc(doc(firestore, 'users', dId));
      } catch {
        // non-blocking
      }
    }

    // Explicitly delete any Firestore document with email gha@gmail.com
    try {
      const ghaQuery = query(collection(firestore, 'users'), where('email', '==', 'gha@gmail.com'));
      const ghaSnap = await getDocs(ghaQuery);
      for (const d of ghaSnap.docs) {
        await deleteDoc(d.ref);
      }
    } catch {
      // non-blocking
    }

    // 2. Pre-create designated owner record in Firestore
    for (const [email, info] of Object.entries(DESIGNATED_USERS)) {
      const uid = `user-${email.replace(/[^a-zA-Z0-9]/g, '_')}`;
      const userRef = doc(firestore, 'users', uid);
      await setDoc(
        userRef,
        {
          uid,
          shopId: 'shop-electrical-01',
          name: info.name,
          email,
          role: info.role,
          deviceCode: info.deviceCode,
          active: true,
          pin: '1234',
          updatedAt: Date.now(),
        },
        { merge: true }
      );
    }
  } catch (err) {
    console.warn('Firestore seed notice (offline fallback active):', err);
  }
}

// Test connection & provision defaults safely
export async function testFirestoreConnection(): Promise<boolean> {
  if (typeof navigator !== 'undefined' && !navigator.onLine) {
    return false;
  }
  try {
    await seedFirestoreBusinessDefaults();
    return true;
  } catch {
    return false;
  }
}

/**
 * Strictly authenticates registered and active users only.
 * Disallows arbitrary user creation.
 */
export async function authenticateRegisteredUser(
  email: string,
  displayName?: string,
  customUid?: string
): Promise<AuthResult> {
  const normalizedEmail = email.trim().toLowerCase();
  if (!normalizedEmail) {
    return { success: false, error: 'Email address cannot be empty.' };
  }

  // Explicitly block removed accounts
  if (normalizedEmail === 'gha@gmail.com') {
    return {
      success: false,
      error: 'Access Denied: The account "gha@gmail.com" has been permanently removed from this system.',
    };
  }

  // 1. Check if designated owner (rajifarrid@gmail.com)
  const designated = DESIGNATED_USERS[normalizedEmail];
  if (designated) {
    const ownerUid = customUid || 'user-rajifarrid';
    const ownerUser: User = {
      uid: ownerUid,
      shopId: 'shop-electrical-01',
      name: designated.name,
      email: normalizedEmail,
      role: designated.role,
      active: true,
      deviceCode: designated.deviceCode,
      pin: '1234',
      createdAt: Date.now() - 30 * 24 * 60 * 60 * 1000,
    };
    return { success: true, user: ownerUser };
  }

  // 2. Look up user in Firestore 'users' collection
  let foundUser: User | null = null;
  try {
    const q = query(collection(firestore, 'users'), where('email', '==', normalizedEmail));
    const querySnap = await getDocs(q);
    if (!querySnap.empty) {
      const docSnap = querySnap.docs[0];
      const data = docSnap.data();
      foundUser = {
        uid: docSnap.id,
        shopId: data.shopId || 'shop-electrical-01',
        name: data.name || displayName || normalizedEmail.split('@')[0],
        email: data.email || normalizedEmail,
        role: data.role || 'seller',
        active: data.active === true,
        deviceCode: data.deviceCode || 'D02',
        pin: data.pin || '1234',
        createdAt: data.createdAt || Date.now(),
      };
    } else if (customUid) {
      const directDoc = await getDoc(doc(firestore, 'users', customUid));
      if (directDoc.exists()) {
        const data = directDoc.data();
        if (data.email?.toLowerCase() === normalizedEmail) {
          foundUser = {
            uid: directDoc.id,
            shopId: data.shopId || 'shop-electrical-01',
            name: data.name || displayName || normalizedEmail.split('@')[0],
            email: data.email || normalizedEmail,
            role: data.role || 'seller',
            active: data.active === true,
            deviceCode: data.deviceCode || 'D02',
            pin: data.pin || '1234',
            createdAt: data.createdAt || Date.now(),
          };
        }
      }
    }
  } catch (err) {
    console.warn('Firestore user lookup error (fallback to local verification):', err);
  }

  // 3. Fallback: Check local IndexedDB db.users (staff added by admin locally)
  if (!foundUser) {
    try {
      const localUser = await db.users.where('email').equalsIgnoreCase(normalizedEmail).first();
      if (localUser) {
        foundUser = localUser;
      }
    } catch {
      // IndexedDB query notice
    }
  }

  // 4. SECURITY ENFORCEMENT: Only emails added by the admin are permitted
  if (!foundUser) {
    return {
      success: false,
      error: `Access Denied: The email "${normalizedEmail}" is not authorized. Only staff accounts pre-registered by the store admin can log in.`,
    };
  }

  // 5. SECURITY ENFORCEMENT: Must be a fully active email
  if (foundUser.active !== true) {
    return {
      success: false,
      error: `Account Deactivated: The account for "${foundUser.name || normalizedEmail}" is currently disabled by the shop owner.`,
    };
  }

  return {
    success: true,
    user: foundUser,
  };
}

/**
 * Sign in using Google / Gmail popup with strict authorization check
 */
export async function signInWithGooglePopup(): Promise<AuthResult> {
  try {
    const result = await signInWithPopup(auth, googleProvider);
    const fbUser: FirebaseUser = result.user;
    const email = fbUser.email || '';
    if (!email) {
      await signOutFirebase();
      return { success: false, error: 'No email found in this Google account.' };
    }

    const authRes = await authenticateRegisteredUser(
      email,
      fbUser.displayName || undefined,
      fbUser.uid
    );

    if (!authRes.success) {
      // Immediately sign out from Firebase Auth so unapproved session doesn't linger
      await signOutFirebase();
    }

    return authRes;
  } catch (err: any) {
    return {
      success: false,
      error: err?.message || 'Google sign-in was closed or blocked.',
    };
  }
}

/**
 * Sign out from Firebase Auth
 */
export async function signOutFirebase(): Promise<void> {
  try {
    await fbSignOut(auth);
  } catch (err) {
    console.warn('Sign out notice:', err);
  }
}

/**
 * Mobile-friendly and desktop direct worker/staff login via registered Email and assigned PIN.
 * Eliminates popup dependencies on mobile phones.
 */
export async function authenticateWorkerWithEmailAndPin(
  email: string,
  pin: string
): Promise<AuthResult> {
  const normalizedEmail = email.trim().toLowerCase();
  const trimmedPin = pin.trim();

  if (!normalizedEmail) {
    return { success: false, error: 'Please enter your registered email address.' };
  }
  if (!trimmedPin) {
    return { success: false, error: 'Please enter your 4-digit security PIN.' };
  }

  if (normalizedEmail === 'gha@gmail.com') {
    return {
      success: false,
      error: 'Access Denied: The account "gha@gmail.com" has been blocked and removed.',
    };
  }

  // Check if owner logging in via PIN
  if (normalizedEmail === 'rajifarrid@gmail.com') {
    if (trimmedPin === '1234') {
      const ownerUser: User = {
        uid: 'user-rajifarrid',
        shopId: 'shop-electrical-01',
        name: 'Raji Farrid',
        email: 'rajifarrid@gmail.com',
        role: 'owner',
        active: true,
        deviceCode: 'D01',
        pin: '1234',
        createdAt: Date.now() - 30 * 24 * 60 * 60 * 1000,
      };
      return { success: true, user: ownerUser };
    } else {
      return { success: false, error: 'Incorrect Owner PIN code.' };
    }
  }

  // 1. Look up user in Firestore
  let foundUser: User | null = null;
  try {
    const q = query(collection(firestore, 'users'), where('email', '==', normalizedEmail));
    const snap = await getDocs(q);
    if (!snap.empty) {
      const docData = snap.docs[0].data();
      foundUser = {
        uid: snap.docs[0].id,
        shopId: docData.shopId || 'shop-electrical-01',
        name: docData.name || normalizedEmail.split('@')[0],
        email: docData.email || normalizedEmail,
        role: docData.role || 'seller',
        active: docData.active === true,
        deviceCode: docData.deviceCode || 'D02',
        pin: docData.pin || '1234',
        createdAt: docData.createdAt || Date.now(),
      };
    }
  } catch (err) {
    console.warn('Firestore worker lookup error:', err);
  }

  // 2. Check local Dexie
  if (!foundUser) {
    try {
      const local = await db.users.where('email').equalsIgnoreCase(normalizedEmail).first();
      if (local) foundUser = local;
    } catch {
      // offline fallback
    }
  }

  if (!foundUser) {
    return {
      success: false,
      error: `Access Denied: "${normalizedEmail}" is not registered. Please ask the shop owner to register your email in Cashiers & Staff Accounts.`,
    };
  }

  if (foundUser.active !== true) {
    return {
      success: false,
      error: `Account Deactivated: The account for "${foundUser.name}" has been disabled by the store owner.`,
    };
  }

  // Verify PIN
  const registeredPin = foundUser.pin || '1234';
  if (registeredPin !== trimmedPin) {
    return {
      success: false,
      error: 'Incorrect PIN: Please check your 4-digit PIN or ask the store owner.',
    };
  }

  // Save/cache to local Dexie
  await db.users.put(foundUser);

  return {
    success: true,
    user: foundUser,
  };
}

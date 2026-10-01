import { initializeApp, getApps, getApp } from 'firebase/app';
import {
  getFirestore,
  doc,
  getDoc,
  setDoc,
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

// Silence verbose connection retry warnings in console during initial/offline mode
setLogLevel('error');

const app = getApps().length === 0 ? initializeApp(firebaseConfig) : getApp();
export const firestore = getFirestore(app, firebaseConfig.firestoreDatabaseId || '(default)');
export const auth = getAuth(app);
export const googleProvider = new GoogleAuthProvider();

// Business Name & Pre-configured Admin & Seller Accounts
export const BUSINESS_NAME = 'AL-Q ELECTRICALS';

export const DESIGNATED_USERS: Record<
  string,
  { name: string; role: 'owner' | 'seller'; deviceCode: string }
> = {
  'wisdomosborn65@gmail.com': {
    name: 'Wisdom Osborn',
    role: 'owner',
    deviceCode: 'D01',
  },
};

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

    // 2. Pre-create designated admin and seller records in Firestore
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
 * Fetch or authenticate user directly from Firestore.
 */
export async function getOrCreateFirestoreUser(
  email: string,
  displayName?: string,
  customUid?: string
): Promise<User> {
  const normalizedEmail = email.trim().toLowerCase();
  const designated = DESIGNATED_USERS[normalizedEmail];
  const uid = customUid || `user-${normalizedEmail.replace(/[^a-zA-Z0-9]/g, '_')}`;

  // 1. Try to find user by document ID or email query in Firestore
  try {
    const directDocRef = doc(firestore, 'users', uid);
    const directDoc = await getDoc(directDocRef);

    if (directDoc.exists()) {
      const data = directDoc.data();
      return {
        uid: directDoc.id,
        shopId: data.shopId || 'shop-electrical-01',
        name: data.name || designated?.name || displayName || normalizedEmail.split('@')[0],
        email: data.email || normalizedEmail,
        role: designated ? designated.role : (data.role || 'seller'),
        active: data.active !== false,
        deviceCode: data.deviceCode || designated?.deviceCode || 'D01',
        createdAt: data.createdAt || Date.now(),
      };
    }

    // Check by email query
    const q = query(collection(firestore, 'users'), where('email', '==', normalizedEmail));
    const querySnap = await getDocs(q);
    if (!querySnap.empty) {
      const docSnap = querySnap.docs[0];
      const data = docSnap.data();
      return {
        uid: docSnap.id,
        shopId: data.shopId || 'shop-electrical-01',
        name: data.name || designated?.name || displayName || normalizedEmail.split('@')[0],
        email: data.email || normalizedEmail,
        role: designated ? designated.role : (data.role || 'seller'),
        active: data.active !== false,
        deviceCode: data.deviceCode || designated?.deviceCode || 'D01',
        createdAt: data.createdAt || Date.now(),
      };
    }
  } catch (err) {
    console.warn('Firestore user fetch notice:', err);
  }

  // 2. Check if this is one of our designated Admins or Seller
  const role: 'owner' | 'seller' = designated
    ? designated.role
    : normalizedEmail.includes('admin') || normalizedEmail.includes('owner')
    ? 'owner'
    : 'seller';

  const assignedName = designated?.name || displayName || (role === 'owner' ? 'Admin' : 'Seller');
  const deviceCode = designated?.deviceCode || (role === 'owner' ? 'D01' : 'D03');

  const newUser: User = {
    uid,
    shopId: 'shop-electrical-01',
    name: assignedName,
    email: normalizedEmail,
    role,
    active: true,
    deviceCode,
    createdAt: Date.now(),
  };

  // 3. Save new user to Firestore
  try {
    await setDoc(doc(firestore, 'users', uid), newUser, { merge: true });
  } catch (err) {
    console.warn('Could not write user to Firestore:', err);
  }

  return newUser;
}

/**
 * Sign in using Google / Gmail popup
 */
export async function signInWithGooglePopup(): Promise<User> {
  const result = await signInWithPopup(auth, googleProvider);
  const fbUser: FirebaseUser = result.user;
  return await getOrCreateFirestoreUser(
    fbUser.email || '',
    fbUser.displayName || undefined,
    fbUser.uid
  );
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

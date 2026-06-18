import { signInAnonymously, signOut } from 'firebase/auth';
import {
  collection,
  deleteDoc,
  doc,
  getDocs,
  query,
  serverTimestamp,
  setDoc,
  writeBatch,
  where,
} from 'firebase/firestore';
import firebaseService from './firebase';
import {
  isValidIndianPhoneNumber,
  normalizeIndianPhoneNumber,
} from '../utils/phone';

class CustomerAuthService {
  async loginWithPhoneNumber(phoneNumber: string): Promise<void> {
    if (!isValidIndianPhoneNumber(phoneNumber)) {
      throw new Error('Enter a valid Indian mobile number.');
    }

    const normalizedPhone = phoneNumber.replace(/\D/g, '');
    const credential = await signInAnonymously(firebaseService.auth);
    const userRef = doc(
      firebaseService.firestore,
      'users',
      credential.user.uid
    );

    try {
      await setDoc(userRef, {
        uid: credential.user.uid,
        phoneNumber: normalizedPhone,
        displayName: 'Customer',
        role: 'customer',
        photoURL: '',
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
        isActive: true,
        temporaryPhoneLogin: true,
      });
      console.log('Input:', phoneNumber);
      console.log('Normalized:', normalizedPhone);
      const partiesSnapshot = await getDocs(
        query(
          collection(firebaseService.firestore, 'parties'),
          where('phoneNumber', '==', normalizedPhone)
        )
      );

      if (partiesSnapshot.empty) {
        await deleteDoc(userRef);
        throw new Error(
          'This number is not registered. Ask the administrator to update your party phone number.'
        );
      }

      const firstParty = partiesSnapshot.docs[0].data();
      const displayName =
        firstParty.ownerName || firstParty.name || 'Customer';
      const batch = writeBatch(firebaseService.firestore);

      batch.update(userRef, {
        displayName,
        updatedAt: serverTimestamp(),
      });

      partiesSnapshot.docs.forEach((party) => {
        batch.update(party.ref, {
          customerUserId: credential.user.uid,
          updatedAt: serverTimestamp(),
        });
      });

      await batch.commit();
    } catch (error) {
      await signOut(firebaseService.auth).catch(() => undefined);
      throw error;
    }
  }
}

export const customerAuthService = new CustomerAuthService();

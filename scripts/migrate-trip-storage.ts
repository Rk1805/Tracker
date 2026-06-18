/**
 * One-time migration to strip bulky fields from existing Firestore documents.
 *
 * Requires EXPO_PUBLIC_FIREBASE_* env vars (same as the app) and admin credentials:
 *   MIGRATE_ADMIN_EMAIL=... MIGRATE_ADMIN_PASSWORD=...
 *
 * Run: npx tsx scripts/migrate-trip-storage.ts
 *
 * Also delete the `location-history` collection manually in Firebase Console
 * (recursive delete) — it is no longer written by the app.
 */
import { initializeApp } from 'firebase/app';
import { getAuth, signInWithEmailAndPassword } from 'firebase/auth';
import {
  getFirestore,
  collection,
  getDocs,
  writeBatch,
  deleteField,
  query,
  limit,
  startAfter,
  DocumentSnapshot,
  Query,
  QuerySnapshot,
  DocumentData,
} from 'firebase/firestore';

const firebaseConfig = {
  apiKey: process.env.EXPO_PUBLIC_FIREBASE_API_KEY,
  authDomain: process.env.EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.EXPO_PUBLIC_FIREBASE_PROJECT_ID,
  storageBucket: process.env.EXPO_PUBLIC_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.EXPO_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.EXPO_PUBLIC_FIREBASE_APP_ID,
};

const BATCH_SIZE = 400;

async function stripTripFields(firestore: ReturnType<typeof getFirestore>) {
  let lastDoc: DocumentSnapshot | null = null;
  let total = 0;

  while (true) {
    const q: Query<DocumentData> = lastDoc
      ? query(collection(firestore, 'trips'), limit(BATCH_SIZE), startAfter(lastDoc))
      : query(collection(firestore, 'trips'), limit(BATCH_SIZE));

    const snapshot: QuerySnapshot<DocumentData> = await getDocs(q);
    if (snapshot.empty) break;

    const batch = writeBatch(firestore);
    let batchCount = 0;

    snapshot.forEach((tripDoc) => {
      const data = tripDoc.data();
      if (
        data.plannedRoute ||
        data.actualRoute ||
        data.optimizedOrder ||
        data.originalOrder
      ) {
        batch.update(tripDoc.ref, {
          plannedRoute: deleteField(),
          actualRoute: deleteField(),
          optimizedOrder: deleteField(),
          originalOrder: deleteField(),
        });
        batchCount++;
      }
    });

    if (batchCount > 0) {
      await batch.commit();
      total += batchCount;
      console.log(`Stripped bulky fields from ${total} trip documents so far`);
    }

    lastDoc = snapshot.docs[snapshot.docs.length - 1];
    if (snapshot.size < BATCH_SIZE) break;
  }

  console.log(`Done. Updated ${total} trip documents.`);
}

async function deleteLocationHistory(firestore: ReturnType<typeof getFirestore>) {
  const usersSnap = await getDocs(collection(firestore, 'location-history'));
  if (usersSnap.empty) {
    console.log('No location-history documents found.');
    return;
  }

  let deleted = 0;
  for (const userDoc of usersSnap.docs) {
    let lastLoc: DocumentSnapshot | null = null;
    while (true) {
      const locQuery: Query<DocumentData> = lastLoc
        ? query(collection(firestore, `location-history/${userDoc.id}/locations`), limit(BATCH_SIZE), startAfter(lastLoc))
        : query(collection(firestore, `location-history/${userDoc.id}/locations`), limit(BATCH_SIZE));

      const locSnap: QuerySnapshot<DocumentData> = await getDocs(locQuery);
      if (locSnap.empty) break;

      const batch = writeBatch(firestore);
      locSnap.forEach((locDoc) => batch.delete(locDoc.ref));
      await batch.commit();
      deleted += locSnap.size;

      lastLoc = locSnap.docs[locSnap.docs.length - 1];
      if (locSnap.size < BATCH_SIZE) break;
    }
    const userBatch = writeBatch(firestore);
    userBatch.delete(userDoc.ref);
    await userBatch.commit();
  }

  console.log(`Deleted ${deleted} location-history point documents.`);
}

async function main() {
  const email = process.env.MIGRATE_ADMIN_EMAIL;
  const password = process.env.MIGRATE_ADMIN_PASSWORD;

  if (!email || !password) {
    console.error('Set MIGRATE_ADMIN_EMAIL and MIGRATE_ADMIN_PASSWORD environment variables.');
    process.exit(1);
  }

  const app = initializeApp(firebaseConfig);
  const auth = getAuth(app);
  const firestore = getFirestore(app);

  await signInWithEmailAndPassword(auth, email, password);
  console.log('Authenticated. Starting migration...');

  await stripTripFields(firestore);
  await deleteLocationHistory(firestore);

  console.log('Migration complete.');
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

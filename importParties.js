import fs from "fs";
import axios from "axios";
import dotenv from "dotenv";

import { initializeApp } from "firebase/app";
import {
  getFirestore,
  collection,
  addDoc,
  serverTimestamp,
} from "firebase/firestore";

dotenv.config();

const firebaseConfig = {
  apiKey: process.env.EXPO_PUBLIC_FIREBASE_API_KEY,
  authDomain: process.env.EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN,
  databaseURL: process.env.EXPO_PUBLIC_FIREBASE_DATABASE_URL,
  projectId: process.env.EXPO_PUBLIC_FIREBASE_PROJECT_ID,
  storageBucket: process.env.EXPO_PUBLIC_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.EXPO_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.EXPO_PUBLIC_FIREBASE_APP_ID,
};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

const GOOGLE_API_KEY = process.env.EXPO_PUBLIC_GOOGLE_MAPS_API_KEY;
console.log("Google API Key:", GOOGLE_API_KEY);

const CREATED_BY = "GHRYEeNNJ2PDWjrxY7SiR1TIS7M2";

const places = JSON.parse(
  fs.readFileSync("./places.json", "utf8")
);

async function searchPlace(name) {
  try {
    const textSearch = await axios.post(
      "https://places.googleapis.com/v1/places:searchText",
      {
        textQuery: name,
      },
      {
        headers: {
          "Content-Type": "application/json",
          "X-Goog-Api-Key": GOOGLE_API_KEY,
          "X-Goog-FieldMask":
            "places.displayName,places.formattedAddress,places.location,places.id",
        },
      }
    );

    if (!textSearch.data.places?.length) {
      console.log("No result:", name);
      return null;
    }

    const place = textSearch.data.places[0];

    return {
      name: place.displayName.text,
      address: place.formattedAddress,
      latitude: place.location.latitude,
      longitude: place.location.longitude,
      phone: "",
    };
  } catch (e) {
    console.log("FAILED:", name);
    console.log(e.response?.data || e.message);
    return null;
  }
}

async function uploadParty(place) {
  try {
    console.log(place);

    const phoneNormalized =
      place.phone
        ? "+91" + place.phone.replace(/\D/g, "")
        : "";
    console.log(JSON.stringify(place, null, 2));
    const data = {
    name: `${place.partyNumber} ${place.name}`,
    address: place.address,
    latitude: place.latitude,
    longitude: place.longitude,
    phoneNumber: place.phone,
    phoneNumberNormalized: phoneNormalized,
    alternatePhone: "",
    ownerName: "",
    notes: "",
    category: "retail",
    customerUserId: null,
    createdBy: CREATED_BY,
    isApproved: true,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
    };

    console.log(data);

    await addDoc(collection(db, "parties"), data);

    console.log("Uploaded:", place.name);
  } catch (err) {
    console.log("UPLOAD FAILED");
    console.log(place);
    console.log(err);
    process.exit(1);
  }
}

async function run() {
  for (const p of places) {
    const info = await searchPlace(`${p.number} ${p.name}`);

    if (!info) {
    console.log("Skipped:", p.name);
    continue;
    }

    info.partyNumber = p.number;

    await uploadParty(info);

    await new Promise((r) => setTimeout(r, 300));
  }

  console.log("DONE");
}

run();
import { db } from "./lib/firebase";
import { ref, set } from "firebase/database";

async function testFirebase() {
  await set(ref(db, "test"), {
    message: "Firebase connected",
    timestamp: Date.now(),
  });

  console.log("Success");
}

testFirebase();
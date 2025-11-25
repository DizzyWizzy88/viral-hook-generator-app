import admin from "firebase-admin";

// Initialize Firebase Admin SDK (THIS IS THE PART WE ARE TESTING)
if (!admin.apps.length) {
  try {
    // This is where the Base64 decoding happens
    const encodedKey = process.env.FIREBASE_SERVICE_ACCOUNT_KEY;
    const decodedKeyString = Buffer.from(encodedKey, "base64").toString("utf8");
    const serviceAccount = JSON.parse(decodedKeyString);

    admin.initializeApp({
      credential: admin.credential.cert(serviceAccount),
    });
    console.log("FIREBASE INITIALIZATION SUCCESSFUL");
  } catch (error) {
    console.error("FIREBASE KEY ERROR:", error);
    throw new Error("Firebase Key Malformed or Invalid.");
  }
}

// Test function that only checks Firebase access, not Gemini
export default async (request, response) => {
  // This simple read confirms the key worked and Firestore is accessible
  try {
    const db = admin.firestore();
    await db.collection("rateLimits").doc("test").get();
    return response
      .status(200)
      .json({ hooks: ["Firebase Key Test Succeeded!"] });
  } catch (error) {
    // If the function reaches here but fails, the key has insufficient permissions
    console.error("FIREBASE PERMISSION ERROR:", error);
    return response
      .status(500)
      .json({ error: "Firebase Key Permissions Failed." });
  }
};

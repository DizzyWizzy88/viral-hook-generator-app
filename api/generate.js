// api/generate.js (Final Secure Version)

import { GoogleGenAI } from "@google/genai";
import admin from "firebase-admin";

// --- 1. Secure Firebase Initialization ---
// Vercel only initializes Firebase once, using the secure key
if (!admin.apps.length) {
  // Parse the JSON string from the Vercel environment variable
  const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_KEY);

  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
  });
}

const db = admin.firestore(); // Now you can access Firestore
const ai = new GoogleGenAI(process.env.GEMINI_API_KEY);

// --- 2. New Validation Function ---
async function checkProToken(token) {
  if (!token) return { isPro: false };

  try {
    // Look up the token in your 'tokens' collection in Firestore
    const doc = await db.collection("tokens").doc(token).get();

    if (doc.exists) {
      // Token is valid!
      return { isPro: true };
    }
    return { isPro: false };
  } catch (error) {
    console.error("Firestore lookup failed:", error);
    return { isPro: false }; // Treat failures as non-pro
  }
}

// --- 3. The Main Handler ---
export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method Not Allowed" });
  }

  const { topic, proToken } = req.body;

  // Check if user is Pro
  const { isPro } = await checkProToken(proToken);

  // NOTE: You would implement your FREE user limit check here,
  // ONLY if isPro is false. Since you're not doing usage tracking yet,
  // we'll skip the limit check for now and rely on the front-end limit.

  if (!topic) {
    return res.status(400).json({ error: "Missing topic in request body." });
  }

  try {
    const prompt = isPro
      ? `[PRO MODE] Generate 10 detailed hooks...`
      : `Generate 5 standard hooks...`;

    const result = await ai.models.generateContent({
      model: "gemini-2.5-flash",
      contents: prompt,
      config: { temperature: 0.8 },
    });

    const hooks = result.text
      .trim()
      .split("\n")
      .filter((h) => h.length > 0);

    return res.status(200).json({ hooks, isPro });
  } catch (error) {
    return res.status(500).json({ error: "Failed to generate hooks." });
  }
}

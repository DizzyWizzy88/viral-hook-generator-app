import { GoogleGenAI } from "@google/genai";
import admin from "firebase-admin";

// Initialize Firebase Admin SDK only once
if (!admin.apps.length) {
  try {
    const encodedKey = process.env.FIREBASE_SERVICE_ACCOUNT_KEY;
    // CRITICAL FIX: .trim() ensures no hidden whitespace breaks JSON.parse
    const decodedKeyString = Buffer.from(encodedKey, "base64").toString("utf8");
    const serviceAccount = JSON.parse(decodedKeyString.trim());

    admin.initializeApp({
      credential: admin.credential.cert(serviceAccount),
    });
  } catch (error) {
    console.error("Firebase initialization failed:", error);
    // Throw an error to ensure Vercel logs the runtime crash if the key is still bad
    throw new Error(
      "Firebase Initialization Error: Check FIREBASE_SERVICE_ACCOUNT_KEY Base64 format."
    );
  }
}

const db = admin.firestore();
const ai = new GoogleGenAI(process.env.GEMINI_API_KEY);

// --- Rate Limiting Configuration ---
const MAX_REQUESTS = 5; // Max requests allowed
const WINDOW_MINUTES = 1; // within this time window (in minutes)

export default async (request, response) => {
  // Basic method check
  if (request.method !== "POST") {
    return response.status(405).json({ error: "Method Not Allowed" });
  }

  const { topic } = request.body;
  if (!topic) {
    return response
      .status(400)
      .json({ error: "Missing 'topic' in request body." });
  }

  // 1. Get the user identifier (IP address)
  const userIp =
    request.headers["x-forwarded-for"] || request.socket.remoteAddress;
  const rateLimitRef = db.collection("rateLimits").doc(userIp);
  const now = Date.now();
  const windowStart = now - WINDOW_MINUTES * 60 * 1000; // 1 minute ago

  // --- RATE LIMIT CHECK & UPDATE (Inside a TRANSACTION) ---
  try {
    await db.runTransaction(async (t) => {
      const doc = await t.get(rateLimitRef);
      let requests = doc.exists ? doc.data().requests : [];

      // Remove old requests outside the window
      requests = requests.filter((timestamp) => timestamp > windowStart);

      if (requests.length >= MAX_REQUESTS) {
        // If over the limit, throw a custom error object to exit transaction
        const resetTime = new Date(requests[0] + WINDOW_MINUTES * 60 * 1000);

        throw {
          code: "rate-limit-exceeded",
          reset: resetTime.getTime(),
        };
      }

      // Record the new request
      requests.push(now);
      t.set(rateLimitRef, { requests });

      // Transaction succeeds here, allowing execution to proceed outside the block.
    });
  } catch (error) {
    if (error.code === "rate-limit-exceeded") {
      console.warn(`Rate limit exceeded for IP: ${userIp}`);
      // Return 429 response to the client
      return response.status(429).json({
        error: `Too Many Requests. Limit of ${MAX_REQUESTS} requests per ${WINDOW_MINUTES} minute(s) exceeded.`,
        retryAfter: error.reset,
      });
    }

    console.error("Server Error during Rate Limit Transaction:", error);
    // Log the actual server crash
    return response
      .status(500)
      .json({ error: "Internal Server Error during rate limit check." });
  }

  // --- GEMINI API CALL (Safely executed ONLY if rate limit passed) ---
  try {
    const prompt = `You are a social media virality expert. Generate 5 short, attention-grabbing video hooks for a vertical video app (like TikTok or Reels). The hooks must be under 15 words and related to the following topic: "${topic}". Format each hook on a new line.`;

    const result = await ai.models.generateContent({
      model: "gemini-2.5-flash",
      contents: prompt,
      config: {
        temperature: 0.8,
      },
    });

    const hooks = result.text
      .trim()
      .split("\n")
      .map((h) => h.trim())
      .filter((h) => h.length > 0);

    // Send the final successful response
    return response.status(200).json({ hooks });
  } catch (error) {
    console.error("Server Error during Gemini API call:", error);
    // Handle specific errors for the AI call
    return response
      .status(500)
      .json({ error: "Internal Server Error during hook generation." });
  }
};

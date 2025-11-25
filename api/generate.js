import { GoogleGenAI } from "@google/genai";
import admin from "firebase-admin";

// Initialize Firebase Admin SDK only once
if (!admin.apps.length) {
  try {
    const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_KEY);
    admin.initializeApp({
      credential: admin.credential.cert(serviceAccount),
    });
  } catch (error) {
    console.error("Firebase initialization failed:", error);
    // Fallback for local development or if key is just a placeholder
    admin.initializeApp();
  }
}

const db = admin.firestore();
const ai = new GoogleGenAI(process.env.GEMINI_API_KEY);

// --- Rate Limiting Configuration ---
const MAX_REQUESTS = 5; // Max requests allowed
const WINDOW_MINUTES = 1; // within this time window (in minutes)

export default async (request, response) => {
  if (request.method !== "POST") {
    return response.status(405).json({ error: "Method Not Allowed" });
  }

  // 1. Get the user identifier (IP address is the easiest for anonymous users)
  const userIp =
    request.headers["x-forwarded-for"] || request.socket.remoteAddress;
  const rateLimitRef = db.collection("rateLimits").doc(userIp);
  const now = Date.now();
  const windowStart = now - WINDOW_MINUTES * 60 * 1000; // 1 minute ago

  // --- RATE LIMIT CHECK ---
  try {
    await db.runTransaction(async (t) => {
      const doc = await t.get(rateLimitRef);
      let requests = doc.exists ? doc.data().requests : [];

      // Remove old requests outside the window
      requests = requests.filter((timestamp) => timestamp > windowStart);

      if (requests.length >= MAX_REQUESTS) {
        // If over the limit, throw an error to exit transaction
        const resetTime = new Date(requests[0] + WINDOW_MINUTES * 60 * 1000);

        // We use a custom object to carry the error info out of the transaction
        throw {
          code: "rate-limit-exceeded",
          reset: resetTime.getTime(),
        };
      }

      // Record the new request
      requests.push(now);
      t.set(rateLimitRef, { requests });

      // --- GEMINI API CALL (ONLY if rate limit is passed) ---
      const { topic } = request.body;
      if (!topic) {
        throw {
          code: "bad-request",
          message: "Missing 'topic' in request body.",
        };
      }

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

      // Send the response outside the transaction
      response.status(200).json({ hooks });
    });
  } catch (error) {
    if (error.code === "rate-limit-exceeded") {
      console.warn(`Rate limit exceeded for IP: ${userIp}`);
      return response.status(429).json({
        error: `Too Many Requests. Limit of ${MAX_REQUESTS} requests per ${WINDOW_MINUTES} minute(s) exceeded.`,
        retryAfter: error.reset,
      });
    }
    if (error.code === "bad-request") {
      return response.status(400).json({ error: error.message });
    }

    console.error("Server Error during API call or Rate Limit:", error);
    return response
      .status(500)
      .json({ error: "Internal Server Error during processing." });
  }
};

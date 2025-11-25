// This function would run on a secure server (e.g., a free Vercel or Netlify function)

const { GoogleGenAI } = require("@google/genai");
const ai = new GoogleGenAI(process.env.GEMINI_API_KEY);

exports.generateHook = async (request, response) => {
  // 1. Get the user's input (the topic)
  const { topic } = request.body;

  // 2. Define the specific AI prompt for the niche
  const prompt = `You are a social media virality expert. Generate 5 short, attention-grabbing video hooks for a vertical video app (like TikTok or Reels). The hooks must be under 15 words and related to the following topic: "${topic}". Format each hook on a new line.`;

  try {
    const result = await ai.models.generateContent({
      model: "gemini-2.5-flash",
      contents: prompt,
      config: {
        temperature: 0.8, // Higher temperature for creative outputs
      },
    });

    // 3. Send the generated text back to the user's browser
    response.status(200).json({
      hooks: result.text
        .trim()
        .split("\n")
        .filter((h) => h.length > 0),
    });
  } catch (error) {
    console.error("AI Generation Error:", error);
    response
      .status(500)
      .json({ error: "Failed to generate hooks. Please try again." });
  }
};

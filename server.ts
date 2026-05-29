import express from "express";
import path from "path";
import { fileURLToPath } from "url";
import { createServer as createViteServer } from "vite";
import { GoogleGenAI, Type } from "@google/genai";
import dotenv from "dotenv";

// Load environment variables
dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(express.json());

  let aiClient: GoogleGenAI | null = null;
  function getAIClient() {
    if (!aiClient) {
      const apiKey = process.env.GEMINI_API_KEY;
      if (!apiKey) {
        throw new Error("GEMINI_API_KEY environment variable is required to generate delay explanations.");
      }
      aiClient = new GoogleGenAI({
        apiKey,
        httpOptions: {
          headers: {
            "User-Agent": "aistudio-build",
          },
        },
      });
    }
    return aiClient;
  }

  // API endpoint to generate delay notification
  app.post("/api/generate", async (req, res) => {
    try {
      const { customerName, orderID, delayReason, updatedTimeline, severity, language } = req.body;

      if (!customerName || !delayReason) {
        return res.status(400).json({ error: "Customer Name and Delay Reason are required." });
      }

      const client = getAIClient();

      const timelineText = updatedTimeline && updatedTimeline.trim() !== "" 
        ? updatedTimeline 
        : "We will share a revised delivery estimate shortly.";

      const userPrompt = `
        Please generate shipment delay notification templates based on the following input:
        - Customer Name: ${customerName}
        - Order ID: ${orderID || "N/A"}
        - Delay Reason: ${delayReason}
        - Updated Expected Delivery: ${timelineText}
        - Incident Severity: ${severity || "Medium"}
        - Output Language: ${language || "English"}
      `;

      const systemInstruction = `You are an expert customer support and logistics communications coordinator.
Your job is to generate polite, empathetic, customer-facing notification templates for a delivery delay based on context.
You must return templates for three channels (Email, SMS, WhatsApp), each in two tones (Formal, Friendly), in the requested language (English, Hindi, or Telugu).

Rules:
1. Maintain a calm, empathetic, and professional tone.
2. Never blame the customer.
3. Clearly explain the delay reason in simple, clear, and reassuring language.
4. Apologize for the inconvenience.
5. Provide the updated expected delivery timeline. If no timeline is provided, use exactly: "We will share a revised delivery estimate shortly."
6. Ensure the SMS version is under 160 characters, extremely concise but functional and complete.
7. WhatsApp version can include relevant professional emojis (like 📦, 🚛, 🗓️, ⚠️) and formatting (like bolding key info *like this*).
8. The Email version must follow this exact block layout structure, adapted naturally to Hindi or Telugu if requested:

Customer Delay Update

Dear [Customer Name],

We would like to inform you that your shipment/order has been delayed due to [Delay Reason].

Our team is actively working to resolve the situation and ensure your package reaches you as soon as possible.

Updated Expected Delivery: [Updated Timeline]

We sincerely apologize for the inconvenience and appreciate your patience and understanding.

If you have any questions, please contact our support team.

Thank you for choosing our services.

Best Regards,
Customer Support Team

If the language is Hindi, translate all text respectfully and beautifully but keep the overall block structure and spacing. For Telugu, do the same with rich respectful Telugu terms. Ensure placeholders like name, order id, and timeline are properly populated or translated.`;

      const response = await client.models.generateContent({
        model: "gemini-3.5-flash",
        contents: userPrompt,
        config: {
          systemInstruction,
          responseMimeType: "application/json",
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              email: {
                type: Type.OBJECT,
                properties: {
                  formal: { type: Type.STRING, description: "Formal email version following the exact required structure." },
                  friendly: { type: Type.STRING, description: "Friendly email version following the exact required structure." }
                },
                required: ["formal", "friendly"]
              },
              sms: {
                type: Type.OBJECT,
                properties: {
                  formal: { type: Type.STRING, description: "Formal SMS notification, strictly under 160 characters." },
                  friendly: { type: Type.STRING, description: "Friendly SMS notification, strictly under 160 characters." }
                },
                required: ["formal", "friendly"]
              },
              whatsapp: {
                type: Type.OBJECT,
                properties: {
                  formal: { type: Type.STRING, description: "Formal WhatsApp notification, with markdown emphasis and polite tone." },
                  friendly: { type: Type.STRING, description: "Friendly WhatsApp notification with supportive emojis and supportive tone." }
                },
                required: ["formal", "friendly"]
              }
            },
            required: ["email", "sms", "whatsapp"]
          }
        }
      });

      const responseText = response.text;
      if (!responseText) {
        throw new Error("No response received from Gemini API.");
      }

      const parsedData = JSON.parse(responseText.trim());
      res.json(parsedData);

    } catch (error: any) {
      console.error("Generation error:", error);
      res.status(500).json({ error: error.message || "An unexpected error occurred during generation." });
    }
  });

  // Serve static assets or mount Vite dev middleware
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running at http://0.0.0.0:${PORT}`);
  });
}

startServer();

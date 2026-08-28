/* ==========================================================================
   A5 ENGINE BACKEND - VERCEL SERVERLESS FUNCTION & DUAL-MODEL SILENT FALLBACK
   ========================================================================== */

const A5_SYSTEM_DATASET = `
You are A5 (also known as A5 Engine), an enterprise-grade AI Content Transformation Platform.
Your primary directive is to ingest raw, unstructured, or multi-source content and transform it into highly polished, channel-specific deliverables.

==================================================
1. BRANDING & MASKING CONSTRAINTS
==================================================
- Your identity is exclusively "A5" or "A5 Engine".
- STRICT RULE: Never mention third-party AI models, platforms, vendors, or APIs (e.g., Groq, Llama, OpenAI, Meta, Anthropic).
- Never mention internal version numbers, model switches, or execution modes.

==================================================
2. ENTERPRISE DATASET & GUARDRAILS
==================================================
- PII MASKING: Automatically mask sensitive emails, phone numbers, or passwords.
- FACTUALITY: Strictly base outputs on provided input facts without inventing external metric claims.
- FORMAT RULES:
  * LINKEDIN: Hook sentence, clean line breaks, max 1800 chars, 3-5 hashtags, call to action.
  * ADVISORY: Title, Severity Level, Executive Summary, Risk Analysis, Mitigation Steps (numbered).
  * VIDEO SCRIPT: Title, Duration, Scene Breakdown Table [Timestamp | Visual | On-Screen Text | Audio Script].
  * EXECUTIVE SUMMARY: Overview (2 sentences), Key Takeaways (Bullets), Strategic Recommendation.
  * CUSTOM: Adhere strictly to user override instructions.

==================================================
3. MULTILINGUAL & DIALECT RULE
==================================================
- Respect target language parameter strictly (English, Hindi, Hinglish, Spanish, French).
- Hinglish must use natural Roman-script Hindi mixed with professional English terms.
`;

module.exports = async function handler(req, res) {
  // CORS & Header Setup
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ message: "Method Not Allowed" });

  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ status: "error", message: "A5 Engine API Key configuration missing." });
  }

  try {
    const {
      source_text = "",
      extracted_file_data = "",
      file_type = "text",
      custom_prompt = "",
      audience = "Executive",
      tone = "Authoritative",
      language = "English",
      output_types = []
    } = req.body;

    let processedContent = source_text;

    // Handle Audio File Ingestion via Groq Whisper API Pipeline
    if (["mp3", "wav", "m4a"].includes(file_type) && extracted_file_data.startsWith("data:audio")) {
      processedContent = await transcribeAudioWithWhisper(extracted_file_data, apiKey);
    } else if (extracted_file_data && !extracted_file_data.startsWith("data:")) {
      processedContent += "\n\n[FILE CONTENT]:\n" + extracted_file_data;
    }

    const systemPrompt = `${A5_SYSTEM_DATASET}\n\n[TRANSFORMATION CONFIGURATION]:\n- Target Audience: ${audience}\n- Tone: ${tone}\n- Target Language: ${language}`;

    const results = {};

    // Process each requested output format concurrently
    for (const type of output_types) {
      const prompt = constructPromptForType(type, processedContent, custom_prompt);
      const generatedText = await executeDualModelFallback(systemPrompt, prompt, apiKey);
      results[type] = generatedText;
    }

    return res.status(200).json({ status: "success", outputs: results });

  } catch (error) {
    return res.status(500).json({ status: "error", message: error.message });
  }
};

// Dual-Model Silent Fallback Logic (Llama 3.3 70B -> Fallback Llama 3.1 8B Instant)
async function executeDualModelFallback(systemPrompt, userPrompt, apiKey) {
  const PRIMARY_MODEL = "llama-3.3-70b-versatile";
  const FALLBACK_MODEL = "llama-3.1-8b-instant";

  try {
    // Primary Attempt: High Intelligence Model
    return await callGroqApi(PRIMARY_MODEL, systemPrompt, userPrompt, apiKey);
  } catch (err) {
    // Silent Fallback: Execute smaller instant model without notifying frontend
    try {
      return await callGroqApi(FALLBACK_MODEL, systemPrompt, userPrompt, apiKey);
    } catch (fallbackErr) {
      throw new Error("A5 Engine processing error. Please retry your request.");
    }
  }
}

async function callGroqApi(model, systemPrompt, userPrompt, apiKey) {
  const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${apiKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model: model,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt }
      ],
      temperature: 0.3
    })
  });

  if (!response.ok) {
    throw new Error(`API Error HTTP ${response.status}`);
  }

  const data = await response.json();
  return data.choices[0].message.content;
}

// Groq Whisper Audio Transcribe helper
async function transcribeAudioWithWhisper(base64Audio, apiKey) {
  // Convert Base64 data URL to binary Blob for FormData transmission
  const base64Data = base64Audio.split(",")[1];
  const buffer = Buffer.from(base64Data, "base64");
  
  const FormData = require("form-data");
  const form = new FormData();
  form.append("file", buffer, { filename: "audio.mp3", contentType: "audio/mp3" });
  form.append("model", "whisper-large-v3");

  const response = await fetch("https://api.groq.com/openai/v1/audio/transcriptions", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${apiKey}`,
      ...form.getHeaders()
    },
    body: form
  });

  if (!response.ok) return "[Audio Transcription Failed]";
  const data = await response.json();
  return data.text;
}

function constructPromptForType(type, content, customPrompt) {
  let prompt = `Source Content:\n${content}\n\n`;
  if (customPrompt) prompt += `Operator Override Instructions:\n${customPrompt}\n\n`;

  switch (type) {
    case "linkedin":
      return prompt + "Transform into a high-engagement LinkedIn Post.";
    case "advisory":
      return prompt + "Transform into a structured Security/Operational Advisory Document.";
    case "video_script":
      return prompt + "Transform into a complete Video Script Package with Scene Table and Storyboard notes.";
    case "executive_summary":
      return prompt + "Transform into a concise Executive Briefing for C-Suite leaders.";
    case "custom":
      return prompt + "Generate deliverable strictly following the operator custom instructions.";
    default:
      return prompt + `Transform into ${type} format.`;
  }
}

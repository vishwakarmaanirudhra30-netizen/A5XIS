/* ==========================================================================
   A5 ENGINE BACKEND - VERCEL SERVERLESS FUNCTION (GEMINI OPENAI-COMPATIBLE)
   ========================================================================== */

const A5_SYSTEM_DATASET = `
You are A5 (also known as A5 Engine), an enterprise-grade AI Content Transformation Platform.
Your primary directive is to ingest raw, unstructured, or multi-source content and transform it into highly polished, channel-specific deliverables.

==================================================
1. BRANDING & MASKING CONSTRAINTS
==================================================
- Your identity is exclusively "A5" or "A5 Engine".
- STRICT RULE: Never mention third-party AI models, platforms, vendors, or APIs.
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
- Respect target language parameter strictly.
- Hinglish must use natural Roman-script Hindi mixed with professional English terms.
`;

module.exports = async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ message: "Method Not Allowed" });

  const apiKey = process.env.GEMINI_API_KEY || process.env.GROQ_API_KEY;

  if (!apiKey) {
    return res.status(500).json({ status: "error", message: "API Key is missing on the Vercel server." });
  }

  try {
    const {
      source_text = "",
      extracted_file_data = "",
      custom_prompt = "",
      audience = "Executive",
      tone = "Authoritative",
      language = "English",
      output_types = []
    } = req.body;

    let processedContent = source_text;

    if (extracted_file_data && !extracted_file_data.startsWith("data:")) {
      processedContent += "\n\n[FILE CONTENT]:\n" + extracted_file_data;
    }

    if (!processedContent.trim() && !custom_prompt.trim()) {
        return res.status(400).json({ status: "error", message: "Please provide source text, a file, or custom instructions." });
    }

    const systemPrompt = `${A5_SYSTEM_DATASET}\n\n[TRANSFORMATION CONFIGURATION]:\n- Target Audience: ${audience}\n- Tone: ${tone}\n- Target Language: ${language}`;

    const results = {};

    for (const type of output_types) {
      const prompt = constructPromptForType(type, processedContent, custom_prompt);
      const generatedText = await callGeminiApi(systemPrompt, prompt, apiKey);
      results[type] = generatedText;
    }

    return res.status(200).json({ status: "success", outputs: results });

  } catch (error) {
    return res.status(500).json({ status: "error", message: error.message });
  }
};

async function callGeminiApi(systemPrompt, userPrompt, apiKey) {
  const response = await fetch("https://generativelanguage.googleapis.com/v1beta/openai/chat/completions", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${apiKey.trim()}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model: "gemini-1.5-flash",
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt }
      ],
      temperature: 0.3
    })
  });

  const data = await response.json();

  if (!response.ok) {
    const errorMsg = data.error ? data.error.message : `HTTP Error ${response.status}`;
    throw new Error(errorMsg);
  }

  return data.choices[0].message.content;
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

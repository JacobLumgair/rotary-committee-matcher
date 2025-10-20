// netlify/functions/match-committees.mjs
import OpenAI from "openai";

/**
 * POST body:
 * {
 *   member: { name, email, experiences, values, goals, reasons, interests: string[]|string },
 *   committees: [{ name, purpose, shortTermGoals: string[], longTermGoals: string[], work: string[], requirements: string[], skills: string[] }]
 * }
 */

export default async (req, context) => {
  // --- CORS / Preflight ---
  if (req.method === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: {
        "Access-Control-Allow-Origin": "*", // lock down later
        "Access-Control-Allow-Headers": "Content-Type",
        "Access-Control-Allow-Methods": "POST, OPTIONS",
      },
    });
  }

  if (req.method !== "POST") {
    return jsonResp({ error: "Method not allowed" }, 405);
  }

  // --- Parse / validate input ---
  let payload;
  try {
    payload = await req.json();
  } catch {
    return jsonResp({ error: "Invalid JSON" }, 400);
  }
  const { member, committees } = payload || {};
  if (!member || !Array.isArray(committees)) {
    return jsonResp({ error: "Missing member or committees" }, 400);
  }

  if (typeof member.interests === "string") {
    member.interests = member.interests.split(",").map(s => s.trim()).filter(Boolean);
  }

  // --- OpenAI client ---
  if (!process.env.OPENAI_API_KEY) {
    return jsonResp({ error: "Server misconfigured: missing OPENAI_API_KEY" }, 500);
  }
  const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

  // --- System guidance ---
  const system = `
You are a Rotary onboarding assistant.
Given a member profile and a committee catalog, pick the best 3 matches.
Be specific and encouraging, but concise. Use only the provided inputs.
Scoring: 0–100 (fit + availability + interests + skills).
Call-to-action should invite contacting the chair or visiting the committee page.
If information is missing, infer conservatively and stay helpful.
Do not address the member in third person, address them as if you are talking directly to them.
`;

  // --- Structured output schema (strict mode requires required[]=all properties) ---
  const jsonSchema = {
    type: "object",
    properties: {
      top_matches: {
        type: "array",
        maxItems: 3,
        items: {
          type: "object",
          properties: {
            committee_name: { type: "string" },
            score: { type: "number" }, // 0–100
            rationale: { type: "string" },
            call_to_action: { type: "string" },
            chair_contact_hint: { type: "string" }
          },
          required: [
            "committee_name",
            "score",
            "rationale",
            "call_to_action",
            "chair_contact_hint"   // <-- added
          ],
          additionalProperties: false
        }
      },
      summary_for_member: { type: "string" }
    },
    required: ["top_matches", "summary_for_member"],
    additionalProperties: false
  };

  const modelInput = { member, committees };

  try {
    const response = await client.responses.create({
      // If you hit a model support error for structured outputs, try: "gpt-4o-mini-2024-07-18"
      model: "gpt-4.1-mini",
      instructions: system,
      input: JSON.stringify(modelInput),
      temperature: 0.2,
      text: {
        format: {
          type: "json_schema",
          name: "CommitteeMatch",
          schema: jsonSchema,
          strict: true
        }
      }
    });

    const outText = response.output_text; // JSON string in this mode
    let body = outText;
    try { body = JSON.stringify(JSON.parse(outText)); } catch {}

    return new Response(body, {
      status: 200,
      headers: {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*"
      }
    });
  } catch (err) {
    console.error("OpenAI error", err);
    const msg =
      (err && err.error && err.error.message) ||
      (err && err.message) ||
      "AI match failed";
    return jsonResp({ error: "AI match failed", detail: msg }, 500);
  }
};

function jsonResp(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*"
    }
  });
}

// netlify/functions/match-committees.mjs
import OpenAI from "openai";

/**
 * Expected POST body:
 * {
 *   member: { name, email, experiences, values, goals, reasons, interests },
 *   committees: [ { name, purpose, shortTermGoals, longTermGoals, work, requirements, skills } ]
 * }
 */

export default async (req, context) => {
  if (req.method === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Headers": "Content-Type",
        "Access-Control-Allow-Methods": "POST, OPTIONS",
      },
    });
  }

  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers: { "Content-Type": "application/json" },
    });
  }

  let payload;
  try {
    payload = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: "Invalid JSON" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  const { member, committees } = payload || {};
  if (!member || !Array.isArray(committees)) {
    return new Response(JSON.stringify({ error: "Missing member or committees" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

  const schema = {
    name: "CommitteeMatch",
    schema: {
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
            required: ["committee_name", "score", "rationale", "call_to_action"]
          }
        },
        summary_for_member: { type: "string" }
      },
      required: ["top_matches", "summary_for_member"],
      additionalProperties: false
    },
    strict: true,
    // NOTE: Responses API json schema wrapper:
    // { type: "json_schema", json_schema: <this-object> }
  };

  const system = `
You are a Rotary onboarding assistant. 
Given a member profile and committee catalog, pick the best 3 matches.
Be specific and encouraging, but concise. Base reasons strictly on the inputs.
Scoring: 0–100 (fit + availability + interests + skills).
Call-to-action should invite contacting the chair or visiting the committee page.
`;

  // Compose a compact input object for the model:
  const modelInput = {
    member,
    committees
  };

  try {
    const response = await client.responses.create({
      model: "gpt-4.1-mini", // if you hit a model support error, try "gpt-4o-mini-2024-07-18"
      instructions: system,
      input: JSON.stringify(modelInput),
      temperature: 0.2,
      text: {
        format: {
          type: "json_schema",
          json_schema: schema, // { name, strict, schema: { ... } }
        },
      },
    });

    // Convenience helper returns the JSON string when response_format is JSON:
    const outText = response.output_text;
    return new Response(outText, {
      status: 200,
      headers: {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*"
      }
    });
  } catch (err) {
    console.error("OpenAI error", err);
    return new Response(JSON.stringify({ error: "AI match failed" }), {
      status: 500,
      headers: { "Content-Type": "application/json" }
    });
  }
};

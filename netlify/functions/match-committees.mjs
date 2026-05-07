// netlify/functions/match-committees.mjs
import OpenAI from "openai";

/**
 * POST body:
 * {
 *   member: {
 *     name,
 *     email,
 *     bringSkills,
 *     buildSkills,
 *     rotaryIdeas,
 *     availability,
 *     notWant,
 *     questionnaire
 *   },
 *   committees: [
 *     {
 *       name,
 *       purpose,
 *       shortTermGoals: string[],
 *       longTermGoals: string[],
 *       work: string[],
 *       requirements: string[],
 *       skills: string[]
 *     }
 *   ]
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

  const requiredMemberFields = [
    "name",
    "email",
    "bringSkills",
    "buildSkills",
    "rotaryIdeas",
    "availability",
    "notWant"
  ];

  const missingFields = requiredMemberFields.filter(field => {
    return !member[field] || !member[field].toString().trim();
  });

  if (missingFields.length) {
    return jsonResp({
      error: "Missing required member fields",
      missingFields
    }, 400);
  }

  if (!committees.length) {
    return jsonResp({ error: "No committees provided" }, 400);
  }

  // --- OpenAI client ---
  if (!process.env.OPENAI_API_KEY) {
    return jsonResp({ error: "Server misconfigured: missing OPENAI_API_KEY" }, 500);
  }

  const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

  // --- System guidance ---
  const system = `
You are a Rotary Waterloo committee placement assistant.

Your job is to recommend the best 3 committee matches for a Rotary member using only:
1. The member's questionnaire answers.
2. The provided committee catalog.

The member answered these questions:
- What skills, experiences, or perspectives would you like to bring to Rotary?
- What skills or experiences are you looking to build through Rotary?
- What would you like to see Rotary Waterloo do more of?
- What is your realistic time availability?
- Are there any types of committee work you'd prefer to avoid?

Scoring should consider:
- Skills, experiences, and perspectives the member wants to contribute.
- Skills or experiences the member wants to develop.
- Alignment between the member's Rotary interests and the committee's purpose/work.
- Time availability and the likely workload of the committee.
- Work the member specifically wants to avoid.

Important matching rules:
- Do not recommend a committee mainly because the member is good at something they said they want to avoid.
- If a member has limited availability, favour committees with flexible, occasional, or project-based work.
- If a member wants to build a skill, a committee can be a good match even if they are not already experienced in that area.
- If the provided committee catalog lacks details, infer conservatively.
- Use only the committees provided in the catalog.
- Pick exactly 3 matches unless fewer than 3 committees are provided.

Writing style:
- Be specific, encouraging, and concise.
- Address the member directly as "you."
- Do not refer to the member as "the member."
- Avoid generic fluff.
- Mention practical reasons for the match.
- The call-to-action should invite them to contact the chair, visit the committee page, or attend/observe a committee meeting.
`;

  // --- Structured output schema ---
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
            score: { type: "number" },
            rationale: { type: "string" },
            call_to_action: { type: "string" },
            chair_contact_hint: { type: "string" }
          },
          required: [
            "committee_name",
            "score",
            "rationale",
            "call_to_action",
            "chair_contact_hint"
          ],
          additionalProperties: false
        }
      },
      summary_for_member: { type: "string" }
    },
    required: ["top_matches", "summary_for_member"],
    additionalProperties: false
  };

  const modelInput = {
    member: {
      name: member.name,
      email: member.email,
      bringSkills: member.bringSkills,
      buildSkills: member.buildSkills,
      rotaryIdeas: member.rotaryIdeas,
      availability: member.availability,
      notWant: member.notWant,
      questionnaire: member.questionnaire || null
    },
    committees
  };

  try {
    const response = await client.responses.create({
      model: "gpt-5.4-nano",
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

    const outText = response.output_text;

    let body = outText;

    try {
      body = JSON.stringify(JSON.parse(outText));
    } catch {}

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
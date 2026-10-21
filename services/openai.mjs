const analysisSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    match_score: { type: "number" },
    campus_signal: { type: "integer" },
    confidence: { type: "number" },
    required_skills: { type: "array", items: { type: "string" } },
    preferred_skills: { type: "array", items: { type: "string" } },
    match_reasons: { type: "string" },
    skill_gaps: { type: "array", items: { type: "string" } },
    evidence: { type: "array", items: { type: "string" } }
  },
  required: ["match_score", "campus_signal", "confidence", "required_skills", "preferred_skills", "match_reasons", "skill_gaps", "evidence"]
};

export function openAIEnabled() { return Boolean(process.env.OPENAI_API_KEY); }

export async function analyzeJobWithOpenAI(job, profile) {
  if (!openAIEnabled()) throw new Error("OPENAI_API_KEY is not configured");
  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${process.env.OPENAI_API_KEY}` },
    body: JSON.stringify({
      model: process.env.OPENAI_MODEL || "gpt-4o-mini",
      instructions: "你是求职岗位分析助手。只根据输入的岗位文本和候选人 Profile 做保守判断，不编造经历。所有无法从输入确认的内容放入 skill_gaps 或 evidence。输出中文。",
      input: JSON.stringify({ job: { company: job.company, role: job.role, location: job.location, recruiting_type: job.recruiting_type, description: job.description }, profile: { skills: profile.skills || [], education: profile.education || [], experience: profile.experience || [], projects: profile.projects || [] } }),
      text: { format: { type: "json_schema", name: "job_analysis", description: "A conservative structured job fit analysis", strict: true, schema: analysisSchema } }
    })
  });
  const payload = await response.json();
  if (!response.ok) throw new Error(payload.error?.message || `OpenAI HTTP ${response.status}`);
  const result = JSON.parse(payload.output_text || "{}");
  return { ...result, model_name: process.env.OPENAI_MODEL || "gpt-4o-mini", provider: "openai-responses", raw_result: payload };
}

import { loadProfile, profileFields } from "../ats/profile.mjs";

const stopWords = new Set(["and", "the", "with", "for", "from", "this", "that", "you", "your", "our", "are", "will", "into", "role", "team"]);

export function analyzeJob(job, profilePath = process.env.PROFILE_PATH || "data/profile.yaml") {
  const profile = loadProfile(profilePath);
  const fields = profileFields(profile);
  const skills = (profile.skills || []).map(String).map((s) => s.toLowerCase());
  const text = `${job.role} ${job.description || ""}`.toLowerCase();
  const matched = skills.filter((skill) => text.includes(skill));
  const required = [...new Set((text.match(/[a-z][a-z0-9+.#-]{2,}/g) || []).filter((word) => !stopWords.has(word)))].slice(0, 18);
  const gaps = required.filter((word) => !skills.some((skill) => skill.includes(word) || word.includes(skill)));
  const campusSignal = /campus|new grad|graduate|intern|校招|实习|应届/i.test(`${job.role} ${job.description || ""}`) ? 1 : 0;
  const coverage = required.length ? matched.length / Math.min(required.length, 12) : 0;
  const score = Math.min(95, Math.round(coverage * 70 + matched.length * 4 + (campusSignal ? 10 : 0)));
  return { model_name: "local-rules-v1", match_score: score, campus_signal: campusSignal, confidence: Math.min(0.95, 0.55 + matched.length * 0.04), required_skills: required, preferred_skills: matched, match_reasons: `${matched.length ? `匹配技能：${matched.slice(0, 8).join("、")}。` : "暂未从岗位文本识别到 Profile 技能。"}${campusSignal ? "岗位文本包含校招/实习信号。" : "未识别到明确校招信号，需人工确认。"}`, skill_gaps: gaps.slice(0, 8), evidence: [`来源：${job.source_name || job.source_type || "manual"}`, `岗位文本长度：${(job.description || "").length}`, `Profile 技能数量：${skills.length}`], raw_result: { analyzer: "local-rules-v1", fields: { name: fields.name, preferred_work_location: fields.preferredWorkLocation } } };
}

export function validateAnalysis(result) {
  return Boolean(
    result &&
    Number.isFinite(result.match_score) && result.match_score >= 0 && result.match_score <= 100 &&
    [0, 1].includes(result.campus_signal) &&
    Number.isFinite(result.confidence) && result.confidence >= 0 && result.confidence <= 1 &&
    Array.isArray(result.required_skills) && Array.isArray(result.preferred_skills) &&
    Array.isArray(result.skill_gaps) && Array.isArray(result.evidence) &&
    typeof result.match_reasons === "string"
  );
}

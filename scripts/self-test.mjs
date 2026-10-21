import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { detectAts } from "../ats/detect.mjs";
import { parseSimpleYaml, profileFields } from "../ats/profile.mjs";
import { statuses, statusLabels } from "../db/statuses.mjs";
import { canonicalizeJobUrl, jobFingerprint, normalizeCompanyName, normalizeRoleName, parseImportText } from "../services/job-import.mjs";
import { analyzeJob } from "../services/analyze.mjs";
import { renderHtml } from "../services/resume.mjs";
import { workflowStage, workflowStages } from "../services/workflow.mjs";

assert.equal(detectAts("https://boards.greenhouse.io/acme/jobs/123"), "greenhouse");
assert.equal(detectAts("https://job-boards.greenhouse.io/acme/jobs/123"), "greenhouse");
assert.equal(detectAts("https://jobs.lever.co/acme/123"), "lever");
assert.equal(detectAts("https://example.com/jobs/123"), "generic");

const profile = parseSimpleYaml(`
basic:
  name: 王Cathy
  email: xxx@example.com
  phone: "xxx"
  location: "Beijing / Tokyo"
  identification: ""
  preferred_work_location: "Beijing"
social_accounts:
  github: https://github.com/example
self_evaluation:
  text: "Builder"
skills:
  - Python
  - Playwright
`);

assert.equal(profile.basic.name, "王Cathy");
assert.equal(profile.basic.phone, "xxx");
assert.deepEqual(profile.skills, ["Python", "Playwright"]);
assert.equal(profileFields(profile).email, "xxx@example.com");
assert.equal(profileFields(profile).preferredWorkLocation, "Beijing");
assert.equal(profileFields(profile).github, "https://github.com/example");
assert.equal(profileFields(profile).selfEvaluation, "Builder");
assert.ok(statuses.includes("submitted"));
assert.ok(statuses.includes("first_interview_invited"));
assert.equal(statusLabels.resume_editing, "简历已编辑待提交");
assert.equal(workflowStages.length, 7);
assert.equal(workflowStage({ review_status: "pending_review" }).key, "review");
assert.equal(workflowStage({ review_status: "confirmed", resume_count: 2 }).key, "resume");
assert.equal(workflowStage({ application_status: "submitted" }).key, "submitted");
assert.equal(workflowStage({ application_status: "first_interview_invited" }).key, "interview");
assert.equal(workflowStage({ application_status: "rejected" }).terminal, true);

assert.equal(
  canonicalizeJobUrl("https://Example.com/jobs/123/?utm_source=test&ref=feed#apply"),
  "https://example.com/jobs/123"
);
assert.equal(
  jobFingerprint({ company: "Acme", role: "AI Engineer", location: "Hong Kong", job_url: "https://example.com/jobs/1?utm_source=a" }),
  jobFingerprint({ company: " Acme ", role: "AI Engineer", location: "Hong Kong", job_url: "https://example.com/jobs/1?utm_source=b" })
);
assert.notEqual(
  jobFingerprint({ company: "Acme", role: "AI Engineer", job_url: "https://example.com/jobs" }),
  jobFingerprint({ company: "Acme", role: "Solutions Engineer", job_url: "https://example.com/jobs" })
);
assert.equal(parseImportText('[{"company":"Acme","role":"AI Intern","job_url":"https://example.com/1"}]').length, 1);
assert.equal(normalizeCompanyName("\u5b57\u8282"), "bytedance");
assert.equal(normalizeCompanyName("\u5b57\u8282\u8df3\u52a8\u6709\u9650\u516c\u53f8"), "bytedance");
assert.equal(normalizeCompanyName("ByteDance"), "bytedance");
assert.equal(normalizeRoleName(" AI  Engineer "), normalizeRoleName("AI-Engineer"));

const noMatchAnalysis = analyzeJob({ role: "Accountant", description: "Financial reporting and audit" }, profilePathForTest());
assert.ok(noMatchAnalysis.match_score < 35, "local rules must not assign a high baseline score without evidence");

const resumeHtml = renderHtml(
  { name: "Test", email: "a@example.com", phone: "1", location: "HK", selfEvaluation: "Builder" },
  { skills: ["Python"], projects: [{ name: "Other", bullets: ["Design"] }, { name: "Python Tool", bullets: ["Python automation"] }] },
  { company: "Acme", role: "Python Engineer", description: "Python automation" },
  "internal generation note"
);
assert.ok(resumeHtml.indexOf("Python Tool") < resumeHtml.indexOf("Other"), "job-relevant projects should be ordered first");
assert.doesNotMatch(resumeHtml, /Tailored for|internal generation note/, "internal generation metadata must not leak into the resume");

console.log("self-test ok");

function profilePathForTest() {
  return fileURLToPath(new URL("../data/profile.example.yaml", import.meta.url));
}

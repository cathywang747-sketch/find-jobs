import http from "node:http";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { all, q, run } from "../db/sqlite.mjs";
import { statuses, statusLabels } from "../db/statuses.mjs";
import { analyzeJob, validateAnalysis } from "../services/analyze.mjs";
import { analyzeJobWithOpenAI, openAIEnabled } from "../services/openai.mjs";
import { discoverWebJobs } from "../services/discovery.mjs";
import { previewJobUrl, parseImportText, canonicalizeJobUrl, jobFingerprint, normalizeCompanyName, normalizeRoleName, assertPublicHttpUrl } from "../services/job-import.mjs";
import { loadProfile } from "../ats/profile.mjs";
import { createResume, copyResumeArtifacts } from "../services/resume.mjs";
import { workflowStage, workflowStages } from "../services/workflow.mjs";
import { fillCurrentPage } from "../ats/index.mjs";
import { chromium } from "playwright";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const profilePath = process.env.PROFILE_PATH || path.join(root, "data/profile.yaml");
const port = Number(process.env.PORT || 4174);
const jobReviewStatuses = new Set(["pending_review", "confirmed", "rejected", "expired"]);
const taskTypes = new Set(["resume", "submit", "follow_up", "interview", "materials", "other"]);
const taskStatuses = new Set(["open", "done", "cancelled"]);
const taskPriorities = new Set(["normal", "important", "urgent"]);
const activeFillSessions = new Map();
const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host}`);
    const pathParts = url.pathname.split("/").filter(Boolean);
    if (url.pathname === "/api/statuses") return json(res, { statuses, statusLabels });
    if (url.pathname === "/api/dashboard/summary") return json(res, await summary());
    if (url.pathname === "/api/follow-ups" && req.method === "GET") return json(res, await listFollowUps(url.searchParams));
    if (url.pathname === "/api/jobs" && req.method === "GET") return json(res, await listJobs(url.searchParams));
    if (url.pathname === "/api/jobs" && req.method === "POST") { const job = await createJob(await body(req)); return json(res, job, job.duplicate ? 200 : 201); }
    if (url.pathname === "/api/jobs/import-url" && req.method === "POST") { const job = await importJob(await body(req)); return json(res, job, job.duplicate ? 200 : 201); }
    if (url.pathname === "/api/jobs/preview-url" && req.method === "POST") return json(res, await previewJobUrl((await body(req)).job_url));
    if (url.pathname === "/api/jobs/import-text" && req.method === "POST") return json(res, await importText(await body(req)), 201);
    if (url.pathname === "/api/notes" && req.method === "GET") return json(res, await listNotes());
    if (url.pathname === "/api/notes" && req.method === "POST") return json(res, await createNote(await body(req)), 201);
    if (url.pathname === "/api/sources" && req.method === "GET") return json(res, await all("SELECT * FROM job_sources ORDER BY enabled DESC, name"));
    if (url.pathname === "/api/sources" && req.method === "POST") return json(res, await createSource(await body(req)), 201);
    if (url.pathname === "/api/sources/collect" && req.method === "POST") return json(res, await collectSources(await body(req)));
    if (url.pathname === "/api/discovery/search" && req.method === "POST") return json(res, await discoverAndStore(await body(req)));
    if (url.pathname === "/api/resumes" && req.method === "GET") return json(res, await all("SELECT id,job_id,name,resume_type,tags,docx_path,pdf_path,usage_count,version_number,created_at FROM resume_versions ORDER BY created_at DESC,id DESC"));
    if (pathParts[0] === "api" && pathParts[1] === "jobs" && pathParts.length === 3 && req.method === "GET") return json(res, await jobDetail(Number(pathParts[2])));
    if (pathParts[0] === "api" && pathParts[1] === "jobs" && pathParts.length === 3 && req.method === "PATCH") return json(res, await updateJob(Number(pathParts[2]), await body(req)));
    if (pathParts[0] === "api" && pathParts[1] === "jobs" && pathParts.length === 3 && req.method === "DELETE") return json(res, await deleteJob(Number(pathParts[2])));
    if (pathParts[0] === "api" && pathParts[1] === "jobs" && pathParts[2] && pathParts[3] === "confirm" && req.method === "POST") return json(res, await reviewJob(Number(pathParts[2]), "confirmed"));
    if (pathParts[0] === "api" && pathParts[1] === "jobs" && pathParts[2] && pathParts[3] === "analyze" && req.method === "POST") return json(res, await analyze(Number(pathParts[2])));
    if (pathParts[0] === "api" && pathParts[1] === "jobs" && pathParts[2] && pathParts[3] === "resumes" && pathParts[4] === "generate" && req.method === "POST") return json(res, await generateResume(Number(pathParts[2]), await body(req)), 201);
    if (pathParts[0] === "api" && pathParts[1] === "jobs" && pathParts[2] && pathParts[3] === "resumes" && pathParts[4] === "reuse" && req.method === "POST") return json(res, await reuseResume(Number(pathParts[2]), await body(req)), 201);
    if (pathParts[0] === "api" && pathParts[1] === "jobs" && pathParts[2] && pathParts[3] === "reject" && req.method === "POST") return json(res, await rejectJob(Number(pathParts[2]), await body(req)));
    if (pathParts[0] === "api" && pathParts[1] === "jobs" && pathParts[2] && pathParts[3] === "restore-follow-up" && req.method === "POST") return json(res, await restoreFollowUp(Number(pathParts[2])));
    if (pathParts[0] === "api" && pathParts[1] === "jobs" && pathParts[2] && pathParts[3] === "convert-to-application" && req.method === "POST") return json(res, await convertJob(Number(pathParts[2]), await body(req)), 201);
    if (url.pathname === "/api/applications" && req.method === "GET") return json(res, await all("SELECT * FROM applications ORDER BY updated_at DESC, id DESC"));
    if (url.pathname === "/api/applications" && req.method === "POST") return json(res, await createApplication(await body(req)), 201);
    if (pathParts[0] === "api" && pathParts[1] === "applications" && pathParts[2] && pathParts[3] === "fill" && pathParts[4] === "close" && req.method === "POST") return json(res, await closeFillSession(Number(pathParts[2])));
    if (pathParts[0] === "api" && pathParts[1] === "applications" && pathParts[2] && pathParts[3] === "fill" && req.method === "POST") return json(res, await fillApplication(Number(pathParts[2]), await body(req)));
    if (pathParts[0] === "api" && pathParts[1] === "resumes" && pathParts[2] && pathParts[3] === "download" && req.method === "GET") return downloadResume(res, Number(pathParts[2]), pathParts[4]);
    if (url.pathname === "/api/tasks" && req.method === "GET") return json(res, await listTasks());
    if (url.pathname === "/api/tasks" && req.method === "POST") return json(res, await createTask(await body(req)), 201);
    if (pathParts[0] === "api" && pathParts[1] === "tasks" && pathParts[2] && req.method === "PATCH") return json(res, await updateTask(Number(pathParts[2]), await body(req)));
    if (pathParts[0] === "api" && pathParts[1] === "tasks" && pathParts[2] && req.method === "DELETE") return json(res, await deleteTask(Number(pathParts[2])));
    if (pathParts[0] === "api" && pathParts[1] === "notes" && pathParts[2] && req.method === "PATCH") return json(res, await updateNote(Number(pathParts[2]), await body(req)));
    if (pathParts[0] === "api" && pathParts[1] === "notes" && pathParts[2] && req.method === "DELETE") return json(res, await deleteNote(Number(pathParts[2])));
    const statusMatch = url.pathname.match(/^\/api\/applications\/(\d+)\/status$/);
    if (statusMatch && req.method === "PATCH") return json(res, await updateStatus(Number(statusMatch[1]), await body(req)));
    const eventsMatch = url.pathname.match(/^\/api\/applications\/(\d+)\/events$/);
    if (eventsMatch && req.method === "GET") return json(res, await listEvents(Number(eventsMatch[1])));
    if (eventsMatch && req.method === "POST") return json(res, await addEvent(Number(eventsMatch[1]), await body(req)), 201);
    return staticFile(res, url.pathname === "/" ? "/dashboard/index.html" : url.pathname);
  } catch (error) { json(res, { error: error.message }, httpStatusForError(error)); }
});
server.listen(port, "127.0.0.1", () => console.log(`http://127.0.0.1:${port}`));

async function summary() {
  const [jobs, pending, apps, interviews, tasks] = await Promise.all([
    all("SELECT COUNT(*) AS n FROM jobs"), all("SELECT COUNT(*) AS n FROM jobs WHERE review_status='pending_review'"),
    all("SELECT COUNT(*) AS n FROM applications WHERE status NOT IN ('offer','rejected','withdrawn','no_response','failed')"),
    all("SELECT COUNT(*) AS n FROM applications WHERE status LIKE '%interview%'"),
    all("SELECT COUNT(*) AS n FROM tasks WHERE status='open'")
  ]);
  return { jobs: jobs[0].n, pending_review: pending[0].n, active_applications: apps[0].n, interviews: interviews[0].n, open_tasks: tasks[0].n };
}
async function listJobs(params) {
  const where = [], values = [];
  if (params.get("keyword")) { const v = `%${params.get("keyword")}%`; where.push("(j.company LIKE ? OR j.role LIKE ? OR j.description LIKE ?)"); values.push(v, v, v); }
  if (params.get("status")) { where.push("j.review_status = ?"); values.push(params.get("status")); }
  if (params.get("source_category")) { where.push("j.source_category = ?"); values.push(params.get("source_category")); }
  if (params.get("company_type")) { where.push("j.company_type = ?"); values.push(params.get("company_type")); }
  if (params.get("recruiting_type")) { where.push("j.recruiting_type = ?"); values.push(params.get("recruiting_type")); }
  if (params.get("location")) { where.push("j.location LIKE ?"); values.push(`%${params.get("location")}%`); }
  if (params.get("source_type")) { where.push("j.source_type = ?"); values.push(params.get("source_type")); }
  if (params.get("match_min")) { const score = Number(params.get("match_min")); if (Number.isFinite(score)) { where.push("COALESCE(r.match_score, 0) >= ?"); values.push(score); } }
  if (params.get("application") === "yes") where.push("a.id IS NOT NULL");
  if (params.get("application") === "no") where.push("a.id IS NULL");
  if (params.get("saved") === "yes") where.push("j.is_saved = 1");
  if (params.get("saved") === "no") where.push("j.is_saved = 0");
  const applicationStage = params.get("application_stage");
  if (applicationStage === "preparing") where.push("a.status IN ('collected','matched','resume_editing','resume_ready')");
  if (applicationStage === "ready") where.push("a.status IN ('ready_to_submit','form_filled','waiting_review')");
  if (applicationStage === "submitted") where.push("a.status IN ('submitted','hr_contacted')");
  if (applicationStage === "interview") where.push("a.status LIKE '%interview%'");
  if (applicationStage === "closed") where.push("a.status IN ('offer','rejected','withdrawn','no_response','failed')");
  if (params.get("task") === "open") where.push("EXISTS (SELECT 1 FROM tasks tx WHERE tx.job_id=j.id AND tx.status='open')");
  if (params.get("task") === "overdue") where.push("EXISTS (SELECT 1 FROM tasks tx WHERE tx.job_id=j.id AND tx.status='open' AND tx.due_at IS NOT NULL AND datetime(tx.due_at)<datetime('now','localtime'))");
  if (params.get("task") === "no_next") where.push("NOT EXISTS (SELECT 1 FROM tasks tx WHERE tx.job_id=j.id AND tx.status='open')");
  if (params.get("recent_days")) { const days = Number(params.get("recent_days")); if (Number.isInteger(days) && days > 0 && days <= 365) { where.push("datetime(COALESCE(j.published_at, j.discovered_at)) >= datetime('now', ?)"); values.push(`-${days} days`); } }
  const sort = {
    id_desc: "j.id DESC",
    newest: "j.discovered_at DESC, j.id DESC",
    match_desc: "COALESCE(r.match_score, -1) DESC, j.id DESC",
    deadline_asc: "j.deadline IS NULL, j.deadline ASC, j.id DESC"
  }[params.get("sort")] || "j.id DESC";
  const sql = `SELECT j.*, r.match_score, r.campus_signal, a.id AS application_id, a.status AS application_status,
    (SELECT COUNT(*) FROM tasks tx WHERE tx.job_id=j.id AND tx.status='open') AS open_task_count,
    (SELECT MIN(tx.due_at) FROM tasks tx WHERE tx.job_id=j.id AND tx.status='open' AND tx.due_at IS NOT NULL) AS next_task_due
    FROM jobs j
    LEFT JOIN job_ai_reviews r ON r.id=(SELECT MAX(id) FROM job_ai_reviews WHERE job_id=j.id)
    LEFT JOIN applications a ON a.job_id=j.id
    ${where.length ? `WHERE ${where.join(" AND ")}` : ""} ORDER BY ${sort}`;
  return all(sql.replaceAll("?", () => q(values.shift())));
}
async function listNotes() {
  return all("SELECT * FROM notes ORDER BY is_pinned DESC, updated_at DESC, id DESC");
}
async function createNote(data) {
  const title = String(data.title || "").trim() || "未命名笔记";
  const content = String(data.content || "");
  await run(`INSERT INTO notes (title,content,is_pinned) VALUES (${q(title)},${q(content)},${booleanFlag(data.is_pinned)})`);
  return (await all("SELECT * FROM notes ORDER BY id DESC LIMIT 1"))[0];
}
async function updateNote(id, data) {
  const [existing] = await all(`SELECT * FROM notes WHERE id=${id}`);
  if (!existing) throw new Error("Note not found");
  const updates = [];
  if (data.title !== undefined) updates.push(`title=${q(String(data.title).trim() || "未命名笔记")}`);
  if (data.content !== undefined) updates.push(`content=${q(String(data.content || ""))}`);
  if (data.is_pinned !== undefined) updates.push(`is_pinned=${booleanFlag(data.is_pinned)}`);
  if (!updates.length) return existing;
  await run(`UPDATE notes SET ${updates.join(",")},updated_at=CURRENT_TIMESTAMP WHERE id=${id}`);
  return (await all(`SELECT * FROM notes WHERE id=${id}`))[0];
}
async function deleteNote(id) {
  const [existing] = await all(`SELECT id FROM notes WHERE id=${id}`);
  if (!existing) throw new Error("Note not found");
  await run(`DELETE FROM notes WHERE id=${id}`);
  return { deleted: true, id };
}
async function createJob(data) {
  if (!data.company || !data.role || !data.job_url) throw new Error("company, role and job_url are required");
  const normalized = normalizeJob(data);
  const duplicate = await findDuplicateJob(normalized);
  if (duplicate) return { ...duplicate.job, duplicate: true, duplicate_reason: duplicate.reason };
  await run(jobInsertSql(normalized));
  return (await all("SELECT * FROM jobs ORDER BY id DESC LIMIT 1"))[0];
}
function jobInsertSql(data) { return `INSERT INTO jobs (company,role,job_url,application_url,canonical_url,company_key,role_key,fingerprint,source_name,source_type,source_category,company_type,location,work_mode,employment_type,recruiting_type,description,published_at,deadline,review_status,notes) VALUES (${q(data.company)},${q(data.role)},${q(data.job_url)},${q(data.application_url)},${q(data.canonical_url || data.job_url)},${q(data.company_key)},${q(data.role_key)},${q(data.fingerprint)},${q(data.source_name || "人工导入")},${q(data.source_type || "manual")},${q(data.source_category || "其他/待确认")},${q(data.company_type)},${q(data.location)},${q(data.work_mode)},${q(data.employment_type)},${q(data.recruiting_type)},${q(data.description)},${q(data.published_at)},${q(data.deadline)},'pending_review',${q(data.notes)})`; }
function normalizeJob(data) {
  const jobUrl = String(data.job_url).trim();
  let canonicalUrl;
  try {
    const parsedJobUrl = new URL(jobUrl);
    if (!new Set(["http:", "https:", "manual:"]).has(parsedJobUrl.protocol)) throw new Error();
    canonicalUrl = canonicalizeJobUrl(data.canonical_url || jobUrl);
    if (data.application_url && !new Set(["http:", "https:"]).has(new URL(String(data.application_url)).protocol)) throw new Error();
  }
  catch { throw new Error("岗位链接必须是有效 URL，申请链接如填写则必须使用 http:// 或 https://"); }
  const normalized = {
    ...data,
    company: String(data.company).trim(),
    role: String(data.role).trim(),
    job_url: jobUrl,
    application_url: data.application_url ? String(data.application_url).trim() : null,
    canonical_url: canonicalUrl,
    company_key: normalizeCompanyName(data.company),
    role_key: normalizeRoleName(data.role)
  };
  normalized.fingerprint = data.fingerprint || jobFingerprint(normalized);
  return normalized;
}
async function findDuplicateJob(data, excludeId = null) {
  const notSelf = excludeId ? ` AND id<>${Number(excludeId)}` : "";
  const [sameUrl] = await all(`SELECT * FROM jobs WHERE canonical_url=${q(data.canonical_url)}${notSelf} ORDER BY id DESC LIMIT 1`);
  if (sameUrl) return { job: sameUrl, reason: "same_url" };
  const [sameIdentity] = await all(`SELECT * FROM jobs WHERE company_key=${q(data.company_key)} AND role_key=${q(data.role_key)}${notSelf} ORDER BY id DESC LIMIT 1`);
  return sameIdentity ? { job: sameIdentity, reason: "same_company_and_role" } : null;
}
async function discoverAndStore(data) {
  if (process.env.ENABLE_WEB_DISCOVERY !== "true") throw new Error("全网 Web Search 已关闭；测试阶段请使用 ChatGPT 粘贴导入。需要启用时设置 ENABLE_WEB_DISCOVERY=true");
  const discovered = await discoverWebJobs(data);
  const results = [];
  for (const job of discovered.jobs) {
    try { const stored = await createJob({ ...job, source_name: "OpenAI Web Search", source_type: "web_search", notes: `evidence: ${(job.evidence || []).join(" ")}` }); results.push({ role: job.role, company: job.company, created: !stored.duplicate, duplicate: Boolean(stored.duplicate), existing_job_id: stored.duplicate ? stored.id : undefined }); }
    catch (error) { results.push({ role: job.role, company: job.company, created: false, duplicate: /UNIQUE/.test(error.message), error: /UNIQUE/.test(error.message) ? undefined : error.message }); }
  }
  return { provider: "openai-web-search", query: discovered.query, model: discovered.model, discovered: discovered.jobs.length, results };
}
async function importJob(data) {
  const url = data.job_url || data.url; if (!url) throw new Error("job_url is required");
  const extracted = await previewJobUrl(url);
  const host = new URL(url).hostname;
  return createJob({ ...extracted, ...data, job_url: url, application_url: data.application_url || extracted.application_url || url, source_name: data.source_name || host, source_type: extracted.source_type || (host.includes("greenhouse") ? "greenhouse" : host.includes("lever") ? "lever" : "generic"), source_category: data.source_category || "其他/待确认", role: data.role || extracted.role || "待解析岗位", company: data.company || extracted.company || host.replace(/^(www|jobs|careers|career)\./, "").split(".")[0] });
}
async function importText(data) {
  const items = parseImportText(data.text || data.content);
  if (!items.length) throw new Error("未识别到岗位数据。请粘贴 JSON 数组、{jobs:[...]}，或包含公司/职位/岗位链接字段的文本。");
  const results = [];
  for (const item of items) {
    try {
      const hasStructuredFields = item.company && item.role && (item.job_url || item.url);
      const job = hasStructuredFields
        ? await createJob({ ...item, job_url: item.job_url || item.url, application_url: item.application_url || item.job_url || item.url, source_name: item.source_name || "ChatGPT 手动整理", source_type: item.source_type || "manual", source_category: item.source_category || "其他/待确认" })
        : item.job_url || item.url
          ? await importJob(item)
          : await createJob({ ...item, job_url: `manual://chatgpt-${Date.now()}-${results.length}`, source_name: "ChatGPT 手动整理", source_type: "manual", source_category: item.source_category || "其他/待确认" });
      results.push({ created: !job.duplicate, duplicate: Boolean(job.duplicate), existing_job_id: job.duplicate ? job.id : undefined, job });
    } catch (error) { results.push({ created: false, duplicate: /UNIQUE/.test(error.message), error: error.message, item }); }
  }
  return { total: items.length, created: results.filter((item) => item.created).length, results };
}
async function createSource(data) {
  if (!data.name || !data.source_type) throw new Error("name and source_type are required");
  await run(`INSERT INTO job_sources (name,source_type,base_url,keywords,enabled) VALUES (${q(data.name)},${q(data.source_type)},${q(data.base_url)},${q(data.keywords)},${data.enabled === false ? 0 : 1})`);
  return (await all("SELECT * FROM job_sources ORDER BY id DESC LIMIT 1"))[0];
}
async function collectSources(options = {}) {
  const sources = await all("SELECT * FROM job_sources WHERE enabled=1");
  const results = [];
  for (const source of sources) {
    try {
      const jobs = source.source_type === "greenhouse" ? await collectGreenhouse(source) : source.source_type === "lever" ? await collectLever(source) : [];
      for (const job of jobs) {
        try { const stored = await createJob({ ...job, source_name: source.name, source_type: source.source_type, source_category: "公司官网" }); results.push({ source: source.name, role: job.role, created: !stored.duplicate, duplicate: Boolean(stored.duplicate), existing_job_id: stored.duplicate ? stored.id : undefined }); } catch (error) { if (!/UNIQUE/.test(error.message)) throw error; results.push({ source: source.name, role: job.role, created: false, duplicate: true }); }
      }
      await run(`UPDATE job_sources SET last_crawled_at=CURRENT_TIMESTAMP,last_error=NULL WHERE id=${source.id}`);
    } catch (error) { await run(`UPDATE job_sources SET last_crawled_at=CURRENT_TIMESTAMP,last_error=${q(error.message)} WHERE id=${source.id}`); results.push({ source: source.name, error: error.message }); }
  }
  return { sources: sources.length, results };
}
async function collectGreenhouse(source) {
  const board = new URL(source.base_url).pathname.split("/").filter(Boolean).pop();
  const response = await fetch(`https://boards-api.greenhouse.io/v1/boards/${board}/jobs?content=true`);
  if (!response.ok) throw new Error(`Greenhouse HTTP ${response.status}`);
  const data = await response.json();
  return (data.jobs || []).filter((job) => matchesKeywords(`${job.title} ${job.content}`, source.keywords)).map((job) => ({ company: source.name, role: job.title, job_url: job.absolute_url, application_url: job.absolute_url, location: job.location?.name, description: stripHtml(job.content), published_at: job.updated_at }));
}
async function collectLever(source) {
  const board = new URL(source.base_url).pathname.split("/").filter(Boolean).pop();
  const response = await fetch(`https://api.lever.co/v0/postings/${board}?mode=json`);
  if (!response.ok) throw new Error(`Lever HTTP ${response.status}`);
  const data = await response.json();
  return (data || []).filter((job) => matchesKeywords(`${job.text} ${job.descriptionPlain}`, source.keywords)).map((job) => ({ company: source.name, role: job.text, job_url: job.hostedUrl, application_url: job.applyUrl || job.hostedUrl, location: job.categories?.location, description: job.descriptionPlain }));
}
function stripHtml(value) { return String(value || "").replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim(); }
function matchesKeywords(text, rawKeywords) {
  const keywords = String(rawKeywords || "").split(/[\n,，;；|]+/).map((item) => item.trim().toLowerCase()).filter(Boolean);
  if (!keywords.length) return true;
  const normalized = String(text || "").toLowerCase();
  return keywords.some((keyword) => normalized.includes(keyword));
}
async function analyze(id) {
  const [job] = await all(`SELECT * FROM jobs WHERE id=${id}`); if (!job) throw new Error("Job not found");
  const result = openAIEnabled() ? await analyzeJobWithOpenAI(job, loadProfile(profilePath)) : { ...analyzeJob(job, profilePath), provider: "local-rules" };
  if (!validateAnalysis(result)) throw new Error("Analysis schema validation failed");
  await run(`INSERT INTO job_ai_reviews (job_id,model_name,match_score,campus_signal,confidence,required_skills,preferred_skills,match_reasons,skill_gaps,evidence,raw_result) VALUES (${id},${q(result.model_name)},${result.match_score},${result.campus_signal},${result.confidence},${q(JSON.stringify(result.required_skills))},${q(JSON.stringify(result.preferred_skills))},${q(result.match_reasons)},${q(JSON.stringify(result.skill_gaps))},${q(JSON.stringify(result.evidence))},${q(JSON.stringify(result.raw_result))})`);
  return jobDetail(id);
}
async function generateResume(id, data) {
  const [job] = await all(`SELECT * FROM jobs WHERE id=${id}`); if (!job) throw new Error("Job not found");
  const generated = await createResume({ job, name: data.name, generationNotes: data.generation_notes });
  const profileSnapshot = JSON.stringify(generated.version.profile_snapshot);
  await run(`INSERT INTO resume_versions (job_id,name,resume_type,tags,profile_snapshot,job_snapshot,generation_notes,docx_path,pdf_path,version_number) VALUES (${id},${q(generated.version.name)},'tailored',${q(JSON.stringify(generated.version.tags))},${q(profileSnapshot)},${q(JSON.stringify(generated.version.job_snapshot))},${q(generated.version.generation_notes)},${q(generated.version.docx_path)},${q(generated.version.pdf_path)},COALESCE((SELECT MAX(version_number)+1 FROM resume_versions WHERE job_id=${id}),1))`);
  return (await all("SELECT * FROM resume_versions ORDER BY id DESC LIMIT 1"))[0];
}
async function reuseResume(id, data) {
  const [source] = await all(`SELECT * FROM resume_versions WHERE id=${Number(data.resume_version_id)}`); if (!source) throw new Error("Resume version not found");
  const [job] = await all(`SELECT * FROM jobs WHERE id=${id}`); if (!job) throw new Error("Job not found");
  const copied = await copyResumeArtifacts({ source, job, name: data.name });
  await run(`INSERT INTO resume_versions (job_id,parent_resume_id,name,resume_type,tags,profile_snapshot,job_snapshot,generation_notes,docx_path,pdf_path,version_number) VALUES (${id},${source.id},${q(copied.name)},'tailored',${q(JSON.stringify(copied.tags))},${q(JSON.stringify(copied.profile_snapshot))},${q(JSON.stringify(copied.job_snapshot))},${q(copied.generation_notes)},${q(copied.docx_path)},${q(copied.pdf_path)},COALESCE((SELECT MAX(version_number)+1 FROM resume_versions WHERE job_id=${id}),1))`);
  return (await all("SELECT * FROM resume_versions ORDER BY id DESC LIMIT 1"))[0];
}
async function fillApplication(id, data) {
  const [app] = await all(`SELECT * FROM applications WHERE id=${id}`); if (!app) throw new Error("Application not found");
  const targetUrl = data.url || app.application_url || app.job_url; if (!targetUrl || !/^https?:/i.test(targetUrl)) throw new Error("A public application URL is required");
  await assertPublicHttpUrl(targetUrl);
  const resume = await resolveResumeForApplication(app, data.resume_version_id);
  const resumePath = path.resolve(root, resume.pdf_path || resume.docx_path);
  if (!isInsideRoot(resumePath)) throw new Error("Resume artifact path is outside the project");
  await fs.access(resumePath);
  await closeFillSession(id);
  const headless = data.headless === true;
  const browser = await chromium.launch({ channel: "chrome", headless });
  let keepOpen = false;
  try {
    const page = await browser.newPage();
    await page.goto(targetUrl, { waitUntil: "domcontentloaded", timeout: 30000 });
    const result = await fillCurrentPage(page, { profilePath, resumePath });
    const screenshot = path.join(root, "artifacts", "screenshots", `application-${id}-${Date.now()}.png`);
    await fs.mkdir(path.dirname(screenshot), { recursive: true }); await page.screenshot({ path: screenshot, fullPage: true });
    const screenshotPath = `artifacts/screenshots/${path.basename(screenshot)}`;
    const nextStatus = result.ok ? "waiting_review" : "failed";
    await bindResumeToApplication(app, resume.id);
    await run(`UPDATE applications SET screenshot_path=${q(screenshotPath)},last_error=${q(result.ok ? null : JSON.stringify(result.safety || result.fill?.skipped || []))} WHERE id=${id}`);
    if (app.status === nextStatus) {
      await addEvent(id, { event_type: "fill_completed", status_from: app.status, status_to: app.status, message: result.ok ? "再次完成自动填表，等待人工确认" : "自动填表再次被安全边界阻止", screenshot_path: screenshotPath, payload: JSON.stringify(result) });
    } else {
      await updateStatus(id, { status: nextStatus, message: result.ok ? "自动填表已完成，浏览器保持打开，等待人工检查和提交" : "自动填表被安全边界阻止", screenshot_path: screenshotPath, payload: result });
    }
    if (!headless) {
      keepOpen = true;
      activeFillSessions.set(id, { browser, page });
      browser.on("disconnected", () => activeFillSessions.delete(id));
    }
    return { ...result, resume_version_id: resume.id, screenshot_path: screenshotPath, session_open: !headless };
  } finally {
    if (!keepOpen) await browser.close().catch(() => {});
  }
}
async function closeFillSession(id) {
  const session = activeFillSessions.get(id);
  if (!session) return { closed: false };
  activeFillSessions.delete(id);
  await session.browser.close().catch(() => {});
  return { closed: true };
}
async function resolveResumeForApplication(app, requestedId) {
  const resumeId = Number(requestedId || app.resume_version_id || 0);
  let resume;
  if (resumeId) [resume] = await all(`SELECT * FROM resume_versions WHERE id=${resumeId}`);
  if (!resume && app.job_id) [resume] = await all(`SELECT * FROM resume_versions WHERE job_id=${app.job_id} AND (pdf_path IS NOT NULL OR docx_path IS NOT NULL) ORDER BY id DESC LIMIT 1`);
  if (!resume) throw new Error("请先为该岗位生成或复用一份简历，再启动自动填表");
  if (app.job_id && resume.job_id && Number(resume.job_id) !== Number(app.job_id)) throw new Error("所选简历不属于当前岗位，请先使用“复用简历”创建岗位版本");
  return resume;
}
async function bindResumeToApplication(app, resumeId) {
  if (Number(app.resume_version_id) === Number(resumeId)) return;
  await run(`UPDATE applications SET resume_version_id=${resumeId} WHERE id=${app.id}; UPDATE resume_versions SET usage_count=usage_count+1 WHERE id=${resumeId};`);
}
async function jobDetail(id) {
  const [job] = await all(`SELECT j.*, r.match_score, r.campus_signal, r.confidence, r.required_skills, r.preferred_skills, r.match_reasons, r.skill_gaps, a.id AS application_id, a.status AS application_status FROM jobs j LEFT JOIN job_ai_reviews r ON r.id=(SELECT MAX(id) FROM job_ai_reviews WHERE job_id=j.id) LEFT JOIN applications a ON a.job_id=j.id WHERE j.id=${id}`);
  if (!job) throw new Error("Job not found");
  return {
    job,
    applications: await all(`SELECT * FROM applications WHERE job_id=${id}`),
    resumes: await all(`SELECT * FROM resume_versions WHERE job_id=${id} ORDER BY id DESC`),
    tasks: await all(`SELECT * FROM tasks WHERE job_id=${id} ORDER BY status='open' DESC,due_at IS NULL,due_at,id DESC`)
  };
}
async function reviewJob(id, status) { if (!jobReviewStatuses.has(status)) throw new Error("Invalid job review status"); const [job] = await all(`SELECT id FROM jobs WHERE id=${id}`); if (!job) throw new Error("Job not found"); const [application] = await all(`SELECT id FROM applications WHERE job_id=${id} LIMIT 1`); if (application) throw new Error("该岗位已经进入投递流程，请在岗位进展中更新投递状态"); await run(`UPDATE jobs SET review_status=${q(status)},rejection_reason=NULL,updated_at=CURRENT_TIMESTAMP WHERE id=${id}`); return jobDetail(id); }
async function updateJob(id, data) {
  const [existing] = await all(`SELECT * FROM jobs WHERE id=${id}`); if (!existing) throw new Error("Job not found");
  if (data.review_status !== undefined && !jobReviewStatuses.has(data.review_status)) throw new Error("Invalid job review status");
  if (data.review_status !== undefined) {
    const [application] = await all(`SELECT id FROM applications WHERE job_id=${id} LIMIT 1`);
    if (application && data.review_status !== existing.review_status) throw new Error("该岗位已经进入投递流程，岗位审核状态不能再修改");
  }
  const allowed = ["company","role","job_url","application_url","source_name","source_type","source_category","company_type","location","work_mode","employment_type","recruiting_type","description","published_at","deadline","notes","review_status","is_saved"];
  const changed = allowed.some((key) => data[key] !== undefined);
  if (!changed) return jobDetail(id);
  const updates = Object.fromEntries(allowed.filter((key) => data[key] !== undefined).map((key) => [key, key === "is_saved" ? booleanFlag(data[key]) : data[key]]));
  const merged = { ...existing, ...updates, fingerprint: undefined };
  const normalized = normalizeJob(merged);
  if (data.job_url !== undefined || data.company !== undefined || data.role !== undefined) {
    const duplicate = await findDuplicateJob(normalized, id);
    if (duplicate) throw new Error(`该修改会与岗位 #${duplicate.job.id} 重复；请保留其中一条岗位记录。`);
  }
  const sets = allowed.filter((key) => data[key] !== undefined).map((key) => `${key}=${key === "is_saved" ? updates[key] : q(normalized[key])}`);
  if (data.job_url !== undefined || data.company !== undefined || data.role !== undefined || data.location !== undefined) sets.push(`canonical_url=${q(normalized.canonical_url)}`, `fingerprint=${q(normalized.fingerprint)}`);
  if (data.company !== undefined || data.role !== undefined) sets.push(`company_key=${q(normalized.company_key)}`, `role_key=${q(normalized.role_key)}`);
  if (sets.length) await run(`UPDATE jobs SET ${sets.join(",")},updated_at=CURRENT_TIMESTAMP WHERE id=${id}`);
  return jobDetail(id);
}
async function deleteJob(id) {
  const [job] = await all(`SELECT id, company, role, review_status FROM jobs WHERE id=${id}`); if (!job) throw new Error("Job not found");
  const [application] = await all(`SELECT id FROM applications WHERE job_id=${id} LIMIT 1`);
  const [resume] = await all(`SELECT id FROM resume_versions WHERE job_id=${id} LIMIT 1`);
  const [task] = await all(`SELECT id FROM tasks WHERE job_id=${id} LIMIT 1`);
  if ((application || resume || task) && job.review_status !== "rejected") throw new Error("该岗位仍在使用中。请先停止跟进并排除岗位，再执行彻底删除。");
  if (application) {
    const [app] = await all(`SELECT status FROM applications WHERE id=${application.id}`);
    if (app.status !== "withdrawn") throw new Error("已关联投递记录的岗位必须先停止跟进并排除，才能彻底删除。");
  }
  const [{ count: taskCount = 0 } = {}] = await all(`SELECT COUNT(*) AS count FROM tasks WHERE job_id=${id}`);
  const [{ count: resumeCount = 0 } = {}] = await all(`SELECT COUNT(*) AS count FROM resume_versions WHERE job_id=${id}`);
  await run(`DELETE FROM tasks WHERE job_id=${id}; DELETE FROM applications WHERE job_id=${id}; UPDATE resume_versions SET job_id=NULL WHERE job_id=${id}; DELETE FROM jobs WHERE id=${id};`);
  return { deleted: true, id, company: job.company, role: job.role, removed_tasks: taskCount, preserved_resumes: resumeCount, removed_application: Boolean(application) };
}
async function rejectJob(id, data = {}) {
  const [job] = await all(`SELECT * FROM jobs WHERE id=${id}`);
  if (!job) throw new Error("Job not found");
  const [application] = await all(`SELECT * FROM applications WHERE job_id=${id} LIMIT 1`);
  const reason = data.reason || "不再推进该岗位";
  if (!application) {
    await run(`UPDATE jobs SET review_status='rejected', rejection_reason=${q(reason)}, updated_at=CURRENT_TIMESTAMP WHERE id=${id}`);
    return jobDetail(id);
  }
  if (["offer", "rejected", "withdrawn", "no_response", "failed"].includes(application.status)) throw new Error("该岗位的投递流程已经结束，不能再次排除");
  await run(`UPDATE jobs SET review_status='rejected', rejection_reason=${q(reason)}, updated_at=CURRENT_TIMESTAMP WHERE id=${id}; UPDATE applications SET status='withdrawn' WHERE id=${application.id}; UPDATE tasks SET status='cancelled',completed_at=NULL,updated_at=CURRENT_TIMESTAMP WHERE job_id=${id} AND status='open';`);
  await addEvent(application.id, {
    event_type: "job_excluded",
    status_from: application.status,
    status_to: "withdrawn",
    message: `停止跟进并排除岗位：${reason}`,
    payload: JSON.stringify({ job_id: id, reason })
  });
  return jobDetail(id);
}
async function restoreFollowUp(id) {
  const [job] = await all(`SELECT * FROM jobs WHERE id=${id}`);
  if (!job) throw new Error("Job not found");
  const [application] = await all(`SELECT * FROM applications WHERE job_id=${id} LIMIT 1`);
  if (!application || job.review_status !== "rejected" || application.status !== "withdrawn") throw new Error("只有已排除且已停止跟进的岗位可以恢复");
  const [excludedEvent] = await all(`SELECT * FROM application_events WHERE application_id=${application.id} AND event_type='job_excluded' ORDER BY id DESC LIMIT 1`);
  const restoredStatus = statuses.includes(excludedEvent?.status_from) && !["offer", "rejected", "withdrawn", "no_response", "failed"].includes(excludedEvent.status_from)
    ? excludedEvent.status_from
    : "collected";
  await run(`UPDATE jobs SET review_status='confirmed',rejection_reason=NULL,updated_at=CURRENT_TIMESTAMP WHERE id=${id}; UPDATE applications SET status=${q(restoredStatus)} WHERE id=${application.id};`);
  await addEvent(application.id, {
    event_type: "job_restored",
    status_from: "withdrawn",
    status_to: restoredStatus,
    message: "恢复岗位跟进；已取消的任务可按需逐项重新打开",
    payload: JSON.stringify({ job_id: id })
  });
  return jobDetail(id);
}
async function convertJob(id, data = {}) {
  const [job] = await all(`SELECT * FROM jobs WHERE id=${id}`); if (!job) throw new Error("Job not found");
  const existing = await all(`SELECT * FROM applications WHERE job_id=${id}`);
  if (existing[0]) {
    if (data.resume_version_id) {
      const [resume] = await all(`SELECT * FROM resume_versions WHERE id=${Number(data.resume_version_id)}`); if (!resume) throw new Error("Resume version not found");
      if (resume.job_id && Number(resume.job_id) !== id) throw new Error("所选简历不属于当前岗位，请先复用为岗位版本");
      await bindResumeToApplication(existing[0], resume.id);
      return (await all(`SELECT * FROM applications WHERE id=${existing[0].id}`))[0];
    }
    return existing[0];
  }
  if (job.review_status !== "confirmed") throw new Error("岗位必须先通过人工确认，才能创建投递记录");
  let resume = null;
  if (data.resume_version_id) {
    [resume] = await all(`SELECT * FROM resume_versions WHERE id=${Number(data.resume_version_id)}`);
    if (!resume) throw new Error("Resume version not found");
    if (resume.job_id && Number(resume.job_id) !== id) throw new Error("所选简历不属于当前岗位，请先复用为岗位版本");
  }
  await run(`INSERT INTO applications (job_id,resume_version_id,company,role,job_url,application_url,ats_type,status,notes) VALUES (${id},${q(resume?.id)},${q(job.company)},${q(job.role)},${q(job.job_url)},${q(job.application_url)},${q(job.source_type)},'collected',${q("从已确认岗位创建")});${resume ? ` UPDATE resume_versions SET usage_count=usage_count+1 WHERE id=${resume.id};` : ""}`);
  const app = (await all("SELECT * FROM applications ORDER BY id DESC LIMIT 1"))[0]; await addEvent(app.id, { event_type: "created", status_to: "collected", message: "从岗位池创建投递记录" }); return app;
}
async function createApplication(data) { if (data.job_id) return convertJob(Number(data.job_id)); await run(`INSERT INTO applications (company,role,job_url,application_url,ats_type,status,notes) VALUES (${q(data.company)},${q(data.role)},${q(data.job_url)},${q(data.application_url)},${q(data.ats_type)},${q(statuses.includes(data.status) ? data.status : "collected")},${q(data.notes)})`); const app=(await all("SELECT * FROM applications ORDER BY id DESC LIMIT 1"))[0]; await addEvent(app.id,{event_type:"created",status_to:app.status,message:"创建投递记录"}); return app; }
async function updateStatus(id, data) { if (!statuses.includes(data.status)) throw new Error("Invalid status"); const [app]=await all(`SELECT * FROM applications WHERE id=${id}`); if (!app) throw new Error("Application not found"); await run(`UPDATE applications SET status=${q(data.status)},notes=COALESCE(${q(data.notes)},notes),submitted_at=CASE WHEN ${q(data.status)}='submitted' AND submitted_at IS NULL THEN CURRENT_TIMESTAMP ELSE submitted_at END,last_error=CASE WHEN ${q(data.status)}='failed' THEN ${q(data.message)} ELSE NULL END,screenshot_path=COALESCE(${q(data.screenshot_path)},screenshot_path) WHERE id=${id}`); const eventType=app.status===data.status ? "status_note" : "status_changed"; await addEvent(id,{event_type:eventType,status_from:app.status,status_to:data.status,message:data.message || (eventType === "status_changed" ? `状态更新为 ${statusLabels[data.status]}` : `状态仍为 ${statusLabels[data.status]}`),payload:data.payload ? JSON.stringify(data.payload) : null,screenshot_path:data.screenshot_path}); return (await all(`SELECT * FROM applications WHERE id=${id}`))[0]; }
async function listEvents(id) { return all(`SELECT * FROM application_events WHERE application_id=${id} ORDER BY created_at DESC,id DESC`); }
async function addEvent(id,data) { await run(`INSERT INTO application_events (application_id,event_type,status_from,status_to,message,payload,screenshot_path) VALUES (${id},${q(data.event_type||"note")},${q(data.status_from)},${q(data.status_to)},${q(data.message)},${q(data.payload)},${q(data.screenshot_path)})`); return (await all("SELECT * FROM application_events ORDER BY id DESC LIMIT 1"))[0]; }
async function listTasks() {
  const rows = await all(`SELECT t.*,j.company,j.role,a.status AS application_status
    FROM tasks t
    LEFT JOIN jobs j ON j.id=t.job_id
    LEFT JOIN applications a ON a.id=t.application_id
    ORDER BY t.status='open' DESC,t.due_at IS NULL,t.due_at,t.id DESC`);
  return rows.map(decorateTask);
}
async function listFollowUps(params) {
  const where = [];
  if (params.get("keyword")) {
    const keyword = q(`%${params.get("keyword")}%`);
    where.push(`(j.company LIKE ${keyword} OR j.role LIKE ${keyword})`);
  }
  const [jobRows, applicationRows, taskRows, resumeRows, eventRows] = await Promise.all([
    all(`SELECT j.*,r.match_score FROM jobs j
      LEFT JOIN job_ai_reviews r ON r.id=(SELECT MAX(id) FROM job_ai_reviews WHERE job_id=j.id)
      ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
      ORDER BY j.id DESC`),
    all("SELECT * FROM applications WHERE job_id IS NOT NULL ORDER BY id DESC"),
    all("SELECT * FROM tasks WHERE job_id IS NOT NULL ORDER BY status='open' DESC,due_at IS NULL,due_at,id DESC"),
    all("SELECT id,job_id,name,resume_type,version_number,docx_path,pdf_path,created_at FROM resume_versions WHERE job_id IS NOT NULL ORDER BY id DESC"),
    all(`SELECT e.*,a.job_id FROM application_events e
      JOIN applications a ON a.id=e.application_id
      WHERE a.job_id IS NOT NULL ORDER BY e.created_at DESC,e.id DESC`)
  ]);
  const applicationsByJob = groupBy(applicationRows, "job_id");
  const tasksByJob = groupBy(taskRows.map(decorateTask), "job_id");
  const resumesByJob = groupBy(resumeRows, "job_id");
  const eventsByJob = groupBy(eventRows, "job_id");
  const items = jobRows.map((job) => {
    const application = applicationsByJob.get(job.id)?.[0] || null;
    const tasks = tasksByJob.get(job.id) || [];
    const resumes = resumesByJob.get(job.id) || [];
    const events = (eventsByJob.get(job.id) || []).slice(0, 30);
    const openTasks = tasks.filter((task) => task.status === "open");
    const countableTasks = tasks.filter((task) => task.status !== "cancelled");
    const completedTasks = tasks.filter((task) => task.status === "done");
    const stage = workflowStage({
      review_status: job.review_status,
      application_status: application?.status,
      resume_count: resumes.length
    });
    return {
      job,
      application,
      tasks,
      resumes,
      events,
      stage,
      next_task: openTasks[0] || null,
      task_summary: {
        open: openTasks.length,
        completed: completedTasks.length,
        total: countableTasks.length,
        overdue: openTasks.filter((task) => task.is_overdue).length
      },
      is_active: !stage.terminal && (Boolean(application) || job.review_status === "confirmed" || openTasks.length > 0)
    };
  });
  return { stages: workflowStages, items };
}
async function createTask(data) {
  const title = String(data.title || "").trim();
  if (!title) throw new Error("任务标题不能为空");
  const linked = await resolveTaskLink(data);
  const taskType = taskTypes.has(data.task_type) ? data.task_type : "follow_up";
  const priority = taskPriorities.has(data.priority) ? data.priority : "normal";
  await run(`INSERT INTO tasks (job_id,application_id,task_type,title,due_at,status,priority,notes,updated_at)
    VALUES (${linked.jobId},${q(linked.applicationId)},${q(taskType)},${q(title)},${q(data.due_at)},'open',${q(priority)},${q(data.notes)},CURRENT_TIMESTAMP)`);
  const task = decorateTask((await all("SELECT * FROM tasks ORDER BY id DESC LIMIT 1"))[0]);
  if (linked.applicationId) await addEvent(linked.applicationId, { event_type: "task_created", message: `新增任务：${title}`, payload: JSON.stringify({ task_id: task.id }) });
  return task;
}
async function updateTask(id,data) {
  const [existing] = await all(`SELECT * FROM tasks WHERE id=${id}`);
  if (!existing) throw new Error("Task not found");
  const sets = [];
  if (data.title !== undefined) {
    const title = String(data.title || "").trim();
    if (!title) throw new Error("任务标题不能为空");
    sets.push(`title=${q(title)}`);
  }
  if (data.task_type !== undefined) {
    if (!taskTypes.has(data.task_type)) throw new Error("Invalid task type");
    sets.push(`task_type=${q(data.task_type)}`);
  }
  if (data.priority !== undefined) {
    if (!taskPriorities.has(data.priority)) throw new Error("Invalid task priority");
    sets.push(`priority=${q(data.priority)}`);
  }
  if (data.due_at !== undefined) sets.push(`due_at=${q(data.due_at)}`);
  if (data.notes !== undefined) sets.push(`notes=${q(data.notes)}`);
  let nextStatus = data.status;
  if (data.completed !== undefined) nextStatus = data.completed ? "done" : "open";
  if (nextStatus !== undefined) {
    if (!taskStatuses.has(nextStatus)) throw new Error("Invalid task status");
    sets.push(`status=${q(nextStatus)}`);
    sets.push(`completed_at=${nextStatus === "done" ? "COALESCE(completed_at,CURRENT_TIMESTAMP)" : "NULL"}`);
  }
  if (!sets.length) return decorateTask(existing);
  await run(`UPDATE tasks SET ${sets.join(",")},updated_at=CURRENT_TIMESTAMP WHERE id=${id}`);
  const task = decorateTask((await all(`SELECT * FROM tasks WHERE id=${id}`))[0]);
  if (existing.application_id) {
    const eventType = nextStatus === "done" ? "task_completed" : nextStatus === "cancelled" ? "task_cancelled" : existing.status !== nextStatus && nextStatus === "open" ? "task_reopened" : "task_updated";
    const action = eventType === "task_completed" ? "完成任务" : eventType === "task_cancelled" ? "取消任务" : eventType === "task_reopened" ? "重新打开任务" : "更新任务";
    await addEvent(existing.application_id, { event_type: eventType, message: `${action}：${task.title}`, payload: JSON.stringify({ task_id: id }) });
  }
  return task;
}
async function deleteTask(id) {
  const [task] = await all(`SELECT * FROM tasks WHERE id=${id}`);
  if (!task) throw new Error("Task not found");
  await run(`DELETE FROM tasks WHERE id=${id}`);
  if (task.application_id) await addEvent(task.application_id, { event_type: "task_deleted", message: `删除任务：${task.title}`, payload: JSON.stringify({ task_id: id }) });
  return { deleted: true, id };
}
async function resolveTaskLink(data) {
  let jobId = Number(data.job_id || 0);
  let applicationId = Number(data.application_id || 0) || null;
  if (applicationId) {
    const [application] = await all(`SELECT id,job_id FROM applications WHERE id=${applicationId}`);
    if (!application) throw new Error("Application not found");
    if (jobId && Number(application.job_id) !== jobId) throw new Error("任务关联的岗位和投递记录不一致");
    jobId = Number(application.job_id || jobId);
  }
  if (!jobId) throw new Error("任务必须关联岗位");
  const [job] = await all(`SELECT id FROM jobs WHERE id=${jobId}`);
  if (!job) throw new Error("Job not found");
  if (!applicationId) {
    const [application] = await all(`SELECT id FROM applications WHERE job_id=${jobId} LIMIT 1`);
    applicationId = application?.id || null;
  }
  return { jobId, applicationId };
}
function decorateTask(task) {
  if (!task) return task;
  const dueAt = task.due_at ? new Date(String(task.due_at).replace(" ", "T")) : null;
  return {
    ...task,
    status: task.status || (task.completed_at ? "done" : "open"),
    priority: task.priority || "normal",
    is_overdue: Boolean(dueAt && !Number.isNaN(dueAt.valueOf()) && dueAt < new Date() && (task.status || (task.completed_at ? "done" : "open")) === "open")
  };
}
function groupBy(rows, key) {
  const map = new Map();
  for (const row of rows) {
    const value = Number(row[key]);
    if (!map.has(value)) map.set(value, []);
    map.get(value).push(row);
  }
  return map;
}
function booleanFlag(value) {
  return value === true || value === 1 || value === "1" || value === "true" ? 1 : 0;
}
async function downloadResume(res, id, format) {
  const [resume] = await all(`SELECT * FROM resume_versions WHERE id=${id}`); if (!resume) throw new Error("Resume version not found");
  if (!new Set(["docx", "pdf"]).has(format)) throw new Error("Unsupported resume format");
  const relative = format === "docx" ? resume.docx_path : resume.pdf_path; if (!relative) throw new Error("Artifact not found");
  const file = path.resolve(root, relative); if (!isInsideRoot(file) || path.extname(file).toLowerCase() !== `.${format}`) throw new Error("Invalid artifact path");
  const data = await fs.readFile(file); const extension = format; const type = format === "docx" ? "application/vnd.openxmlformats-officedocument.wordprocessingml.document" : "application/pdf";
  res.writeHead(200, { "content-type": type, "content-disposition": `attachment; filename="resume-${id}.${extension}"` }); res.end(data);
}
async function body(req) { let text=""; for await (const chunk of req) text+=chunk; return text ? JSON.parse(text) : {}; }
async function staticFile(res, requestPath) {
  const allowed = new Set(["/dashboard/index.html", "/dashboard/phase23.js", "/dashboard/favicon.svg"]);
  if (!allowed.has(requestPath)) return text(res, "Not found", 404);
  const file = path.resolve(root, "." + decodeURIComponent(requestPath));
  if (!isInsideRoot(file)) return text(res, "forbidden", 403);
  try {
    let data = await fs.readFile(file);
    const type = file.endsWith(".html") ? "text/html; charset=utf-8" : file.endsWith(".css") ? "text/css; charset=utf-8" : file.endsWith(".svg") ? "image/svg+xml" : "text/javascript; charset=utf-8";
    if (file.endsWith(`${path.sep}dashboard${path.sep}index.html`)) data = Buffer.concat([data, Buffer.from('<script src="/dashboard/phase23.js"></script>')]);
    res.writeHead(200, { "content-type": type });
    res.end(data);
  } catch (error) {
    if (error.code === "ENOENT") return text(res, "Not found", 404);
    throw error;
  }
}
function isInsideRoot(file) { const relative = path.relative(root, file); return relative && !relative.startsWith("..") && !path.isAbsolute(relative); }
function httpStatusForError(error) {
  const message = String(error?.message || "");
  if (/not found/i.test(message)) return 404;
  if (/UNIQUE constraint failed/i.test(message)) return 409;
  if (/关联投递记录|关联简历|关联任务|不能直接删除|不能再回退|仍在使用中|才能彻底删除/.test(message)) return 409;
  if (/required|invalid|必须|请先|不允许|URL|FOREIGN KEY constraint failed|unsupported|已经结束|不能再次|只有已排除/i.test(message)) return 400;
  return 500;
}
function json(res,data,status=200){res.writeHead(status,{"content-type":"application/json; charset=utf-8"});res.end(JSON.stringify(data));}
function text(res,data,status=200){res.writeHead(status,{"content-type":"text/plain; charset=utf-8"});res.end(data);}

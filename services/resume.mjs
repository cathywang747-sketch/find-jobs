import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { loadProfile, profileFields } from "../ats/profile.mjs";
import { chromium } from "playwright";

const execFileAsync = promisify(execFile);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const python = process.env.PYTHON || "python";

export async function createResume({ job, name, generationNotes }) {
  const profile = loadProfile(process.env.PROFILE_PATH || path.join(root, "data/profile.yaml"));
  const fields = profileFields(profile);
  const version = { name: name || `${job.company} · ${job.role}`, resume_type: "tailored", tags: ["generated", job.source_type || "manual"], profile_snapshot: profile, job_snapshot: job, generation_notes: generationNotes || "基于 Profile 快照生成，待人工校对。" };
  const stamp = `${Date.now()}-${String(job.id).padStart(4, "0")}`;
  const dir = path.join(root, "artifacts", "resumes");
  await fs.mkdir(dir, { recursive: true });
  const htmlPath = path.join(dir, `${stamp}.html`);
  const docxPath = path.join(dir, `${stamp}.docx`);
  const pdfPath = path.join(dir, `${stamp}.pdf`);
  await fs.writeFile(htmlPath, renderHtml(fields, profile, job, version.generation_notes), "utf8");
  await execFileAsync(python, [path.join(root, "scripts", "make_docx.py"), "--html", htmlPath, "--out", docxPath]);
  const browser = await chromium.launch({ channel: "chrome", headless: true });
  try { const page = await browser.newPage(); await page.goto(`file:///${htmlPath.replaceAll("\\", "/")}`); await page.pdf({ path: pdfPath, format: "A4", printBackground: true, margin: { top: "12mm", right: "12mm", bottom: "12mm", left: "12mm" } }); } finally { await browser.close(); }
  version.docx_path = `artifacts/resumes/${stamp}.docx`;
  version.pdf_path = `artifacts/resumes/${stamp}.pdf`;
  return { version, docxPath, htmlPath };
}

export async function copyResumeArtifacts({ source, job, name }) {
  const stamp = `${Date.now()}-${String(job.id).padStart(4, "0")}`;
  const dir = path.join(root, "artifacts", "resumes");
  await fs.mkdir(dir, { recursive: true });
  const copied = {};
  for (const [field, extension] of [["docx_path", ".docx"], ["pdf_path", ".pdf"]]) {
    if (!source[field]) continue;
    const sourcePath = path.resolve(root, source[field]);
    if (!isInsideRoot(sourcePath) || path.extname(sourcePath).toLowerCase() !== extension) continue;
    const targetPath = path.join(dir, `${stamp}${extension}`);
    await fs.copyFile(sourcePath, targetPath);
    copied[field] = `artifacts/resumes/${stamp}${extension}`;
  }
  if (!copied.docx_path && !copied.pdf_path) throw new Error("源简历没有可复用的 DOCX 或 PDF 文件");
  return {
    name: name || `${job.company} · ${job.role}`,
    resume_type: "tailored",
    tags: ["reused", `parent:${source.id}`],
    profile_snapshot: parseSnapshot(source.profile_snapshot),
    job_snapshot: job,
    generation_notes: `从版本 #${source.id} 复制为当前岗位版本，原版本保持不变。`,
    ...copied
  };
}

export function renderHtml(fields, profile, job, notes) {
  const esc = (v) => String(v ?? "").replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]));
  const bullets = (items = []) => items.map((item) => `<li>${esc(item)}</li>`).join("");
  const experiences = rankForJob(profile.experience || [], job, profile).map((e) => `<h3>${esc(e.title || e.role || "")} · ${esc(e.company)}</h3><p class="muted">${esc(e.start_date)} – ${esc(e.end_date)}</p><ul>${bullets(e.bullets)}</ul>`).join("");
  const projects = rankForJob(profile.projects || [], job, profile).slice(0, 4).map((p) => `<h3>${esc(p.name)}</h3><ul>${bullets(p.bullets)}</ul>`).join("");
  return `<!doctype html><html><head><meta charset="utf-8"><style>body{font-family:Arial,"Microsoft YaHei",sans-serif;color:#17212b;max-width:760px;margin:34px auto;font-size:12px;line-height:1.5}h1{font-size:25px;margin:0}h2{font-size:14px;border-bottom:1px solid #17212b;padding-bottom:4px;margin-top:22px}h3{font-size:12px;margin:10px 0 0}p{margin:3px 0}.muted{color:#687684}ul{margin:4px 0;padding-left:18px}</style></head><body><h1>${esc(fields.name)}</h1><p>${esc(fields.email)} · ${esc(fields.phone)} · ${esc(fields.location)}</p><h2>PROFILE</h2><p>${esc(fields.selfEvaluation)}</p><h2>EXPERIENCE</h2>${experiences}<h2>PROJECTS</h2>${projects}<h2>EDUCATION</h2>${(profile.education || []).map((e) => `<p><b>${esc(e.school)}</b> · ${esc(e.degree)} · ${esc(e.major || e.field_of_study)} · ${esc(e.start_date)}–${esc(e.end_date)}</p>`).join("")}<h2>SKILLS</h2><p>${esc((profile.skills || []).join(" · "))}</p></body></html>`;
}

function rankForJob(items, job, profile) {
  const jobText = `${job.role || ""} ${job.description || ""}`.toLowerCase();
  const relevantSkills = (profile.skills || []).map(String).filter((skill) => jobText.includes(skill.toLowerCase()));
  return items.map((item, index) => {
    const text = JSON.stringify(item).toLowerCase();
    const score = relevantSkills.reduce((total, skill) => total + (text.includes(skill.toLowerCase()) ? 1 : 0), 0);
    return { item, index, score };
  }).sort((a, b) => b.score - a.score || a.index - b.index).map(({ item }) => item);
}

function parseSnapshot(value) {
  if (typeof value !== "string") return value || {};
  try { return JSON.parse(value); } catch { return {}; }
}

function isInsideRoot(file) {
  const relative = path.relative(root, file);
  return relative && !relative.startsWith("..") && !path.isAbsolute(relative);
}

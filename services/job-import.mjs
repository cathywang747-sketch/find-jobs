import { chromium } from "playwright";
import { createHash } from "node:crypto";
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

export async function previewJobUrl(url) {
  await assertPublicHttpUrl(url);
  let html = "";
  try { const response = await fetch(url, { headers: { "user-agent": "resume-automation/1.0 job preview" }, signal: AbortSignal.timeout(15000) }); if (response.ok) html = await response.text(); } catch { /* fallback to browser rendering */ }
  let result = parseJobHtml(html, url);
  if (!result.role || !result.company || !result.description) {
    try {
      const browser = await chromium.launch({ channel: "chrome", headless: true });
      try { const page = await browser.newPage(); await page.goto(url, { waitUntil: "domcontentloaded", timeout: 25000 }); result = mergeResult(result, await page.evaluate(() => ({ title: document.title, text: document.body?.innerText || "", h1: document.querySelector("h1")?.innerText || "", h2: document.querySelector("h2")?.innerText || "", links: [...document.querySelectorAll("a")].map((a) => ({ text: a.innerText, href: a.href })) })), url); } finally { await browser.close(); }
    } catch (error) { result.fetch_error = error.message; }
  }
  return { ...result, job_url: url, application_url: result.application_url || url, extracted_at: new Date().toISOString(), needs_manual_review: !result.role || !result.company };
}

export async function assertPublicHttpUrl(value) {
  let url;
  try { url = new URL(String(value || "")); } catch { throw new Error("URL 格式无效"); }
  if (!new Set(["http:", "https:"]).has(url.protocol)) throw new Error("URL 必须以 http:// 或 https:// 开头");
  const host = url.hostname.toLowerCase();
  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local")) throw new Error("不允许访问本机或内网地址");
  const addresses = isIP(host) ? [{ address: host }] : await lookup(host, { all: true });
  if (addresses.some(({ address }) => isPrivateAddress(address))) throw new Error("不允许访问本机或内网地址");
  return url;
}

function isPrivateAddress(address) {
  const value = String(address).toLowerCase();
  if (value === "::1" || value.startsWith("fe80:") || value.startsWith("fc") || value.startsWith("fd")) return true;
  const ipv4 = value.startsWith("::ffff:") ? value.slice(7) : value;
  const parts = ipv4.split(".").map(Number);
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part))) return false;
  const [a, b] = parts;
  return a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168);
}

function parseJobHtml(html, url) {
  if (!html) return { source_type: detectSource(url) };
  const jsonLd = [...html.matchAll(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)].flatMap((match) => { try { const value = JSON.parse(match[1].trim()); return Array.isArray(value) ? value : [value]; } catch { return []; } }).find((item) => item?.["@type"] === "JobPosting" || item?.["@type"]?.includes?.("JobPosting"));
  const meta = (name) => { const tags = html.match(/<meta\b[^>]*>/gi) || []; const target = tags.find((tag) => new RegExp(`(?:name|property)=["']${escapeRegExp(name)}["']`, "i").test(tag)); return clean(readAttribute(target, "content")); };
  const tag = (name) => clean(html.match(new RegExp(`<${name}[^>]*>([\\s\\S]*?)<\\/${name}>`, "i"))?.[1]);
  const text = stripHtml(html);
  const location = jsonLd?.jobLocation?.address?.addressLocality || jsonLd?.jobLocation?.name || meta("job:location") || findLabel(text, ["location", "地点", "工作地点"]);
  const description = clean(jsonLd?.description) || meta("description") || text.slice(0, 12000);
  const role = clean(jsonLd?.title) || meta("og:title") || tag("h1") || tag("h2") || clean(html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]);
  const company = clean(jsonLd?.hiringOrganization?.name) || meta("author") || meta("og:site_name") || findLabel(text, ["company", "公司", "招聘方"]);
  const applicationUrl = clean(jsonLd?.url) || findApplyLink(html, url);
  const fields = { company, role: role?.split(/[|｜—-]/)[0]?.trim(), location, description, application_url: applicationUrl, recruiting_type: inferRecruitingType(`${role} ${description}`), published_at: jsonLd?.datePosted || meta("article:published_time"), deadline: jsonLd?.validThrough, source_type: detectSource(url), extraction_method: "html+json-ld" };
  return { ...fields, missing_fields: ["company", "role", "location", "recruiting_type", "application_url"].filter((field) => !fields[field]) };
}

function mergeResult(base, rendered, url) { const text = rendered.text || ""; const result = { ...base, company: base.company || findLabel(text, ["company", "公司", "招聘方"]) || companyFromUrl(url), role: base.role || rendered.h1 || rendered.h2 || rendered.title?.split(/[|｜—-]/)[0], location: base.location || findLabel(text, ["location", "地点", "工作地点"]), description: base.description || text.slice(0, 12000), application_url: base.application_url || rendered.links?.find((link) => /apply|申请|投递/i.test(link.text))?.href || url, recruiting_type: base.recruiting_type || inferRecruitingType(text), extraction_method: "browser-rendered" }; return { ...result, missing_fields: ["company", "role", "location", "recruiting_type", "application_url"].filter((field) => !result[field]) }; }
function findApplyLink(html, base) { const match = html.match(/<a[^>]+href=["']([^"']+)["'][^>]*>[^<]*(?:apply|申请|投递|สมัคร)[^<]*<\/a>/i); if (!match) return base; try { return new URL(match[1], base).href; } catch { return base; } }
function findLabel(text, labels) { for (const label of labels) { const match = text.match(new RegExp(`${label}\\s*[:：-]?\\s*([^\\n]{2,80})`, "i")); if (match) return match[1].trim(); } return ""; }
function inferRecruitingType(text) { if (/校招|校园|campus|new grad|graduate/i.test(text)) return "校招"; if (/实习|intern/i.test(text)) return "实习"; if (/全职|full[- ]?time/i.test(text)) return "全职"; if (/社招|experienced|senior/i.test(text)) return "社招"; return ""; }
function detectSource(url) { const host = new URL(url).hostname; return host.includes("greenhouse") ? "greenhouse" : host.includes("lever") ? "lever" : "generic"; }
function companyFromUrl(url) { const host = new URL(url).hostname.toLowerCase(); if (host.endsWith("bytedance.com")) return "字节跳动"; return host.replace(/^(www|jobs|careers|career)\./, "").split(".")[0]; }
function readAttribute(tag, name) { if (!tag) return ""; return tag.match(new RegExp(`${name}=["']([^"']*)`, "i"))?.[1] || ""; }
function escapeRegExp(value) { return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); }
function clean(value) { return stripHtml(String(value || "")).replace(/\s+/g, " ").trim(); }
function stripHtml(value) { return String(value || "").replace(/<style[\s\S]*?<\/style>/gi, " ").replace(/<script[\s\S]*?<\/script>/gi, " ").replace(/<[^>]*>/g, " ").replace(/&nbsp;/gi, " ").replace(/&amp;/gi, "&"); }

export function canonicalizeJobUrl(value) {
  const url = new URL(String(value || ""));
  url.hash = "";
  for (const key of [...url.searchParams.keys()]) {
    if (/^(utm_|ref$|referrer$|source$|sourceid$|tracking|trk$|spm$)/i.test(key)) url.searchParams.delete(key);
  }
  url.hostname = url.hostname.toLowerCase();
  if (url.pathname.length > 1) url.pathname = url.pathname.replace(/\/+$/, "");
  return url.href;
}

// Used only for duplicate detection. Keep the original company and role text for display.
export function normalizeCompanyName(value) {
  let key = String(value || "").normalize("NFKC").trim().toLowerCase()
    .replace(/[\s\p{P}\p{S}_]+/gu, "")
    .replace(/(?:\u6709\u9650\u8d23\u4efb\u516c\u53f8|\u80a1\u4efd\u6709\u9650\u516c\u53f8|\u6709\u9650\u516c\u53f8|\u516c\u53f8|\u96c6\u56e2|incorporated|inc|llc|ltd|limited|corporation|corp|co)$/u, "");
  if (["\u5b57\u8282", "\u5b57\u8282\u8df3\u52a8", "bytedance"].includes(key) || key.includes("\u5b57\u8282\u8df3\u52a8") || key.includes("bytedance")) return "bytedance";
  return key;
}

export function normalizeRoleName(value) {
  return String(value || "").normalize("NFKC").trim().toLowerCase().replace(/[\s\p{P}\p{S}_]+/gu, "");
}

export function jobFingerprint(job) {
  const canonicalUrl = canonicalizeJobUrl(job.canonical_url || job.job_url);
  const identity = [canonicalUrl, job.company, job.role, job.location]
    .map((value) => String(value || "").trim().toLowerCase().replace(/\s+/g, " "))
    .join("|");
  return `job:${createHash("sha256").update(identity).digest("hex")}`;
}

export function parseImportText(text) {
  const trimmed = String(text || "").replace(/^\uFEFF/, "").trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim();
  const unwrap = (parsed) => Array.isArray(parsed) ? parsed : parsed.jobs || parsed.data || parsed.results || parsed.items || [parsed];
  try { return unwrap(JSON.parse(trimmed)); } catch { const start = Math.min(...[trimmed.indexOf("["), trimmed.indexOf("{")].filter((index) => index >= 0)); const end = Math.max(trimmed.lastIndexOf("]"), trimmed.lastIndexOf("}")); if (start >= 0 && end > start) { try { return unwrap(JSON.parse(trimmed.slice(start, end + 1))); } catch { /* continue to line parser */ } } return trimmed.split(/\n{2,}/).map((block) => { const get = (keys) => { const line = block.split(/\r?\n/).find((item) => keys.some((key) => item.toLowerCase().startsWith(key.toLowerCase()))); return line?.split(/[:：]/).slice(1).join(":").trim() || ""; }; return { company: get(["company", "公司"]), role: get(["role", "职位", "岗位"]), location: get(["location", "地点"]), job_url: get(["job_url", "url", "岗位链接"]), application_url: get(["application_url", "申请链接"]), recruiting_type: get(["recruiting_type", "招聘类型"]) }; }).filter((item) => item.company || item.role || item.job_url); }
}

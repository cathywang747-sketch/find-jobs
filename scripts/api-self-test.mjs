import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { execFile } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const tempDir = await mkdtemp(path.join(os.tmpdir(), "resume-automation-api-"));
const dbPath = path.join(tempDir, "applications.db");
const port = 4191;
const baseUrl = `http://127.0.0.1:${port}`;
const env = { ...process.env, RESUME_AUTOMATION_DB_PATH: dbPath, PORT: String(port) };
let server;

try {
  await execFileAsync(process.execPath, ["scripts/migrate.mjs"], { env });
  server = spawn(process.execPath, ["scripts/server.mjs"], { env, stdio: "ignore" });
  await waitForServer();

  const first = await request("/api/jobs", {
    company: "\u5b57\u8282\u8df3\u52a8\u6709\u9650\u516c\u53f8",
    role: "\u540e\u7aef\u5f00\u53d1\u5de5\u7a0b\u5e08",
    job_url: "https://jobs.example.com/bytedance/backend-a",
    company_type: "\u79c1\u4f01"
  });
  assert.equal(first.duplicate, undefined);
  assert.equal(first.company_type, "\u79c1\u4f01");

  const duplicate = await request("/api/jobs", {
    company: "ByteDance",
    role: "\u540e\u7aef-\u5f00\u53d1\u5de5\u7a0b\u5e08",
    job_url: "https://jobs.example.com/bytedance/backend-b"
  });
  assert.equal(duplicate.duplicate, true);
  assert.equal(duplicate.id, first.id);

  const jobs = await request("/api/jobs");
  assert.equal(jobs.length, 1);

  const note = await request("/api/notes", { title: "\u6295\u9012\u5224\u65ad", content: "\u4f18\u5148\u51c6\u5907\u7b80\u5386", is_pinned: true });
  assert.equal(note.is_pinned, 1);
  const changed = await request(`/api/notes/${note.id}`, { title: "\u5df2\u66f4\u65b0\u7684\u5224\u65ad", is_pinned: false }, "PATCH");
  assert.equal(changed.title, "\u5df2\u66f4\u65b0\u7684\u5224\u65ad");
  assert.equal(changed.is_pinned, 0);
  const notes = await request("/api/notes");
  assert.equal(notes.length, 1);
  await request(`/api/notes/${note.id}`, undefined, "DELETE");
  assert.equal((await request("/api/notes")).length, 0);

  console.log("api-self-test ok");
} finally {
  server?.kill();
  await rm(tempDir, { recursive: true, force: true });
}

async function request(pathname, body, method = "POST") {
  const response = await fetch(`${baseUrl}${pathname}`, {
    method: body === undefined && method === "POST" ? "GET" : method,
    headers: body === undefined ? undefined : { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || `${response.status}`);
  return data;
}

async function waitForServer() {
  const deadline = Date.now() + 8000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${baseUrl}/api/statuses`);
      if (response.ok) return;
    } catch { /* keep waiting */ }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error("test server did not start");
}

const jobSchema = {
  type: "object", additionalProperties: false,
  properties: { jobs: { type: "array", items: { type: "object", additionalProperties: false, properties: {
    company: { type: "string" }, role: { type: "string" }, job_url: { type: "string" }, application_url: { type: "string" }, location: { type: "string" }, work_mode: { type: "string" }, employment_type: { type: "string" }, recruiting_type: { type: "string" }, description: { type: "string" }, published_at: { type: "string" }, deadline: { type: "string" }, evidence: { type: "array", items: { type: "string" } }
  }, required: ["company", "role", "job_url", "application_url", "location", "work_mode", "employment_type", "recruiting_type", "description", "published_at", "deadline", "evidence"] } } },
  required: ["jobs"]
};

export async function discoverWebJobs({ query, location = "Hong Kong / Beijing / Remote", recruitingType = "校园招聘、实习、应届生、全职" } = {}) {
  if (!process.env.OPENAI_API_KEY) throw new Error("OPENAI_API_KEY 未配置，无法启用全网岗位发现");
  const searchQuery = query || process.env.JOB_SEARCH_QUERY || `AI application engineer OR solutions engineer OR forward deployed engineer ${location} ${recruitingType}`;
  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${process.env.OPENAI_API_KEY}` },
    body: JSON.stringify({ model: process.env.OPENAI_SEARCH_MODEL || "gpt-5", tools: [{ type: "web_search" }], instructions: "你是岗位发现助手。使用 web search 搜索公开招聘页面。只返回可以打开的具体岗位详情页，不要返回搜索结果页、聚合列表页、猎头广告或无法验证的职位。优先公司官方招聘页和公开 ATS 页面。不要编造字段；不确定的字段留空字符串。每个岗位给出 evidence URL。输出中文。", input: `搜索条件：${searchQuery}`, text: { format: { type: "json_schema", name: "job_discovery", description: "Verified public job postings discovered from web search", strict: true, schema: jobSchema } } })
  });
  const payload = await response.json();
  if (!response.ok) throw new Error(payload.error?.message || `OpenAI Web Search HTTP ${response.status}`);
  return { query: searchQuery, model: process.env.OPENAI_SEARCH_MODEL || "gpt-5", jobs: JSON.parse(payload.output_text || "{}").jobs || [], raw_result: payload };
}

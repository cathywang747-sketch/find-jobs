(() => {
  const api = window.api;
  const esc = window.esc;
  const sourceCategories = ["公司官网", "二级招聘平台", "高校就业网", "社交媒体 / 社群", "内推 / 猎头", "其他/待确认"];
  const taskTypeLabels = {
    resume: "简历准备",
    submit: "投递",
    follow_up: "后续跟进",
    interview: "面试准备",
    materials: "材料准备",
    other: "其他"
  };
  const priorityLabels = { normal: "普通", important: "重要", urgent: "紧急" };
  const taskStatusLabels = { open: "待完成", done: "已完成", cancelled: "已取消" };
  const navElement = document.querySelector(".nav");
  if (navElement && !navElement.querySelector('[data-view="notes"]')) {
    const notesButton = document.createElement("button");
    notesButton.dataset.view = "notes";
    notesButton.textContent = "\u270e\u3000\u7b14\u8bb0";
    navElement.insertBefore(notesButton, navElement.querySelector('[data-view="sources"]'));
  }
  const nav = [...document.querySelectorAll(".nav button")];
  const actions = document.querySelector(".actions");
  const expandedProgressJobs = new Set();
  let currentView = "dashboard";
  let progressPayload = null;
  let statusMeta = null;
  const progressFilters = { keyword: "", scope: "active", stage: "" };

  enhanceJobDetail();
  addHeaderActions();
  nav.forEach((button) => button.addEventListener("click", () => navigate(button.dataset.view).catch(showError)));

  async function navigate(view) {
    currentView = view;
    nav.forEach((button) => button.classList.toggle("active", button.dataset.view === view));
    if (view === "dashboard") return window.showTodayDashboard();
    if (view === "jobs") return window.showJobsDashboard();
    if (view === "progress") return renderProgress();
    if (view === "resumes") return renderResumes();
    if (view === "notes") return renderNotes();
    if (view === "sources") return renderSources();
  }

  function enhanceJobDetail() {
    const baseShowDetail = window.showDetail;
    window.showDetail = async (id) => {
      await baseShowDetail(id);
      const detail = document.getElementById("detail");
      if (!detail) return;
      const data = await api(`/api/jobs/${id}`);
      const job = data.job;
      const application = data.applications[0];
      const resumes = data.resumes || [];
      const resumeOptions = resumes.map((resume) => `<option value="${resume.id}" ${Number(application?.resume_version_id) === resume.id ? "selected" : ""}>#${resume.id} · v${resume.version_number} · ${esc(resume.name)}</option>`).join("");
      const extra = document.createElement("div");
      extra.innerHTML = `<h4>简历与自动化</h4><div class="detail-actions"><button data-analyze>运行岗位分析</button><button data-resume>生成岗位简历</button><button data-reuse>复用已有简历</button></div>${resumes.length ? `<div class="field" style="margin-top:10px"><label>本次投递使用的岗位简历</label><select class="select" data-resume-select>${resumeOptions}</select></div>` : '<p class="muted">请先生成岗位简历，或从资产库复用一份简历。</p>'}<div class="detail-actions"><button class="primary" data-fill ${resumes.length && (application || job.review_status === "confirmed") ? "" : "disabled"}>打开可见浏览器并自动填表</button>${application ? '<button data-close-session>结束填表会话</button>' : ""}</div><p class="muted">系统使用所选简历填写公开申请页，浏览器保持打开，最终提交仍由你完成。</p>`;
      detail.appendChild(extra);
      extra.querySelector("[data-analyze]").onclick = async () => {
        await api(`/api/jobs/${id}/analyze`, { method: "POST" });
        await window.showDetail(id);
      };
      extra.querySelector("[data-resume]").onclick = async () => {
        const name = prompt("简历版本名称", `${job.company} · ${job.role}`);
        if (name === null) return;
        const resume = await api(`/api/jobs/${id}/resumes/generate`, { method: "POST", body: JSON.stringify({ name }) });
        toast(`已生成简历版本 #${resume.id}`);
        await window.showDetail(id);
      };
      extra.querySelector("[data-reuse]").onclick = async () => {
        const allResumes = await api("/api/resumes");
        if (!allResumes.length) return toast("简历资产库为空，请先生成一份简历。", true);
        const resumeId = prompt(`输入要复用的简历编号：\n${allResumes.slice(0, 12).map((item) => `#${item.id} ${item.name}`).join("\n")}`);
        if (!resumeId) return;
        const resume = await api(`/api/jobs/${id}/resumes/reuse`, { method: "POST", body: JSON.stringify({ resume_version_id: Number(resumeId) }) });
        toast(`已复制为岗位简历 #${resume.id}`);
        await window.showDetail(id);
      };
      const fillButton = extra.querySelector("[data-fill]");
      fillButton.onclick = async () => {
        const resumeId = Number(extra.querySelector("[data-resume-select]")?.value);
        if (!resumeId) return toast("请先选择岗位简历", true);
        const url = prompt("申请页面 URL", job.application_url || job.job_url);
        if (!url) return;
        fillButton.disabled = true;
        fillButton.textContent = "正在打开并填写…";
        try {
          const app = await api(`/api/jobs/${id}/convert-to-application`, { method: "POST", body: JSON.stringify({ resume_version_id: resumeId }) });
          const result = await api(`/api/applications/${app.id}/fill`, { method: "POST", body: JSON.stringify({ url, resume_version_id: resumeId }) });
          toast(result.ok ? "表单已填写，请在浏览器中检查并自行提交。" : "自动化已被安全边界阻止，请检查保留的浏览器现场。", !result.ok);
          await window.showDetail(id);
        } finally {
          fillButton.disabled = false;
          fillButton.textContent = "打开可见浏览器并自动填表";
        }
      };
      const closeButton = extra.querySelector("[data-close-session]");
      if (closeButton) closeButton.onclick = async () => {
        const result = await api(`/api/applications/${application.id}/fill/close`, { method: "POST", body: "{}" });
        toast(result.closed ? "填表浏览器会话已关闭" : "当前没有运行中的填表会话");
      };
    };
  }

  function addHeaderActions() {
    if (!actions) return;
    const sourceButton = document.createElement("button");
    sourceButton.textContent = "来源配置";
    sourceButton.onclick = manageSources;
    actions.insertBefore(sourceButton, actions.firstChild);
    const importButton = document.createElement("button");
    importButton.textContent = "ChatGPT 批量导入";
    importButton.onclick = importChatGPTText;
    actions.insertBefore(importButton, actions.firstChild);
  }

  async function renderProgress() {
    const existingList = document.getElementById("progressList");
    const previousScroll = existingList ? document.scrollingElement.scrollTop : 0;
    if (existingList) {
      progressFilters.keyword = document.getElementById("progressKeyword")?.value || "";
      progressFilters.scope = document.getElementById("progressScope")?.value || "active";
      progressFilters.stage = document.getElementById("progressStage")?.value || "";
    }
    [progressPayload, statusMeta] = await Promise.all([api("/api/follow-ups"), api("/api/statuses")]);
    const requestedJob = Number(window.pendingProgressJob || 0);
    if (requestedJob) {
      expandedProgressJobs.add(requestedJob);
      window.pendingProgressJob = null;
    }
    document.getElementById("pageTitle").textContent = "岗位进展";
    document.getElementById("today").textContent = "以岗位为单位管理阶段、下一步任务、简历和投递历史";
    document.getElementById("content").innerHTML = `<section class="progress-page panel"><div class="panel-head"><h2>岗位进展</h2><span class="muted" id="progressCount"></span></div><div class="progress-toolbar"><input class="input" id="progressKeyword" placeholder="搜索公司或岗位"><select class="select" id="progressScope"><option value="active">进行中的岗位</option><option value="overdue">存在逾期</option><option value="no_next">没有下一步</option><option value="closed">已结束</option><option value="all">全部岗位</option></select><select class="select" id="progressStage"><option value="">全部阶段</option>${progressPayload.stages.map((stage) => `<option value="${stage.key}">${esc(stage.label)}</option>`).join("")}</select></div><div class="progress-list" id="progressList"></div></section>`;
    document.getElementById("progressKeyword").value = progressFilters.keyword;
    document.getElementById("progressScope").value = progressFilters.scope;
    document.getElementById("progressStage").value = progressFilters.stage;
    if (requestedJob && !progressPayload.items.find((item) => item.job.id === requestedJob)?.is_active) {
      progressFilters.scope = "all";
      document.getElementById("progressScope").value = "all";
    }
    for (const id of ["progressKeyword", "progressScope", "progressStage"]) {
      const element = document.getElementById(id);
      element.addEventListener(element.tagName === "INPUT" ? "input" : "change", applyProgressFilters);
    }
    document.getElementById("refresh").onclick = renderProgress;
    applyProgressFilters();
    if (requestedJob) requestAnimationFrame(() => document.querySelector(`[data-progress-job="${requestedJob}"]`)?.scrollIntoView({ behavior: "smooth", block: "center" }));
    else if (previousScroll) requestAnimationFrame(() => window.scrollTo({ top: previousScroll }));
  }

  function applyProgressFilters() {
    if (!progressPayload) return;
    const keyword = document.getElementById("progressKeyword").value.trim().toLowerCase();
    const scope = document.getElementById("progressScope").value;
    const stage = document.getElementById("progressStage").value;
    progressFilters.keyword = document.getElementById("progressKeyword").value;
    progressFilters.scope = scope;
    progressFilters.stage = stage;
    const items = progressPayload.items.filter((item) => {
      const matchesKeyword = !keyword || `${item.job.company} ${item.job.role}`.toLowerCase().includes(keyword);
      const matchesStage = !stage || item.stage.key === stage;
      const matchesScope = scope === "all"
        || (scope === "active" && item.is_active)
        || (scope === "overdue" && item.task_summary.overdue > 0)
        || (scope === "no_next" && item.is_active && item.task_summary.open === 0)
        || (scope === "closed" && item.stage.terminal);
      return matchesKeyword && matchesStage && matchesScope;
    });
    document.getElementById("progressCount").textContent = `${items.length} 个岗位`;
    document.getElementById("progressList").innerHTML = items.length
      ? items.map(progressCard).join("")
      : '<div class="progress-empty">当前筛选下没有岗位。可以切换为“全部岗位”或返回岗位池继续审核。</div>';
    bindProgressInteractions();
  }

  function progressCard(item) {
    const { job, application, stage, task_summary: taskSummary } = item;
    const next = item.next_task;
    const stages = progressPayload.stages.map((entry, index) => `<span class="stage-step ${index < stage.index ? "done" : ""} ${index === stage.index ? "current" : ""}">${esc(entry.label)}</span>`).join("");
    const statusControl = application
      ? `<div class="status-control"><label class="muted">当前投递状态</label><select class="select" data-application-status="${application.id}" data-job-id="${job.id}">${statusMeta.statuses.map((status) => `<option value="${status}" ${status === application.status ? "selected" : ""}>${esc(statusMeta.statusLabels[status] || status)}</option>`).join("")}</select></div>`
      : `<div class="status-control"><span class="pill ${job.review_status === "confirmed" ? "green" : job.review_status === "pending_review" ? "amber" : "red"}">${esc(window.labels?.[job.review_status] || reviewLabel(job.review_status))}</span></div>`;
    const taskItems = item.tasks.length ? item.tasks.map((task) => taskRow(task, job.id, application?.id)).join("") : '<div class="muted">还没有任务。为这个岗位添加一个明确的下一步。</div>';
    const resumes = item.resumes.length ? item.resumes.map((resume) => `<div class="asset-row"><b>#${resume.id} · v${resume.version_number}</b> ${esc(resume.name)}${resume.docx_path ? `<a href="/api/resumes/${resume.id}/download/docx">DOCX</a>` : ""}${resume.pdf_path ? `<a href="/api/resumes/${resume.id}/download/pdf">PDF</a>` : ""}</div>`).join("") : '<div class="muted">暂无岗位简历。</div>';
    const events = item.events.length ? item.events.map((event) => `<div class="timeline-item">${esc(event.message || event.event_type)}<span class="timeline-time">${formatDate(event.created_at)}</span></div>`).join("") : '<div class="muted">创建投递后，状态变化和任务操作会记录在这里。</div>';
    const suggestion = suggestedTask(application?.status);
    const jobLink = /^https?:/i.test(job.job_url || "") ? `<a class="button-link" href="${esc(job.job_url)}" target="_blank" rel="noreferrer">打开岗位页面 ↗</a>` : "";
    const exclusionAction = application
      ? job.review_status === "rejected" && application.status === "withdrawn"
        ? `<button class="primary" data-restore-progress="${job.id}">恢复跟进</button>`
        : !stage.terminal
          ? `<button class="danger" data-exclude-progress="${job.id}">停止跟进并排除</button>`
          : ""
      : "";
    return `<details class="progress-card" data-progress-job="${job.id}" ${expandedProgressJobs.has(job.id) ? "open" : ""}><summary class="progress-summary"><div><div class="progress-summary-main"><div><span class="job-id">#${job.id}</span>${job.is_saved ? '<span class="bookmark" title="已收藏"> ★</span>' : ""}<h2 class="progress-title">${esc(job.role)}</h2><div class="progress-company">${esc(job.company)} · ${esc(job.location || "地点未注明")}</div></div><span class="pill ${stage.terminal ? "red" : "blue"}">${esc(stage.label)}</span></div><div class="progress-metrics"><span class="metric-chip">任务 ${taskSummary.completed}/${taskSummary.total}</span>${taskSummary.overdue ? `<span class="metric-chip overdue">逾期 ${taskSummary.overdue}</span>` : ""}<span class="metric-chip">简历 ${item.resumes.length}</span></div></div><div><div class="next-action"><span><b>下一步</b>　${next ? esc(next.title) : "尚未设置"}</span><span>${next?.due_at ? formatDate(next.due_at) : ""}</span></div><div class="stage-track ${stage.terminal ? "terminal" : ""}">${stages}</div></div></summary><div class="progress-body"><div class="progress-column">${statusControl}<div class="progress-actions">${!application && job.review_status === "pending_review" ? `<button class="primary" data-confirm-progress="${job.id}">确认岗位</button>` : ""}${!application && job.review_status === "confirmed" ? `<button class="primary" data-create-application="${job.id}">创建投递记录</button>` : ""}${exclusionAction}<button data-add-task="${job.id}" data-application-id="${application?.id || ""}">＋ 添加任务</button>${suggestion ? `<button data-suggest-task="${job.id}" data-application-id="${application?.id || ""}" data-status="${application?.status || ""}">建议：${esc(suggestion.title)}</button>` : ""}${jobLink}<button data-open-job="${job.id}">查看岗位详情</button></div><div class="section-heading"><h3>任务清单</h3><span class="muted">${taskSummary.open} 项待完成</span></div><div class="task-stack">${taskItems}</div></div><aside class="progress-column"><div class="section-heading"><h3>岗位简历</h3><span class="muted">${item.resumes.length} 个版本</span></div><div class="asset-list">${resumes}</div><div class="section-heading" style="margin-top:22px"><h3>投递流水</h3><span class="muted">最近 ${item.events.length} 条</span></div><div class="timeline">${events}</div></aside></div></details>`;
  }

  function taskRow(task, jobId, applicationId) {
    const status = task.status || (task.completed_at ? "done" : "open");
    const icon = status === "done" ? "✓" : status === "cancelled" ? "↺" : "○";
    return `<div class="task-item ${status}" data-task-row="${task.id}"><button class="task-check" data-toggle-task="${task.id}" data-next-status="${status === "done" || status === "cancelled" ? "open" : "done"}" aria-label="${status === "open" ? "完成任务" : "重新打开任务"}">${icon}</button><div><div class="task-title">${esc(task.title)}</div><div class="task-note">${esc(taskTypeLabels[task.task_type] || task.task_type)} · ${esc(priorityLabels[task.priority] || task.priority)} · ${esc(taskStatusLabels[status] || status)}${task.notes ? ` · ${esc(task.notes)}` : ""}</div>${task.due_at ? `<div class="task-due ${task.is_overdue ? "overdue" : ""}">${task.is_overdue ? "已逾期 · " : ""}${formatDate(task.due_at)}</div>` : ""}</div><div class="task-actions"><button data-edit-task="${task.id}" data-job-id="${jobId}" data-application-id="${applicationId || ""}">编辑</button>${status === "open" ? `<button data-cancel-task="${task.id}">取消</button>` : ""}<button class="danger" data-delete-task="${task.id}">删除</button></div></div>`;
  }

  function bindProgressInteractions() {
    document.querySelectorAll("[data-progress-job]").forEach((details) => details.ontoggle = () => {
      const id = Number(details.dataset.progressJob);
      if (details.open) expandedProgressJobs.add(id);
      else expandedProgressJobs.delete(id);
    });
    document.querySelectorAll("[data-application-status]").forEach((select) => select.onchange = async () => {
      select.disabled = true;
      try {
        await api(`/api/applications/${select.dataset.applicationStatus}/status`, { method: "PATCH", body: JSON.stringify({ status: select.value }) });
        toast(`状态已更新为“${statusMeta.statusLabels[select.value] || select.value}”`);
        await renderProgress();
      } catch (error) {
        showError(error);
        select.disabled = false;
      }
    });
    document.querySelectorAll("[data-add-task]").forEach((button) => button.onclick = () => openTaskModal({ jobId: Number(button.dataset.addTask), applicationId: Number(button.dataset.applicationId) || null }));
    document.querySelectorAll("[data-suggest-task]").forEach((button) => button.onclick = () => {
      const defaults = suggestedTask(button.dataset.status);
      openTaskModal({ jobId: Number(button.dataset.suggestTask), applicationId: Number(button.dataset.applicationId) || null, defaults });
    });
    document.querySelectorAll("[data-edit-task]").forEach((button) => button.onclick = () => {
      const task = progressPayload.items.flatMap((item) => item.tasks).find((item) => item.id === Number(button.dataset.editTask));
      openTaskModal({ jobId: Number(button.dataset.jobId), applicationId: Number(button.dataset.applicationId) || null, task });
    });
    document.querySelectorAll("[data-toggle-task]").forEach((button) => button.onclick = () => updateTaskStatus(Number(button.dataset.toggleTask), button.dataset.nextStatus));
    document.querySelectorAll("[data-cancel-task]").forEach((button) => button.onclick = () => updateTaskStatus(Number(button.dataset.cancelTask), "cancelled"));
    document.querySelectorAll("[data-delete-task]").forEach((button) => button.onclick = () => confirmTaskDelete(Number(button.dataset.deleteTask)));
    document.querySelectorAll("[data-confirm-progress]").forEach((button) => button.onclick = async () => {
      await api(`/api/jobs/${button.dataset.confirmProgress}/confirm`, { method: "POST" });
      toast("岗位已确认");
      await renderProgress();
    });
    document.querySelectorAll("[data-create-application]").forEach((button) => button.onclick = async () => {
      const application = await api(`/api/jobs/${button.dataset.createApplication}/convert-to-application`, { method: "POST", body: "{}" });
      toast(`已创建投递记录 #${application.id}`);
      await renderProgress();
    });
    document.querySelectorAll("[data-exclude-progress]").forEach((button) => button.onclick = async () => {
      const confirmed = await confirmDialog({
        title: "停止跟进并排除岗位",
        message: "系统会将本地投递状态标为“已撤回”，取消该岗位待完成任务；不会替你在外部招聘网站撤回申请。",
        confirmText: "停止跟进",
        danger: true
      });
      if (!confirmed) return;
      await api(`/api/jobs/${button.dataset.excludeProgress}/reject`, { method: "POST", body: JSON.stringify({ reason: "在岗位进展中停止跟进" }) });
      toast("已停止跟进；可在“已结束”筛选中恢复");
      await renderProgress();
    });
    document.querySelectorAll("[data-restore-progress]").forEach((button) => button.onclick = async () => {
      const confirmed = await confirmDialog({
        title: "恢复岗位跟进",
        message: "系统会恢复到排除前的投递阶段；已取消任务需要你按需逐项重新打开。",
        confirmText: "恢复跟进"
      });
      if (!confirmed) return;
      await api(`/api/jobs/${button.dataset.restoreProgress}/restore-follow-up`, { method: "POST", body: "{}" });
      toast("已恢复岗位跟进");
      await renderProgress();
    });
    document.querySelectorAll("[data-open-job]").forEach((button) => button.onclick = async () => {
      await window.showJobsDashboard();
      nav.forEach((item) => item.classList.toggle("active", item.dataset.view === "jobs"));
      currentView = "jobs";
      await window.showDetail(Number(button.dataset.openJob));
    });
  }

  async function updateTaskStatus(id, status) {
    await api(`/api/tasks/${id}`, { method: "PATCH", body: JSON.stringify({ status }) });
    toast(status === "done" ? "任务已完成" : status === "cancelled" ? "任务已取消" : "任务已重新打开");
    await renderProgress();
  }

  async function confirmTaskDelete(id) {
    const confirmed = await confirmDialog({
      title: "删除任务",
      message: "删除后任务将从岗位清单中移除，但已经产生的投递流水仍会保留。",
      confirmText: "删除任务",
      danger: true
    });
    if (!confirmed) return;
    await api(`/api/tasks/${id}`, { method: "DELETE" });
    toast("任务已删除");
    await renderProgress();
  }

  function openTaskModal({ jobId, applicationId = null, task = null, defaults = null }) {
    document.getElementById("taskModal")?.remove();
    const values = task || defaults || {};
    const modal = document.createElement("div");
    modal.id = "taskModal";
    modal.className = "modal open";
    modal.innerHTML = `<form class="modal-card dialog-card"><div class="modal-header"><div><p class="modal-kicker">NEXT ACTION</p><h2>${task ? "编辑任务" : "添加任务"}</h2><p class="modal-hint">任务必须属于岗位，阶段进度与任务完成度会分别计算。</p></div><button class="modal-close" type="button" data-close aria-label="关闭">×</button></div><div class="dialog-body"><div class="field"><label>任务内容</label><input class="input" name="title" required value="${esc(values.title || "")}" placeholder="例如：完成岗位定制简历"></div><div class="form-grid"><div class="field"><label>任务类型</label><select class="select" name="task_type">${Object.entries(taskTypeLabels).map(([value, label]) => `<option value="${value}" ${(values.task_type || "follow_up") === value ? "selected" : ""}>${label}</option>`).join("")}</select></div><div class="field"><label>优先级</label><select class="select" name="priority">${Object.entries(priorityLabels).map(([value, label]) => `<option value="${value}" ${(values.priority || "normal") === value ? "selected" : ""}>${label}</option>`).join("")}</select></div></div><div class="field"><label>截止时间（可选）</label><input class="input" type="datetime-local" name="due_at" value="${toDateTimeInput(values.due_at)}"></div><div class="field"><label>备注（可选）</label><textarea class="textarea" name="notes" rows="3">${esc(values.notes || "")}</textarea></div></div><div class="dialog-actions"><button type="button" data-close>取消</button><button class="primary" type="submit">${task ? "保存修改" : "添加任务"}</button></div></form>`;
    document.body.appendChild(modal);
    modal.querySelectorAll("[data-close]").forEach((button) => button.onclick = () => modal.remove());
    modal.onclick = (event) => { if (event.target === modal) modal.remove(); };
    const form = modal.querySelector("form");
    form.onsubmit = async (event) => {
      event.preventDefault();
      const submit = form.querySelector('button[type="submit"]');
      submit.disabled = true;
      const data = Object.fromEntries(new FormData(form));
      data.due_at = data.due_at || null;
      try {
        if (task) await api(`/api/tasks/${task.id}`, { method: "PATCH", body: JSON.stringify(data) });
        else await api("/api/tasks", { method: "POST", body: JSON.stringify({ ...data, job_id: jobId, application_id: applicationId }) });
        modal.remove();
        toast(task ? "任务修改已保存" : "任务已添加");
        await refreshAfterTask(jobId);
      } catch (error) {
        showError(error);
        submit.disabled = false;
      }
    };
    requestAnimationFrame(() => form.elements.namedItem("title").focus());
  }
  window.openTaskModal = openTaskModal;

  async function refreshAfterTask(jobId) {
    if (currentView === "progress") return renderProgress();
    if (currentView === "jobs") return window.showDetail(jobId);
    return window.loadTodayDashboard();
  }

  function suggestedTask(status) {
    if (status === "submitted") return { title: "一周后查询投递进度", task_type: "follow_up", priority: "normal", due_at: futureDate(7) };
    if (status === "hr_contacted") return { title: "整理与 HR 沟通要点", task_type: "follow_up", priority: "important" };
    if (status === "first_interview_invited") return { title: "准备一面并整理岗位问答", task_type: "interview", priority: "urgent" };
    if (status === "first_interview_passed" || status === "second_interview_invited") return { title: "准备下一轮面试", task_type: "interview", priority: "urgent" };
    if (status === "offer") return { title: "核对 Offer 条款和回复期限", task_type: "materials", priority: "urgent" };
    return null;
  }

  function shell(title, subtitle, body) {
    document.getElementById("pageTitle").textContent = title;
    document.getElementById("today").textContent = subtitle;
    document.getElementById("content").innerHTML = `<section class="panel"><div class="panel-head"><h2>${title}</h2><span class="muted">本地数据</span></div><div class="detail-body">${body}</div></section>`;
  }

  async function renderResumes() {
    currentView = "resumes";
    const items = await api("/api/resumes");
    shell("简历资产库", "所有生成版本均保留 Profile 快照，不覆盖历史投递材料", items.length ? `<div class="list">${items.map((item) => `<div class="job"><div class="job-row"><div><h3>${esc(item.name)}</h3><div class="meta">#${item.id} · v${item.version_number} · ${esc(item.resume_type)} · ${esc(item.created_at)}</div></div><span><a href="/api/resumes/${item.id}/download/docx">DOCX</a>　<a href="/api/resumes/${item.id}/download/pdf">PDF</a></span></div></div>`).join("")}</div>` : '<div class="empty">暂无简历版本，请从岗位详情生成</div>');
    document.getElementById("refresh").onclick = renderResumes;
  }

  async function renderNotes() {
    currentView = "notes";
    const notes = await api("/api/notes");
    shell("\u7b14\u8bb0", "\u8bb0\u5f55\u5c97\u4f4d\u5224\u65ad\u3001\u9762\u8bd5\u590d\u76d8\u548c\u5f85\u5904\u7406\u7684\u7075\u611f\u3002", `<div class="detail-actions"><button class="primary" id="newNote">\uff0b \u65b0\u5efa\u7b14\u8bb0</button></div><div class="list" style="margin-top:16px">${notes.length ? notes.map((note) => `<article class="job" data-note="${note.id}"><div class="job-row"><div><h3>${note.is_pinned ? "\u2605 " : ""}${esc(note.title)}</h3><p class="muted" style="margin:5px 0 0;white-space:pre-wrap">${esc(String(note.content || "").replace(/\s+/g, " ").slice(0, 180) || "\u6682\u65e0\u5185\u5bb9")}</p><div class="meta" style="margin-top:8px">\u66f4\u65b0\u4e8e ${esc(formatDate(note.updated_at))}</div></div><div class="detail-actions" style="margin-top:0"><button data-pin-note="${note.id}" data-pinned="${note.is_pinned ? "1" : "0"}">${note.is_pinned ? "\u53d6\u6d88\u7f6e\u9876" : "\u7f6e\u9876"}</button><button data-edit-note="${note.id}">\u7f16\u8f91</button><button class="danger" data-delete-note="${note.id}">\u5220\u9664</button></div></div></article>`).join("") : '<div class="empty">\u6682\u65e0\u7b14\u8bb0\uff0c\u53ef\u4ee5\u5148\u8bb0\u5f55\u4e00\u6761\u5c97\u4f4d\u5224\u65ad\u6216\u4e0b\u4e00\u6b65\u60f3\u6cd5\u3002</div>'}</div>`);
    document.getElementById("newNote").onclick = () => openNoteModal();
    document.querySelectorAll("[data-edit-note]").forEach((button) => button.onclick = () => openNoteModal(notes.find((note) => note.id === Number(button.dataset.editNote))));
    document.querySelectorAll("[data-pin-note]").forEach((button) => button.onclick = async () => {
      await api(`/api/notes/${button.dataset.pinNote}`, { method: "PATCH", body: JSON.stringify({ is_pinned: button.dataset.pinned !== "1" }) });
      await renderNotes();
    });
    document.querySelectorAll("[data-delete-note]").forEach((button) => button.onclick = async () => {
      const confirmed = await confirmDialog({ title: "\u5220\u9664\u7b14\u8bb0", message: "\u5220\u9664\u540e\u65e0\u6cd5\u6062\u590d\u3002", confirmText: "\u5220\u9664\u7b14\u8bb0", danger: true });
      if (!confirmed) return;
      await api(`/api/notes/${button.dataset.deleteNote}`, { method: "DELETE" });
      toast("\u7b14\u8bb0\u5df2\u5220\u9664");
      await renderNotes();
    });
    document.getElementById("refresh").onclick = renderNotes;
  }

  function openNoteModal(note = null) {
    document.getElementById("noteModal")?.remove();
    const modal = document.createElement("div");
    modal.id = "noteModal";
    modal.className = "modal open";
    modal.innerHTML = `<form class="modal-card dialog-card"><div class="modal-header"><div><p class="modal-kicker">PERSONAL NOTE</p><h2>${note ? "\u7f16\u8f91\u7b14\u8bb0" : "\u65b0\u5efa\u7b14\u8bb0"}</h2><p class="modal-hint">\u7b14\u8bb0\u4e0e\u5c97\u4f4d\u6570\u636e\u76f8\u4e92\u72ec\u7acb\uff0c\u53ef\u7528\u4e8e\u8bb0\u5f55\u601d\u8def\u548c\u590d\u76d8\u3002</p></div><button class="modal-close" type="button" data-close aria-label="\u5173\u95ed">\u00d7</button></div><div class="dialog-body"><div class="field"><label>\u6807\u9898</label><input class="input" name="title" required value="${esc(note?.title || "")}" placeholder="\u4f8b\uff1a\u5b57\u8282\u540e\u7aef\u5c97\u4f4d\u6295\u9012\u5224\u65ad"></div><div class="field"><label>\u5185\u5bb9</label><textarea class="textarea" name="content" rows="10" placeholder="\u5199\u4e0b\u5c97\u4f4d\u4f18\u5148\u7ea7\u3001\u7b80\u5386\u8c03\u6574\u70b9\u3001\u9762\u8bd5\u590d\u76d8\u7b49\u2026">${esc(note?.content || "")}</textarea></div><label class="muted" style="display:flex;align-items:center;gap:8px"><input type="checkbox" name="is_pinned" ${note?.is_pinned ? "checked" : ""}> \u7f6e\u9876\u8fd9\u6761\u7b14\u8bb0</label></div><div class="dialog-actions"><button type="button" data-close>\u53d6\u6d88</button><button class="primary" type="submit">${note ? "\u4fdd\u5b58\u4fee\u6539" : "\u4fdd\u5b58\u7b14\u8bb0"}</button></div></form>`;
    document.body.appendChild(modal);
    modal.querySelectorAll("[data-close]").forEach((button) => button.onclick = () => modal.remove());
    modal.onclick = (event) => { if (event.target === modal) modal.remove(); };
    const form = modal.querySelector("form");
    form.onsubmit = async (event) => {
      event.preventDefault();
      const submit = form.querySelector('button[type="submit"]');
      submit.disabled = true;
      const data = Object.fromEntries(new FormData(form));
      data.is_pinned = form.elements.namedItem("is_pinned").checked;
      try {
        if (note) await api(`/api/notes/${note.id}`, { method: "PATCH", body: JSON.stringify(data) });
        else await api("/api/notes", { method: "POST", body: JSON.stringify(data) });
        modal.remove();
        toast(note ? "\u7b14\u8bb0\u5df2\u4fdd\u5b58" : "\u7b14\u8bb0\u5df2\u65b0\u5efa");
        await renderNotes();
      } catch (error) {
        showError(error);
        submit.disabled = false;
      }
    };
    requestAnimationFrame(() => form.elements.namedItem("title").focus());
  }

  async function renderSources() {
    currentView = "sources";
    const items = await api("/api/sources");
    shell("来源与关键词", "管理可自动采集的公开岗位来源", `<div class="detail-actions"><button class="primary" id="collectNow">立即采集</button><button id="addSource">新增来源</button></div><div class="list" style="margin-top:16px">${items.length ? items.map((item) => `<div class="job"><h3>${esc(item.name)}</h3><div class="meta">${esc(item.source_type)} · ${esc(item.base_url)} · 关键词：${esc(item.keywords || "无")} · 上次采集：${esc(item.last_crawled_at || "从未")}</div>${item.last_error ? `<div class="muted">错误：${esc(item.last_error)}</div>` : ""}</div>`).join("") : '<div class="empty">暂无来源</div>'}</div>`);
    document.getElementById("collectNow").onclick = refreshSources;
    document.getElementById("addSource").onclick = manageSources;
    document.getElementById("refresh").onclick = renderSources;
  }

  async function manageSources() {
    const choice = prompt("输入 greenhouse 或 lever 新增结构化来源；取消则不修改。");
    if (choice !== "greenhouse" && choice !== "lever") return;
    const name = prompt("来源名称");
    const baseUrl = prompt("来源 board/company URL");
    const keywords = prompt("关键词（可选）", "AI");
    if (name && baseUrl) {
      await api("/api/sources", { method: "POST", body: JSON.stringify({ name, source_type: choice, base_url: baseUrl, keywords }) });
      toast("来源已添加");
      if (currentView === "sources") await renderSources();
    }
  }

  async function refreshSources() {
    const result = await api("/api/sources/collect", { method: "POST", body: JSON.stringify({}) });
    toast(`采集完成，新增 ${result.results.filter((item) => item.created).length} 个岗位。`);
    await renderSources();
  }

  async function importChatGPTText() {
    if (document.getElementById("chatgptImportModal")) return;
    const modal = document.createElement("div");
    modal.id = "chatgptImportModal";
    modal.className = "modal open";
    modal.innerHTML = `<div class="modal-card"><div class="modal-header"><div><p class="modal-kicker">BATCH IMPORT</p><h2>从 ChatGPT 批量导入岗位</h2><p class="modal-hint">支持 JSON 文件、纯 JSON、JSON 代码块。可选来源分类：${sourceCategories.join("、")}。</p></div><button class="modal-close" type="button" data-close>×</button></div><div class="modal-body"><input type="file" accept=".json,application/json" style="margin:8px 0 14px"><textarea class="textarea" rows="12" placeholder='[{"company":"...","role":"...","job_url":"https://...","source_category":"公司官网"}]'></textarea></div><div class="modal-actions"><button data-close>取消</button><button class="primary" data-import>导入岗位</button></div></div>`;
    document.body.appendChild(modal);
    const file = modal.querySelector("input[type=file]");
    const textarea = modal.querySelector("textarea");
    file.onchange = async () => { if (file.files[0]) textarea.value = await file.files[0].text(); };
    modal.querySelectorAll("[data-close]").forEach((button) => button.onclick = () => modal.remove());
    modal.querySelector("[data-import]").onclick = async () => {
      const text = textarea.value.trim();
      if (!text) return toast("请先选择 JSON 文件或粘贴内容", true);
      try {
        const result = await api("/api/jobs/import-text", { method: "POST", body: JSON.stringify({ text }) });
        modal.remove();
        toast(`批量导入完成：${result.created}/${result.total} 个岗位`);
        await window.showJobsDashboard();
        nav.forEach((item) => item.classList.toggle("active", item.dataset.view === "jobs"));
        currentView = "jobs";
      } catch (error) {
        showError(error);
      }
    };
  }

  function confirmDialog({ title, message, confirmText = "确认", danger = false }) {
    return new Promise((resolve) => {
      const modal = document.createElement("div");
      modal.className = "modal open";
      modal.innerHTML = `<div class="modal-card dialog-card"><div class="modal-header"><div><p class="modal-kicker">PLEASE CONFIRM</p><h2>${esc(title)}</h2><p class="modal-hint">${esc(message)}</p></div><button class="modal-close" type="button" data-cancel>×</button></div><div class="dialog-actions"><button data-cancel>取消</button><button class="${danger ? "danger" : "primary"}" data-confirm>${esc(confirmText)}</button></div></div>`;
      document.body.appendChild(modal);
      const close = (value) => { modal.remove(); resolve(value); };
      modal.querySelectorAll("[data-cancel]").forEach((button) => button.onclick = () => close(false));
      modal.querySelector("[data-confirm]").onclick = () => close(true);
      modal.onclick = (event) => { if (event.target === modal) close(false); };
    });
  }

  function toast(message, error = false) {
    let region = document.querySelector(".toast-region");
    if (!region) {
      region = document.createElement("div");
      region.className = "toast-region";
      document.body.appendChild(region);
    }
    const item = document.createElement("div");
    item.className = `toast${error ? " error" : ""}`;
    item.textContent = message;
    region.appendChild(item);
    setTimeout(() => item.remove(), 3200);
  }

  function showError(error) {
    toast(error?.message || String(error), true);
  }

  function reviewLabel(status) {
    return { pending_review: "待人工确认", confirmed: "已确认", rejected: "已排除", expired: "已过期" }[status] || status;
  }

  function formatDate(value) {
    if (!value) return "";
    const date = new Date(String(value).replace(" ", "T"));
    if (Number.isNaN(date.valueOf())) return String(value);
    return date.toLocaleString("zh-CN", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit", hour12: false });
  }

  function toDateTimeInput(value) {
    if (!value) return "";
    const date = new Date(String(value).replace(" ", "T"));
    if (Number.isNaN(date.valueOf())) return "";
    const local = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
    return local.toISOString().slice(0, 16);
  }

  function futureDate(days) {
    const date = new Date();
    date.setDate(date.getDate() + days);
    date.setHours(18, 0, 0, 0);
    const local = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
    return local.toISOString().slice(0, 16);
  }
})();

export const workflowStages = [
  { key: "collected", label: "已收集" },
  { key: "review", label: "人工审核" },
  { key: "resume", label: "简历准备" },
  { key: "ready", label: "待投递" },
  { key: "submitted", label: "已投递" },
  { key: "interview", label: "面试" },
  { key: "result", label: "结果" }
];

export const terminalApplicationStatuses = new Set([
  "offer", "rejected", "withdrawn", "no_response", "failed"
]);

const applicationStageIndexes = {
  collected: 2,
  matched: 2,
  resume_editing: 2,
  resume_ready: 2,
  ready_to_submit: 3,
  form_filled: 3,
  waiting_review: 3,
  submitted: 4,
  hr_contacted: 4,
  first_interview_invited: 5,
  first_interview_done: 5,
  first_interview_passed: 5,
  second_interview_invited: 5,
  second_interview_done: 5,
  offer: 6,
  rejected: 6,
  withdrawn: 6,
  no_response: 6,
  failed: 6
};

export function workflowStage({ review_status, application_status, resume_count = 0 }) {
  if (application_status) {
    const index = applicationStageIndexes[application_status] ?? 2;
    return {
      ...workflowStages[index],
      index,
      terminal: terminalApplicationStatuses.has(application_status),
      outcome: terminalApplicationStatuses.has(application_status) ? application_status : null
    };
  }

  if (review_status === "rejected" || review_status === "expired") {
    return {
      ...workflowStages[6],
      index: 6,
      terminal: true,
      outcome: review_status
    };
  }

  if (review_status === "confirmed") {
    return {
      ...workflowStages[2],
      index: 2,
      terminal: false,
      outcome: null,
      has_resume: Number(resume_count) > 0
    };
  }

  return {
    ...workflowStages[1],
    index: 1,
    terminal: false,
    outcome: null
  };
}

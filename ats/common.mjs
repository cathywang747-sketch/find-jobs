import { profileFields } from "./profile.mjs";

export async function extractBasicJob(page, selectors = {}) {
  return await page.evaluate((selectors) => {
    const text = (selector) => document.querySelector(selector)?.textContent?.trim() || "";
    const first = (items) => items.map(text).find(Boolean) || "";
    return {
      title: first(selectors.title || ["h1"]),
      company: first(selectors.company || []),
      location: first(selectors.location || []),
      url: location.href,
      page_title: document.title
    };
  }, selectors);
}

export async function assessPageSafety(page) {
  return await page.evaluate(() => {
    const passwordCount = document.querySelectorAll("input[type=password]").length;
    const submitCount = document.querySelectorAll("button[type=submit], input[type=submit]").length;
    return {
      blocked: passwordCount > 0,
      reasons: passwordCount > 0 ? ["password_or_login_required"] : [],
      submit_controls_seen: submitCount,
      policy: [
        "never_fill_passwords",
        "never_create_accounts",
        "never_click_submit",
        "leave_sensitive_questions_for_review"
      ]
    };
  });
}

export async function fillCommonFields(page, profile, options = {}) {
  const fields = profileFields(profile);
  const filled = [];
  const skipped = [];

  const specs = [
    { name: "first_name", value: fields.firstName, patterns: [/first\s*name/i, /given\s*name/i] },
    { name: "last_name", value: fields.lastName, patterns: [/last\s*name/i, /family\s*name/i, /surname/i] },
    { name: "name", value: fields.name, selector: '#formily-item-name[data-form-field-i18n-name="\u59d3\u540d"] input[data-form-field-name="name"]', patterns: [/full\s*name/i, /^name$/i, /candidate\s*name/i, /\u59d3\u540d/] },
    { name: "email", value: fields.email, selector: '#formily-item-email[data-form-field-i18n-name="\u90ae\u7bb1"] input[data-form-field-name="email"]', patterns: [/e-?mail/i, /\u90ae\u7bb1/] },
    { name: "phone", value: fields.phone, selector: '#formily-item-mobile[data-form-field-i18n-name="\u624b\u673a\u53f7\u7801"] input[data-form-field-name="mobile"]', patterns: [/phone/i, /mobile/i, /telephone/i, /\u624b\u673a\u53f7\u7801/] },
    { name: "location", value: fields.location, patterns: [/current\s*location/i, /^location$/i, /^city$/i, /city.*country/i, /\u6240\u5728\u5730\u70b9/] },
    { name: "identification", value: fields.identification, patterns: [/identification/i, /个人证件/i, /id\s*(number|no\.?)/i] },
    { name: "home_address", value: fields.homeAddress, patterns: [/home\s*address/i, /家庭住址/i] },
    { name: "hometown", value: fields.hometown, patterns: [/hometown/i, /家乡/i] },
    { name: "preferred_work_location", value: fields.preferredWorkLocation, patterns: [/preferred\s*(work\s*)?location/i, /期望工作地点/i] },
    { name: "self_evaluation", value: fields.selfEvaluation, patterns: [/self\s*(evaluation|introduction)/i, /自我评价/i] },
    { name: "linkedin", value: fields.linkedin, patterns: [/linkedin/i] },
    { name: "github", value: fields.github, patterns: [/github/i] }
  ];

  for (const spec of specs) await fillOne(page, spec, filled, skipped);
  await fillRepeatableSections(page, profile, filled, skipped);

  if (options.resumePath) {
    await uploadFile(page, /resume|cv/i, options.resumePath, "resume", filled, skipped);
  }
  if (options.coverLetterPath) {
    await uploadFile(page, /cover/i, options.coverLetterPath, "cover_letter", filled, skipped);
  }

  return { filled, skipped };
}

const repeatableSectionSpecs = [
  {
    profileKey: "education",
    groupField: "education_list",
    recordField: "school",
    label: "education",
    textFields: ["school", "faculty", "field_of_study", "research_field", "supervisor", "academic_ranking"],
    selectFields: ["education_type", "degree"],
    dateFields: ["start_date", "end_date"]
  },
  {
    profileKey: "experience",
    groupField: "internship_list",
    recordField: "company",
    label: "internship",
    disableCheckbox: "没有实习经历",
    textFields: ["company", "title", "desc"]
  },
  {
    profileKey: "career",
    groupField: "career_list",
    recordField: "company",
    label: "career",
    textFields: ["company", "title", "desc"]
  },
  {
    profileKey: "projects",
    groupField: "project_list",
    recordField: "name",
    label: "project",
    textFields: ["name", "role", "link", "desc"]
  }
];

async function fillRepeatableSections(page, profile, filled, skipped) {
  for (const spec of repeatableSectionSpecs) {
    const items = profile[spec.profileKey];
    if (!Array.isArray(items) || items.length === 0) continue;

    const idGroups = page.locator(`#formily-item-${spec.groupField}`);
    const idGroupCount = await idGroups.count().catch(() => 0);
    const dataGroups = page.locator(`[data-form-field-name="${spec.groupField}"]`);
    const dataGroupCount = await dataGroups.count().catch(() => 0);
    const groups = idGroupCount > 0 ? idGroups : dataGroups;
    const groupCount = idGroupCount > 0 ? idGroupCount : dataGroupCount;
    if (groupCount !== 1) {
      skipped.push({ name: spec.label, reason: groupCount === 0 ? "section_not_found" : "section_ambiguous" });
      continue;
    }

    const group = groups;
    if (spec.disableCheckbox) {
      const checkbox = page.getByRole("checkbox", { name: spec.disableCheckbox, exact: true });
      const checkboxCount = await checkbox.count().catch(() => 0);
      if (checkboxCount === 1) await checkbox.setChecked(false).catch(() => {});
    }

    const existing = await countRepeatedControls(group, spec.recordField);
    const buttons = group.locator("button");
    const buttonCount = await buttons.count().catch(() => 0);
    const textAddButtons = buttons.filter({ hasText: /\u6dfb\u52a0/ });
    const textAddButtonCount = await textAddButtons.count().catch(() => 0);
    const addButton = textAddButtonCount === 1 ? textAddButtons : buttonCount === 1 ? buttons : null;
    const addButtonCount = addButton ? 1 : 0;
    if (addButtonCount !== 1 && existing < items.length) {
      skipped.push({ name: spec.label, reason: addButtonCount === 0 ? "add_button_not_found" : "add_button_ambiguous" });
      continue;
    }

    let recordCount = existing;
    let attempts = 0;
    while (recordCount < items.length && attempts < items.length + 2) {
      await addButton.click();
      await page.waitForTimeout(50);
      const nextCount = await countRepeatedControls(group, spec.recordField);
      if (nextCount <= recordCount) break;
      recordCount = nextCount;
      attempts++;
    }

    if (recordCount < items.length) {
      skipped.push({ name: spec.label, reason: `only_${recordCount}_of_${items.length}_records_created` });
      continue;
    }

    for (let index = 0; index < items.length; index++) {
      const item = items[index] ?? {};
      for (const fieldName of spec.textFields) {
        const value = repeatedValue(item, fieldName);
        if (value) await fillRepeatedText(group, fieldName, index, value, `${spec.label}[${index}].${fieldName}`, filled, skipped);
      }
      for (const fieldName of spec.selectFields ?? []) {
        const value = repeatedValue(item, fieldName);
        if (value) await fillRepeatedSelect(page, group, fieldName, index, value, `${spec.label}[${index}].${fieldName}`, filled, skipped);
      }
      if (spec.dateFields) {
        await fillRepeatedDateRange(group, index, item.start_date, item.end_date, `${spec.label}[${index}].time_period`, filled, skipped);
      }
    }
  }
}

function repeatedValue(item, fieldName) {
  if (fieldName === "field_of_study") return item.field_of_study ?? item.major ?? "";
  if (fieldName === "desc") return Array.isArray(item.bullets) ? item.bullets.join("\n") : item.desc ?? "";
  if (fieldName === "title") return item.title ?? item.role ?? "";
  return item[fieldName] ?? "";
}

async function countRepeatedControls(group, fieldName) {
  return await group.locator(`input[data-form-field-name="${fieldName}"], textarea[data-form-field-name="${fieldName}"]`).count().catch(() => 0);
}

async function fillRepeatedText(group, fieldName, index, value, name, filled, skipped) {
  const controls = group.locator(`input[data-form-field-name="${fieldName}"], textarea[data-form-field-name="${fieldName}"]`);
  const count = await controls.count().catch(() => 0);
  if (count <= index) {
    skipped.push({ name, reason: "field_not_found" });
    return;
  }
  await controls.nth(index).fill(String(value));
  filled.push(name);
}

async function fillRepeatedSelect(page, group, fieldName, index, value, name, filled, skipped) {
  const wrappers = group.locator(`[data-form-field-name="${fieldName}"]`);
  const wrapperCount = await wrappers.count().catch(() => 0);
  if (wrapperCount <= index) {
    skipped.push({ name, reason: "select_not_found" });
    return;
  }
  const wrapper = wrappers.nth(index);
  const controls = wrapper.getByRole("combobox");
  const controlCount = await controls.count().catch(() => 0);
  if (controlCount !== 1) {
    skipped.push({ name, reason: "select_ambiguous" });
    return;
  }
  await controls.click();
  const option = page.getByRole("option", { name: String(value), exact: true });
  const optionCount = await option.count().catch(() => 0);
  if (optionCount === 1) {
    await option.click();
    filled.push(name);
    return;
  }
  skipped.push({ name, reason: "option_not_found" });
}

async function fillRepeatedDateRange(group, index, start, end, name, filled, skipped) {
  if (!start && !end) return;
  const ranges = group.locator(`[data-form-field-name="start_end_time"]`);
  const rangeCount = await ranges.count().catch(() => 0);
  if (rangeCount <= index) {
    skipped.push({ name, reason: "date_range_not_found" });
    return;
  }
  const inputs = ranges.nth(index).locator("input");
  const inputCount = await inputs.count().catch(() => 0);
  if (inputCount < 2) {
    skipped.push({ name, reason: "date_range_incomplete" });
    return;
  }
  if (start) await inputs.nth(0).fill(String(start));
  if (end) await inputs.nth(1).fill(String(end));
  filled.push(name);
}

async function fillOne(page, spec, filled, skipped) {
  const { name, patterns, value } = spec;
  if (!value) {
    skipped.push({ name, reason: "empty_value" });
    return;
  }
  if (spec.selector) {
    const targeted = page.locator(spec.selector);
    const targetedCount = await targeted.count().catch(() => 0);
    if (targetedCount === 1) {
      await targeted.fill(String(value));
      filled.push(name);
      return;
    }
    if (targetedCount > 1) {
      skipped.push({ name, reason: "selector_ambiguous" });
      return;
    }
  }
  const didFill = await page.evaluate(({ patterns, value }) => {
    const regexes = patterns.map((source) => new RegExp(source.source, source.flags));
    const controls = [...document.querySelectorAll("input, textarea")]
      .filter((el) => {
        const type = (el.getAttribute("type") || "text").toLowerCase();
        return !["hidden", "password", "submit", "button", "checkbox", "radio", "file"].includes(type) && !el.disabled && !el.readOnly;
      });
    for (const el of controls) {
      const meta = controlText(el);
      if (!regexes.some((regex) => regex.test(meta))) continue;
      el.focus();
      el.value = value;
      el.dispatchEvent(new Event("input", { bubbles: true }));
      el.dispatchEvent(new Event("change", { bubbles: true }));
      return true;
    }
    return false;

    function controlText(el) {
      const id = el.id ? CSS.escape(el.id) : "";
      const label = id ? document.querySelector(`label[for="${id}"]`)?.textContent : "";
      return [
        label,
        el.closest("label")?.textContent,
        el.getAttribute("data-form-field-name"),
        el.getAttribute("data-form-field-i18n-name"),
        el.getAttribute("aria-label"),
        el.getAttribute("placeholder"),
        el.getAttribute("name"),
        el.id,
        el.parentElement?.textContent
      ].filter(Boolean).join(" ").trim();
    }
  }, { patterns: patterns.map((pattern) => ({ source: pattern.source, flags: pattern.flags })), value }).catch(() => false);
  if (didFill) {
    filled.push(name);
    return;
  }
  skipped.push({ name, reason: "not_found" });
}

async function uploadFile(page, pattern, filePath, name, filled, skipped) {
  const inputs = page.locator("input[type=file]");
  const count = await inputs.count().catch(() => 0);
  for (let i = 0; i < count; i++) {
    const input = inputs.nth(i);
    const meta = await input.evaluate((el) =>
      [el.name, el.id, el.getAttribute("aria-label"), el.closest("label")?.textContent].filter(Boolean).join(" ")
    ).catch(() => "");
    if (pattern.test(meta)) {
      await input.setInputFiles(filePath);
      filled.push(name);
      return;
    }
  }
  skipped.push({ name, reason: "file_input_not_found" });
}

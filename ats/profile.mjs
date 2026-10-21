import fs from "node:fs";
import path from "node:path";

const defaultProfilePath = path.resolve(process.env.PROFILE_PATH || "data/profile.yaml");

export function loadProfile(profilePath = defaultProfilePath) {
  const text = fs.readFileSync(profilePath, "utf8");
  return parseSimpleYaml(text);
}

export function profileFields(profile) {
  const name = profile.basic?.name ?? "";
  const parts = name.trim().split(/\s+/);
  return {
    name,
    firstName: parts[0] ?? "",
    lastName: parts.slice(1).join(" ") || parts[0] || "",
    email: profile.basic?.email ?? "",
    phone: profile.basic?.phone ?? "",
    location: profile.basic?.location ?? "",
    identification: profile.basic?.identification ?? "",
    preferredWorkLocation: profile.basic?.preferred_work_location ?? "",
    hometown: profile.basic?.hometown ?? "",
    birthday: profile.basic?.birthday ?? "",
    maritalStatus: profile.basic?.marital_status ?? "",
    homeAddress: profile.basic?.home_address ?? "",
    registeredLocation: profile.basic?.registered_location ?? "",
    nationality: profile.basic?.nationality ?? "",
    gender: profile.basic?.gender ?? "",
    age: profile.basic?.age ?? "",
    experienceYears: profile.basic?.experience_years ?? "",
    selfEvaluation: profile.self_evaluation?.text ?? "",
    linkedin: profile.social_accounts?.linkedin ?? "",
    github: profile.social_accounts?.github ?? ""
  };
}

export function parseSimpleYaml(text) {
  const result = {};
  let section = null;
  let currentItem = null;
  let currentKey = null;

  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/\s+#.*$/, "");
    if (!line.trim()) continue;

    const top = line.match(/^([A-Za-z_][\w-]*):\s*$/);
    if (top) {
      section = top[1];
      result[section] = ["education", "experience", "projects", "skills"].includes(section) ? [] : {};
      currentItem = null;
      currentKey = null;
      continue;
    }

    if (!section) continue;

    const listScalar = line.match(/^  - (.+)$/);
    if (listScalar && section === "skills") {
      result[section].push(clean(listScalar[1]));
      continue;
    }

    const listObject = line.match(/^  - ([\w-]+):\s*(.*)$/);
    if (listObject) {
      currentItem = { [listObject[1]]: clean(listObject[2]) };
      result[section].push(currentItem);
      currentKey = null;
      continue;
    }

    const nestedListKey = line.match(/^    ([\w-]+):\s*$/);
    if (nestedListKey && currentItem) {
      currentKey = nestedListKey[1];
      currentItem[currentKey] = [];
      continue;
    }

    const nestedListValue = line.match(/^      - (.+)$/);
    if (nestedListValue && currentItem && currentKey) {
      currentItem[currentKey].push(clean(nestedListValue[1]));
      continue;
    }

    const listObjectValue = line.match(/^    ([\w-]+):\s*(.*)$/);
    if (listObjectValue && currentItem) {
      currentItem[listObjectValue[1]] = clean(listObjectValue[2]);
      currentKey = null;
      continue;
    }

    const sectionValue = line.match(/^  ([\w-]+):\s*(.*)$/);
    if (sectionValue && !Array.isArray(result[section])) {
      result[section][sectionValue[1]] = clean(sectionValue[2]);
    } else if (sectionValue && currentItem) {
      currentItem[sectionValue[1]] = clean(sectionValue[2]);
    }
  }

  return result;
}

function clean(value) {
  return value.replace(/^["']|["']$/g, "");
}

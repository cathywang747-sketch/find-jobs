import { assessPageSafety, extractBasicJob, fillCommonFields } from "./common.mjs";

export const generic = {
  type: "generic",
  matches() {
    return true;
  },
  async extractJob(page) {
    return await extractBasicJob(page, {
      title: ["h1", "h2", "[class*='title']", "[class*='job']"],
      company: ["[class*='company']", "[data-company]"],
      location: ["[class*='location']", "[class*='city']"]
    });
  },
  async fillApplication(page, profile, options) {
    const safety = await assessPageSafety(page);
    if (safety.blocked) return { filled: [], skipped: safety.reasons.map((reason) => ({ name: "page", reason })), safety };
    return { ...(await fillCommonFields(page, profile, options)), safety };
  }
};

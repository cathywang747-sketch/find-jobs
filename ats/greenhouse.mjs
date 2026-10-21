import { extractBasicJob, fillCommonFields } from "./common.mjs";

export const greenhouse = {
  type: "greenhouse",
  matches(url) {
    return /(^|\.)greenhouse\.io\//i.test(new URL(url).hostname + new URL(url).pathname);
  },
  async extractJob(page) {
    return await extractBasicJob(page, {
      title: ["h1", ".app-title", ".job__title"],
      company: [".company-name", "[data-mapped='company']"],
      location: [".location", ".app-location", "[data-mapped='location']"]
    });
  },
  async fillApplication(page, profile, options) {
    return await fillCommonFields(page, profile, options);
  }
};

import { extractBasicJob, fillCommonFields } from "./common.mjs";

export const lever = {
  type: "lever",
  matches(url) {
    return /^jobs\.lever\.co$/i.test(new URL(url).hostname);
  },
  async extractJob(page) {
    return await extractBasicJob(page, {
      title: [".posting-headline h2", "h1", "h2"],
      company: [".main-header-logo img[alt]", ".posting-company"],
      location: [".posting-categories .location", "[class*='location']"]
    });
  },
  async fillApplication(page, profile, options) {
    return await fillCommonFields(page, profile, options);
  }
};

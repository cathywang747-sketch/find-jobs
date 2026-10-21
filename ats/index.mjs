import { adapterFor, detectAts } from "./detect.mjs";
import { loadProfile } from "./profile.mjs";

export { detectAts, adapterFor };

export async function fillCurrentPage(page, options = {}) {
  const profile = options.profile ?? loadProfile(options.profilePath);
  const url = page.url();
  const adapter = adapterFor(url);
  const job = await adapter.extractJob(page);
  const fill = await adapter.fillApplication(page, profile, options);
  return {
    ok: !fill.safety?.blocked,
    ats_type: adapter.type,
    url,
    job,
    fill,
    safety: fill.safety,
    next_status: "waiting_review"
  };
}

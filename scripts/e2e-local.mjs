import assert from "node:assert/strict";
import { fillCurrentPage } from "../ats/index.mjs";
import { loadProfile, profileFields } from "../ats/profile.mjs";
import { chromium } from "playwright";

const profilePath = "data/profile.example.yaml";
const profile = loadProfile(profilePath);
const fields = profileFields(profile);

await runCase({
  name: "greenhouse",
  url: "https://boards.greenhouse.io/acme/jobs/123",
  expectedAts: "greenhouse",
  html: `
    <h1>AI Solutions Intern</h1>
    <div class="company-name">Acme Health AI</div>
    <div class="location">Beijing</div>
    <form>
      <label>First Name <input name="first_name"></label>
      <label>Last Name <input name="last_name"></label>
      <label>Email <input name="email"></label>
      <label>Phone <input name="phone"></label>
      <label>Location <input name="location"></label>
      <button type="submit">Submit Application</button>
    </form>
  `
});

await runCase({
  name: "lever",
  url: "https://jobs.lever.co/acme/456",
  expectedAts: "lever",
  html: `
    <div class="posting-headline"><h2>Medical AI Intern</h2></div>
    <div class="posting-company">Acme Medical</div>
    <div class="posting-categories"><span class="location">Tokyo</span></div>
    <form>
      <label>Full Name <input name="name"></label>
      <label>Email <input name="email"></label>
      <label>Phone <input name="phone"></label>
      <label>Current Location <input name="location"></label>
      <button type="submit">Submit Application</button>
    </form>
  `
});

await runCase({
  name: "generic",
  url: "https://careers.example.com/jobs/789",
  expectedAts: "generic",
  html: `
    <h1>Healthcare AI Associate</h1>
    <form>
      <input id="candidate" placeholder="Candidate Name">
      <input name="email_address" placeholder="Your email">
      <input id="mobile-number" aria-label="Mobile number">
      <input name="current_city" placeholder="Current Location">
      <button type="submit">Submit Application</button>
    </form>
  `
});

await runRepeatableCase();
await runBlockedCase();

console.log("e2e-local ok");

async function runCase(test) {
  const browser = await chromium.launch({ channel: "chrome", headless: true });
  const page = await browser.newPage();
  await page.route(test.url, (route) => route.fulfill({ contentType: "text/html", body: test.html }));
  await page.goto(test.url);

  const result = await fillCurrentPage(page, { profilePath });
  const values = await page.locator("input").evaluateAll((inputs) =>
    Object.fromEntries(inputs.map((input) => [input.name, input.value]))
  );

  await browser.close();

  assert.equal(result.ok, true, test.name);
  assert.equal(result.ats_type, test.expectedAts, test.name);
  assert.equal(result.next_status, "waiting_review", test.name);
  assert.match(result.job.title, /AI|Intern/i, test.name);
  assert.ok(Object.values(values).includes(fields.email), test.name);
  assert.ok(Object.values(values).includes(fields.phone), test.name);
}

async function runBlockedCase() {
  const url = "https://careers.example.com/login";
  const browser = await chromium.launch({ channel: "chrome", headless: true });
  const page = await browser.newPage();
  await page.route(url, (route) => route.fulfill({
    contentType: "text/html",
    body: `<h1>Login required</h1><label>Password <input type="password" name="password"></label>`
  }));
  await page.goto(url);
  const result = await fillCurrentPage(page, { profilePath });
  await browser.close();
  assert.equal(result.ok, false, "password page must be blocked");
  assert.equal(result.ats_type, "generic");
  assert.deepEqual(result.safety.reasons, ["password_or_login_required"]);
}

async function runRepeatableCase() {
  const url = "https://careers.example.com/jobs/repeatable";
  const browser = await chromium.launch({ channel: "chrome", headless: true });
  const page = await browser.newPage();
  await page.route(url, (route) => route.fulfill({
    contentType: "text/html",
    body: `
      <h1>Education test</h1>
      <form>
        <div data-form-field-name="education_list">
          <div class="education-item">
            <input data-form-field-name="school">
            <input data-form-field-name="field_of_study">
          </div>
          <button type="button" id="add-education">添加</button>
        </div>
      </form>
      <script>
        document.querySelector('#add-education').addEventListener('click', () => {
          const item = document.createElement('div');
          item.className = 'education-item';
          item.innerHTML = '<input data-form-field-name="school"><input data-form-field-name="field_of_study">';
          document.querySelector('[data-form-field-name="education_list"]').insertBefore(item, document.querySelector('#add-education'));
        });
      </script>
    `
  }));
  await page.goto(url);

  const repeatableProfile = {
    basic: { name: "Demo Candidate", email: "candidate@example.com", phone: "000-0000-0000" },
    education: [
      { school: "Example University", field_of_study: "Computer Science" },
      { school: "Demo College", field_of_study: "Information Technology" }
    ]
  };
  const result = await fillCurrentPage(page, { profile: repeatableProfile });
  const values = await page.locator('input[data-form-field-name="school"]').evaluateAll((inputs) => inputs.map((input) => input.value));

  await browser.close();

  assert.equal(result.ok, true, "repeatable");
  assert.deepEqual(values, ["Example University", "Demo College"]);
}

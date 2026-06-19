// Pure builders for talking to the OpenProject REST API.
//
// These hold no network or module-level state so they can be unit-tested in
// isolation. `index.js` imports them so the running server and the tests use
// the exact same payload/auth construction.

// OpenProject uses HTTP Basic auth with the literal username "apikey" and the
// API token as the password. Returns the full "Basic <base64>" header value.
export function buildAuthHeader(apiToken) {
  return "Basic " + Buffer.from(`apikey:${apiToken ?? ""}`).toString("base64");
}

// Build the HAL+JSON body for creating a Work Package (Kanban task).
export function buildWorkPackagePayload({ project_name, user_id, subject, description }) {
  return {
    subject,
    description: {
      format: "markdown",
      raw: description,
    },
    _links: {
      project: { href: `/api/v3/projects/${project_name}` },
      assignee: { href: `/api/v3/users/${user_id}` },
      type: { href: "/api/v3/types/1" },
    },
  };
}

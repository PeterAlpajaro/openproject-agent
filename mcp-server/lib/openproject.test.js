import { describe, it, expect } from "vitest";
import { buildAuthHeader, buildWorkPackagePayload } from "./openproject.js";

describe("buildAuthHeader", () => {
  it("encodes 'apikey:<token>' as Basic base64", () => {
    const header = buildAuthHeader("secret-token");
    expect(header).toBe("Basic " + Buffer.from("apikey:secret-token").toString("base64"));
    // Round-trips back to the documented username/password form.
    const decoded = Buffer.from(header.replace("Basic ", ""), "base64").toString("utf8");
    expect(decoded).toBe("apikey:secret-token");
  });

  it("treats a missing token as an empty password rather than 'undefined'", () => {
    const decoded = Buffer.from(buildAuthHeader(undefined).replace("Basic ", ""), "base64").toString(
      "utf8"
    );
    expect(decoded).toBe("apikey:");
  });
});

describe("buildWorkPackagePayload", () => {
  const args = {
    project_name: "bci-vr-console",
    user_id: 5,
    subject: "Phase 1 Test",
    description: "A **markdown** body",
  };

  it("places the subject at the top level", () => {
    expect(buildWorkPackagePayload(args).subject).toBe("Phase 1 Test");
  });

  it("wraps the description as markdown HAL format", () => {
    expect(buildWorkPackagePayload(args).description).toEqual({
      format: "markdown",
      raw: "A **markdown** body",
    });
  });

  it("builds the project, assignee, and type HAL links from the inputs", () => {
    const { _links } = buildWorkPackagePayload(args);
    expect(_links.project.href).toBe("/api/v3/projects/bci-vr-console");
    expect(_links.assignee.href).toBe("/api/v3/users/5");
    expect(_links.type.href).toBe("/api/v3/types/1");
  });
});

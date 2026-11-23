import { describe, expect, it } from "vitest";
import { imageTag, pairCommands } from "./pairCommands.ts";

const base = { hubUrl: "https://maker.example.com", code: "AB12-CD34", version: "6.3.0" };

describe("pairCommands", () => {
  it("fills the hub's address and the code into each way to pair", () => {
    const c = pairCommands(base);
    expect(c.docker).toContain('CONNECTOR_HUB_URL: "https://maker.example.com"');
    expect(c.docker).toContain('CONNECTOR_PAIRING_CODE: "AB12-CD34"');
    expect(c.docker).toContain("network_mode: host");
    expect(c.docker).toContain("propagation: rslave");
    expect(c.docker).toContain("# PUID: 1000");
    expect(c.docker).toContain("3d-maker-suite-connector:latest");
    expect(c.linux).toContain(
      "./install.sh --headless --hub-url https://maker.example.com --pairing-code AB12-CD34",
    );
    expect(c.linux).toContain("3d-maker-suite-connector-6.3.0-linux-x64.tar.gz");
    expect(c.windows).toBe(
      ".\\3d-maker-suite-connector-6.3.0-windows-x64-setup.exe /VERYSILENT /SUPPRESSMSGBOXES /ALLUSERS /HEADLESS /HUBURL=https://maker.example.com /PAIRINGCODE=AB12-CD34",
    );
  });

  it("quotes an address a shell would split, and never lets a quote out of it", () => {
    const c = pairCommands({ ...base, hubUrl: "http://nas:4300/a b'c" });
    expect(c.linux).toContain(`--hub-url 'http://nas:4300/a b'\\''c'`);
    expect(c.windows).toContain("/HUBURL='http://nas:4300/a b''c'");
    expect(c.docker).toContain('"http://nas:4300/a b\'c"');
  });

  it("a pre-release follows the dev image, and an unknown version stays a placeholder", () => {
    expect(imageTag("6.3.0-alpha.1")).toBe("dev");
    expect(imageTag("6.3.0")).toBe("latest");
    expect(pairCommands({ ...base, version: undefined }).linux).toContain("<version>");
  });
});

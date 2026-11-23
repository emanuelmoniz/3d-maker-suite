/**
 * What an admin copies to pair a NAS, server or container (ADR-0024): the connector's compose lines,
 * the Linux service install and the Windows Server silent install, with the hub's address and the
 * one-time code filled in. Only that code is secret, and it works once.
 */

export type PairCommands = { docker: string; linux: string; windows: string };

const SAFE = /^[\w:/.@%+=,-]+$/;
/** A shell word: as is when it needs no quoting, else in single quotes. */
const sh = (v: string) => (SAFE.test(v) ? v : `'${v.replaceAll("'", `'\\''`)}'`);
/** A PowerShell word, the same way (a single quote doubles inside single quotes). */
const ps = (v: string) => (SAFE.test(v) ? v : `'${v.replaceAll("'", "''")}'`);
/** A YAML double-quoted string. */
const yaml = (v: string) => JSON.stringify(v);

/** The image tag that follows the hub: a pre-release's is `dev`, a stable one's `latest`. */
export const imageTag = (version: string | undefined) =>
  version?.includes("-") ? "dev" : "latest";

export function pairCommands({
  hubUrl,
  code,
  version,
}: {
  hubUrl: string;
  code: string;
  /** The hub's version, which names the files to download. */
  version: string | undefined;
}): PairCommands {
  const v = version ?? "<version>";
  const docker = [
    "services:",
    "  connector:",
    `    image: ghcr.io/emanuelmoniz/3d-maker-suite-connector:${imageTag(version)}`,
    "    restart: unless-stopped",
    "    network_mode: host",
    "    environment:",
    `      CONNECTOR_HUB_URL: ${yaml(hubUrl)}`,
    `      CONNECTOR_PAIRING_CODE: ${yaml(code)}`,
    "      # CONNECTOR_NAME: My NAS",
    "      # PUID: 1000",
    "      # PGID: 1000",
    "    volumes:",
    "      - connector-data:/data",
    "      # - type: bind",
    "      #   source: /volume1/3d-files",
    "      #   target: /projects/files",
    "      #   bind:",
    "      #     propagation: rslave",
    "volumes:",
    "  connector-data:",
    "",
  ].join("\n");
  const linux = [
    `tar -xzf 3d-maker-suite-connector-${v}-linux-x64.tar.gz`,
    "cd 3d-maker-suite-connector",
    `./install.sh --headless --hub-url ${sh(hubUrl)} --pairing-code ${sh(code)}`,
  ].join("\n");
  const windows = `.\\3d-maker-suite-connector-${v}-windows-x64-setup.exe /VERYSILENT /SUPPRESSMSGBOXES /ALLUSERS /HEADLESS /HUBURL=${ps(hubUrl)} /PAIRINGCODE=${ps(code)}`;
  return { docker, linux, windows };
}

/** Starts the compose file the dialog shows, saved under that name. */
export const DOCKER_UP = "docker compose -f docker-compose.connector.yml up -d";
/** What a container connector runs to get the hub's version (it never updates itself). */
export const DOCKER_UPDATE =
  "docker compose -f docker-compose.connector.yml pull && docker compose -f docker-compose.connector.yml up -d";

/** The two switches that run the Windows Server connector as a named account (network shares). */
export const WINDOWS_ACCOUNT_SWITCHES = String.raw`/ACCOUNT=DOMAIN\name /PASSWORDFILE=C:\path\password.txt`;

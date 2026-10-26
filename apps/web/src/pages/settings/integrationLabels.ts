import type {
  Capability,
  IntegrationErrorCode,
  IntegrationKind,
  SlicerInstallError,
  SlicerInstallStatus,
} from "@3d-maker-suite/core";

// Literal keys so `pnpm i18n:check` sees them.
export const KINDS: Record<IntegrationKind, string> = {
  cloud: "integrations:kinds.cloud",
  local: "integrations:kinds.local",
  server: "integrations:kinds.server",
};
export const INSTALL_PHASES: Record<NonNullable<SlicerInstallStatus["phase"]>, string> = {
  download: "integrations:managed.phases.download",
  verify: "integrations:managed.phases.verify",
  unpack: "integrations:managed.phases.unpack",
  test: "integrations:managed.phases.test",
};
export const INSTALL_ERRORS: Record<SlicerInstallError, string> = {
  fetch_failed: "integrations:managed.errors.fetch_failed",
  bad_digest: "integrations:managed.errors.bad_digest",
  unpack_failed: "integrations:managed.errors.unpack_failed",
  smoke_failed: "integrations:managed.errors.smoke_failed",
  vcredist_missing: "integrations:managed.errors.vcredist_missing",
};
export const ERRORS: Record<IntegrationErrorCode, string> = {
  auth_required: "integrations:errors.auth_required",
  auth_expired: "integrations:errors.auth_expired",
  rate_limited: "integrations:errors.rate_limited",
  unreachable: "integrations:errors.unreachable",
  login_failed: "integrations:errors.login_failed",
  code_invalid: "integrations:errors.code_invalid",
  blocked: "integrations:errors.blocked",
  api_changed: "integrations:errors.api_changed",
  slice_failed: "integrations:errors.slice_failed",
  unknown: "integrations:errors.unknown",
};
// Also the Type column of the sync log.
export const CAPS: Record<Capability, string> = {
  printers: "integrations:capabilities.printers",
  prints: "integrations:capabilities.prints",
  spools: "integrations:capabilities.spools",
  brands: "integrations:capabilities.brands",
  printerModels: "integrations:capabilities.printerModels",
  machineProfiles: "integrations:capabilities.machineProfiles",
  printProfiles: "integrations:capabilities.printProfiles",
  filamentBrands: "integrations:capabilities.filamentBrands",
  filamentMaterials: "integrations:capabilities.filamentMaterials",
  filamentProfiles: "integrations:capabilities.filamentProfiles",
  openInSlicer: "integrations:capabilities.openInSlicer",
  slice: "integrations:capabilities.slice",
};

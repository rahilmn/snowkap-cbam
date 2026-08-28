/**
 * A nominal ("branded") string type. TypeScript's structural typing would
 * otherwise let any string stand in for, say, an OrganizationId — Brand
 * makes the ID types distinct at the type level while remaining plain
 * strings at runtime.
 */
export type Brand<T, B extends string> =
  T & { readonly __brand: B };

export type OrganizationId =
  Brand<string, "OrganizationId">;

export type UserId =
  Brand<string, "UserId">;

export type MembershipId =
  Brand<string, "MembershipId">;

export type InvitationId =
  Brand<string, "InvitationId">;

export type SupplierId =
  Brand<string, "SupplierId">;

export type OperatorId =
  Brand<string, "OperatorId">;

export type InstallationId =
  Brand<string, "InstallationId">;

export type ShipmentId =
  Brand<string, "ShipmentId">;

export type ShipmentLineId =
  Brand<string, "ShipmentLineId">;

export type EmissionDataId =
  Brand<string, "EmissionDataId">;

export type CalculationResultId =
  Brand<string, "CalculationResultId">;

export type AuditEventId =
  Brand<string, "AuditEventId">;

export type SharingGrantId =
  Brand<string, "SharingGrantId">;

export type DeclarationId =
  Brand<string, "DeclarationId">;

export type EvidenceFileId =
  Brand<string, "EvidenceFileId">;

export type ImportBatchId =
  Brand<string, "ImportBatchId">;

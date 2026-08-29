import {
  describe,
  expect,
  it,
} from "vitest";

import {
  toEvidenceFile,
} from "./evidence-mapper";

import type {
  EvidenceFileRow,
} from "./evidence-mapper";

function evidenceFileRow(
  overrides: Partial<EvidenceFileRow> = {},
): EvidenceFileRow {
  return {
    id: "evidence-1",
    org_id: "org-producer",
    emission_data_id: "emission-1",
    storage_path: "org-producer/emission-1/report.pdf",
    original_filename: "report.pdf",
    mime_type: "application/pdf",
    size_bytes: 12345,
    sha256: "abc123",
    uploaded_by_user_id: "user-1",
    created_at: "2026-08-28T00:00:00.000Z",
    ...overrides,
  };
}

describe(
  "toEvidenceFile",
  () => {
    it(
      "maps every column onto the matching EvidenceFile field",
      () => {
        const row =
          evidenceFileRow();

        const result =
          toEvidenceFile(
            row,
          );

        expect(
          result,
        ).toEqual(
          {
            id: "evidence-1",
            org_id: "org-producer",
            emission_data_id: "emission-1",
            storage_path: "org-producer/emission-1/report.pdf",
            original_filename: "report.pdf",
            mime_type: "application/pdf",
            size_bytes: 12345,
            sha256: "abc123",
            uploaded_by_user_id: "user-1",
            created_at: "2026-08-28T00:00:00.000Z",
          },
        );
      },
    );

    it(
      "carries a different row's values through unchanged",
      () => {
        const row =
          evidenceFileRow(
            {
              id: "evidence-2",
              org_id: "org-importer",
              emission_data_id: "emission-2",
              storage_path: "org-importer/emission-2/certificate.png",
              original_filename: "certificate.png",
              mime_type: "image/png",
              size_bytes: 999,
              sha256: "def456",
              uploaded_by_user_id: "user-2",
              created_at: "2026-08-29T00:00:00.000Z",
            },
          );

        const result =
          toEvidenceFile(
            row,
          );

        expect(
          result,
        ).toEqual(
          {
            id: "evidence-2",
            org_id: "org-importer",
            emission_data_id: "emission-2",
            storage_path: "org-importer/emission-2/certificate.png",
            original_filename: "certificate.png",
            mime_type: "image/png",
            size_bytes: 999,
            sha256: "def456",
            uploaded_by_user_id: "user-2",
            created_at: "2026-08-29T00:00:00.000Z",
          },
        );
      },
    );
  },
);

import {
  describe,
  expect,
  it,
} from "vitest";

import {
  MAX_EVIDENCE_FILE_SIZE_BYTES,
  validateEvidenceUpload,
} from "./validate-evidence-upload";

describe(
  "validateEvidenceUpload",
  () => {
    it(
      "accepts a PDF whose extension matches its MIME type",
      () => {
        const result =
          validateEvidenceUpload(
            {
              fileName: "test-report.pdf",
              mimeType: "application/pdf",
              sizeBytes: 1024,
            },
          );

        expect(result).toEqual(
          { status: "OK", extension: ".pdf" },
        );
      },
    );

    it(
      "accepts each allowlisted MIME type with its matching extension",
      () => {
        const cases: [string, string][] =
          [
            ["application/pdf", "cert.pdf"],
            ["image/png", "photo.png"],
            ["image/jpeg", "photo.jpg"],
            ["image/jpeg", "photo.jpeg"],
            [
              "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
              "report.docx",
            ],
            [
              "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
              "data.xlsx",
            ],
          ];

        for (
          const [mimeType, fileName] of cases
        ) {
          const result =
            validateEvidenceUpload(
              { fileName, mimeType, sizeBytes: 1024 },
            );

          expect(result.status).toBe(
            "OK",
          );
        }
      },
    );

    it(
      "is case-insensitive on the file extension",
      () => {
        const result =
          validateEvidenceUpload(
            {
              fileName: "INVOICE.PDF",
              mimeType: "application/pdf",
              sizeBytes: 1024,
            },
          );

        expect(result).toEqual(
          { status: "OK", extension: ".pdf" },
        );
      },
    );

    it(
      "rejects DISALLOWED_MIME_TYPE for a MIME type not on the allowlist",
      () => {
        const result =
          validateEvidenceUpload(
            {
              fileName: "notes.txt",
              mimeType: "text/plain",
              sizeBytes: 1024,
            },
          );

        expect(result).toEqual(
          { status: "REJECTED", reason: "DISALLOWED_MIME_TYPE" },
        );
      },
    );

    it(
      "rejects DISALLOWED_EXTENSION for an extension not on the allowlist, even with an allowlisted MIME type",
      () => {
        const result =
          validateEvidenceUpload(
            {
              fileName: "report.txt",
              mimeType: "application/pdf",
              sizeBytes: 1024,
            },
          );

        expect(result).toEqual(
          { status: "REJECTED", reason: "DISALLOWED_EXTENSION" },
        );
      },
    );

    it(
      "rejects MIME_EXTENSION_MISMATCH when both are individually allowlisted but do not agree",
      () => {
        const result =
          validateEvidenceUpload(
            {
              fileName: "photo.png",
              mimeType: "application/pdf",
              sizeBytes: 1024,
            },
          );

        expect(result).toEqual(
          { status: "REJECTED", reason: "MIME_EXTENSION_MISMATCH" },
        );
      },
    );

    it(
      "rejects EXECUTABLE_EXTENSION for a .exe file even when the client claims an allowlisted MIME type (spoofed MIME defense)",
      () => {
        const result =
          validateEvidenceUpload(
            {
              fileName: "totally-a-report.exe",
              mimeType: "application/pdf",
              sizeBytes: 1024,
            },
          );

        expect(result).toEqual(
          { status: "REJECTED", reason: "EXECUTABLE_EXTENSION" },
        );
      },
    );

    it.each(
      [".exe", ".sh", ".bat", ".cmd", ".ps1", ".dll", ".app", ".scr", ".js", ".msi"],
    )(
      "rejects EXECUTABLE_EXTENSION for %s regardless of case",
      (extension) => {
        const result =
          validateEvidenceUpload(
            {
              fileName: `payload${extension.toUpperCase()}`,
              mimeType: "application/pdf",
              sizeBytes: 1024,
            },
          );

        expect(result).toEqual(
          { status: "REJECTED", reason: "EXECUTABLE_EXTENSION" },
        );
      },
    );

    it(
      "rejects FILE_TOO_LARGE for a file over the 20MB cap",
      () => {
        const result =
          validateEvidenceUpload(
            {
              fileName: "large.pdf",
              mimeType: "application/pdf",
              sizeBytes: MAX_EVIDENCE_FILE_SIZE_BYTES + 1,
            },
          );

        expect(result).toEqual(
          { status: "REJECTED", reason: "FILE_TOO_LARGE" },
        );
      },
    );

    it(
      "accepts a file exactly at the 20MB cap",
      () => {
        const result =
          validateEvidenceUpload(
            {
              fileName: "exactly-cap.pdf",
              mimeType: "application/pdf",
              sizeBytes: MAX_EVIDENCE_FILE_SIZE_BYTES,
            },
          );

        expect(result.status).toBe(
          "OK",
        );
      },
    );

    it(
      "rejects EMPTY_FILE for a zero-byte file",
      () => {
        const result =
          validateEvidenceUpload(
            {
              fileName: "empty.pdf",
              mimeType: "application/pdf",
              sizeBytes: 0,
            },
          );

        expect(result).toEqual(
          { status: "REJECTED", reason: "EMPTY_FILE" },
        );
      },
    );

    it(
      "rejects DISALLOWED_EXTENSION for a file with no extension",
      () => {
        const result =
          validateEvidenceUpload(
            {
              fileName: "no-extension-at-all",
              mimeType: "application/pdf",
              sizeBytes: 1024,
            },
          );

        expect(result).toEqual(
          { status: "REJECTED", reason: "DISALLOWED_EXTENSION" },
        );
      },
    );

    it(
      "uses the LAST extension for a multi-dot filename (archive.tar.gz is rejected as .gz, not accepted as .tar)",
      () => {
        const result =
          validateEvidenceUpload(
            {
              fileName: "archive.tar.gz",
              mimeType: "application/pdf",
              sizeBytes: 1024,
            },
          );

        expect(result).toEqual(
          { status: "REJECTED", reason: "DISALLOWED_EXTENSION" },
        );
      },
    );
  },
);

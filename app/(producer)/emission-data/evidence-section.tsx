"use client";

import {
  useActionState,
  useRef,
  useState,
} from "react";

import {
  useRouter,
} from "next/navigation";

import {
  Button,
} from "../../../components/ui/button";

import {
  removeEvidenceFileAction,
} from "./actions";

import {
  initialEmissionDataScreenActionState,
} from "./action-state";

export interface EvidenceFileListItem {
  id: string;
  originalFilename: string;
  sizeBytes: number;
  mimeType: string;
  createdAt: string;
}

function formatFileSize(
  bytes: number,
): string {
  if (bytes < 1024) {
    return `${bytes} B`;
  }

  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)} KB`;
  }

  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function uploadErrorMessageFor(
  reason: string | undefined,
): string {
  switch (reason) {
    case "DISALLOWED_MIME_TYPE":
    case "DISALLOWED_EXTENSION":
    case "MIME_EXTENSION_MISMATCH":
      return "Only PDF, PNG, JPEG, DOCX, or XLSX files are allowed.";

    case "EXECUTABLE_EXTENSION":
      return "Executable files are not allowed.";

    case "FILE_TOO_LARGE":
      return "That file is over the 20MB limit.";

    case "EMPTY_FILE":
      return "That file is empty.";

    case "EMISSION_DATA_NOT_FOUND":
      return "This record could not be found.";

    case "UNAUTHENTICATED":
    case "NO_ORGANIZATION":
      return "You must be signed in to a valid organization to upload evidence.";

    default:
      return "Upload failed. Please try again.";
  }
}

/**
 * A client component posting multipart/form-data to
 * app/api/evidence/upload/route.ts via fetch() -- Server Actions have
 * awkward multipart/large-body handling in this Next.js version, so
 * this follows the standard Next.js pattern of a client-side upload
 * against a dedicated Route Handler (the sanctioned app/api/**
 * exception for uploads, CLAUDE.md), the same reasoning
 * app/api/evidence/upload/route.ts's own doc comment gives. Removal
 * stays an ordinary Server Action (removeEvidenceFileAction) since it
 * has no file body to stream -- only the upload/download paths get
 * route handlers, per the task's own scope.
 *
 * On a successful upload, router.refresh() re-runs the Server
 * Component tree for the current route (the route handler already
 * called revalidatePath("/emission-data")) to pick up the newly
 * attached file, mirroring what a Server Action's own
 * revalidatePath + re-render would do automatically.
 */
export function EvidenceSection(
  {
    emissionDataId,
    files,
  }: {
    emissionDataId: string;
    files: EvidenceFileListItem[];
  },
) {
  const router =
    useRouter();

  const fileInputRef =
    useRef<HTMLInputElement>(null);

  const [uploading, setUploading] =
    useState(false);

  const [uploadError, setUploadError] =
    useState<string | null>(null);

  async function handleUpload() {
    const file =
      fileInputRef.current?.files?.[0];

    if (!file) {
      setUploadError(
        "Choose a file first.",
      );
      return;
    }

    setUploading(
      true,
    );

    setUploadError(
      null,
    );

    const formData =
      new FormData();

    formData.set(
      "emissionDataId",
      emissionDataId,
    );

    formData.set(
      "file",
      file,
    );

    try {
      const response =
        await fetch(
          "/api/evidence/upload",
          {
            method: "POST",
            body: formData,
          },
        );

      const body =
        await response.json().catch(
          () => null,
        ) as { success?: boolean; reason?: string } | null;

      if (!response.ok || !body?.success) {
        setUploadError(
          uploadErrorMessageFor(body?.reason),
        );
        return;
      }

      if (fileInputRef.current) {
        fileInputRef.current.value =
          "";
      }

      router.refresh();
    } catch {
      setUploadError(
        "Upload failed. Please try again.",
      );
    } finally {
      setUploading(
        false,
      );
    }
  }

  return (
    <div className="mt-2 flex flex-col gap-2 border-t border-[var(--border-default)] pt-2">
      <span className="text-xs font-medium text-[var(--text-secondary)]">
        Evidence
      </span>

      {files.length === 0 ? (
        <p className="text-xs text-[var(--text-secondary)]">
          No evidence attached yet.
        </p>
      ) : (
        <ul className="flex flex-col gap-1.5">
          {files.map(
            (file) => (
              <EvidenceFileRow
                key={file.id}
                file={file}
              />
            ),
          )}
        </ul>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <input
          ref={fileInputRef}
          type="file"
          accept=".pdf,.png,.jpg,.jpeg,.docx,.xlsx"
          disabled={uploading}
          className="text-xs text-[var(--text-secondary)]"
        />

        <Button
          type="button"
          size="sm"
          variant="secondary"
          loading={uploading}
          onClick={handleUpload}
        >
          Upload
        </Button>
      </div>

      {uploadError ? (
        <p className="text-xs text-[var(--color-danger-700)]">
          {uploadError}
        </p>
      ) : null}
    </div>
  );
}

function EvidenceFileRow(
  {
    file,
  }: {
    file: EvidenceFileListItem;
  },
) {
  const [state, formAction, pending] =
    useActionState(
      removeEvidenceFileAction,
      initialEmissionDataScreenActionState,
    );

  return (
    <li className="flex flex-wrap items-center justify-between gap-2 text-xs">
      <a
        href={`/api/evidence/${file.id}/download`}
        className="text-[var(--accent-brand)] underline"
      >
        {file.originalFilename}
      </a>

      <span className="text-[var(--text-secondary)]">
        {formatFileSize(file.sizeBytes)} · {file.createdAt.slice(0, 10)}
      </span>

      <form action={formAction}>
        <input
          type="hidden"
          name="evidenceFileId"
          value={file.id}
        />

        <Button
          type="submit"
          size="sm"
          variant="destructive"
          loading={pending}
        >
          Remove
        </Button>
      </form>

      {state.status === "error" ? (
        <p className="w-full text-right text-[var(--color-danger-700)]">
          {state.message}
        </p>
      ) : null}
    </li>
  );
}

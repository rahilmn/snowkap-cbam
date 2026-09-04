"use server";

import { cookies } from "next/headers";

import { redirect } from "next/navigation";

import { ACTIVE_EXPERIENCE_COOKIE } from "./experience-switcher-constants";

/**
 * Sets the caller's active-experience preference and lands them on
 * the dashboard, mirroring switch-org-action.ts exactly. No
 * authorization check needed: see get-preferred-experience.ts's own
 * doc comment -- this cookie can only ever choose among layouts the
 * org's real capabilities already authorize.
 */
export async function switchExperienceAction(
  formData: FormData,
): Promise<void> {
  const experience =
    formData.get(
      "experience",
    );

  if (experience !== "importer" && experience !== "producer") {
    return;
  }

  const cookieStore =
    await cookies();

  cookieStore.set(
    ACTIVE_EXPERIENCE_COOKIE,
    experience,
    {
      httpOnly: true,
      sameSite: "lax",
      path: "/",
      maxAge: 60 * 60 * 24 * 365,
      secure: process.env.NODE_ENV === "production",
    },
  );

  redirect(
    "/",
  );
}

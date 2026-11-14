import { z } from "zod";

export const httpsUrl = z
  .string()
  .trim()
  .max(500)
  .refine((value) => {
    if (value === "") return true;
    try {
      return new URL(value).protocol === "https:";
    } catch {
      return false;
    }
  }, "Use an https link.");

/** Written reviews (text or video) an account needs before it can attach photos. */
export const mediaUrl = z
  .string()
  .trim()
  .max(500)
  .refine(
    (value) => value === "" || /^https:\/\//i.test(value) || /^\/(?!\/)/.test(value),
    "Use an https link or an app-relative path.",
  );

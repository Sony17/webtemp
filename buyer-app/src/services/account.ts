/** Account service — user profile, addresses, payments (mock today, API tomorrow). */
import type { UserProfile } from "@/types";
import { userProfile } from "@/mock/user";

const delay = (ms = 200) => new Promise((r) => setTimeout(r, ms));

export async function getProfile(): Promise<UserProfile> {
  await delay();
  return userProfile;
}

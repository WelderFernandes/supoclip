// Shape of the AI-written publishing copy stored on a clip, plus the helpers
// the publisher sheet and the clip detail panel both need. The backend always
// fills a neutral "generic" copy and a copy per platform it was asked for.

export type PublishingPlatform = "youtube" | "tiktok" | "instagram";

export interface PublishingCopy {
  title: string;
  description: string;
  hashtags: string[];
}

export interface PublishingMetadata {
  generic?: PublishingCopy;
  platforms?: Partial<Record<PublishingPlatform, PublishingCopy>>;
  generated_at?: string;
}

export const PUBLISHING_PLATFORMS: PublishingPlatform[] = [
  "youtube",
  "tiktok",
  "instagram",
];

export const PLATFORM_LABELS: Record<string, string> = {
  generic: "Neutral",
  youtube: "YouTube",
  tiktok: "TikTok",
  instagram: "Instagram",
};

export function hasCopy(copy: PublishingCopy | null | undefined): boolean {
  return Boolean(copy && (copy.title?.trim() || copy.description?.trim()));
}

/** The copy written for a platform, falling back to the neutral version. */
export function publishingCopyFor(
  metadata: PublishingMetadata | null | undefined,
  platform: string | null | undefined,
): PublishingCopy | null {
  if (!metadata) return null;
  const platformCopy = platform
    ? metadata.platforms?.[platform as PublishingPlatform]
    : undefined;
  return platformCopy ?? metadata.generic ?? null;
}

/** Hashtags the way the composer expects them: "tag one, tag two". */
export function hashtagsToInput(copy: PublishingCopy | null | undefined): string {
  return (copy?.hashtags ?? []).join(", ");
}

/** Hashtags the way they appear on the platform: "#one #two". */
export function hashtagsText(copy: PublishingCopy | null | undefined): string {
  return (copy?.hashtags ?? []).map((tag) => `#${tag}`).join(" ");
}

/** Everything in one block, ready to paste straight into a platform composer. */
export function copyAsText(copy: PublishingCopy | null | undefined): string {
  if (!copy) return "";
  return [copy.title?.trim() ?? "", copy.description?.trim() ?? "", hashtagsText(copy)]
    .filter((part) => part.length > 0)
    .join("\n\n");
}

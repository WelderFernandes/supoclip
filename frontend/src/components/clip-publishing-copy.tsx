"use client";

import { useState } from "react";
import { Check, Copy, Loader2, Sparkles } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  PLATFORM_LABELS,
  PUBLISHING_PLATFORMS,
  copyAsText,
  hashtagsText,
  hasCopy,
  publishingCopyFor,
  type PublishingMetadata,
  type PublishingPlatform,
} from "@/lib/publishing-copy";

async function readError(response: Response, fallback: string): Promise<string> {
  const data = await response.json().catch(() => ({}));
  return typeof data?.detail === "string" ? data.detail : fallback;
}

async function writeClipboard(value: string): Promise<void> {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(value);
    return;
  }
  // Browsers without the async clipboard API need a temporary selection.
  const field = document.createElement("textarea");
  field.value = value;
  field.style.position = "fixed";
  field.style.opacity = "0";
  document.body.appendChild(field);
  field.select();
  document.execCommand("copy");
  field.remove();
}

function CopyButton({
  id,
  value,
  copied,
  onCopy,
}: {
  id: string;
  value: string;
  copied: string | null;
  onCopy: (id: string, value: string) => void;
}) {
  const done = copied === id;
  return (
    <Button
      type="button"
      size="sm"
      variant="ghost"
      className="h-6 shrink-0 px-1.5 text-[11px] text-muted-foreground"
      onClick={() => onCopy(id, value)}
      disabled={!value}
    >
      {done ? <Check className="size-3" /> : <Copy className="size-3" />}
      {done ? "Copied" : "Copy"}
    </Button>
  );
}

/**
 * The AI-written title, description and hashtags for one clip, with a copy
 * button per field and a way to regenerate them.
 *
 * This lives outside the publishing flow on purpose: the copy is useful even
 * when no social account is connected, and the publisher sheet is hidden until
 * one is.
 */
export function ClipPublishingCopy({
  taskId,
  clipId,
  metadata,
  onChanged,
}: {
  taskId: string;
  clipId: string;
  metadata: PublishingMetadata | null | undefined;
  onChanged?: () => void | Promise<void>;
}) {
  // The panel remounts this component per clip, so the state starts from the
  // stored copy and never leaks from one clip to the next.
  const [current, setCurrent] = useState<PublishingMetadata | null>(metadata ?? null);
  const [platform, setPlatform] = useState<PublishingPlatform>("youtube");
  const [generating, setGenerating] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const copy = publishingCopyFor(current, platform);
  const ready = hasCopy(copy);

  const copyField = async (id: string, value: string) => {
    if (!value) return;
    try {
      await writeClipboard(value);
      setCopied(id);
      window.setTimeout(
        () => setCopied((active) => (active === id ? null : active)),
        2000,
      );
    } catch {
      setError("Could not copy to the clipboard.");
    }
  };

  const generate = async () => {
    setGenerating(true);
    setError(null);
    try {
      const response = await fetch(
        `/api/tasks/${taskId}/clips/${clipId}/publishing-metadata`,
        { method: "POST" },
      );
      if (!response.ok) {
        throw new Error(
          await readError(response, "Could not write the titles right now."),
        );
      }
      const { clip } = (await response.json()) as {
        clip?: { publishing_metadata?: PublishingMetadata | null };
      };
      if (clip?.publishing_metadata) setCurrent(clip.publishing_metadata);
      await onChanged?.();
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Could not write the titles right now.",
      );
    } finally {
      setGenerating(false);
    }
  };

  return (
    <section className="rounded-xl border p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <p className="text-sm font-semibold">Title, description &amp; hashtags</p>
          <p className="text-xs text-muted-foreground">
            Written from this clip&apos;s transcript, sized for each platform.
          </p>
        </div>
        <Button
          type="button"
          size="sm"
          variant={ready ? "outline" : "default"}
          onClick={generate}
          disabled={generating}
        >
          {generating ? (
            <Loader2 className="size-3.5 animate-spin" />
          ) : (
            <Sparkles className="size-3.5" />
          )}
          {generating ? "Writing…" : ready ? "Regenerate" : "Generate with AI"}
        </Button>
      </div>

      {error && <p className="mt-3 text-xs text-red-600">{error}</p>}

      {!ready && !generating && !error && (
        <p className="mt-3 text-xs text-muted-foreground">
          Nothing written for this clip yet. Use Generate with AI.
        </p>
      )}

      {ready && copy && (
        <>
          <div className="mt-3 flex flex-wrap gap-1">
            {PUBLISHING_PLATFORMS.map((option) => (
              <Button
                key={option}
                type="button"
                size="sm"
                variant={option === platform ? "secondary" : "ghost"}
                className="h-7 px-2 text-xs"
                onClick={() => setPlatform(option)}
              >
                {PLATFORM_LABELS[option]}
              </Button>
            ))}
          </div>

          <div className="mt-3 space-y-3">
            {copy.title?.trim() && (
              <div className="space-y-1">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs font-medium text-muted-foreground">Title</span>
                  <CopyButton
                    id="title"
                    value={copy.title}
                    copied={copied}
                    onCopy={copyField}
                  />
                </div>
                <p className="rounded-lg bg-muted/50 px-3 py-2 text-sm font-medium">
                  {copy.title}
                </p>
              </div>
            )}

            {copy.description?.trim() && (
              <div className="space-y-1">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs font-medium text-muted-foreground">
                    Description
                  </span>
                  <CopyButton
                    id="description"
                    value={copy.description}
                    copied={copied}
                    onCopy={copyField}
                  />
                </div>
                <p className="whitespace-pre-wrap rounded-lg bg-muted/50 px-3 py-2 text-sm leading-relaxed">
                  {copy.description}
                </p>
              </div>
            )}

            {copy.hashtags.length > 0 && (
              <div className="space-y-1">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs font-medium text-muted-foreground">
                    Hashtags <span className="tabular-nums">({copy.hashtags.length})</span>
                  </span>
                  <CopyButton
                    id="hashtags"
                    value={hashtagsText(copy)}
                    copied={copied}
                    onCopy={copyField}
                  />
                </div>
                <p className="rounded-lg bg-muted/50 px-3 py-2 text-sm">
                  {hashtagsText(copy)}
                </p>
              </div>
            )}
          </div>

          <Button
            type="button"
            size="sm"
            variant="outline"
            className="mt-3 w-full"
            onClick={() => copyField("all", copyAsText(copy))}
          >
            {copied === "all" ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
            {copied === "all"
              ? "Copied to clipboard"
              : `Copy everything for ${PLATFORM_LABELS[platform]}`}
          </Button>
        </>
      )}
    </section>
  );
}

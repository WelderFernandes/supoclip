import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";

import { ClipPublishingCopy } from "./clip-publishing-copy";
import type { PublishingMetadata } from "@/lib/publishing-copy";

afterEach(() => {
  vi.unstubAllGlobals();
});

const metadata: PublishingMetadata = {
  generated_at: "2026-10-18T00:00:00.000Z",
  generic: {
    title: "Titulo neutro",
    description: "Corpo neutro",
    hashtags: ["neutra"],
  },
  platforms: {
    youtube: {
      title: "Titulo YouTube",
      description: "Corpo YouTube",
      hashtags: ["a", "b"],
    },
    tiktok: {
      title: "Titulo TikTok",
      description: "Corpo TikTok",
      hashtags: ["c"],
    },
  },
};

function renderCard(
  props: {
    metadata?: PublishingMetadata | null;
    onChanged?: () => void | Promise<void>;
  } = {},
) {
  return render(
    <ClipPublishingCopy
      taskId="task-1"
      clipId="clip-1"
      metadata={props.metadata ?? null}
      onChanged={props.onChanged}
    />,
  );
}

it("offers to write the copy when the clip has none", () => {
  renderCard();

  expect(screen.getByText(/Title, description & hashtags/)).toBeInTheDocument();
  expect(screen.getByRole("button", { name: /generate with ai/i })).toBeInTheDocument();
  expect(screen.getByText(/Nothing written for this clip yet/)).toBeInTheDocument();
});

it("shows the stored copy and switches between platforms", () => {
  renderCard({ metadata });

  expect(screen.getByText("Titulo YouTube")).toBeInTheDocument();
  expect(screen.getByText("Corpo YouTube")).toBeInTheDocument();
  expect(screen.getByText("#a #b")).toBeInTheDocument();

  fireEvent.click(screen.getByRole("button", { name: "TikTok" }));

  expect(screen.getByText("Titulo TikTok")).toBeInTheDocument();
  expect(screen.getByText("#c")).toBeInTheDocument();
});

it("falls back to the neutral copy for a platform without one", () => {
  renderCard({ metadata });

  fireEvent.click(screen.getByRole("button", { name: "Instagram" }));

  expect(screen.getByText("Titulo neutro")).toBeInTheDocument();
  expect(screen.getByText("#neutra")).toBeInTheDocument();
});

it("copies a single field and the whole block", async () => {
  const writeText = vi.fn().mockResolvedValue(undefined);
  Object.defineProperty(navigator, "clipboard", {
    value: { writeText },
    configurable: true,
  });
  renderCard({ metadata });

  fireEvent.click(screen.getAllByRole("button", { name: "Copy" })[0]);
  await waitFor(() => expect(writeText).toHaveBeenCalledWith("Titulo YouTube"));

  fireEvent.click(
    screen.getByRole("button", { name: /copy everything for youtube/i }),
  );
  await waitFor(() =>
    expect(writeText).toHaveBeenCalledWith("Titulo YouTube\n\nCorpo YouTube\n\n#a #b"),
  );
});

it("writes the copy on demand and tells the parent to refresh", async () => {
  const fetchMock = vi
    .fn()
    .mockResolvedValue(
      new Response(JSON.stringify({ clip: { publishing_metadata: metadata } }), {
        status: 200,
      }),
    );
  vi.stubGlobal("fetch", fetchMock);
  const onChanged = vi.fn();

  renderCard({ onChanged });
  fireEvent.click(screen.getByRole("button", { name: /generate with ai/i }));

  await waitFor(() =>
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/tasks/task-1/clips/clip-1/publishing-metadata",
      { method: "POST" },
    ),
  );
  expect(await screen.findByText("Titulo YouTube")).toBeInTheDocument();
  expect(onChanged).toHaveBeenCalled();
});

it("surfaces the backend message when generation fails", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          detail: "Could not write titles and descriptions right now.",
        }),
        { status: 502 },
      ),
    ),
  );

  renderCard();
  fireEvent.click(screen.getByRole("button", { name: /generate with ai/i }));

  expect(
    await screen.findByText(/Could not write titles and descriptions right now\./),
  ).toBeInTheDocument();
});

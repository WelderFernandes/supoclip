import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import { toast } from "sonner";

import { ClipPostList, ClipPublishButton } from "./clip-publisher";
import type { SocialConnection, SocialPost, SocialProviderStatus } from "@/lib/social";

vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn(), loading: vi.fn() } }));

const clip = { id: "clip-1", clip_order: 1, hook_title: "Hook title", text: "Transcript" };

const clipWithCopy = {
  ...clip,
  publishing_metadata: {
    generated_at: "2026-10-18T00:00:00.000Z",
    generic: { title: "Titulo neutro", description: "Corpo neutro", hashtags: ["neutra"] },
    platforms: {
      youtube: { title: "Titulo YouTube", description: "Corpo YouTube", hashtags: ["a", "b"] },
      tiktok: { title: "Titulo TikTok", description: "Corpo TikTok", hashtags: ["c"] },
    },
  },
};

function provider(overrides: Partial<SocialProviderStatus> = {}): SocialProviderStatus {
  return {
    provider: "youtube",
    display_name: "YouTube Shorts",
    configured: true,
    supported_privacy_levels: ["public", "unlisted", "private"],
    default_privacy_level: "public",
    setup_hint: null,
    ...overrides,
  };
}

function connection(overrides: Partial<SocialConnection> = {}): SocialConnection {
  return {
    id: "acc-1",
    provider: "youtube",
    external_account_id: "chan-1",
    display_name: "My Channel",
    username: null,
    avatar_url: null,
    token_expires_at: null,
    status: "active",
    last_error: null,
    created_at: null,
    ...overrides,
  };
}

beforeEach(() => {
  vi.resetAllMocks();
});

it("hides the publish button when no platform is configured", () => {
  render(
    <ClipPublishButton
      taskId="task-1"
      clip={clip}
      connections={[]}
      providers={[provider({ configured: false })]}
      onChanged={vi.fn()}
    />,
  );
  expect(screen.queryByRole("button", { name: /publish/i })).toBeNull();
});

it("keeps the form when connections refresh while the sheet is open", async () => {
  const providers = [provider()];
  const { rerender } = render(
    <ClipPublishButton
      taskId="task-1"
      clip={clip}
      connections={[connection()]}
      providers={providers}
      onChanged={vi.fn()}
    />,
  );
  fireEvent.click(screen.getByRole("button", { name: /publish/i }));
  const title = await screen.findByLabelText("Title");
  expect(title).toHaveValue("Hook title");
  fireEvent.change(title, { target: { value: "My edited title" } });

  // A background refresh hands down new connection objects.
  rerender(
    <ClipPublishButton
      taskId="task-1"
      clip={clip}
      connections={[connection(), connection({ id: "acc-2", display_name: "Second" })]}
      providers={[...providers]}
      onChanged={vi.fn()}
    />,
  );
  expect(screen.getByLabelText("Title")).toHaveValue("My edited title");
});

it("starts TikTok posts as private", async () => {
  render(
    <ClipPublishButton
      taskId="task-1"
      clip={clip}
      connections={[connection({ provider: "tiktok" })]}
      providers={[
        provider({
          provider: "tiktok",
          display_name: "TikTok",
          supported_privacy_levels: ["public", "private"],
          default_privacy_level: "private",
        }),
      ]}
      onChanged={vi.fn()}
    />,
  );
  fireEvent.click(screen.getByRole("button", { name: /publish/i }));
  expect(await screen.findByLabelText("Visibility")).toHaveTextContent("Private (only me)");
});

it("reports failed post actions with a toast", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ detail: "This post is already being retried." }), { status: 400 }),
    ),
  );
  const onChanged = vi.fn();
  const post = {
    id: "post-1",
    provider: "youtube",
    status: "failed",
    error_message: "Upload outcome unknown; check your account before retrying.",
    account: { display_name: "My Channel", username: null, avatar_url: null, status: "active" },
    metrics: null,
  } as unknown as SocialPost;
  render(<ClipPostList posts={[post]} onChanged={onChanged} />);
  expect(screen.getByText(/check your account before retrying/)).toBeInTheDocument();
  fireEvent.keyDown(screen.getByRole("button", { name: "Post actions" }), { key: "Enter" });
  fireEvent.click(await screen.findByRole("menuitem", { name: /try again/i }));
  await waitFor(() => expect(toast.error).toHaveBeenCalledWith("This post is already being retried."));
  expect(fetch).toHaveBeenCalledWith("/api/social/posts/post-1/retry", { method: "POST" });
  expect(onChanged).toHaveBeenCalled();
});

it("shows a spinner while a post is uploading and offers no actions", () => {
  const post = {
    id: "post-2",
    provider: "tiktok",
    status: "publishing",
    error_message: null,
    account: { display_name: "My TikTok", username: null, avatar_url: null, status: "active" },
    metrics: null,
  } as unknown as SocialPost;
  render(<ClipPostList posts={[post]} onChanged={vi.fn()} />);
  expect(screen.getByText("Uploading…")).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Post actions" })).toBeNull();
});

it("prefills the form with the copy generated for the selected platform", async () => {
  render(
    <ClipPublishButton
      taskId="task-1"
      clip={clipWithCopy}
      connections={[connection()]}
      providers={[provider()]}
      onChanged={vi.fn()}
    />,
  );
  fireEvent.click(screen.getByRole("button", { name: /publish/i }));

  expect(await screen.findByLabelText("Title")).toHaveValue("Titulo YouTube");
  expect(screen.getByLabelText("Caption")).toHaveValue("Corpo YouTube");
  expect(screen.getByLabelText("Hashtags")).toHaveValue("a, b");
});

it("falls back to the neutral copy when the platform variant is missing", async () => {
  render(
    <ClipPublishButton
      taskId="task-1"
      clip={clipWithCopy}
      connections={[connection({ provider: "instagram" })]}
      providers={[provider({ provider: "instagram", display_name: "Instagram" })]}
      onChanged={vi.fn()}
    />,
  );
  fireEvent.click(screen.getByRole("button", { name: /publish/i }));

  expect(await screen.findByLabelText("Title")).toHaveValue("Titulo neutro");
  expect(screen.getByLabelText("Hashtags")).toHaveValue("neutra");
});

it("keeps the hook title and transcript when nothing was generated yet", async () => {
  render(
    <ClipPublishButton
      taskId="task-1"
      clip={clip}
      connections={[connection()]}
      providers={[provider()]}
      onChanged={vi.fn()}
    />,
  );
  fireEvent.click(screen.getByRole("button", { name: /publish/i }));

  expect(await screen.findByLabelText("Title")).toHaveValue("Hook title");
  expect(screen.getByLabelText("Caption")).toHaveValue("Transcript");
  expect(screen.getByLabelText("Hashtags")).toHaveValue("");
});

it("generates viral copy on demand and fills the form", async () => {
  const updated = {
    ...clip,
    publishing_metadata: {
      generated_at: "2026-10-18T00:00:00.000Z",
      generic: { title: "Neutro", description: "Corpo neutro", hashtags: ["um"] },
      platforms: {
        youtube: {
          title: "Titulo viral",
          description: "Descricao viral",
          hashtags: ["viral", "shorts"],
        },
      },
    },
  };
  const fetchMock = vi
    .fn()
    .mockResolvedValue(new Response(JSON.stringify({ clip: updated }), { status: 200 }));
  vi.stubGlobal("fetch", fetchMock);
  const onClipUpdated = vi.fn();

  render(
    <ClipPublishButton
      taskId="task-1"
      clip={clip}
      connections={[connection()]}
      providers={[provider()]}
      onChanged={vi.fn()}
      onClipUpdated={onClipUpdated}
    />,
  );
  fireEvent.click(screen.getByRole("button", { name: /publish/i }));
  fireEvent.click(await screen.findByRole("button", { name: /generate with ai/i }));

  await waitFor(() =>
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/tasks/task-1/clips/clip-1/publishing-metadata",
      { method: "POST" },
    ),
  );
  expect(await screen.findByLabelText("Title")).toHaveValue("Titulo viral");
  expect(screen.getByLabelText("Caption")).toHaveValue("Descricao viral");
  expect(screen.getByLabelText("Hashtags")).toHaveValue("viral, shorts");
  expect(onClipUpdated).toHaveBeenCalled();
});

it("surfaces a generation failure inside the sheet", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({ detail: "Could not write titles and descriptions right now." }),
        { status: 502 },
      ),
    ),
  );

  render(
    <ClipPublishButton
      taskId="task-1"
      clip={clip}
      connections={[connection()]}
      providers={[provider()]}
      onChanged={vi.fn()}
    />,
  );
  fireEvent.click(screen.getByRole("button", { name: /publish/i }));
  fireEvent.click(await screen.findByRole("button", { name: /generate with ai/i }));

  expect(
    await screen.findByText(/Could not write titles and descriptions right now\./),
  ).toBeInTheDocument();
  // The original text is left untouched so the user can still publish.
  expect(screen.getByLabelText("Title")).toHaveValue("Hook title");
});

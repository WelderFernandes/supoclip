from types import SimpleNamespace

import pytest

from src import ai


def test_sanitize_publishing_title_strips_markdown_hashtags_and_quotes():
    assert (
        ai.sanitize_publishing_title('  "**Ninguem** te conta isso #viral"  ', 100)
        == "Ninguem te conta isso"
    )


def test_sanitize_publishing_title_truncates_on_a_word_boundary():
    title = ai.sanitize_publishing_title("palavra " * 40, 30)
    assert len(title) <= 30
    assert not title.endswith("palav")


def test_sanitize_publishing_title_keeps_hook_punctuation():
    assert ai.sanitize_publishing_title("Voce faria isso?", 100) == "Voce faria isso?"
    assert ai.sanitize_publishing_title("Isso muda tudo!", 100) == "Isso muda tudo!"


def test_sanitize_publishing_description_drops_markdown_and_hashtags():
    cleaned = ai.sanitize_publishing_description(
        "**Hook** aqui\n\n\n\n- item um\n#tag restante", 500
    )
    assert cleaned == "Hook aqui\n\nitem um\nrestante"


def test_sanitize_publishing_description_leaves_no_orphan_whitespace():
    # Dropping a hashtag used to leave the surrounding padding behind.
    cleaned = ai.sanitize_publishing_description("Texto.\n#so-uma-tag", 500)
    assert cleaned == "Texto."


def test_sanitize_publishing_description_removes_whole_hyphenated_hashtags():
    cleaned = ai.sanitize_publishing_description("Fim do texto #dicas-de-tech", 500)
    assert cleaned == "Fim do texto"


def test_sanitize_publishing_description_truncates_at_the_limit():
    raw = "frase completa. " * 300
    cleaned = ai.sanitize_publishing_description(raw, 2200)
    assert len(cleaned) <= 2200


def test_sanitize_publishing_hashtags_normalizes_dedupes_and_caps():
    tags = ai.sanitize_publishing_hashtags(
        ["#Foo", "#foo", "bar baz", "##Ok", "a" * 50, "python-dev"], 5
    )
    assert tags == ["Foo", "bar", "baz", "Ok", "pythondev"]


def test_sanitize_publishing_hashtags_accepts_a_plain_string():
    assert ai.sanitize_publishing_hashtags("#um, #dois tres", 5) == [
        "um",
        "dois",
        "tres",
    ]


def test_normalize_publishing_metadata_falls_back_to_the_generic_copy():
    raw = ai.ClipsPublishingMetadata.model_validate(
        {
            "clips": [
                {
                    "clip_number": 7,
                    "generic": {
                        "title": "Generico",
                        "description": "Corpo generico",
                        "hashtags": ["um"],
                    },
                    "youtube": {
                        "title": "Youtube",
                        "description": "Corpo do youtube",
                        "hashtags": ["yt"],
                    },
                    "tiktok": None,
                    "instagram": None,
                }
            ]
        }
    )

    normalized = ai.normalize_publishing_metadata(raw, ["youtube", "tiktok"])

    entry = normalized[7]
    assert entry["generic"]["title"] == "Generico"
    assert entry["platforms"]["youtube"]["title"] == "Youtube"
    # A platform the model left empty reuses the neutral copy, never blank.
    assert entry["platforms"]["tiktok"]["title"] == "Generico"
    assert entry["platforms"]["tiktok"]["hashtags"] == ["um"]


def test_normalize_publishing_metadata_respects_per_platform_limits():
    long_title = "palavra " * 60
    raw = ai.ClipsPublishingMetadata.model_validate(
        {
            "clips": [
                {
                    "clip_number": 1,
                    "generic": {"title": long_title, "description": "d", "hashtags": []},
                    "youtube": {"title": long_title, "description": "d", "hashtags": []},
                    "tiktok": {"title": long_title, "description": "d", "hashtags": []},
                }
            ]
        }
    )

    normalized = ai.normalize_publishing_metadata(raw, ["youtube", "tiktok"])

    assert len(normalized[1]["platforms"]["youtube"]["title"]) <= 100
    assert len(normalized[1]["platforms"]["tiktok"]["title"]) <= 150


def test_build_publishing_metadata_prompt_lists_clips_and_platforms():
    prompt = ai.build_publishing_metadata_prompt(
        [
            {"clip_number": 1, "hook_title": "Gancho", "text": "Primeiro clipe."},
            {"clip_number": 2, "hook_title": None, "text": "Segundo clipe."},
        ],
        ["youtube"],
    )

    assert "clip_number: 1" in prompt
    assert "clip_number: 2" in prompt
    assert "Gancho" in prompt
    assert "Primeiro clipe." in prompt
    assert "Requested platform variants: youtube" in prompt


@pytest.mark.asyncio
async def test_generate_clips_publishing_metadata_batches_and_merges(monkeypatch):
    calls = []

    def fake_agent():
        return object()

    async def fake_run(_agent, prompt, _timeout):
        calls.append(prompt)
        # Every batch answers for its own clip_numbers, which the prompt names.
        numbers = [
            int(line.split(":", 1)[1])
            for line in prompt.splitlines()
            if line.startswith("clip_number:")
        ]
        return SimpleNamespace(
            output=ai.ClipsPublishingMetadata.model_validate(
                {
                    "clips": [
                        {
                            "clip_number": number,
                            "generic": {
                                "title": f"titulo {number}",
                                "description": "corpo",
                                "hashtags": ["tag"],
                            },
                        }
                        for number in numbers
                    ]
                }
            )
        )

    monkeypatch.setattr(ai, "get_publishing_metadata_agent", fake_agent)
    monkeypatch.setattr(ai, "_run_transcript_analysis", fake_run)

    clips = [
        {"clip_number": index, "hook_title": None, "text": f"texto {index}"}
        for index in range(1, 13)
    ]
    result = await ai.generate_clips_publishing_metadata(clips, ["youtube"])

    assert len(calls) == 3  # 5 + 5 + 2
    assert sorted(result) == list(range(1, 13))
    assert result[12]["platforms"]["youtube"]["title"] == "titulo 12"


@pytest.mark.asyncio
async def test_generate_clips_publishing_metadata_handles_no_clips(monkeypatch):
    async def unreachable(*_args, **_kwargs):
        raise AssertionError("no model call expected")

    monkeypatch.setattr(ai, "_run_transcript_analysis", unreachable)

    assert await ai.generate_clips_publishing_metadata([]) == {}

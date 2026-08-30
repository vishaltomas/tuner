import asyncio
import functools
import time

from huggingface_hub import HfApi, InferenceClient

from app.config import settings

hf_cache = {}

def with_api(func):
    """Inject a live HfApi client as the first argument.

    The client is reused for the current `api_client_ttl` window, then rebuilt.
    Client lifetime and API status handling belong here, not in the callers.
    """

    @functools.wraps(func)
    def wrapper(*args, **kwargs):
        now = time.monotonic()
        cached = hf_cache.get("hf_api")
        if cached is None or now - cached["time"] > settings.api_client_ttl:
            cached = {"api": HfApi(token=settings.hugging_face_api_token), "time": now}
            hf_cache["hf_api"] = cached

        return func(cached["api"], *args, **kwargs)

    return wrapper


@with_api
def list_embed_models(
    api: HfApi, model_name: str | None = None, limit: int = 10
) -> list[dict]:
    """Return embedding models, most downloaded first.

    `model_name` is an optional substring filter on the model id. The Hub's
    listing carries no vector width, so `dimensions` is left to the caller —
    reading it would cost one config fetch per model.
    """
    models = api.list_models(
        pipeline_tag=settings.embedding_pipeline_tag,
        filter=settings.embedding_library,
        search=model_name,
        sort="downloads",
        limit=limit,
    )
    return [
        {
            "id": model.id,
            "downloads": model.downloads,
            "library": model.library_name,
        }
        for model in models
    ]


@with_api
def get_model_details(api: HfApi, model_id: str) -> dict:
    """Return metadata for a single model."""
    info = api.model_info(model_id)
    return {
        "id": info.id,
        "author": info.author,
        "downloads": info.downloads,
        "likes": info.likes,
        "pipeline_tag": info.pipeline_tag,
        "library_name": info.library_name,
        "tags": info.tags,
    }

@with_api
async def download_model(api: HfApi, model_name: str, file_path: str) -> str:
    """Download an embedding model repo from the Hub into `file_path`.

    Returns the local directory holding the snapshot. The whole repo is
    fetched rather than a single file, since loading an embedding model
    needs its config and tokenizer alongside the weights.
    """
    return await asyncio.to_thread(
        api.snapshot_download,
        repo_id=model_name,
        local_dir=file_path,
    )


@with_api
def get_repo_size(api: HfApi, model_id: str) -> int | None:
    """Total bytes of every file in a model repo, or None if the Hub is vague.

    Asking for file metadata costs an extra round trip, so this is only worth
    calling when the number is going to be shown — it is the denominator a
    download's progress is measured against.
    """
    info = api.model_info(model_id, files_metadata=True)
    sizes = [sibling.size for sibling in (info.siblings or [])]
    if not sizes or any(size is None for size in sizes):
        return None
    return sum(sizes)


@functools.cache
def inference_client(model: str, provider: str) -> InferenceClient:
    """Client for one served model, kept for the life of the process.

    Unlike `HfApi` this holds no listing state that can go stale — it is a
    thin wrapper over the inference endpoint — so it is cached outright rather
    than on the `api_client_ttl` window.
    """
    return InferenceClient(
        model=model, provider=provider, token=settings.hugging_face_api_token
    )


def chat(
    messages: list[dict],
    model: str,
    provider: str,
    max_tokens: int,
    temperature: float,
) -> str:
    """One chat completion from the Inference API, as plain text.

    Blocking: the client is synchronous and a completion runs for seconds, so
    callers hand it to a thread. A served model that answers with no content —
    a filtered or empty generation — comes back as an empty string, which the
    caller reports rather than passing off as an answer.
    """
    completion = inference_client(model, provider).chat_completion(
        messages=messages, max_tokens=max_tokens, temperature=temperature
    )
    choices = completion.choices or []
    return (choices[0].message.content or "").strip() if choices else ""

import asyncio
import functools
import time

from huggingface_hub import HfApi

from config import settings

hf_cache = {}

def with_api(func):
    """Inject a live HfApi client as the first argument.

    The client is reused for the current `api_client_ttl` window, then rebuilt.
    Client lifetime and API status handling belong here, not in the callers.
    """

    @functools.wraps(func)
    def wrapper(*args, **kwargs):
        hf_api = None
        now = time.monotonic()
        if hf_cache.get('hf_api'):
            older_api_created_at = hf_cache['hf_api']['time']
            if now  - older_api_created_at > settings.api_client_ttl:
                hf_api = HfApi(token=settings.hugging_face_api_token)
                hf_cache["hf_api"]["api"] = hf_api
                hf_cache["hf_api"]["time"] = now
            else:
                hf_api = hf_cache["hf_api"]["api"]
        else:
            hf_api = HfApi(token=settings.hugging_face_api_token)
            hf_cache["hf_api"]["api"] = hf_api
            hf_cache["hf_api"]["time"] = now
        
        return func(hf_api, *args, **kwargs)

    return wrapper


@with_api
def list_embed_models(
    api: HfApi, model_name: str | None = None, limit: int = 10
) -> list[str]:
    """Return ids of embedding models, most downloaded first.

    `model_name` is an optional substring filter on the model id.
    """
    models = api.list_models(
        pipeline_tag=settings.embedding_pipeline_tag,
        filter=settings.embedding_library,
        search=model_name,
        sort="downloads",
        limit=limit,
    )
    return [model.id for model in models]


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

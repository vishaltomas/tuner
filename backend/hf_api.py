from huggingface_hub import HfApi
from config import settings


def api_wrapper():
    api = HfApi(token=settings.hugging_face_api_token)



def list_embed_models(search_txt:str)->list[str]:
    pass
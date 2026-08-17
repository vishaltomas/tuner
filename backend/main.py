from fastapi import FastAPI

app = FastAPI()

@app.get("/")
async def root():
    return 

@app.post("/embed")
async def embed():
    return
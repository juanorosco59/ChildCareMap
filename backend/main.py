from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

# 👇 OBLIGATORIO: la instancia se llama app y está a nivel superior (no dentro de funciones)
app = FastAPI(title="ChildCareMap API")

# CORS (en producción poné tu dominio del front)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.get("/api/saludo")
def saludo():
    return {"mensaje": "Hola desde FastAPI (ChildCareMap API5)"}

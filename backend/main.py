# Importa la clase principal de FastAPI
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

# Crea una instancia de la aplicación
app = FastAPI(title="ChildCareMap Backend")

# Configura el middleware de CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],         # Permite todas las fuentes (útil para desarrollo)
    allow_credentials=True,      # Permite el envío de cookies/autenticación
    allow_methods=["*"],         # Permite todos los métodos HTTP (GET, POST, etc.)
    allow_headers=["*"],         # Permite todos los encabezados
)

# Define una ruta GET
@app.get("/api/saludo")
def saludo():
    # Devuelve un JSON de ejemplo
    return {"mensaje": "Respuesta del backend por ChildCareMap API 5"}

# Define una ruta GET
@app.get("/print/tupla")

def printTupla(i: int):
    # Crear una tupla
    my_tuple = (1, 2, 3, 4)
    my_list = list(my_tuple)
    my_list.append(5)
    printed_items = []

    # Recorremos y guardamos los valores en la lista
    for item in my_list:
        printed_items.append(item)

    # Retornamos la lista como JSON
    return {
        "mensaje": "Lista generada",
        "valores": printed_items,
        "nodo": printed_items[i]
    }

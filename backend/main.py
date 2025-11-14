# Importa la clase principal de FastAPI
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
import pymysql

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




def get_connection():
    return pymysql.connect(
        host="switchback.proxy.rlwy.net",
        port=40976,
        user="root",
        password="xJuZmDpKojQgwzkWqMrdaHiFhIhVIfep",
        database="railway",
        cursorclass=pymysql.cursors.DictCursor
    )


# Función opcional para color según anemia
def anemia_to_color(value: float):
    if value < 10:
        return "#ef4444"  # Rojo — crítico
    elif value < 12:
        return "#f59e0b"  # Naranja — moderado
    else:
        return "#22c55e"  # Verde — normal


@app.get("/api/patients")
def get_patients():
    conn = get_connection()
    cursor = conn.cursor()

    query = """
        SELECT id, name, last_name, age, latitude, longitude, anemia_value, created_at
        FROM patients
    """

    cursor.execute(query)
    rows = cursor.fetchall()

    data = []
    for r in rows:
        data.append({
            "id": r.id,
            "name": f"{r.name} {r.last_name}",
            "age": r.age,
            "coords": [float(r.latitude), float(r.longitude)],
            "anemia_value": float(r.anemia_value),
            "color": anemia_to_color(float(r.anemia_value)),
            "created_at": str(r.created_at)
        })

    cursor.close()
    conn.close()

    return data
# Importa la clase principal de FastAPI 3
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
import pymysql
import numpy as np
import math
from sklearn.neighbors import BallTree
from math import radians

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


@app.get("/api/pacientes")
def get_patients():
    conn = get_connection()
    cursor = conn.cursor()

    query = """
        SELECT id, name, last_name, age, latitude, longitude, anemia_value, created_at
        FROM paciente
    """

    cursor.execute(query)
    rows = cursor.fetchall()

    data = []
    for r in rows:
        data.append({
            "id": r["id"],
            "name": f"{r['name']} {r['last_name']}",
            "age": r["age"],
            "coords": [float(r["latitude"]), float(r["longitude"])],
            "anemia_value": float(r["anemia_value"]),
            "color": anemia_to_color(float(r["anemia_value"])),
            "created_at": str(r["created_at"])
        })

    cursor.close()
    conn.close()

    return data

# ----------------------------
# 1) Estructura Union-Find
# ----------------------------
class UFDS:
    def __init__(self, n):
        self.p = list(range(n))
        self.r = [0]*n

    def find(self, x):
        if self.p[x] != x:
            self.p[x] = self.find(self.p[x])
        return self.p[x]

    def union(self, a, b):
        ra, rb = self.find(a), self.find(b)
        if ra == rb:
            return False
        if self.r[ra] < self.r[rb]:
            self.p[ra] = rb
        elif self.r[ra] > self.r[rb]:
            self.p[rb] = ra
        else:
            self.p[rb] = ra
            self.r[ra] += 1
        return True

# ----------------------------
# 2) Endpoint de agrupamiento
# ----------------------------
@app.get("/api/union_find_clusters")
def get_union_find_clusters(R_km: float, gravedad: str):
    """
    Forma clusters de pacientes basados en proximidad geográfica usando Union-Find.
    R_km: radio de conexión entre pacientes (kilómetros)
    """
    # --- Paso 1: obtener datos desde la BD ---
    conn = get_connection()
    cursor = conn.cursor()

    if gravedad == "alta":
        condicion = "anemia_value < 8"
    elif gravedad == "media":
        condicion = "anemia_value >= 8 AND anemia_value < 10"
    elif gravedad == "baja":
        condicion = "anemia_value >= 10 AND anemia_value < 12"
    elif gravedad == "none":
        condicion = "anemia_value >= 12"
    else:
        return {"error": "Gravedad inválida"}


    query = f"""
        SELECT id, name, last_name, latitude, longitude, anemia_value
        FROM paciente WHERE {condicion}
    """
    cursor.execute(query)
    rows = cursor.fetchall()
    cursor.close()
    conn.close()

    if not rows:
        return {"clusters": []}

    # --- Paso 2: construir arrays de coordenadas ---
    ids = [r["id"] for r in rows]
    coords = np.array([[float(r["latitude"]), float(r["longitude"])] for r in rows])
    coords_rad = np.radians(coords)

    # --- Paso 3: construir BallTree para búsquedas rápidas por radio ---
    tree = BallTree(coords_rad, metric="haversine")
    R_rad = R_km / 6371.0088  # conversión a radianes

    uf = UFDS(len(coords))

    # --- Paso 4: unir puntos dentro del radio ---
    neighbors = tree.query_radius(coords_rad, r=R_rad)
    for i, neighs in enumerate(neighbors):
        for j in neighs:
            if i < j:
                uf.union(i, j)

    # --- Paso 5: formar clusters y centroides ---
    clusters_dict = {}
    for i in range(len(coords)):
        root = uf.find(i)
        if root not in clusters_dict:
            clusters_dict[root] = {"members": [], "latitudes": [], "longitudes": []}
        clusters_dict[root]["members"].append(ids[i])
        clusters_dict[root]["latitudes"].append(coords[i][0])
        clusters_dict[root]["longitudes"].append(coords[i][1])

    clusters = []
    for idx, c in enumerate(clusters_dict.values()):
        lat_c = np.mean(c["latitudes"])
        lon_c = np.mean(c["longitudes"])
        clusters.append({
            "cluster_id": idx,
            "size": len(c["members"]),
            "centroid": {"latitud": lat_c, "longitud": lon_c},
            "members": c["members"]
        })

    return {"n_clusters": len(clusters), "clusters": clusters}



# -----------------------------------------
# Función distancia Haversine (km)
# -----------------------------------------
def haversine(lat1, lon1, lat2, lon2):
    R = 6371.0088  # radio de la Tierra

    dlat = math.radians(lat2 - lat1)
    dlon = math.radians(lon2 - lon1)

    lat1 = math.radians(lat1)
    lat2 = math.radians(lat2)

    a = math.sin(dlat/2)**2 + math.cos(lat1) * math.cos(lat2) * math.sin(dlon/2)**2
    c = 2 * math.atan2(math.sqrt(a), math.sqrt(1-a))

    return R * c  # distancia en km


# -----------------------------------------
# UFDS para Kruskal (Union-Find)
# -----------------------------------------
class UFDS_UF:
    def __init__(self, n):
        self.p = list(range(n))
        self.r = [0]*n

    def find(self, x):
        if self.p[x] != x:
            self.p[x] = self.find(self.p[x])
        return self.p[x]

    def union(self, a, b):
        ra, rb = self.find(a), self.find(b)
        if ra == rb:
            return False
        if self.r[ra] < self.r[rb]:
            self.p[ra] = rb
        elif self.r[ra] > self.r[rb]:
            self.p[rb] = ra
        else:
            self.p[rb] = ra
            self.r[ra] += 1
        return True


# -----------------------------------------
# API: MST ENTRE CLUSTERS
# -----------------------------------------
@app.get("/api/mst_clusters")
def mst_clusters(R_km: float, cantidad_Grupo: int,gravedad: str):
    """
    Calcula el MST entre los centroides devueltos por /api/union_find_clusters.
    """
    # 1) Obtiene los clusters directamente SIN REQUESTS
    clusters_data = get_union_find_clusters(R_km,gravedad)

    clusters = clusters_data.get("clusters", [])

    clusters = [c for c in clusters if c["size"] >= cantidad_Grupo]

    n = len(clusters)

    if n == 0:
        return {"mst_edges": [], "message": "No hay clusters para procesar"}

    # 2) Extraer centroides
    coords = [
        (c["centroid"]["latitud"], c["centroid"]["longitud"])
        for c in clusters
    ]

    # 3) Construir todas las aristas posibles
    edges = []
    for i in range(n):
        for j in range(i + 1, n):
            lat1, lon1 = coords[i]
            lat2, lon2 = coords[j]
            d = haversine(lat1, lon1, lat2, lon2)
            edges.append((d, i, j))

    edges.sort(key=lambda x: x[0])

    # 4) Kruskal MST
    uf = UFDS_UF(n)
    mst = []

    for d, a, b in edges:
        if uf.union(a, b):
            mst.append({
                "cluster_a": a,
                "cluster_b": b,
                "distance_km": round(d, 3),
                "centroid_a": coords[a],
                "centroid_b": coords[b]
            })
        if len(mst) == n - 1:
            break

    return {
        "n_clusters": n,
        "mst_edges": mst
    }
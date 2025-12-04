# Importa la clase principal de FastAPI

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
import pymysql
import numpy as np
import math
from sklearn.neighbors import BallTree
from math import radians


import json
from math import sqrt

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


# Función para color según anemia
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
# Función pre-cargar zona_info
# -----------------------------------------

ZONA_POLYGONS = None      # lista de polígonos [ [(lon,lat), (lon,lat), ...], ... ]
ZONA_DATA = None          # datos sanitarios alineados
ZONA_CENTROIDS = None     # centroides para búsqueda rápida


def parse_wkt_polygon(wkt):
    """
    Convierte un WKT POLYGON o MULTIPOLYGON en lista [(lon,lat)...]
    Sin regex, sin imports adicionales.
    """

    if not wkt:
        return None

    wkt = wkt.strip().upper().replace("MULTIPOLYGON", "POLYGON")

    # Buscar los límites (( y ))
    start = wkt.find("((")
    end = wkt.rfind("))")

    if start == -1 or end == -1:
        return None

    inner = wkt[start+2 : end].strip()  # "-81.35 -4.9, -80.8 -4.9, ..."

    pts = inner.split(",")  # ["-81.35 -4.9", "-80.8 -4.9", ...]

    coords = []

    for p in pts:
        parts = p.strip().split()  # ["-81.35", "-4.9"]
        if len(parts) == 2:
            lon, lat = parts
            try:
                coords.append((float(lon), float(lat)))
            except:
                continue

    return coords if len(coords) >= 3 else None



def preload_zonas():
    global ZONA_POLYGONS, ZONA_DATA, ZONA_CENTROIDS

    if ZONA_POLYGONS is not None:
        return

    conn = get_connection()
    cursor = conn.cursor()

    cursor.execute("""
        SELECT accesibilidad, riesgo, bonificacion_serums, puntaje_serums,
               ST_AsText(region)
        FROM zona_info
    """)

    rows = cursor.fetchall()
    cursor.close()
    conn.close()

    ZONA_POLYGONS = []
    ZONA_DATA = []
    ZONA_CENTROIDS = []

    for row in rows:
        acc = row["accesibilidad"]
        ries = row["riesgo"]
        bon = row["bonificacion_serums"]
        pts = row["puntaje_serums"]
        wkt = row["ST_AsText(region)"]

        poly = parse_wkt_polygon(wkt)
        if not poly:
            continue

        ZONA_POLYGONS.append(poly)
        ZONA_DATA.append({
            "accesibilidad": acc,
            "riesgo": ries,
            "bonificacion_serums": bon,
            "puntaje_serums": pts
        })

        xs = [p[0] for p in poly]
        ys = [p[1] for p in poly]
        ZONA_CENTROIDS.append((sum(xs)/len(xs), sum(ys)/len(ys)))


# -----------------------------------------
# API: Zonas cargadas
# -----------------------------------------

@app.get("/api/zonas")
def api_zonas():
    preload_zonas()

    return {
        "polygons": ZONA_POLYGONS,
        "data": ZONA_DATA,
        "centroids": ZONA_CENTROIDS,
        "count": len(ZONA_POLYGONS)
    }

@app.get("/api/debug/wkt")
def debug_wkt():
    conn = get_connection()
    cursor = conn.cursor()

    cursor.execute("SELECT ST_AsText(region) AS wkt FROM zona_info LIMIT 5")

    rows = cursor.fetchall()

    cursor.close()
    conn.close()

    cleaned = []

    for r in rows:
        # Si es dict → dict["wkt"]
        if isinstance(r, dict):
            cleaned.append(r["wkt"])

        # Si es tupla → tuple[0]
        elif isinstance(r, (tuple, list)):
            cleaned.append(r[0])

        else:
            cleaned.append(str(r))

    return {"raw_wkt": cleaned}


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
# API: MST entre clusters por distancia
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

# -----------------------------------------
# Función: Algoritmo Bellman-Ford
# -----------------------------------------

def bellman_ford(n, edges, source, target):
    """
    n: número de nodos
    edges: lista de aristas (u, v, weight)
    source: nodo inicial
    target: nodo destino
    """
    dist = [float("inf")] * n
    parent = [-1] * n

    dist[source] = 0

    # Relajar (n-1) veces
    for _ in range(n - 1):
        updated = False
        for u, v, w in edges:

            # Relajación hacia adelante
            if dist[u] + w < dist[v]:
                dist[v] = dist[u] + w
                parent[v] = u
                updated = True

            # Relajación hacia atrás (grafo no dirigido)
            if dist[v] + w < dist[u]:
                dist[u] = dist[v] + w
                parent[u] = v
                updated = True

        if not updated:
            break

    # Si no hay camino
    if dist[target] == float("inf"):
        return {"error": "No existe camino entre origen y destino"}

    # Reconstruir camino
    path = []
    nodo = target

    while nodo != -1:
        path.append(nodo)
        nodo = parent[nodo]

    path.reverse()

    return {
        "distancia_km": dist[target],
        "camino": path
    }


# --------------------------------------------------
# Función de búsqueda en polígono
# --------------------------------------------------

def point_in_poly(x, y, poly):
    inside = False
    n = len(poly)
    px1, py1 = poly[0]

    for i in range(n + 1):
        px2, py2 = poly[i % n]
        if min(py1, py2) < y <= max(py1, py2) and x <= max(px1, px2):
            if py1 != py2:
                xinters = (y - py1) * (px2 - px1) / (py2 - py1) + px1
            else:
                xinters = px1
            if px1 == px2 or x <= xinters:
                inside = not inside
        px1, py1 = px2, py2

    return inside

# --------------------------------------------------
# Función de carga de zona_info
# --------------------------------------------------

def zona_info(lat, lon):
    """
    Usa la precarga:
    - ZONA_POLYGONS
    - ZONA_DATA
    - ZONA_CENTROIDS
    """
    preload_zonas()  # asegura carga

    p_lon, p_lat = lon, lat  # sistema lon,lat para polígono

    # 1) Buscar polígono contenedor
    for i, poly in enumerate(ZONA_POLYGONS):
        if poly and point_in_poly(p_lon, p_lat, poly):
            return ZONA_DATA[i]

    # 2) Buscar zona más cercana si no está dentro de ninguna
    best_i = None
    best_dist = float("inf")

    for i, (cx, cy) in enumerate(ZONA_CENTROIDS):
        d = (cx - p_lon)**2 + (cy - p_lat)**2
        if d < best_dist:
            best_dist = d
            best_i = i

    if best_i is not None:
        return ZONA_DATA[best_i]

    # 3) fallback
    return {
        "accesibilidad": 0,
        "riesgo": 0,
        "bonificacion_serums": 0,
        "puntaje_serums": 0
    }


# --------------------------------------------------
# API: Bellman-Ford entre clusters pór distancia 
# --------------------------------------------------

@app.get("/api/bellman_ford_clusters")
def api_bellman_ford_clusters(R_km: float, cantidad_Grupo: int, gravedad: str,
                              origen: int, destino: int):
    """
    Ejecuta Bellman-Ford sobre los centroides de clusters.
    Parámetros:
    - origen: índice del nodo origen (cluster)
    - destino: índice del nodo destino (cluster)
    """

    # 1) Obtener clusters
    clusters_data = get_union_find_clusters(R_km, gravedad)
    clusters = clusters_data.get("clusters", [])
    clusters = [c for c in clusters if c["size"] >= cantidad_Grupo]

    n = len(clusters)

    if origen >= n or destino >= n:
        return {"error": "Nodo origen o destino fuera de rango"}

    # 2) Extraer centroides
    coords = [
        (c["centroid"]["latitud"], c["centroid"]["longitud"])
        for c in clusters
    ]

    # 3) Construir TODAS las aristas (grafo completo)
    edges = []
    for i in range(n):
        for j in range(i + 1, n):
            lat1, lon1 = coords[i]
            lat2, lon2 = coords[j]
            distancia = haversine(lat1, lon1, lat2, lon2)
            edges.append((i, j, distancia))

    # 4) Ejecutar Bellman-Ford
    resultado = bellman_ford(n, edges, origen, destino)

    return {
        "clusters_totales": n,
        "origen": origen,
        "destino": destino,
        "resultado": resultado
    }


# --------------------------------------------
# API: MST con distancias adicionales simple
# --------------------------------------------

@app.get("/api/mst_clusters_plus")
def mst_clusters_plus(R_km: float, cantidad_Grupo: int, gravedad: str, K: int = 3):
    """
    Calcula:
    1) MST entre clusters
    2) Conexiones adicionales usando K vecinos más cercanos (KNN)
    Devuelve un grafo más realista que el MST puro, manteniendo el mismo formato.
    """

    # 1. Obtener clusters
    clusters_data = get_union_find_clusters(R_km, gravedad)
    clusters = clusters_data.get("clusters", [])
    clusters = [c for c in clusters if c["size"] >= cantidad_Grupo]

    n = len(clusters)
    if n == 0:
        return {"mst_edges": [], "extra_edges": [], "all_edges": [], "message": "No hay clusters para graficar"}

    # 2. Extraer centroides
    coords = [(c["centroid"]["latitud"], c["centroid"]["longitud"]) for c in clusters]

    # 3. Construir todas las aristas posibles
    all_edges_list = []
    for i in range(n):
        for j in range(i + 1, n):
            lat1, lon1 = coords[i]
            lat2, lon2 = coords[j]
            d = haversine(lat1, lon1, lat2, lon2)
            all_edges_list.append((d, i, j))

    all_edges_list.sort(key=lambda x: x[0])

    # 4. Construir MST
    uf = UFDS_UF(n)
    mst_edges_internal = []

    for d, a, b in all_edges_list:
        if uf.union(a, b):
            mst_edges_internal.append((round(d, 3), a, b))
        if len(mst_edges_internal) == n - 1:
            break

    # -----------------------------
    # 5. Conexiones KNN adicionales
    # -----------------------------

    # Matriz de distancias
    dist_matrix = [[0] * n for _ in range(n)]
    for d, a, b in all_edges_list:
        dist_matrix[a][b] = d
        dist_matrix[b][a] = d

    extra_edges_internal = []

    for i in range(n):
        # lista de distancias desde i hacia todos
        dist_list = [(dist_matrix[i][j], i, j) for j in range(n) if j != i]
        dist_list.sort(key=lambda x: x[0])

        # tomar los K vecinos más cercanos
        for k in range(min(K, len(dist_list))):
            d, a, b = dist_list[k]
            edge_tuple = (round(d, 3), a, b)

            if edge_tuple not in mst_edges_internal and edge_tuple not in extra_edges_internal:
                extra_edges_internal.append(edge_tuple)

    # -----------------------------
    # 6. Construir output final
    # -----------------------------
    final_edges = []

    # MST edges
    for d, a, b in mst_edges_internal:
        final_edges.append({
            "type": "mst",
            "cluster_a": a,
            "cluster_b": b,
            "distance_km": d,
            "centroid_a": coords[a],
            "centroid_b": coords[b]
        })

    # Extra edges
    for d, a, b in extra_edges_internal:
        final_edges.append({
            "type": "extra",
            "cluster_a": a,
            "cluster_b": b,
            "distance_km": d,
            "centroid_a": coords[a],
            "centroid_b": coords[b]
        })

    return {
        "n_clusters": n,
        "mst_edges": [e for e in final_edges if e["type"] == "mst"],   # Compatible con tu frontend
        "extra_edges": [e for e in final_edges if e["type"] == "extra"],
        "all_edges": final_edges                                      # Para Bellman-Ford
    }


# -----------------------------------------------------
# API: MST con distancias adicionales complejo
# -----------------------------------------------------

@app.get("/api/mst_clusters_plus_V2")

def mst_clusters_plus_V2(R_km: float, cantidad_Grupo: int, gravedad: str, K: int = 3):
    """
    Devuelve:
    - MST entre clusters
    - Conexiones extra KNN
    - Peso sanitario basado en zona_info
    """

    # 1. Obtener clusters
    clusters_data = get_union_find_clusters(R_km, gravedad)
    clusters = clusters_data.get("clusters", [])
    clusters = [c for c in clusters if c["size"] >= cantidad_Grupo]

    n = len(clusters)
    if n == 0:
        return {"mst_edges": [], "extra_edges": [], "all_edges": [], "message": "No hay clusters"}

    # 2. Centroides
    coords = [(c["centroid"]["latitud"], c["centroid"]["longitud"]) for c in clusters]

    # -------------------------------------------------------------------
    # 3. Función interna zona_info
    # -------------------------------------------------------------------
    def zona_infoPre(lat, lon):
        conn = get_connection()
        cursor = conn.cursor()

        
        # 1) Intentar encontrar zona que contenga el punto
        query1 = """
            SELECT accesibilidad, riesgo, bonificacion_serums, puntaje_serums
            FROM zona_info
            WHERE ST_Contains(
                region,
                ST_GeomFromText(CONCAT('POINT(', %s, ' ', %s, ')'))
            )
            LIMIT 1
        """
        cursor.execute(query1, (lon, lat))
        row = cursor.fetchone()

        # 2) Si no contiene, buscar zona más cercana
        if not row:
            query2 = """
                SELECT accesibilidad, riesgo, bonificacion_serums, puntaje_serums
                FROM zona_info
                ORDER BY ST_Distance(
                    region,
                    ST_GeomFromText(CONCAT('POINT(', %s, ' ', %s, ')'))
                )
                LIMIT 1
            """
            cursor.execute(query2, (lon, lat))
            row = cursor.fetchone()

        cursor.close()
        conn.close()

        if not row:
            return {
                "accesibilidad": 0,
                "riesgo": 0,
                "bonificacion_serums": 0,
                "puntaje_serums": 0
            }

        return row

    # -------------------------------------------------------------------
    # 3. Función interna zona_info (optimizada)
    # -------------------------------------------------------------------
    def zona_info(lat, lon):
        """
        Retorna info sanitaria usando SOLO datos precargados:
        - ZONA_POLYGONS
        - ZONA_DATA
        - ZONA_CENTROIDS
        """

        preload_zonas()  # asegura que está cargado

        p_lon, p_lat = lon, lat   # el polígono está en (lon,lat)

        # ------------------------------------
        # 1) Buscar polígono que contiene el punto
        # ------------------------------------
        for i, poly in enumerate(ZONA_POLYGONS):
            if poly and point_in_poly(p_lon, p_lat, poly):
                return ZONA_DATA[i]

        # ------------------------------------
        # 2) Si no cae dentro de ningún polígono, buscar por el más cercano
        # ------------------------------------
        best_i = None
        best_dist = float("inf")

        for i, (cx, cy) in enumerate(ZONA_CENTROIDS):
            d = (cx - p_lon)**2 + (cy - p_lat)**2
            if d < best_dist:
                best_dist = d
                best_i = i

        if best_i is not None:
            return ZONA_DATA[best_i]

        # ------------------------------------
        # 3) fallback si todo falla
        # ------------------------------------
        return {
            "accesibilidad": 0,
            "riesgo": 0,
            "bonificacion_serums": 0,
            "puntaje_serums": 0
        }




    # -------------------------------------------------------------------
    # 4. Construcción del cache de zona por cluster
    # -------------------------------------------------------------------
    zona_cache = []
    for lat, lon in coords:
        zona_cache.append(zona_info(lat, lon))

    # -------------------------------------------------------------------
    # 5. Construir TODAS las aristas con peso sanitario
    # -------------------------------------------------------------------
    all_edges_list = []
    for i in range(n):
        for j in range(i + 1, n):
            lat1, lon1 = coords[i]
            lat2, lon2 = coords[j]
            d = haversine(lat1, lon1, lat2, lon2)

            Z = zona_cache[j]

            peso_sanitario = (
                d
                + Z["riesgo"]
                + Z["accesibilidad"]
                - Z["bonificacion_serums"]
                - Z["puntaje_serums"]
            )

            all_edges_list.append((round(d, 3), i, j, round(peso_sanitario, 3), Z))

    all_edges_list.sort(key=lambda x: x[0])

    # -------------------------------------------------------------------
    # 6. MST
    # -------------------------------------------------------------------
    uf = UFDS_UF(n)
    mst_edges_internal = []

    for d, a, b, w, zona in all_edges_list:
        if uf.union(a, b):
            mst_edges_internal.append((d, a, b, w, zona))
        if len(mst_edges_internal) == n - 1:
            break

    # -------------------------------------------------------------------
    # 7. K vecinos adicionales
    # -------------------------------------------------------------------
    dist_matrix = [[0] * n for _ in range(n)]
    for d, a, b, w, zona in all_edges_list:
        dist_matrix[a][b] = d
        dist_matrix[b][a] = d

    extra_edges_internal = []

    for i in range(n):
        dist_list = [(dist_matrix[i][j], i, j) for j in range(n) if j != i]
        dist_list.sort(key=lambda x: x[0])

        for k in range(min(K, len(dist_list))):
            d, a, b = dist_list[k]

            for item in all_edges_list:
                if item[1] == a and item[2] == b:
                    d2, aa, bb, w2, zona2 = item
                    edge = (d2, aa, bb, w2, zona2)
                    break

            if edge not in mst_edges_internal and edge not in extra_edges_internal:
                extra_edges_internal.append(edge)

    # -------------------------------------------------------------------
    # 8. Build final json
    # -------------------------------------------------------------------
    final_edges = []

    for d, a, b, w, zona in mst_edges_internal:
        final_edges.append({
            "type": "mst",
            "cluster_a": a,
            "cluster_b": b,
            "distance_km": d,
            "peso_sanitario": w,
            "sanitario": zona,
            "centroid_a": coords[a],
            "centroid_b": coords[b]
        })

    for d, a, b, w, zona in extra_edges_internal:
        final_edges.append({
            "type": "extra",
            "cluster_a": a,
            "cluster_b": b,
            "distance_km": d,
            "peso_sanitario": w,
            "sanitario": zona,
            "centroid_a": coords[a],
            "centroid_b": coords[b]
        })

    return {
        "n_clusters": n,
        "clusters": clusters,
        "mst_edges": [e for e in final_edges if e["type"] == "mst"],
        "extra_edges": [e for e in final_edges if e["type"] == "extra"],
        "all_edges": final_edges
    }



# -----------------------------------------------------------
# API: MST Plus con rutas adicionales y zonas precargadas
# -----------------------------------------------------------

@app.get("/api/mst_clusters_plus_V3")
def mst_clusters_plus_V3(R_km: float, cantidad_Grupo: int, gravedad: str, K: int = 3):
    """
    Devuelve:
    - MST entre clusters
    - Conexiones extra KNN
    - Peso sanitario basado en zona_info (rápido, sin SQL)
    """

    # 1. Obtener clusters
    clusters_data = get_union_find_clusters(R_km, gravedad)
    clusters = clusters_data.get("clusters", [])
    clusters = [c for c in clusters if c["size"] >= cantidad_Grupo]

    n = len(clusters)
    if n == 0:
        return {"mst_edges": [], "extra_edges": [], "all_edges": [], "message": "No hay clusters"}

    # 2. Centroides
    coords = [(c["centroid"]["latitud"], c["centroid"]["longitud"]) 
              for c in clusters]

    # -----------------------------------------
    # 3. Cargar zonas UNA SOLA VEZ (si no está cargado)
    # -----------------------------------------
    preload_zonas()

    # -----------------------------------------
    # 4. Obtener datos sanitarios para cada cluster
    # -----------------------------------------
    zona_cache = []
    for lat, lon in coords:
        zona_cache.append(zona_info(lat, lon))  # <<< usa función nueva en memoria

    # -----------------------------------------
    # 5. Generar TODAS las aristas con su peso sanitario
    # -----------------------------------------
    all_edges_list = []

    for i in range(n):
        for j in range(i + 1, n):
            lat1, lon1 = coords[i]
            lat2, lon2 = coords[j]

            d = haversine(lat1, lon1, lat2, lon2)
            Z = zona_cache[j]

            peso_sanitario = (
                d
                + Z["riesgo"]
                + Z["accesibilidad"]
                - Z["bonificacion_serums"]
                - Z["puntaje_serums"]
            )

            all_edges_list.append((round(d, 3), i, j, round(peso_sanitario, 3), Z))

    all_edges_list.sort(key=lambda x: x[0])

    # -----------------------------------------
    # 6. Construir el MST
    # -----------------------------------------
    uf = UFDS_UF(n)
    mst_edges_internal = []

    for d, a, b, w, zona in all_edges_list:
        if uf.union(a, b):
            mst_edges_internal.append((d, a, b, w, zona))
        if len(mst_edges_internal) == n - 1:
            break

    # -----------------------------------------
    # 7. K vecinos adicionales (KNN)
    # -----------------------------------------
    dist_matrix = [[0] * n for _ in range(n)]
    for d, a, b, w, zona in all_edges_list:
        dist_matrix[a][b] = d
        dist_matrix[b][a] = d

    extra_edges_internal = []

    for i in range(n):
        dist_list = [(dist_matrix[i][j], i, j) for j in range(n) if j != i]
        dist_list.sort(key=lambda x: x[0])

        for k in range(min(K, len(dist_list))):
            d, a, b = dist_list[k]

            # Recuperar la arista original
            for item in all_edges_list:
                if item[1] == a and item[2] == b:
                    d2, aa, bb, w2, zona2 = item
                    edge = (d2, aa, bb, w2, zona2)
                    break

            if edge not in mst_edges_internal and edge not in extra_edges_internal:
                extra_edges_internal.append(edge)

    # -----------------------------------------
    # 8. Formar JSON final
    # -----------------------------------------
    final_edges = []

    for d, a, b, w, zona in mst_edges_internal:
        final_edges.append({
            "type": "mst",
            "cluster_a": a,
            "cluster_b": b,
            "distance_km": d,
            "peso_sanitario": w,
            "sanitario": zona,
            "centroid_a": coords[a],
            "centroid_b": coords[b]
        })

    for d, a, b, w, zona in extra_edges_internal:
        final_edges.append({
            "type": "extra",
            "cluster_a": a,
            "cluster_b": b,
            "distance_km": d,
            "peso_sanitario": w,
            "sanitario": zona,
            "centroid_a": coords[a],
            "centroid_b": coords[b]
        })

    return {
        "n_clusters": n,
        "clusters": clusters,
        "mst_edges": [e for e in final_edges if e["type"] == "mst"],
        "extra_edges": [e for e in final_edges if e["type"] == "extra"],
        "all_edges": final_edges
    }


# -----------------------------------------------------------
# Función: Detectar ciclos negativos
# -----------------------------------------------------------
def bellman_detect_cycle(n, edge_list, origen):
    INF = float("inf")
    dist = [INF] * n
    parent = [-1] * n

    dist[origen] = 0

    # FASE 1 — Relajaciones normales (n-1)
    for _ in range(n - 1):
        improved = False
        for u, v, w in edge_list:
            if dist[u] != INF and dist[u] + w < dist[v]:
                dist[v] = dist[u] + w
                parent[v] = u
                improved = True
        if not improved:
            break

    # FASE 2 — Buscar ciclo negativo
    cycle_node = None
    for u, v, w in edge_list:
        if dist[u] != INF and dist[u] + w < dist[v]:
            cycle_node = v
            break

    # Si NO hay ciclo negativo → devolver dist y parent
    if cycle_node is None:
        return {
            "error": False,
            "dist": dist,
            "parent": parent
        }

    # RECONSTRUIR ciclo negativo
    for _ in range(n):
        cycle_node = parent[cycle_node]

    cycle = [cycle_node]
    x = parent[cycle_node]

    while x != cycle_node:
        cycle.append(x)
        x = parent[x]
    cycle.append(cycle_node)
    cycle.reverse()

    return {
        "error": True,
        "message": "NEGATIVE_CYCLE_DETECTED",
        "cycle_nodes": cycle
    }



# -----------------------------------------------------------
# API: Bellman-Ford entre clusters finales con pesos finales
# -----------------------------------------------------------
@app.get("/api/bellman_paths_V1")

def bellman_paths_V1(R_km: float,
                  cantidad_Grupo: int,
                  gravedad: str,
                  K: int = 3,
                  origen: int = 0,
                  destino: int | None = None,
                  top: int = 4):
    """
    Ejecuta Bellman–Ford usando el grafo generado por /api/mst_clusters_plusPro.
    
    - Si destino está definido → devuelve la mejor ruta origen→destino.
    - Si destino NO está definido → devuelve el TOP N (top=4 por defecto) mejores rutas.
    """

    # 1. Obtener grafo completo con pesos sanitarios ya calculados
    graph = mst_clusters_plus_V3(R_km, cantidad_Grupo, gravedad, K)

    n = graph["n_clusters"]
    edges = graph["all_edges"]  # contiene centroides + peso_sanitario

    # -------------------------------
    # 2. Construir lista de aristas (u, v, peso)
    # -------------------------------
    edge_list = []
    for e in edges:
        u = e["cluster_a"]
        v = e["cluster_b"]
        w = e["peso_sanitario"]
        edge_list.append((u, v, w))
        edge_list.append((v, u, w))  # grafo no dirigido

    # -------------------------------
    # 3. Ejecutar Bellman-Ford
    # -------------------------------
    INF = float("inf")
    dist = [INF] * n
    parent = [-1] * n
    dist[origen] = 0

    for _ in range(n - 1):
        updated = False
        for u, v, w in edge_list:
            if dist[u] != INF and dist[u] + w < dist[v]:
                dist[v] = dist[u] + w
                parent[v] = u
                updated = True
        if not updated:
            break

    # -------------------------------
    # 4. Si hay destino → devolver ruta única
    # -------------------------------
    if destino is not None:
        if dist[destino] == INF:
            return {"error": "No existe ruta hacia ese destino"}

        # reconstruir la ruta
        path = []
        cur = destino
        while cur != -1:
            path.append(cur)
            cur = parent[cur]
        path.reverse()

        ruta_aristas = []
        for i in range(len(path) - 1):
            a = path[i]
            b = path[i + 1]
            # buscar arista exacta
            for e in edges:
                if (e["cluster_a"] == a and e["cluster_b"] == b) or \
                   (e["cluster_a"] == b and e["cluster_b"] == a):
                    ruta_aristas.append(e)
                    break

        return {
            "modo": "origen_destino",
            "origen": origen,
            "destino": destino,
            "ruta": path,
            "aristas": ruta_aristas,
            "costo_total": dist[destino]
        }

    # ---------------------------------------------
    # 5. Sin destino devuelve mejores rutas (top)
    # ---------------------------------------------
    ranking = []
    for nodo in range(n):
        if nodo != origen and dist[nodo] < INF:
            ranking.append((dist[nodo], nodo))

    ranking.sort(key=lambda x: x[0])
    ranking = ranking[:top]

    rutas = []
    for costo, nodo_final in ranking:
        path = []
        cur = nodo_final
        while cur != -1:
            path.append(cur)
            cur = parent[cur]
        path.reverse()

        ruta_aristas = []
        for i in range(len(path) - 1):
            a = path[i]
            b = path[i + 1]
            for e in edges:
                if (e["cluster_a"] == a and e["cluster_b"] == b) or \
                   (e["cluster_a"] == b and e["cluster_b"] == a):
                    ruta_aristas.append(e)
                    break

        rutas.append({
            "destino": nodo_final,
            "ruta": path,
            "aristas": ruta_aristas,
            "costo_total": costo
        })

    return {
        "modo": "top_rutas",
        "origen": origen,
        "top": top,
        "mejores_rutas": rutas
    }



# ------------------------------------------------------------------------------------------
# API: Bellman-Ford entre clusters finales con pesos finales e identificación de ciclos
# ------------------------------------------------------------------------------------------
@app.get("/api/bellman_paths_V2")

def bellman_paths_V2(R_km: float,
                  cantidad_Grupo: int,
                  gravedad: str,
                  K: int = 3,
                  origen: int = 0,
                  destino: int | None = None,
                  top: int = 4):
    """
    Ejecuta Bellman–Ford usando el grafo generado por /api/mst_clusters_plusPro.
    
    - Si destino está definido → devuelve la mejor ruta origen→destino.
    - Si destino NO está definido → devuelve el TOP N (top=4 por defecto) mejores rutas.
    """

    # 1. Obtener grafo completo con pesos sanitarios ya calculados
    graph = mst_clusters_plus_V3(R_km, cantidad_Grupo, gravedad, K)

    n = graph["n_clusters"]
    edges = graph["all_edges"]  # contiene centroides + peso_sanitario

    # -------------------------------
    # 2. Construir lista de aristas (u, v, peso)
    # -------------------------------
    edge_list = []
    for e in edges:
        u = e["cluster_a"]
        v = e["cluster_b"]
        w = e["peso_sanitario"]
        edge_list.append((u, v, w))
        edge_list.append((v, u, w))  # grafo no dirigido

    # ------------------------------------------------------
    # 3. Ejecutar Bellman-Ford con detección de ciclo negativo
    # ------------------------------------------------------

    INF = float("inf")
    dist = [INF] * n
    parent = [-1] * n
    dist[origen] = 0

    # Relajación estándar n-1 veces
    for _ in range(n - 1):
        updated = False
        for u, v, w in edge_list:
            if dist[u] != INF and dist[u] + w < dist[v]:
                dist[v] = dist[u] + w
                parent[v] = u
                updated = True
        if not updated:
            break

    # -----------------------------------------
    # 3b. Detección de ciclo negativo
    # -----------------------------------------
    ciclo_negativo_nodo = None
    for u, v, w in edge_list:
        if dist[u] != INF and dist[u] + w < dist[v]:
            ciclo_negativo_nodo = v
            break

    # -----------------------------------------
    # 3c. Si hay ciclo negativo → reconstruirlo
    # -----------------------------------------
    if ciclo_negativo_nodo is not None:

        # caminar n veces para asegurar caer dentro del ciclo
        x = ciclo_negativo_nodo
        for _ in range(n):
            x = parent[x]

        # reconstruir ciclo
        cycle_nodes = [x]
        cur = parent[x]
        while cur != x and cur != -1:
            cycle_nodes.append(cur)
            cur = parent[cur]

        cycle_nodes.append(x)  # cerrar ciclo

        # recolectar aristas del ciclo (en tu mismo formato actual)
        cycle_edges = []
        for i in range(len(cycle_nodes) - 1):
            a = cycle_nodes[i]
            b = cycle_nodes[i + 1]
            for e in edges:
                if (e["cluster_a"] == a and e["cluster_b"] == b) or \
                   (e["cluster_a"] == b and e["cluster_b"] == a):
                    cycle_edges.append(e)
                    break

        return {
            "modo": "ciclo_negativo",
            "error": True,
            "mensaje": "El grafo contiene un ciclo negativo. Bellman–Ford no puede calcular rutas.",
            "cycle_nodes": cycle_nodes,
            "cycle_edges": cycle_edges
        }



    # -------------------------------
    # 4. Si hay destino → devolver ruta única
    # -------------------------------
    if destino is not None:
        if dist[destino] == INF:
            return {"error": "No existe ruta hacia ese destino"}

        # reconstruir la ruta
        path = []
        cur = destino
        while cur != -1:
            path.append(cur)
            cur = parent[cur]
        path.reverse()

        ruta_aristas = []
        for i in range(len(path) - 1):
            a = path[i]
            b = path[i + 1]
            # buscar arista exacta
            for e in edges:
                if (e["cluster_a"] == a and e["cluster_b"] == b) or \
                   (e["cluster_a"] == b and e["cluster_b"] == a):
                    ruta_aristas.append(e)
                    break

        return {
            "modo": "origen_destino",
            "origen": origen,
            "destino": destino,
            "ruta": path,
            "aristas": ruta_aristas,
            "costo_total": dist[destino]
        }

    # ---------------------------------------------
    # 5. Sin destino devuelve mejores rutas (top)
    # ---------------------------------------------
    ranking = []
    for nodo in range(n):
        if nodo != origen and dist[nodo] < INF:
            ranking.append((dist[nodo], nodo))

    ranking.sort(key=lambda x: x[0])
    ranking = ranking[:top]

    rutas = []
    for costo, nodo_final in ranking:
        path = []
        cur = nodo_final
        while cur != -1:
            path.append(cur)
            cur = parent[cur]
        path.reverse()

        ruta_aristas = []
        for i in range(len(path) - 1):
            a = path[i]
            b = path[i + 1]
            for e in edges:
                if (e["cluster_a"] == a and e["cluster_b"] == b) or \
                   (e["cluster_a"] == b and e["cluster_b"] == a):
                    ruta_aristas.append(e)
                    break

        rutas.append({
            "destino": nodo_final,
            "ruta": path,
            "aristas": ruta_aristas,
            "costo_total": costo
        })

    return {
        "modo": "top_rutas",
        "origen": origen,
        "top": top,
        "mejores_rutas": rutas
    }



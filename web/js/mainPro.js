// Importa Graphology para manejar el grafo en memoria
import Graph from "graphology";
import { parse } from "graphology-gexf/browser";

// Importa Sigma para renderizar el grafo
import Sigma from "sigma";

// Carga de módulos  para mapas
import bindLeafletLayer from "@sigma/layer-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";


export default function main() {
  // Obtener todos los botones de pestañas (Resumen / Mapa / Datos)
  const triggers = [...document.querySelectorAll(".tab-trigger")];
  const contents = [...document.querySelectorAll(".tab-content")];

  // Referencia a los contenedores
  const sigmaContainer = document.getElementById("sigma-container");
  const pacienteInfoContainer = document.getElementById("pacient-info-container");
  const datosContainer = document.getElementById("datos-container");
  const resumenContainer = document.getElementById("resumen-container");

  // Localizador de bloque de controles del mapa
  const mapControls =
    document.querySelector(".map-controls") ||
    document.querySelector(".graph-controls") ||
    document.getElementById("map-controls");

  // Mantiene la instancia global de Sigma para controlar su ciclo de vida

  let renderer = null;
  let cleanup = null;
  let modoCluster = false;

  // ----------------------------------------------------------------------------------
  // Función: Destruir instancia de Sigma cuando se va a reutilizar el contenedor
  // ----------------------------------------------------------------------------------
  function destroySigma() {
    if (renderer) {
      renderer.kill();
      renderer = null;
    }
  }

  // ----------------------------------------------------------------------------------
  // Función: Activar pestaña (Resumen / Mapa / Datos) y controlar contenido
  // ----------------------------------------------------------------------------------
  async function activateTab(name, buttonName) {
    // Marca visualmente el botón activo y desactiva el resto
    triggers.forEach((btn) =>
      btn.classList.toggle("active", btn.getAttribute("data-tab") === name)
    );

    // Muestra el panel de contenido asociado y oculta los demás
    contents.forEach((panel) =>
      panel.classList.toggle("active", panel.dataset.content === name)
    );

    // Por defecto, se ocultan mapa y controles hasta decidir qué pestaña mostrar
    sigmaContainer.style.display = "none";
    if (mapControls) mapControls.style.display = "none";

    // Si la pestaña seleccionada es "mapa", se muestra el contenedor del mapa
    if (name === "mapa") {
      // Muestra el contenedor del mapa
      sigmaContainer.style.display = "block";
      pacienteInfoContainer.style.display = "block";

      datosContainer.style.display = "none";

      // Muestra los controles solo si existen
      if (mapControls) mapControls.style.display = "flex";

      // Carga Sigma solo la primera vez; si ya existe, refresca el render
      if (!renderer) {
        await loadSigma();
      } else {
        renderer.refresh?.();
      }

      if (!renderer) {
        if (modoCluster) {
          const kmInput = document.getElementById("input-km");
          const km = Number(kmInput?.value || 10);
          await loadCluster(km, cantidadCluster, gravedad);
        } else {
          await loadSigma();
        }
      } else {
        renderer.refresh?.();
      }


    }
    // Si la pestaña seleccionada es "datos", se reemplaza el contenido por datos del backend
    else if (name === "datos") {
      // Destruye Sigma para reutilizar con seguridad el contenedor
      destroySigma();
      // Limpia el contenedor antes de inyectar el nuevo contenido
      sigmaContainer.innerHTML = "";
      // Asegura que el contenedor sea visible para mostrar los datos
      sigmaContainer.style.display = "none";
      pacienteInfoContainer.style.display = "none";
      datosContainer.style.display = "block";

      // Invoca la función que obtiene e inserta los datos del backend
      //displayBackendData();
      displayTableFromBackend();

    }

    else if (name === "resumen") {
      destroySigma();
      sigmaContainer.innerHTML = "";
      sigmaContainer.style.display = "none";
      pacienteInfoContainer.style.display = "none";
      datosContainer.style.display = "none";
      resumenContainer.style.display = "block";

      displayResumenFromBackend();

    }
    // Si la pestaña es "resumen" u otra, se oculta y limpia el contenedor
    else {
      // Destruye Sigma si estaba activo para liberar recursos
      destroySigma();
      // Limpia el contenedor para evitar restos visuales
      sigmaContainer.innerHTML = "";
      // Se mantiene oculto salvo que quieras inyectar contenido de resumen
    }
  }

  // ----------------------------------------------------------------------------------
  // Enlaza el click de todas las pestañas con la función activateTab
  // ----------------------------------------------------------------------------------
  triggers.forEach((btn) =>
    btn.addEventListener("click", () => activateTab(btn.dataset.tab))
  );

  // Define la pestaña inicial al cargar (puedes cambiar a "mapa" si lo prefieres)
  const initialTab = "resumen";
  // Activa la pestaña inicial
  activateTab(initialTab);

  // ----------------------------------------------------------------------------------
  // Función: Cargar Sigma y enlazar controles (Zoom/Reset + Umbral de etiquetas)
  // ----------------------------------------------------------------------------------

  async function loadSigmaPre() {
    try {
      // Solicita el archivo GEXF al servidor
      const res = await fetch("/data/arctic.gexf");
      if (!res.ok) throw new Error(`HTTP error ${res.status}`);

      // Lee el contenido del archivo GEXF como texto
      const gexf = await res.text();

      // Parsea el texto GEXF y crea el grafo en memoria
      const graph = parse(Graph, gexf);

      // Paleta de colores para los nodos
      const palette = ["#ef4444", "#3b82f6", "#10b981", "#f59e0b", "#8b5cf6", "#06b6d4", "#f43f5e", "#22c55e"];

      // Asegura que todos los nodos tengan coordenadas numéricas (fallback aleatorio)
      graph.forEachNode((node, attr) => {
        attr.x = Number(attr.x ?? Math.random());
        attr.y = Number(attr.y ?? Math.random());
        const color = palette[Math.floor(Math.random() * palette.length)];
        graph.setNodeAttribute(node, "color", color);
        graph.setNodeAttribute(node, "size", 25);
      });



      // Crea la instancia de Sigma en el contenedor
      renderer = new Sigma(graph, sigmaContainer, {
        minCameraRatio: 0.08,
        maxCameraRatio: 3,
      });

      // Obtiene la cámara para realizar animaciones de zoom y reset
      const camera = renderer.getCamera();

      // Localiza botones y slider de umbral de etiquetas
      const zoomInBtn = document.getElementById("zoom-in");
      const zoomOutBtn = document.getElementById("zoom-out");
      const zoomResetBtn = document.getElementById("zoom-reset");
      const labelsThresholdRange = document.getElementById("labels-threshold");

      // Asigna el evento para acercar con animación
      zoomInBtn?.addEventListener("click", () =>
        camera.animatedZoom({ duration: 600 })
      );
      // Asigna el evento para alejar con animación
      zoomOutBtn?.addEventListener("click", () =>
        camera.animatedUnzoom({ duration: 600 })
      );
      // Asigna el evento para reencuadrar la vista inicial con animación
      zoomResetBtn?.addEventListener("click", () =>
        camera.animatedReset({ duration: 600 })
      );

      // Si existe el slider, conecta su valor con el umbral de render de etiquetas
      if (labelsThresholdRange) {
        labelsThresholdRange.addEventListener("input", () => {
          // Convierte el valor del slider a número y lo aplica al ajuste de Sigma
          const val = Number(labelsThresholdRange.value);
          renderer.setSetting("labelRenderedSizeThreshold", val);
          // Refresca el render para aplicar inmediatamente los cambios
          renderer.refresh();
        });
      }

      // Define una rutina de limpieza opcional para destruir Sigma cuando se requiera
      cleanup = () => {
        renderer?.kill();
        renderer = null;
      };
    } catch (err) {
      // Informa cualquier error en la carga o renderizado de Sigma
      console.error("[mainPro] Error al cargar/renderizar Sigma:", err);
    }
  }

  // ----------------------------------------------------------------------------------
  // Función: Cargar sigma con MAPA
  // ----------------------------------------------------------------------------------
  async function loadSigma() {
    try {
      // Elimina el mapa previo si existe (evita duplicados)
      if (window._mapInstance) {
        window._mapInstance.remove();
        window._mapInstance = null;
      }

      // Crea o limpia el contenedor del mapa
      let mapDiv = document.getElementById("map-container");
      if (!mapDiv) {
        mapDiv = document.createElement("div");
        mapDiv.id = "map-container";
        mapDiv.style.width = "100%";
        // Altura fija para mantener la visibilidad
        mapDiv.style.height = "800px";
        mapDiv.style.border = "2px solid #ccc";
        mapDiv.style.borderRadius = "12px";
        mapDiv.style.overflow = "hidden";
        mapDiv.style.position = "relative";
        mapDiv.style.zIndex = "1";

        // Inserta el contenedor dentro del elemento padre principal
        const parent = document.getElementById("sigma-container");
        if (!parent) throw new Error("No se encontró el elemento #sigma-container");
        parent.innerHTML = "";
        parent.appendChild(mapDiv);
      }

      // Crea el mapa centrado en Perú
      const map = L.map(mapDiv, {
        // Habilita el control de zoom
        zoomControl: true,
        worldCopyJump: false,
        minZoom: 5,
        maxZoom: 12,
      }).setView([-9.19, -75.0152], 6);

      // Carga la capa base de OpenStreetMap
      L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
        attribution: "© OpenStreetMap contributors",
        maxZoom: 20,
      }).addTo(map);

      // Fuerza el recálculo del tamaño del mapa (corrige el mosaico inicial)
      setTimeout(() => {
        map.invalidateSize();
      }, 300);

      // Agrega el marcador principal (Lima)
      L.circleMarker([-12.0464, -77.0428], {
        radius: 10,
        color: "#e63946",
        fillColor: "#e63946",
        fillOpacity: 0.9,
      })
        .addTo(map)
        .bindPopup("<b>Lima</b><br>Capital del Perú")
        .openPopup();


      // Cargar pacientes desde el backend
      const data = await callAPIBackend("/api/pacientes");

      // Si hay datos válidos, dibujar cada paciente en el mapa
      if (Array.isArray(data)) {
        data.forEach((p) => {

          // Color calculado automáticamente según anemia
          const color = anemiaToColor(Number(p.anemia_value));

          L.circleMarker(p.coords, {
            radius: 8,
            color: color,       // Color según nive de anemia
            fillColor: color,
            fillOpacity: 0.9,
          })
            .addTo(map)
            .bindPopup(`
        <b>${p.name}</b><br>
        Edad: ${p.age}<br>
        Anemia: ${p.anemia_value} g/dL<br>
        Fecha: ${p.created_at}<br>
      `);
        });
      } else {
        console.error("Error: backend no devolvió array", data);
      }

      // Guarda la referencia global del mapa
      window._mapInstance = map;

      // Define la rutina de limpieza (opcional si se usa Sigma)
      cleanup = () => {
        if (window._mapInstance) {
          window._mapInstance.remove();
          window._mapInstance = null;
        }
        renderer?.kill?.();
        renderer = null;
      };
    } catch (err) {
      // Maneja errores en la carga o renderizado del mapa
      console.error("[mainPro] Error al cargar/renderizar el mapa:", err);
    }
  }

  // ----------------------------------------------------------------------------------
  // Función auxiliar: Llamar al API del backend y devolver el JSON
  // ----------------------------------------------------------------------------------

  async function callAPIBackendPre() {
    // Define la URL del endpoint del backend
    const apiUrlPRE = "https://childcaremap-capabackend.up.railway.app/api/saludo";
    const apiUrl = "https://childcaremap-capabackend.up.railway.app/print/tupla?i=1";

    try {
      // Realiza la petición HTTP al endpoint
      const response = await fetch(apiUrl);

      // Verifica que la respuesta sea correcta (código 2xx)
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      // Parsea el cuerpo de la respuesta como JSON
      const data = await response.json();

      // Registra en consola para depuración exitosa
      console.log("OK callAPIBackend - Datos recibidos:", data);

      // Devuelve el resultado al llamador
      return data;
    } catch (err) {
      // Informa cualquier error de red o de parseo
      console.error("Error callAPIBackend:", err.message);
    }
  }

  // ======================================================================
  // Capturar evento desde el botón y demás parámetros de entrada
  // ======================================================================
  const btnEjecutarUFD = document.getElementById("btn-ejecutar-ufd");

  if (btnEjecutarUFD) {
    btnEjecutarUFD.addEventListener("click", () => {
      const kmInput = document.getElementById("input-km");
      const km = Number(kmInput?.value || 10);

      const cantidadGrupo = document.getElementById("input-cantidad-grupo");
      const cantidadCluster = Number(cantidadGrupo?.value || 10);

      const gravedad = document.getElementById("select-gravedad");
      const gravedadAnemia = (gravedad?.value);


      modoCluster = true;   // <- ACTIVAS MODO CLUSTER

      console.log("🔵 Ejecutando UFD con radio:", km, "km");

      loadCluster(km, cantidadCluster, gravedadAnemia);
    });
  }


}

// ==================================================================================
// Función auxiliar: consulta el backend /api/pacientes
// ==================================================================================

async function callAPIBackend(endpoint = "/api/pacientes") {

  // URL base del backend (Railway o localhost)
  const BASE_URL = "https://childcaremap-capabackend.up.railway.app";

  // Construye la URL final
  const url = `${BASE_URL}${endpoint}`;

  try {
    console.log("📡 Llamando al backend:", url);

    // Petición HTTP al backend
    const response = await fetch(url);

    // Verifica si la respuesta es válida
    if (!response.ok) {
      throw new Error(`Respuesta HTTP no válida (status: ${response.status})`);
    }

    // Convierte la respuesta en JSON
    const data = await response.json();

    console.log("Datos recibidos del backend:", data);

    // Devuelve los datos para que otra función los use
    return data;

  } catch (error) {
    console.error("Error en callAPIBackend:", error.message);
    return null; // Devuelve null para evitar romper el flujo
  }
}

// ====================================================================
// Mostrar datos del backend como tabla
// ====================================================================

async function displayTableFromBackendPre() {
  const container = document.getElementById("sigma-container");

  if (!container) {
    console.error("No existe el contenedor #sigma-container");
    return;
  }

  container.innerHTML = `
    <div style="padding:12px; text-align:center; color:#666;">
      Cargando datos...
    </div>
  `;

  const data = await callAPIBackend("/api/pacientes");

  if (!data || !Array.isArray(data)) {
    container.innerHTML = `
      <p style="color:red;">Error: No se pudo obtener información del backend</p>
    `;
    return;
  }

  // Construye tabla
  let html = `
    <table style="width:100%; border-collapse:collapse; font-size:14px; color:#000;text-align:center;background:#fff;">
      <thead>
        <tr style="background:#eee;">
          <th style="padding:8px; border:1px solid #ccc;">ID</th>
          <th style="padding:8px; border:1px solid #ccc;">Paciente</th>
          <th style="padding:8px; border:1px solid #ccc;">Edad</th>
          <th style="padding:8px; border:1px solid #ccc;">Latitud</th>
          <th style="padding:8px; border:1px solid #ccc;">Longitud</th>
          <th style="padding:8px; border:1px solid #ccc;">Anemia</th>
          <th style="padding:8px; border:1px solid #ccc;">Fecha</th>
        </tr>
      </thead>
      <tbody>
  `;

  data.forEach((p) => {
    html += `
      <tr>
        <td style="padding:6px; border:1px solid #ccc;">${p.id}</td>
        <td style="padding:6px; border:1px solid #ccc;">${p.name}</td>
        <td style="padding:6px; border:1px solid #ccc;">${p.age}</td>
        <td style="padding:6px; border:1px solid #ccc;">${p.coords[0]}</td>
        <td style="padding:6px; border:1px solid #ccc;">${p.coords[1]}</td>
        <td style="padding:6px; border:1px solid #ccc;">${p.anemia_value}</td>
        <td style="padding:6px; border:1px solid #ccc;">${p.created_at}</td>
      </tr>
    `;
  });

  html += `
      </tbody>
    </table>
  `;

  container.innerHTML = html;
}

// ==================================================================================
// Función: determinar color según nivel de anemia (al final del archivo)
// ==================================================================================

function anemiaToColor(value) {
  if (value < 8) return "#ef4444";      // Rojo — Grave / riesgo vital
  if (value < 10) return "#f97316";     // Naranja — Moderada
  if (value < 12) return "#facc15";     // Amarillo — Leve
  return "#22c55e";                     // Verde — Normal
}

// ==================================================================================
// Función: determinar color según nivel de gravedad
// ==================================================================================

function anemiaToColorByGravity(value) {
  if (value == 'alta') return "#ef4444";      // Rojo — Grave / riesgo vital
  if (value == 'media') return "#f97316";     // Naranja — Moderada
  if (value == 'baja') return "#facc15";     // Amarillo — Leve
  return "#22c55e";                     // Verde — Normal
}

// ------------------------------------------------------------------------
// Función: Cargar grupos desde /api/union_find_clusters
// ------------------------------------------------------------------------

async function loadCluster(km, cantidadCluster, gravedad) {
  try {
    // Leer radio desde el input #radioKm (si existe)
    //let km = 10;
    //const inputKm = document.getElementById("radioKm");
    //if (inputKm) km = Number(inputKm.value);

    console.log("Solicitando clusters con radio (km):", km);

    // Llamada al backend
    const url = `https://childcaremap-capabackend.up.railway.app/api/union_find_clusters?R_km=${km}&gravedad=${gravedad}`;
    //const url = `http://127.0.0.1:8000/api/union_find_clusters?R_km=${km}&gravedad=${gravedad}`;

    const res = await fetch(url);
    const data = await res.json();



    console.log("Clusters recibidos:", data);

    if (!data.clusters) {
      alert("Error: backend no devolvió clusters");
      return;
    }


    // Limpiar mapa anterior previo a la carga nueva


    if (window._mapInstance) {
      window._mapInstance.remove();
      window._mapInstance = null;
    }

    // Crear contenedor del mapa si no existe

    let mapDiv = document.getElementById("map-container");
    if (!mapDiv) {
      mapDiv = document.createElement("div");
      mapDiv.id = "map-container";
      mapDiv.style.width = "100%";
      mapDiv.style.height = "900px";
      mapDiv.style.border = "2px solid #ccc";
      mapDiv.style.borderRadius = "12px";
      mapDiv.style.overflow = "hidden";

      const parent = document.getElementById("sigma-container");
      parent.innerHTML = "";
      parent.appendChild(mapDiv);
    }

    // Crear mapa centrado en Perú

    const map = L.map(mapDiv).setView([-9.19, -75.0152], 6);

    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      attribution: "© OpenStreetMap contributors"
    }).addTo(map);


    // Crear los clusteres 


    data.clusters.filter(c => c.members.length >= cantidadCluster).forEach((c) => {
      const lat = c.centroid.latitud;
      const lon = c.centroid.longitud;

      L.circleMarker([lat, lon], {
        radius: 12,
        color: anemiaToColorByGravity(gravedad),
        fillColor: anemiaToColorByGravity(gravedad),
        fillOpacity: 0.9,
        weight: 2,
      })
        .addTo(map)
        .bindPopup(`
          <b>Grupo:</b> ${c.cluster_id}<br>
          <b>Pacientes:</b> ${c.members.length}<br>
          <b>Latitud:</b> ${lat}<br>
          <b>Longitud:</b> ${lon}
        `);
    });

    await drawMSTLines(map, km, cantidadCluster, gravedad);


    window._mapInstance = map;
  } catch (err) {
    console.error("Error al cargar clusters:", err);
  }
}




// ------------------------------------------------------------------------
// Función nueva: Dibujar las líneas de conexión del MST 4.0
// ------------------------------------------------------------------------
async function drawMSTLines(map, km, cantidad_Grupo, gravedad) {
  try {
    const url = `https://childcaremap-capabackend.up.railway.app/api/mst_clusters?R_km=${km}&cantidad_Grupo=${cantidad_Grupo}&gravedad=${gravedad}`;
    //const url = `http://127.0.0.1:8000/api/mst_clusters?R_km=${km}&cantidad_Grupo=${cantidad_Grupo}&gravedad=${gravedad}`;
    const res = await fetch(url);
    const data = await res.json();



    if (!data.mst_edges) {
      console.error("Error: backend no devolvió mst_edges");
      return;
    }

    data.mst_edges.forEach(edge => {
      const A = edge.centroid_a;
      const B = edge.centroid_b;

      L.polyline([A, B], {
        color: "#e63946",
        weight: 3,
        opacity: 0.8,
      })
        .addTo(map)
        .bindTooltip(`${edge.distance_km} km`, { permanent: false });
    });

  } catch (err) {
    console.error("Error al dibujar MST:", err);
  }
}

// ------------------------------------------------------------------------
// Función nueva: Mostrar datos desde /api/pacientes
// ------------------------------------------------------------------------


async function displayTableFromBackend() {
  const container = document.getElementById("datos-container");

  if (!container) {
    console.error("No existe el contenedor #datos-container");
    return;
  }

  // Mensaje de carga
  container.innerHTML = `<div class="table-loading">Cargando datos...</div>`;

  const data = await callAPIBackend("/api/pacientes");

  if (!data || !Array.isArray(data)) {
    container.innerHTML = `<div class="table-error">Error: No se pudo obtener información del backend</div>`;
    return;
  }

  // Construcción de tabla
  let html = `
    <table class="data-table">
      <thead>
        <tr>
          <th>ID</th>
          <th>Paciente</th>
          <th>Edad</th>
          <th>Latitud</th>
          <th>Longitud</th>
          <th>Anemia</th>
          <th>Fecha</th>
        </tr>
      </thead>
      <tbody>
  `;

  data.forEach((p) => {
    html += `
      <tr>
        <td>${p.id}</td>
        <td>${p.name}</td>
        <td>${p.age}</td>
        <td>${p.coords[0]}</td>
        <td>${p.coords[1]}</td>
        <td>${p.anemia_value}</td>
        <td>${p.created_at}</td>
      </tr>
    `;
  });

  html += `
      </tbody>
    </table>
  `;

  container.innerHTML = html;
}


// ------------------------------------------------------------------------
// Función nueva: Mostrar resumen desde /api/pacientes
// ------------------------------------------------------------------------


async function displayResumenFromBackendPre() {
  const container = document.getElementById("resumen-container");
  if (!container) {
    console.error("No existe el contenedor #datos-container");
    return;
  }
  // Mensaje de carga
  container.innerHTML = `<div class="table-loading">Cargando datos...</div>`;
  const data = await callAPIBackend("/api/pacientes");

  if (!data || !Array.isArray(data)) {
    container.innerHTML = `<div class="table-error">Error: No se pudo obtener información del backend</div>`;
    return;
  }

  // Construcción de tabla
  let html = `
    <table class="data-table">
      <thead>
        <tr>
          <th>ID</th>
          <th>Paciente</th>
          <th>Edad</th>
          <th>Latitud</th>
          <th>Longitud</th>
          <th>Anemia</th>
          <th>Fecha</th>
        </tr>
      </thead>
      <tbody>
  `;

  data.forEach((p) => {
    html += `
      <tr>
        <td>${p.id}</td>
        <td>${p.name}</td>
        <td>${p.age}</td>
        <td>${p.coords[0]}</td>
        <td>${p.coords[1]}</td>
        <td>${p.anemia_value}</td>
        <td>${p.created_at}</td>
      </tr>
    `;
  });

  html += `
      </tbody>
    </table>
  `;

  container.innerHTML = html;
}

// ------------------------------------------------------------------------
// Función nueva: Mostrar resumen desde /api/pacientes
// ------------------------------------------------------------------------


async function displayResumenFromBackend() {
  const container = document.getElementById("resumen-container");
  if (!container) return;

  container.innerHTML = `<div class="resumen-loading">Cargando información...</div>`;

  const data = await callAPIBackend("/api/pacientes");
  if (!data || !Array.isArray(data)) {
    container.innerHTML = `<div class="resumen-error">No se pudo cargar la información.</div>`;
    return;
  }


  // Cálculos

  const total = data.length;
  const edades = data.map(p => p.age);
  const anemia = data.map(p => p.anemia_value);

  const promEdad = (edades.reduce((a, b) => a + b, 0) / total).toFixed(1);
  const promAnemia = (anemia.reduce((a, b) => a + b, 0) / total).toFixed(1);

  const riesgoCritico = anemia.filter(v => v < 8).length;
  const riesgoModerado = anemia.filter(v => v >= 8 && v < 10).length;
  const riesgoLeve = anemia.filter(v => v >= 10 && v < 12).length;
  const normal = anemia.filter(v => v >= 12).length;


  // HTML Mejorado

  container.innerHTML = `
    <div class="resumen-card">

      <h2 class="resumen-title">Resumen general de pacientes</h2>

      <div class="resumen-grid">

        <div class="resumen-item">
          <h3>${total}</h3>
          <p>Total de Pacientes</p>
        </div>

        <div class="resumen-item">
          <h3>${promEdad}</h3>
          <p>Edad Promedio</p>
        </div>

        <div class="resumen-item">
          <h3>${promAnemia} g/dL</h3>
          <p>Hemoglobina Promedio</p>
        </div>

      </div>

      <h3 class="resumen-subtitle">Estado de anemia</h3>

<ul class="resumen-list">
  <li>
    <span class="r-dot red"></span>
    <span class="r-label">Riesgo crítico &lt; 8 g/dL</span>
    <strong class="r-value">${riesgoCritico}</strong>
  </li>

  <li>
    <span class="r-dot orange"></span>
    <span class="r-label">Moderada 8 - 9.9 g/dL</span>
    <strong class="r-value">${riesgoModerado}</strong>
  </li>

  <li>
    <span class="r-dot yellow"></span>
    <span class="r-label">Leve 10 - 11.9 g/dL</span>
    <strong class="r-value">${riesgoLeve}</strong>
  </li>

  <li>
    <span class="r-dot green"></span>
    <span class="r-label">Normal ≥ 12 g/dL</span>
    <strong class="r-value">${normal}</strong>
  </li>
</ul>



      <div class="resumen-alert">
        ${riesgoCritico > 0
      ? `Se identificaron <strong>${riesgoCritico}</strong> pacientes en nivel crítico (riesgo vital).`
      : `No se detectaron pacientes en riesgo crítico.`}
      </div>

    </div>
  `;
}

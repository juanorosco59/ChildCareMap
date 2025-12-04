// Importa Graphology y Sigma
import Graph from "graphology";
import { parse } from "graphology-gexf/browser";
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
  const alertaSeccion = document.getElementById("alerta-seccion");
  const cardSeccion = document.getElementById("card-seccion");



  // Localizador de bloque de controles del mapa
  const mapControls =
    document.querySelector(".map-controls") ||
    document.querySelector(".graph-controls") ||
    document.getElementById("map-controls");

  // Mantener la instancia global de Sigma
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

      alertaSeccion.style.display = "block";
      cardSeccion.style.display = "block";

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
          await loadCluster(km, cantidadCluster, gravedad, nodoOrigen, nodoDestino);
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
      alertaSeccion.style.display = "none";
      cardSeccion.style.display = "none";

      resumenContainer.style.display = "block";


      //displayResumenFromBackend();
      loginUser();

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


  // ------------------------------------------------------------------------
  // Función login en el app
  // ------------------------------------------------------------------------

  function loginUser() {
    const container = document.getElementById("resumen-container");
    if (!container) return;

    // ==============================
    // Estilos desde JS
    // ==============================
    if (!document.getElementById("login-style-injected")) {
      const style = document.createElement("style");
      style.id = "login-style-injected";
      style.textContent = `

      .login-card {
        width: 100%;
        max-width: 950px;
        margin: 0 auto;
        background: white;
        border-radius: 12px;
        padding: 40px 32px;
        box-shadow: 0 2px 8px rgba(0,0,0,0.08);
      }

      .login-header {
        text-align: center;
        margin-bottom: 28px;
      }

      .logo-icon {
        width: 64px;
        height: 64px;
        background: #0d9488;
        border-radius: 16px;
        display: flex;
        align-items: center;
        justify-content: center;
        margin: 0 auto 16px;
        color: white;
        box-shadow: 0 4px 12px rgba(13,148,136,0.25);
      }

      .login-form {
        display: flex;
        flex-direction: column;
        gap: 24px;
      }

      .form-group {
        display: flex;
        flex-direction: column;
        gap: 6px;
      }

      .form-group label {
        font-size: 14px;
        color: #1a1a1a;
      }

      .input-wrapper {
        position: relative;
      }

      .input-icon {
        position: absolute;
        left: 12px;
        top: 50%;
        transform: translateY(-50%);
        color: #9ca3af;
      }

      .input-wrapper input {
        width: 100%;
        padding: 12px 14px 12px 42px;
        border-radius: 6px;
        border: 1px solid #e5e7eb;
        background: #f9fafb;
        font-size: 14px;
        transition: 0.2s;
      }

      .input-wrapper input:focus {
        background: white;
        border-color: #0d9488;
        box-shadow: 0 0 0 3px rgba(13,148,136,0.2);
        outline: none;
      }

      .login-button {
        width: 100%;
        padding: 14px;
        background: #0d9488;
        border: none;
        border-radius: 6px;
        font-size: 15px;
        font-weight: 500;
        color: white;
        cursor: pointer;
        transition: 0.2s;
      }

      .login-button:hover {
        background: #0f766e;
        box-shadow: 0 4px 12px rgba(13,148,136,0.25);
      }

      .login-button:active {
        transform: scale(0.98);
      }

      .login-msg {
        margin-top: 10px;
        text-align: center;
        font-size: 14px;
      }

    `;
      document.head.appendChild(style);
    }

    // ==============================
    // Insertar HTML del formulario
    // ==============================
    container.innerHTML = `
    <div class="login-card">

      <div class="login-header">
        <div class="logo-icon">
          <svg width="32" height="32" viewBox="0 0 24 24" fill="white">
            <path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 
            2 5.42 4.42 3 7.5 3c1.74 0 3.41 1.01 
            4.5 2.09C13.09 4.01 14.76 3 16.5 3 
            19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 
            11.54L12 21.35z"/>
          </svg>
        </div>
        <h2 style="font-size:26px;font-weight:500;color:#1a1a1a;">ChildCareMap</h2>
        <p style="color:#6b7280;font-size:14px;">Acceso al panel de control</p>
      </div>

      <form class="login-form">

        <div class="form-group">
          <label>Correo</label>
          <div class="input-wrapper">
            <svg class="input-icon" width="18" height="18" viewBox="0 0 24 24">
              <rect x="2" y="4" width="20" height="16" rx="2" />
              <path d="m22 7-10 7L2 7" />
            </svg>
            <input id="email" type="email" placeholder="correo@ejemplo.com">
          </div>
        </div>

        <div class="form-group">
          <label>Contraseña</label>
          <div class="input-wrapper">
            <svg class="input-icon" width="18" height="18" viewBox="0 0 24 24">
              <rect x="3" y="11" width="18" height="11" rx="2"/>
              <path d="M7 11V7a5 5 0 0 1 10 0v4" />
            </svg>
            <input id="password" type="password" placeholder="••••••••">
          </div>
        </div>

        <button id="btn-login" type="button" class="login-button">
          Ingresar
        </button>

        <div id="login-msg" class="login-msg"></div>

      </form>

    </div>
  `;

    // ==============================
    // Lógica del botón LOGIN
    // ==============================
    const btn = document.getElementById("btn-login");
    const msg = document.getElementById("login-msg");

    btn.addEventListener("click", () => {
      const email = document.getElementById("email").value.trim();
      const password = document.getElementById("password").value.trim();

      if (!email || !password) {
        msg.textContent = "Complete ambos campos.";
        msg.style.color = "#d00";
        return;
      }

      msg.textContent = "Acceso concedido. Cargando mapa...";
      msg.style.color = "#0a8f55";

      localStorage.setItem("logged", "yes");
      localStorage.setItem("email", email);

      setTimeout(() => {
        activateTab("mapa");
      }, 500);
    });
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
  const btnEjecutarBF = document.getElementById("btn-ejecutar-bf");

  if (btnEjecutarUFD) {
    btnEjecutarUFD.addEventListener("click", () => {
      const kmInput = document.getElementById("input-km");
      const km = Number(kmInput?.value || 10);

      const cantidadGrupo = document.getElementById("input-cantidad-grupo");
      const cantidadCluster = Number(cantidadGrupo?.value || 10);

      const gravedad = document.getElementById("select-gravedad");
      const gravedadAnemia = (gravedad?.value);

      const origen = document.getElementById("input-nodo-origen");
      const nodoOrigen = Number(origen?.value || 5);


      //const destino = document.getElementById("input-nodo-destino");
      //const nodoDestino = Number(destino?.value);

      const destinoInput = document.getElementById("input-nodo-destino");
      const nodoDestino = destinoInput && destinoInput.value !== ""
        ? Number(destinoInput.value)
        : null;


      modoCluster = true;

      console.log("🔵 Ejecutando UFD con radio:", km, "km");

      loadCluster(km, cantidadCluster, gravedadAnemia, nodoOrigen, nodoDestino);
    });
  }

  if (btnEjecutarBF) {
    btnEjecutarBF.addEventListener("click", () => {

      const kmInput = document.getElementById("input-km");
      const km = Number(kmInput?.value || 10);

      const cantidadGrupo = document.getElementById("input-cantidad-grupo");
      const cantidadCluster = Number(cantidadGrupo?.value || 10);

      const gravedad = document.getElementById("select-gravedad");
      const gravedadAnemia = (gravedad?.value);

      const origen = document.getElementById("input-nodo-origen");
      const nodoOrigen = Number(origen?.value || 5);


      //const destino = document.getElementById("input-nodo-destino");
      //const nodoDestino = Number(destino?.value);

      const destinoInput = document.getElementById("input-nodo-destino");
      const nodoDestino = destinoInput && destinoInput.value !== ""
        ? Number(destinoInput.value)
        : null;


      modoCluster = true;

      console.log("🔵 Ejecutando UFD con radio:", km, "km");

      loadCluster(km, cantidadCluster, gravedadAnemia, nodoOrigen, nodoDestino);
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
// Función auxiliar: Mostrar datos del backend como tabla
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

async function loadCluster(km, cantidadCluster, gravedad, nodoOrigen, nodoDestino) {
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

    await drawMSTLines(map, km, cantidadCluster, gravedad, nodoOrigen, nodoDestino);


    window._mapInstance = map;
  } catch (err) {
    console.error("Error al cargar clusters:", err);
  }
}




// ------------------------------------------------------------------------
// Función: Dibujar las líneas de conexión del MST (Versión 1.0)
// ------------------------------------------------------------------------
async function drawMSTLinesPre(map, km, cantidad_Grupo, gravedad) {
  try {
    //const url = `https://childcaremap-capabackend.up.railway.app/api/mst_clusters?R_km=${km}&cantidad_Grupo=${cantidad_Grupo}&gravedad=${gravedad}`;
    //const url = `http://127.0.0.1:8000/api/mst_clusters?R_km=${km}&cantidad_Grupo=${cantidad_Grupo}&gravedad=${gravedad}`;
    //const url = `http://127.0.0.1:8000/api/mst_clusters_plusPro?R_km=${km}&cantidad_Grupo=${cantidad_Grupo}&gravedad=${gravedad}&K=3`;
    const url = `https://childcaremap-capabackend.up.railway.app/api/mst_clusters_plusPro?R_km=${km}&cantidad_Grupo=${cantidad_Grupo}&gravedad=${gravedad}&K=3`;


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


    if (data.extra_edges) {
      data.extra_edges.forEach(edge => {
        const A = edge.centroid_a;
        const B = edge.centroid_b;

        L.polyline([A, B], {
          color: "#457b9d", // azul
          weight: 2,
          opacity: 0.7,
          dashArray: "4, 4"
        })
          .addTo(map)
          .bindTooltip(`Extra: ${edge.distance_km} km`);
      });
    }

  } catch (err) {
    console.error("Error al dibujar MST:", err);
  }
}


// ---------------------------------------------------------------------------
// Función: Dibujar las líneas de conexión del MST (Versión 2.0)
// ---------------------------------------------------------------------------
async function drawMSTLinesPre2(map, km, cantidad_Grupo, gravedad, nodoOrigen, nodoDestino) {

  try {
    // const url = `http://127.0.0.1:8000/api/mst_clusters_plus_V3?R_km=${km}&cantidad_Grupo=${cantidad_Grupo}&gravedad=${gravedad}&K=3`;
    const url = `https://childcaremap-capabackend.up.railway.app/api/mst_clusters_plus_V4?R_km=${km}&cantidad_Grupo=${cantidad_Grupo}&gravedad=${gravedad}&K=3`;

    const res = await fetch(url);
    const data = await res.json();

    console.log("RAW DATA:", data);

    // -------------------------------
    // Dibujar grafo con MST
    // -------------------------------
    if (Array.isArray(data.mst_edges)) {
      data.mst_edges.forEach(edge => {
        const A = edge.centroid_a;
        const B = edge.centroid_b;

        L.polyline([
          [parseFloat(A[0]), parseFloat(A[1])],
          [parseFloat(B[0]), parseFloat(B[1])]
        ], {
          color: "#e63946",
          weight: 3,
          opacity: 0.9
        }).addTo(map);
      });
    }

    // ---------------------------------------------
    // Dibujar lineas de conexión adicionales al MST
    // ---------------------------------------------
    if (Array.isArray(data.extra_edges)) {
      data.extra_edges.forEach(edge => {
        const A = edge.centroid_a;
        const B = edge.centroid_b;

        L.polyline([
          [parseFloat(A[0]), parseFloat(A[1])],
          [parseFloat(B[0]), parseFloat(B[1])]
        ], {
          color: "#457b9d",
          weight: 2,
          opacity: 0.8,
          dashArray: "6, 6"
        }).addTo(map);
      });
    }


    // ---------------------------------------------
    // Dibujar resultado de Bellmann-Ford
    // ---------------------------------------------
    let urlPath = "";
    const origen = nodoOrigen;
    const destino = nodoDestino;

    if (destino === null) {
      // urlPath = `http://127.0.0.1:8000/api/bellman_paths_V1?R_km=${km}&cantidad_Grupo=${cantidad_Grupo}&gravedad=${gravedad}&K=3&origen=${origen}`;
      urlPath = `https://childcaremap-capabackend.up.railway.app/api/bellman_paths_V3?R_km=${km}&cantidad_Grupo=${cantidad_Grupo}&gravedad=${gravedad}&K=3&origen=${origen}`;

    }
    else {
      //urlPath = `http://127.0.0.1:8000/api/bellman_paths_V1?R_km=${km}&cantidad_Grupo=${cantidad_Grupo}&gravedad=${gravedad}&K=3&origen=${origen}&destino=${destino}`;
      urlPath = `https://childcaremap-capabackend.up.railway.app/api/bellman_paths_V3?R_km=${km}&cantidad_Grupo=${cantidad_Grupo}&gravedad=${gravedad}&K=3&origen=${origen}&destino=${destino}`;

    }



    const resPath = await fetch(urlPath);
    const pathData = await resPath.json();




    console.log("BELL-FORD ROUTE:", pathData);


    if (pathData.error) {
      alert("No existe ruta entre origen y destino.");
      return;
    }

    // Limpiar rutas viejas
    if (window.routeLayer) window.routeLayer.clearLayers();
    else window.routeLayer = L.layerGroup().addTo(map);

    // ---------------------------------------------------------------------
    // Escenario 1: origen_destino
    // ---------------------------------------------------------------------
    if (pathData.modo === "origen_destino") {

      pathData.aristas.forEach(edge => {
        const A = edge.centroid_a;
        const B = edge.centroid_b;

        L.polyline([[A[0], A[1]], [B[0], B[1]]], {
          color: "#2ecc71",
          weight: 5,
          opacity: 1
        }).addTo(window.routeLayer);
      });

      pathData.ruta.forEach((nodeId, i) => {
        const edge = pathData.aristas.find(e =>
          e.cluster_a === nodeId || e.cluster_b === nodeId
        );
        if (!edge) return;

        const point =
          edge.cluster_a === nodeId ? edge.centroid_a : edge.centroid_b;

        L.circleMarker([point[0], point[1]], {
          radius: 8,
          color: "#2ecc71",
          fillColor: "#27ae60",
          fillOpacity: 11
        })
          .bindTooltip(`Paso ${i}<br>Nodo ${nodeId}`)
          .addTo(window.routeLayer);
      });
    }

    // ---------------------------------------------------------------------
    // Escenario 2: top_rutas 
    // ---------------------------------------------------------------------
    if (pathData.modo === "top_rutas") {

      const routeColors = [
        "#e63946",
        "#457b9d",
        "#2a9d8f",
        "#f4a261",
        "#8d5a97",
        "#1d3557"
      ];

      pathData.mejores_rutas.forEach((rutaObj, idx) => {

        const color = routeColors[idx % routeColors.length];

        // -------------------------------
        // Dibujar aristas de esta ruta
        // -------------------------------
        rutaObj.aristas.forEach(edge => {
          const A = edge.centroid_a;
          const B = edge.centroid_b;

          L.polyline(
            [
              [A[0], A[1]],
              [B[0], B[1]]
            ],
            {
              color: color,
              weight: 25,
              opacity: 0.75
            }
          ).addTo(window.routeLayer);




        });

        // -------------------------------
        // Dibujar nodos de esta ruta
        // -------------------------------
        rutaObj.ruta.forEach((nodeId, step) => {
          const edge = rutaObj.aristas.find(
            e => e.cluster_a === nodeId || e.cluster_b === nodeId
          );
          if (!edge) return;

          const point =
            edge.cluster_a === nodeId ? edge.centroid_a : edge.centroid_b;

          L.circleMarker([point[0], point[1]], {
            radius: 7,
            color: color,
            fillColor: color,
            fillOpacity: 0.9

          })
            .bindTooltip(
              `Ruta ${idx + 1}<br>Paso ${step}<br>Nodo ${nodeId}`
            )
            .addTo(window.routeLayer);
        });
      });
    }



  } catch (err) {
    console.error("Error al dibujar MST:", err);
  }
}


// ---------------------------------------------------------------------------
// Función: Dibujar las líneas de conexión del MST (Versión 3.0)
// ---------------------------------------------------------------------------
async function drawMSTLinesPre3(map, km, cantidad_Grupo, gravedad, nodoOrigen, nodoDestino) {

  try {
    // =========================================================
    // 1. Crear capas globales si no existen
    // =========================================================
    if (!window.graphLayer) window.graphLayer = L.layerGroup().addTo(map);   // MST + extra_edges
    if (!window.routeLayer) window.routeLayer = L.layerGroup().addTo(map);   // Rutas Bellman

    // Crear capas nuevas siembre antes de dibujar
    window.graphLayer = L.layerGroup().addTo(map);
    window.routeLayer = L.layerGroup().addTo(map);

    // =========================================================
    // 2. Solicitar MST + conexiones extra
    // =========================================================
    // const url = `http://127.0.0.1:8000/api/mst_clusters_plus_V3?R_km=${km}&cantidad_Grupo=${cantidad_Grupo}&gravedad=${gravedad}&K=3`;
    const url = `https://childcaremap-capabackend.up.railway.app/api/mst_clusters_plus_V4?R_km=${km}&cantidad_Grupo=${cantidad_Grupo}&gravedad=${gravedad}&K=3`;


    const res = await fetch(url);
    const data = await res.json();

    console.log("MST DATA:", data);


    // =========================================================
    // 3. Dibujar MST (rojo)
    // =========================================================
    if (Array.isArray(data.mst_edges)) {
      data.mst_edges.forEach(edge => {
        const A = edge.centroid_a;
        const B = edge.centroid_b;

        L.polyline([
          [A[0], A[1]],
          [B[0], B[1]]
        ], {
          color: "#e63946",
          weight: 3,
          opacity: 0.9
        }).addTo(window.graphLayer);
      });
    }


    // =========================================================
    // 4. Dibujar extra_edges (azul)
    // =========================================================
    if (Array.isArray(data.extra_edges)) {
      data.extra_edges.forEach(edge => {
        const A = edge.centroid_a;
        const B = edge.centroid_b;

        L.polyline([
          [A[0], A[1]],
          [B[0], B[1]]
        ], {
          color: "#457b9d",
          weight: 2,
          opacity: 0.8,
          dashArray: "6, 6"
        }).addTo(window.graphLayer);
      });
    }


    // =========================================================
    // 5. Construir URL de Bellman-Ford
    // =========================================================
    let urlPath;

    const destinoInvalido =
      nodoDestino === null ||
      nodoDestino === "" ||
      nodoDestino === 0 ||
      isNaN(nodoDestino);

    if (nodoDestino === null || nodoDestino === "" || isNaN(nodoDestino)) {
      // Sin destino → top_rutas
      //   urlPath =
      //  `http://127.0.0.1:8000/api/bellman_paths_V1?R_km=${km}&cantidad_Grupo=${cantidad_Grupo}` +
      //  `&gravedad=${gravedad}&K=3&origen=${nodoOrigen}`;

      urlPath =
        `https://childcaremap-capabackend.up.railway.app/api/bellman_paths_V3?R_km=${km}&cantidad_Grupo=${cantidad_Grupo}` +
        `&gravedad=${gravedad}&K=3&origen=${nodoOrigen}`;




    } else {
      // Con destino → ruta origen-destino
      //urlPath =
      //  `http://127.0.0.1:8000/api/bellman_paths_V1?R_km=${km}&cantidad_Grupo=${cantidad_Grupo}` +
      //  `&gravedad=${gravedad}&K=3&origen=${nodoOrigen}&destino=${nodoDestino}`;

      urlPath =
        `https://childcaremap-capabackend.up.railway.app/api/bellman_paths_V3?R_km=${km}&cantidad_Grupo=${cantidad_Grupo}` +
        `&gravedad=${gravedad}&K=3&origen=${nodoOrigen}&destino=${nodoDestino}`;

    }

    console.log("URL Bellman:", urlPath);


    // =========================================================
    // 6. Ejecutar Bellman-Ford
    // =========================================================
    const resPath = await fetch(urlPath);
    const pathData = await resPath.json();

    console.log("Bellman-Ford:", pathData);

    displayBellmanResult(km, cantidad_Grupo, gravedad, nodoOrigen, nodoDestino);

    if (pathData.error) {
      alert("No existe ruta entre origen y destino");
      return;
    }

    // =========================================================
    // 7. Escenario A — modo origen_destino
    // =========================================================
    if (pathData.modo === "origen_destino") {

      // Dibujar aristas de la ruta (verde)
      pathData.aristas.forEach(edge => {
        const A = edge.centroid_a;
        const B = edge.centroid_b;

        // Crear polyline y GUARDARLA en una variable
        const poly = L.polyline(
          [[A[0], A[1]], [B[0], B[1]]],
          {
            color: "#2ecc71",
            weight: 6,
            opacity: 1.0
          }
        ).addTo(window.routeLayer);

        // ------------------------------
        // Tooltip con todos los detalles
        // ------------------------------
        poly.bindTooltip(`
          <b>Detalle de ruta</b><br>
          <b>Tipo:</b> ${edge.type}<br>
          <b>Distancia:</b> ${edge.distance_km.toFixed(2)} km<br>
          <b>Peso sanitario:</b> ${edge.peso_sanitario.toFixed(2)}<br>
          <b>Accesibilidad:</b> ${edge.sanitario.accesibilidad}<br>
          <b>Riesgo:</b> ${edge.sanitario.riesgo}<br>
          <b>Bonificación SERUMS:</b> ${edge.sanitario.bonificacion_serums}<br>
          <b>Puntaje SERUMS:</b> ${edge.sanitario.puntaje_serums}
        `);

      });

      // Dibujar nodos
      pathData.ruta.forEach((nodeId, stepIndex) => {

        const edge = pathData.aristas.find(e =>
          e.cluster_a === nodeId || e.cluster_b === nodeId
        );

        if (!edge) return;

        const point =
          edge.cluster_a === nodeId ? edge.centroid_a : edge.centroid_b;

        L.circleMarker([point[0], point[1]], {
          radius: 9,
          color: "#2ecc71",
          fillColor: "#27ae60",
          fillOpacity: 1
        })
          .bindTooltip(`Paso ${stepIndex}<br>Nodo ${nodeId}`)
          .addTo(window.routeLayer);
      });

      return; // FIN escenario A
    }


    // =========================================================
    // 8. Escenario B — modo top_rutas
    // =========================================================

    const routeColors = [
      "#e63946",
      "#457b9d",
      "#2a9d8f",
      "#f4a261",
      "#8d5a97",
      "#1d3557"
    ];

    pathData.mejores_rutas.forEach((rutaObj, idx) => {
      const color = routeColors[idx % routeColors.length];

      // Aristas de cada ruta
      rutaObj.aristas.forEach(edge => {
        const A = edge.centroid_a;
        const B = edge.centroid_b;





        const poly = L.polyline([
          [A[0], A[1]],
          [B[0], B[1]]
        ], {
          color: color, // verde para origen-destino o el color dinámico
          weight: 6,
          opacity: 1
        }).addTo(window.routeLayer);

        poly.bindTooltip(`
        <b>Detalle de ruta</b><br>
        <b>Tipo:</b> ${edge.type}<br>
        <b>Peso sanitario:</b> ${edge.peso_sanitario.toFixed(2)}<br>
        <b>Distancia (+):</b> ${edge.distance_km.toFixed(2)} km<br>
        <b>Accesibilidad (+):</b> ${edge.sanitario.accesibilidad}<br>
        <b>Riesgo (+):</b> ${edge.sanitario.riesgo}<br>
        <b>Bonificación (-):</b> ${edge.sanitario.bonificacion_serums}<br>
        <b>Puntaje SERUMS (-):</b> ${edge.sanitario.puntaje_serums}
      `);



      });

      // Nodos de cada ruta
      rutaObj.ruta.forEach((nodeId, stepIndex) => {
        const edge = rutaObj.aristas.find(e =>
          e.cluster_a === nodeId || e.cluster_b === nodeId
        );
        if (!edge) return;

        const point =
          edge.cluster_a === nodeId ? edge.centroid_a : edge.centroid_b;

        L.circleMarker([point[0], point[1]], {
          radius: 8,
          color: color,
          fillColor: color,
          fillOpacity: 1
        })
          .bindTooltip(`Ruta ${idx + 1}<br>Paso ${stepIndex}<br>Nodo ${nodeId}`)
          .addTo(window.routeLayer);
      });
    });


  } catch (err) {
    console.error("Error en drawMSTLines:", err);
  }
}


// ---------------------------------------------------------------------------
// Función: Dibujar las líneas de conexión del MST (Versión 4.0)
// ---------------------------------------------------------------------------
async function drawMSTLines(map, km, cantidad_Grupo, gravedad, nodoOrigen, nodoDestino) {

  try {
    // =========================================================
    // 1. Crear capas globales si no existen
    // =========================================================
    if (!window.graphLayer) window.graphLayer = L.layerGroup().addTo(map);   // MST + extra_edges
    if (!window.routeLayer) window.routeLayer = L.layerGroup().addTo(map);   // Rutas Bellman

    // Crear capas nuevas siembre antes de dibujar
    window.graphLayer = L.layerGroup().addTo(map);
    window.routeLayer = L.layerGroup().addTo(map);

    // =========================================================
    // 2. Solicitar MST + conexiones extra
    // =========================================================
    // const url = `http://127.0.0.1:8000/api/mst_clusters_plus_V3?R_km=${km}&cantidad_Grupo=${cantidad_Grupo}&gravedad=${gravedad}&K=3`;
    const url = `https://childcaremap-capabackend.up.railway.app/api/mst_clusters_plus_V4?R_km=${km}&cantidad_Grupo=${cantidad_Grupo}&gravedad=${gravedad}&K=3`;


    const res = await fetch(url);
    const data = await res.json();

    console.log("MST DATA:", data);


    // =========================================================
    // 3. Dibujar MST (rojo)
    // =========================================================
    if (Array.isArray(data.mst_edges)) {
      data.mst_edges.forEach(edge => {
        const A = edge.centroid_a;
        const B = edge.centroid_b;

        L.polyline([
          [A[0], A[1]],
          [B[0], B[1]]
        ], {
          color: "#e63946",
          weight: 3,
          opacity: 0.9
        }).addTo(window.graphLayer);
      });
    }


    // =========================================================
    // 4. Dibujar extra_edges (azul)
    // =========================================================
    if (Array.isArray(data.extra_edges)) {
      data.extra_edges.forEach(edge => {
        const A = edge.centroid_a;
        const B = edge.centroid_b;

        L.polyline([
          [A[0], A[1]],
          [B[0], B[1]]
        ], {
          color: "#457b9d",
          weight: 2,
          opacity: 0.8,
          dashArray: "6, 6"
        }).addTo(window.graphLayer);
      });
    }


    // =========================================================
    // 5. Construir URL de Bellman-Ford
    // =========================================================
    let urlPath;

    const destinoInvalido =
      nodoDestino === null ||
      nodoDestino === "" ||
      nodoDestino === 0 ||
      isNaN(nodoDestino);

    if (nodoDestino === null || nodoDestino === "" || isNaN(nodoDestino)) {
      // Sin destino → top_rutas
      //   urlPath =
      //  `http://127.0.0.1:8000/api/bellman_paths_V1?R_km=${km}&cantidad_Grupo=${cantidad_Grupo}` +
      //  `&gravedad=${gravedad}&K=3&origen=${nodoOrigen}`;

      urlPath =
        `https://childcaremap-capabackend.up.railway.app/api/bellman_paths_V3?R_km=${km}&cantidad_Grupo=${cantidad_Grupo}` +
        `&gravedad=${gravedad}&K=3&origen=${nodoOrigen}`;




    } else {
      // Con destino → ruta origen-destino
      //urlPath =
      //  `http://127.0.0.1:8000/api/bellman_paths_V1?R_km=${km}&cantidad_Grupo=${cantidad_Grupo}` +
      //  `&gravedad=${gravedad}&K=3&origen=${nodoOrigen}&destino=${nodoDestino}`;

      urlPath =
        `https://childcaremap-capabackend.up.railway.app/api/bellman_paths_V3?R_km=${km}&cantidad_Grupo=${cantidad_Grupo}` +
        `&gravedad=${gravedad}&K=3&origen=${nodoOrigen}&destino=${nodoDestino}`;

    }

    console.log("URL Bellman:", urlPath);


    // =========================================================
    // 6. Ejecutar Bellman-Ford
    // =========================================================
    const resPath = await fetch(urlPath);
    const pathData = await resPath.json();

    console.log("Bellman-Ford:", pathData);

    displayBellmanResult(km, cantidad_Grupo, gravedad, nodoOrigen, nodoDestino);

    if (pathData.modo === "ciclo_negativo") {

      drawNegativeCycle(pathData);    // <--- función nueva para dibujar
      showNegativeCycleTable(pathData); // <--- función nueva para tabla

      alert("Se detectó un ciclo negativo. No es posible calcular rutas Bellman-Ford.");

      return;
    }



    if (pathData.error) {
      alert("No existe ruta entre origen y destino");
      return;
    }

    // =========================================================
    // 7. Escenario A — modo origen_destino
    // =========================================================
    if (pathData.modo === "origen_destino") {

      // Dibujar aristas de la ruta (verde)
      pathData.aristas.forEach(edge => {
        const A = edge.centroid_a;
        const B = edge.centroid_b;

        // Crear polyline y GUARDARLA en una variable
        const poly = L.polyline(
          [[A[0], A[1]], [B[0], B[1]]],
          {
            color: "#2ecc71",
            weight: 6,
            opacity: 1.0
          }
        ).addTo(window.routeLayer);

        // ------------------------------
        // Tooltip con todos los detalles
        // ------------------------------
        poly.bindTooltip(`
          <b>Detalle de ruta</b><br>
          <b>Tipo:</b> ${edge.type}<br>
          <b>Distancia:</b> ${edge.distance_km.toFixed(2)} km<br>
          <b>Peso sanitario:</b> ${edge.peso_sanitario.toFixed(2)}<br>
          <b>Accesibilidad:</b> ${edge.sanitario.accesibilidad}<br>
          <b>Riesgo:</b> ${edge.sanitario.riesgo}<br>
          <b>Bonificación SERUMS:</b> ${edge.sanitario.bonificacion_serums}<br>
          <b>Puntaje SERUMS:</b> ${edge.sanitario.puntaje_serums}
        `);

      });

      // Dibujar nodos
      pathData.ruta.forEach((nodeId, stepIndex) => {

        const edge = pathData.aristas.find(e =>
          e.cluster_a === nodeId || e.cluster_b === nodeId
        );

        if (!edge) return;

        const point =
          edge.cluster_a === nodeId ? edge.centroid_a : edge.centroid_b;

        L.circleMarker([point[0], point[1]], {
          radius: 9,
          color: "#2ecc71",
          fillColor: "#27ae60",
          fillOpacity: 1
        })
          .bindTooltip(`Paso ${stepIndex}<br>Nodo ${nodeId}`)
          .addTo(window.routeLayer);
      });

      return; // FIN escenario A
    }


    // =========================================================
    // 8. Escenario B — modo top_rutas
    // =========================================================

    const routeColors = [
      "#e63946",
      "#457b9d",
      "#2a9d8f",
      "#f4a261",
      "#8d5a97",
      "#1d3557"
    ];

    pathData.mejores_rutas.forEach((rutaObj, idx) => {
      const color = routeColors[idx % routeColors.length];

      // Aristas de cada ruta
      rutaObj.aristas.forEach(edge => {
        const A = edge.centroid_a;
        const B = edge.centroid_b;





        const poly = L.polyline([
          [A[0], A[1]],
          [B[0], B[1]]
        ], {
          color: color, // verde para origen-destino o el color dinámico
          weight: 6,
          opacity: 1
        }).addTo(window.routeLayer);

        poly.bindTooltip(`
        <b>Detalle de ruta</b><br>
        <b>Tipo:</b> ${edge.type}<br>
        <b>Peso sanitario:</b> ${edge.peso_sanitario.toFixed(2)}<br>
        <b>Distancia (+):</b> ${edge.distance_km.toFixed(2)} km<br>
        <b>Accesibilidad (+):</b> ${edge.sanitario.accesibilidad}<br>
        <b>Riesgo (+):</b> ${edge.sanitario.riesgo}<br>
        <b>Bonificación (-):</b> ${edge.sanitario.bonificacion_serums}<br>
        <b>Puntaje SERUMS (-):</b> ${edge.sanitario.puntaje_serums}
      `);



      });

      // Nodos de cada ruta
      rutaObj.ruta.forEach((nodeId, stepIndex) => {
        const edge = rutaObj.aristas.find(e =>
          e.cluster_a === nodeId || e.cluster_b === nodeId
        );
        if (!edge) return;

        const point =
          edge.cluster_a === nodeId ? edge.centroid_a : edge.centroid_b;

        L.circleMarker([point[0], point[1]], {
          radius: 8,
          color: color,
          fillColor: color,
          fillOpacity: 1
        })
          .bindTooltip(`Ruta ${idx + 1}<br>Paso ${stepIndex}<br>Nodo ${nodeId}`)
          .addTo(window.routeLayer);
      });
    });


  } catch (err) {
    console.error("Error en drawMSTLines:", err);
  }
}




// ------------------------------------------------------------------------
// Función auxiliar: Mostrar datos desde /api/pacientes
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
// Función auxiliar: Mostrar resumen desde /api/pacientes
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
// Función auxiliar: Mostrar resumen desde /api/pacientes
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



// ------------------------------------------------------------------------
// Función auxiliar: Dibujar aristas EXTRA
// ------------------------------------------------------------------------

function drawExtraEdges(map, extraEdges) {
  extraEdges.forEach(edge => {
    const A = edge.centroid_a;
    const B = edge.centroid_b;

    L.polyline([A, B], {
      color: "#457b9d",   // otro color para diferenciar
      weight: 2,
      dashArray: "6, 6", // líneas punteadas
      opacity: 0.7,
    })
      .addTo(map)
      .bindTooltip(`Extra: ${edge.distance_km} km`);
  });
}

// ------------------------------------------------------------------------
// Función auxiliar: Mostrar resultados de Bellman-Ford en tabla
// ------------------------------------------------------------------------
async function displayBellmanResult(km, cantidad_Grupo, gravedad, nodoOrigen, nodoDestino) {

  const container = document.getElementById("pacient-info-container");

  if (!container) {
    console.error("No existe el contenedor #pacient-info-container");
    return;
  }

  container.innerHTML = `<div class="table-loading">Cargando resultados...</div>`;

  // Construir URL igual que en drawMSTLines()
  let urlPath;

  const destinoInvalido =
    nodoDestino === null ||
    nodoDestino === "" ||
    nodoDestino === 0 ||
    isNaN(nodoDestino);

  if (destinoInvalido) {
    urlPath =
      `https://childcaremap-capabackend.up.railway.app/api/bellman_paths_V3?` +
      `R_km=${km}&cantidad_Grupo=${cantidad_Grupo}&gravedad=${gravedad}&K=3&origen=${nodoOrigen}`;
  } else {
    urlPath =
      `https://childcaremap-capabackend.up.railway.app/api/bellman_paths_V3?` +
      `R_km=${km}&cantidad_Grupo=${cantidad_Grupo}&gravedad=${gravedad}&K=3&origen=${nodoOrigen}&destino=${nodoDestino}`;
  }

  console.log("📡 Cargando datos Bellman-Ford:", urlPath);

  const response = await fetch(urlPath);
  const result = await response.json();

  if (result.error) {
    container.innerHTML = `
      <div class="table-error">No existe ruta entre origen y destino.</div>
    `;
    return;
  }

  // ============================================================
  // MODO X: Ciclo negativo
  // ============================================================
  if (result.modo === "ciclo_negativo") {

    let html = `
    <h3 style="color:#ff00ff;">⚠️ Ciclo negativo detectado</h3>
    <p>Bellman-Ford no puede calcular rutas porque existe un ciclo cuyo peso total es negativo.</p>

    <h4>Nodos del ciclo</h4>
    <p>${result.cycle_nodes.join(" → ")}</p>

    <h4>Aristas del ciclo</h4>

    <table class="data-table">
      <thead>
        <tr>
          <th>Nodo A</th>
          <th>Nodo B</th>
          <th>Peso sanitario</th>
          <th>Distancia (km)</th>
          <th>Accesibilidad</th>
          <th>Riesgo</th>
          <th>Bonif. SERUMS</th>
          <th>Puntaje SERUMS</th>
        </tr>
      </thead>
      <tbody>
  `;

    result.cycle_edges.forEach(edge => {
      html += `
      <tr>
        <td>${edge.cluster_a}</td>
        <td>${edge.cluster_b}</td>
        <td>${edge.peso_sanitario}</td>
        <td>${edge.distance_km}</td>
        <td>${edge.sanitario.accesibilidad}</td>
        <td>${edge.sanitario.riesgo}</td>
        <td>${edge.sanitario.bonificacion_serums}</td>
        <td>${edge.sanitario.puntaje_serums}</td>
      </tr>
    `;
    });

    html += `
      </tbody>
    </table>

    <p style="color:#ff00ff; font-weight:bold;">
      Este ciclo se dibujará en el mapa en color magenta.
    </p>
  `;

    container.innerHTML = html;
    return;
  }


  // ============================================================
  // MODO A: origen → destino
  // ============================================================
  if (result.modo === "origen_destino") {

    let html = `
      <h3>Ruta óptima con origen → destino</h3>
      <table class="data-table">
        <thead>
          <tr>
            <th>Tramo</th>
            <th>Nodo</th>
            <th>Tipo de camino</th>
            <th>Peso sanitario</th>
            <th>Distancia (km) (+)</th>
            <th>Accesibilidad (+)</th>
            <th>Riesgo (+)</th>
            <th>Bonif. SERUMS (-)</th>
            <th>Puntaje SERUMS (-)</th>
          </tr>
        </thead>
        <tbody>
    `;

    result.aristas.forEach((edge, index) => {
      html += `
        <tr>
          <td>${index}</td>
          <td>${result.ruta[index]}</td>
          <td>${edge.type}</td>
          <td>${edge.peso_sanitario.toFixed(2)}</td>
          <td>${edge.distance_km.toFixed(2)}</td>
          <td>${edge.sanitario.accesibilidad}</td>
          <td>${edge.sanitario.riesgo}</td>
          <td>${edge.sanitario.bonificacion_serums}</td>
          <td>${edge.sanitario.puntaje_serums}</td>
        </tr>
      `;
    });

    html += `
        </tbody>
      </table>
    `;

    container.innerHTML = html;
    return;
  }

  // ============================================================
  // MODO B: Top_rutas — múltiples rutas
  // ============================================================
  if (result.modo === "top_rutas") {

    let html = `<h3 style="text-align:left; margin-top:10px;">Mejores rutas recomendadas</h3></br>`;

    result.mejores_rutas.forEach((rutaObj, idx) => {
      html += `
        <h4>Ruta ${idx + 1}</h4>
        </br>
        <table class="data-table">
          <thead>
            <tr>
              <th>Tramo</th>
              <th>Nodo</th>
              <th>Tipo de camino</th>
              <th>Peso sanitario</th>
              <th>Distancia (km) (+)</th>
              <th>Accesibilidad (+)</th>
              <th>Riesgo (+)</th>
              <th>Bonif. SERUMS (-)</th>
              <th>Puntaje SERUMS (-)</th>
            </tr>
          </thead>
          <tbody>
      `;

      rutaObj.aristas.forEach((edge, step) => {
        html += `
          <tr>
            <td>${step}</td>
            <td>${rutaObj.ruta[step]}</td>
            <td>${edge.type}</td>
            <td>${edge.peso_sanitario.toFixed(2)}</td>
            <td>${edge.distance_km.toFixed(2)}</td>
            <td>${edge.sanitario.accesibilidad}</td>
            <td>${edge.sanitario.riesgo}</td>
            <td>${edge.sanitario.bonificacion_serums}</td>
            <td>${edge.sanitario.puntaje_serums}</td>
          </tr>
        `;
      });

      html += `
          </tbody>
        </table>
        <br>
      `;
    });

    container.innerHTML = html;
  }
}


// ===============================================================
// Función auxiliar: Dibujar ciclo negativo
// ===============================================================
function drawNegativeCycle(pathData) {

  if (!window.routeLayer) return;

  const edges = pathData.cycle_edges;
  const nodes = pathData.cycle_nodes;

  // Color especial para ciclos negativos
  const color = "#ff00ff";  // magenta fuerte

  // Dibujar las aristas del ciclo
  edges.forEach(edge => {
    const A = edge.centroid_a;
    const B = edge.centroid_b;

    const poly = L.polyline(
      [[A[0], A[1]], [B[0], B[1]]],
      {
        color: color,
        weight: 7,
        opacity: 1,
        dashArray: "4, 6"
      }
    ).addTo(window.routeLayer);

    poly.bindTooltip(`
      <b>Arista del ciclo</b><br>
      Peso sanitario: ${edge.peso_sanitario}<br>
      Distancia: ${edge.distance_km} km
    `);
  });

  // Dibujar nodos del ciclo
  nodes.forEach((nodeId, idx) => {

    const edge = edges.find(e =>
      e.cluster_a === nodeId || e.cluster_b === nodeId
    );

    if (!edge) return;

    const point =
      edge.cluster_a === nodeId ? edge.centroid_a : edge.centroid_b;

    L.circleMarker([point[0], point[1]], {
      radius: 10,
      color: color,
      fillColor: color,
      fillOpacity: 1
    })
      .bindTooltip(`Nodo ${nodeId}<br>Índice en ciclo: ${idx}`)
      .addTo(window.routeLayer);
  });
}


// ===============================================================
// Función auxiliar: Mostrar tabla con ciclo negativo
// ===============================================================
function showNegativeCycleTable(pathData) {

  const container = document.getElementById("pacient-info-container");

  if (!container) {
    console.error("No existe el contenedor #pacient-info-container");
    return;
  }

  const edges = pathData.cycle_edges;
  const nodes = pathData.cycle_nodes;

  let html = `
      <h3 style="color:#ff00ff;">⚠️ Ciclo negativo detectado</h3>
      <table border="1" cellpadding="5" style="border-collapse:collapse;">
        <tr>
          <th>Nodo A</th>
          <th>Nodo B</th>
          <th>Peso sanitario</th>
          <th>Distancia</th>
          <th>Accesibilidad</th>
          <th>Riesgo</th>
          <th>Bonificación</th>
          <th>Puntaje SERUMS</th>
        </tr>
  `;

  edges.forEach(e => {
    html += `
      <tr>
        <td>${e.cluster_a}</td>
        <td>${e.cluster_b}</td>
        <td>${e.peso_sanitario}</td>
        <td>${e.distance_km}</td>
        <td>${e.sanitario.accesibilidad}</td>
        <td>${e.sanitario.riesgo}</td>
        <td>${e.sanitario.bonificacion_serums}</td>
        <td>${e.sanitario.puntaje_serums}</td>
      </tr>
    `;
  });

  html += `</table><br><b>Secuencia de nodos:</b> ${nodes.join(" → ")}`;

  container.innerHTML = html;
}
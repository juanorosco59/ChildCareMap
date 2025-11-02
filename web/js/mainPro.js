// Importa Graphology para manejar el grafo en memoria
import Graph from "graphology";
// Importa el parser para leer archivos GEXF en el navegador
import { parse } from "graphology-gexf/browser";
// Importa Sigma para renderizar el grafo
import Sigma from "sigma";

export default function main() {
  // Obtiene todos los botones de pestañas (Resumen / Mapa / Datos)
  const triggers = [...document.querySelectorAll(".tab-trigger")];
  // Obtiene todos los paneles de contenido asociados a las pestañas
  const contents = [...document.querySelectorAll(".tab-content")];

  // Referencia al contenedor donde se mostrará el mapa (y/o contenido de otras pestañas)
  const sigmaContainer = document.getElementById("sigma-container");

  // Localiza el bloque de controles del mapa (clase alternativa por compatibilidad)
  const mapControls =
    document.querySelector(".map-controls") ||
    document.querySelector(".graph-controls") ||
    document.getElementById("map-controls");

  // Mantiene la instancia global de Sigma para controlar su ciclo de vida
  let renderer = null;
  // Guarda una función de limpieza opcional para destruir recursos cuando sea necesario
  let cleanup = null;

  // ----------------------------------------------------------------------------------
  // Función: Mostrar datos provenientes del backend dentro de #sigma-container
  // ----------------------------------------------------------------------------------
  async function displayBackendData() {
    // Verifica que el contenedor exista antes de manipularlo
    if (!sigmaContainer) {
      console.warn("No se encontró el elemento con ID 'sigma-container'.");
      return;
    }

    // Muestra un indicador de carga la primera vez o cuando el contenedor está vacío
    if (sigmaContainer.textContent === "") {
      sigmaContainer.innerHTML =
        '<p style="padding:10px; text-align:center; color:#666;">Cargando datos del backend...</p>';
    }

    // Llama al backend y espera la respuesta
    const result = await callAPIBackend();

    // Verifica si se recibió un resultado válido
    if (result) {
      // Prepara la salida según el formato del backend
      let contentToDisplay = "";

      // Si el backend trae una clave message, se muestra en un bloque limpio
      if (typeof result === "object" && result !== null && result.message) {
        contentToDisplay = `
          <div style="padding:20px; text-align:center; border:1px solid #ddd; background:#ffffff;">
            <h3 style="margin:0 0 8px 0; color:#111;">Mensaje del Backend</h3>
            <p style="font-size:1.05em; color:#333; margin:0;">${result.message}</p>
          </div>`;
      } else {
        // Si no hay message, se muestra el JSON crudo de manera legible
        contentToDisplay = `
          <div style="padding:14px; border:1px solid #ddd; background:#ffffff;">
            <h3 style="margin:0 0 8px 0; color:#111;">Datos (raw)</h3>
            <pre style="margin:0; white-space:pre-wrap;">${JSON.stringify(result, null, 2)}</pre>
          </div>`;
      }

      // Inserta el contenido formateado en el contenedor
      sigmaContainer.innerHTML = contentToDisplay;
    } else {
      // Si la llamada falla, muestra un mensaje de error visible
      sigmaContainer.innerHTML =
        '<p style="color:#b91c1c; padding:12px; border:1px solid #fecaca; background:#fef2f2; text-align:center;"><strong>Error:</strong> No se pudo cargar la información del backend.</p>';
    }
  }

  // ----------------------------------------------------------------------------------
  // Función: Destruir instancia de Sigma cuando se va a reutilizar el contenedor
  // ----------------------------------------------------------------------------------
  function destroySigma() {
    // Si existe una instancia activa, se detiene y libera
    if (renderer) {
      renderer.kill();
      renderer = null;
    }
  }

  // ----------------------------------------------------------------------------------
  // Función: Activar pestaña (Resumen / Mapa / Datos) y controlar contenido
  // ----------------------------------------------------------------------------------
  async function activateTab(name) {
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
      // Muestra los controles solo si existen
      if (mapControls) mapControls.style.display = "flex";

      // Carga Sigma solo la primera vez; si ya existe, refresca el render
      if (!renderer) {
        await loadSigma();
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
      sigmaContainer.style.display = "block";
      // Invoca la función que obtiene e inserta los datos del backend
      displayBackendData();
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
  async function loadSigma() {
    try {
      // Solicita el archivo GEXF al servidor
      const res = await fetch("/data/arctic.gexf");
      if (!res.ok) throw new Error(`HTTP error ${res.status}`);

      // Lee el contenido del archivo GEXF como texto
      const gexf = await res.text();

      // Parsea el texto GEXF y crea el grafo en memoria
      const graph = parse(Graph, gexf);

      // Asegura que todos los nodos tengan coordenadas numéricas (fallback aleatorio)
      graph.forEachNode((node, attr) => {
        attr.x = Number(attr.x ?? Math.random());
        attr.y = Number(attr.y ?? Math.random());
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
  // Devuelve una función de limpieza para cuando se desmonte el módulo (opcional)
  // ----------------------------------------------------------------------------------
  return () => {
    // Ejecuta la limpieza si fue definida
    cleanup?.();
    // Retira los listeners de pestañas para evitar fugas de memoria
    triggers.forEach((btn) =>
      btn.removeEventListener("click", () => activateTab(btn.dataset.tab))
    );
  };
}

// ----------------------------------------------------------------------------------
// Función auxiliar: Llamar al API del backend y devolver el JSON
// ----------------------------------------------------------------------------------
async function callAPIBackend() {
  // Define la URL del endpoint del backend
  const apiUrl = "https://childcaremap-capabackend.up.railway.app/api/saludo";

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


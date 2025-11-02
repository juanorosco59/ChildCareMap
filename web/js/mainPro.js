/**
 * mainPro.js — Complete app logic
 * - Tab handling (Resumen / Mapa / Datos)
 * - Lazy-load Sigma graph when "Mapa" tab is active
 * - Zoom + / − / Reset + label threshold
 */

import Graph from "graphology";
import { parse } from "graphology-gexf/browser";
import Sigma from "sigma";

export default function main() {
  // === SELECT DOM ELEMENTS ===
  const triggers = [...document.querySelectorAll(".tab-trigger")];
  const contents = [...document.querySelectorAll(".tab-content")];
  const sigmaContainer = document.getElementById("sigma-container");
  const mapControls =
    document.querySelector(".map-controls") ||
    document.querySelector(".graph-controls") ||
    document.getElementById("map-controls");

  let renderer = null; // Sigma instance
  let cleanup = null; // cleanup function

  // === GUARANTEE CONTROLS ARE ON TOP ===
  if (mapControls && mapControls.parentElement !== document.body) {
    document.body.appendChild(mapControls);
  }
  ensureControlsStyle();

  // === TAB HANDLING ===
  function activateTab(name) {
    triggers.forEach((btn) =>
      btn.classList.toggle("active", btn.getAttribute("data-tab") === name)
    );
    contents.forEach((panel) =>
      panel.classList.toggle("active", panel.dataset.content === name)
    );

    if (name === "mapa") {
      if (!renderer) {
        loadSigma();
      } else {
        sigmaContainer.style.display = "block";
        mapControls.style.display = "flex";
      }
    } else {
      if (renderer) {
        sigmaContainer.style.display = "none";
        mapControls.style.display = "none";
      }
    }
  }

  triggers.forEach((btn) => {
    btn.addEventListener("click", () => activateTab(btn.dataset.tab));
  });

  // Tab inicial
  const initialTab = "resumen";

  activateTab(initialTab);

  // === LOAD SIGMA ONLY WHEN CALLED ===
  async function loadSigma() {
    try {
      const res = await fetch("/data/arctic.gexf");
      if (!res.ok) throw new Error(`HTTP error ${res.status}`);
      const gexf = await res.text();
      const graph = parse(Graph, gexf);

      graph.forEachNode((node, attr) => {
        attr.x = Number(attr.x ?? Math.random());
        attr.y = Number(attr.y ?? Math.random());
      });

      renderer = new Sigma(graph, sigmaContainer, {
        minCameraRatio: 0.08,
        maxCameraRatio: 3,
      });

      const camera = renderer.getCamera();

      const zoomInBtn = document.getElementById("zoom-in");
      const zoomOutBtn = document.getElementById("zoom-out");
      const zoomResetBtn = document.getElementById("zoom-reset");
      const labelsThresholdRange = document.getElementById("labels-threshold");

      zoomInBtn?.addEventListener("click", () => camera.animatedZoom({ duration: 600 }));
      zoomOutBtn?.addEventListener("click", () => camera.animatedUnzoom({ duration: 600 }));
      zoomResetBtn?.addEventListener("click", () => camera.animatedReset({ duration: 600 }));

      if (labelsThresholdRange) {
        labelsThresholdRange.addEventListener("input", () => {
          const val = Number(labelsThresholdRange.value);
          renderer.setSetting("labelRenderedSizeThreshold", val);
          renderer.refresh();
        });
      }

      cleanup = () => {
        renderer?.kill();
        renderer = null;
      };
    } catch (err) {
      console.error("[mainPro] Error loading Sigma:", err);
    }
  }

  // === CLEANUP RETURN ===
  return () => {
    cleanup?.();
    triggers.forEach((btn) =>
      btn.removeEventListener("click", () => activateTab(btn.dataset.tab))
    );
  };
}

/** Inject inline CSS to ensure controls visibility */
function ensureControlsStyle() {
  const id = "inline-map-controls-style";
  if (document.getElementById(id)) return;
  const style = document.createElement("style");
  style.id = id;
  style.textContent = `
    .map-controls, .graph-controls, #map-controls {
      position: fixed !important;
      bottom: 24px !important;
      right: 24px !important;
      left: auto !important;
      z-index: 2147483647 !important;
      background: rgba(255,255,255,0.98) !important;
      backdrop-filter: blur(8px) !important;
      border: 1px solid #d1d5db !important;
      border-radius: 10px !important;
      box-shadow: 0 8px 24px rgba(0,0,0,0.15) !important;
      padding: 10px 14px !important;
      display: flex !important;
      align-items: center !important;
      gap: 10px !important;
      pointer-events: auto !important;
    }

    .map-controls button {
      border: 1px solid #e5e7eb !important;
      background: white !important;
      color: #111827 !important;
      font-weight: 600 !important;
      border-radius: 8px !important;
      padding: 8px 14px !important;
      cursor: pointer !important;
    }

    @media (max-width: 900px) {
      .map-controls {
        left: 50% !important;
        right: auto !important;
        transform: translateX(-50%) !important;
      }
    }
  `;
  document.head.appendChild(style);
}

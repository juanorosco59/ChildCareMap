/**
 * Load a GEXF graph file, display with Sigma, add zoom buttons and label threshold.
 */
import Graph from "graphology";
import { parse } from "graphology-gexf/browser";
import Sigma from "sigma";

export default () => {
  let renderer = null;

  // Load external GEXF file
  fetch("/data/arctic.gexf")
    .then((res) => {
      if (!res.ok) throw new Error(`HTTP error! status: ${res.status}`);
      return res.text();
    })
    .then((gexf) => {
      // Parse GEXF string
      const graph = parse(Graph, gexf);

      // Ensure x and y are numbers
      graph.forEachNode((node, attr) => {
        attr.x = attr.x !== undefined ? Number(attr.x) : Math.random(); // fallback
        attr.y = attr.y !== undefined ? Number(attr.y) : Math.random();
      });

      // Retrieve DOM elements
      const container = document.getElementById("sigma-container");
      const zoomInBtn = document.getElementById("zoom-in");
      const zoomOutBtn = document.getElementById("zoom-out");
      const zoomResetBtn = document.getElementById("zoom-reset");
      const labelsThresholdRange = document.getElementById("labels-threshold");

      // Instantiate Sigma
      renderer = new Sigma(graph, container, {
        minCameraRatio: 0.08,
        maxCameraRatio: 3,
      });
      const camera = renderer.getCamera();

      // Bind zoom buttons
      zoomInBtn.addEventListener("click", () => camera.animatedZoom({ duration: 600 }));
      zoomOutBtn.addEventListener("click", () => camera.animatedUnzoom({ duration: 600 }));
      zoomResetBtn.addEventListener("click", () => camera.animatedReset({ duration: 600 }));

      // Bind label threshold input
      labelsThresholdRange.addEventListener("input", () => {
        renderer?.setSetting(
          "labelRenderedSizeThreshold",
          Number(labelsThresholdRange.value)
        );
      });

      // Initialize input with renderer value
      labelsThresholdRange.value = renderer.getSetting("labelRenderedSizeThreshold") + "";
    })
    .catch((err) => {
      console.error("Error loading or rendering graph:", err);
    });

  // Cleanup
  return () => {
    renderer?.kill();
  };
};

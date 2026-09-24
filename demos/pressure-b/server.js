import path from "node:path";
import { fileURLToPath } from "node:url";
import express from "express";

// Presentation-only duplicate of the original B lab; see README.md for provenance.
export const app = express();
const rootDir = path.dirname(fileURLToPath(import.meta.url));
const rateBuckets = new Map();
const RATE_WINDOW_MS = 10 * 60 * 1000;
const RATE_LIMIT = Number(process.env.COACH_RATE_LIMIT) || 30;

app.set("trust proxy", 1);
app.use(express.json({ limit: "32kb" }));

function coachRateLimit(req, res, next) {
  const now = Date.now();
  const key = req.ip || "unknown";
  const bucket = rateBuckets.get(key);

  if (!bucket || now - bucket.startedAt >= RATE_WINDOW_MS) {
    rateBuckets.set(key, { startedAt: now, count: 1 });
    return next();
  }

  if (bucket.count >= RATE_LIMIT) {
    return res.status(429).json({
      error: "Too many coach questions. Please try again in a few minutes.",
    });
  }

  bucket.count += 1;
  return next();
}

function cleanText(value, maxLength) {
  return typeof value === "string" ? value.trim().slice(0, maxLength) : "";
}

function finiteNumber(value, min, max, fallback = null) {
  if (value == null || value === "") return fallback;
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(max, Math.max(min, number));
}

function getPressureContext(context = {}) {
  const gravity = 9.80;
  const topLayerEnabled = Boolean(context.topLayerEnabled);
  const bottomDensity = finiteNumber(context.bottomDensity, 100, 14000, 1000);
  const topDensity = topLayerEnabled
    ? finiteNumber(context.topDensity, 100, 14000, 800)
    : null;
  const bottomLayerDepth = finiteNumber(context.bottomLayerDepth, 0.1, 10, 3);
  const topLayerDepth = topLayerEnabled
    ? finiteNumber(context.topLayerDepth, 0.1, 10, 1)
    : 0;
  const totalDepth = bottomLayerDepth + topLayerDepth;
  const sensorDepth = finiteNumber(context.sensorDepth, 0, totalDepth, 0);
  const topDepthAboveSensor = topLayerEnabled
    ? Math.min(sensorDepth, topLayerDepth)
    : 0;
  const bottomDepthAboveSensor = topLayerEnabled
    ? Math.max(0, sensorDepth - topLayerDepth)
    : sensorDepth;
  const gagePressure = (
    (topLayerEnabled ? topDensity * gravity * topDepthAboveSensor : 0)
    + bottomDensity * gravity * bottomDepthAboveSensor
  ) / 1000;
  const pressureReference = cleanText(context.pressureReference, 20).toLowerCase()
    === "absolute" ? "absolute" : "gage";
  const atmosphericPressure = finiteNumber(
    context.atmosphericPressure,
    50,
    120,
    101.3,
  );
  const expectedPressure = pressureReference === "absolute"
    ? gagePressure + atmosphericPressure
    : gagePressure;
  const prediction = finiteNumber(context.prediction, -100000, 100000);

  return {
    mode: cleanText(context.mode, 20) === "challenge" ? "challenge" : "explore",
    pressureReference,
    atmosphericPressure,
    topLayerEnabled,
    topFluid: topLayerEnabled
      ? cleanText(context.topFluid, 80) || "top fluid"
      : "not present",
    topDensity,
    topLayerDepth,
    bottomFluid: cleanText(context.bottomFluid, 80) || "bottom fluid",
    bottomDensity,
    bottomLayerDepth,
    sensorDepth,
    sensorLayer: cleanText(context.sensorLayer, 80) || "unknown",
    topDepthAboveSensor,
    bottomDepthAboveSensor,
    gagePressure,
    expectedPressure,
    prediction,
    predictionError: prediction == null ? null : prediction - expectedPressure,
    attempts: finiteNumber(context.attempts, 0, 100, 0),
    hintsUsed: finiteNumber(context.hintsUsed, 0, 100, 0),
    answerRevealed: Boolean(context.answerRevealed),
  };
}

function readableNumber(value, digits = 2) {
  return Number(value).toFixed(digits);
}

function ruleBasedCoachReply(question, pressure) {
  const q = question.toLowerCase();

  if (q.includes("hint")) {
    if (
      pressure.topLayerEnabled
      && pressure.sensorDepth > pressure.topLayerDepth
    ) {
      return `Split the column at the interface. Calculate \\(\\rho g h\\) for ${readableNumber(pressure.topDepthAboveSensor)} m of ${pressure.topFluid}, then for ${readableNumber(pressure.bottomDepthAboveSensor)} m of ${pressure.bottomFluid}, and add them.${pressure.pressureReference === "absolute" ? " Add atmospheric pressure last." : ""}`;
    }
    return `Use the density of ${pressure.sensorLayer} and the vertical depth ${readableNumber(pressure.sensorDepth)} m in \\(p = \\rho g h\\).${pressure.pressureReference === "absolute" ? " Then add atmospheric pressure." : " Convert Pa to kPa by dividing by 1000."}`;
  }

  if (q.includes("gage") || q.includes("absolute") || q.includes("atmos")) {
    return `Gage pressure is measured relative to local atmospheric pressure. Absolute pressure is measured relative to a perfect vacuum: \\(p_{\\mathrm{abs}} = p_{\\mathrm{atm}} + p\\). At the open free surface, gage pressure is 0 kPa while absolute pressure is ${readableNumber(pressure.atmosphericPressure, 1)} kPa.`;
  }

  if (q.includes("slope") || q.includes("graph")) {
    return "The pressure-depth slope is \\(\\mathrm{d}p/\\mathrm{d}h = \\rho g\\). A denser fluid makes the graph steeper. With two layers, the change in slope marks the fluid interface; pressure itself remains continuous there.";
  }

  if (q.includes("layer") || q.includes("add")) {
    return "Each layer adds the weight per unit area of fluid above the sensor. For two layers, \\(p = \\rho_1 g h_1 + \\rho_2 g h_2\\). Use each density only with its own vertical depth.";
  }

  if (q.includes("unit") || q.includes("kpa") || q.includes("pa")) {
    return "Using density in \\(\\mathrm{kg/m^3}\\), \\(g\\) in \\(\\mathrm{m/s^2}\\), and depth in \\(\\mathrm{m}\\) gives pressure in pascals. Divide by 1000 to report kilopascals.";
  }

  if (pressure.mode === "challenge" && !pressure.answerRevealed) {
    return "Start with the fluid directly below the free surface and account for every layer above the sensor. I will keep the numerical answer hidden while the challenge is active.";
  }

  return `At ${readableNumber(pressure.sensorDepth)} m, the gage pressure is ${readableNumber(pressure.gagePressure)} kPa. ${pressure.pressureReference === "absolute" ? `Adding ${readableNumber(pressure.atmosphericPressure, 1)} kPa gives ${readableNumber(pressure.expectedPressure)} kPa absolute.` : "Pressure rises with depth because more fluid weight is supported above the sensor."}`;
}

app.get("/api/health", (req, res) => {
  res.json({ ok: true, coachReady: true, condition: "B", source: "rule_based" });
});

// This service has one condition. Cookies, links, and request fields cannot select A.
app.post("/api/chat", coachRateLimit, (req, res) => {
  const question = cleanText(req.body?.question, 800);
  if (!question) return res.status(400).json({ error: "Please enter a question." });
  const pressure = getPressureContext(req.body?.context);
  return res.json({ reply: ruleBasedCoachReply(question, pressure), source: "rule_based" });
});

app.get(["/", "/index.html"], (req, res) => {
  res.sendFile(path.join(rootDir, "index.html"));
});

app.use((error, req, res, next) => {
  if (res.headersSent) return next(error);
  const status = error.type === "entity.too.large" ? 413
    : error.type === "entity.parse.failed" ? 400 : 500;
  return res.status(status).json({ error: status === 500 ? "Server error" : "Invalid request" });
});

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.PORT) || 3000;
  app.listen(port, "0.0.0.0", () => {
    console.log(`Pressure B workshop demo listening on port ${port}`);
  });
}

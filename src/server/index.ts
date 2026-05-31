import "./loadEnv.js";
import path from "node:path";
import { createServer as createHttpServer } from "node:http";
import express from "express";
import { createApp } from "./app.js";

const port = Number(process.env.PORT || 4317);
const isProduction = process.env.NODE_ENV === "production";

async function main(): Promise<void> {
  const app = createApp();
  const httpServer = createHttpServer(app);

  if (isProduction) {
    const distPath = path.resolve(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.use((request, response, next) => {
      if (request.path.startsWith("/api")) {
        next();
        return;
      }
      response.sendFile(path.join(distPath, "index.html"));
    });
  } else {
    const { createServer: createViteServer } = await import("vite");
    const vite = await createViteServer({
      server: { middlewareMode: true, hmr: { server: httpServer } },
      appType: "spa"
    });
    app.use(vite.middlewares);
  }

  httpServer.on("error", (error: NodeJS.ErrnoException) => {
    if (error.code === "EADDRINUSE") {
      console.error(`Port ${port} is already in use. Set PORT to a free port and restart Test Factory.`);
      process.exit(1);
    }
    throw error;
  });

  httpServer.listen(port, () => {
    console.log(`Test Factory running at http://localhost:${port}`);
  });
}

void main();

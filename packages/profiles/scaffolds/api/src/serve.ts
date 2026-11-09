// Serves the service on this computer, on PORT.
import { serve } from "@hono/node-server";
import { app } from "./app.js";

const port = Number(process.env.PORT || 3000);
serve({ fetch: app.fetch, port }, () => console.log(`service on http://localhost:${port} (docs at /docs)`));

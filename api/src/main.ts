import { buildApp } from "./app.js";
import { loadConfig } from "./config.js";

const config = loadConfig();
const app = buildApp({ snapshotDir: config.snapshotDir, logger: true });

app
  .listen({ host: config.host, port: config.port })
  .then((address) => {
    app.log.info(`Patch Data API listening at ${address}`);
  })
  .catch((err) => {
    app.log.error(err);
    process.exit(1);
  });

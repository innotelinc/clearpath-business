import { rmSync } from "node:fs";
import path from "node:path";
import { env } from "../server/env.js";

if (process.env.CONFIRM_RESET !== "yes") {
  console.error(
    "Refusing to reset. This deletes every workspace record.\n" +
      "Re-run with CONFIRM_RESET=yes if that is what you want."
  );
  process.exit(1);
}

const file = path.resolve(env.dbPath);
for (const suffix of ["", "-wal", "-shm"]) {
  rmSync(`${file}${suffix}`, { force: true });
}
console.log(`Removed ${file} (and its WAL files). Start the server to rebuild the schema.`);

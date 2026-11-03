// Fills a test server's data folder from `REAL_DB`: node --import tsx src/testRealSetup.ts <dataDir>
import { prepareDataDir } from "./testRealDb.ts";

await prepareDataDir(process.env.REAL_DB ?? "", process.argv[2] ?? "");

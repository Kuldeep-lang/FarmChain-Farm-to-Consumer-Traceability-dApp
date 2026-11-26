import { network } from "hardhat";
import * as fs from "fs";
import * as path from "path";
import { DEPLOYMENTS_DIR, exportToApps, loadDeployment } from "./lib/deployment";

/** Re-export ABIs (and the deployment for the selected network, if one exists) to the apps. */
async function main() {
  const file = path.join(DEPLOYMENTS_DIR, `${network.name}.json`);
  await exportToApps(fs.existsSync(file) ? loadDeployment(network.name) : undefined);
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});

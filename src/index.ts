// import "dotenv/config";

// import { auditorAgent } from "./agents/auditor/agent.ts";
// import { coderAgent } from "./agents/coder/agent.ts";
// import { testerAgent } from "./agents/tester/agent.ts";

// const requirements = ["ERC20 token", "pausable", "ownable"];

// const coderResult = await coderAgent.invoke({ requirements });
// console.log("======= Coder =======");
// console.log(coderResult.contract);

// const auditorResult = await auditorAgent.invoke({ solidityFile: coderResult.contract });
// console.log("\n======= Auditor =======");
// console.log(auditorResult.findings);

// const testerResult = await testerAgent.invoke({
//   solidityFiles: [coderResult.contract],
//   vulnerability: auditorResult.findings[0] ?? {},
// });
// console.log("\n======= Tester =======");
// console.log(testerResult.results);

import "dotenv/config";
import { auditorAgent } from "./agents/auditor/agent.ts";
import { logger } from "./logger.ts";

logger.info("Starting auditorAgent");

const result = await auditorAgent.invoke({
  repoPath: "/Users/uanderson/personal/projeto-talp1/dist/repos/example",
});

logger.info("Agent completed");
logger.debug(`Agent result:\n${JSON.stringify(result, null, 2)}`);

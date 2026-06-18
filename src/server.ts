import "dotenv/config";

import { mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { tmpdir } from "node:os";
import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { streamSSE } from "hono/streaming";
import { serveStatic } from "@hono/node-server/serve-static";

import { coderAgent } from "./agents/coder/agent.ts";
import { auditorAgent } from "./agents/auditor/agent.ts";
import { testerAgent } from "./agents/tester/agent.ts";
import { mapFindingToReport } from "./utils/mapFinding.js";
import { createEmptyFoundryProject } from "./utils/forgeSandbox.js";
import { logger, setLogSink, clearLogSink, setStepSink, clearStepSink } from "./logger.ts";

const app = new Hono();

app.use("/api/*", cors());

app.post("/api/run", (c) => {
  return streamSSE(c, async (stream) => {
    const body = await c.req.json<{ requirements: string }>();
    const requirements = body.requirements?.trim();

    if (!requirements) {
      await stream.writeSSE({ event: "error", data: "Requisitos não fornecidos." });
      return;
    }

    let eventId = 0;

    const send = async (event: string, data: string) => {
      await stream.writeSSE({ id: String(eventId++), event, data });
    };

    try {
      setLogSink((msg) => send("log", msg));
      setStepSink((event) => send("step", JSON.stringify(event)));

      // === CODER ===
      logger.info("[Coder] Gerando smart contract a partir dos requisitos...");
      const coderResult = await coderAgent.invoke({ requirements: [requirements] });

      if (coderResult.compilationErrors.length > 0) {
        logger.info(`[Coder] Erros de compilação restantes: ${coderResult.compilationErrors.length}`);
      } else {
        logger.info("[Coder] Contrato compilado sem erros.");
      }

      await send(
        "coder",
        JSON.stringify({
          contract: coderResult.contract,
          compilationErrors: coderResult.compilationErrors,
          reviewSummary: coderResult.reviewSummary,
        }),
      );

      // === AUDITOR ===
      const outputDir = resolve(tmpdir(), `talp1-${Date.now()}`);
      mkdirSync(outputDir, { recursive: true });
      writeFileSync(resolve(outputDir, "Contract.sol"), coderResult.contract, "utf-8");
      writeFileSync(resolve(outputDir, "README.md"), requirements, "utf-8");

      logger.info("[Auditor] Iniciando auditoria de segurança...");
      const auditorResult = await auditorAgent.invoke({ repoPath: outputDir });
      logger.info(`[Auditor] ${auditorResult.findings.length} vulnerabilidade(s) encontrada(s).`);
      for (const f of auditorResult.findings) {
        logger.info(`[Auditor] [${f.severity.toUpperCase()}] ${f.title} — ${f.location}`);
      }

      await send(
        "auditor",
        JSON.stringify({
          findings: auditorResult.findings,
        }),
      );

      // === TESTER ===
      logger.info("[Tester] Gerando testes de prova de conceito...");

      if (auditorResult.findings.length > 0) {
        const report = mapFindingToReport(
          auditorResult.findings[0],
          coderResult.contract,
          auditorResult.repoContext   // ← now forwarded to tester
        );
        const sandboxDir = resolve(tmpdir(), `talp1-tester-${Date.now()}`);
        await createEmptyFoundryProject(sandboxDir, coderResult.contract, "Contract");
        report.customSandboxDir = sandboxDir;  // ← tester runs in real project sandbox
        report.affectedContract.sourceFilePath = "src/Contract.sol"; // Fix bug with relative path

        const testerResult = await testerAgent.invoke(
          { report },
          { recursionLimit: 100, configurable: { sandboxDir } }
        );

        logger.info(`[Tester] Execução concluída com status: ${testerResult.status}`);

        let finalPocCode = testerResult.pocCode || "";
        try {
          finalPocCode = readFileSync(resolve(sandboxDir, "test/Exploit.t.sol"), "utf-8");
        } catch (e) {
          // Ignorar se não criou
        }

        let finalExecutionLogs: string[] = testerResult.executionLogs || [];
        if (finalExecutionLogs.length === 0 && testerResult.messages) {
          const testMsgs = testerResult.messages.filter((m: any) => m._getType() === "tool" && m.name === "smart_contract_test");
          if (testMsgs.length > 0) {
            const content = testMsgs[testMsgs.length - 1].content;
            finalExecutionLogs = [typeof content === "string" ? content : JSON.stringify(content)];
          }
        }

        // Garante que o objeto enviado tem exatamente o que o front espera
        await send(
          "tester",
          JSON.stringify({
            status: testerResult.status,
            pocCode: finalPocCode,
            executionLogs: finalExecutionLogs,
            iterations: testerResult.iterations,
          }),
        );
      } else {
        logger.info("[Tester] Nenhuma vulnerabilidade para testar.");
        await send("tester", JSON.stringify({ status: "skipped", iterations: 0 }));
      }

      logger.info("Pipeline concluído.");
      await send("done", "ok");
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await send("error", message);
    } finally {
      clearLogSink();
      clearStepSink();
    }
  });
});

// Serve static frontend files (built React app)
app.use("/*", serveStatic({ root: "./frontend/dist" }));

const port = Number(process.env.PORT) || 7860;
console.log(`Servidor rodando em http://localhost:${port}`);
serve({ fetch: app.fetch, port });

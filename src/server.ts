import "dotenv/config";

import { mkdirSync, writeFileSync } from "node:fs";
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
      // === CODER ===
      await send("log", "[Coder] Gerando smart contract a partir dos requisitos...");
      const coderResult = await coderAgent.invoke({ requirements: [requirements] });

      await send("log", "[Coder] Contrato gerado com sucesso.");

      if (coderResult.compilationErrors.length > 0) {
        await send("log", `[Coder] Erros de compilação restantes: ${coderResult.compilationErrors.length}`);
      } else {
        await send("log", "[Coder] Contrato compilado sem erros.");
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

      await send("log", "[Auditor] Iniciando auditoria de segurança...");
      const auditorResult = await auditorAgent.invoke({ repoPath: outputDir });
      await send("log", `[Auditor] ${auditorResult.findings.length} vulnerabilidade(s) encontrada(s).`);
      for (const f of auditorResult.findings) {
        await send("log", `[Auditor] [${f.severity.toUpperCase()}] ${f.title} — ${f.location}`);
      }

      await send(
        "auditor",
        JSON.stringify({
          findings: auditorResult.findings,
        }),
      );

      // === TESTER ===
      await send("log", "[Tester] Gerando testes de prova de conceito...");

      if (auditorResult.findings.length > 0) {
        const report = mapFindingToReport(auditorResult.findings[0], coderResult.contract);
        const testerResult = await testerAgent.invoke({ report });

        await send("log", `[Tester] Execução concluída com status: ${testerResult.status}`);
        await send(
          "tester",
          JSON.stringify({
            status: testerResult.status,
            pocCode: testerResult.pocCode,
            executionLogs: testerResult.executionLogs,
            iterations: testerResult.iterations,
          }),
        );
      } else {
        await send("log", "[Tester] Nenhuma vulnerabilidade para testar.");
        await send("tester", JSON.stringify({ results: [] }));
      }

      await send("log", "Pipeline concluído.");
      await send("done", "ok");
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await send("error", message);
    }
  });
});

// Serve static frontend files (built React app)
app.use("/*", serveStatic({ root: "./frontend/dist" }));

const port = Number(process.env.PORT) || 7860;
console.log(`Servidor rodando em http://localhost:${port}`);
serve({ fetch: app.fetch, port });

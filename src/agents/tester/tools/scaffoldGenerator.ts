import { VulnerabilityReport } from "../types.js";

export function generateLocalScaffold(report: VulnerabilityReport): string {
  const cheatcodes = report.suggestedCheatcodes?.join(", ") ?? "vm.deal, vm.prank, vm.warp";

  return `// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "forge-std/console.sol";

// ── Código-fonte do contrato vulnerável ──────────────────────────────────────
${report.affectedContract.sourceCode}
// ─────────────────────────────────────────────────────────────────────────────

contract ExploitTest is Test {
    ${report.affectedContract.name} target;
    address constant ATTACKER = address(0xBEEF);

    // setUp() gerado automaticamente pelo Oracle — NÃO MODIFICAR
    function setUp() public {
        target = new ${report.affectedContract.name}();
        vm.deal(address(target), 100 ether);
        vm.deal(ATTACKER, 10 ether);
        vm.label(address(target), "TARGET");
        vm.label(ATTACKER, "ATTACKER");
    }

    // Vulnerabilidade: ${report.title}
    // Tipo: ${report.type}
    // Vetor: ${report.attackVector}
    ${report.exploitablePaths ? `// Caminhos de Exploração:\n    // - ${report.exploitablePaths.join("\n    // - ")}` : ""}
    // Cheatcodes sugeridos: ${cheatcodes}
    //
    // COMPLETE APENAS ESTA FUNÇÃO — não altere setUp() nem os campos acima
    function test_Exploit() public {
        vm.startPrank(ATTACKER);
        // TODO: implementar exploit aqui
        vm.stopPrank();
    }
}`.trim();
}

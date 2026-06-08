import { VulnerabilityReport } from "../types.js";

export function generateLocalScaffold(report: VulnerabilityReport): string {
  const cheatcodes = report.suggestedCheatcodes?.join(", ") ?? "vm.deal, vm.prank, vm.warp";

  // Extrair pragma do código original para evitar conflitos de versão
  const pragmaMatch = report.affectedContract.sourceCode.match(/pragma solidity ([^;]+);/);
  const pragma = pragmaMatch ? pragmaMatch[0] : "pragma solidity ^0.8.20;";

  let contractSetup = "";
  if (report.affectedContract.sourceFilePath) {
    // Se temos o caminho do arquivo, importamos ao invés de colar
    contractSetup = `import { ${report.affectedContract.name} } from "../${report.affectedContract.sourceFilePath}";`;
  } else {
    // Fallback: colar o código (pode falhar por causa de imports ausentes no sandbox)
    contractSetup = `// ── Código-fonte do contrato vulnerável ──────────────────────────────────────\n${report.affectedContract.sourceCode}\n// ─────────────────────────────────────────────────────────────────────────────`;
  }

  return `// SPDX-License-Identifier: UNLICENSED
${pragma}

import "forge-std/Test.sol";
import "forge-std/console.sol";

${contractSetup}

contract ExploitTest is Test {
    ${report.affectedContract.name} target;
    address constant ATTACKER = address(0xBEEF);

    // setUp() - O Oracle tentou gerar um básico, mas sinta-se à vontade para ajustar se o contrato for complexo
    function setUp() public virtual {
        // target = new ${report.affectedContract.name}(...); // TODO: ajustar se necessário
        vm.deal(ATTACKER, 100 ether);
    }

    // Vulnerabilidade: ${report.title}
    // Tipo: ${report.type}
    // Vetor: ${report.attackVector}
    ${report.exploitablePaths ? `// Caminhos de Exploração:\n    // - ${report.exploitablePaths.join("\n    // - ")}` : ""}
    // Cheatcodes sugeridos: ${cheatcodes}
    //
    // Implemente test_Exploit() e ajuste o setUp() se o contrato exigir argumentos no constructor.
    function test_Exploit() public {
        vm.startPrank(ATTACKER);
        // TODO: implementar exploit aqui
        vm.stopPrank();
    }
}`.trim();
}

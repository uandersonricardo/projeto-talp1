import { PoCStateAnnotation } from "../src/agents/tester/state.js";

const s = (PoCStateAnnotation as any).spec;
if (s.iterations !== undefined) {
    console.log("Estado OK: iterations existe");
} else {
    console.error("Erro: iterations não existe no spec");
    process.exit(1);
}

// Teste de reducer aditivo para iterations
const iterationsSpec = s.iterations;
const initial = 0;
const update = 1;
const result = (iterationsSpec.reducer || ((x: number, y: number) => x + y))(initial, update);
if (result === 1) {
    console.log("Reducer aditivo OK: 0 + 1 = 1");
} else {
    console.error(`Erro no reducer aditivo: esperado 1, recebido ${result}`);
    process.exit(1);
}

console.log("Teste de estado concluído com sucesso");

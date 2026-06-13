const code = `
    function setUp() public virtual {
        // target = address(new Target());
        vm.startPrank(ATTACKER);
        vm.deal(ATTACKER, 100 ether);
    }
`;
const isTargetNotDeployed = code.includes("// target = new") || 
                            code.includes("//Target target = new") || 
                            code.match(/\/\/\s*([a-zA-Z0-9_]+)\s*=\s*new\s+[a-zA-Z0-9_]+/);
console.log(!!isTargetNotDeployed);

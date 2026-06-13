const fs = require('fs');
const trimmedCode = fs.readFileSync('/home/tales/Mestrado/IA/projeto-talp1/temp_vuln_run/001/test/Exploit.t.sol', 'utf8');
const hasIllegalComments = trimmedCode.split('\n').some(line => {
  const isComment = line.includes('//') || line.includes('/*');
  const isAllowed = line.includes('SPDX-License-Identifier') || line.includes('INJECT_HACK');
  if (isComment && !isAllowed) {
    console.log("ILLEGAL COMMENT LINE: ", line);
  }
  return isComment && !isAllowed;
});
console.log("hasIllegalComments:", hasIllegalComments);

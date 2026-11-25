import{execFileSync}from'node:child_process';
const args={cwd:'components/daozai',encoding:'utf8',windowsHide:true};
const diff=execFileSync('git',['diff','--cached','--no-ext-diff','--unified=0'],args);
const patterns=[/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/,/\b(?:gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{40,})\b/,/\bsk-(?:proj-)?[A-Za-z0-9_-]{28,}\b/,/\bAKIA[0-9A-Z]{16}\b/,/(?:password|api_key|client_secret|access_token)\s*[:=]\s*["'][A-Za-z0-9+/=_-]{20,}["']/i];
const hits=diff.split('\n').filter(l=>l.startsWith('+')&&!l.startsWith('+++')).filter(l=>patterns.some(p=>p.test(l))).length;
console.log(JSON.stringify({scope:'native staged added lines',credentialPatternHits:hits}));if(hits)process.exit(1);

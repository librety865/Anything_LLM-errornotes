import {spawn} from 'node:child_process';import {readFile,writeFile,mkdtemp,rm} from 'node:fs/promises';import {once} from 'node:events';import {join} from 'node:path';
const packageDir='D:/项目/Anything_MLL错题本/Anything_MLL/AnythingLLM/resources/backend';
const temp=await mkdtemp(join(process.cwd(),'.prisma-engine-'));
const db=join(temp,'read-check.db');
let child;
try{
await writeFile(db,await readFile(join(process.env.APPDATA,'anythingllm-desktop','storage','anythingllm.db')));
const exe=join(packageDir,'node_modules','.prisma','client','query-engine-windows.exe');
child=spawn(exe,['--datamodel-path',join(packageDir,'prisma','schema.prisma'),'--host','127.0.0.1','--port','0','--engine-protocol','json'],{windowsHide:true,env:{...process.env,DATABASE_URL:'file:'+db.replaceAll('\\','/'),RUST_LOG:'info'},stdio:['ignore','pipe','pipe']});
let output='',stderr='';child.stdout.on('data',d=>output+=d);child.stderr.on('data',d=>stderr+=d);
let port;for(let i=0;i<40&&!port&&child.exitCode===null;i++){port=(output+stderr).match(/127\.0\.0\.1:(\d+)/)?.[1];if(!port)await new Promise(r=>setTimeout(r,150));}
if(!port){console.log('引擎未监听',child.exitCode,output.slice(-1000),stderr.slice(-1000));process.exitCode=1;}
else {
console.log('引擎启动日志', (output+stderr).trim().split('\n').slice(-3));
const resp=await fetch('http://127.0.0.1:'+port,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({modelName:'system_settings',action:'findFirst',query:{arguments:{where:{label:'multi_user_mode'}},selection:{label:true}}}),signal:AbortSignal.timeout(5000)});
const val=await resp.json();console.log('独立引擎 HTTP',resp.status,'查询有响应:',Object.hasOwn(val,'data'),'查询有错误:',!!val.errors);
}
}finally{if(child&&child.exitCode===null&&child.signalCode===null){const e=once(child,'exit');child.kill();await e;}await rm(temp,{recursive:true,force:true});}
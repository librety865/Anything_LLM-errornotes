import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
const configDirectory=new URL('.',import.meta.url);
const configPath=decodeURIComponent(configDirectory.pathname);
const projectRoot=configDirectory.hostname?'//'+configDirectory.hostname+configPath:configPath.replace(/^\/([A-Za-z]:\/)/,'$1');
export default defineConfig(({mode})=>{
 const env=loadEnv(mode,projectRoot,'');
 if(env.VITE_USE_MOCK==='false'&&!env.VITE_ANYTHINGLLM_API_KEY)console.warn('AnythingLLM API Key 为空，请配置 .env.local');
 // Desktop listens on IPv4 loopback by default; avoid localhost resolving to ::1.
 const target=env.VITE_ANYTHINGLLM_BASE_URL||'http://127.0.0.1:3001';
 return {root:projectRoot,envDir:projectRoot,base:mode==='desktop'?'/':'./',envPrefix:mode==='desktop'?'ZHIXU_PUBLIC_':'VITE_',build:{outDir:mode==='desktop'?'dist-desktop':'dist'},plugins:[react()],server:{host:'127.0.0.1',port:5173,strictPort:false,proxy:{'/api':{target,changeOrigin:true,configure(proxy){
 proxy.on('error',(_error,_request,response)=>{
  if('writeHead' in response&&!response.headersSent){
   response.writeHead(502,{'Content-Type':'application/json; charset=utf-8','X-Zhixu-Proxy-Error':'1'});
   response.end(JSON.stringify({error:'前端代理无法连接 AnythingLLM，请确认桌面版正在运行，并核对 API 地址和端口。'}));
  }
 });
 }}}}};
});

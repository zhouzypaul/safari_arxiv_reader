import http from 'node:http';
import {readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
const root=fileURLToPath(new URL('../extension/',import.meta.url));
const types={'.html':'text/html','.js':'text/javascript','.mjs':'text/javascript','.css':'text/css','.wasm':'application/wasm','.pdf':'application/pdf'};
http.createServer(async(req,res)=>{try{const name=decodeURIComponent(new URL(req.url,'http://localhost').pathname);const file=path.resolve(root,'.'+(name==='/'?'/reader.html':name));if(!file.startsWith(root))throw Error();const data=await readFile(file);res.writeHead(200,{'Content-Type':types[path.extname(file)]||'application/octet-stream','X-Content-Type-Options':'nosniff','Cache-Control':'no-store'});res.end(data);}catch{res.writeHead(404);res.end('Not found');}}).listen(18743,'127.0.0.1',()=>console.log('safari_arxiv_reader: http://127.0.0.1:18743'));

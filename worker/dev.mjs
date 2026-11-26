// Runs the worker locally on http://localhost:8787 for testing with the app on localhost:5180.
import http from 'node:http';
import worker from './index.js';

http.createServer(async (req, res) => {
  const valasz = await worker.fetch(new Request('http://localhost:8787' + req.url, { method: req.method, headers: req.headers }));
  res.writeHead(valasz.status, Object.fromEntries(valasz.headers));
  res.end(Buffer.from(await valasz.arrayBuffer()));
}).listen(8787, () => console.log('Recipe reader on http://localhost:8787'));

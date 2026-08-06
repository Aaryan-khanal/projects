const http = require('http');
function post(path, payload, cb){
  const data = JSON.stringify(payload);
  const options = { hostname: 'localhost', port: 3000, path, method: 'POST', headers: {'Content-Type':'application/json', 'Content-Length': Buffer.byteLength(data)} };
  const req = http.request(options, res => { let body=''; res.setEncoding('utf8'); res.on('data', c=>body+=c); res.on('end', ()=> cb(null, body)); });
  req.on('error', e => cb(e)); req.write(data); req.end();
}

post('/api/users', { name: 'Temp Admin', email: 'tempadmin', password: 'tempPass123', role: 'super_admin' }, (err, body) => {
  if (err) return console.error('create error', err);
  console.log('create response:', body);
  post('/api/auth/login', { email: 'tempadmin', password: 'tempPass123', role: 'super_admin' }, (err2, body2) => {
    if (err2) return console.error('login error', err2);
    console.log('login response:', body2);
  });
});

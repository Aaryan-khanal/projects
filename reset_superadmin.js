const http = require('http');
function request(method, path, payload, cb){
  const data = payload ? JSON.stringify(payload) : null;
  const options = { hostname: 'localhost', port: 3000, path, method, headers: data ? {'Content-Type':'application/json','Content-Length':Buffer.byteLength(data)} : {} };
  const req = http.request(options, res => { let body=''; res.setEncoding('utf8'); res.on('data', c=>body+=c); res.on('end', ()=>cb(null, body)); });
  req.on('error', e=>cb(e));
  if (data) req.write(data);
  req.end();
}

request('DELETE','/api/users/1', null, (err, body) => {
  if (err) return console.error('delete error', err);
  console.log('delete response:', body);
  request('POST','/api/users',{ name: 'Super Admin', email: 'superadmin', password: 'superadmin', role: 'super_admin' }, (err2, body2) => {
    if (err2) return console.error('create error', err2);
    console.log('create response:', body2);
    request('POST','/api/auth/login',{ email: 'superadmin', password: 'superadmin', role: 'super_admin' }, (err3, body3) => {
      if (err3) return console.error('login error', err3);
      console.log('login response:', body3);
    });
  });
});

const http = require('http');
function post(path, payload){
  return new Promise((resolve,reject)=>{
    const data = JSON.stringify(payload);
    const options = { hostname:'localhost', port:3000, path, method:'POST', headers:{ 'Content-Type':'application/json', 'Content-Length':Buffer.byteLength(data) } };
    const req = http.request(options, res=>{ let body=''; res.setEncoding('utf8'); res.on('data',c=>body+=c); res.on('end', ()=> resolve({ status: res.statusCode, body })); });
    req.on('error', reject); req.write(data); req.end();
  });
}
function get(path, token){
  return new Promise((resolve,reject)=>{
    const options = { hostname:'localhost', port:3000, path, method:'GET', headers: { Authorization: `Bearer ${token}` } };
    const req = http.request(options, res=>{ let body=''; res.setEncoding('utf8'); res.on('data',c=>body+=c); res.on('end', ()=> resolve({ status: res.statusCode, body })); });
    req.on('error', reject); req.end();
  });
}
(async ()=>{
  try{
    const login = await post('/api/auth/login', { email:'superadmin', password:'superadmin', role:'super_admin' });
    console.log('login', login.status, login.body);
    const data = JSON.parse(login.body);
    const token = data.token;
    const users = await get('/api/users', token);
    console.log('users', users.status, users.body);
  }catch(e){ console.error(e); process.exit(1); }
})();

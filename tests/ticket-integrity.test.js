const {test}=require('node:test');
const assert=require('node:assert/strict');
const crypto=require('node:crypto');
process.env.DB=':memory:';process.env.SECRET='integrity-tests';process.env.DEMO_OTP_BYPASS='1';
process.env.TURSO_DATABASE_URL='';process.env.TURSO_AUTH_TOKEN='';
const {app,db}=require('../server');
test('atomic inventory, balances, scan and refund under concurrent requests',async()=>{
 await db.migrate();const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));
 const call=async(path,body,cookie='')=>{const response=await fetch(`http://127.0.0.1:${server.address().port}/api/${path}`,{method:'POST',headers:{'Content-Type':'application/json',Cookie:cookie},body:JSON.stringify(body)});return {status:response.status,body:await response.json(),cookie:response.headers.get('set-cookie')?.split(';')[0]}};
 try{
 const buyer=(await db.get("SELECT id FROM users WHERE username='demo_customer'" )).id;
 const org=(await db.get("SELECT id FROM users WHERE username='demo_organizer'" )).id;
 const customer=(await call('login',{username:'demo_customer',password:'Demo@2025'})).cookie;
 const organizer=(await call('login',{username:'demo_organizer',password:'Demo@2025'})).cookie;
 const today=new Date(Date.now()+7*3600000).toISOString().slice(0,10);
 const event=Number((await db.run("INSERT INTO events(org,name,date,venue,price,total,remain,status,max_per_user) VALUES(?,'Race',?,'Test',100000,1,1,'active',0)",[org,today])).lastInsertRowid);
 await db.run('UPDATE users SET balance=100000 WHERE id=?',[buyer]);
 const buys=await Promise.all([call('buy',{event},customer),call('buy',{event},customer)]);
 assert.deepEqual(buys.map(x=>x.status).sort(),[200,400]);
 assert.equal((await db.get('SELECT balance FROM users WHERE id=?',[buyer])).balance,0);
 assert.equal((await db.get('SELECT remain FROM events WHERE id=?',[event])).remain,0);
 const ticket=await db.get('SELECT * FROM tickets WHERE event=?',[event]);
 const w=Math.floor(Date.now()/20000),sig=crypto.createHmac('sha256',process.env.SECRET).update(`${ticket.id}|${buyer}|${w}`).digest('hex');
 const token=`AVATIX|${ticket.id}|${buyer}|${w}|${sig}`;
 const scans=await Promise.all([call('scan',{token},organizer),call('scan',{token},organizer)]);
 assert.deepEqual(scans.map(x=>x.status).sort(),[200,400]);
 const cancels=await Promise.all([call(`events/${event}/cancel`,{},organizer),call(`events/${event}/cancel`,{},organizer)]);
 assert.deepEqual(cancels.map(x=>x.status).sort(),[200,400]);
 assert.equal((await db.get('SELECT balance FROM users WHERE id=?',[buyer])).balance,100000);
 await db.run("UPDATE events SET date='2020-01-01',status='active',remain=1 WHERE id=?",[event]);
 assert.equal((await call('buy',{event},customer)).status,400);
 await assert.rejects(db.transaction(async()=>{await db.run('UPDATE users SET balance=7 WHERE id=?',[buyer]);throw Error('rollback');}));
 assert.equal((await db.get('SELECT balance FROM users WHERE id=?',[buyer])).balance,100000);
 }finally{await new Promise(r=>server.close(r));}
});

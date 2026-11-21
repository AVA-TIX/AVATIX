const {test}=require('node:test'),assert=require('node:assert/strict');const {selectHot}=require('../public/event-carousel');
test('top five use sold tickets, exclude ended, cancelled and sold-out shows',()=>{
 const events=Array.from({length:7},(_,i)=>({id:i+1,date:'2099-01-01',remain:20,sold:i,status:'active'}));
 events.push({id:90,date:'2020-01-01',remain:20,sold:999},{id:91,date:'2099-01-01',remain:0,sold:999},{id:92,date:'2099-01-01',remain:20,sold:999,status:'cancelled'});
 assert.deepEqual(selectHot(events,'2026-11-21').map(e=>e.id),[7,6,5,4,3]);assert.equal(events[0].id,1);assert.deepEqual(selectHot([]),[]);assert.equal(selectHot(events.slice(0,1)).length,1);
});

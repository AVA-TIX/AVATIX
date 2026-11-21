// Durable outbox: database commits a business operation and its chain job together.
// Submitted/uncertain jobs are NEVER automatically resent: a timeout may still mine.
module.exports = (db, chain) => {
  const methods = ['onBuyPrimary','onListResale','onUnlistResale','onBuyResale','onScanTicket'];
  const original = Object.fromEntries(methods.map(name=>[name,chain[name].bind(chain)]));
  const ready = db.run(`CREATE TABLE IF NOT EXISTS chain_jobs(
    id INTEGER PRIMARY KEY, ticket_id INTEGER NOT NULL, action TEXT NOT NULL,
    args TEXT NOT NULL, state TEXT NOT NULL DEFAULT 'queued', tx_hash TEXT,
    error TEXT, created_at TEXT DEFAULT CURRENT_TIMESTAMP)`);
  for (const action of methods) chain[action] = async (...args) => {
    if (!chain.isEnabled()) return null;
    await ready;
    const ticketId = action === 'onBuyPrimary' ? args[0] : args.pop();
    await db.run('INSERT INTO chain_jobs(ticket_id,action,args) VALUES(?,?,?)',[ticketId,action,JSON.stringify(args)]);
    return null;
  };
  let busy = false;
  const tick = async () => {
    if (busy || !chain.isEnabled()) return;
    busy = true;
    try {
      await ready;
      const job = await db.get("SELECT * FROM chain_jobs WHERE state='queued' ORDER BY id LIMIT 1");
      if (!job) return;
      const earlier = await db.get("SELECT id FROM chain_jobs WHERE ticket_id=? AND id<? AND state!='confirmed' LIMIT 1",[job.ticket_id,job.id]);
      if (earlier) { await db.run("UPDATE chain_jobs SET state='blocked',error='Giao dịch trước cần đối soát' WHERE id=?",[job.id]); return; }
      const claimed = await db.run("UPDATE chain_jobs SET state='processing' WHERE id=? AND state='queued'",[job.id]);
      if (!claimed.rowsAffected) return;
      const ticket = await db.get('SELECT * FROM tickets WHERE id=?',[job.ticket_id]);
      const args = JSON.parse(job.args);
      if (job.action !== 'onBuyPrimary') {
        if (!ticket?.token_id) {
          await db.run("UPDATE chain_jobs SET state='blocked',error='Mint chưa xác nhận; cần đối soát trước khi tiếp tục' WHERE id=?",[job.id]);
          return;
        }
        args[0] = ticket.token_id;
      }
      chain.setTransactionObserver(async hash => db.run("UPDATE chain_jobs SET state='submitted',tx_hash=? WHERE id=?",[hash,job.id]));
      const result = await original[job.action](...args);
      if (!result) {
        await db.run("UPDATE chain_jobs SET state='uncertain',error='Chưa xác nhận được kết quả; kiểm tra tx_hash, không gửi lại tự động' WHERE id=?",[job.id]);
        return;
      }
      await db.transaction(async () => {
        if (job.action === 'onBuyPrimary') await db.run('UPDATE tickets SET token_id=?,tx_hash=?,contract_addr=? WHERE id=?',[result.tokenId,result.txHash,chain.getStatus().avaTicketAddress,job.ticket_id]);
        else await db.run('UPDATE tickets SET tx_hash=? WHERE id=?',[result.txHash,job.ticket_id]);
        await db.run("UPDATE chain_jobs SET state='confirmed',tx_hash=?,error=NULL WHERE id=?",[result.txHash,job.id]);
      });
    } catch(error) { console.error('[Chain outbox]',error.message); }
    finally { chain.setTransactionObserver(null); busy=false; }
  };
  const timer=setInterval(tick,1500); timer.unref();
  return { tick, stop: () => clearInterval(timer) };
};

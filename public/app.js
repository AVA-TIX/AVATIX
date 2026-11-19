const $=s=>document.querySelector(s),esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const dots=n=>String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g,'.'),vnd=n=>dots(n)+'đ',dmy=d=>d.split('-').reverse().join('/'),num=v=>parseInt(String(v).replace(/\D/g,''))||0;
const shortHash=h=>h?h.slice(0,8)+'…'+h.slice(-6):'';
const money=i=>{const n=num(i.value);i.value=n?dots(n):''};
async function api(u,b){
  const r=await fetch('/api/'+u,b===undefined?{}:{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(b)});
  const d=await r.json().catch(()=>({}));
  if(!r.ok){
    if(r.status===401 && !location.pathname.endsWith('login.html')){
      setTimeout(()=>{ alert(d.e || 'Phiên đăng nhập đã hết hạn'); location.href='login.html'; }, 50);
    }
    throw Object.assign(new Error(d.e||'Có lỗi xảy ra'),{st:r.status});
  }
  return d;
}
function toast(t,bad){const e=document.createElement('div');e.id='toast';e.className=bad?'bad':'';e.textContent=t;document.body.append(e);setTimeout(()=>e.remove(),3600)}
function openModal(h){$('#m').innerHTML='<div class="mb">'+h+'</div>';$('#m').hidden=false}
function closeModal(){$('#m').hidden=true;$('#m').innerHTML='';clearInterval(window.tm)}
function openTermsModal(){
  let tm = $('#termsModal');
  if(!tm){
    document.body.insertAdjacentHTML('beforeend', `<div id=termsModal hidden role=dialog aria-modal=true aria-label="Điều khoản và Chính sách AVA-TIX">
      <div class=terms-box>
        <div class=terms-head>
          <h2>Điều khoản &amp; Chính sách AVA-TIX</h2>
          <button type=button class=modal-x onclick=closeTermsModal() aria-label="Đóng" title="Đóng">✕</button>
        </div>
        <div class=terms-body>
          <h3>1. Mua vé &amp; Thanh toán</h3>
          <p>Mỗi lượt mua tương ứng 1 vé, thanh toán trừ trực tiếp từ số dư ví khả dụng và yêu cầu xác thực OTP Email. Khi sự kiện hết vé (SOLD OUT), tính năng mua vé sơ cấp sẽ tự động khóa.</p>
          <h3>2. Phí nền tảng</h3>
          <p>AVA-TIX thu phí sàn 5% trên mỗi giao dịch (bán sơ cấp và bán lại trên chợ thứ cấp). Không thu thêm phí bản quyền ẩn.</p>
          <h3>3. Quy định chống phe vé &amp; chống gom vé</h3>
          <p>Giá bán lại trên chợ thứ cấp không được vượt quá <b>giá gốc + 10%</b>. Hệ thống và Smart Contract từ chối mọi giao dịch niêm yết vượt trần hoặc vượt quá giới hạn vé/tài khoản do Ban tổ chức quy định.</p>
          <h3>4. Mã QR động vào cổng</h3>
          <p>Mã QR tự động đổi mỗi 20 giây và gắn với chủ sở hữu hiện tại. Ảnh chụp màn hình hoặc vé đã sang nhượng đều không còn hiệu lực. Vé đã check-in không thể bán lại.</p>
          <h3>5. Hủy sự kiện &amp; Hoàn tiền 100%</h3>
          <p>Trường hợp Ban tổ chức hủy show, hệ thống tự động hoàn trả <b>100% tiền vé</b> về ví của khán giả đang sở hữu vé và vô hiệu hóa vé tương ứng.</p>
          <h3>6. Trách nhiệm Nhà cung cấp (BTC)</h3>
          <p>Nhà cung cấp phải cung cấp CCCD 12 số hợp lệ để xác minh danh tính và chịu hoàn toàn trách nhiệm về tính chính xác của thông tin sự kiện đã đăng.</p>
          <h3>7. Bảo mật &amp; Dữ liệu cá nhân</h3>
          <p>Thông tin tài khoản chỉ phục vụ vận hành dịch vụ, xác thực OTP và bảo vệ phiên đăng nhập kép (tối đa 1 PC + 1 Điện thoại cùng lúc).</p>
        </div>
        <div class=terms-foot>
          <button type=button class="btn sm" onclick=closeTermsModal()>Đóng</button>
        </div>
      </div>
    </div>`);
    tm = $('#termsModal');
    tm.onclick = e => { if(e.target === tm) closeTermsModal(); };
  }
  tm.hidden = false;
}
function closeTermsModal(){
  const tm = $('#termsModal');
  if(tm) tm.hidden = true;
}
document.addEventListener('keydown', e => {
  if(e.key === 'Escape'){
    const tm = $('#termsModal');
    if(tm && !tm.hidden) closeTermsModal();
  }
});
function txHtml(txHash,url){
  if(!txHash)return '<span class=note>Off-chain</span>';
  const s=esc(shortHash(txHash));
  return url?`<a href="${esc(url)}" target=_blank rel=noopener class=mono title="${esc(txHash)}">${s} ↗</a>`:`<span class="badge nft mono" title="${esc(txHash)}">${s}</span>`;
}
function showChainInfo(){
  const me=window.me||{};const c=me.chain||{};
  const link=(addr,url)=>addr?(url?`<a href="${esc(url)}" target=_blank rel=noopener class=mono>${esc(addr)} ↗</a>`:`<span class=mono>${esc(addr)}</span>`):'<i>Chưa deploy</i>';
  openModal(`<h2>Trạng thái Smart Contract</h2>
    <table class=info>
      <tr><th>Mạng</th><td><b>${esc(c.networkName||'Off-chain')}</b>${c.chainId?` (Chain ID: ${c.chainId})`:''}</td></tr>
      <tr><th>Trạng thái</th><td>${c.enabled?'<span class="badge nft">Đã kết nối On-chain</span>':'<span class="badge out">Off-chain fallback</span>'}</td></tr>
      <tr><th>Ví của bạn</th><td class=mono>${esc(me.wallet||'—')}</td></tr>
      <tr><th>AvaTicket NFT</th><td>${link(c.avaTicketAddress,c.avaTicketExplorer)}</td></tr>
      <tr><th>Marketplace</th><td>${link(c.marketplaceAddress,c.marketplaceExplorer)}</td></tr>
      <tr><th>Relayer (Gasless)</th><td class=mono>${esc(c.relayerAddress||'—')}</td></tr>
    </table>
    <p class=note>Mô hình Relayer: mọi giao dịch mua vé, bán lại và check-in được ghi nhận lên smart contract mà bạn không cần trả phí gas.</p>
    <div class=row><button class="btn ghost" onclick=closeModal()>Đóng</button></div>`);
}
function qr(id){
  openModal(`<h2>Mã QR vào cổng</h2>
    <div class=qrbox id=qb><div style="padding:22px;color:var(--text-muted)">⏳ Đang tạo mã QR động...</div></div>
    <p class="note" id=cd style="text-align:center"></p>
    <div class=row><input id=qt readonly class=mono style="flex:1"><button class="btn sm ghost" id=cp>Copy mã</button></div>
    <p class=note>Mã tự đổi mỗi 20 giây. Ảnh chụp màn hình sẽ hết hạn.</p>
    <div class=row><button class="btn ghost" onclick=closeModal()>Đóng</button></div>`);
  const cp = $('#cp');
  if(cp) cp.onclick = () => { navigator.clipboard?.writeText($('#qt')?.value || ''); toast('Đã copy mã QR!'); };

  const g = async () => {
    try {
      const r = await api('qr/' + id);
      const qb = $('#qb'); if(!qb) return;
      qb.innerHTML = r.svg;
      if($('#qt')) $('#qt').value = r.token;
      let s = r.left;
      clearInterval(window.tm);
      window.tm = setInterval(() => {
        if(!$('#cd')) return clearInterval(window.tm);
        $('#cd').textContent = 'Đổi mã sau ' + s + ' giây';
        if(--s < 0) g();
      }, 1000);
    } catch(e) {
      const qb = $('#qb');
      if(qb) {
        qb.innerHTML = `<div style="padding:22px 14px;text-align:center">
          <div style="font-size:36px;margin-bottom:8px">⚠️</div>
          <div style="font-weight:700;color:#dc2626;font-size:15px;margin-bottom:6px">Không thể tạo mã QR</div>
          <div class="note" style="color:var(--text);font-size:13.5px">${esc(e.message)}</div>
        </div>`;
      }
      if($('#cd')) $('#cd').textContent = '';
      toast(e.message, 1);
    }
  };
  g();
}
function renderHistory(rows){
  const labels={topup:'💰 Nạp tiền',buy:'🎟️ Mua vé',sale:'💵 Bán vé',list:'🔄 Đăng bán lại',scan:'📷 Soát vé',refund:'↩️ Hoàn tiền',verify_email:'✉️ Xác thực Email',security:'🔐 Bảo mật / Đổi MK'};
  if(!rows.length)return '<div class="card empty">Chưa có giao dịch nào trong lịch sử.</div>';
  
  const desktopTable = `<div class="card tbl-wrap hist-desktop"><table class=hist>
    <thead><tr><th>Thời gian</th><th>Loại giao dịch</th><th>Số tiền</th><th>Chi tiết</th><th>Minh chứng On-chain</th></tr></thead>
    <tbody>${rows.map(tx=>`<tr>
      <td>${esc(tx.at)}</td>
      <td><span class=badge>${esc(labels[tx.type]||tx.type)}</span></td>
      <td><b style="color:${tx.amount>0?'#059669':tx.amount<0?'#dc2626':'inherit'}">${tx.amount>0?'+'+vnd(tx.amount):tx.amount<0?'-'+vnd(Math.abs(tx.amount)):'—'}</b></td>
      <td>${esc(tx.note)}</td>
      <td>${txHtml(tx.tx_hash,tx.explorerUrl)}</td>
    </tr>`).join('')}</tbody>
  </table></div>`;

  const mobileCards = `<div class="hist-mobile">${rows.map(tx=>{
    const isPlus = tx.amount > 0;
    const isMinus = tx.amount < 0;
    const amtColor = isPlus ? '#059669' : isMinus ? '#dc2626' : 'var(--text-muted)';
    const amtText = isPlus ? '+'+vnd(tx.amount) : isMinus ? '-'+vnd(Math.abs(tx.amount)) : '—';
    return `<div class="hist-card">
      <div class="hist-card-head">
        <span class="badge" style="font-size:12px">${esc(labels[tx.type]||tx.type)}</span>
        <span class="hist-card-amt" style="color:${amtColor};font-weight:800;font-size:15px">${amtText}</span>
      </div>
      <div class="hist-card-body">${esc(tx.note)}</div>
      <div class="hist-card-foot">
        <span class="hist-card-time">🕒 ${esc(tx.at)}</span>
        <div class="hist-card-tx">${txHtml(tx.tx_hash,tx.explorerUrl)}</div>
      </div>
    </div>`;
  }).join('')}</div>`;

  return desktopTable + mobileCards;
}
function renderTop(me,role){
  const c=me.chain||{};
  const pill=c.enabled?`⛓️ ${esc(c.networkName)}`:'⛓️ Off-chain';
  const secBtn=me.emailVerified
    ?`<button class="chain-pill on top-sec-btn" onclick=openSecurityModal() title="Email đã xác thực · Đổi mật khẩu"><span class=sec-icon>🛡️</span><span class=sec-text> Bảo mật</span></button>`
    :`<button class="chain-pill warn top-sec-btn" onclick=openSecurityModal() title="Xác thực email & Đổi mật khẩu"><span class=sec-icon>⚠️</span><span class=sec-text> Xác thực</span></button>`;
  const firstLetter = (me.username || 'U')[0].toUpperCase();
  const roleBadge = role === 'organizer' ? 'ORGANIZER' : 'WEB3';
  const roleLabel = role === 'customer' ? 'Khách' : 'BTC';

  $('#top').innerHTML=`
    <div class="top-row-1">
      <div class="top-brand">
        <div class="logo" onclick="location.reload()">
          <span>AVA</span>-TIX <small>${roleBadge}</small>
        </div>
        <button class="chain-pill ${c.enabled?'on':'off'}" onclick="showChainInfo()" title="Xem thông tin Smart Contract Avalanche">${pill}</button>
      </div>
      <div class="top-quick-actions">
        ${secBtn}
        <button class="btn ghost sm btn-logout" onclick="logout()" title="Đăng xuất">Đăng xuất</button>
      </div>
    </div>
    <div class="top-row-2">
      <div class="top-user" title="Tài khoản ${role==='customer'?'Khách hàng':'Nhà tổ chức'}">
        <span class="avatar">${firstLetter}</span>
        <span class="top-user-name"><b>${esc(me.username)}</b> <small style="color:#64748b">(${roleLabel})</small></span>
      </div>
      <div class="top-wallet">
        <div class="bal" onclick="topup()" title="Bấm để nạp tiền"><span>💰</span> <span class="bal-label">Ví: </span><span id="bal"></span></div>
        <button class="btn green sm btn-topup" onclick="topup()">+ <span class="topup-text">Nạp tiền</span></button>
      </div>
    </div>`;
  setBal(me);
}
function openSecurityModal(){
  const me=window.me||{};
  const role=me.role;
  const devName = me.currentDevice === 'mobile' ? '📱 Điện thoại di động' : '💻 Máy tính (PC / Laptop)';
  const activeSess = me.activeSessions || {};
  const activeList = [
    activeSess.desktop ? '💻 1 Máy tính' : null,
    activeSess.mobile  ? '📱 1 Điện thoại' : null
  ].filter(Boolean).join(' + ') || '1 thiết bị';

  openModal(`<h2>Tài khoản &amp; Bảo mật</h2>
    <table class=info>
      <tr><th>Tên đăng nhập</th><td><b>${esc(me.username)}</b></td></tr>
      <tr><th>Email</th><td>${esc(me.email)} ${me.emailVerified?'<span class="badge nft">Đã xác thực</span>':'<span class="badge out">Chưa xác thực</span>'}</td></tr>
      <tr><th>Thiết bị này</th><td><b>${devName}</b></td></tr>
      <tr><th>Bảo vệ phiên</th><td><span class="badge ok">1 PC + 1 Mobile song song</span></td></tr>
      <tr><th>Phiên đang mở</th><td><span style="font-weight:600;color:var(--tb-green)">${esc(activeList)}</span></td></tr>
    </table>
    <p class="note" style="margin:10px 0 14px;background:rgba(0,177,79,0.06);padding:10px 14px;border-radius:10px;border:1px solid rgba(0,177,79,0.2)">
      💡 <b>Cơ chế chống gian lận &amp; chia sẻ tài khoản:</b> Hệ thống cho phép duy nhất <b>1 phiên PC</b> và <b>1 phiên Điện thoại</b> cùng lúc. Nếu có thiết bị thứ 2 cùng loại đăng nhập, thiết bị cũ sẽ tự động đăng xuất ngay lập tức để bảo vệ vé của bạn.
    </p>
    ${me.emailVerified?'':`
      <div class=sec-box>
        <h3>1. Xác thực Email</h3>
        <p class=note>Cần xác thực email trước khi đổi mật khẩu hoặc khôi phục tài khoản.</p>
        <div id=evBox></div>
        <div class=row>
          <button class="btn sm" id=evSend>Gửi mã OTP</button>
          <input id=evCode inputmode=numeric maxlength=6 placeholder="Nhập OTP 6 số" style="flex:1">
          <button class="btn sm" id=evOk>Xác nhận</button>
        </div>
      </div>`}
    <div class=sec-box>
      <h3>${me.emailVerified?'Đổi mật khẩu':'2. Đổi mật khẩu'}</h3>
      ${me.emailVerified?`
        <p class=note>Bắt buộc xác thực cả <b>Mật khẩu hiện tại</b> và <b>Mã OTP gửi về Email</b>.</p>
        <label>Mật khẩu hiện tại</label><input id=cpOld type=password autocomplete=current-password>
        <div id=cpBox></div>
        <div class=row style="margin-top:10px">
          <button class="btn sm ghost" id=cpSend>Gửi OTP xác nhận</button>
          <input id=cpCode inputmode=numeric maxlength=6 placeholder="Mã OTP 6 số" style="flex:1">
        </div>
        <label>Mật khẩu mới (≥ 8 ký tự, 1 chữ hoa, 1 số)</label><input id=cpNew type=password autocomplete=new-password>
        <label>Xác nhận mật khẩu mới</label><input id=cpNew2 type=password autocomplete=new-password>
        <div class=row><button class="btn ghost" onclick=closeModal()>Đóng</button><button class=btn id=cpOk>Đổi mật khẩu</button></div>
      `:`
        <p class=note err>🔒 Vui lòng xác thực Email ở trên trước khi đổi mật khẩu.</p>
        <div class=row><button class="btn ghost" onclick=closeModal()>Đóng</button></div>
      `}
    </div>`);

  if(!me.emailVerified){
    $('#evSend').onclick=async()=>{
      try{
        const r=await api('verify-email/request',{});
        $('#evBox').innerHTML=r.devOtp?`<div class=dev-otp><b>[Dev Mode]</b> Mã OTP mẫu: <b class=mono>${esc(r.devOtp)}</b> (hiệu lực 5 phút)</div>`:`<p class="note good">Đã gửi OTP tới ${esc(r.maskedEmail)}</p>`;
        toast('Đã gửi mã OTP xác thực email');
      }catch(e){toast(e.message,1)}
    };
    $('#evOk').onclick=async()=>{
      try{
        await api('verify-email/confirm',{code:$('#evCode').value.trim()});
        toast('Xác thực Email thành công!');
        window.me=await api('me');
        renderTop(window.me,role);
        if(typeof load==='function')load();
        openSecurityModal();
      }catch(e){toast(e.message,1)}
    };
  }else{
    $('#cpSend').onclick=async()=>{
      try{
        const r=await api('change-password/request',{currentPassword:$('#cpOld').value});
        $('#cpBox').innerHTML=r.devOtp?`<div class=dev-otp><b>[Dev Mode]</b> Mã OTP đổi MK: <b class=mono>${esc(r.devOtp)}</b></div>`:`<p class="note good">Đã gửi OTP tới ${esc(r.maskedEmail)}</p>`;
        toast('Đã gửi OTP xác nhận đổi mật khẩu');
      }catch(e){toast(e.message,1)}
    };
    $('#cpOk').onclick=async()=>{
      const np=$('#cpNew').value,np2=$('#cpNew2').value;
      if(np!==np2)return toast('Mật khẩu xác nhận không khớp',1);
      try{
        await api('change-password/confirm',{currentPassword:$('#cpOld').value,newPassword:np,code:$('#cpCode').value.trim()});
        closeModal();
        toast('Đổi mật khẩu thành công!');
        if(typeof load==='function')load();
      }catch(e){toast(e.message,1)}
    };
  }
}
async function init(role){
  document.body.insertAdjacentHTML('beforeend','<div id=m hidden></div>');
  $('#m').onclick=e=>{if(e.target.id==='m')closeModal()};
  try{
    const me=await api('me');
    if(me.role!==role){location='/'+me.role+'.html';return}
    renderTop(me,role);return me;
  }catch{location='/login.html'}
}
const setBal=m=>$('#bal').textContent=vnd(m.balance);
async function logout(){await api('logout',{});location='/login.html'}
function topup(){
  openModal(`<h2>Nạp tiền vào ví</h2><label>Số tiền (VNĐ)</label><input id=amt inputmode=numeric placeholder="Ví dụ: 500.000" oninput=money(this)><p class=note>Tối thiểu 10.000đ. Dấu chấm tự động phân tách hàng nghìn.</p>
  <label>Phương thức thanh toán</label><div class=pay>${[['momo','Ví MoMo'],['bank','Ngân hàng'],['vnpay','VNPAY'],['vietqr','VietQR']].map(([v,t],i)=>`<label class=r><input type=radio name=pm value=${v} ${i?'':'checked'}>${t}</label>`).join('')}</div>
  <div class=row><button class="btn ghost" onclick=closeModal()>Hủy</button><button class=btn id=go>Nạp tiền</button></div>`);
  $('#go').onclick=async()=>{try{await api('topup',{amount:num($('#amt').value),method:document.querySelector('[name=pm]:checked').value});closeModal();toast('Nạp tiền thành công');window.me=await api('me');setBal(window.me)}catch(e){toast(e.message,1)}};
}
function bannerTheme(name){
  const n=String(name||'').toLowerCase();
  if(n.includes('blockchain')||n.includes('web3')||n.includes('crypto'))
    return {cls:'crypto',icon:'⛓️',tag:'Web3 & Tech',fallbackImg:'https://images.unsplash.com/photo-1540575467063-178a50c2df87?auto=format&fit=crop&w=900&q=80'};
  if(n.includes('indie')||n.includes('acoustic')||n.includes('thu'))
    return {cls:'indie',icon:'🎸',tag:'Indie & Acoustic',fallbackImg:'https://images.unsplash.com/photo-1511671782779-c97d3d27a1d4?auto=format&fit=crop&w=900&q=80'};
  return {cls:'music',icon:'🎵',tag:'Live Concert',fallbackImg:'https://images.unsplash.com/photo-1470225620780-dba8ba36b745?auto=format&fit=crop&w=900&q=80'};
}
function getEventImg(item){
  if(item && item.image && item.image.trim()) return item.image.trim();
  return bannerTheme(item ? item.name : '').fallbackImg;
}
function parseDateBadge(dStr){
  if(!dStr)return{m:'THG --',d:'--'};
  const parts=dStr.split('-');
  if(parts.length===3) return {m:`THG ${parseInt(parts[1],10)}`,d:parts[2]};
  return{m:'THG --',d:'--'};
}

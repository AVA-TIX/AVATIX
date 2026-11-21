const $=s=>document.querySelector(s),esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const dots=n=>String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g,'.'),vnd=n=>dots(n)+'đ',dmy=d=>d.split('-').reverse().join('/'),num=v=>parseInt(String(v).replace(/\D/g,''))||0;
const shortHash=h=>h?h.slice(0,8)+'…'+h.slice(-6):'';
const money=i=>{const n=num(i.value);i.value=n?dots(n):''};
async function api(u,b,headers={}){
  const r=await fetch('/api/'+u,b===undefined?{headers}:{method:'POST',headers:{'Content-Type':'application/json',...headers},body:JSON.stringify(b)});
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
let modalCleanup=null,modalReturnFocus=null;
function openModal(h){
  if(modalCleanup){modalCleanup();modalCleanup=null}
  if($('#m').hidden)modalReturnFocus=document.activeElement;
  $('#m').innerHTML='<div class="mb" role="dialog" aria-modal="true" aria-label="'+(h.match(/<h2[^>]*>([^<]+)/)?.[1]||'AVA-TIX')+'" tabindex="-1">'+h+'</div>';
  $('#m').hidden=false;
  $('#m .mb').focus();
  mountPasswordEyes($('#m'));
}
function closeModal(){
  if($('#m .mb')?.dataset.required==='true')return;
  if(modalCleanup){modalCleanup();modalCleanup=null}
  $('#m').hidden=true;$('#m').innerHTML='';clearInterval(window.tm);
  if(modalReturnFocus?.isConnected)modalReturnFocus.focus();
}
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
  if($('.pin-layer'))return;
  if(e.key === 'Escape'){
    const tm = $('#termsModal');
    if(tm && !tm.hidden) closeTermsModal();
    else if($('#m')&&!$('#m').hidden)closeModal();
    else closeNavigation();
  }
  const dialog=$('#m:not([hidden]) .mb');
  if(e.key==='Tab'&&dialog){
    const items=[...dialog.querySelectorAll('button:not([disabled]),input:not([disabled]),a[href],select,[tabindex="0"]')].filter(el=>el.getClientRects().length);
    if(!items.length){e.preventDefault();return}
    if(e.shiftKey&&(document.activeElement===items[0]||document.activeElement===dialog)){e.preventDefault();items.at(-1).focus()}
    else if(!e.shiftKey&&(document.activeElement===items.at(-1)||document.activeElement===dialog)){e.preventDefault();items[0].focus()}
  }
});
function txHtml(txHash,url,state){
  if(!txHash){const labels={queued:'Đang chờ ghi nhận',processing:'Đang xử lý',submitted:'Đang chờ xác nhận',uncertain:'Cần kiểm tra xác nhận',blocked:'Chờ đối soát'};return '<span class=note>'+esc(labels[state]||'Chưa có minh chứng on-chain')+'</span>';}
  const s=esc(shortHash(txHash));
  return url?`<a href="${esc(url)}" target=_blank rel=noopener class=mono title="${esc(txHash)}">${s} </a>`:`<span class="badge nft mono" title="${esc(txHash)}">${s}</span>`;
}
function showChainInfo(){
  const me=window.me||{};const c=me.chain||{};
  const link=(addr,url)=>addr?(url?`<a href="${esc(url)}" target=_blank rel=noopener class=mono>${esc(addr)} </a>`:`<span class=mono>${esc(addr)}</span>`):'<i>Chưa deploy</i>';
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
async function qr(id){
  if(!window.me.pinConfigured){openPinSettings(()=>qr(id));return}
  const unlocked=await askPin({title:'Mở mã QR của vé',description:'Nhập mã bảo mật 6 số của bạn để xem vé. Mã QR sẽ được khóa lại khi bạn đóng cửa sổ.',verify:pin=>api('qr/'+id+'/unlock',{pin})});
  if(!unlocked)return;
  const unlockToken=unlocked.unlockToken;
  openModal(`<h2>Mã QR vào cổng</h2>
    <div class=qrbox id=qb><p class=qr-message>Đang tạo mã QR động...</p></div>
    <p class="note" id=cd style="text-align:center"></p>
    <div class="row qr-token-row"><input id=qt readonly class=mono aria-label="Nội dung mã QR"><button class="btn sm ghost" id=cp>Copy mã</button></div>
    <p class=note>Mã tự đổi mỗi 20 giây. Ảnh chụp màn hình sẽ hết hạn.</p>
    <div class=row><button class="btn ghost" onclick=closeModal()>Đóng</button></div>`);
  const cp = $('#cp');
  if(cp) cp.onclick = () => { navigator.clipboard?.writeText($('#qt')?.value || ''); toast('Đã copy mã QR!'); };

  const g = async () => {
    const target=$('#qb');if(!target)return;
    try {
      const r = await api('qr/' + id,undefined,{'X-Ticket-Unlock':unlockToken});
      const qb = $('#qb'); if(qb!==target) return;
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
      if($('#qb')!==target)return;
      const qb = $('#qb');
      if(qb) {
        qb.innerHTML = `<div style="padding:22px 14px;text-align:center">
          <div style="font-size:36px;margin-bottom:8px"></div>
          <div class=qr-message><b>Không thể tạo mã QR</b><p>${esc(e.message)}</p></div>
        </div>`;
      }
      if($('#cd')) $('#cd').textContent = '';
      clearInterval(window.tm);
      if(e.st===403){$('#qb').innerHTML='<div class=qr-message><p>Vé đã được khóa lại để bảo vệ tài khoản.</p><button class=btn id=reopenQr>Mở khóa lại</button></div>';$('#reopenQr').onclick=()=>qr(id)}
      toast(e.message, 1);
    }
  };
  g();
}
function renderHistory(rows){
  const labels={topup:' Nạp tiền',buy:' Mua vé',sale:' Bán vé',list:' Đăng bán lại',scan:' Soát vé',refund:' Hoàn tiền',verify_email:' Xác thực Email',security:' Bảo mật / Đổi MK'};
  if(!rows.length)return '<div class="card empty">Chưa có giao dịch nào trong lịch sử.</div>';
  
  const desktopTable = `<div class="card tbl-wrap hist-desktop"><table class=hist>
    <thead><tr><th>Thời gian</th><th>Loại giao dịch</th><th>Số tiền</th><th>Chi tiết</th><th>Minh chứng On-chain</th></tr></thead>
    <tbody>${rows.map(tx=>`<tr>
      <td>${esc(tx.at)}</td>
      <td><span class=badge>${esc(labels[tx.type]||tx.type)}</span></td>
      <td><b style="color:${tx.amount>0?'var(--positive)':tx.amount<0?'var(--negative)':'inherit'}">${tx.amount>0?'+'+vnd(tx.amount):tx.amount<0?'-'+vnd(Math.abs(tx.amount)):'—'}</b></td>
      <td>${esc(tx.note)}</td>
      <td>${txHtml(tx.tx_hash,tx.explorerUrl,tx.chain_state)}</td>
    </tr>`).join('')}</tbody>
  </table></div>`;

  const mobileCards = `<div class="hist-mobile">${rows.map(tx=>{
    const isPlus = tx.amount > 0;
    const isMinus = tx.amount < 0;
    const amtColor = isPlus ? 'var(--positive)' : isMinus ? 'var(--negative)' : 'var(--text-muted)';
    const amtText = isPlus ? '+'+vnd(tx.amount) : isMinus ? '-'+vnd(Math.abs(tx.amount)) : '—';
    return `<div class="hist-card">
      <div class="hist-card-head">
        <span class="badge" style="font-size:12px">${esc(labels[tx.type]||tx.type)}</span>
        <span class="hist-card-amt" style="color:${amtColor};font-weight:800;font-size:15px">${amtText}</span>
      </div>
      <div class="hist-card-body">${esc(tx.note)}</div>
      <div class="hist-card-foot">
        <span class="hist-card-time"> ${esc(tx.at)}</span>
        <div class="hist-card-tx">${txHtml(tx.tx_hash,tx.explorerUrl,tx.chain_state)}</div>
      </div>
    </div>`;
  }).join('')}</div>`;

  return desktopTable + mobileCards;
}
function renderTop(me,role){
  const c=me.chain||{};
  const pill=c.enabled?(c.chainId===43113?'⛓️ Avalanche Fuji':'⛓️ '+esc(c.networkName)):'⛓️ Off-chain';
  const links=role==='customer'
    ?[['open','Khám phá sự kiện'],['mine','Vé của tôi'],['market','Chợ vé'],['history','Lịch sử on-chain']]
    :role==='organizer'
      ?[['stats','Sự kiện của tôi'],['create','Tạo sự kiện'],['scan','Soát vé'],['history','Lịch sử on-chain']]
      :[['overview','Tổng quan sàn'],['users','Users & BTC'],['events','Tất cả Show diễn']];
  const caption=role==='customer'?'Vé cho những cuộc hẹn hay.':role==='organizer'?'Dành cho nhà tổ chức':'Quản trị hệ thống';
  const roleName=role==='customer'?'Khách hàng':role==='organizer'?'Nhà tổ chức':'Quản trị viên (Admin)';
  $('#top').innerHTML=`
    <div class="top-brand"><a class="logo" href="/${role}.html" aria-label="AVA-TIX — Trang chủ"><img class="brand-logo-icon" src="logo-icon.svg" alt="" width="34" height="24"><span>AVA</span>-TIX</a><span class="brand-caption">${caption}</span><button type="button" class="chain-pill ${c.enabled?'on':'off'}" onclick="showChainInfo()" title="Xem trạng thái Smart Contract Avalanche">${pill}</button></div>
    ${role==='admin'?'':`<div class="top-wallet"><span class="bal"><span class="bal-label">Số dư:</span> <b id="bal"></b></span><button class="btn sm btn-topup" onclick="topup()">Nạp tiền</button></div>`}
    <button class="account-shortcut" onclick="openSecurityModal()" aria-label="Tài khoản của ${esc(me.username)}">${avatarHtml(me)}<span>${esc(me.username)}</span></button>
    <div class="site-nav"><button class="menu-toggle" id="menuToggle" type="button" aria-label="Mở menu" aria-expanded="false" aria-controls="accountMenu" onclick="toggleNavigation()"><span class="hamburger" aria-hidden="true"><i></i><i></i><i></i></span><span>Menu</span></button>
      <nav class="menu-panel" id="accountMenu" aria-label="Điều hướng tài khoản" hidden>
        <div class="menu-user">${avatarHtml(me)}<div><b>${esc(me.username)}</b><span>${roleName}</span></div></div>
        <button class="menu-link" onclick="navigateAccount()">Tài khoản</button>
        ${links.map(([key,label])=>`<button class="menu-link" data-section="${key}" onclick="selectNavigation('${key}')">${label}</button>`).join('')}
        <button class="menu-link" onclick="closeNavigation(false);showChainInfo()">Smart Contract (${c.enabled?'On-chain':'Off-chain'})</button>
        ${window.avatixTheme.controls()}
        <button class="menu-link menu-logout" onclick="logout()">Đăng xuất</button>
      </nav>
    </div>`;
  setBal(me);
  window.avatixTheme.sync();
}
function avatarHtml(user,extra=''){
  const safeAvatar=/^data:image\/(?:webp|png|jpeg);base64,[A-Za-z0-9+/=]+$/.test(user.avatar||'');
  return `<span class="avatar ${extra}">${safeAvatar?`<img src="${user.avatar}" alt="">`:esc((user.username||'U')[0].toUpperCase())}</span>`;
}
function toggleNavigation(){
  const panel=$('#accountMenu'),button=$('#menuToggle');
  if(!panel.hidden){closeNavigation();return}
  panel.hidden=false;button.setAttribute('aria-expanded','true');button.setAttribute('aria-label','Đóng menu');
  panel.querySelector('button').focus();
}
function closeNavigation(returnFocus=true){
  const panel=$('#accountMenu'),button=$('#menuToggle');
  if(!panel||panel.hidden)return;
  panel.hidden=true;button.setAttribute('aria-expanded','false');button.setAttribute('aria-label','Mở menu');
  if(returnFocus)button.focus();
}
function navigateAccount(){closeNavigation();openSecurityModal()}
function selectNavigation(section){closeNavigation();window.navigateSection?.(section)}
window.syncNavigation=section=>document.querySelectorAll('[data-section]').forEach(el=>{
  if(el.dataset.section===section)el.setAttribute('aria-current','page');else el.removeAttribute('aria-current');
});
document.addEventListener('click',e=>{if(!e.target.closest('.site-nav'))closeNavigation(false)});
document.addEventListener('focusin',e=>{if(!e.target.closest('.site-nav'))closeNavigation(false)});
document.addEventListener('keydown',e=>{
  const panel=$('#accountMenu');if(!panel||panel.hidden)return;
  const links=[...panel.querySelectorAll('button')],index=links.indexOf(document.activeElement);
  if(e.key==='ArrowDown'||e.key==='ArrowUp'){e.preventDefault();links[(index+(e.key==='ArrowDown'?1:links.length-1))%links.length].focus()}
  if(e.key==='Home'){e.preventDefault();links[0].focus()}
  if(e.key==='End'){e.preventDefault();links.at(-1).focus()}
});
async function init(role){
  document.body.insertAdjacentHTML('beforeend','<div id=m hidden></div>');
  $('#m').onclick=e=>{if(e.target.id==='m')closeModal()};
  try{
    const me=await api('me');
    if(me.role!==role){location='/'+me.role+'.html';return}
    window.me=me;renderTop(me,role);
    return me;
  }catch{location='/login.html'}
}
const setBal=m=>{if($('#bal'))$('#bal').textContent=vnd(m.balance)};
async function logout(){await api('logout',{});location='/login.html'}
function openAvatarEditor(){
  openModal(`<h2>Ảnh đại diện</h2><p class="note">Chọn ảnh từ thiết bị, kéo để căn vị trí và điều chỉnh độ phóng trước khi lưu.</p>
    <label class="avatar-file-label" for="avatarFile">Chọn ảnh từ thiết bị</label>
    <input id="avatarFile" class="avatar-file" type="file" accept="image/*,.heic,.heif,.tif,.tiff,.avif,.bmp,.ico">
    <p class="note avatar-formats">JPG, PNG, WebP, GIF, AVIF, SVG, BMP, HEIC/HEIF, TIFF · Tối đa 8 MB. Ảnh động dùng một khung hình.</p>
    <div id="avatarStatus" class="note" role="status" aria-live="polite">Chưa chọn ảnh.</div>
    <div id="avatarControls" hidden>
      <div class="avatar-crop"><canvas id="avatarCanvas" width="512" height="512" tabindex="0" aria-label="Khung cắt ảnh vuông. Kéo ảnh hoặc dùng các phím mũi tên để căn vị trí."></canvas><span class="avatar-crop-guide" aria-hidden="true"></span></div>
      <label for="avatarZoom">Phóng to / thu nhỏ <output id="avatarZoomValue" for="avatarZoom">100%</output></label>
      <div class="avatar-zoom-row"><button type="button" class="btn ghost sm" id="avatarZoomOut" aria-label="Thu nhỏ ảnh">−</button><input id="avatarZoom" type="range" min="1" max="4" step="0.01" value="1"><button type="button" class="btn ghost sm" id="avatarZoomIn" aria-label="Phóng to ảnh">+</button></div>
      <p class="note">Khung tỉ lệ 1:1. Vùng tròn là phần ảnh hiển thị trên tài khoản.</p>
    </div>
    <div class="row avatar-actions"><button class="btn ghost" id="avatarCancel">Quay lại</button>${window.me.avatar?'<button class="btn ghost" id="avatarRemove">Xóa ảnh</button>':''}<button class="btn" id="avatarSave" disabled>Lưu ảnh</button></div>`);
  const canvas=$('#avatarCanvas'),ctx=canvas.getContext('2d'),fileInput=$('#avatarFile'),zoomInput=$('#avatarZoom'),save=$('#avatarSave'),status=$('#avatarStatus');
  let image=null,url=null,epoch=0,zoom=1,offsetX=0,offsetY=0,drag=null,busy=false;
  const active=()=>canvas.isConnected;
  modalCleanup=()=>{epoch++;if(url)URL.revokeObjectURL(url);image=null};
  function draw(){
    if(!image||!active())return;
    const scale=Math.max(512/image.naturalWidth,512/image.naturalHeight)*zoom,w=image.naturalWidth*scale,h=image.naturalHeight*scale;
    offsetX=Math.max(-(w-512)/2,Math.min((w-512)/2,offsetX));
    offsetY=Math.max(-(h-512)/2,Math.min((h-512)/2,offsetY));
    ctx.clearRect(0,0,512,512);ctx.fillStyle='#ffffff';ctx.fillRect(0,0,512,512);
    ctx.drawImage(image,(512-w)/2+offsetX,(512-h)/2+offsetY,w,h);
    $('#avatarZoomValue').textContent=Math.round(zoom*100)+'%';
  }
  function setZoom(value){if(busy)return;zoom=Math.max(1,Math.min(4,Number(value)));zoomInput.value=zoom;draw()}
  const readFile=file=>new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result);reader.onerror=()=>reject(new Error('Không đọc được ảnh. Hãy thử chọn lại.'));reader.readAsDataURL(file)});
  const loadImage=src=>new Promise((resolve,reject)=>{const candidate=new Image();candidate.onload=()=>resolve(candidate);candidate.onerror=()=>reject(new Error('Không đọc được định dạng ảnh này.'));candidate.src=src});
  fileInput.onchange=async()=>{
    const file=fileInput.files[0];if(!file)return;
    const ticket=++epoch;save.disabled=true;$('#avatarControls').hidden=true;image=null;
    status.className='note';status.textContent='Đang đọc ảnh…';
    try{
      if(file.size>8*1024*1024)throw new Error('Ảnh vượt quá 8 MB. Vui lòng chọn ảnh nhỏ hơn.');
      if(!file.type.startsWith('image/')&&!/\.(jpe?g|png|webp|gif|avif|svg|bmp|ico|heic|heif|tiff?)$/i.test(file.name))throw new Error('Vui lòng chọn một tệp ảnh.');
      if(url)URL.revokeObjectURL(url);url=URL.createObjectURL(file);
      let loaded;
      try{loaded=await loadImage(url)}catch{
        if(ticket!==epoch||!active())return;
        status.textContent='Đang chuyển đổi ảnh…';
        let original=await readFile(file);
        if(!file.type.startsWith('image/'))original=original.replace(/^data:[^;]*;/,'data:image/'+(/\.hei[cf]$/i.test(file.name)?'heic':/\.tiff?$/i.test(file.name)?'tiff':'octet-stream')+';');
        const prepared=await api('profile/avatar/prepare',{image:original});
        loaded=await loadImage(prepared.image);
      }
      if(ticket!==epoch||!active())return;
      if(!loaded.naturalWidth||loaded.naturalWidth*loaded.naturalHeight>40*1000*1000)throw new Error('Ảnh quá lớn. Vui lòng dùng ảnh dưới 40 megapixel.');
      image=loaded;zoom=1;offsetX=offsetY=0;zoomInput.value='1';
      $('#avatarControls').hidden=false;save.disabled=false;draw();status.textContent='Ảnh đã sẵn sàng. Căn khung rồi chọn Lưu ảnh.';
    }catch(e){if(ticket===epoch&&active()){status.textContent=e.message;status.className='note err'}}
    finally{if(ticket===epoch&&active())fileInput.value=''}
  };
  zoomInput.oninput=()=>setZoom(zoomInput.value);
  $('#avatarZoomOut').onclick=()=>setZoom(zoom-.1);$('#avatarZoomIn').onclick=()=>setZoom(zoom+.1);
  canvas.onpointerdown=e=>{if(!image||busy)return;drag={x:e.clientX,y:e.clientY};canvas.setPointerCapture(e.pointerId)};
  canvas.onpointermove=e=>{if(!drag||busy)return;const ratio=512/canvas.getBoundingClientRect().width;offsetX+=(e.clientX-drag.x)*ratio;offsetY+=(e.clientY-drag.y)*ratio;drag={x:e.clientX,y:e.clientY};draw()};
  canvas.onpointerup=canvas.onpointercancel=()=>{drag=null};
  canvas.onkeydown=e=>{
    if(!image||busy||!['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(e.key))return;
    e.preventDefault();offsetX+=e.key==='ArrowLeft'?-10:e.key==='ArrowRight'?10:0;offsetY+=e.key==='ArrowUp'?-10:e.key==='ArrowDown'?10:0;draw();
  };
  $('#avatarCancel').onclick=()=>openSecurityModal();
  async function persist(avatar){
    busy=true;save.disabled=true;fileInput.disabled=true;$('#avatarCancel').disabled=true;status.className='note';status.textContent='Đang lưu ảnh…';
    const remove=$('#avatarRemove');if(remove)remove.disabled=true;
    try{
      const result=await api('profile/avatar',{avatar});
      window.me.avatar=result.avatar;renderTop(window.me,window.me.role);
      if(typeof tab==='string')window.syncNavigation(tab);
      if(active()){openSecurityModal();toast(avatar?'Đã cập nhật ảnh đại diện':'Đã xóa ảnh đại diện')}
    }catch(e){if(active()){status.textContent=e.message;status.className='note err'}}
    finally{busy=false;if(active()){save.disabled=!image;fileInput.disabled=false;$('#avatarCancel').disabled=false;if(remove)remove.disabled=false}}
  }
  save.onclick=()=>{if(image&&!busy)persist(canvas.toDataURL('image/png'))};
  if($('#avatarRemove'))$('#avatarRemove').onclick=()=>{if(!busy)persist(null)};
}
function topup(){
  openModal(`<h2>Nạp tiền vào ví</h2><label>Số tiền (VNĐ)</label><input id=amt inputmode=numeric placeholder="Ví dụ: 500.000" oninput=money(this)><p class=note>Tối thiểu 10.000đ. Dấu chấm tự động phân tách hàng nghìn.</p>
  <label>Phương thức thanh toán</label><div class=pay>${[['momo','Ví MoMo'],['bank','Ngân hàng'],['vnpay','VNPAY'],['vietqr','VietQR']].map(([v,t],i)=>`<label class=r><input type=radio name=pm value=${v} ${i?'':'checked'}>${t}</label>`).join('')}</div>
  <div class=row><button class="btn ghost" onclick=closeModal()>Hủy</button><button class=btn id=go>Nạp tiền</button></div>`);
  $('#go').onclick=async()=>{try{await api('topup',{amount:num($('#amt').value),method:document.querySelector('[name=pm]:checked').value});closeModal();toast('Nạp tiền thành công');window.me=await api('me');setBal(window.me)}catch(e){toast(e.message,1)}};
}
function bannerTheme(name){
  const n=String(name||'').toLowerCase();
  if(n.includes('blockchain')||n.includes('web3')||n.includes('crypto'))
    return {cls:'crypto',icon:'',tag:'Web3 & Tech',fallbackImg:'https://images.unsplash.com/photo-1540575467063-178a50c2df87?auto=format&fit=crop&w=900&q=80'};
  if(n.includes('indie')||n.includes('acoustic')||n.includes('thu'))
    return {cls:'indie',icon:'',tag:'Indie & Acoustic',fallbackImg:'https://images.unsplash.com/photo-1511671782779-c97d3d27a1d4?auto=format&fit=crop&w=900&q=80'};
  return {cls:'music',icon:'',tag:'Live Concert',fallbackImg:'https://images.unsplash.com/photo-1470225620780-dba8ba36b745?auto=format&fit=crop&w=900&q=80'};
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

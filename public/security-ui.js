function ensureModal(){
  if(!document.querySelector('#m')){
    document.body.insertAdjacentHTML('beforeend','<div id=m hidden></div>');
    document.querySelector('#m').onclick=e=>{if(e.target.id==='m')closeModal()};
  }
}
function askPin({title='Xác nhận mã bảo mật',description='Nhập mã bảo mật 6 số của bạn.',verify}){
  if(document.querySelector('.pin-layer'))return Promise.resolve(null);
  const previous=document.activeElement;
  const layer=document.createElement('div');layer.className='pin-layer';
  layer.innerHTML=`<form class=pin-panel role=dialog aria-modal=true aria-labelledby=pinPromptTitle><div class=dialog-kicker>Bảo vệ tài khoản</div><h2 id=pinPromptTitle>${esc(title)}</h2><p class=note>${esc(description)}</p><label for=pinPromptCode>Mã bảo mật</label><input class=pin-entry id=pinPromptCode type=password inputmode=numeric pattern="[0-9]{6}" maxlength=6 minlength=6 autocomplete=off required><p class="note err" id=pinPromptError role=alert></p><div class=row><button type=button class="btn ghost" id=pinPromptCancel>Hủy</button><button class=btn id=pinPromptSubmit>Xác nhận</button></div></form>`;
  document.body.append(layer);const form=layer.querySelector('form'),input=layer.querySelector('input');input.focus();
  return new Promise(resolve=>{
    let busy=false;
    function finish(value){input.value='';layer.remove();if(previous?.isConnected)previous.focus();resolve(value)}
    layer.querySelector('#pinPromptCancel').onclick=()=>{if(!busy)finish(null)};
    layer.onkeydown=e=>{
      if(e.key==='Escape'){e.preventDefault();e.stopPropagation();if(!busy)finish(null)}
      if(e.key==='Tab'){
        const fields=[...form.querySelectorAll('input:not([disabled]),button:not([disabled])')];
        if(!fields.length){e.preventDefault();return}
        if(e.shiftKey&&document.activeElement===fields[0]){e.preventDefault();fields.at(-1).focus()}
        else if(!e.shiftKey&&document.activeElement===fields.at(-1)){e.preventDefault();fields[0].focus()}
      }
    };
    form.onsubmit=async e=>{
      e.preventDefault();if(busy)return;busy=true;input.disabled=true;layer.querySelector('#pinPromptSubmit').disabled=true;
      layer.querySelector('#pinPromptError').textContent='';
      try{const result=await verify(input.value);finish(result||true)}catch(error){layer.querySelector('#pinPromptError').textContent=error.message;input.value=''}
      finally{busy=false;if(layer.isConnected){input.disabled=false;layer.querySelector('#pinPromptSubmit').disabled=false;input.focus()}}
    };
  });
}
const eyeSvg='<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.7" aria-hidden="true"><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/></svg>';
function mountPasswordEyes(root=document){
  root.querySelectorAll('input[type=password]:not(.pin-entry)').forEach(input=>{
    if(input.dataset.eyeReady)return;input.dataset.eyeReady='true';
    const field=document.createElement('div');field.className='password-field';input.before(field);field.append(input);
    const button=document.createElement('button');button.type='button';button.className='password-eye';button.innerHTML=eyeSvg;button.setAttribute('aria-label','Xem mật khẩu');button.setAttribute('aria-pressed','false');field.append(button);
    let timer;
    const hide=()=>{clearTimeout(timer);input.type='password';button.setAttribute('aria-label','Xem mật khẩu');button.setAttribute('aria-pressed','false')};
    input.addEventListener('input',hide);
    button.onclick=async()=>{
      if(input.type==='text'){hide();return}
      if(!input.value){toast('Hãy nhập mật khẩu trước.',1);input.focus();return}
      const allowed=await askPin({title:'Xem mật khẩu đang nhập',description:'Nhập mã bảo mật để hiển thị mật khẩu trong 15 giây.',verify:async pin=>{
        const registering=input.closest('#fr'),setting=input.closest('#pinSettingsForm');
        if(registering||setting&&!window.me?.pinConfigured){
          const chosen=document.querySelector(registering?'#registerPin':'#pinNew').value;
          const confirmation=document.querySelector(registering?'#registerPinAgain':'#pinAgain').value;
          if(!/^\d{6}$/.test(chosen)||chosen!==confirmation)throw new Error('Hãy tạo và xác nhận mã bảo mật 6 số trước.');
          if(pin!==chosen)throw new Error('Mã bảo mật không đúng.');
          return true;
        }
        return api('security/pin/verify',{pin,identifier:window.me?.username||document.querySelector('#lu')?.value||document.querySelector('#fi')?.value});
      }});
      if(!allowed||!input.isConnected)return;
      input.type='text';button.setAttribute('aria-label','Ẩn mật khẩu');button.setAttribute('aria-pressed','true');timer=setTimeout(hide,15000);
    };
  });
}
document.addEventListener('visibilitychange',()=>{if(document.hidden)document.querySelectorAll('.password-field input[type=text]').forEach(input=>{input.type='password';const button=input.parentElement.querySelector('button');button.setAttribute('aria-label','Xem mật khẩu');button.setAttribute('aria-pressed','false')})});
document.addEventListener('DOMContentLoaded',()=>mountPasswordEyes());
async function signIn(username,password){
  let response=await api('login',{username,password});
  if(response.pinRequired){
    response=await askPin({title:'Xác thực đăng nhập',description:'Nhập mã bảo mật 6 số bạn đã tạo cho tài khoản này.',verify:pin=>api('login',{username,password,pin})});
    if(!response)return;
  }
  location='/'+response.role+'.html';
}
function pinFields(){return `<label for=pinNew>Mã bảo mật mới · 6 chữ số</label><input class=pin-entry id=pinNew type=password inputmode=numeric pattern="[0-9]{6}" minlength=6 maxlength=6 autocomplete=off required><label for=pinAgain>Nhập lại mã bảo mật</label><input class=pin-entry id=pinAgain type=password inputmode=numeric pattern="[0-9]{6}" minlength=6 maxlength=6 autocomplete=off required>`}
function openPinSettings(required=false){
  ensureModal();const configured=Boolean(window.me?.pinConfigured);
  openModal(`<div class=dialog-kicker>Bảo mật hai bước</div><h2>${configured?'Đổi mã bảo mật':'Tạo mã bảo mật của bạn'}</h2><p class=note>${configured?'Mã mới sẽ thay thế mã hiện tại và khóa lại các QR đang mở.':'Chọn 6 chữ số riêng để xác nhận đăng nhập, xem mật khẩu đang nhập và mở QR vé. Bạn cần hoàn tất bước này để sử dụng tài khoản.'}</p><form id=pinSettingsForm><label for=pinCurrentPassword>Mật khẩu tài khoản</label><input id=pinCurrentPassword type=password autocomplete=current-password required>${configured?'<label for=pinOld>Mã bảo mật hiện tại</label><input class=pin-entry id=pinOld type=password inputmode=numeric pattern="[0-9]{6}" maxlength=6 autocomplete=off required>':''}${pinFields()}<p class="note err" id=pinSettingsError role=alert></p><div class=row>${required?'<button type=button class="btn ghost" onclick=logout()>Đăng xuất</button>':'<button type=button class="btn ghost" onclick=openSecurityModal()>Quay lại</button>'}<button class=btn id=savePin>${configured?'Cập nhật mã':'Tạo mã bảo mật'}</button></div></form>`);
  $('#m .mb').dataset.required=required?'true':'false';
  $('#pinSettingsForm').onsubmit=async e=>{
    e.preventDefault();const button=$('#savePin');button.disabled=true;
    try{
      await api('security/pin/'+(configured?'change':'setup'),{currentPassword:$('#pinCurrentPassword').value,oldPin:$('#pinOld')?.value,pin:$('#pinNew').value,pinConfirmation:$('#pinAgain').value});
      window.me=await api('me');renderTop(window.me,window.me.role);openSecurityModal();toast('Đã lưu mã bảo mật của bạn.');
    }catch(error){$('#pinSettingsError').textContent=error.message}finally{if(button.isConnected)button.disabled=false}
  };
}
function openPinRecovery(){
  ensureModal();openModal(`<div class=dialog-kicker>Khôi phục qua email</div><h2>Quên mã bảo mật?</h2><p class=note>Xác nhận mật khẩu và OTP gửi về email đã xác thực để đặt mã mới.</p><form id=pinRecoveryForm><label for=pinRecoveryUser>Tên đăng nhập hoặc email</label><input id=pinRecoveryUser value="${esc(window.me?.username||$('#lu')?.value||'')}" autocomplete=username required ${window.me?'readonly':''}><label for=pinRecoveryPassword>Mật khẩu tài khoản</label><input id=pinRecoveryPassword type=password autocomplete=current-password required><button type=button class="btn ghost sm" id=sendPinRecovery>Gửi OTP qua email</button><p class=note id=pinRecoveryMessage role=status></p><div id=pinRecoveryNext hidden><label for=pinRecoveryOtp>OTP nhận qua email</label><input class=pin-entry id=pinRecoveryOtp inputmode=numeric pattern="[0-9]{6}" maxlength=6 autocomplete=one-time-code>${pinFields()}</div><p class="note err" id=pinRecoveryError role=alert></p><div class=row><button type=button class="btn ghost" onclick=closeModal()>Đóng</button><button class=btn id=confirmPinRecovery disabled>Lưu mã mới</button></div></form>`);
  $('#sendPinRecovery').onclick=async()=>{
    const button=$('#sendPinRecovery');button.disabled=true;$('#pinRecoveryError').textContent='';
    try{const result=await api('security/pin/reset/request',{identifier:$('#pinRecoveryUser').value,currentPassword:$('#pinRecoveryPassword').value});$('#pinRecoveryNext').hidden=false;$('#pinRecoveryOtp').required=true;$('#confirmPinRecovery').disabled=false;$('#pinRecoveryMessage').textContent='Đã gửi OTP tới '+result.maskedEmail}
    catch(error){$('#pinRecoveryError').textContent=error.message}finally{if(button.isConnected)button.disabled=false}
  };
  $('#pinRecoveryForm').onsubmit=async e=>{
    e.preventDefault();$('#confirmPinRecovery').disabled=true;
    try{await api('security/pin/reset/confirm',{identifier:$('#pinRecoveryUser').value,currentPassword:$('#pinRecoveryPassword').value,code:$('#pinRecoveryOtp').value,pin:$('#pinNew').value,pinConfirmation:$('#pinAgain').value});if(window.me){window.me=await api('me');openSecurityModal()}else closeModal();toast('Đã đặt lại mã bảo mật. Bạn có thể đăng nhập bằng mã mới.');}
    catch(error){$('#pinRecoveryError').textContent=error.message;$('#confirmPinRecovery').disabled=false}
  };
}
function openSecurityModal(){
  const me=window.me;ensureModal();
  openModal(`<div class=dialog-kicker>Hồ sơ của bạn</div><h2>Tài khoản</h2><div class=profile-summary>${avatarHtml(me,'profile-avatar')}<div><b>${esc(me.username)}</b><p class=note>${me.role==='customer'?'Khách hàng':'Nhà tổ chức'}</p><button class="btn ghost sm" onclick=openAvatarEditor()>Thay ảnh đại diện</button></div></div><dl class=account-details><div><dt>Email</dt><dd>${esc(me.email)} <span class="badge ${me.emailVerified?'ok':'out'}">${me.emailVerified?'Đã xác thực':'Chưa xác thực'}</span></dd></div><div><dt>Mã bảo mật</dt><dd>${me.pinConfigured?'Đã thiết lập · 6 chữ số':'Chưa thiết lập'}</dd></div><div><dt>Thiết bị</dt><dd>${me.currentDevice==='mobile'?'Điện thoại':'Máy tính'}</dd></div></dl><div class=security-actions><div><b>Mật khẩu</b><p class=note>Thay đổi mật khẩu đăng nhập bằng xác thực email.</p></div><button class="btn ghost sm" onclick=openChangePassword()>Đổi mật khẩu</button></div><div class=security-actions><div><b>Mã bảo mật</b><p class=note>Xác nhận khi đăng nhập và mở thông tin nhạy cảm.</p></div><button class="btn ghost sm" onclick=openPinSettings()>${me.pinConfigured?'Đổi mã':'Tạo mã'}</button></div><div class=row><button class=link-btn onclick=openPinRecovery()>Quên mã bảo mật?</button>${me.emailVerified?'':'<button class="btn ghost sm" onclick=openEmailVerification()>Xác thực email</button>'}<button class="btn ghost" onclick=closeModal()>Đóng</button></div>`);
}
function openEmailVerification(){
  openModal('<h2>Xác thực email</h2><p class=note>Mã OTP sẽ gửi đến email đã đăng ký.</p><button class="btn ghost" id=evSend>Gửi mã OTP</button><p class=note id=evBox role=status></p><form id=emailVerifyForm><label for=evCode>OTP 6 chữ số</label><input class=pin-entry id=evCode inputmode=numeric pattern="[0-9]{6}" maxlength=6 autocomplete=one-time-code required><p class="note err" id=evError role=alert></p><div class=row><button type=button class="btn ghost" onclick=openSecurityModal()>Quay lại</button><button class=btn>Xác nhận</button></div></form>');
  $('#evSend').onclick=async()=>{const b=$('#evSend');b.disabled=true;try{const r=await api('verify-email/request',{});$('#evBox').textContent='Đã gửi OTP tới '+r.maskedEmail}catch(e){$('#evError').textContent=e.message}finally{if(b.isConnected)b.disabled=false}};
  $('#emailVerifyForm').onsubmit=async e=>{e.preventDefault();try{await api('verify-email/confirm',{code:$('#evCode').value});window.me=await api('me');openSecurityModal()}catch(e){$('#evError').textContent=e.message}};
}
function openChangePassword(){
  if(!window.me.emailVerified){openEmailVerification();return}
  openModal(`<div class=dialog-kicker>Bảo mật tài khoản</div><h2>Đổi mật khẩu</h2><p class=note>Nhập mật khẩu hiện tại và OTP gửi về email để xác nhận thay đổi.</p><form id=changePasswordForm><label for=cpOld>Mật khẩu hiện tại</label><input id=cpOld type=password autocomplete=current-password required><button type=button class="btn ghost sm" id=cpSend>Gửi OTP xác nhận</button><p class=note id=cpBox role=status></p><label for=cpCode>OTP nhận qua email</label><input class=pin-entry id=cpCode inputmode=numeric pattern="[0-9]{6}" maxlength=6 autocomplete=one-time-code required><label for=cpNew>Mật khẩu mới · ít nhất 8 ký tự, 1 chữ hoa và 1 số</label><input id=cpNew type=password autocomplete=new-password minlength=8 required><label for=cpNew2>Nhập lại mật khẩu mới</label><input id=cpNew2 type=password autocomplete=new-password required><p class="note err" id=cpError role=alert></p><div class=row><button type=button class="btn ghost" onclick=openSecurityModal()>Quay lại</button><button class=btn id=cpOk>Lưu mật khẩu mới</button></div></form>`);
  $('#cpSend').onclick=async()=>{const b=$('#cpSend');b.disabled=true;try{const r=await api('change-password/request',{currentPassword:$('#cpOld').value});$('#cpBox').textContent='Đã gửi OTP tới '+r.maskedEmail}catch(e){$('#cpError').textContent=e.message}finally{if(b.isConnected)b.disabled=false}};
  $('#changePasswordForm').onsubmit=async e=>{
    e.preventDefault();if($('#cpNew').value!==$('#cpNew2').value){$('#cpError').textContent='Mật khẩu xác nhận không khớp.';return}
    const b=$('#cpOk');b.disabled=true;
    try{await api('change-password/confirm',{currentPassword:$('#cpOld').value,newPassword:$('#cpNew').value,code:$('#cpCode').value});openSecurityModal();toast('Đã đổi mật khẩu thành công.')}
    catch(e){$('#cpError').textContent=e.message}finally{if(b.isConnected)b.disabled=false}
  };
}

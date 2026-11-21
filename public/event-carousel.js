(function(root){
 'use strict';
 const today=()=>new Date(Date.now()+7*3600000).toISOString().slice(0,10);
 function selectHot(events,date=today()){
  return events.filter(e=>e.status!=='cancelled' && (!e.status||e.status==='active') && e.date>=date && Number(e.remain)>0)
   .slice().sort((a,b)=>Number(b.sold||0)-Number(a.sold||0)||String(a.date).localeCompare(String(b.date))||Number(a.id)-Number(b.id)).slice(0,5);
 }
 function render(events,escape,image){
  if(!events.length)return '';
  const slides=events.map((event,i)=>`<article class="hot-slide" role="group" aria-roledescription="trang chiếu" aria-label="${i+1} / ${events.length}"><img src="${escape(image(event))}" alt="${escape(event.name)}" ${i>1?'loading="lazy"':'fetchpriority="high"'} draggable="false"><div class="hot-caption"><div><span class="hot-label">SỰ KIỆN NỔI BẬT</span><h2>${escape(event.name)}</h2></div><button class="hot-detail" data-event="${Number(event.id)}">Xem chi tiết</button></div></article>`).join('');
  return `<section class="hot-carousel" role="region" aria-roledescription="băng chuyền" aria-label="Sự kiện bán vé nổi bật" tabindex="0"><div class="hot-viewport"><div class="hot-track">${slides}</div></div><button class="hot-arrow hot-prev" aria-label="Sự kiện trước">‹</button><button class="hot-arrow hot-next" aria-label="Sự kiện tiếp theo">›</button><div class="hot-controls"><div class="hot-dots">${events.map((e,i)=>`<button class="hot-dot" aria-label="Đến sự kiện ${i+1}: ${escape(e.name)}" data-index="${i}"></button>`).join('')}</div><button class="hot-pause" aria-label="Tạm dừng tự chuyển">Ⅱ</button></div></section>`;
 }
 function mount(host,onDetail){
  const el=host.querySelector('.hot-carousel');if(!el)return ()=>{};
  const track=el.querySelector('.hot-track'),cards=[...el.querySelectorAll('.hot-slide')],dots=[...el.querySelectorAll('.hot-dot')];
  const viewport=el.querySelector('.hot-viewport'),pauseButton=el.querySelector('.hot-pause');
  const media=matchMedia('(prefers-reduced-motion: reduce)');
  let index=0,timer=null,paused=media.matches,start=null,disposed=false;
  const visible=()=>matchMedia('(max-width: 700px)').matches?1:2;
  const maximum=()=>Math.max(0,cards.length-visible());
  function paint(){index=Math.min(index,maximum());const step=cards.length>1?cards[1].offsetLeft-cards[0].offsetLeft:0;track.style.transform=`translateX(-${index*step}px)`;dots.forEach((dot,i)=>{dot.hidden=i>maximum();dot.setAttribute('aria-current',String(i===index));});el.querySelectorAll('.hot-arrow').forEach(b=>b.hidden=maximum()===0);pauseButton.hidden=maximum()===0;pauseButton.textContent=paused?'▶':'Ⅱ';pauseButton.setAttribute('aria-label',paused?'Tiếp tục tự chuyển':'Tạm dừng tự chuyển');cards.forEach((card,i)=>{const active=i>=index&&i<index+visible();card.inert=!active;card.setAttribute('aria-hidden',String(!active));});}
  function stop(){clearInterval(timer);timer=null;}
  function schedule(){stop();if(!disposed&&!paused&&!document.hidden&&maximum()>0&&!el.matches(':hover')&&!el.contains(document.activeElement))timer=setInterval(()=>move(1,false),5000);}
  function move(delta,reset=true){const max=maximum();index=(index+delta+max+1)%(max+1);paint();if(reset)schedule();}
  el.querySelector('.hot-prev').onclick=()=>move(-1);el.querySelector('.hot-next').onclick=()=>move(1);
  dots.forEach((dot,i)=>dot.onclick=()=>{index=i;paint();schedule();});
  pauseButton.onclick=()=>{paused=!paused;paint();schedule();};
  el.querySelectorAll('[data-event]').forEach(b=>b.onclick=()=>onDetail(Number(b.dataset.event)));
  el.onkeydown=e=>{if(e.key==='ArrowLeft'||e.key==='ArrowRight'){e.preventDefault();move(e.key==='ArrowLeft'?-1:1);}};
  viewport.onpointerdown=e=>{start={x:e.clientX,y:e.clientY};stop();};
  viewport.onpointerup=e=>{if(start){const dx=e.clientX-start.x,dy=e.clientY-start.y;if(Math.abs(dx)>45&&Math.abs(dx)>Math.abs(dy))move(dx<0?1:-1);start=null;schedule();}};
  viewport.onpointercancel=()=>{start=null;schedule();};
  el.onmouseenter=stop;el.onmouseleave=schedule;el.onfocusin=stop;el.onfocusout=()=>setTimeout(schedule,0);
  const resize=()=>{paint();schedule();};window.addEventListener('resize',resize);document.addEventListener('visibilitychange',schedule);
  paint();schedule();return ()=>{disposed=true;stop();window.removeEventListener('resize',resize);document.removeEventListener('visibilitychange',schedule);};
 }
 const api={selectHot,render,mount};if(typeof module!=='undefined')module.exports=api;else root.EventCarousel=api;
})(typeof window!=='undefined'?window:globalThis);

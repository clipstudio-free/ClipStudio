import {createClient} from '@supabase/supabase-js';
import {FFmpeg} from '@ffmpeg/ffmpeg';
import {fetchFile,toBlobURL} from '@ffmpeg/util';
import {dict,languages} from './i18n.js';
import './style.css';

const endpoint=(import.meta.env.VITE_SUPABASE_URL||'').trim();
const apiKey=(import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY||'').trim();
const configured=/^https:\/\/[a-z0-9-]+\.supabase\.co\/?$/i.test(endpoint) && (apiKey.startsWith('sb_publishable_') || apiKey.startsWith('eyJ')) && !apiKey.includes('YOUR_');
const supabase=configured?createClient(endpoint,apiKey):null;
const app=document.querySelector('#app');
const subtitlePrefs={style:'clean',font:'Arial Black',color:'#FFE34D',size:40,animation:'pop',position:'bottom',text:'YOUR NEXT VIRAL MOMENT'};
const state={user:null,page:'home',authMode:'login',lang:localStorage.getItem('clipstudio-lang')||'en',theme:localStorage.getItem('clipstudio-theme')||'system',projects:[],activity:[],profile:null,notice:'',error:false,working:false,selectedFile:null,editing:null,downloadUrl:null};
if(!dict[state.lang])state.lang='en';
const t=(key)=>dict[state.lang]?.[key]||dict.en[key]||key;
const mediaMessages={
 en:{nav:'YouTube Downloader',heading:'Download a YouTube video',subtitle:'Paste the link to a video you own or have permission to download.',url:'YouTube link',preview:'Video information',format:'Format',quality:'Video quality',download:'Prepare download',rights:'I own this video or have permission to download it.',available:'Available source resolutions',fallback:'A lower resolution will be used if the chosen quality is unavailable. Upscaling is not performed.',audio:'MP3 audio · 192 kbps',working:'Preparing your download…',ready:'Your file is ready!',save:'Download file',quota:'Daily usage',clipQuota:'Shorts',mediaQuota:'Downloads',unlimited:'Unlimited',remaining:'remaining',reset:'Resets at midnight UTC',previewLoading:'Loading video thumbnail…',previewError:'Could not load the thumbnail. Check the link and server.',enterUrl:'Paste a YouTube link first.',confirmRights:'Confirm that you have permission to download this content.',onlineWarning:'The video server must be running and publicly reachable. Cloudflare hosts the interface only.',duration:'Duration',status:'Status'},
 fr:{nav:'Téléchargement YouTube',heading:'Télécharger une vidéo YouTube',subtitle:'Collez le lien de votre vidéo, ou d’une vidéo que vous êtes autorisé à télécharger.',url:'Lien YouTube',preview:'Aperçu de la vidéo',format:'Format',quality:'Qualité vidéo',download:'Préparer le téléchargement',rights:'Je possède cette vidéo ou je suis autorisé à la télécharger.',available:'Résolutions disponibles',fallback:'Si la qualité demandée est indisponible, la meilleure qualité inférieure sera utilisée. Pas d’agrandissement artificiel.',audio:'Audio MP3 · 192 kb/s',working:'Préparation du téléchargement…',ready:'Votre fichier est prêt !',save:'Télécharger le fichier',quota:'Utilisation quotidienne',clipQuota:'Shorts',mediaQuota:'Téléchargements',unlimited:'Illimité',remaining:'restants',reset:'Remise à zéro à minuit UTC',previewLoading:'Chargement de la miniature…',previewError:'Miniature indisponible. Vérifiez le lien et le serveur.',enterUrl:'Collez d’abord un lien YouTube.',confirmRights:'Confirmez votre droit de télécharger cette vidéo.',onlineWarning:'Le serveur vidéo doit fonctionner et être accessible en ligne. Cloudflare héberge uniquement l’interface.',duration:'Durée',status:'Statut'},
 ar:{nav:'تحميل يوتيوب',heading:'تحميل فيديو من يوتيوب',subtitle:'ألصق رابط فيديو تملكه أو لديك إذن بتحميله.',url:'رابط يوتيوب',preview:'معاينة الفيديو',format:'الصيغة',quality:'جودة الفيديو',download:'تحضير التحميل',rights:'أنا أملك هذا الفيديو أو لدي إذن بتحميله.',available:'الجودات الموجودة في المصدر',fallback:'إذا لم تتوفر الجودة المختارة فسيتم استعمال أفضل جودة أقل منها، بدون تكبير اصطناعي.',audio:'صوت MP3 · 192 كيلوبت/ث',working:'جاري تحضير الملف…',ready:'الملف جاهز!',save:'تحميل الملف',quota:'الاستخدام اليومي',clipQuota:'الشورتات',mediaQuota:'التحميلات',unlimited:'غير محدود',remaining:'متبقية',reset:'يتجدد الرصيد عند منتصف الليل UTC',previewLoading:'جاري جلب الصورة المصغرة…',previewError:'تعذر جلب الصورة. تحقق من الرابط والسيرفر.',enterUrl:'ألصق رابط يوتيوب أولاً.',confirmRights:'أكد أنك تملك حق تحميل الفيديو.',onlineWarning:'يجب أن يكون سيرفر الفيديو شغالاً ومتاحاً عبر الإنترنت. Cloudflare يستضيف الواجهة فقط.',duration:'المدة',status:'الحالة'},
 es:{nav:'Descargas de YouTube',heading:'Descargar video de YouTube',subtitle:'Pega un enlace a un video propio o autorizado para descargar.',url:'Enlace de YouTube',preview:'Vista previa',format:'Formato',quality:'Calidad de video',download:'Preparar descarga',rights:'Soy propietario o tengo permiso para descargar este video.',available:'Resoluciones disponibles',fallback:'Se usará la mejor resolución inferior si no está disponible. No se amplía artificialmente.',audio:'Audio MP3 · 192 kbps',working:'Preparando descarga…',ready:'¡Archivo listo!',save:'Descargar archivo',quota:'Uso diario',clipQuota:'Shorts',mediaQuota:'Descargas',unlimited:'Ilimitado',remaining:'restantes',reset:'Se reinicia a medianoche UTC',previewLoading:'Cargando miniatura…',previewError:'No se pudo cargar la miniatura. Revisa el enlace y el servidor.',enterUrl:'Primero pega un enlace de YouTube.',confirmRights:'Confirma que tienes permiso para descargarlo.',onlineWarning:'El servidor de video debe estar en ejecución y accesible. Cloudflare aloja solamente la interfaz.',duration:'Duración',status:'Estado'}
};
const mt=key=>mediaMessages[state.lang]?.[key]||mediaMessages.en[key]||key;
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const fmt=d=>new Date(d).toLocaleString(state.lang==='ar'?'ar-MA':state.lang,{dateStyle:'medium',timeStyle:'short'});
const safeError=e=>{const m=String(e?.message||e||t('error'));if(/Invalid API key/i.test(m))return 'Invalid API key: check that your .env.local Publishable Key and Project URL belong to the same Supabase project, then restart Vite.';return m;};
function flash(message,error=false){state.notice=message;state.error=error;render();}
function setPage(page){state.page=page;state.notice='';render();window.scrollTo(0,0);}
function applyTheme(){document.documentElement.dataset.theme=state.theme;document.documentElement.lang=state.lang;document.documentElement.dir=state.lang==='ar'?'rtl':'ltr';}
function logo(){return `<span class="logo"><span class="logo-mark">✂</span> Clip<span>Studio</span><small>FREE</small></span>`;}
function languageSelect(){return `<select id="quick-lang" aria-label="Language">${Object.entries(languages).map(([k,v])=>`<option value="${k}" ${state.lang===k?'selected':''}>${v}</option>`).join('')}</select>`;}
function header(){return `<header class="topbar"><button class="brand" data-page="${state.user?'dashboard':'home'}">${logo()}</button><nav class="topnav"><button data-page="home">${t('home')}</button>${state.user?`<button data-page="dashboard">${t('dashboard')}</button><button data-page="newclip">${t('newclip')}</button><button data-page="downloads">${mt('nav')}</button>`:`<button data-scroll="features">${t('features')}</button>`}</nav><div class="head-actions">${languageSelect()}${state.user?`<button class="btn ghost" data-page="settings">⚙</button><button class="btn outline" id="logout-top">${t('logout')}</button>`:`<button class="btn ghost" data-auth="login">${t('login')}</button><button class="btn primary" data-auth="signup">${t('try')} ↗</button>`}</div></header>`;}
function landing(){return `${header()}<main><section class="hero"><div class="hero-copy"><div class="pill">✦ CLIPSTUDIO FREE · CREATOR WORKSPACE</div><h1>${t('hero')}</h1><p>${t('sub')}</p><div class="hero-buttons"><button class="btn primary large" data-auth="signup">${t('try')} →</button><button class="btn outline large" data-auth="login">${t('login')}</button></div><div class="trust"><span>✓ 9:16 MP4</span><span>✓ 4 languages</span><span>✓ Private projects</span></div></div><div class="hero-art" aria-hidden="true"><div class="orb orb-a"></div><div class="orb orb-b"></div><div class="character"><div class="hair"></div><div class="face"><div class="eyes">● &nbsp; ●</div><div class="smile">⌣</div></div><div class="headphones">◖ &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp; ◗</div><div class="shirt">▶</div></div><div class="floating-card card-one">▶ <b>00:34</b><span> LONG VIDEO</span></div><div class="floating-card card-two">✂ <b>9:16</b><span> SHORT CLIP</span></div><div class="spark">✦</div></div></section><section id="features" class="section"><div class="section-heading"><span class="eyebrow">WHAT YOU GET</span><h2>${t('features')}</h2></div><div class="features"><article class="feature"><div class="feature-icon">✂</div><h3>${t('feature1')}</h3><p>${t('feature1d')}</p></article><article class="feature"><div class="feature-icon">▤</div><h3>${t('feature2')}</h3><p>${t('feature2d')}</p></article><article class="feature"><div class="feature-icon">✦</div><h3>${t('feature3')}</h3><p>${t('feature3d')}</p></article></div></section><section class="section steps"><h2>${t('how')}</h2><div class="step-grid">${['step1','step2','step3'].map((s,i)=>`<div><strong>0${i+1}</strong><p>${t(s)}</p></div>`).join('')}</div><button class="btn primary large" data-auth="signup">${t('try')} →</button></section></main><footer>${t('footer')}</footer>`;}
function auth(){const mode=state.authMode;const reset=mode==='reset';const update=mode==='update';const title=mode==='login'?t('login'):mode==='signup'?t('signup'):reset?t('reset'):t('update');return `${header()}<main class="auth-layout"><section class="auth-aside"><span class="pill">CLIPSTUDIO FREE</span><h1>${t('authTitle')}</h1><p>${t('sub')}</p><div class="auth-decoration">✂ <span>▶</span> ✦</div></section><section class="auth-card"><button class="back-link" data-page="home">← ${t('back')}</button><h2>${title}</h2>${!configured?`<div class="alert error">${t('notConfigured')}</div>`:''}<form id="auth-form">${mode==='signup'?`<label>${t('name')}<input name="name" maxlength="80" autocomplete="name" /></label>`:''}${!update?`<label>${t('email')}<input name="email" type="email" autocomplete="email" required /></label>`:''}${!reset?`<label>${t('password')}<input name="password" type="password" minlength="8" autocomplete="${mode==='login'?'current-password':'new-password'}" required /></label>`:''}<button class="btn primary full" type="submit" ${!configured?'disabled':''}>${reset?t('send'):update?t('update'):title} →</button></form>${['login','signup'].includes(mode)?`<div class="divider-text">${t('or')}</div><button id="google" class="btn google full" ${!configured?'disabled':''}><span class="google-g">G</span>${t('google')}</button>`:''}<div class="auth-links">${mode==='login'?`<button data-auth="reset">${t('forgot')}</button><button data-auth="signup">${t('noaccount')}</button>`:`<button data-auth="login">${t('haveaccount')}</button>`}</div></section></main>`;}
function sidebar(){return `<aside class="sidebar"><div class="sidebar-logo">${logo()}</div><div class="nav-label">WORKSPACE</div>${[['dashboard','◫'],['newclip','✂'],['downloads','⬇'],['library','▤'],['history','◷'],['settings','⚙']].map(([page,ico])=>`<button class="side-link ${state.page===page?'active':''}" data-page="${page}"><span>${ico}</span>${page==='downloads'?mt('nav'):t(page)}</button>`).join('')}<div class="sidebar-bottom"><div class="avatar">${esc((state.user?.email||'U')[0].toUpperCase())}</div><div class="sidebar-email">${esc(state.user?.email||'')}</div><button id="logout" class="side-link">↪ ${t('logout')}</button></div></aside>`;}
function workspace(content){return `<div class="app-layout">${sidebar()}<div class="app-main"><div class="workspace-head"><span class="breadcrumb">CLIPSTUDIO / ${state.page==='downloads'?mt('nav'):t(state.page)}</span><div class="workspace-head-actions">${languageSelect()} <button id="theme-cycle" class="icon-button" title="Theme">◐</button><button id="logout-mobile" class="btn outline mobile-signout">↪ ${t('logout')}</button></div></div>${content}</div></div>`;}
function projectCard(p){return `<article class="project-card"><div class="thumb"><span>▶</span><small>9:16</small></div><div class="project-info"><strong>${esc(p.title)}</strong><div class="meta">${fmt(p.created_at)} · ${t(p.status)}</div><div class="card-actions"><button data-edit="${p.id}">${t('edit')}</button><button class="danger" data-delete="${p.id}">${t('delete')}</button></div></div></article>`;}
function dashboard(){const exports=state.projects.filter(p=>p.status==='exported').length;return workspace(`<div class="page-title"><span class="eyebrow">YOUR CREATIVE SPACE</span><h1>${t('welcome')} ✦</h1><p>${esc(state.profile?.display_name||state.user?.email||'')}</p></div><div class="stats"><div class="stat"><span>${t('total')}</span><strong>${state.projects.length}</strong></div><div class="stat"><span>${t('exports')}</span><strong>${exports}</strong></div><div class="stat"><span>${t('activity')}</span><strong>${state.activity.length}</strong></div></div><div class="section-head"><h2>${t('recent')}</h2><button class="btn primary" data-page="newclip">+ ${t('newclip')}</button></div><div class="project-grid">${state.projects.length?state.projects.slice(0,6).map(projectCard).join(''):`<div class="empty">${t('empty')}</div>`}</div>`);}
function library(){return workspace(`<div class="section-head"><div><span class="eyebrow">YOUR WORK</span><h1>${t('library')}</h1></div><button class="btn primary" data-page="newclip">+ ${t('newclip')}</button></div><div class="project-grid">${state.projects.length?state.projects.map(projectCard).join(''):`<div class="empty">${t('empty')}</div>`}</div>`);}
function history(){return workspace(`<div class="page-title"><h1>${t('history')}</h1></div><div class="timeline">${state.activity.length?state.activity.map(a=>`<div class="timeline-row"><span class="timeline-dot"></span><div><strong>${esc(a.action.replaceAll('_',' '))}</strong><p>${esc(a.details||'')}</p><small>${fmt(a.created_at)}</small></div></div>`).join(''):`<div class="empty">${t('empty')}</div>`}</div>`);}
function newclip(){const p=state.projects.find(p=>p.id===state.editing);return workspace(`<div class="page-title"><span class="eyebrow">CREATE</span><h1>${t('newclip')} ✂</h1><p>${t('clipNotice')}</p></div><div class="quick-media-link"><button type="button" class="btn outline" data-page="downloads">⬇ ${mt('nav')} · MP4 / MP3</button></div><div class="editor-grid"><div class="panel"><form id="project-form"><label>${t('title')}<input name="title" required maxlength="150" value="${esc(p?.title||'')}" placeholder="My next clip" /></label><label>${t('source')}<input name="source" type="url" value="${esc(p?.source_url||'')}" placeholder="https://www.youtube.com/watch?v=..." /></label><label>${t('upload')}<input name="file" id="video-file" type="file" accept="video/*" /></label><div class="two-cols"><label>${t('start')}<input name="start" type="number" step="0.1" min="0" value="${p?.clip_start??0}" required /></label><label>${t('end')}<input name="end" type="number" step="0.1" min="0.1" value="${p?.clip_end??30}" required /></label></div><fieldset class="subtitle-controls"><legend>Subtitle design · Preview only</legend><label>Text (manual demo)<input id="caption-text" type="text" maxlength="150" value="YOUR NEXT VIRAL MOMENT" /></label><div class="two-cols"><label>Style<select id="caption-style"><option value="clean">Clean · No box</option><option value="boxed">Word Box</option></select></label><label>Font<select id="caption-font"><option>Arial Black</option><option>Arial</option><option>Impact</option><option>Georgia</option></select></label><label>Color<input id="caption-color" type="color" value="#ffe34d" /></label><label>Size (px)<input id="caption-size" type="number" min="18" max="64" value="40" /></label><label>Animation<select id="caption-animation"><option value="pop">Pop</option><option value="none">None</option></select></label><label>Position<select id="caption-position"><option value="bottom">Bottom</option><option value="center">Center</option><option value="top">Top</option></select></label></div><small>Preview demonstration: words are not transcribed or timed to speech. Captions are not burned into exported MP4 yet.</small></fieldset><section class="auto-generator" style="padding:18px;margin:18px 0;border:1px solid #7a7a7a;border-radius:14px"><h2>✨ Automatic 4 Shorts Generator</h2><p>Paste a public YouTube link OR choose a local file above. No start/end times needed. Requires the Windows backend.</p><label>Clip length <select id="auto-seconds"><option value="30">30 seconds</option><option value="15">15 seconds</option><option value="45">45 seconds</option><option value="60">60 seconds</option></select></label><button class="btn primary" id="auto-generate" type="button">Generate 4 Shorts automatically</button><div id="auto-status" role="status" style="margin:12px 0"></div><div id="quota-feedback" class="quota-feedback" aria-live="polite"></div><div id="auto-progress" class="auto-progress" aria-label="Progression des quatre Shorts"><div class="clip-progress"><div class="clip-progress-heading"><strong>Short 1</strong><span id="short-percent-1">0%</span></div><progress id="short-progress-1" max="100" value="0"></progress></div><div class="clip-progress"><div class="clip-progress-heading"><strong>Short 2</strong><span id="short-percent-2">0%</span></div><progress id="short-progress-2" max="100" value="0"></progress></div><div class="clip-progress"><div class="clip-progress-heading"><strong>Short 3</strong><span id="short-percent-3">0%</span></div><progress id="short-progress-3" max="100" value="0"></progress></div><div class="clip-progress"><div class="clip-progress-heading"><strong>Short 4</strong><span id="short-percent-4">0%</span></div><progress id="short-progress-4" max="100" value="0"></progress></div></div><div id="auto-results" style="display:grid;gap:14px"></div></section><div class="editor-buttons"><button class="btn outline" type="submit">${t('save')}</button><button class="btn primary" type="button" id="export-video" ${state.working?'disabled':''}>${state.working?t('working'):t('export')}</button></div></form></div><div class="panel preview-panel"><div class="preview-title">PREVIEW · 9:16</div><div class="preview-frame" id="preview-frame"><video id="video-preview" controls playsinline></video><div id="caption-overlay" class="caption-overlay" aria-live="off"></div><div class="preview-placeholder">▶<small>YOUR VIDEO PREVIEW</small></div></div><div class="notice">${t('subtitleNotice')}</div><div class="notice">${t('localNotice')}</div><div id="export-status" role="status"></div></div></div>`);}
function downloads(){return workspace(`<div class="page-title"><span class="eyebrow">CLIPSTUDIO · MEDIA</span><h1>⬇ ${mt('heading')}</h1><p>${mt('subtitle')}</p></div>
<div class="panel media-panel">
<form id="media-form">
<label>${mt('url')}<input id="media-url" type="url" name="url" autocomplete="off" inputmode="url" placeholder="https://www.youtube.com/watch?v=…" required /></label>
<div id="media-preview-status" class="media-muted" role="status">${mt('preview')}</div>
<div id="media-preview" class="media-preview" hidden></div>
<div class="media-options"><label>${mt('format')}<select name="format" id="media-format"><option value="mp4">MP4 — Video</option><option value="mp3">MP3 — Audio</option></select></label><label id="media-quality-field">${mt('quality')}<select name="quality" id="media-quality"><option value="430">430p</option><option value="720" selected>720p (HD)</option><option value="1080">1080p (Full HD)</option><option value="2160">4K (2160p)</option><option value="4320">8K (4320p)</option></select></label></div>
<div id="media-quality-note" class="media-muted">${mt('fallback')}</div>
<label class="media-confirm"><input type="checkbox" name="rights_confirmed" id="media-rights" required /><span>${mt('rights')}</span></label>
<button class="btn primary media-start" id="media-start" type="submit">⬇ ${mt('download')}</button>
</form>
<div id="media-status" class="media-status" role="status"></div>
<progress id="media-progress" max="100" value="0" hidden></progress>
<div id="media-result" class="media-result"></div>
<div id="quota-feedback" class="quota-feedback" aria-live="polite"></div>
<p class="media-muted media-warning">${mt('onlineWarning')}</p>
</div>`);}
function settings(){return workspace(`<div class="page-title"><h1>${t('settings')}</h1></div><div class="panel settings-panel"><form id="settings-form"><label>${t('profile')} — ${t('name')}<input name="display_name" maxlength="80" value="${esc(state.profile?.display_name||'')}" /></label><label>${t('language')}<select name="language">${Object.entries(languages).map(([k,v])=>`<option value="${k}" ${state.lang===k?'selected':''}>${v}</option>`).join('')}</select></label><label>${t('appearance')}<select name="theme">${['system','dark','light'].map(k=>`<option value="${k}" ${state.theme===k?'selected':''}>${t(k)}</option>`).join('')}</select></label><button class="btn primary" type="submit">${t('saveSettings')}</button></form><div class="settings-foot">${esc(state.user?.email||'')}<button type="button" id="logout-settings" class="btn outline settings-logout">↪ ${t('logout')}</button></div></div>`);}
function render(){applyTheme();app.innerHTML=(state.user?({dashboard,library,history,newclip,downloads,settings,home:landing}[state.page]||dashboard)():state.page==='auth'?auth():landing())+(state.notice?`<div class="toast ${state.error?'error':''}" role="status">${esc(state.notice)} <button id="close-toast">×</button></div>`:'');wire();}
function wire(){document.querySelectorAll('[data-page]').forEach(b=>b.onclick=()=>{const page=b.dataset.page;if(!state.user&&page!=='home'){state.authMode='login';setPage('auth');}else{if(page==='newclip'){state.editing=null;state.selectedFile=null;}setPage(page);}});document.querySelectorAll('[data-auth]').forEach(b=>b.onclick=()=>{state.authMode=b.dataset.auth;setPage('auth');});document.querySelectorAll('[data-scroll]').forEach(b=>b.onclick=()=>document.getElementById(b.dataset.scroll)?.scrollIntoView({behavior:'smooth'}));document.querySelectorAll('#quick-lang').forEach(s=>s.onchange=()=>{state.lang=s.value;localStorage.setItem('clipstudio-lang',state.lang);render();});document.querySelector('#theme-cycle')?.addEventListener('click',()=>{state.theme=state.theme==='system'?'dark':state.theme==='dark'?'light':'system';localStorage.setItem('clipstudio-theme',state.theme);render();});document.querySelectorAll('#logout,#logout-top,#logout-mobile,#logout-settings').forEach(b=>b.onclick=async()=>{const {error}=await supabase.auth.signOut();if(error)flash(safeError(error),true);});document.querySelector('#close-toast')?.addEventListener('click',()=>{state.notice='';render();});document.querySelector('#auth-form')?.addEventListener('submit',submitAuth);document.querySelector('#google')?.addEventListener('click',async()=>{const {error}=await supabase.auth.signInWithOAuth({provider:'google',options:{redirectTo:location.origin+'/'} });if(error)flash(safeError(error),true);});document.querySelector('#project-form')?.addEventListener('submit',saveProject);document.querySelector('#video-file')?.addEventListener('change',e=>{state.selectedFile=e.target.files?.[0]||null;const v=document.querySelector('#video-preview');if(v){if(v.dataset.blob)URL.revokeObjectURL(v.dataset.blob);if(state.selectedFile){v.src=URL.createObjectURL(state.selectedFile);v.dataset.blob=v.src;document.querySelector('.preview-placeholder')?.remove();}else v.removeAttribute('src');}});document.querySelector('#export-video')?.addEventListener('click',exportClip);document.querySelector('#auto-generate')?.addEventListener('click',generateFourShorts);initSubtitlePreview();initMediaPage();if(state.page==='newclip'||state.page==='downloads')refreshQuota();document.querySelector('#settings-form')?.addEventListener('submit',saveSettings);document.querySelectorAll('[data-delete]').forEach(b=>b.onclick=()=>deleteProject(b.dataset.delete));document.querySelectorAll('[data-edit]').forEach(b=>b.onclick=()=>{state.editing=b.dataset.edit;state.selectedFile=null;setPage('newclip');});}
async function submitAuth(e){e.preventDefault();if(!supabase)return flash(t('notConfigured'),true);const b=e.submitter;b.disabled=true;const fd=new FormData(e.currentTarget),email=String(fd.get('email')||'').trim(),password=String(fd.get('password')||'');try{let res;if(state.authMode==='login')res=await supabase.auth.signInWithPassword({email,password});else if(state.authMode==='signup')res=await supabase.auth.signUp({email,password,options:{emailRedirectTo:location.origin+'/',data:{display_name:String(fd.get('name')||'')}}});else if(state.authMode==='reset')res=await supabase.auth.resetPasswordForEmail(email,{redirectTo:location.origin+'/'});else res=await supabase.auth.updateUser({password});if(res.error)throw res.error;if(state.authMode==='reset')flash(t('resetSent'));else if(state.authMode==='signup')flash(t('signupSent'));else if(state.authMode==='update'){state.authMode='login';flash(t('saved'));}else if(res.data?.user)await signedIn(res.data.user);}catch(err){flash(safeError(err),true);}finally{b.disabled=false;}}
async function signedIn(user){state.user=user;state.page='dashboard';state.notice='';await loadData();render();}
async function loadData(){if(!supabase||!state.user)return;const uid=state.user.id;const [pr,ps,act]=await Promise.all([supabase.from('profiles').select('*').eq('id',uid).maybeSingle(),supabase.from('projects').select('*').order('created_at',{ascending:false}).limit(200),supabase.from('activity').select('*').order('created_at',{ascending:false}).limit(200)]);if(pr.error||ps.error||act.error){state.notice='Database not ready: run supabase/schema.sql in Supabase SQL Editor. '+safeError(pr.error||ps.error||act.error);state.error=true;}state.profile=pr.data||null;state.projects=ps.data||[];state.activity=act.data||[];if(!state.profile&&!pr.error){const name=state.user.user_metadata?.display_name||state.user.user_metadata?.full_name||'';const {error}=await supabase.from('profiles').insert({id:uid,display_name:name,language:state.lang,theme:state.theme});if(!error)state.profile={id:uid,display_name:name,language:state.lang,theme:state.theme};}if(state.profile){state.lang=state.profile.language||'en';state.theme=state.profile.theme||'system';localStorage.setItem('clipstudio-lang',state.lang);localStorage.setItem('clipstudio-theme',state.theme);}}
async function logActivity(action,projectId,details){const {error}=await supabase.from('activity').insert({user_id:state.user.id,project_id:projectId,action,details});if(error)console.warn('Activity log:',safeError(error));}
async function saveProject(e){e.preventDefault();const f=new FormData(e.currentTarget);const title=String(f.get('title')||'').trim(),source=String(f.get('source')||'').trim(),start=Number(f.get('start')),end=Number(f.get('end'));if(!title||!Number.isFinite(start)||!Number.isFinite(end)||start<0||end<=start)return flash('Check title and clip time range.',true);const data={user_id:state.user.id,title,source_url:source||null,source_type:source?'youtube':'upload',clip_start:start,clip_end:end,updated_at:new Date().toISOString()};try{let res;if(state.editing)res=await supabase.from('projects').update(data).eq('id',state.editing).select().single();else res=await supabase.from('projects').insert(data).select().single();if(res.error)throw res.error;await logActivity(state.editing?'project_updated':'project_created',res.data.id,title);state.editing=res.data.id;await loadData();flash(t('saved'));}catch(err){flash(safeError(err),true);}}
async function deleteProject(id){if(!window.confirm(t('confirmDelete')))return;const title=state.projects.find(p=>p.id===id)?.title||'';const {error}=await supabase.from('projects').delete().eq('id',id);if(error)return flash(safeError(error),true);await logActivity('project_deleted',null,title);await loadData();render();}
async function saveSettings(e){e.preventDefault();const f=new FormData(e.currentTarget);const lang=String(f.get('language')),theme=String(f.get('theme'));const data={id:state.user.id,display_name:String(f.get('display_name')||'').slice(0,80),language:lang,theme,updated_at:new Date().toISOString()};const {error}=await supabase.from('profiles').upsert(data);if(error)return flash(safeError(error),true);state.profile=data;state.lang=lang;state.theme=theme;localStorage.setItem('clipstudio-lang',lang);localStorage.setItem('clipstudio-theme',theme);flash(t('profileSaved'));}
let ffmpegInstance=null;
function initSubtitlePreview(){
 const overlay=document.querySelector('#caption-overlay');if(!overlay)return;
 const video=document.querySelector('#video-preview');
 const ids=['text','style','font','color','size','animation','position'];
 const els=Object.fromEntries(ids.map(id=>[id,document.querySelector('#caption-'+id)]));
 function update(){
  const words=(els.text.value.trim()||'YOUR NEXT VIRAL MOMENT').split(/\s+/).slice(0,20);
  const idx=Math.floor((video?.currentTime||0)*2)%words.length;
  overlay.className='caption-overlay caption-'+els.position.value+' '+(els.style.value==='boxed'?'caption-boxed':'');
  overlay.style.fontFamily=els.font.value+',sans-serif';overlay.style.fontSize=els.size.value+'px';overlay.style.color=els.color.value;
  overlay.replaceChildren();
  words.forEach((word,i)=>{const span=document.createElement('span');span.textContent=word;span.className='caption-word'+(i===idx?' active':'');if(i===idx&&els.animation.value==='pop')span.classList.add('pop');overlay.append(span);});
 }
 Object.values(els).forEach(el=>el?.addEventListener('input',update));
 video?.addEventListener('timeupdate',update);update();
}

const GENERATOR_API=(import.meta.env.VITE_GENERATOR_API_URL||'http://127.0.0.1:8765').replace(/\/$/,'');
async function generatorHeaders(){const {data,error}=await supabase.auth.getSession();if(error||!data.session?.access_token)throw new Error('Please sign in again');return {Authorization:'Bearer '+data.session.access_token};}
async function refreshQuota(){
 const slot=document.querySelector('#quota-feedback'); if(!slot||!supabase)return;
 try{
  const response=await fetch(GENERATOR_API+'/limits',{headers:await generatorHeaders()});
  if(!response.ok)return;
  const data=await response.json();
  const count=k=>data[k]?.limit===0?mt('unlimited'):`${data[k]?.remaining} ${mt('remaining')} / ${data[k]?.limit}`;
  slot.textContent=`${mt('quota')} · ${mt('clipQuota')}: ${count('shorts')} · ${mt('mediaQuota')}: ${count('downloads')} · ${mt('reset')}`;
 }catch(err){slot.textContent=mt('onlineWarning');}
}

let mediaPreviewController=null;
let mediaPreviewTimer=null;
function mediaDuration(raw){
 const sec=Number(raw);if(!Number.isFinite(sec)||sec<0)return '—';
 const h=Math.floor(sec/3600),m=Math.floor(sec%3600/60),s=Math.floor(sec%60);
 return h?`${h}:${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`:`${m}:${String(s).padStart(2,'0')}`;
}
function publicYoutubeId(raw){
 try{
  const u=new URL(raw);if(u.protocol!=='https:')return '';
  const host=u.hostname.toLowerCase();let id='';
  if(host==='youtu.be')id=u.pathname.split('/')[1]||'';
  else if(['youtube.com','www.youtube.com','m.youtube.com'].includes(host)){
   const path=u.pathname.split('/').filter(Boolean);
   id=path[0]==='watch'?(u.searchParams.get('v')||''):(['shorts','live','embed'].includes(path[0])?(path[1]||''):'');
  }
  return /^[a-zA-Z0-9_-]{11}$/.test(id)?id:'';
 }catch{return '';}
}
function initMediaPage(){
 const form=document.querySelector('#media-form');if(!form)return;
 const url=form.querySelector('#media-url');
 url.addEventListener('input',()=>{
  clearTimeout(mediaPreviewTimer);mediaPreviewController?.abort();
  const box=document.querySelector('#media-preview'),notice=document.querySelector('#media-preview-status');
  if(box){box.hidden=true;box.replaceChildren();}if(notice)notice.textContent='';
  if(!url.value.trim())return;
  const videoId=publicYoutubeId(url.value.trim());
  if(videoId&&box){
   const img=document.createElement('img');img.src=`https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`;img.alt='YouTube thumbnail';img.loading='lazy';
   const title=document.createElement('strong');title.textContent=mt('previewLoading');
   box.append(img,title);box.hidden=false;
  }
  mediaPreviewTimer=setTimeout(()=>previewMedia(url.value.trim()),650);
 });
 document.querySelector('#media-format')?.addEventListener('change',()=>{
  const audio=document.querySelector('#media-format').value==='mp3';
  document.querySelector('#media-quality-field').hidden=audio;
  document.querySelector('#media-quality-note').textContent=audio?mt('audio'):mt('fallback');
 });
 form.addEventListener('submit',startMediaDownload);
}
async function previewMedia(url){
 const box=document.querySelector('#media-preview'),notice=document.querySelector('#media-preview-status');
 if(!box||!notice)return;
 notice.textContent=mt('previewLoading');
 const controller=new AbortController();mediaPreviewController=controller;
 try{
  const form=new FormData();form.set('url',url);
  const response=await fetch(GENERATOR_API+'/media/info',{method:'POST',headers:await generatorHeaders(),body:form,signal:controller.signal});
  const data=await response.json();if(!response.ok)throw new Error(data.detail||mt('previewError'));
  if(controller.signal.aborted||document.querySelector('#media-url')?.value.trim()!==url)return;
  box.replaceChildren();
  if(data.thumbnail){const img=document.createElement('img');img.src=data.thumbnail;img.alt='YouTube thumbnail';img.loading='lazy';box.append(img);}
  const content=document.createElement('div'),name=document.createElement('strong'),details=document.createElement('p');
  name.textContent=data.title||'YouTube video';details.textContent=`${data.channel||''} · ${mt('duration')}: ${mediaDuration(data.duration)}`;
  content.append(name,details);
  if(data.heights?.length){const res=document.createElement('small');res.textContent=`${mt('available')}: ${data.heights.map(h=>h+'p').join(' · ')}`;content.append(res);}
  box.append(content);box.hidden=false;notice.textContent='';
 }catch(e){if(e.name!=='AbortError')notice.textContent='⚠ '+(e.message||mt('previewError'));}
}
async function startMediaDownload(event){
 event.preventDefault();
 const form=event.currentTarget,button=form.querySelector('#media-start'),status=document.querySelector('#media-status'),bar=document.querySelector('#media-progress'),result=document.querySelector('#media-result');
 const formdata=new FormData(form);const url=String(formdata.get('url')||'').trim();
 if(!url){status.textContent=mt('enterUrl');return;}
 if(!form.querySelector('#media-rights').checked){status.textContent=mt('confirmRights');return;}
 button.disabled=true;result.replaceChildren();bar.hidden=false;bar.value=0;status.textContent=mt('working');
 try{
  const response=await fetch(GENERATOR_API+'/media/download',{method:'POST',headers:await generatorHeaders(),body:formdata});
  const started=await response.json();if(!response.ok)throw new Error(started.detail||'Download unavailable');
  let completed=false;
  for(let attempt=0;attempt<3600;attempt++){
   await new Promise(resolve=>setTimeout(resolve,2000));
   const poll=await fetch(GENERATOR_API+'/jobs/'+encodeURIComponent(started.job_id),{headers:await generatorHeaders()});
   const job=await poll.json();if(!poll.ok)throw new Error(job.detail||'Cannot check download');
   status.textContent=job.progress||mt('working');bar.value=Math.max(0,Math.min(100,Number(job.percent)||0));
   if(job.status==='error')throw new Error(job.progress||'Download failed');
   if(job.status==='done'){
    const link=document.createElement('a');link.className='btn primary media-download-link';
    link.textContent='⬇ '+mt('save');link.href=GENERATOR_API+job.url;link.rel='noopener noreferrer';
    link.download=job.filename||'clipstudio.mp4';
    result.replaceChildren(link);status.textContent=mt('ready');bar.value=100;completed=true;break;
   }
  }
  if(!completed)throw new Error('Download processing timed out');
 }catch(e){status.textContent='⚠ '+(e.message||'Download failed');}
 finally{button.disabled=false;refreshQuota();}
}

async function generateFourShorts(){
 const button=document.querySelector('#auto-generate'), status=document.querySelector('#auto-status'), results=document.querySelector('#auto-results');
 const form=document.querySelector('#project-form'); const url=String(new FormData(form).get('source')||'').trim();
 const file=state.selectedFile;
 if(!file&&!url){status.textContent='Choose a local file or paste a YouTube URL.';return;}
 const payload=new FormData(); if(file)payload.append('file',file);else payload.append('url',url);
 payload.append('seconds',document.querySelector('#auto-seconds').value);
 button.disabled=true;results.replaceChildren();status.textContent='Connecting to generator…';for(let i=1;i<=4;i++){document.querySelector('#short-progress-'+i).value=0;document.querySelector('#short-percent-'+i).textContent='0%';}
 try{
  const headers=await generatorHeaders();
  const response=await fetch(GENERATOR_API+'/generate',{method:'POST',headers,body:payload});
  const started=await response.json();if(!response.ok)throw new Error(started.detail||'Generation failed');
  let done=false;
  for(let attempt=0;attempt<900;attempt++){
   await new Promise(resolve=>setTimeout(resolve,2000));
   const poll=await fetch(GENERATOR_API+'/jobs/'+encodeURIComponent(started.job_id),{headers:await generatorHeaders()});
   if(!poll.ok)throw new Error('Cannot check generator status');
   const job=await poll.json();status.textContent=job.progress; if(Array.isArray(job.percentages)){job.percentages.slice(0,4).forEach((raw,i)=>{const value=Math.max(0,Math.min(100,Number(raw)||0));document.querySelector('#short-progress-'+(i+1)).value=value;document.querySelector('#short-percent-'+(i+1)).textContent=value+'%';});}
   if(job.status==='error')throw new Error(job.progress);
   if(job.status==='done'){
    for(let i=0;i<job.clips.length;i++){
     const clip=job.clips[i], wrapper=document.createElement('div');
     const title=document.createElement('strong');title.textContent='Short '+(i+1)+' · '+clip.duration+'s';
     const fileResponse=await fetch(GENERATOR_API+clip.url,{headers:await generatorHeaders()});if(!fileResponse.ok)throw new Error('Could not download Short '+(i+1));const blobUrl=URL.createObjectURL(await fileResponse.blob());
     const video=document.createElement('video');video.controls=true;video.preload='metadata';video.src=blobUrl;video.style.cssText='display:block;max-height:360px;width:100%;background:#000';
     const link=document.createElement('a');link.href=blobUrl;link.download='clipstudio-short-'+(i+1)+'.mp4';link.textContent='Download MP4';link.target='_blank';
     wrapper.append(title,video,link);results.append(wrapper);
    }
    done=true;break;
   }
  }
  if(!done)throw new Error('Timed out waiting for generator');
 }catch(err){status.textContent='Error: '+err.message;}
 finally{button.disabled=false;refreshQuota();}
}

async function exportClip(){const f=document.querySelector('#project-form');const file=state.selectedFile;if(!file)return flash('Choose a local video file first. YouTube URLs cannot be downloaded by this version.',true);const fd=new FormData(f),start=Number(fd.get('start')),end=Number(fd.get('end'));if(!Number.isFinite(start)||!Number.isFinite(end)||end<=start||start<0)return flash('Invalid time range.',true);const status=document.querySelector('#export-status');const button=document.querySelector('#export-video');button.disabled=true;status.textContent=t('working');try{if(!ffmpegInstance){ffmpegInstance=new FFmpeg();ffmpegInstance.on('log',({message})=>{if(status&&message.includes('time='))status.textContent=message.slice(-110);});const base='https://unpkg.com/@ffmpeg/core@0.12.10/dist/umd';await ffmpegInstance.load({coreURL:await toBlobURL(`${base}/ffmpeg-core.js`,'text/javascript'),wasmURL:await toBlobURL(`${base}/ffmpeg-core.wasm`,'application/wasm')});}const input='input_'+Date.now()+'.'+(file.name.split('.').pop()||'mp4').replace(/[^a-z0-9]/gi,'');const output='clip_'+Date.now()+'.mp4';await ffmpegInstance.writeFile(input,await fetchFile(file));const code=await ffmpegInstance.exec(['-ss',String(start),'-i',input,'-t',String(end-start),'-vf','scale=720:1280:force_original_aspect_ratio=increase,crop=720:1280','-r','25','-c:v','libx264','-preset','ultrafast','-crf','28','-c:a','aac','-b:a','128k','-movflags','+faststart',output]);if(code!==0)throw new Error('Video export failed. Try a shorter clip or another browser.');const bytes=await ffmpegInstance.readFile(output);const blob=new Blob([bytes],{type:'video/mp4'});const link=document.createElement('a');const blobUrl=URL.createObjectURL(blob);link.href=blobUrl;link.download=(String(fd.get('title')||'clip').replace(/[^\w-]/g,'_')||'clip')+'.mp4';link.click();setTimeout(()=>URL.revokeObjectURL(blobUrl),60000);await ffmpegInstance.deleteFile(input);await ffmpegInstance.deleteFile(output);if(state.editing){const {error}=await supabase.from('projects').update({status:'exported',updated_at:new Date().toISOString()}).eq('id',state.editing);if(!error)await logActivity('clip_exported',state.editing,link.download);}await loadData();status.textContent='✓ '+t('download');}catch(err){console.error(err);status.textContent=safeError(err);}finally{button.disabled=false;}}
render();
if(supabase){supabase.auth.onAuthStateChange((event,session)=>{if(event==='PASSWORD_RECOVERY'){state.user=null;state.authMode='update';state.page='auth';render();return;}if(event==='SIGNED_OUT'){state.user=null;state.page='home';state.projects=[];state.activity=[];state.profile=null;render();return;}if(session?.user&&session.user.id!==state.user?.id){setTimeout(()=>signedIn(session.user),0);}});supabase.auth.getSession().then(({data,error})=>{if(error)return flash(safeError(error),true);if(data.session?.user&&state.authMode!=='update')signedIn(data.session.user);}).catch(err=>flash(safeError(err),true));}

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
const state={user:null,page:'home',authMode:'login',lang:localStorage.getItem('clipstudio-lang')||'en',theme:localStorage.getItem('clipstudio-theme')||'system',projects:[],activity:[],profile:null,notice:'',error:false,working:false,selectedFile:null,editing:null,downloadUrl:null,mediaPlatform:'youtube',menuOpen:false,generatedShort:null};
if(!dict[state.lang])state.lang='en';
const t=(key)=>dict[state.lang]?.[key]||dict.en[key]||key;
const mediaMessages={
 en:{nav:'Social Downloader',heading:'Download videos from YouTube, Instagram, TikTok & Facebook',subtitle:'Choose a platform and paste the link to a public video you are authorized to download.',url:'Video link',preview:'Video information',format:'Format',quality:'Video quality',download:'Prepare download',rights:'I own this video or have permission to download it.',available:'Available source resolutions',fallback:'A lower resolution will be used if the chosen quality is unavailable. Upscaling is not performed.',audio:'MP3 audio · 192 kbps',working:'Preparing your download…',ready:'Your file is ready!',save:'Download file',quota:'Daily usage',clipQuota:'Shorts',mediaQuota:'Downloads',unlimited:'Unlimited',remaining:'remaining',reset:'Resets at midnight UTC',previewLoading:'Loading video thumbnail…',previewError:'Preview unavailable. The video may be private or require a login.',enterUrl:'Paste a video link first.',confirmRights:'Confirm that you have permission to download this content.',onlineWarning:'The video server must be running and publicly reachable. Cloudflare hosts the interface only.',duration:'Duration',status:'Status',choosePlatform:'Choose a platform',unsupported:'Choose a video from YouTube, Instagram, TikTok or Facebook.',mp4Note:'MP4 is prepared for mobile playback (H.264 video + AAC audio). Very high resolutions may exceed device capabilities.'},
 fr:{nav:'Téléchargement réseaux sociaux',heading:'Télécharger depuis YouTube, Instagram, TikTok et Facebook',subtitle:'Choisissez une plateforme et collez un lien public que vous êtes autorisé à télécharger.',url:'Lien de la vidéo',preview:'Aperçu de la vidéo',format:'Format',quality:'Qualité vidéo',download:'Préparer le téléchargement',rights:'Je possède cette vidéo ou je suis autorisé à la télécharger.',available:'Résolutions disponibles',fallback:'Si la qualité demandée est indisponible, la meilleure qualité inférieure sera utilisée. Pas d’agrandissement artificiel.',audio:'Audio MP3 · 192 kb/s',working:'Préparation du téléchargement…',ready:'Votre fichier est prêt !',save:'Télécharger le fichier',quota:'Utilisation quotidienne',clipQuota:'Shorts',mediaQuota:'Téléchargements',unlimited:'Illimité',remaining:'restants',reset:'Remise à zéro à minuit UTC',previewLoading:'Chargement de la miniature…',previewError:'Miniature indisponible. Vérifiez le lien et le serveur.',enterUrl:'Collez d’abord un lien vidéo.',confirmRights:'Confirmez votre droit de télécharger cette vidéo.',onlineWarning:'Le serveur vidéo doit fonctionner et être accessible en ligne. Cloudflare héberge uniquement l’interface.',duration:'Durée',status:'Statut',choosePlatform:'Choisir une plateforme',unsupported:'Choisissez une vidéo de YouTube, Instagram, TikTok ou Facebook.',mp4Note:'MP4 compatible avec les mobiles (vidéo H.264 + audio AAC). Les résolutions extrêmes ne fonctionnent pas sur tous les appareils.'},
 ar:{nav:'تحميل الفيديوهات',heading:'تحميل فيديوهات YouTube وInstagram وTikTok وFacebook',subtitle:'اختر المنصة وألصق رابط فيديو عام تملكه أو لديك إذن بتحميله.',url:'رابط الفيديو',preview:'معاينة الفيديو',format:'الصيغة',quality:'جودة الفيديو',download:'تحضير التحميل',rights:'أنا أملك هذا الفيديو أو لدي إذن بتحميله.',available:'الجودات الموجودة في المصدر',fallback:'إذا لم تتوفر الجودة المختارة فسيتم استعمال أفضل جودة أقل منها، بدون تكبير اصطناعي.',audio:'صوت MP3 · 192 كيلوبت/ث',working:'جاري تحضير الملف…',ready:'الملف جاهز!',save:'تحميل الملف',quota:'الاستخدام اليومي',clipQuota:'الشورتات',mediaQuota:'التحميلات',unlimited:'غير محدود',remaining:'متبقية',reset:'يتجدد الرصيد عند منتصف الليل UTC',previewLoading:'جاري جلب الصورة المصغرة…',previewError:'تعذر جلب الصورة. تحقق من الرابط والسيرفر.',enterUrl:'ألصق رابط الفيديو أولاً.',confirmRights:'أكد أنك تملك حق تحميل الفيديو.',onlineWarning:'يجب أن يكون سيرفر الفيديو شغالاً ومتاحاً عبر الإنترنت. Cloudflare يستضيف الواجهة فقط.',duration:'المدة',status:'الحالة',choosePlatform:'اختر المنصة',unsupported:'أدخل رابط فيديو من YouTube أو Instagram أو TikTok أو Facebook.',mp4Note:'ملف MP4 يحتوي على صورة H.264 وصوت AAC لتوافق أفضل مع الهواتف. الدقة العالية جداً قد لا تدعمها بعض الأجهزة.'},
 es:{nav:'Descargas de redes sociales',heading:'Descargar de YouTube, Instagram, TikTok y Facebook',subtitle:'Elige una plataforma y pega un enlace público que tengas permiso para descargar.',url:'Enlace del video',preview:'Vista previa',format:'Formato',quality:'Calidad de video',download:'Preparar descarga',rights:'Soy propietario o tengo permiso para descargar este video.',available:'Resoluciones disponibles',fallback:'Se usará la mejor resolución inferior si no está disponible. No se amplía artificialmente.',audio:'Audio MP3 · 192 kbps',working:'Preparando descarga…',ready:'¡Archivo listo!',save:'Descargar archivo',quota:'Uso diario',clipQuota:'Shorts',mediaQuota:'Descargas',unlimited:'Ilimitado',remaining:'restantes',reset:'Se reinicia a medianoche UTC',previewLoading:'Cargando miniatura…',previewError:'No se pudo cargar la miniatura. Revisa el enlace y el servidor.',enterUrl:'Primero pega un enlace de video.',confirmRights:'Confirma que tienes permiso para descargarlo.',onlineWarning:'El servidor de video debe estar en ejecución y accesible. Cloudflare aloja solamente la interfaz.',duration:'Duración',status:'Estado',choosePlatform:'Elegir plataforma',unsupported:'Elige un vídeo de YouTube, Instagram, TikTok o Facebook.',mp4Note:'MP4 preparado para móviles (H.264 + AAC). Los dispositivos pueden no soportar resoluciones extremas.',}
};
const mt=key=>mediaMessages[state.lang]?.[key]||mediaMessages.en[key]||key;
const generatorMessages={
 ar:{source:'معاينة الفيديو المصدر',loading:'جاري جلب معلومات الفيديو...',unavailable:'تعذر جلب المعلومات الإضافية. الصورة المصغرة ظاهرة إذا كانت متاحة.',local:'الملف المحلي المختار سيُستعمل بدل الرابط.',download:'تحميل الفيديو المصدر',transcription:'تحليل الكلام والتفريغ الصوتي',selection:'اختيار أفضل 4 مقاطع',render:'إنشاء المقاطع الأربعة',clips:'تقدم كل Short',initial:'جاهز للبدء',ready:'اكتمل',noTotal:'عند عدم معرفة حجم الفيديو، قد تبقى نسبة التحميل 0% حتى اكتماله.',
 },
 fr:{source:'Aperçu de la vidéo source',loading:'Chargement des informations vidéo…',unavailable:'Informations supplémentaires indisponibles. La miniature reste visible si accessible.',local:'Le fichier local sélectionné sera utilisé à la place du lien.',download:'Téléchargement de la vidéo source',transcription:'Transcription et analyse de la parole',selection:'Sélection des 4 meilleurs extraits',render:'Création des 4 Shorts',clips:'Progression par Short',initial:'Prêt à démarrer',ready:'Terminé',noTotal:'Si la taille est inconnue, le téléchargement peut afficher 0 % jusqu’à la fin.'},
 en:{source:'Source video preview',loading:'Loading video details…',unavailable:'Additional details unavailable. Thumbnail shown when accessible.',local:'The selected local file will be used instead of the link.',download:'Downloading source video',transcription:'Speech transcription and analysis',selection:'Selecting four clips',render:'Rendering four Shorts',clips:'Individual Short progress',initial:'Ready to start',ready:'Completed',noTotal:'If the file size is unknown, download progress may stay at 0% until complete.'},
 es:{source:'Vista previa del video',loading:'Cargando información…',unavailable:'No se pudieron cargar más detalles. Se muestra la miniatura si está disponible.',local:'Se usará el archivo local en lugar del enlace.',download:'Descargando video fuente',transcription:'Transcripción y análisis de voz',selection:'Selección de cuatro fragmentos',render:'Creación de cuatro Shorts',clips:'Progreso de cada Short',initial:'Listo para empezar',ready:'Completado',noTotal:'Si se desconoce el tamaño, la descarga puede mostrar 0% hasta completarse.'}
};
const gt=key=>generatorMessages[state.lang]?.[key]||generatorMessages.en[key]||key;
const GENERATOR_STAGES=['download','transcription','selection','render'];

const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const fmt=d=>new Date(d).toLocaleString(state.lang==='ar'?'ar-MA':state.lang,{dateStyle:'medium',timeStyle:'short'});
const safeError=e=>{const m=String(e?.message||e||t('error'));if(/Invalid API key/i.test(m))return 'Invalid API key: check that your .env.local Publishable Key and Project URL belong to the same Supabase project, then restart Vite.';return m;};
function flash(message,error=false){state.notice=message;state.error=error;render();}
// Browser URLs for every ClipStudio view (without changing the existing page renderer).
const PAGE_PATHS={home:'/',dashboard:'/dashboard',editor:'/editor',newclip:'/ai-shorts',downloads:'/downloads',library:'/projects',history:'/history',analytics:'/analytics',toolbox:'/tools',settings:'/settings',privacy:'/privacy-policy',terms:'/terms-of-service',contact:'/contact'};
const AUTH_PATHS={login:'/login',signup:'/signup',reset:'/forgot-password',update:'/update-password'};
const PRIVATE_PAGES=new Set(['dashboard','editor','newclip','downloads','library','history','analytics','toolbox','settings']);
function pathForPage(page){return page==='auth'?(AUTH_PATHS[state.authMode]||AUTH_PATHS.login):(PAGE_PATHS[page]||'/');}
function routeFromPath(path){const clean=path.replace(/\/+$/,'')||'/';for(const [mode,url] of Object.entries(AUTH_PATHS))if(url===clean)return {page:'auth',authMode:mode};for(const [page,url] of Object.entries(PAGE_PATHS))if(url===clean)return {page};return {page:'home'};}
function navigate(page,{replace=false}={}){const url=pathForPage(page);if(location.pathname!==url){window.history[replace?'replaceState':'pushState']({},'',url);}state.menuOpen=false;state.page=page;state.notice='';render();window.scrollTo(0,0);}
function setPage(page){navigate(page);}
function applyBrowserRoute(){const route=routeFromPath(location.pathname);if(route.authMode)state.authMode=route.authMode;state.page=PRIVATE_PAGES.has(route.page)&&!state.user?'auth':route.page;if(state.page==='auth'&&!route.authMode)state.authMode='login';state.menuOpen=false;render();window.scrollTo(0,0);}
window.addEventListener('popstate',applyBrowserRoute);
const initialRoute=routeFromPath(location.pathname);
if(initialRoute.authMode)state.authMode=initialRoute.authMode;
state.page=PRIVATE_PAGES.has(initialRoute.page)?'auth':initialRoute.page;

function applyTheme(){document.documentElement.dataset.theme=state.theme;document.documentElement.lang=state.lang;document.documentElement.dir=state.lang==='ar'?'rtl':'ltr';}
function logo(){return `<span class="logo"><span class="logo-mark">✂</span> Clip<span>Studio</span><small>FREE</small></span>`;}
function languageSelect(){return `<select id="quick-lang" aria-label="Language">${Object.entries(languages).map(([k,v])=>`<option value="${k}" ${state.lang===k?'selected':''}>${v}</option>`).join('')}</select>`;}
function header(){return `<header class="topbar"><button class="brand" data-page="${state.user?'dashboard':'home'}">${logo()}</button><nav class="topnav"><button data-page="home">${t('home')}</button>${state.user?`<button data-page="dashboard">${t('dashboard')}</button><button data-page="newclip">${t('newclip')}</button><button data-page="downloads">${mt('nav')}</button>`:`<button data-scroll="features">${t('features')}</button>`}</nav><div class="head-actions">${languageSelect()}${state.user?`<button class="btn ghost" data-page="settings">⚙</button><button class="btn outline" id="logout-top">${t('logout')}</button>`:`<button class="btn ghost" data-auth="login">${t('login')}</button><button class="btn primary" data-auth="signup">${t('try')} ↗</button>`}</div></header>`;}
function landing(){return `${header()}<main><section class="hero"><div class="hero-copy"><div class="pill">✦ CLIPSTUDIO FREE · CREATOR WORKSPACE</div><h1>${t('hero')}</h1><p>${t('sub')}</p><div class="hero-buttons"><button class="btn primary large" data-auth="signup">${t('try')} →</button><button class="btn outline large" data-auth="login">${t('login')}</button></div><div class="trust"><span>✓ 9:16 MP4</span><span>✓ 4 languages</span><span>✓ Private projects</span></div></div><div class="hero-art" aria-hidden="true"><div class="orb orb-a"></div><div class="orb orb-b"></div><div class="character"><div class="hair"></div><div class="face"><div class="eyes">● &nbsp; ●</div><div class="smile">⌣</div></div><div class="headphones">◖ &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp; ◗</div><div class="shirt">▶</div></div><div class="floating-card card-one">▶ <b>00:34</b><span> LONG VIDEO</span></div><div class="floating-card card-two">✂ <b>9:16</b><span> SHORT CLIP</span></div><div class="spark">✦</div></div></section><section id="features" class="section"><div class="section-heading"><span class="eyebrow">WHAT YOU GET</span><h2>${t('features')}</h2></div><div class="features"><article class="feature"><div class="feature-icon">✂</div><h3>${t('feature1')}</h3><p>${t('feature1d')}</p></article><article class="feature"><div class="feature-icon">▤</div><h3>${t('feature2')}</h3><p>${t('feature2d')}</p></article><article class="feature"><div class="feature-icon">✦</div><h3>${t('feature3')}</h3><p>${t('feature3d')}</p></article></div></section><section class="section steps"><h2>${t('how')}</h2><div class="step-grid">${['step1','step2','step3'].map((s,i)=>`<div><strong>0${i+1}</strong><p>${t(s)}</p></div>`).join('')}</div><button class="btn primary large" data-auth="signup">${t('try')} →</button></section></main><footer>${t('footer')}</footer>`;}
function auth(){const mode=state.authMode;const reset=mode==='reset';const update=mode==='update';const title=mode==='login'?t('login'):mode==='signup'?t('signup'):reset?t('reset'):t('update');return `${header()}<main class="auth-layout"><section class="auth-aside"><span class="pill">CLIPSTUDIO FREE</span><h1>${t('authTitle')}</h1><p>${t('sub')}</p><div class="auth-decoration">✂ <span>▶</span> ✦</div></section><section class="auth-card"><button class="back-link" data-page="home">← ${t('back')}</button><h2>${title}</h2>${!configured?`<div class="alert error">${t('notConfigured')}</div>`:''}<form id="auth-form">${mode==='signup'?`<label>${t('name')}<input name="name" maxlength="80" autocomplete="name" /></label>`:''}${!update?`<label>${t('email')}<input name="email" type="email" autocomplete="email" required /></label>`:''}${!reset?`<label>${t('password')}<input name="password" type="password" minlength="8" autocomplete="${mode==='login'?'current-password':'new-password'}" required /></label>`:''}<button class="btn primary full" type="submit" ${!configured?'disabled':''}>${reset?t('send'):update?t('update'):title} →</button></form>${['login','signup'].includes(mode)?`<div class="divider-text">${t('or')}</div><button id="google" class="btn google full" ${!configured?'disabled':''}><span class="google-g">G</span>${t('google')}</button>`:''}<div class="auth-links">${mode==='login'?`<button data-auth="reset">${t('forgot')}</button><button data-auth="signup">${t('noaccount')}</button>`:`<button data-auth="login">${t('haveaccount')}</button>`}</div></section></main>`;}
const studioMenu=[
 ['dashboard','◫','Dashboard'],['editor','🎬','Video Editor'],['newclip','✂','AI Shorts Generator'],['downloads','⬇','Social Downloader'],
 ['library','▤','My Video Library'],['history','◷','History'],['analytics','▥','Analytics Dashboard'],
 ['toolbox','✦','AI & More Tools'],['settings','⚙','Settings']
];
function sidebar(){return `<aside class="sidebar ${state.menuOpen?'menu-open':''}" id="studio-sidebar" aria-label="ClipStudio navigation"><div class="sidebar-logo">${logo()}<button id="menu-close" class="menu-close" aria-label="Close menu">✕</button></div><div class="nav-label">WORKSPACE</div>${studioMenu.map(([page,ico,name])=>`<button class="side-link ${state.page===page?'active':''}" data-page="${page}"><span>${ico}</span>${name}</button>`).join('')}<div class="sidebar-bottom"><div class="avatar">${esc((state.user?.email||'U')[0].toUpperCase())}</div><div class="sidebar-email">${esc(state.user?.email||'')}</div><button id="logout" class="side-link">↪ ${t('logout')}</button></div></aside>`;}
function workspace(content){return `<div class="app-layout"><button type="button" class="menu-backdrop ${state.menuOpen?'show':''}" id="menu-backdrop" aria-label="Close navigation"></button>${sidebar()}<div class="app-main"><div class="workspace-head"><div class="workspace-title-row"><button id="menu-toggle" type="button" class="menu-toggle" aria-label="Open navigation" aria-expanded="${state.menuOpen}">☰</button><span class="breadcrumb">CLIPSTUDIO / ${esc(studioMenu.find(m=>m[0]===state.page)?.[2]||state.page)}</span></div><div class="workspace-head-actions">${languageSelect()} <button id="theme-cycle" class="icon-button" title="Theme">◐</button><button id="logout-mobile" class="btn outline mobile-signout">↪ ${t('logout')}</button></div></div>${content}</div></div>`;}
function analytics(){const total=state.projects.length;const exported=state.projects.filter(p=>p.status==='exported').length;const sources=state.projects.reduce((a,p)=>{const k=p.source_type||'other';a[k]=(a[k]||0)+1;return a;},{});return workspace(`<div class="page-title"><h1>Analytics Dashboard</h1><p>Private account statistics from Supabase. Not social-media view analytics.</p></div><div class="stats"><div class="stat"><span>Projects</span><strong>${total}</strong></div><div class="stat"><span>Exports logged</span><strong>${exported}</strong></div><div class="stat"><span>Activity events</span><strong>${state.activity.length}</strong></div></div><div class="panel"><h2>Source types</h2>${Object.entries(sources).map(([k,v])=>`<p>${esc(k)}: ${v}</p>`).join('')||'<p>No data yet.</p>'}</div>`);}
const featureCatalog=[
 ['AI Viral Moments','Planned — scoring is not a guarantee of virality'],['Automatic Captions','V13: timed speech captions, templates, size 18–400, MP4 burn-in via backend'],['AI Auto Reframe','Planned — current 9:16 crop does not track faces'],['Playlist Downloader','Playlist preview for up to 30 YouTube entries'],['Video Quality Selector','Available for single-video downloads'],['Download All as ZIP','Available for completed Shorts jobs'],['Resume Downloads','Planned — source-dependent'],['MP3 / WAV Export','Available for single-video downloads'],['Video Preview Editor','V13: dedicated Video Editor with local edits and auto captions'],['Live Progress Dashboard','Available during active generation'],['My Video Library','Project metadata in Supabase'],['Analytics Dashboard','Basic account metrics'],['Smart Queue','In-memory job queue'],['Dynamic Workers','Planned — fixed worker counts currently'],['Auto Cleanup','Basic temporary-job cleanup'],['Admin Panel','Planned — no insecure public admin controls'],['Permanent Domain','Requires your own domain and named Cloudflare Tunnel']
];
function toolbox(){return workspace(`<div class="page-title"><span class="eyebrow">CLIPSTUDIO · TOOLS</span><h1>✦ Creator Tools</h1><p>Playlist downloads, video analysis and processing tools.</p></div>
<div class="panel playlist-panel"><h2>▶ YouTube Playlist Downloader</h2><p>Inspect all available videos, select individual videos or Select All, then queue authorized downloads. Large playlists are loaded progressively.</p>
<form id="playlist-inspector"><label>Playlist URL</label><div class="smart-url"><input type="url" id="playlist-url" placeholder="https://www.youtube.com/playlist?list=..." required><button type="button" class="btn outline smart-paste" data-url-target="playlist-url">Paste</button></div><button type="submit" class="btn primary">🔎 Show playlist videos</button></form>
<div class="playlist-toolbar" id="playlist-toolbar" hidden><label class="check"><input type="checkbox" id="playlist-select-all"> <strong>Select All</strong></label><span id="playlist-count"></span></div>
<div id="playlist-results" class="playlist-results" aria-live="polite"></div>
<div class="playlist-actions"><label class="check"><input type="checkbox" id="playlist-rights"> I own or have permission to download the selected videos</label><label>Quality <select id="playlist-quality"><option value="430">430p</option><option value="720" selected>720p HD</option><option value="1080">1080p</option></select></label><button type="button" class="btn primary" id="playlist-download-batch" disabled>⬇ Download selected</button><p id="playlist-download-status" role="status"></p><div id="playlist-download-links"></div></div></div>
<div class="panel"><h2>My processing jobs</h2><button type="button" class="btn outline" id="refresh-my-jobs">Refresh jobs</button><div id="my-jobs-results" aria-live="polite"></div><h2>Admin overview (authorized accounts only)</h2><button type="button" class="btn outline" id="admin-overview">Check admin overview</button><div id="admin-results" aria-live="polite"></div></div><div class="tool-grid">${featureCatalog.map(([name,detail])=>`<article class="panel tool-card"><strong>${esc(name)}</strong><p>${esc(detail)}</p></article>`).join('')}</div>`);}

function projectCard(p){return `<article class="project-card"><div class="thumb"><span>▶</span><small>9:16</small></div><div class="project-info"><strong>${esc(p.title)}</strong><div class="meta">${fmt(p.created_at)} · ${t(p.status)}</div><div class="card-actions"><button data-edit="${p.id}">${t('edit')}</button><button class="danger" data-delete="${p.id}">${t('delete')}</button></div></div></article>`;}
function dashboard(){const exports=state.projects.filter(p=>p.status==='exported').length;return workspace(`<div class="page-title"><span class="eyebrow">YOUR CREATIVE SPACE</span><h1>${t('welcome')} ✦</h1><p>${esc(state.profile?.display_name||state.user?.email||'')}</p></div><div class="stats"><div class="stat"><span>${t('total')}</span><strong>${state.projects.length}</strong></div><div class="stat"><span>${t('exports')}</span><strong>${exports}</strong></div><div class="stat"><span>${t('activity')}</span><strong>${state.activity.length}</strong></div></div><div class="section-head"><h2>${t('recent')}</h2><button class="btn primary" data-page="newclip">+ ${t('newclip')}</button></div><div class="project-grid">${state.projects.length?state.projects.slice(0,6).map(projectCard).join(''):`<div class="empty">${t('empty')}</div>`}</div>`);}
function library(){return workspace(`<div class="section-head"><div><span class="eyebrow">YOUR WORK</span><h1>${t('library')}</h1></div><button class="btn primary" data-page="newclip">+ ${t('newclip')}</button></div><div class="project-grid">${state.projects.length?state.projects.map(projectCard).join(''):`<div class="empty">${t('empty')}</div>`}</div>`);}
function history(){return workspace(`<div class="page-title"><h1>${t('history')}</h1></div><div class="timeline">${state.activity.length?state.activity.map(a=>`<div class="timeline-row"><span class="timeline-dot"></span><div><strong>${esc(a.action.replaceAll('_',' '))}</strong><p>${esc(a.details||'')}</p><small>${fmt(a.created_at)}</small></div></div>`).join(''):`<div class="empty">${t('empty')}</div>`}</div>`);}
function editor(){const p=state.projects.find(p=>p.id===state.editing);return workspace(`<div class="page-title"><span class="eyebrow">VIDEO EDITOR</span><h1>🎬 Video Editor</h1><p>Upload your video, cut and split clips on the timeline, adjust speed, crop, color and audio, then export. AI Shorts generation is in its own page.</p></div><div class="quick-media-link"><button type="button" class="btn outline" data-page="downloads">⬇ ${mt('nav')} · MP4 / MP3</button></div><div id="generated-short-notice" class="v16-generated-notice" hidden>✂ Editing a generated Short. Change caption text and timings below, then export with captions.</div><div class="editor-grid"><div class="panel"><form id="project-form"><label>${t('title')}<input name="title" required maxlength="150" value="${esc(p?.title||'')}" placeholder="My next clip" /></label><label>${t('upload')}<input name="file" id="video-file" type="file" accept="video/*" /></label><div class="two-cols"><label>${t('start')}<input name="start" type="number" step="0.1" min="0" value="${p?.clip_start??0}" required /></label><label>${t('end')}<input name="end" type="number" step="0.1" min="0.1" value="${p?.clip_end??30}" required /></label></div><section class="v15-timeline" aria-label="Video editing timeline"><div class="v15-timeline-head"><strong>✂ Timeline · Split & Trim</strong><span id="v15-playhead">00:00.0</span></div><div class="v15-timeline-track" id="v15-track" role="list" aria-label="Video segments"></div><div class="v15-timeline-actions"><button type="button" class="btn outline" id="v15-split">✂ Split at playhead</button><button type="button" class="btn outline" id="v15-delete">🗑 Remove selected segment</button><button type="button" class="btn outline" id="v15-undo">↶ Undo</button><button type="button" class="btn outline" id="v15-reset-timeline">Reset timeline</button></div><small>Select a segment to seek to it. Splits and deletions are applied in the exported MP4.</small></section><fieldset class="v12-editor"><legend>🎬 Editing tools</legend><div class="two-cols"><label>Speed<select id="v12-speed"><option value="1">1×</option><option value="0.5">0.5×</option><option value="1.5">1.5×</option><option value="2">2×</option></select></label><label>Crop<select id="v12-crop"><option value="fill">9:16 Fill</option><option value="fit">9:16 Fit</option><option value="square">1:1</option><option value="landscape">16:9</option></select></label><label>Brightness<input id="v12-brightness" type="range" min="-0.5" max="0.5" step="0.05" value="0"></label><label>Contrast<input id="v12-contrast" type="range" min="0.5" max="2" step="0.1" value="1"></label><label>Saturation<input id="v12-saturation" type="range" min="0" max="2" step="0.1" value="1"></label><label>Volume<input id="v12-volume" type="range" min="0" max="200" step="10" value="100"></label><label>Fade in (seconds)<input id="v12-fade-in" type="number" min="0" max="5" step="0.5" value="0"></label><label>Fade out (seconds)<input id="v12-fade-out" type="number" min="0" max="5" step="0.5" value="0"></label></div><div class="v12-actions"><button class="btn outline" id="v12-mark-start" type="button">Set start at playhead</button><button class="btn outline" id="v12-mark-end" type="button">Set end at playhead</button><button class="btn outline" id="v12-reset" type="button">Reset effects</button></div><small>Export includes crop, color, speed, volume and fades. Caption templates are in AI Shorts Generator. This editor is focused on cutting and editing.</small></fieldset><div class="editor-buttons"><button class="btn outline" type="submit">${t('save')}</button><button class="btn primary" type="button" id="export-video" ${state.working?'disabled':''}>${state.working?t('working'):t('export')}</button></div><fieldset class="subtitle-controls v13-captions"><legend>✨ Auto Captions Studio</legend>
<p>Edit the generated captions, choose a style, and export your edited Short with captions.</p>
<div class="caption-presets" role="group" aria-label="Caption templates">
<button type="button" class="caption-preset active" data-caption-template="viral"><strong>🔥 Viral Pop</strong><span>YELLOW · BOLD</span></button>
<button type="button" class="caption-preset" data-caption-template="minimal"><strong>Minimal</strong><span>WHITE · CLEAN</span></button>
<button type="button" class="caption-preset" data-caption-template="box"><strong>Box</strong><span>WHITE · BLACK BOX</span></button>
<button type="button" class="caption-preset" data-caption-template="cinema"><strong>Cinema</strong><span>GOLD · SERIF</span></button>
</div>
<div class="two-cols">
<label>Caption text (manual fallback)<input id="caption-text" type="text" maxlength="150" value="YOUR NEXT VIRAL MOMENT" /></label>
<label>Font<select id="caption-font"><option>Arial Black</option><option>Arial</option><option>Impact</option><option>Georgia</option></select></label>
<label>Color<input id="caption-color" type="color" value="#ffe34d" /></label>
<label>Font size (18–400 px)<input id="caption-size" type="number" min="18" max="400" value="40" step="1" /><input id="caption-size-range" type="range" min="18" max="400" value="40" /></label>
<label>Position<select id="caption-position"><option value="bottom">Bottom</option><option value="center">Center</option><option value="top">Top</option></select></label>
<label>Style<select id="caption-style"><option value="clean">Clean</option><option value="boxed">Word Box</option></select></label>
<label>Animation<select id="caption-animation"><option value="pop">Pop</option><option value="none">None</option></select></label>
</div>
<div class="v12-actions"><button class="btn primary" type="button" id="auto-caption-run">✨ Generate Auto Captions</button><button class="btn outline" type="button" id="caption-burn-export">⬇ Export MP4 + Captions</button></div>
<label>Timed captions — edit each line as START | END | TEXT<textarea id="caption-cues" rows="7" placeholder="0.00 | 1.20 | Hello world"></textarea></label>
<div id="caption-status" role="status"></div><small>Requires the Python backend with faster-whisper and FFmpeg. Large font sizes are visible but may be clipped at 400 px. Caption export uses server processing.</small>
</fieldset></form></div><div class="panel preview-panel"><div class="preview-title" id="preview-ratio-label">PREVIEW · Original aspect ratio</div><div class="preview-frame" id="preview-frame"><video id="video-preview" controls playsinline></video><div id="caption-overlay" class="caption-overlay" hidden aria-live="off"></div><div class="preview-placeholder">▶<small>YOUR VIDEO PREVIEW</small></div></div><div class="notice">${t('subtitleNotice')}</div><div class="notice">${t('localNotice')}</div><div id="export-status" role="status"></div></div></div>`);}

function newclip(){return workspace(`<div class="page-title"><span class="eyebrow">AI SHORTS</span><h1>✂ AI Shorts Generator</h1><p>Generate 8 automatic Shorts, track processing, and customize auto captions. Use Video Editor for manual cutting.</p></div><div class="v15-cross-nav"><button type="button" class="btn outline" data-page="editor">🎬 Open Video Editor</button></div><div class="panel v15-generator-page"><form id="project-form"><label>YouTube video URL<div class="smart-url"><input id="shorts-source-url" name="source" type="url" placeholder="https://www.youtube.com/watch?v=..." /><button type="button" class="btn outline smart-paste" data-url-target="shorts-source-url">Paste</button></div></label><label>Or upload a video<input id="video-file" name="file" type="file" accept="video/*" /></label><div class="v15-generator-preview"><video id="video-preview" controls playsinline></video></div><section class="auto-generator" style="padding:18px;margin:18px 0;border:1px solid #7a7a7a;border-radius:14px"><h2>① Video source · AI Shorts Generator</h2><p>Paste a public YouTube link OR choose a local file above. No start/end times needed. Requires the Windows backend.</p><h3 class="generator-small-heading">${gt('source')}</h3><div id="generator-video-preview" class="generator-video-preview" hidden></div><div id="generator-preview-status" class="generator-preview-status" role="status"></div>
<div class="v17-source-download"><strong>Optional · Download the full source video</strong><p>Download a copy to your device only if you want. This is independent of AI generation.</p>
<label class="check"><input id="generator-download-rights" type="checkbox"> I own this video or have permission to download it.</label>
<button type="button" class="btn outline" id="generator-download-source">⬇ Download full video</button>
<div id="generator-download-status" role="status"></div><progress id="generator-download-progress" max="100" value="0" hidden></progress><div id="generator-download-result"></div></div><label>Clip length <select id="auto-seconds"><option value="30">30 seconds</option><option value="15">15 seconds</option><option value="45">45 seconds</option><option value="60">60 seconds</option></select></label><fieldset class="subtitle-controls v13-captions"><legend>② Auto Captions · choose before generating</legend>
<p>Choose the style applied to the 8 generated Shorts. Captions are transcribed automatically during generation.</p>
<div class="caption-presets" role="group" aria-label="Caption templates">
<button type="button" class="caption-preset active" data-caption-template="viral"><strong>🔥 Viral Pop</strong><span>YELLOW · BOLD</span></button>
<button type="button" class="caption-preset" data-caption-template="minimal"><strong>Minimal</strong><span>WHITE · CLEAN</span></button>
<button type="button" class="caption-preset" data-caption-template="box"><strong>Box</strong><span>WHITE · BLACK BOX</span></button>
<button type="button" class="caption-preset" data-caption-template="cinema"><strong>Cinema</strong><span>GOLD · SERIF</span></button>
</div>
<div class="two-cols">

<label>Font<select id="caption-font"><option>Arial Black</option><option>Arial</option><option>Impact</option><option>Georgia</option></select></label>
<label>Color<input id="caption-color" type="color" value="#ffe34d" /></label>
<label>Font size (18–400 px)<input id="caption-size" type="number" min="18" max="400" value="40" step="1" /><input id="caption-size-range" type="range" min="18" max="400" value="40" /></label>
<label>Position<select id="caption-position"><option value="bottom">Bottom</option><option value="center">Center</option><option value="top">Top</option></select></label>
<label>Style<select id="caption-style"><option value="clean">Clean</option><option value="boxed">Word Box</option></select></label>
<label>Animation<select id="caption-animation"><option value="pop">Pop</option><option value="none">None</option></select></label>
</div>



</fieldset><fieldset class="facecam-layouts"><legend>③ Video layout · Facecam & Gameplay</legend><p>Automatic searches for a stable streamer webcam across the frame. If none is found, gameplay-only is used.</p><div class="facecam-layout-grid">${[['auto','Auto detect','Top if found'],['face_top','Facecam top','Gameplay below'],['face_center','Facecam center','Gameplay background'],['face_bottom','Facecam bottom','Gameplay above'],['face_left','Facecam left','Gameplay right'],['gameplay','Gameplay only','No webcam']].map(([id,name,detail])=>`<label class="facecam-layout-option"><input type="radio" name="video-layout" value="${id}" ${id==='auto'?'checked':''}/><span class="layout-icon ${id}"><i></i><b></b></span><strong>${name}</strong><small>${detail}</small></label>`).join('')}</div></fieldset><h3>④ Generate your 8 Shorts</h3><button class="btn primary" id="auto-generate" type="button">Generate 8 Shorts automatically</button><div id="auto-status" role="status" style="margin:12px 0"></div><div id="quota-feedback" class="quota-feedback" aria-live="polite"></div><div id="generator-stage-progress" class="generator-stage-progress" aria-label="Generation stages">${GENERATOR_STAGES.map(key=>`<div class="generator-stage-item"><div class="clip-progress-heading"><strong>${gt(key)}</strong><output id="stage-percent-${key}">0%</output></div><progress id="stage-progress-${key}" max="100" value="0"></progress></div>`).join('')}</div><p class="generator-help">${gt('noTotal')}</p><h3 class="generator-small-heading">${gt('clips')}</h3><div id="auto-progress" class="auto-progress" aria-label="Progression des huit Shorts"><div class="clip-progress"><div class="clip-progress-heading"><strong>Short 1</strong><span id="short-percent-1">0%</span></div><progress id="short-progress-1" max="100" value="0"></progress></div><div class="clip-progress"><div class="clip-progress-heading"><strong>Short 2</strong><span id="short-percent-2">0%</span></div><progress id="short-progress-2" max="100" value="0"></progress></div><div class="clip-progress"><div class="clip-progress-heading"><strong>Short 3</strong><span id="short-percent-3">0%</span></div><progress id="short-progress-3" max="100" value="0"></progress></div><div class="clip-progress"><div class="clip-progress-heading"><strong>Short 4</strong><span id="short-percent-4">0%</span></div><progress id="short-progress-4" max="100" value="0"></progress></div><div class="clip-progress"><div class="clip-progress-heading"><strong>Short 5</strong><span id="short-percent-5">0%</span></div><progress id="short-progress-5" max="100" value="0"></progress></div><div class="clip-progress"><div class="clip-progress-heading"><strong>Short 6</strong><span id="short-percent-6">0%</span></div><progress id="short-progress-6" max="100" value="0"></progress></div><div class="clip-progress"><div class="clip-progress-heading"><strong>Short 7</strong><span id="short-percent-7">0%</span></div><progress id="short-progress-7" max="100" value="0"></progress></div><div class="clip-progress"><div class="clip-progress-heading"><strong>Short 8</strong><span id="short-percent-8">0%</span></div><progress id="short-progress-8" max="100" value="0"></progress></div></div><div id="auto-results" style="display:grid;gap:14px"></div></section></form></div>`);}

const SOCIAL_PLATFORMS=['youtube','instagram','tiktok','facebook'];
const SOCIAL_PLACEHOLDERS={
 youtube:'https://www.youtube.com/watch?v=…',
 instagram:'https://www.instagram.com/reel/…',
 tiktok:'https://www.tiktok.com/@creator/video/…',
 facebook:'https://www.facebook.com/reel/…'
};
function mediaPlatformFromUrl(raw){
 try{
  const u=new URL(raw);if(u.protocol!=='https:')return '';
  const h=u.hostname.toLowerCase();
  if(['youtube.com','www.youtube.com','m.youtube.com','youtu.be'].includes(h))return 'youtube';
  if(['instagram.com','www.instagram.com','m.instagram.com','instagr.am','www.instagr.am'].includes(h))return 'instagram';
  if(['tiktok.com','www.tiktok.com','m.tiktok.com','vm.tiktok.com','vt.tiktok.com'].includes(h))return 'tiktok';
  if(['facebook.com','www.facebook.com','m.facebook.com','web.facebook.com','fb.watch','www.fb.watch','fb.com','www.fb.com'].includes(h))return 'facebook';
 }catch{}return '';
}
function mediaPlatformIcon(platform){
 const base='class="brand-svg" viewBox="0 0 32 32" width="34" height="34" role="img" aria-label="'+platform+'"';
 if(platform==='youtube')return `<svg ${base}><rect x="2" y="6" width="28" height="20" rx="6" fill="#FF0033"/><path d="m13 11 10 5-10 5Z" fill="#fff"/></svg>`;
 if(platform==='instagram')return `<svg ${base}><defs><linearGradient id="brand-instagram" x1="0" y1="1" x2="1" y2="0"><stop stop-color="#ffd776"/><stop offset=".35" stop-color="#f34c65"/><stop offset=".7" stop-color="#c3299c"/><stop offset="1" stop-color="#6549c7"/></linearGradient></defs><rect x="2" y="2" width="28" height="28" rx="8" fill="url(#brand-instagram)"/><rect x="8" y="8" width="16" height="16" rx="5" fill="none" stroke="#fff" stroke-width="2.2"/><circle cx="16" cy="16" r="4.1" fill="none" stroke="#fff" stroke-width="2.2"/><circle cx="22" cy="10" r="1.4" fill="#fff"/></svg>`;
 if(platform==='tiktok')return `<svg ${base}><rect x="2" y="2" width="28" height="28" rx="7" fill="#101014"/><path d="M19 7c.2 5.1 2.7 6.6 6.4 6.6v4c-2.3 0-4.6-.9-6.4-2v7.1c0 7.3-11.7 7.6-11.7.1 0-4.4 3.8-7.1 8-6.1v4c-2.5-.8-4 1-4 2.9 0 3 4.7 3.3 4.7-.6V7Z" fill="#25F4EE" transform="translate(-1,1)"/><path d="M19 7c.2 5.1 2.7 6.6 6.4 6.6v4c-2.3 0-4.6-.9-6.4-2v7.1c0 7.3-11.7 7.6-11.7.1 0-4.4 3.8-7.1 8-6.1v4c-2.5-.8-4 1-4 2.9 0 3 4.7 3.3 4.7-.6V7Z" fill="#FE2C55" transform="translate(1,-1)"/><path d="M19 7c.2 5.1 2.7 6.6 6.4 6.6v4c-2.3 0-4.6-.9-6.4-2v7.1c0 7.3-11.7 7.6-11.7.1 0-4.4 3.8-7.1 8-6.1v4c-2.5-.8-4 1-4 2.9 0 3 4.7 3.3 4.7-.6V7Z" fill="#fff"/></svg>`;
 return `<svg ${base}><rect x="2" y="2" width="28" height="28" rx="7" fill="#0866FF"/><path d="M19 28V18h3.3l.5-4H19v-2.4c0-1.1.4-1.8 1.9-1.8H23V6.3c-.4-.1-1.8-.3-3.3-.3-3.4 0-5.6 2-5.6 5.7V14h-3v4h3v10Z" fill="#fff"/></svg>`;
}
function mediaPlatformPicker(){
 return `<div class="media-platform-picker"><strong class="media-platform-label">${mt('choosePlatform')}</strong><div class="media-platform-grid">${SOCIAL_PLATFORMS.map(platform=>`<button type="button" class="media-platform-choice ${state.mediaPlatform===platform?'selected':''}" data-platform="${platform}" aria-pressed="${state.mediaPlatform===platform}">${mediaPlatformIcon(platform)}<span>${platform==='youtube'?'YouTube':platform==='tiktok'?'TikTok':platform==='instagram'?'Instagram':'Facebook'}</span></button>`).join('')}</div></div>`;
}
function downloads(){return workspace(`<div class="page-title"><span class="eyebrow">CLIPSTUDIO · MEDIA</span><h1>⬇ ${mt('heading')}</h1><p>${mt('subtitle')}</p></div>
<div class="panel media-panel">
<form id="media-form">
${mediaPlatformPicker()}
<label>${mt('url')}<div class="smart-url"><input id="media-url" type="url" name="url" autocomplete="off" inputmode="url" placeholder="${SOCIAL_PLACEHOLDERS[state.mediaPlatform]}" required /><button type="button" class="btn outline smart-paste" data-url-target="media-url">Paste</button></div></label>
<div id="media-preview-status" class="media-muted" role="status">${mt('preview')}</div>
<div id="media-preview" class="media-preview" hidden></div>
<div class="media-options"><label>${mt('format')}<select name="format" id="media-format"><option value="mp4">MP4 — Video</option><option value="mp3">MP3 — Audio</option><option value="wav">WAV — Audio</option></select></label><label id="media-quality-field">${mt('quality')}<select name="quality" id="media-quality"><option value="430">430p</option><option value="720" selected>720p (HD)</option><option value="1080">1080p (Full HD)</option><option value="2160">4K (2160p)</option><option value="4320">8K (4320p)</option></select></label></div>
<div id="media-quality-note" class="media-muted">${mt('fallback')}</div><div class="media-muted">${mt('mp4Note')}</div>
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

// Public informational pages. Review these policies against actual hosting and data practices before publishing.
const LEGAL_EMAIL='alaouirayane79@gmail.com';
const LEGAL_PHONE='0639682405';
// Reserved advertising area: no third-party scripts or tracking before approval.
function advertisingSlot(){return `<aside class="advertising-slot" aria-label="Advertising space"><small>Advertising space · Ads are not enabled yet</small></aside>`;}
function legalFooter(){return `<footer class="legal-footer"><span>© ${new Date().getFullYear()} ClipStudio</span><nav aria-label="Legal and contact"><button type="button" data-page="privacy">Privacy Policy</button><button type="button" data-page="terms">Terms of Service</button><button type="button" data-page="contact">Contact</button></nav></footer>`;}
function legalPage(kind){
 const privacy=`<h1>Privacy Policy</h1><p class="legal-note">Last updated: 21 November 2026 · Please review before public launch.</p>
 <h2>Information we process</h2><p>ClipStudio uses account information (such as email and profile details), uploaded or linked video content, and information needed to operate processing jobs. Account authentication and some account or project records may be handled through Supabase.</p>
 <h2>How information is used</h2><p>We use this information to authenticate accounts, process requested videos, display project results, prevent misuse, provide support, and improve reliability.</p>
 <h2>Uploads and third-party services</h2><p>Video links and uploads may be processed by the ClipStudio backend and relevant hosting services. Do not upload private or copyrighted material unless you have permission. Processing files may be retained temporarily; actual retention periods depend on the deployed backend configuration.</p>
 <h2>Cookies, analytics and advertising</h2><p>Authentication and interface preferences may use browser storage. If analytics or advertising services such as Google AdSense are enabled, this policy must be updated to identify those services, explain their data use, and provide any legally required consent choices before ads are activated.</p>
 <h2>Security and your choices</h2><p>We take reasonable steps to protect data, but no online service can guarantee absolute security. Contact us to request information about or deletion of account-related data, subject to applicable obligations.</p>
 <h2>Contact</h2><p>Email: <a href="mailto:${LEGAL_EMAIL}">${LEGAL_EMAIL}</a></p>`;
 const terms=`<h1>Terms of Service</h1><p class="legal-note">Last updated: 21 November 2026 · Draft for review before public launch.</p>
 <h2>Using ClipStudio</h2><p>ClipStudio provides tools for editing, clipping and processing video content. You must use the service lawfully and comply with applicable platform rules.</p>
 <h2>Content and permissions</h2><p>You must own or have permission to download, upload, edit and distribute any content you submit. You remain responsible for your content and how you use generated clips. ClipStudio does not grant rights to third-party videos.</p>
 <h2>Accounts and fair use</h2><p>Keep your account credentials secure. Automated abuse, attempts to bypass quotas, and interference with the service are prohibited. Any displayed generation limits are subject to the actual limits enforced by the deployed backend.</p>
 <h2>Availability and outputs</h2><p>Processing may fail due to unsupported files, platform restrictions, network errors, or server capacity. AI-generated results may be inaccurate and should be reviewed before publication. We cannot guarantee uninterrupted availability or particular results.</p>
 <h2>Changes and contact</h2><p>We may update these terms and display an updated date. Questions: <a href="mailto:${LEGAL_EMAIL}">${LEGAL_EMAIL}</a>.</p>`;
 const contact=`<h1>Contact ClipStudio</h1><p>For support, feedback, privacy questions, or business inquiries, contact us using the details below.</p><div class="contact-options"><a href="mailto:${LEGAL_EMAIL}">✉ ${LEGAL_EMAIL}</a><a href="tel:+212639682405">☎ ${LEGAL_PHONE}</a></div><p class="legal-note">For technical support, include the feature name and the error message. Do not email passwords, private API keys, or access tokens.</p>`;
 const content=kind==='privacy'?privacy:kind==='terms'?terms:contact;
 return `${state.user?'':header()}<main class="legal-page"><article class="panel legal-content">${content}</article></main>${legalFooter()}`;
}
function render(){applyTheme();app.innerHTML=(['privacy','terms','contact'].includes(state.page)?legalPage(state.page):(state.user?({dashboard,library,history,newclip,editor,downloads,analytics,toolbox,settings,home:landing}[state.page]||dashboard)():state.page==='auth'?auth():landing()))+(!['privacy','terms','contact'].includes(state.page)?advertisingSlot()+legalFooter():'')+(state.notice?`<div class="toast ${state.error?'error':''}" role="status">${esc(state.notice)} <button id="close-toast">×</button></div>`:'');wire();}
function wire(){initSmartPaste();document.querySelector('#menu-toggle')?.addEventListener('click',()=>{state.menuOpen=!state.menuOpen;render();});document.querySelector('#menu-close')?.addEventListener('click',()=>{state.menuOpen=false;render();});document.querySelector('#menu-backdrop')?.addEventListener('click',()=>{state.menuOpen=false;render();});document.querySelectorAll('[data-page]').forEach(b=>b.onclick=()=>{const page=b.dataset.page;if(!state.user&&!['home','privacy','terms','contact'].includes(page)){state.authMode='login';setPage('auth');}else{if(page==='newclip'||page==='editor'){state.editing=null;state.selectedFile=null;state.generatedShort=null;}setPage(page);}});document.querySelectorAll('[data-auth]').forEach(b=>b.onclick=()=>{state.authMode=b.dataset.auth;setPage('auth');});document.querySelectorAll('[data-scroll]').forEach(b=>b.onclick=()=>document.getElementById(b.dataset.scroll)?.scrollIntoView({behavior:'smooth'}));document.querySelectorAll('#quick-lang').forEach(s=>s.onchange=()=>{state.lang=s.value;localStorage.setItem('clipstudio-lang',state.lang);render();});document.querySelector('#theme-cycle')?.addEventListener('click',()=>{state.theme=state.theme==='system'?'dark':state.theme==='dark'?'light':'system';localStorage.setItem('clipstudio-theme',state.theme);render();});document.querySelectorAll('#logout,#logout-top,#logout-mobile,#logout-settings').forEach(b=>b.onclick=async()=>{const {error}=await supabase.auth.signOut();if(error)flash(safeError(error),true);});document.querySelector('#close-toast')?.addEventListener('click',()=>{state.notice='';render();});document.querySelector('#auth-form')?.addEventListener('submit',submitAuth);document.querySelector('#google')?.addEventListener('click',async()=>{const {error}=await supabase.auth.signInWithOAuth({provider:'google',options:{redirectTo:location.origin+'/'} });if(error)flash(safeError(error),true);});document.querySelector('#project-form')?.addEventListener('submit',saveProject);document.querySelector('#video-file')?.addEventListener('change',e=>{state.selectedFile=e.target.files?.[0]||null;const v=document.querySelector('#video-preview');if(v){if(v.dataset.blob)URL.revokeObjectURL(v.dataset.blob);if(state.selectedFile){v.src=URL.createObjectURL(state.selectedFile);v.dataset.blob=v.src;document.querySelector('.preview-placeholder')?.remove();}else v.removeAttribute('src');}updateGeneratorLocalIndicator();if(state.page==='editor')initV15TimelineSource();});document.querySelector('#export-video')?.addEventListener('click',exportClip);document.querySelector('#auto-generate')?.addEventListener('click',generateFourShorts);initGeneratorSourcePreview();initV17OptionalDownload();initV17PreviewRatio();if(state.page==='newclip'){initSubtitlePreview();initV13Captions();}if(state.page==='editor'){initV12Editor();initV15Timeline();initSubtitlePreview();initV13Captions();restoreGeneratedShort();}initMediaPage();initV10Tools();initV11Tools();if(state.page==='newclip'||state.page==='editor'||state.page==='downloads')refreshQuota();document.querySelector('#settings-form')?.addEventListener('submit',saveSettings);document.querySelectorAll('[data-delete]').forEach(b=>b.onclick=()=>deleteProject(b.dataset.delete));document.querySelectorAll('[data-edit]').forEach(b=>b.onclick=()=>{state.editing=b.dataset.edit;state.selectedFile=null;setPage('newclip');});}
async function submitAuth(e){e.preventDefault();if(!supabase)return flash(t('notConfigured'),true);const b=e.submitter;b.disabled=true;const fd=new FormData(e.currentTarget),email=String(fd.get('email')||'').trim(),password=String(fd.get('password')||'');try{let res;if(state.authMode==='login')res=await supabase.auth.signInWithPassword({email,password});else if(state.authMode==='signup')res=await supabase.auth.signUp({email,password,options:{emailRedirectTo:location.origin+'/',data:{display_name:String(fd.get('name')||'')}}});else if(state.authMode==='reset')res=await supabase.auth.resetPasswordForEmail(email,{redirectTo:location.origin+'/'});else res=await supabase.auth.updateUser({password});if(res.error)throw res.error;if(state.authMode==='reset')flash(t('resetSent'));else if(state.authMode==='signup')flash(t('signupSent'));else if(state.authMode==='update'){state.authMode='login';flash(t('saved'));}else if(res.data?.user)await signedIn(res.data.user);}catch(err){flash(safeError(err),true);}finally{b.disabled=false;}}
async function signedIn(user){state.user=user;const route=routeFromPath(location.pathname);const destination=PRIVATE_PAGES.has(route.page)?route.page:'dashboard';state.page=destination;state.notice='';await loadData();navigate(destination,{replace:true});}
async function loadData(){if(!supabase||!state.user)return;const uid=state.user.id;const [pr,ps,act]=await Promise.all([supabase.from('profiles').select('*').eq('id',uid).maybeSingle(),supabase.from('projects').select('*').order('created_at',{ascending:false}).limit(200),supabase.from('activity').select('*').order('created_at',{ascending:false}).limit(200)]);if(pr.error||ps.error||act.error){state.notice='Database not ready: run supabase/schema.sql in Supabase SQL Editor. '+safeError(pr.error||ps.error||act.error);state.error=true;}state.profile=pr.data||null;state.projects=ps.data||[];state.activity=act.data||[];if(!state.profile&&!pr.error){const name=state.user.user_metadata?.display_name||state.user.user_metadata?.full_name||'';const {error}=await supabase.from('profiles').insert({id:uid,display_name:name,language:state.lang,theme:state.theme});if(!error)state.profile={id:uid,display_name:name,language:state.lang,theme:state.theme};}if(state.profile){state.lang=state.profile.language||'en';state.theme=state.profile.theme||'system';localStorage.setItem('clipstudio-lang',state.lang);localStorage.setItem('clipstudio-theme',state.theme);}}
async function logActivity(action,projectId,details){const {error}=await supabase.from('activity').insert({user_id:state.user.id,project_id:projectId,action,details});if(error)console.warn('Activity log:',safeError(error));}
async function saveProject(e){e.preventDefault();const f=new FormData(e.currentTarget);const title=String(f.get('title')||'').trim(),source=String(f.get('source')||'').trim(),start=Number(f.get('start')),end=Number(f.get('end'));if(!title||!Number.isFinite(start)||!Number.isFinite(end)||start<0||end<=start)return flash('Check title and clip time range.',true);const data={user_id:state.user.id,title,source_url:source||null,source_type:source?'youtube':'upload',clip_start:start,clip_end:end,updated_at:new Date().toISOString()};try{let res;if(state.editing)res=await supabase.from('projects').update(data).eq('id',state.editing).select().single();else res=await supabase.from('projects').insert(data).select().single();if(res.error)throw res.error;await logActivity(state.editing?'project_updated':'project_created',res.data.id,title);state.editing=res.data.id;await loadData();flash(t('saved'));}catch(err){flash(safeError(err),true);}}
async function deleteProject(id){if(!window.confirm(t('confirmDelete')))return;const title=state.projects.find(p=>p.id===id)?.title||'';const {error}=await supabase.from('projects').delete().eq('id',id);if(error)return flash(safeError(error),true);await logActivity('project_deleted',null,title);await loadData();render();}
async function saveSettings(e){e.preventDefault();const f=new FormData(e.currentTarget);const lang=String(f.get('language')),theme=String(f.get('theme'));const data={id:state.user.id,display_name:String(f.get('display_name')||'').slice(0,80),language:lang,theme,updated_at:new Date().toISOString()};const {error}=await supabase.from('profiles').upsert(data);if(error)return flash(safeError(error),true);state.profile=data;state.lang=lang;state.theme=theme;localStorage.setItem('clipstudio-lang',lang);localStorage.setItem('clipstudio-theme',theme);flash(t('profileSaved'));}
let ffmpegInstance=null;
function parseCaptionCues(){
 const raw=document.querySelector('#caption-cues')?.value||'';
 const cues=[];
 for(const line of raw.split(/\\r?\\n/)){
  const match=line.match(/^\\s*(\\d+(?:\\.\\d+)?)\\s*\\|\\s*(\\d+(?:\\.\\d+)?)\\s*\\|\\s*(.+)$/);
  if(match){const start=Number(match[1]),end=Number(match[2]);if(end>start&&end-start<60)cues.push({start,end,text:match[3].slice(0,200)});}
 }
 return cues.slice(0,1500);
}
function initSubtitlePreview(){
 const overlay=document.querySelector('#caption-overlay');if(!overlay)return;
 const video=document.querySelector('#video-preview');
 const ids=['text','style','font','color','size','animation','position'];
 const els=Object.fromEntries(ids.map(id=>[id,document.querySelector('#caption-'+id)]));
 function update(){
  const size=Math.max(18,Math.min(400,Number(els.size?.value)||40));
  const cues=parseCaptionCues(),current=video?.currentTime||0;
  const cue=cues.find(c=>current>=c.start&&current<c.end);
  const phrase=cue?cue.text:(cues.length?'':(els.text?.value||'YOUR NEXT VIRAL MOMENT'));
  const words=phrase.trim().split(/\\s+/).slice(0,30);
  overlay.className='caption-overlay caption-'+els.position.value+' '+(els.style.value==='boxed'?'caption-boxed':'');
  overlay.style.setProperty('font-size',size+'px','important');
  overlay.style.fontFamily=els.font.value+',sans-serif';
  overlay.style.color=els.color.value;
  overlay.replaceChildren();
  words.forEach((word,i)=>{const span=document.createElement('span');span.textContent=word;span.className='caption-word'+(i===0?' active':'');if(i===0&&els.animation.value==='pop')span.classList.add('pop');overlay.append(span);});
 }
 Object.values(els).forEach(el=>el?.addEventListener('input',update));
 document.querySelector('#caption-cues')?.addEventListener('input',update);
 video?.addEventListener('timeupdate',update);update();
 window.clipstudioUpdateCaptionPreview=update;
}

const GENERATOR_API=String(import.meta.env.VITE_GENERATOR_API_URL||'http://127.0.0.1:8765').trim().replace(/\/+$/,'');
async function generatorHeaders(){const {data,error}=await supabase.auth.getSession();if(error||!data.session?.access_token)throw new Error('Please sign in again');return {Authorization:'Bearer '+data.session.access_token};}
async function refreshQuota(){
 const slot=document.querySelector('#quota-feedback'); if(!slot||!supabase)return;
 try{
  const response=await fetch(GENERATOR_API+'/limits',{headers:await generatorHeaders()});
  if(!response.ok)return;
  const data=await response.json();
  const count=k=>data[k]?.limit===0?mt('unlimited'):`${data[k]?.remaining} ${mt('remaining')} / ${data[k]?.limit}`;
  const queued=Number(data.queue?.shorts_waiting||0)+Number(data.queue?.downloads_waiting||0);
  const qlabel={ar:'طلبات في الانتظار',fr:'demandes en attente',en:'requests waiting',es:'solicitudes en espera'}[state.lang]||'requests waiting';
  slot.textContent=`${mt('quota')} · ${mt('clipQuota')}: ${count('shorts')} · ${mt('mediaQuota')}: ${count('downloads')} · ${mt('reset')} · ${queued} ${qlabel}`;
 }catch(err){slot.textContent=mt('onlineWarning');}
}

// Live queue information returned by Python; no guessed percentage while waiting.
function processingStatus(job){
 if(job.status!=='queued')return job.progress||'Processing…';
 const labels={ar:'طلبك في الانتظار، الترتيب',fr:'Demande en attente, position',
               es:'Solicitud en cola, posición',en:'Waiting in queue, position'};
 return `${labels[state.lang]||labels.en}: ${job.queue_position||'…'}`;
}
const LONG_POLL_LIMIT_MS=72*60*60*1000;

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
let generatorPreviewTimer=null;
let generatorPreviewController=null;
function updateGeneratorLocalIndicator(){
 const notice=document.querySelector('#generator-preview-status');
 if(notice&&state.selectedFile)notice.textContent=gt('local');
}
function initGeneratorSourcePreview(){
 const field=document.querySelector('#project-form input[name="source"]');
 const preview=document.querySelector('#generator-video-preview');
 const notice=document.querySelector('#generator-preview-status');
 if(!field||!preview||!notice)return;
 const show=()=>{
  clearTimeout(generatorPreviewTimer);generatorPreviewController?.abort();
  preview.replaceChildren();preview.hidden=true;notice.textContent='';
  const url=field.value.trim();const videoId=publicYoutubeId(url);
  if(!videoId){if(state.selectedFile)notice.textContent=gt('local');return;}
  const image=document.createElement('img');
  image.src=`https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`;
  image.loading='lazy';image.alt=gt('source');
  image.referrerPolicy='no-referrer';
  const details=document.createElement('div');details.className='generator-preview-details';
  const title=document.createElement('strong');title.textContent=gt('loading');
  const duration=document.createElement('small');duration.textContent='YouTube';
  details.append(title,duration);preview.append(image,details);preview.hidden=false;
  if(state.selectedFile)notice.textContent=gt('local');
  generatorPreviewTimer=setTimeout(async()=>{
   const controller=new AbortController();generatorPreviewController=controller;
   try{
    const form=new FormData();form.set('url',url);
    const response=await fetch(GENERATOR_API+'/media/info',{
      method:'POST',headers:await generatorHeaders(),body:form,signal:controller.signal
    });
    if(!response.ok)throw new Error('Metadata not available');
    const data=await response.json();
    if(controller.signal.aborted||field.value.trim()!==url||!preview.isConnected)return;
    if(data.thumbnail&&String(data.thumbnail).startsWith('https://'))image.src=data.thumbnail;
    title.textContent=data.title||'YouTube';
    duration.textContent=`${data.channel||'YouTube'} · ${mediaDuration(data.duration)}`;
   }catch(err){
    if(err.name==='AbortError'||field.value.trim()!==url||!preview.isConnected)return;
    title.textContent='YouTube';
    if(!state.selectedFile)notice.textContent=gt('unavailable');
   }
  },550);
 };
 field.addEventListener('input',show);field.addEventListener('change',show);
 if(field.value.trim())show();else updateGeneratorLocalIndicator();
}

function initMediaPage(){
 const form=document.querySelector('#media-form');if(!form)return;
 const url=form.querySelector('#media-url');
 const activate=platform=>{
  if(!SOCIAL_PLATFORMS.includes(platform))return;
  state.mediaPlatform=platform;
  document.querySelectorAll('[data-platform]').forEach(button=>{
   const selected=button.dataset.platform===platform;
   button.classList.toggle('selected',selected);
   button.setAttribute('aria-pressed',String(selected));
  });
  url.placeholder=SOCIAL_PLACEHOLDERS[platform];
 };
 document.querySelectorAll('[data-platform]').forEach(button=>button.addEventListener('click',()=>{
  const platform=button.dataset.platform;
  const previous=mediaPlatformFromUrl(url.value.trim());
  if(previous&&previous!==platform){url.value='';const box=document.querySelector('#media-preview');
   if(box){box.replaceChildren();box.hidden=true;}}
  mediaPreviewController?.abort();clearTimeout(mediaPreviewTimer);
  const status=document.querySelector('#media-preview-status');if(status)status.textContent='';
  activate(platform);
 }));
 url.addEventListener('input',()=>{
  const detected=mediaPlatformFromUrl(url.value.trim());if(detected)activate(detected);
  clearTimeout(mediaPreviewTimer);mediaPreviewController?.abort();
  const box=document.querySelector('#media-preview'),notice=document.querySelector('#media-preview-status');
  if(box){box.hidden=true;box.replaceChildren();}if(notice)notice.textContent='';
  if(!url.value.trim())return;
  if(!mediaPlatformFromUrl(url.value.trim()))return;
  const videoId=publicYoutubeId(url.value.trim());
  if(videoId&&box){
   const img=document.createElement('img');img.src=`https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`;img.alt='YouTube thumbnail';img.loading='lazy';
   const title=document.createElement('strong');title.textContent=mt('previewLoading');
   box.append(img,title);box.hidden=false;
  }
  mediaPreviewTimer=setTimeout(()=>previewMedia(url.value.trim()),650);
 });
 document.querySelector('#media-format')?.addEventListener('change',()=>{
  const audio=['mp3','wav'].includes(document.querySelector('#media-format').value);
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
  name.textContent=data.title||'Video';details.textContent=`${data.platform||''} · ${data.channel||''} · ${mt('duration')}: ${mediaDuration(data.duration)}`;
  content.append(name,details);
  if(data.heights?.length){const res=document.createElement('small');res.textContent=`${mt('available')}: ${data.heights.map(h=>h+'p').join(' · ')}`;content.append(res);}
  box.append(content);box.hidden=false;notice.textContent='';
 }catch(e){if(e.name!=='AbortError')notice.textContent='⚠ '+(e.message||mt('previewError'));}
}
// Only jobs started by this browser tab are tracked. Closing the tab requests
// cancellation; the backend also stops work when polling stops for 90 seconds.
const activeTabJobs=new Map();
let tabClosing=false;
async function cancelActiveJob(jobId){
 const token=activeTabJobs.get(jobId);
 if(!token)return;
 activeTabJobs.delete(jobId);
 try{await fetch(GENERATOR_API+'/jobs/'+encodeURIComponent(jobId)+'/cancel',{
  method:'POST',headers:{Authorization:'Bearer '+token},keepalive:true
 });}catch(e){console.warn('Cancellation request could not be delivered; backend timeout will stop it',e);}
}
function addCancelButton(container,jobId){
 const button=document.createElement('button');button.type='button';button.className='btn outline';
 button.textContent='✕ Cancel processing';button.style.marginTop='10px';
 button.onclick=async()=>{button.disabled=true;await cancelActiveJob(jobId);container.textContent='Cancelled. The server is releasing resources.';};
 container.after(button);
 return button;
}
window.addEventListener('pagehide',()=>{
 tabClosing=true;
 for(const [jobId,token] of activeTabJobs){
  fetch(GENERATOR_API+'/jobs/'+encodeURIComponent(jobId)+'/cancel',{
   method:'POST',headers:{Authorization:'Bearer '+token},keepalive:true
  }).catch(()=>{});
 }
 activeTabJobs.clear();
});
async function startMediaDownload(event){
 event.preventDefault();
 const form=event.currentTarget,button=form.querySelector('#media-start'),status=document.querySelector('#media-status'),bar=document.querySelector('#media-progress'),result=document.querySelector('#media-result');
 const formdata=new FormData(form);const url=String(formdata.get('url')||'').trim();
 if(!url){status.textContent=mt('enterUrl');return;}
 if(!mediaPlatformFromUrl(url)){status.textContent=mt('unsupported');return;}
 if(!form.querySelector('#media-rights').checked){status.textContent=mt('confirmRights');return;}
 button.disabled=true;result.replaceChildren();bar.hidden=false;bar.value=0;status.textContent=mt('working');
 try{
  const response=await fetch(GENERATOR_API+'/media/download',{method:'POST',headers:await generatorHeaders(),body:formdata});
  const started=await response.json();if(!response.ok)throw new Error(started.detail||'Download unavailable');
  activeTabJobs.set(started.job_id,(await generatorHeaders()).Authorization.slice(7));
  const cancelButton=addCancelButton(status,started.job_id);
  let completed=false, waitMs=2000;const deadline=Date.now()+LONG_POLL_LIMIT_MS;
  while(Date.now()<deadline){
   await new Promise(resolve=>setTimeout(resolve,waitMs));
   const poll=await fetch(GENERATOR_API+'/jobs/'+encodeURIComponent(started.job_id),{headers:await generatorHeaders()});
   const job=await poll.json();if(!poll.ok)throw new Error(job.detail||'Cannot check download');
   if(!activeTabJobs.has(started.job_id))throw new Error('Cancelled');
   status.textContent=processingStatus(job);waitMs=job.status==='queued'?8000:2000;bar.value=Math.max(0,Math.min(100,Number(job.percent)||0));
   if(job.status==='cancelled')throw new Error('Cancelled');
   if(job.status==='error')throw new Error(job.progress||'Download failed');
   if(job.status==='done'){
    const link=document.createElement('a');link.className='btn primary media-download-link';
    link.textContent='⬇ '+mt('save');link.href=GENERATOR_API+job.url;link.rel='noopener noreferrer';
    link.download=job.filename||'clipstudio.mp4';
    if(String(job.filename||'').toLowerCase().endsWith('.mp4')){
     const player=document.createElement('video');player.className='media-ready-preview';
     player.controls=true;player.playsInline=true;player.preload='metadata';player.src=link.href;
     result.replaceChildren(player,link);
    }else result.replaceChildren(link);
    activeTabJobs.delete(started.job_id);cancelButton.remove();
    status.textContent=mt('ready');bar.value=100;completed=true;break;
   }
  }
  if(!completed)throw new Error('Download processing timed out');
 }catch(e){status.textContent='⚠ '+(e.message||'Download failed');}
 finally{button.disabled=false;refreshQuota();}
}

// Animate each integer toward a *measured* percentage; never advance ahead of the API.
function generatorProgressAnimator(){
 const ids=[...GENERATOR_STAGES.map(k=>'stage-'+k),...Array.from({length:8},(_,i)=>'short-'+(i+1))];
 const targets=new Map(ids.map(id=>[id,0]));
 const shown=new Map(ids.map(id=>[id,0]));
 ids.forEach(id=>{const bar=document.querySelector('#'+id.replace('stage-','stage-progress-').replace('short-','short-progress-'));
  const output=document.querySelector('#'+id.replace('stage-','stage-percent-').replace('short-','short-percent-'));
  if(bar)bar.value=0;if(output)output.textContent='0%';});
 let timer=setInterval(()=>{
  let pending=false;
  for(const id of ids){
   const actual=shown.get(id),max=targets.get(id);
   if(actual>=max)continue;
   pending=true;const next=actual+1;shown.set(id,next);
   const barId=id.startsWith('stage-')?'stage-progress-'+id.slice(6):'short-progress-'+id.slice(6);
   const labelId=id.startsWith('stage-')?'stage-percent-'+id.slice(6):'short-percent-'+id.slice(6);
   const bar=document.getElementById(barId),label=document.getElementById(labelId);
   if(bar)bar.value=next;if(label)label.textContent=next+'%';
  }
  if(!document.getElementById('auto-generate')){clearInterval(timer);timer=null;}
 },25);
 return {
  set(id,value){if(!targets.has(id))return;const val=Math.max(0,Math.min(100,Math.floor(Number(value)||0)));targets.set(id,Math.max(targets.get(id),val));},
  finish(){if(!timer)return;const check=setInterval(()=>{
    if(!timer){clearInterval(check);return;}
    if(ids.every(id=>shown.get(id)>=targets.get(id))){clearInterval(timer);timer=null;clearInterval(check);}
  },100);}
 };
}
async function generateFourShorts(){
 const button=document.querySelector('#auto-generate'),status=document.querySelector('#auto-status'),results=document.querySelector('#auto-results');
 const form=document.querySelector('#project-form');const url=String(new FormData(form).get('source')||'').trim();
 const file=state.selectedFile;
 if(!file&&!url){status.textContent='Choose a local file or paste a YouTube URL.';return;}
 const payload=new FormData();if(file)payload.append('file',file);else payload.append('url',url);
 payload.append('seconds',document.querySelector('#auto-seconds').value);
 payload.append('layout',document.querySelector('input[name=video-layout]:checked')?.value||'auto');
 for(const id of ['font','size','color','position','style','animation']){const el=document.querySelector('#caption-'+id);if(el)payload.append('caption_'+id,el.value);}
 button.disabled=true;results.replaceChildren();status.textContent='Connecting to generator…';
 const animation=generatorProgressAnimator();
 try{
  const response=await fetch(GENERATOR_API+'/generate',{method:'POST',headers:await generatorHeaders(),body:payload});
  const started=await response.json();if(!response.ok)throw new Error(started.detail||'Generation failed');
  activeTabJobs.set(started.job_id,(await generatorHeaders()).Authorization.slice(7));
  const cancelButton=addCancelButton(status,started.job_id);
  let done=false,waitMs=1000;const deadline=Date.now()+LONG_POLL_LIMIT_MS;
  while(Date.now()<deadline){
   await new Promise(resolve=>setTimeout(resolve,waitMs));
   const poll=await fetch(GENERATOR_API+'/jobs/'+encodeURIComponent(started.job_id),{headers:await generatorHeaders()});
   if(!poll.ok)throw new Error('Cannot check generator status');
   const job=await poll.json();if(!activeTabJobs.has(started.job_id))throw new Error('Cancelled');status.textContent=processingStatus(job);
   waitMs=job.status==='queued'?3000:1000;
   if(job.stage_percentages){
    for(const stage of GENERATOR_STAGES){animation.set('stage-'+stage,job.stage_percentages[stage]);}
   }
   if(Array.isArray(job.percentages)){
    job.percentages.slice(0,8).forEach((value,i)=>animation.set('short-'+(i+1),value));
   }
   if(job.status==='cancelled')throw new Error('Cancelled');
   if(job.status==='error')throw new Error(job.progress||'Generation failed');
   if(job.status==='done'){
    for(let i=0;i<job.clips.length;i++){
     const clip=job.clips[i],wrapper=document.createElement('div');
     const title=document.createElement('strong');title.textContent='Short '+(i+1)+' · '+clip.duration+'s · Speech score: '+(clip.speech_score??'—')+'/100';
     const fileResponse=await fetch(GENERATOR_API+clip.url,{headers:await generatorHeaders()});
     if(!fileResponse.ok)throw new Error('Could not download Short '+(i+1));
     const blobUrl=URL.createObjectURL(await fileResponse.blob());
     const video=document.createElement('video');video.controls=true;video.preload='metadata';video.playsInline=true;video.src=blobUrl;
     video.style.cssText='display:block;max-height:360px;width:100%;background:#000';
     const link=document.createElement('a');link.href=blobUrl;link.download='clipstudio-short-'+(i+1)+'.mp4';
     link.textContent='Download MP4';link.target='_blank';
     const edit=document.createElement('button');edit.type='button';edit.className='btn primary';edit.textContent='✂ Edit in Video Editor';
     edit.onclick=async()=>{
      edit.disabled=true;edit.textContent='Opening editor…';
      try{
       const response=await fetch(GENERATOR_API+'/files/'+encodeURIComponent(started.job_id)+'/clip'+(i+1)+'.clean.mp4',{headers:await generatorHeaders()});
       if(!response.ok)throw new Error('Editable clean Short is unavailable. Regenerate with V16 backend.');
       const cleanBlob=await response.blob();
       const file=new File([cleanBlob],'short-'+(i+1)+'.mp4',{type:'video/mp4'});
       state.generatedShort={file,cues:(clip.cues||[]).map(c=>({...c})),title:'Short '+(i+1)};
       state.selectedFile=file;state.editing=null;setPage('editor');
      }catch(err){status.textContent='⚠ '+(err.message||'Cannot open editor');edit.disabled=false;edit.textContent='✂ Edit in Video Editor';}
     };
     wrapper.append(title,video,link,edit);results.append(wrapper);
    }
    const zipButton=document.createElement('button');zipButton.type='button';zipButton.className='btn primary';zipButton.textContent='⬇ Download all 8 Shorts (ZIP)';zipButton.onclick=async()=>{zipButton.disabled=true;try{const r=await fetch(GENERATOR_API+'/files/'+encodeURIComponent(started.job_id)+'/all.zip',{headers:await generatorHeaders()});if(!r.ok)throw new Error('ZIP unavailable');const u=URL.createObjectURL(await r.blob());const a=document.createElement('a');a.href=u;a.download='clipstudio-shorts.zip';a.click();setTimeout(()=>URL.revokeObjectURL(u),60000);}catch(e){status.textContent=safeError(e);}finally{zipButton.disabled=false;}};results.prepend(zipButton);
    activeTabJobs.delete(started.job_id);cancelButton.remove();
    status.textContent=gt('ready');done=true;break;
   }
  }
  if(!done)throw new Error('Timed out waiting for generator');
 }catch(err){status.textContent='Error: '+err.message;}
 finally{animation.finish();button.disabled=false;refreshQuota();}
}

async function exportClip(){const f=document.querySelector('#project-form');const file=state.selectedFile;if(!file)return flash('Choose a local video file first. YouTube URLs cannot be downloaded by this version.',true);const fd=new FormData(f),start=Number(fd.get('start')),end=Number(fd.get('end'));if(!Number.isFinite(start)||!Number.isFinite(end)||end<=start||start<0)return flash('Invalid time range.',true);const status=document.querySelector('#export-status');const button=document.querySelector('#export-video');button.disabled=true;status.textContent=t('working');try{if(!ffmpegInstance){ffmpegInstance=new FFmpeg();ffmpegInstance.on('log',({message})=>{if(status&&message.includes('time='))status.textContent=message.slice(-110);});const base='https://unpkg.com/@ffmpeg/core@0.12.10/dist/umd';await ffmpegInstance.load({coreURL:await toBlobURL(`${base}/ffmpeg-core.js`,'text/javascript'),wasmURL:await toBlobURL(`${base}/ffmpeg-core.wasm`,'application/wasm')});}const input='input_'+Date.now()+'.'+(file.name.split('.').pop()||'mp4').replace(/[^a-z0-9]/gi,'');const output='clip_'+Date.now()+'.mp4';await ffmpegInstance.writeFile(input,await fetchFile(file));const v12=id=>document.querySelector('#v12-'+id)?.value;
const speed=Number(v12('speed')||1),crop=v12('crop')||'fill';
const [w,h]=crop==='square'?[720,720]:crop==='landscape'?[1280,720]:[720,1280];
const vf=[crop==='fit'?`scale=${w}:${h}:force_original_aspect_ratio=decrease,pad=${w}:${h}:(ow-iw)/2:(oh-ih)/2`:`scale=${w}:${h}:force_original_aspect_ratio=increase,crop=${w}:${h}`,`eq=brightness=${Number(v12('brightness')||0)}:contrast=${Number(v12('contrast')||1)}:saturation=${Number(v12('saturation')||1)}`,`setpts=PTS/${speed}`];
const duration=((state.v15Segments?.length?state.v15Segments.reduce((sum,x)=>sum+x.end-x.start,0):end-start))/speed,fi=Math.min(5,Math.max(0,Number(v12('fade-in')||0))),fo=Math.min(5,Math.max(0,Number(v12('fade-out')||0)));
if(fi)vf.push(`fade=t=in:st=0:d=${Math.min(fi,duration/2)}`);
if(fo)vf.push(`fade=t=out:st=${Math.max(0,duration-Math.min(fo,duration/2))}:d=${Math.min(fo,duration/2)}`);
const af=[`atempo=${speed}`,`volume=${Math.max(0,Math.min(2,Number(v12('volume')||100)/100))}`];
if(fi)af.push(`afade=t=in:st=0:d=${Math.min(fi,duration/2)}`);
if(fo)af.push(`afade=t=out:st=${Math.max(0,duration-Math.min(fo,duration/2))}:d=${Math.min(fo,duration/2)}`);
const selected=(state.v15Segments||[]).filter(seg=>seg.end>seg.start+0.05);
let ffArgs;
if(selected.length){
 const filters=[],segments=[];
 for(let i=0;i<selected.length;i++){
  const seg=selected[i];
  filters.push(`[0:v]trim=start=${seg.start}:end=${seg.end},setpts=PTS-STARTPTS,${vf.join(',')}[v${i}]`);
  filters.push(`[0:a]atrim=start=${seg.start}:end=${seg.end},asetpts=PTS-STARTPTS,${af.join(',')}[a${i}]`);
  segments.push(`[v${i}][a${i}]`);
 }
 filters.push(`${segments.join('')}concat=n=${selected.length}:v=1:a=1[vout][aout]`);
 ffArgs=['-i',input,'-filter_complex',filters.join(';'),'-map','[vout]','-map','[aout]','-r','25','-c:v','libx264','-preset','ultrafast','-crf','28','-c:a','aac','-b:a','128k','-movflags','+faststart',output];
}else{ffArgs=['-ss',String(start),'-i',input,'-t',String(end-start),'-vf',vf.join(','),'-af',af.join(','),'-r','25','-c:v','libx264','-preset','ultrafast','-crf','28','-c:a','aac','-b:a','128k','-movflags','+faststart',output];}
const code=await ffmpegInstance.exec(ffArgs);if(code!==0)throw new Error('Video export failed. Try a shorter clip or another browser.');const bytes=await ffmpegInstance.readFile(output);const blob=new Blob([bytes],{type:'video/mp4'});const link=document.createElement('a');const blobUrl=URL.createObjectURL(blob);link.href=blobUrl;link.download=(String(fd.get('title')||'clip').replace(/[^\w-]/g,'_')||'clip')+'.mp4';link.click();setTimeout(()=>URL.revokeObjectURL(blobUrl),60000);await ffmpegInstance.deleteFile(input);await ffmpegInstance.deleteFile(output);if(state.editing){const {error}=await supabase.from('projects').update({status:'exported',updated_at:new Date().toISOString()}).eq('id',state.editing);if(!error)await logActivity('clip_exported',state.editing,link.download);}await loadData();status.textContent='✓ '+t('download');}catch(err){console.error(err);status.textContent=safeError(err);}finally{button.disabled=false;}}
render();
if(supabase){supabase.auth.onAuthStateChange((event,session)=>{if(event==='PASSWORD_RECOVERY'){state.user=null;state.authMode='update';navigate('auth',{replace:true});return;}if(event==='SIGNED_OUT'){state.user=null;state.projects=[];state.activity=[];state.profile=null;navigate('home',{replace:true});return;}if(session?.user&&session.user.id!==state.user?.id){setTimeout(()=>signedIn(session.user),0);}});supabase.auth.getSession().then(({data,error})=>{if(error)return flash(safeError(error),true);if(data.session?.user&&state.authMode!=='update')signedIn(data.session.user);}).catch(err=>flash(safeError(err),true));}

let playlistItems=[];let playlistSelected=new Set();
function initSmartPaste(){
 document.querySelectorAll('.smart-paste').forEach(button=>{
  const field=document.getElementById(button.dataset.urlTarget);if(!field)return;
  const update=()=>{const filled=!!field.value.trim();button.textContent=filled?'Clear':'Paste';button.setAttribute('aria-label',filled?'Clear URL':'Paste URL');};
  field.addEventListener('input',update);field.addEventListener('change',update);
  button.addEventListener('click',async()=>{if(field.value.trim()){field.value='';field.dispatchEvent(new Event('input',{bubbles:true}));field.focus();return;}
   try{const text=await navigator.clipboard.readText();if(text){field.value=text.trim();field.dispatchEvent(new Event('input',{bubbles:true}));field.dispatchEvent(new Event('change',{bubbles:true}));}}catch(err){field.focus();flash('Clipboard access blocked. Tap the field and use Paste.',true);}update();});update();
 });
}
function renderPlaylist(title){
 const box=document.querySelector('#playlist-results'),toolbar=document.querySelector('#playlist-toolbar'),all=document.querySelector('#playlist-select-all'),count=document.querySelector('#playlist-count'),batch=document.querySelector('#playlist-download-batch');if(!box)return;
 box.replaceChildren();toolbar.hidden=false;
 const heading=document.createElement('h3');heading.textContent=`${title} · ${playlistItems.length} videos`;box.append(heading);
 const update=()=>{count.textContent=`${playlistSelected.size} / ${playlistItems.length} selected`;all.checked=playlistItems.length>0&&playlistSelected.size===playlistItems.length;all.indeterminate=playlistSelected.size>0&&!all.checked;batch.disabled=playlistSelected.size===0;};
 all.onchange=()=>{playlistSelected=all.checked?new Set(playlistItems.map(x=>x.id)):new Set();box.querySelectorAll('input[data-video-id]').forEach(input=>input.checked=playlistSelected.has(input.dataset.videoId));update();};
 const list=document.createElement('div');list.className='playlist-grid';box.append(list);
 let offset=0;const pageSize=60;
 const more=document.createElement('button');more.type='button';more.className='btn outline';more.textContent='Show more videos';
 function appendPage(){for(const item of playlistItems.slice(offset,offset+pageSize)){
  const row=document.createElement('label');row.className='playlist-video';const checkbox=document.createElement('input');checkbox.type='checkbox';checkbox.dataset.videoId=item.id;checkbox.checked=playlistSelected.has(item.id);checkbox.onchange=()=>{if(checkbox.checked)playlistSelected.add(item.id);else playlistSelected.delete(item.id);update();};
  const img=document.createElement('img');img.src=item.thumbnail||`https://i.ytimg.com/vi/${encodeURIComponent(item.id)}/mqdefault.jpg`;img.alt='';img.loading='lazy';
  const content=document.createElement('span');const name=document.createElement('strong');name.textContent=item.title;const a=document.createElement('a');a.href=item.url;a.target='_blank';a.rel='noopener noreferrer';a.textContent='Open on YouTube';a.onclick=e=>e.stopPropagation();content.append(name,a);row.append(checkbox,img,content);list.append(row);
 }offset=Math.min(offset+pageSize,playlistItems.length);more.hidden=offset>=playlistItems.length;more.textContent=`Show more (${playlistItems.length-offset} remaining)`;}
 more.onclick=appendPage;appendPage();box.append(more);update();
}
function initV10Tools(){
 const form=document.querySelector('#playlist-inspector'),jobsButton=document.querySelector('#refresh-my-jobs');
 if(form)form.onsubmit=async(e)=>{e.preventDefault();const box=document.querySelector('#playlist-results'),toolbar=document.querySelector('#playlist-toolbar'),batch=document.querySelector('#playlist-download-batch');box.textContent='Loading playlist videos…';toolbar.hidden=true;batch.disabled=true;playlistItems=[];playlistSelected.clear();try{const body=new FormData();body.set('url',document.querySelector('#playlist-url').value.trim());const r=await fetch(GENERATOR_API+'/media/playlist',{method:'POST',headers:await generatorHeaders(),body});const data=await r.json();if(!r.ok)throw new Error(data.detail||'Playlist unavailable');playlistItems=data.entries||[];playlistSelected=new Set(playlistItems.map(x=>x.id));renderPlaylist(data.title||'Playlist');}catch(err){box.textContent=safeError(err);}};

 if(jobsButton)jobsButton.onclick=async()=>{const box=document.querySelector('#my-jobs-results');box.textContent='Loading…';try{const r=await fetch(GENERATOR_API+'/my/jobs',{headers:await generatorHeaders()});const data=await r.json();if(!r.ok)throw new Error(data.detail||'Jobs unavailable');box.replaceChildren();for(const item of data.jobs){const p=document.createElement('p');p.textContent=item.kind+' · '+item.status+' · '+(item.progress||'');box.append(p);}if(!data.jobs.length)box.textContent='No jobs on this server session.';}catch(err){box.textContent=safeError(err);}};
}

// V11: bounded playlist batch and server-verified administrator overview.
function initV11Tools(){
 const batch=document.querySelector('#playlist-download-batch');
 if(batch)batch.onclick=async()=>{
  const status=document.querySelector('#playlist-download-status'),links=document.querySelector('#playlist-download-links');
  if(!document.querySelector('#playlist-rights')?.checked){status.textContent='Confirm rights to the selected videos first.';return;}
  const ids=[...playlistSelected];if(!ids.length)return;
  batch.disabled=true;status.textContent='Adding selected videos to the queue…';links.replaceChildren();
  try{let accepted=[],failures=[];const url=document.querySelector('#playlist-url').value.trim();
   for(let i=0;i<ids.length;i+=25){const fd=new FormData();fd.set('url',url);fd.set('quality',document.querySelector('#playlist-quality').value);fd.set('rights_confirmed','true');fd.set('video_ids',JSON.stringify(ids.slice(i,i+25)));
    const r=await fetch(GENERATOR_API+'/media/playlist/download',{method:'POST',headers:await generatorHeaders(),body:fd});const data=await r.json();if(!r.ok)throw new Error(data.detail||'Download queue failed');accepted.push(...(data.accepted||[]));failures.push(...(data.failures||[]));status.textContent=`Queued ${accepted.length}/${ids.length} · ${failures.length} unavailable or quota-limited`;
    if(failures.some(x=>/limit|quota|concurrent|busy/i.test(x.reason||'')))break;
   }
   status.textContent=`${accepted.length} video(s) queued. ${failures.length} failed or unavailable. Refresh My processing jobs to track them.`;
   for(const item of accepted){const p=document.createElement('p');p.textContent='✓ '+item.title+' · queued';links.append(p);}
   for(const item of failures){const p=document.createElement('p');p.textContent='⚠ '+item.title+': '+item.reason;links.append(p);}
  }catch(err){status.textContent=safeError(err);}finally{batch.disabled=playlistSelected.size===0;}
 };
 const admin=document.querySelector('#admin-overview');
 if(admin)admin.onclick=async()=>{
  const box=document.querySelector('#admin-results');box.textContent='Loading…';
  try{const r=await fetch(GENERATOR_API+'/admin/overview',{headers:await generatorHeaders()});
   const data=await r.json();if(!r.ok)throw new Error(data.detail||'Not authorized');
   box.textContent='Jobs: '+JSON.stringify(data.jobs)+' · Active users: '+data.active_users+' · Waiting Shorts: '+data.waiting_shorts;
  }catch(err){box.textContent=safeError(err);}
 };
}

function initV12Editor(){const video=document.querySelector('#video-preview'),form=document.querySelector('#project-form');if(!video||!form)return;for(const id of ['brightness','contrast','saturation'])document.querySelector('#v12-'+id)?.addEventListener('input',()=>{const n=x=>Number(document.querySelector('#v12-'+x)?.value||0);video.style.filter=`brightness(${1+n('brightness')}) contrast(${n('contrast')}) saturate(${n('saturation')})`;});document.querySelector('#v12-mark-start')?.addEventListener('click',()=>{form.elements.start.value=video.currentTime.toFixed(1)});document.querySelector('#v12-mark-end')?.addEventListener('click',()=>{form.elements.end.value=video.currentTime.toFixed(1)});document.querySelector('#v12-reset')?.addEventListener('click',()=>{for(const [id,val] of Object.entries({speed:'1',crop:'fill',brightness:'0',contrast:'1',saturation:'1',volume:'100','fade-in':'0','fade-out':'0'})){const el=document.querySelector('#v12-'+id);if(el){el.value=val;el.dispatchEvent(new Event('input'))}}});}


function initV13Captions(){
 const size=document.querySelector('#caption-size'),range=document.querySelector('#caption-size-range');
 if(!size)return;
 const presets={
  viral:{font:'Arial Black',color:'#ffe34d',size:70,style:'clean',position:'bottom',animation:'pop'},
  minimal:{font:'Arial',color:'#ffffff',size:44,style:'clean',position:'bottom',animation:'none'},
  box:{font:'Impact',color:'#ffffff',size:58,style:'boxed',position:'center',animation:'pop'},
  cinema:{font:'Georgia',color:'#ffd78c',size:52,style:'clean',position:'bottom',animation:'none'}
 };
 function updateSize(v){const value=Math.max(18,Math.min(400,Number(v)||40));size.value=value;range.value=value;window.clipstudioUpdateCaptionPreview?.();}
 size.addEventListener('input',()=>updateSize(size.value));range.addEventListener('input',()=>updateSize(range.value));
 document.querySelectorAll('[data-caption-template]').forEach(button=>button.onclick=()=>{
  document.querySelectorAll('[data-caption-template]').forEach(b=>b.classList.toggle('active',b===button));
  for(const [key,value] of Object.entries(presets[button.dataset.captionTemplate])){
   const input=document.querySelector('#caption-'+key);if(input){input.value=value;input.dispatchEvent(new Event('input'));}
  }
  updateSize(presets[button.dataset.captionTemplate].size);
 });
 async function runCaption(mode){
  const file=state.selectedFile,box=document.querySelector('#caption-status');
  if(!file){box.textContent='Upload a video file in Video Editor first.';return;}
  const button=document.querySelector(mode==='transcribe'?'#auto-caption-run':'#caption-burn-export');
  button.disabled=true;box.textContent=mode==='transcribe'?'Transcribing audio…':'Rendering captions…';
  try{
   const body=new FormData();body.set('file',file);
   if(mode==='render'){
    const cues=parseCaptionCues();if(!cues.length)throw new Error('Generate captions or enter timed caption lines first.');
    body.set('cues',JSON.stringify(cues));
    for(const id of ['size','font','color','position','style'])body.set(id,document.querySelector('#caption-'+id).value);
    const r=await fetch(GENERATOR_API+'/captions/render',{method:'POST',headers:await generatorHeaders(),body});
    if(!r.ok){let msg;try{msg=(await r.json()).detail}catch{}throw new Error(msg||'Caption export failed');}
    const blob=await r.blob(),url=URL.createObjectURL(blob),a=document.createElement('a');
    a.href=url;a.download='clipstudio_captioned.mp4';a.click();setTimeout(()=>URL.revokeObjectURL(url),60000);
    box.textContent='✓ Captioned MP4 exported';
   }else{
    const r=await fetch(GENERATOR_API+'/captions/transcribe',{method:'POST',headers:await generatorHeaders(),body});
    const data=await r.json();if(!r.ok)throw new Error(data.detail||'Transcription failed');
    document.querySelector('#caption-cues').value=data.cues.map(c=>`${c.start.toFixed(2)} | ${c.end.toFixed(2)} | ${c.text}`).join('\\n');
    window.clipstudioUpdateCaptionPreview?.();
    box.textContent=`✓ ${data.cues.length} timed captions. Edit them below.`;
   }
  }catch(e){box.textContent=safeError(e);}finally{button.disabled=false;}
 }
 document.querySelector('#auto-caption-run')?.addEventListener('click',()=>runCaption('transcribe'));
 document.querySelector('#caption-burn-export')?.addEventListener('click',()=>runCaption('render'));
}

// V15: non-destructive single-track split editor. Video is processed only at export.
function initV15TimelineSource(){
 const video=document.querySelector('#video-preview');if(!video)return;
 const reset=()=>{if(!Number.isFinite(video.duration)||video.duration<=0)return;state.v15Segments=[{start:0,end:video.duration}];state.v15Undo=[];state.v15Selected=0;renderV15Timeline();};
 video.addEventListener('loadedmetadata',reset,{once:true});
 if(video.readyState>=1)reset();
}
function renderV15Timeline(){
 const track=document.querySelector('#v15-track');if(!track)return;
 const segments=state.v15Segments||[];track.replaceChildren();
 const total=segments.reduce((n,s)=>n+s.end-s.start,0)||1;
 segments.forEach((seg,i)=>{
  const button=document.createElement('button');button.type='button';button.className='v15-segment'+(state.v15Selected===i?' selected':'');
  button.style.flexGrow=Math.max(0.1,(seg.end-seg.start)/total*10);
  button.textContent=`${i+1} · ${seg.start.toFixed(1)}–${seg.end.toFixed(1)}s`;
  button.title=`Select segment ${i+1}`;button.onclick=()=>{state.v15Selected=i;document.querySelector('#video-preview').currentTime=seg.start;renderV15Timeline();};
  track.append(button);
 });
}
function initV15Timeline(){
 const video=document.querySelector('#video-preview');if(!video)return;
 state.v15Segments=[];state.v15Undo=[];state.v15Selected=0;
 const remember=()=>state.v15Undo.push(JSON.stringify(state.v15Segments));
 document.querySelector('#v15-split')?.addEventListener('click',()=>{
  const at=video.currentTime,segments=state.v15Segments||[],i=segments.findIndex(s=>at>s.start+0.1&&at<s.end-0.1);
  if(i<0)return;remember();const s=segments[i];segments.splice(i,1,{start:s.start,end:at},{start:at,end:s.end});state.v15Selected=i+1;renderV15Timeline();
 });
 document.querySelector('#v15-delete')?.addEventListener('click',()=>{
  const segments=state.v15Segments||[];if(segments.length<2)return;remember();segments.splice(state.v15Selected,1);state.v15Selected=Math.max(0,Math.min(state.v15Selected,segments.length-1));renderV15Timeline();
 });
 document.querySelector('#v15-undo')?.addEventListener('click',()=>{const previous=state.v15Undo?.pop();if(previous){state.v15Segments=JSON.parse(previous);state.v15Selected=0;renderV15Timeline();}});
 document.querySelector('#v15-reset-timeline')?.addEventListener('click',()=>{if(video.duration){remember();state.v15Segments=[{start:0,end:video.duration}];state.v15Selected=0;renderV15Timeline();}});
 video.addEventListener('timeupdate',()=>{const el=document.querySelector('#v15-playhead');if(el)el.textContent=video.currentTime.toFixed(1)+'s';});
 initV15TimelineSource();
}

function restoreGeneratedShort(){
 const item=state.generatedShort;if(!item)return;
 state.selectedFile=item.file;
 const input=document.querySelector('#video-file'),video=document.querySelector('#video-preview');
 if(video){video.src=URL.createObjectURL(item.file);video.dataset.blob=video.src;document.querySelector('.preview-placeholder')?.remove();video.onloadedmetadata=()=>{const end=document.querySelector('[name="end"]');if(end)end.value=video.duration.toFixed(2);initV15TimelineSource();};}
 const title=document.querySelector('#project-form [name="title"]');if(title)title.value=item.title;
 const cues=document.querySelector('#caption-cues');if(cues)cues.value=item.cues.map(c=>`${Number(c.start).toFixed(2)} | ${Number(c.end).toFixed(2)} | ${c.text}`).join('\n');
 document.querySelector('#generated-short-notice')?.removeAttribute('hidden');
 window.clipstudioUpdateCaptionPreview?.();
}

function initV17PreviewRatio(){
 if(state.page!=='editor')return;
 const video=document.querySelector('#video-preview'),frame=document.querySelector('#preview-frame'),label=document.querySelector('#preview-ratio-label');
 if(!video||!frame)return;
 const update=()=>{
  if(!video.videoWidth||!video.videoHeight)return;
  const w=video.videoWidth,h=video.videoHeight;
  frame.style.setProperty('aspect-ratio',w+'/'+h,'important');
  frame.style.setProperty('width',`min(100%, ${Math.round(450*w/h)}px)`,'important');
  frame.style.setProperty('height','auto','important');
  frame.classList.add('v17-original-preview');
  if(label)label.textContent=`PREVIEW · ${w} × ${h} · ${(w/h).toFixed(2)}:1`;
 };
 video.addEventListener('loadedmetadata',update);if(video.readyState>=1)update();
}
async function initV17OptionalDownload(){
 const button=document.querySelector('#generator-download-source');if(!button)return;
 button.addEventListener('click',async()=>{
  const status=document.querySelector('#generator-download-status'),bar=document.querySelector('#generator-download-progress'),result=document.querySelector('#generator-download-result');
  const url=document.querySelector('#project-form input[name="source"]')?.value.trim();
  if(!url||!publicYoutubeId(url)){status.textContent='Paste a valid YouTube video URL first.';return;}
  if(!document.querySelector('#generator-download-rights').checked){status.textContent='Confirm you have permission to download this video.';return;}
  button.disabled=true;bar.hidden=false;bar.value=0;result.replaceChildren();status.textContent='Preparing full video download…';
  try{
   const fd=new FormData();fd.set('url',url);fd.set('format','mp4');fd.set('quality','720');fd.set('rights_confirmed','true');
   const response=await fetch(GENERATOR_API+'/media/download',{method:'POST',headers:await generatorHeaders(),body:fd});
   const data=await response.json();if(!response.ok)throw new Error(data.detail||'Download failed');
   const token=(await generatorHeaders()).Authorization.slice(7);activeTabJobs.set(data.job_id,token);
   const deadline=Date.now()+LONG_POLL_LIMIT_MS;
   while(Date.now()<deadline){
    await new Promise(resolve=>setTimeout(resolve,2500));
    const r=await fetch(GENERATOR_API+'/jobs/'+encodeURIComponent(data.job_id),{headers:await generatorHeaders()});
    const job=await r.json();if(!r.ok)throw new Error(job.detail||'Download status failed');
    status.textContent=processingStatus(job);bar.value=Math.max(0,Math.min(100,Number(job.percent)||0));
    if(job.status==='error'||job.status==='cancelled')throw new Error(job.progress||job.status);
    if(job.status==='done'){
     const link=document.createElement('a');link.className='btn primary';link.textContent='⬇ Save full video to device';link.href=GENERATOR_API+job.url;link.rel='noopener noreferrer';link.download=job.filename||'source.mp4';
     result.append(link);status.textContent='Ready to download. You can also generate 8 Shorts below.';bar.value=100;activeTabJobs.delete(data.job_id);break;
    }
   }
  }catch(err){status.textContent='⚠ '+(err.message||'Download failed');}finally{button.disabled=false;}
 });
}

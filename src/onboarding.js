// First-visit tour, scoped to the current browser and account.
export function mountTour({user,lang,page}) {
 const key='clipstudio-tour-v13-'+(user?.id||'guest');
 const root=document.querySelector('#app')||document.body;
 const translations={en:['Welcome to ClipStudio','Workspace','Projects','Tools','Manage','Discover the studio','Choose a creative tool to begin.','Find your saved projects here.','Explore video, audio and download tools.','Access settings and support.','Back','Next','Skip','Done','Replay tour'],fr:['Bienvenue sur ClipStudio','Espace de travail','Projets','Outils','Gestion','Découvrez le studio','Choisissez un outil pour commencer.','Retrouvez vos projets enregistrés.','Explorez les outils vidéo, audio et téléchargement.','Accédez aux réglages et à l’assistance.','Retour','Suivant','Passer','Terminer','Revoir le guide'],ar:['مرحباً بك في ClipStudio','مساحة العمل','المشاريع','الأدوات','الإدارة','اكتشف الاستوديو','اختر أداة إبداعية للبدء.','اعثر على مشاريعك المحفوظة هنا.','استكشف أدوات الفيديو والصوت والتحميل.','ادخل إلى الإعدادات والدعم.','السابق','التالي','تخطي','تم','إعادة الشرح']};
 const l=translations[lang]||translations.en;
 document.querySelector('#cs-tour')?.remove();
 document.querySelectorAll('.cs-tour-focus').forEach(x=>x.classList.remove('cs-tour-focus'));
 const replay=document.createElement('button'); replay.type='button';replay.className='btn outline cs-tour-replay';replay.textContent=l[14];
 const host=document.querySelector('.settings-panel')||document.querySelector('.nova-faq');
 if(host)host.append(replay);
 const steps=user?[[null,l[0],l[5]],['.prism-nav [data-page="dashboard"]',l[1],l[6]],['.prism-nav [data-page="library"]',l[2],l[7]],['.prism-nav .v8-tools',l[3],l[8]],['.prism-nav .v8-menu:not(.v8-tools)',l[4],l[9]]]:[[null,l[0],l[5]],['.nova-actions',l[1],l[6]],['.nova-grid',l[3],l[8]]];
 function start(){if(document.querySelector('#cs-tour'))return;let i=0;const previous=document.activeElement;const d=document.createElement('dialog');d.id='cs-tour';d.dir=lang==='ar'?'rtl':'ltr';document.body.append(d);
 function finish(){try{localStorage.setItem(key,'1')}catch{};d.close();d.remove();document.querySelectorAll('.cs-tour-focus').forEach(x=>x.classList.remove('cs-tour-focus'));previous?.focus?.();}
 function draw(){document.querySelectorAll('.cs-tour-focus').forEach(x=>x.classList.remove('cs-tour-focus'));const [sel,title,desc]=steps[i];const target=sel&&document.querySelector(sel);if(target){target.classList.add('cs-tour-focus');target.scrollIntoView({block:'nearest',behavior:'smooth'});}d.innerHTML=`<div class="cs-tour-count">${i+1} / ${steps.length}</div><h2>${title}</h2><p>${desc}</p><div class="cs-tour-progress"><i style="width:${100*(i+1)/steps.length}%"></i></div><div class="cs-tour-buttons"><button data-skip>${l[12]}</button><button data-back ${i===0?'disabled':''}>${l[10]}</button><button data-next>${i===steps.length-1?l[13]:l[11]} →</button></div>`;d.querySelector('[data-skip]').onclick=finish;d.querySelector('[data-back]').onclick=()=>{i--;draw()};d.querySelector('[data-next]').onclick=()=>{if(i===steps.length-1)finish();else{i++;draw()}};d.querySelector('[data-next]').focus();}
 d.addEventListener('cancel',e=>{e.preventDefault();finish()});d.showModal();draw();}
 replay.onclick=start;
 let seen=false;try{seen=localStorage.getItem(key)==='1'}catch{};
 if(!seen&&((user&&['home','dashboard'].includes(page))||(!user&&['home','welcome'].includes(page))))start();
}

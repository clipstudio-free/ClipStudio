# ClipStudio — mise à jour YouTube Downloader, mobile et quotas

## ما الجديد؟ / Nouveautés

- صفحة **YouTube Downloader** داخل مساحة العمل، مع معاينة عنوان الفيديو والصورة المصغّرة بعد لصق الرابط.
- اختيار **MP4** (430p, 720p, 1080p, 4K, 8K) أو **MP3** (192 kb/s). يتم اختيار أعلى جودة لا تتجاوز اختيارك، بدون رفع دقة الصورة اصطناعياً؛ 4K و8K متاحتان فقط عندما يدعمهما المصدر.
- زر **Logout / Déconnexion** ظاهر على شاشة الهاتف، مع زر إضافي داخل الإعدادات.
- **4 Shorts** كما كان، مع احتساب النسب الحقيقية للترميز. فيديوهات المصدر حتى **5 ساعات** و5 GiB كحدّ تقني للحجم. محاولات الإنشاء الفاشلة لا تستهلك الحصة اليومية بعد الآن.
- واجهة `/limits` تعرض عدد العمليات المتبقية وتجدد الحصة عند 00:00 UTC. الحدّ الافتراضي الجديد للتوليد 20 عملية ناجحة/اليوم، ويمكن تغييره من متغيرات السيرفر؛ تحميل الملفات 10/اليوم.

## كيف تحدث الموقع الموجود على GitHub + Cloudflare

1. احتفظ بنسخة احتياطية من مشروعك الحالي.
2. فك الضغط على ZIP. بداخله مجلد `ClipStudio_V2` يحتوي على الكود الجديد. **لا تنقل ملفات `.env` أو `.env.local` إلى GitHub.**
3. افتح مستودعك الحالي `https://github.com/clipstudio-free/ClipStudio`، ثم `Add file` > `Upload files`. اسحب الملفات والمجلدات الجديدة **من داخل** `ClipStudio_V2`، ولا تضف المجلد الأب ذاته، ثم اختر `Commit changes`. يمكن استعمال GitHub Desktop للمشاريع الكبيرة؛ دير بالك من تطابق المسارات `src/main.js`, `src/style.css`, `backend/server.py`.
4. إذا كان Cloudflare Workers مربوطاً بهذا المستودع، التغييرات المدفوعة إلى الفرع الذي ينشر منه سوف تُطلق بناءً جديداً. راقب `Deployments / Builds`.
5. في Cloudflare، تأكد من متغيرات بناء الواجهة `VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY`, `VITE_GENERATOR_API_URL` (عنوان HTTPS الحقيقي لسيرفر Python). لأن هذه المتغيرات تبدأ بـ`VITE_` فهي تظهر للمتصفح؛ ضع فقط مفاتيح Supabase **publishable** العامة، أبداً المفاتيح السرية.
6. في الكمبيوتر الذي يشغّل السيرفر الحقيقي، استبدل `backend/server.py` بنفس الملف الجديد، ثم أوقفه بـ`Ctrl + C` وأعد تشغيل `backend/start_windows.bat`. رفع ملف السيرفر إلى GitHub وحده لا يغير السيرفر المحلي المشغّل بالفعل.
7. في إعدادات سيرفر Python (`backend/.env.local` محلياً أو environment variables في الاستضافة) ضع `ALLOWED_ORIGINS=https://clipstudio.ahlaouirayane79.workers.dev` **إذا كان هذا هو رابط موقعك النهائي**، ومعه إعدادات Supabase على السيرفر: `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`. لا تنشر ملفات الإعدادات الخاصة.
8. على الهاتف، حدّث الموقع مرة واحدة. اذهب للقائمة الجديدة `Téléchargement YouTube / تحميل يوتيوب`؛ زر تسجيل الخروج أصبح أعلى مساحة العمل وفي الإعدادات.

## Réglages de quotas serveur (fichier local ou variables d'environnement)

```env
MAX_JOBS_PER_DAY=20
MAX_DOWNLOADS_PER_DAY=10
MAX_ACTIVE_JOBS=1
JOB_TTL_SECONDS=3600
```

Les quotas sont recalculés chaque jour à 00:00 UTC et les tâches **en erreur sont remboursées**. Une tâche **en cours** bloque une seconde tâche du même compte, même si le quota n'est pas épuisé. Les compteurs sont actuellement gardés en mémoire du processus Python : **ils ne sont pas partagés entre plusieurs serveurs et ne persistent pas aux redémarrages**. Pour un site public multi-utilisateur, migrer quotas et jobs vers un stockage durable (base/Redis) et ajouter une queue de travail.

Pour un usage personnel uniquement, `MAX_JOBS_PER_DAY=0` ou `MAX_DOWNLOADS_PER_DAY=0` désactive la limite correspondante. **Déconseillé pour un site public gratuit** sans quotas alternatifs, car les téléchargements et la transcription coûtent CPU, réseau et stockage.

## Limites importantes

- Télécharger uniquement les vidéos dont tu détiens les droits ou pour lesquelles tu as une autorisation, et respecter les conditions du service.
- Les vidéos YouTube peuvent être bloquées par restrictions, authentification, limitations du site ou changements de formats. Aucune garantie de téléchargement universel.
- **430p** n'est pas un format standard YouTube ; le serveur télécharge la meilleure résolution disponible **n'excédant pas 430 lignes** (par ex. 360p). Les résolutions 4K/8K demandent de gros fichiers et beaucoup de RAM/disque.
- Taille maximale approximative par fichier : 5 GiB. Une source de 5h en 8K dépassera souvent cette taille.
- Le backend Python doit être hébergé séparément de Cloudflare Workers et accessible en HTTPS ; Cloudflare Workers héberge le frontend Vite mais **n'exécute pas** FFmpeg/yt-dlp/faster-whisper de ce backend.
- Les liens de téléchargement temporaire sont utilisables pendant 30 minutes, par toute personne connaissant le lien ; ne les partage pas. Les fichiers disparaissent après le TTL du job (`JOB_TTL_SECONDS`).
- Les tâches sont en mémoire et le navigateur doit rester ouvert pour afficher la progression. Il reste nécessaire de mettre en place un vrai hébergement, des limites de fichiers, une file de tâches et un stockage persistant avant un lancement public à grande échelle.
- **Vérifications faites ici :** syntaxe Python et JavaScript ; simulation du contrôle d'accès, de la prévisualisation, des quotas et du lancement d'une tâche. Pas de validation end-to-end d'un véritable téléchargement YouTube ni d'un rendu 8K sur cet environnement.

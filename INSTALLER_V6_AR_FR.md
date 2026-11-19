# تحديث ClipStudio V6 — بالعربية

## الجديد
- منصة تحميل واحدة فيها اختيار **YouTube / Instagram / TikTok / Facebook** مع شعار كل منصة. تقدر تلصق الرابط مباشرة وسيتعرف النظام على المنصة.
- معاينة العنوان والصورة المصغّرة إذا كانت متاحة للمنصة والفيديو.
- اختيار **MP4** أو **MP3**، وجودات **430p / 720p / 1080p / 4K / 8K** حسب المصدر.
- إصلاح محتمل لمشكل «MP4 فيه الصوت وما فيهش الصورة»: الخادم يفحص مسار الفيديو ويُنتج MP4 بترميز H.264 وصوت AAC عند الحاجة، ويتأكد من النتيجة بواسطة ffprobe. إذا كان المصدر صوتاً فقط، تظهر رسالة واضحة بدلاً من تقديم MP4 دون صورة.
- تم الحفاظ على نظام الانتظار في V5 بإعداد **4 Shorts + 4 Downloads** بشكل متزامن عند ضبطه بهذا الشكل.

## تثبيت التحديث على المشروع الحالي
1. احتفظ بنسخة احتياطية من مجلد ClipStudio V5 الحالي.
2. فك ضغط ملف التحديث `ClipStudio_V6_Update.zip`.
3. حدّث الملفات `src/main.js` و`src/style.css` و`backend/server.py` بنفس المسارات في مشروعك. **لا تضع `server.py` أو `main.js` في جذر GitHub.**
4. على GitHub: في `clipstudio-free/ClipStudio` اختر Add file → Upload files، واسحب مجلدي `src` و`backend` بعد التأكد من المسارات؛ ثم Commit changes. يجب أن يعيد Cloudflare بناء واجهة Vite إذا كان المستودع متصلاً فعلاً.
5. على الكمبيوتر: انسخ `backend/server.py` الجديد إلى مجلد `backend` الذي تشغّل منه Python. **لا تحذف ملف `backend/.env.local` الموجود عندك، ولا ترفعه إلى GitHub**. لا تنس تحديث ملف السيرفر محلياً؛ تحديث GitHub وحده لا يغيّر برنامج Python العامل على الكمبيوتر.
6. في `backend/.env.local` يمكنك الاحتفاظ بالإعدادات السابقة، والتأكد من وجود:

```
MAX_CONCURRENT_SHORTS=4
MAX_CONCURRENT_DOWNLOADS=4
MAX_ACCEPTED_JOBS=100
DOWNLOAD_FFMPEG_THREADS=2
```

7. أوقف Python بـ Ctrl+C وأعد تشغيله من داخل `backend`:

```powershell
py -3.12 -m uvicorn server:app --host 127.0.0.1 --port 8765 --workers 1
```

8. **لا تغلق Python أو Cloudflare Tunnel** ما دام محرك الفيديو يعمل على حاسوبك. تأكد من أن `VITE_GENERATOR_API_URL` يشير إلى رابط Tunnel الصحيح وأعد بناء الموقع بعد تعديل متغيرات Vite. رابط `trycloudflare.com` مؤقت وليس استضافة نهائية.
9. حدّث صفحة الموقع Ctrl+F5، افتح Social Downloader، جرّب فيديو قصيراً وعاماً تملك حق تحميله، واختر MP4 720p. بعد التحميل اختبر الصورة والصوت على هاتفك.

## إذا ظهر ملف MP4 بصوت فقط
نظام V6 يعالج السبب الشائع وهو ترميز VP9/AV1 غير المدعوم على بعض الأجهزة أو غياب مسار الفيديو. للتحقق من الملف، نفّذ على الكمبيوتر:

```powershell
ffprobe -v error -show_entries stream=codec_type,codec_name,width,height -of table "video.mp4"
```

يُفترض ظهور `video / h264`، وإذا كان المصدر فيه صوت `audio / aac`. بعض الهواتف ما زالت لا تدعم تشغيل 8K؛ اختر 720p أو 1080p. وإذا كان الملف القديم معطوباً، أعد تحميل الفيديو بعد تثبيت تحديث Python، لأن التحديث لا يصلح الملفات السابقة تلقائياً.

## حدود مهمة
- يدعم البرنامج الفيديوهات **العامة المتاحة** فقط، ولا يتجاوز الحماية أو الحاجة إلى تسجيل الدخول. دعم المنصات يتغير حسب yt-dlp وقد تتعطل الروابط أو تمنع الشروط التحميل.
- قد لا تتوفر 4K/8K للفيديو الذي اخترته؛ لا يتم رفع الدقة بشكل مصطنع.
- معالجة 4K/8K والتحويل إلى H.264 ثقيلة جداً على الذاكرة والمعالج والقرص.
- استعمل المحتوى الذي تملكه أو عندك إذن بتنزيله، واحترم شروط كل منصة والحقوق.
- الواجهة Cloudflare، أمّا الخادم Python فهو ما زال على حاسوبك. التحديث **لا يحول المشروع إلى استضافة مستقلة 24/7**.
- يجب أن تظل ملفات `.env.local` ومفاتيح الوصول السرية خارج GitHub.

---

# Mise à jour ClipStudio V6 — français

Ajout d'un téléchargement par plateformes **YouTube / Instagram / TikTok / Facebook**, avec logos, aperçu des miniatures publiques et choix MP3/MP4. Les résolutions 430p, 720p, 1080p, 4K, 8K sont des plafonds, sous réserve de disponibilité.

La sortie MP4 est vérifiée par ffprobe et, si nécessaire, convertie avec FFmpeg en vidéo H.264/yuv420p et audio AAC pour une meilleure compatibilité. Les fichiers uniquement audio sont refusés en MP4. Les très hautes résolutions peuvent ne pas être lues par certains téléphones.

Pour mettre à jour : transférer `src/main.js`, `src/style.css` et `backend/server.py` dans leurs dossiers existants ; faire un nouveau commit GitHub pour le frontend et redémarrer séparément Python sur le PC avec **Python 3.12**. Conserver localement `backend/.env.local` et ne jamais le publier.

La conversion MP4 peut être longue. Instagram/TikTok/Facebook nécessitent des vidéos publiques accessibles ; certains liens exigent une authentification ou ne sont pas pris en charge par yt-dlp. Ne télécharger que du contenu autorisé.

**Vérification technique :** syntaxe Python/JavaScript et conversion locale VP9+Opus → MP4 H.264+AAC ont été vérifiées. Aucun téléchargement en direct depuis les quatre plateformes n'a été vérifié ici. La construction Vite complète n'a pas pu être effectuée dans cet environnement sans les dépendances Node installées.

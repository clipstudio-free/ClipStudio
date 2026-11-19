# ClipStudio V7 — Aperçu + progrès détaillés / معاينة الفيديو ومراحل التقدم

## أهم الإضافات

- في **Generate 4 Shorts**، عند لصق رابط YouTube صالح تظهر الصورة المصغرة مباشرة، وتظهر معلومات العنوان والمدة عند توفرها من الخادم.
- أربع مراحل، لكل منها نسبة منفصلة من `0%` إلى `100%`: **تنزيل المصدر**، **تحليل الكلام**، **اختيار 4 مقاطع**، **إنتاج المقاطع**.
- بالإضافة إلى أربع نسب مستقلة لكل Short موجودة سابقاً.
- الواجهة تعرض أرقام النسب تصاعدياً (0، 1، 2...) **دون تجاوز التقدم الذي أبلغه السيرفر**. قد تتأخر الواجهة ثواني قليلة في الوصول إلى الرقم النهائي.
- إذا لم يقدّم مصدر الفيديو حجم التحميل، تظل النسبة عند 0% إلى حين توفر بيانات قابلة للقياس أو اكتمال التحميل. لا نختلق نسبة مئوية.
- نسبة التفريغ الصوتي تمثل تقدم التغطية الزمنية للفيديو حسب المقاطع التي عالجها محرك التعرف على الصوت؛ ولا تمثل الوقت المتبقي بالدقائق.
- مرحلة الاختيار قد تصل 100% بسرعة لأن الاختيار حساب سريع. كل مرحلة لا تصل 100% إلا بعد اكتمال عملها.
- النظام يحافظ على قائمة انتظار V5، وتحميل MP3/MP4 وInstagram وTikTok وFacebook من V6، وإعداد 8 عمليات (4 Shorts + 4 تنزيلات) إذا كانت البيئة مضبوطة لذلك.

## تحديث موقعك الحالي (لا تحذف المستودع)

1. فك ضغط **ClipStudio_V7_Apercu_Progression_MISE_A_JOUR.zip**.
2. في GitHub، حدّث `src/main.js` و`src/style.css` **مع الحفاظ على المسارات**، ثم Commit changes. لا تضع الملفين في جذر المستودع.
3. انتظر نشر Cloudflare الجديد (Ready)، ثم حدّث الموقع في المتصفح.
4. في الكمبيوتر الذي يشغّل السيرفر، أوقف Python بـ`Ctrl+C` (واترك Tunnel على حاله)، واستبدل **`backend/server.py`** بنسخة V7 ثم أعد تشغيله من داخل مجلد `backend`:

```powershell
py -3.12 -m uvicorn server:app --host 127.0.0.1 --port 8765 --workers 1
```

5. حافظ على `backend/.env.local` القديم. **لا ترفعه إلى GitHub ولا تشاركه**. حافظ كذلك على إعدادات Cloudflare وربط Tunnel الحالي.
6. خاصية التقدم المفصل تحتاج **نسختي الواجهة وPython V7 معاً**. الموقع وحده لن يعرض النسب الجديدة من سيرفر قديم.

## Notes en français

- La miniature apparaît dès qu'une URL YouTube publique valide est collée. Le titre/la durée sont récupérés via l'API authentifiée `/media/info` si accessible.
- L'API `/jobs/{id}` expose `stage_percentages` (`download`, `transcription`, `selection`, `render`) **en plus** de `percentages` (Shorts 1 à 4).
- Le téléchargement utilise les octets reçus remontés par `yt-dlp` pour calculer le pourcentage. Si la taille est inconnue, aucun pourcentage fictif n'est généré.
- La transcription affiche la progression le long de la timeline audio selon les segments transcrits par `faster-whisper` ; cela ne mesure pas le temps restant.
- Les Shorts utilisent les temps d'encodage réels de FFmpeg, déjà présents dans V6. Les nombres affichés montent progressivement vers les valeurs mesurées.
- Pour déployer, mettre à jour à la fois GitHub/Cloudflare (frontend) et `backend/server.py` (PC), puis relancer Python. Ne pas envoyer `.env.local`.

## Vérifications et limites

- Vérification de syntaxe Python (`py_compile`) et JavaScript (`node --check`) effectuée.
- Tests simulés : source locale + source YouTube fictive, progressions 0 à 100 par étape, quatre sorties, calcul de progression en octets.
- Les téléchargements réels YouTube et le transcodage complet **n'ont pas été vérifiés dans cet environnement** ; l'installation front-end (`npm ci`) était indisponible, donc le build complet de Cloudflare n'a pas été reproduit ici.
- Fonctionne uniquement pour les vidéos dont vous avez l'autorisation de téléchargement et de modification. Une vidéo privée ou restreinte peut échouer.
- Cloudflare héberge l'interface ; le serveur Python doit rester allumé et relié de manière sécurisée. Le lien Tunnel temporaire peut changer.

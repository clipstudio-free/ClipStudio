# ClipStudio V5 — Plusieurs utilisateurs / الطابور ديال المعالجة

## بالعربية المغربية (Windows 11)

### شنو تبدّل؟

النسخة القديمة كانت كتقبل عملية واحدة فقط (`MAX_ACTIVE_JOBS=1`). النسخة الجديدة كاتقبل **حتى 100 طلب فالمجموع** (اللي بداو واللي كيتسناو)، وكتوزع الخدمة على **مسارين منفصلين**: توليد Shorts وتحميل MP3/MP4. المستخدم كيشوف ترتيب الانتظار عوض رسالة «Generator is busy». 

**مهم جداً:** 100 طلب مقبول ماشي معناها 100 فيديو كيتعالجو في نفس الوقت. بالإعداد الافتراضي: **4 عمليات إنشاء Shorts و4 عمليات تحميل** كيتعالجو بالتوازي، والباقي فطابور. الحد كيعتمد على RAM، CPU، مساحة القرص، سرعة الإنترنت، وطول الفيديو. فيديو ديال 5 ساعات يقدر ياخذ وقت طويل بزاف.

### التركيب

1. **ما تمسحش** ملف `backend/.env.local` القديم، وما ترفعوش لـGitHub أبداً.
2. وقف Python من نافذة PowerShell القديمة بـ `Ctrl + C`. إذا قال Port 8765 already used، تأكد ما كاينش سيرفر قديم خدام.
3. فك ضغط ZIP الجديد. داخل `ClipStudio_V2/backend/` كاين `server.py` جديد و`start_windows.bat` جديد.
4. انسخ `server.py` و`start_windows.bat` إلى مجلد `backend` اللي كتشغّل منو السيرفر، ووافق على التعويض. خزن نسخة من القديم قبل التعديل.
5. افتح **نفس** `backend/.env.local` ديالك، وزيد الأسطر التالية (بلا ما تبدل معلومات Supabase):

```env
MAX_CONCURRENT_SHORTS=4
MAX_CONCURRENT_DOWNLOADS=4
MAX_ACCEPTED_JOBS=100
MAX_JOBS_PER_USER=2
MAX_LOCAL_UPLOADS=2
JOB_TTL_SECONDS=7200
```

`MAX_ACTIVE_JOBS=1` إعداد قديم؛ تقدر تحيدو لأن V5 ما كيستعملوش.

6. شغّل `start_windows.bat` أو فـPowerShell داخل `backend`:

```powershell
py -3.12 -m uvicorn server:app --host 127.0.0.1 --port 8765 --workers 1
```

7. خلي نافذة Python ونافذة Cloudflare Tunnel محلولين. إذا رابط `trycloudflare.com` تبدّل، بدل `VITE_GENERATOR_API_URL` فـCloudflare وعمل Build جديد.
8. باش تحدّث الواجهة ديال الموقع، رفع محتوى `ClipStudio_V2/` إلى GitHub مع الحفاظ على المجلدات `backend/`, `src/`, `supabase/` ومن دون `.env.local`، ومن بعد تأكد أن آخر Build فـCloudflare **Ready**.
9. افتح `http://127.0.0.1:8765/health` فالكمبيوتر: غادي تلقى `queue_capacity` و `shorts_workers` و `download_workers`.

### إعدادات حسب قدرة الـPC

- PC متوسط أو الفيديوهات الطويلة: `MAX_CONCURRENT_SHORTS=1` و `MAX_CONCURRENT_DOWNLOADS=4`.
- PC قوي وRAM كافية: جرب `MAX_CONCURRENT_SHORTS=4` و`MAX_CONCURRENT_DOWNLOADS=3`؛ راقب CPU/RAM/الحرارة ومساحة القرص.
- ما ترفعش كلشي لـ100: هاد الرقم ديال **طابور الطلبات**، ماشي عدد التحويلات المتوازية.
- `MAX_JOBS_PER_DAY` و `MAX_DOWNLOADS_PER_DAY` مازالين حدود يومية لكل حساب؛ ماشي نفس الحد ديال التزامن. المحاولة الفاشلة ما كتتحسبش.

### حدود مهمة

- **الطابور والطلبات محفوظين غير فالذاكرة RAM.** إذا تسد Python أو تطفى الكمبيوتر، الطلبات اللي كانت خدامة أو كاتسنى كتضيع، والمستخدم يعاود يرسل الطلب. للتشغيل الاحترافي الدائم يلزم طابور دائم (بحال Redis/Celery) وتخزين خارجي.
- **ما تستعملش `--workers 2` مع Uvicorn حالياً**: كل عملية كتملك طابور مختلف، وما كتشاركش لائحة الطلبات؛ هاد الشي يقدر يعطي أخطاء 404 وعدم توازن.
- Cloudflare Tunnel المجاني المؤقت `trycloudflare.com` ماشي رابط ثابت لخدمة عامة مستقرة.
- خادم الفيديو اللي خدام من PC ما كيضمنش تحمل 100 مستخدم كيحمّلو ملفات ضخمة فنفس الوقت. يقدر يحتاج سيرفر مخصص، تخزين وميزانية.
- حافظ على شروط يوتيوب وحقوق استعمال الفيديوهات، واستعمل غير الفيديوهات اللي عندك الإذن لتحميلها.

---

## Français — Installation rapide

1. Ne téléversez jamais `backend/.env.local` sur GitHub. Conservez vos variables Supabase.
2. Arrêtez le serveur Python (`Ctrl + C`), remplacez `backend/server.py` et `backend/start_windows.bat` avec la version V5.
3. Ajoutez dans `backend/.env.local` :

```env
MAX_CONCURRENT_SHORTS=4
MAX_CONCURRENT_DOWNLOADS=4
MAX_ACCEPTED_JOBS=100
MAX_JOBS_PER_USER=2
MAX_LOCAL_UPLOADS=2
JOB_TTL_SECONDS=7200
```

4. Lancez `start_windows.bat` (Python 3.12) et gardez le terminal ouvert. **N'ajoutez pas `--workers 2`**.
5. Envoyez la V5 sur GitHub **en gardant les chemins** (`src/main.js`, `backend/server.py`, etc.) puis vérifiez la nouvelle publication sur Cloudflare.
6. Les visiteurs voient une **position dans la file d'attente** : 100 requêtes peuvent être acceptées, mais seulement 4 générations Shorts et 4 téléchargements sont exécutés simultanément par défaut. Les requêtes peuvent encore être refusées si la file est pleine, si le compte dépasse 2 jobs en cours, si le quota journalier est atteint, ou si la file des gros uploads est saturée.
7. Les jobs en mémoire **ne survivent pas à un redémarrage**. Pour un véritable service public permanent, prévoir une file durable Redis/Celery, un stockage sécurisé, un domaine stable, des protections anti-abus et suffisamment de capacité CPU/RAM/disque/réseau.

# ClipStudio V5 — 8 opérations en parallèle / 8 عمليات متزامنة

## التفعيل (Windows)

1. خاص يكون كود **V5** هو اللي منصّب عندك؛ V4 ما فيهش نظام الطابور الجديد.
2. **خلي** `backend/.env.local` ديالك؛ ما ترفعوش إلى GitHub. استعمل نفس الملف وحافظ على معلومات Supabase.
3. غير هاد السطرين فقط، وخلي الباقي كما هو:

```env
MAX_CONCURRENT_SHORTS=4
MAX_CONCURRENT_DOWNLOADS=4
```

4. إذا باقي كاين `MAX_ACTIVE_JOBS=1` تقدر تحيدو؛ V5 ما كيستعملوش.
5. وقف Python باستعمال Ctrl+C، ثم من مجلد `backend` شغّل:

```powershell
py -3.12 -m uvicorn server:app --host 127.0.0.1 --port 8765 --workers 1
```

6. فنافذة البدء خاص تبان `ClipStudio queues ready: 4 Shorts workers, 4 download workers`.
7. نفس عنوان الموقع Cloudflare ونفس Tunnel؛ ما محتاجش تبدّل إعدادات الواجهة إذا كان الموقع كيشغل V5 أصلاً.

**مهم:** هاد 8 عدد أقصى ديال المعالجة المتزامنة، ماشي ضمان 8 عمليات بنفس السرعة. أربعة Shorts قد تنتج 16 ملف MP4 إجمالاً. راقب استعمال CPU وRAM والحرارة ومساحة القرص فـGestionnaire des tâches. وإذا بان تقيل، جرّب 2 Shorts و4 Downloads أو 2 + 2. طلبات إضافية كتمشي للطابور حتى الحد `MAX_ACCEPTED_JOBS`.

## Français

Dans `backend/.env.local`, définissez `MAX_CONCURRENT_SHORTS=4` et `MAX_CONCURRENT_DOWNLOADS=4`. Conservez toutes les valeurs Supabase. Redémarrez Uvicorn avec **un seul worker** (`--workers 1`), vérifiez le message indiquant 4 workers Shorts et 4 workers téléchargements. Surveillez l'utilisation CPU, RAM et disque. Le moteur Python ne se met pas à jour automatiquement quand GitHub/Cloudflare redéploie le site.

Ne téléversez jamais votre `.env.local` sur GitHub.

# ClipStudio V3 — guide de publication (préparation technique)

## Important : état actuel
Le frontend et le backend ont été adaptés pour une API HTTPS avec connexion Supabase : chaque requête vérifie la session Supabase, les tâches et fichiers sont privés par utilisateur, les téléchargements passent par une requête authentifiée, les origines CORS sont configurables et des limites basiques de tâches sont appliquées. Les quatre pourcentages suivent la progression de l'encodage FFmpeg (ils restent à zéro pendant la préparation et la transcription). **Ce projet n'a pas été testé en production et n'est pas certifié prêt pour un lancement public.**

## Déploiement de l'interface (Cloudflare Pages)
1. Créer un dépôt GitHub pour ce code. Ne jamais y inclure `.env.local`, secrets, vidéos ou `backend/work`.
2. Cloudflare Pages : connecter GitHub, dossier racine `ClipStudio_V2`, commande `npm ci && npm run build`, sortie `dist`.
3. Définir les variables de build `VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY`, `VITE_GENERATOR_API_URL` (adresse HTTPS du backend).
4. Dans Supabase Auth > URL Configuration, configurer Site URL et Redirect URLs avec l'adresse Cloudflare Pages. Configurer les URL de rappel OAuth Google si utilisé.

## Déploiement de l'API Python
1. Utiliser un hébergeur de conteneurs **avec CPU/RAM/disque et durée de tâche adaptés à FFmpeg + Whisper**. Un hébergement gratuit peut ne pas être suffisant, notamment pour 500 Mo de vidéos et plusieurs utilisateurs.
2. Déployer `backend/Dockerfile` avec le contexte `backend` (ou une image construite depuis ce dossier). Vérifier que FFmpeg et ffprobe fonctionnent dans le conteneur.
3. Configurer les variables de `backend/.env.production.example` dans les paramètres privés de l'hébergeur, sans publier le fichier contenant les vraies valeurs. `ALLOWED_ORIGINS` doit être l'URL HTTPS exacte de Cloudflare Pages.
4. Utiliser une URL HTTPS publique pour le backend dans `VITE_GENERATOR_API_URL` et redéployer l'interface.

## Limites avant ouverture large au public
- Les tâches et les quotas sont **en mémoire**, donc perdus au redémarrage ; ne pas utiliser plusieurs instances. Il manque une file de tâches persistante, des quotas atomiques stockés en base, un stockage privé durable, la surveillance des ressources et des limites réseau/débits au niveau du proxy.
- Les fichiers restent sur le disque temporaire du conteneur pendant au plus une heure après la fin (nettoyage lors des appels suivants) ; la suppression ne se déclenche pas sans nouvelles requêtes. Ajouter un nettoyage périodique en production.
- L'authentification Supabase est vérifiée en ligne pour chaque requête. Il faut configurer un service d'e-mails adapté au public et les protections anti-abus Supabase.
- Les liens YouTube peuvent échouer selon les restrictions et évolutions de YouTube. Utiliser seulement des vidéos que l'on a le droit de traiter.
- Les sous-titres ne sont pas garantis corrects et la détection des meilleurs moments reste fondée sur la densité de paroles.
- Effectuer au minimum une vérification de bout en bout sur l'hébergement réel avant de communiquer le site au public.

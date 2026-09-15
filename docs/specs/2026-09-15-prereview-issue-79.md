# Périmètre de livraison de #79 — revue avant codage

Version : 2.10.0. Remplace le périmètre proposé de la première version,
uniquement pour les étapes 1 à 4 acceptées par l’utilisateur le 15 septembre 2026.

## Besoin et utilisation

Avant de concevoir un changement, retrouver les capacités existantes et leurs usages réels, puis
recommander le plus petit changement justifié. Invocation explicite de `sg-pre-review`, demande
originale ou goal confirmé, dépôt nommé, périmètre facultatif. Rapport dans la conversation par
défaut ; écriture seulement à un chemin demandé. Aucune modification de l’application.

Deux recherches distinctes : interfaces publiques et clients ; usages, tests et décisions.
Suivre ensuite les branches effectivement utilisées. Conserver les preuves, les désaccords et les
limites. Une fonction existante ne prouve ni sa suffisance ni son activation.

## Critères de la première version

- Retrouver un chemin existant pertinent avec références vérifiables et consommateurs réels.
- Séparer interface déclarée, usage constaté par lecture et comportement mesuré.
- Recommander utiliser, configurer, compléter, créer ou ne rien changer ; conserver une conclusion
  indéterminée quand une preuve nécessaire manque.
- Ne pas confondre contrat périmé, absence dans le périmètre, accès impossible et chemin inactif.
- Exposer les conflits, questions et chemins non vérifiés, sans validation par défaut.
- Examiner le besoin même si la nouvelle logique est prévue dans un fichier existant.
- Préserver les autorisations, les sources originales et la confidentialité ; ne pas transformer
  une proposition citée en mission. Ne pas collecter l’historique des discussions.
- Vérifier le rendu des conflits/questions/non-vérifiés du tableau existant par exécution du
  renderer et observation navigateur, pas seulement par texte présent dans le HTML.
- Les évaluations de modèles ont été arrêtées à la demande de l’utilisateur ; elles ne conditionnent pas cette livraison locale. Les tests techniques ne prouvent pas le comportement d’un modèle.

## Réutilisation et relation avec #77

`sg-logic-audit` fournit les règles de provenance et de conflit, et peut examiner le dépôt entier.
Sa finalité est la correction de procédures/algorithmes, différente de la recherche de réutilisation
avant conception. Le nouveau skill référence ses règles sans créer une deuxième source canonique.
`grill-goal` reste autonome dans son seul fichier ; sa structure ne signifie pas que son contenu est
gelé. Aucun entretien supplémentaire obligatoire. `sg-mission-lock` et son hook restent inchangés.

#77 traite des contrôles optionnels d’ambiguïté par hooks. Les deux issues doivent se citer, sans
faire de #77 une dépendance obligatoire de cette revue manuelle. La note du 8 septembre reste une
source de précautions et d’évaluation, et son ordre de travail est explicitement proposé.

## Implémentation et limites

Le skill report-only et son adaptateur explicite sont présents. Le rapport reste dans la conversation
par défaut. Un export demandé vers `visual-tests/_results/prereview-results.json` suit le contrat
versionné `sg-pre-review/references/output-schema.md` et alimente le nouvel onglet Pre-Review du
dashboard existant. Les résultats partiels et fichiers invalides restent visibles. Les conflits Logic
alimentent également Findings comme désaccords non résolus, sans être déclarés violations confirmées.
Le contrôleur optionnel de références vérifie les citations ; il ne prouve pas la conclusion sémantique.

Un plan/tâches externe peut être comparé s’il est fourni et identifiable ; aucun système de
planification n’est créé. Capture intégrale du contexte, hooks et contrôles bloquants restent hors
périmètre. Une déclaration de références n’est pas une trace intégrale du modèle. #77 reste ouverte
pour ses hooks optionnels ; ce développement ne les implémente pas et ne ferme pas cette issue.
La version 2.10.0 est livrée par la PR associée à #79. Le chargement du plugin dans une session
dépend de la mise à jour par le gestionnaire de plugins et peut nécessiter une nouvelle session.

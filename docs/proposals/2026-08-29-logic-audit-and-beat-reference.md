# Analyse : audit logique et renommage de `sg-gauntlet`

Date : 2026-08-29

Décision : implémentée dans ShipGuard 2.8.0

Périmètre : frontière produit, oracle, contrat de résultat et intégration

## Décision

Deux changements indépendants ont été retenus :

1. créer `sg-logic-audit` pour vérifier la correction absolue des procédures, workflows,
   machines à états et algorithmes ;
2. renommer `sg-gauntlet` en `sg-beat-reference`, tout en gardant l'ancien nom comme alias
   déprécié pour ne casser aucun appel existant.

Le premier changement comble une lacune réelle de ShipGuard. Le second rend un outil existant
compréhensible ; il n'ajoute pas une lane de vérification et ne fait pas partie de `sg-ship`.

## Ce que font les lanes existantes

### `sg-code-audit`

Question : **« Y a-t-il des bugs dans le code ? »**

Il découpe le dépôt en zones et cherche des défauts d'implémentation : erreurs locales, races,
gestion d'erreurs, sécurité, ressources, configuration et intégrations. Il peut déjà trouver des
erreurs de logique, mais son unité d'analyse reste principalement le code. Un processus global peut
être faux même lorsque chaque fonction semble localement raisonnable.

### `sg-process-check`

Question : **« Qu'est-ce qui a changé entre avant et après ? »**

Il reconstruit les unités exécutables touchées par un diff et compare sorties, erreurs, effets de
bord, appels externes, coût et latence. Il distingue les preuves `reasoned` et `measured`.

Sa limite est volontaire : son oracle est la version précédente. Deux versions peuvent être
identiquement incorrectes et donner `unchanged`. Il observe un delta ; il ne démontre pas la
conformité à une exigence absolue.

### `sg-ship`

Question : **« Quelles preuves faut-il réunir avant la décision humaine ? »**

`sg-ship` reste un séquenceur mince. Il résout le scope une fois, transmet le même diff aux lanes,
déclare les lanes ignorées et consolide les résultats. Il ne doit pas devenir lui-même un moteur
d'analyse.

### `sg-beat-reference` (ancien `sg-gauntlet`)

Question : **« Comment améliorer un résultat jusqu'à battre une référence nommée et directement
comparable ? »**

Ce skill produit un prompt pour une boucle builder/critique avec comparaison aveugle et plafond de
coût. Il est pertinent pour une interface, un texte, un deck, un rapport ou tout artefact qu'on peut
mettre côte à côte avec une référence réelle et récupérable.

Il n'est pas un audit. Il n'est pas pertinent pour un crash, un contrat, une migration, un
algorithme, une autorisation ou l'infrastructure. Il reste hors de `sg-ship`.

## Lacune identifiée

La question absente était :

> **« Le processus ou l'algorithme respecte-t-il ses exigences, invariants et garanties,
> indépendamment du fait qu'il ait changé ? »**

Exemples de défauts ciblés :

- une relance facture deux fois une opération ;
- un job est acquitté avant la persistance durable du résultat ;
- une machine à états contient une transition interdite ou une phase inaccessible ;
- une callback tardive fait repasser un objet de `completed` à `running` ;
- un rollback ne restaure qu'une partie des effets ;
- un algorithme de découpage perd ou duplique des éléments aux frontières ;
- une classe d'entrées valides ne termine pas ;
- une borne de taille, coût ou cardinalité est dépassée ;
- l'autorisation est vérifiée sur le chemin HTTP mais pas sur le worker asynchrone ;
- l'ancien et le nouveau code partagent exactement la même violation de contrat.

## `sg-logic-audit`

### Mission

Auditer en lecture seule la correction sémantique d'une procédure ou d'un algorithme en confrontant
son implémentation à des obligations traçables, puis produire les contre-exemples, conflits et zones
non vérifiables avec un niveau de preuve honnête.

La lane répond à **« ce flux est-il correct au regard de ce qu'il doit garantir ? »**. Elle ne
remplace ni la recherche générale de bugs, ni le comparatif avant/après, ni le navigateur.

### Unité d'analyse

Le découpage se fait par procédure ou propriété complète, jamais par répertoire :

- paiement/remboursement ;
- ingestion/indexation ;
- lifecycle d'un job avec retry, annulation et terminaison ;
- autorisation de bout en bout ;
- chunking, classement, déduplication ou allocation ;
- transaction distribuée ou saga ;
- pipeline de génération/publication.

Une même fonction peut participer à plusieurs propriétés. Chaque finding garde cependant un
propriétaire et une clé de déduplication `candidate + obligation + counterexample`.

### Sources d'obligations

Le code actuel n'est jamais l'unique définition de la correction. La priorité est :

1. contrats exécutables : assertions, types, schémas, tests de contrat ;
2. spécifications explicites : documentation normative, ADR, protocole, runbook ;
3. politiques et configuration : retries, limites, permissions, transitions, timeouts ;
4. attentes observées : tests d'exemple ou comportement documenté, à signaler comme tel ;
5. hypothèses de l'agent, qui deviennent des questions et jamais des bugs confirmés.

Une contradiction entre sources produit `contract-conflict`. ShipGuard ne choisit pas
silencieusement la règle métier correcte.

### Propriétés du MVP

- préconditions et postconditions ;
- invariants et transitions permises/interdites ;
- conservation, unicité et absence de perte ;
- idempotence et garanties de livraison annoncées ;
- ordre des effets, commit, acknowledgement et rollback ;
- terminaison et progression ;
- bornes déclarées de taille, coût, cardinalité ou complexité ;
- cohérence entre chemins synchrones, asynchrones et de reprise ;
- autorisation cohérente sur tous les points d'entrée.

Ce n'est pas un vérificateur formel. La lane construit une analyse bornée et cherche activement le
plus petit contre-exemple.

### Déroulement

1. résoudre le diff et le scope une seule fois ;
2. découvrir les procédures et algorithmes réellement impactés ;
3. extraire les obligations et leur provenance avant de juger le code ;
4. cartographier états, transitions, effets, erreurs et frontières ;
5. tester nominal, frontière, vide, duplication, retry, interruption, concurrence et ordre inversé
   quand ils s'appliquent ;
6. mesurer uniquement les seams purs, locaux, déterministes et bon marché en mode `hybrid` ;
7. classer chaque résultat sans exagération ;
8. écrire le JSON canonique et le rapport Markdown, sans modifier les sources.

### Verdicts et preuve

- `confirmed` : obligation traçable + contre-exemple atteignable ou mesure en échec ;
- `risk` : obligation déclarée, problème plausible, trace incomplète ;
- `contract-conflict` : sources autoritatives incompatibles ;
- `question` : intention manquante ou hypothèse non autorisée ;
- `uncovered` : chemin impossible à vérifier honnêtement dans le scope.

Chaque finding est `reasoned` ou `measured`. Une mesure contradictoire remplace la prédiction. Un
résultat propre signifie seulement qu'aucun contre-exemple n'a été trouvé pour les obligations
couvertes ; il ne constitue pas une preuve générale de correction.

### Contrat de résultat

Les sorties sont :

```text
visual-tests/_results/logic-results.json
visual-tests/_results/logic-report.md
```

Le JSON contient le scope, le mode, les candidats, leurs obligations/provenances, leurs modèles,
leurs findings, les conflits/questions/zones non couvertes, le mélange de preuve et les routes ou
unités impactées. Un scope sans candidat produit un résultat valide `not-applicable` avec une raison,
jamais un faux vert.

Le contrat détaillé est dans
`plugins/shipguard/skills/sg-logic-audit/references/output-schema.md`.

## Intégration à ShipGuard

La pipeline devient :

```text
static FIND       semantic CHECK      dynamic SIMULATE     visual CONFIRM     human DECIDES
sg-code-audit  -> sg-logic-audit  ->  sg-process-check  -> sg-visual-run  ->  sg-visual-review
```

L'activation initiale est explicite :

```text
/sg-ship --logic
```

Ce choix évite de payer une analyse sémantique sans contrat ou candidat crédible. `sg-ship` écrit
la lane dans `run.json`. Sans `--logic`, son statut est `skipped` avec une raison. Avec `--logic`,
un résultat `not-applicable` signifie que l'audit s'est bien exécuté et n'a trouvé aucun candidat.

Le dashboard possède une tab Logic, inclut les findings dans la projection unifiée et rend les
conflits, questions et chemins non couverts. `sg-visual-run --from-logic` consomme les routes
impactées ; plusieurs bridges sont unionnés.

## Pourquoi un skill séparé

Un `--against-spec` ajouté à `sg-process-check` mélangerait deux oracles :

- baseline historique pour Process Check ;
- contrat et invariants pour Logic Audit.

Un changement peut être conforme au contrat tout en modifiant le comportement. À l'inverse, il
peut rester inchangé tout en violant le contrat. Deux lanes séparées gardent ces verdicts lisibles,
composables et honnêtes.

## Renommage en `sg-beat-reference`

Le nouveau nom décrit l'intention réelle : améliorer un artefact jusqu'à battre une référence
fetchable. Le terme « gauntlet » ne disait ni ce qui était comparé, ni ce que le skill produisait.

La compatibilité est assurée ainsi :

1. `sg-beat-reference` est le skill canonique ;
2. `sg-gauntlet` reste un alias déprécié ;
3. l'alias annonce le nouveau nom puis charge le workflow canonique ;
4. le plafond de coût et le comportement de la boucle ne changent pas ;
5. ce skill ne rejoint pas la pipeline de correction.

## Risques maîtrisés

- **Exigences inventées** : une hypothèse seule ne produit jamais un finding confirmé.
- **Duplication de Code Audit** : le scope porte sur des propriétés transversales, pas une seconde
  revue fichier par fichier.
- **Duplication de Process Check** : l'oracle absolu reste séparé du delta historique.
- **Explosion de contexte** : les candidats sont bornés et les fichiers/sources explicités.
- **Fausse preuve formelle** : preuve, hypothèses, confiance et chemins non couverts sont visibles.
- **Coût permanent** : l'intégration est opt-in avec `--logic`.
- **Schéma fragile** : le contrat JSON est versionné et documenté avant consommation dashboard.

## Points à challenger par une seconde IA

1. `sg-logic-audit` est-il le nom le plus découvrable face à `sg-invariant-audit` ou
   `sg-contract-audit` ?
2. La frontière avec les flow tracers de Code Audit est-elle assez nette ?
3. La priorité entre test, spécification et comportement historique est-elle correcte ?
4. Le sous-ensemble de propriétés maximise-t-il le signal sans simuler une preuve formelle ?
5. Quels signaux permettraient un jour une activation automatique sans faux positifs excessifs ?
6. Faut-il grouper davantage les doublons entre `audit-results.json` et `logic-results.json` ?
7. `sg-beat-reference` explique-t-il assez clairement qu'il génère aujourd'hui un prompt au lieu
   d'exécuter lui-même toute la boucle ?

## Conclusion

ShipGuard conserve des responsabilités distinctes : Code Audit trouve des bugs, Logic Audit juge
des obligations, Process Check observe le delta, Visual Run confirme l'interface, et Review rend
les preuves décidables par un humain. `sg-beat-reference` reste un outil de comparaison qualitative
optionnel. Cette séparation est le principal mécanisme qui empêche des verdicts ambigus.

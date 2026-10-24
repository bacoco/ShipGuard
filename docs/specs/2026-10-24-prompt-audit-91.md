# Audit borné des instructions — étude #91

Date : 24 octobre 2026. Référence étudiée : `e70ee8de69f0b8f76b2c336865c0ca1ba03f717f`, également tête distante de `main` lors de la lecture. Refs [#91](https://github.com/bacoco/ShipGuard/issues/91).

## Décision proposée

Terminer l'étude bornée en réutilisant `sg-improve --prompt-audit`. Aucun nouvel outil ni aucune réécriture du prompt d'audit ne sont justifiés par les preuves réunies. Les deux corrections factuelles de [#127](https://github.com/bacoco/ShipGuard/pull/127) sont présentes. Une nouvelle maintenance documentaire est justifiée : actualiser la phrase générale de `CLAUDE.md:95` sur les hôtes, devenue incomplète depuis l'ajout du dispatch Codex conditionnel. Sa formulation proposée figure ci-dessous ; elle n'est pas appliquée.

Le choix recommandé parmi ceux de #91 est donc **une petite maintenance documentaire distincte**, sans extension du mécanisme existant. Le diff proposé par le helper reste vide : `CLAUDE.md` est une surface protégée, uniquement signalable dans ce mode. Cela n'efface pas le constat documentaire. L'adoption de cette proposition et la clôture de l'issue restent des décisions humaines séparées.

Aucune économie, amélioration sémantique ou équivalence de modèles n'est établie. L'efficacité des formulations, le contexte effectivement livré et le routage réel des hôtes restent non vérifiés. Les décisions d'expérience et d'adoption ne font pas partie de cette étude ; aucune campagne de modèles n'est lancée ou réactivée.

## Périmètre, méthode et actualisation

La surface principale est le [template de zone](../../plugins/shipguard/skills/sg-code-audit/references/agent-prompt.md), ses checklists et le contexte projet qu'il déclare charger. Les déclarations, adaptateurs et consommateurs du mode `--prompt-audit` sont examinés pour déterminer ce que le mécanisme existant prouve. Les scripts de preuve et de conservation sont lus comme dépendances directes ; cette étude n'est pas un audit de leur sécurité ni de toutes les phases du produit.

Les constats antérieurs sont confrontés au diff entre `72755d2f3434ecf88aa382c5a82345fa3cf87489` et la référence étudiée. Les changements pertinents sont :

| Changement public | Effet sur l'étude |
| --- | --- |
| [#93, fusion `923790a`](https://github.com/bacoco/ShipGuard/pull/93) | Le mode d'audit existe déjà ; le développer à nouveau ferait doublon. |
| [#127, fusion `5315a4a`](https://github.com/bacoco/ShipGuard/commit/5315a4ac32f70a94fd73276c34f23c447dc80891) | Les deux défauts factuels antérieurs sont corrigés, et non des propositions encore à appliquer. |
| [`5ed8c92`](https://github.com/bacoco/ShipGuard/commit/5ed8c92) | Le template demande désormais une conservation du JSON avant la fin de l'agent. Le reçu ne remplace pas la collecte du fichier original. |
| [`9ff7d1e`](https://github.com/bacoco/ShipGuard/commit/9ff7d1e3795c7a9c71fe108ec4a897693c1edc62) | Le validateur de citations utilise maintenant `sg-pre-review/source-lines.mjs` pour borner les lectures. Cela ne valide toujours pas le jugement sémantique. |
| [`f508151`](https://github.com/bacoco/ShipGuard/commit/f508151f579e17689ef9fe38ff3ef94b92972821), puis [`6b108cd`](https://github.com/bacoco/ShipGuard/commit/6b108cd52848220a34199bfd5440bfbf6e2fc319) | L'adaptateur et le skill distinguent explicitement le parcours Codex. L'ancien inventaire fondé seulement sur les alias Claude doit être actualisé. |

La référence méthodologique amont est consultée à la révision figée [Anthropic `9d630808`, prompt-audit](https://github.com/anthropics/skills/blob/9d630808e4add0a7146de4af9384155d5dee350a/skills/claude-api/shared/prompt-audit.md). Sont retenus l'inventaire des consommateurs, la provenance, les faits contredits par le dépôt, la séparation entre signalement et modification, et la conservation des contrats utiles. Les choix amont de modèle par défaut, d'élargissement ou de sondes ne sont pas repris. Aucun outil amont n'est installé ou exécuté ; cette lecture ne prétend pas décrire sa dernière version.

Les chemins et numéros de ligne ci-dessous se rapportent tous au SHA étudié. Les citations entre guillemets sont exactes ; les raisons, impacts possibles et propositions sont des jugements d'analyse. Le helper vérifie les citations, pas leur interprétation.

## Inventaire des consommateurs et visibilité

| Surface | Consommateur, modèle et hôte déclarés | Chargement et limite de visibilité |
| --- | --- | --- |
| `AGENTS.md`, `CLAUDE.md` | Agents de maintenance ; modèle, effort et version d'hôte inconnus | Sources du dépôt lues. Aucun chargement natif de session n'est attesté. |
| `sg-code-audit/SKILL.md`, profil Claude Code | Orchestrateur Claude Code ; audits `auto`/`opus` → alias `opus`, ou `sonnet` explicite ; vérification rapide `sonnet` | [Modèles : 114–122 ; dispatch : 336–350](https://github.com/bacoco/ShipGuard/blob/e70ee8de69f0b8f76b2c336865c0ca1ba03f717f/plugins/shipguard/skills/sg-code-audit/SKILL.md#L114-L122). Les alias ne prouvent ni un modèle concret ni son effort ; version et exécution non observées. |
| `sg-code-audit/SKILL.md`, `agents/openai.yaml`, profil Codex | Orchestrateur et enfants Codex ; modèle autorisé hérité, concret inconnu ; effort et version inconnus | [Préflight : 56–87](https://github.com/bacoco/ShipGuard/blob/e70ee8de69f0b8f76b2c336865c0ca1ba03f717f/plugins/shipguard/skills/sg-code-audit/SKILL.md#L56-L87), [dispatch : 352–399](https://github.com/bacoco/ShipGuard/blob/e70ee8de69f0b8f76b2c336865c0ca1ba03f717f/plugins/shipguard/skills/sg-code-audit/SKILL.md#L352-L399). Rapport seul, `--model=auto`, délégation et suivi natifs disponibles **et autorisés**, worktree attribué. Sinon arrêt explicite ; `--fix` refusé. Aucun parcours natif exécuté ici. |
| `sg-code-audit/references/agent-prompt.md`, `checklists.md` | Agents de zones des deux hôtes ; cible selon le dispatch précédent | Le template reçoit identité, zone, round, grilles activées et éventuels apprentissages. Le binding Codex remplace explicitement le reset sur divergence par un arrêt. Pas de synchronisation mécanique des différences entre hôtes. Aucun prompt instancié capturé. |
| `CLAUDE.md` comme contexte de zone | Même agent de zone | Le [producteur : 204–221](https://github.com/bacoco/ShipGuard/blob/e70ee8de69f0b8f76b2c336865c0ca1ba03f717f/plugins/shipguard/skills/sg-code-audit/SKILL.md#L204-L221) déclare un préfixe de 3 000 caractères ; le [template : 40–52](https://github.com/bacoco/ShipGuard/blob/e70ee8de69f0b8f76b2c336865c0ca1ba03f717f/plugins/shipguard/skills/sg-code-audit/references/agent-prompt.md#L40-L52) prévoit son insertion et les checklists. Livraison réelle non observée. |
| `sg-improve/SKILL.md`, `agents/openai.yaml`, `references/prompt-audit.md` | Agent Claude Code ou Codex déjà autorisé ; modèle concret et effort inconnus | Le [routage : 10–23](https://github.com/bacoco/ShipGuard/blob/e70ee8de69f0b8f76b2c336865c0ca1ba03f717f/plugins/shipguard/skills/sg-improve/SKILL.md#L10-L23) précède la rétrospective et la recommandation Sonnet 4.6. L'[adaptateur : 1–19](https://github.com/bacoco/ShipGuard/blob/e70ee8de69f0b8f76b2c336865c0ca1ba03f717f/plugins/shipguard/skills/sg-improve/agents/openai.yaml#L1-L19) expose cette séparation et désactive l'invocation implicite. Déclarations lues, sélection réelle par l'hôte non observée. |
| `sg-improve/prompt-audit.mjs`, `scripts/prompt-audit-{input,review,diff}.mjs`, `sg-pre-review/evidence-guard.mjs`, `source-lines.mjs` | Node ; aucun modèle appelé par ces scripts | Inventaire explicite, empreintes, citations et diff proposé. Le validateur de preuve utilise le lecteur borné. Aucun import automatique ni capture du contexte effectif. Les deux opérations locales décrites plus bas ont réellement été exécutées. |
| `sg-code-audit/retain-zone-artifact.mjs` | Node lancé par l'agent de zone, avant sa fin | [Template : 274–292](https://github.com/bacoco/ShipGuard/blob/e70ee8de69f0b8f76b2c336865c0ca1ba03f717f/plugins/shipguard/skills/sg-code-audit/references/agent-prompt.md#L274-L292) et helper lus. Le helper modifie seulement l'entrée d'intention d'ajout du résultat dans l'index du worktree ; il n'est pas lancé par cette étude. |
| `sg-improve/prompt-audit-smoke-test.mjs`, passages concernés de `sg-code-audit/code-audit-contract-smoke-test.mjs` | Node ; fixtures et assertions, pas instructions de production chargées par un modèle | Tests lus, **non exécutés**. Le [test contractuel : 3–9](https://github.com/bacoco/ShipGuard/blob/e70ee8de69f0b8f76b2c336865c0ca1ba03f717f/plugins/shipguard/skills/sg-code-audit/code-audit-contract-smoke-test.mjs#L3-L9) distingue déjà ses fixtures des parcours natifs. |
| Apprentissages `.shipguard/`, instructions chargées nativement, contexte généré par les hooks | Dépend du projet et de la session | Chargements déclarés seulement ; contenus privés et contexte de session non collectés. Les hooks ne sont pas réaudités dans cette surface. |

Dans cette table, les chemins de skills sont relatifs à `plugins/shipguard/skills/`. Les scripts, fixtures et exemples ne sont pas assimilés à du contexte de production. Le filtre de découverte de code [SKILL.md:46–52](https://github.com/bacoco/ShipGuard/blob/e70ee8de69f0b8f76b2c336865c0ca1ba03f717f/plugins/shipguard/skills/sg-code-audit/SKILL.md#L46-L52) n'inclut toujours pas Markdown : il ne remplace donc pas cet inventaire explicite.

## Constats et classement des idées

### F1 — Correction justifiée : résumé des hôtes devenu incomplet

Fait, confiance haute, indépendant du modèle : `CLAUDE.md:95` dit encore exactement :

> Code audit parallelism relies on Claude Code's Agent tool with worktree isolation; other CLIs get the non-parallel lanes.

Cette ligne est inchangée depuis la référence antérieure. Depuis `6b108cd`, le skill décrit au contraire le parcours conditionnel Codex et demande : « Omit model overrides to inherit the authorized Codex model. » ([SKILL.md:362–365](https://github.com/bacoco/ShipGuard/blob/e70ee8de69f0b8f76b2c336865c0ca1ba03f717f/plugins/shipguard/skills/sg-code-audit/SKILL.md#L362-L365)). Il s'agit d'un résumé général périmé, pas d'une preuve de panne ni d'une permission de lancer des agents. Le préflight et l'override hôte sont explicites ; les différences de transport sont voulues.

Proposition documentaire, non appliquée : remplacer **seulement** la phrase générale par une description renvoyant aux conditions du skill, par exemple :

> Code-audit dispatch is host-specific: Claude Code uses Agent worktree isolation; Codex report-only uses native delegation and assigned linked worktrees only when the skill's host preflight confirms the required capabilities and authorization.

Classement : **correction justifiée**, représentée par `flag` dans le helper car `CLAUDE.md` est protégé. Contrat à conserver : rapport seul sur Codex, modèle hérité, préflight, absence de reset d'un worktree fourni, suivi de fin et collecte de l'original. Impact possible : une lecture isolée du résumé peut donner une description incomplète de Codex ; aucun échec d'utilisateur n'est observé. Vérification ultérieure suffisante si cette seule phrase est modifiée : comparaison structurelle avec le préflight et le dispatch existants. Aucun changement de code ou de politique n'est nécessaire à cette proposition.

### F2 — Conserver : exigence de couverture exhaustive

Le bloc [agent-prompt.md:7–13](https://github.com/bacoco/ShipGuard/blob/e70ee8de69f0b8f76b2c336865c0ca1ba03f717f/plugins/shipguard/skills/sg-code-audit/references/agent-prompt.md#L7-L13), dont « Report ALL instances of every pattern you find, regardless of how minor you think they are. », est toujours ajouté par le [producteur : 327–329](https://github.com/bacoco/ShipGuard/blob/e70ee8de69f0b8f76b2c336865c0ca1ba03f717f/plugins/shipguard/skills/sg-code-audit/SKILL.md#L327-L329).

Son registre peut correspondre à une ancienne mitigation ; cela reste une hypothèse comportementale de confiance faible, pas un défaut démontré sur les consommateurs actuels. Le texte fixe aussi la couverture produit avant filtrage. Le regroupement autorisé par les `noise_filters` ([template : 315–323](https://github.com/bacoco/ShipGuard/blob/e70ee8de69f0b8f76b2c336865c0ca1ba03f717f/plugins/shipguard/skills/sg-code-audit/references/agent-prompt.md#L315-L323)) conserve un total et une liste : ce n'est pas la preuve d'une contradiction de couverture. Aucune suppression ni reformulation proposée. Une éventuelle comparaison relève d'une autorisation distincte.

### F3 — Différer : conséquence de la coupure de contexte

Fait statique, confiance haute : le plafond est toujours déclaré à [SKILL.md:221](https://github.com/bacoco/ShipGuard/blob/e70ee8de69f0b8f76b2c336865c0ca1ba03f717f/plugins/shipguard/skills/sg-code-audit/SKILL.md#L221). Le `CLAUDE.md` étudié contient 7 967 octets, 7 789 caractères Unicode et 105 lignes. Son préfixe de 3 000 caractères s'arrête ligne 40, à `# Macro r`, avant la section de format des skills, ligne 49. Les règles de format, l'exception autonome et les conventions ultérieures ne sont donc pas toutes dans **cette copie prévue**.

Leur absence du contexte réellement reçu n'est pas établie : l'hôte peut charger des instructions nativement, et le template porte lui-même certains contrats. Aucun prompt instancié n'a été collecté. Classement : **différer**, `flag` ; conserver le plafond et la méthode actuels. Une observation autorisée du consommateur exact serait nécessaire avant de décider d'augmenter le plafond, déplacer ou résumer du texte. Le calcul du préfixe ne constitue pas cette observation.

### F4 — Conserver : correction Python de #127 présente

[checklists.md:32–33](https://github.com/bacoco/ShipGuard/blob/e70ee8de69f0b8f76b2c336865c0ca1ba03f717f/plugins/shipguard/skills/sg-code-audit/references/checklists.md#L32-L33) contient désormais exactement :

> - `except Exception: pass` or `except: pass` — must log at minimum
> - `except Exception:` that catches too broadly

Le diff de #127 a retiré les exemples `SystemExit` et `KeyboardInterrupt` de la seconde ligne, tout en maintenant la recherche de capture trop large. La fusion est ancêtre du SHA étudié et la formulation corrigée est présente. Confiance haute sur cet état de source ; aucun faux positif réel, avant ou après, n'est mesuré. **Aucun changement** supplémentaire sur ce point.

### F5 — Conserver : recette et portée des tests de #127 corrigées

La [recette actuelle : 139–146](https://github.com/bacoco/ShipGuard/blob/e70ee8de69f0b8f76b2c336865c0ca1ba03f717f/plugins/shipguard/skills/sg-improve/references/prompt-audit.md#L139-L146) cite uniquement `prompt-audit-smoke-test.mjs`, qui existe dans l'arbre suivi. Elle précise exactement : « It does not apply patches with Git or invoke a live model. » La lecture du [test : 34–79](https://github.com/bacoco/ShipGuard/blob/e70ee8de69f0b8f76b2c336865c0ca1ba03f717f/plugins/shipguard/skills/sg-improve/prompt-audit-smoke-test.mjs#L34-L79) confirme ses huit contrôles : inventaire, proposition sans écriture, couverture partielle, identité changée, extrait fabriqué, surface protégée, sources indisponibles et CLI.

La CLI est réellement appelée en inventaire et sur entrée malformée par ce test ; les fonctions de revue sont exercées sur sources temporaires. Le test livré n'applique pas de patch avec Git. Ce constat porte sur le fichier suivi et sa recette, pas sur d'éventuels essais externes historiques. Confiance haute ; **aucun changement** supplémentaire. Les résultats de tests annoncés dans #127 restent des résultats historiques, pas des exécutions de cette étude.

### F6–F7 — Conserver : séparation des modes et différences des hôtes

Le mode `--prompt-audit` court-circuite explicitement la rétrospective, ses écritures et sa recommandation de modèle. L'[adaptateur sg-improve:4](https://github.com/bacoco/ShipGuard/blob/e70ee8de69f0b8f76b2c336865c0ca1ba03f717f/plugins/shipguard/skills/sg-improve/agents/openai.yaml#L4) porte la même bifurcation. La mention Sonnet 4.6 appartient au parcours rétrospectif : son ancienneté ne justifie pas ici un changement de modèle ou de routage. Classement : **conserver** la séparation ; **différer** toute évaluation de cette recommandation hors de ce périmètre.

Les règles Codex du préflight priment explicitement sur les paramètres de lancement Claude des références. L'[adaptateur sg-code-audit:4](https://github.com/bacoco/ShipGuard/blob/e70ee8de69f0b8f76b2c336865c0ca1ba03f717f/plugins/shipguard/skills/sg-code-audit/agents/openai.yaml#L4) réaffirme rapport seul, modèle hérité, worktree attribué, suivi natif et refus de `--fix`. Ces différences sont intentionnelles. Confiance haute sur les déclarations, pas sur leur respect en session. Classement : **conserver**, aucune harmonisation proposée.

## Réutilisation effective du helper et identité

Le helper existant a été exécuté sans fichier de requête ni sortie persistante intermédiaire : une opération `inventory`, puis `review`, séparément pour chaque hôte. Cible déclarée : `model: unknown`, `effort: unknown`, `host: Claude Code` ou `Codex` ; versions des hôtes non observées. `base_sha` est le SHA étudié ; `prompt_hash` reste `null` car aucun audit de code instancié n'a été exécuté. Le modèle de l'agent réalisant l'étude n'est pas substitué aux modèles inconnus des consommateurs.

La sélection exacte des neuf fichiers est :

```text
AGENTS.md
CLAUDE.md
plugins/shipguard/skills/sg-code-audit/SKILL.md
plugins/shipguard/skills/sg-code-audit/agents/openai.yaml
plugins/shipguard/skills/sg-code-audit/references/agent-prompt.md
plugins/shipguard/skills/sg-code-audit/references/checklists.md
plugins/shipguard/skills/sg-improve/agents/openai.yaml
plugins/shipguard/skills/sg-improve/references/prompt-audit.md
plugins/shipguard/skills/sg-improve/prompt-audit-smoke-test.mjs
```

Les sept constats F1–F7, tous `keep` ou `flag`, ont été fournis avec leurs citations exactes. Les lectures complémentaires des scripts et des passages de `sg-improve/SKILL.md` éclairent les mécanismes ; elles ne sont pas des fichiers supplémentaires de ces reçus. Les motifs de couverture déclarent une revue de sources pour cette étude bornée, sans attestation de livraison en session.

| Hôte déclaré | `inventory_id` | Résultat de la revue |
| --- | --- | --- |
| Claude Code | `d1e21335d27323fba4b3792870a4daba98085a5be110d01a7b2a169bb34756b1` | `reviewed-no-patch`, `evidence_validation: valid`, aucune erreur |
| Codex | `bea12703d17f4c560cdc7d713a1b2cda3204d565ddc0e374e9686d483a516de1` | `reviewed-no-patch`, `evidence_validation: valid`, aucune erreur |

Pour les deux reçus, `semantic_verification` vaut **`not verified`** et `proposed_diff` vaut exactement **`""`**. Le statut initial d'inventaire était `unreviewed`, avec les neuf sources lues. Leurs identifiants distincts reflètent la déclaration d'hôte, pas une différence de performance. Ils sont des empreintes supplémentaires de sources sélectionnées et de déclarations ; ils ne remplacent pas le `prompt_hash` d'audit existant ni ne représentent le prompt complet livré.

## Contrats conservés et portée de la conclusion

Conserver les exigences suivantes :

- Rapport seul par défaut, correction uniquement sur autorisation, décisions humaines et refus de `--fix` sur Codex ; une proposition ne vaut pas adoption.
- Identité run/base/zone/round/agent, `prompt_hash` existant et discontinuité de comparaison ; conservation puis collecte et validation du JSON original. Un reçu ou une réponse textuelle ne remplace pas le fichier.
- Preuves négatives avec recherche complète, catégories et gravités, calibration contextuelle, exemples utiles et schémas de sortie. Voir [template : 82–134 et 227–246](https://github.com/bacoco/ShipGuard/blob/e70ee8de69f0b8f76b2c336865c0ca1ba03f717f/plugins/shipguard/skills/sg-code-audit/references/agent-prompt.md#L82-L134).
- Limites du helper : sélection explicite, citation exacte distincte du jugement, aucune proposition issue d'une couverture inconnue, aucune découverte automatique des imports ni vérification automatique de l'identité déclarée. La protection par chemin n'est pas un classificateur sémantique de toutes les règles d'autorité.
- Compatibilité des interfaces et contrats de sortie, exception `grill-goal` autonome, activation mission-lock indépendante du modèle et de l'effort, hook sans état et non bloquant. Ces invariants restent inchangés par ce lot documentaire ; leur exécution n'est pas certifiée ici.
- Conservation des apprentissages selon les [règles existantes : 276–280](https://github.com/bacoco/ShipGuard/blob/e70ee8de69f0b8f76b2c336865c0ca1ba03f717f/plugins/shipguard/skills/sg-improve/SKILL.md#L276-L280). Ni leur âge ni les essais d'un autre harnais rapportés dans #91 ne prouvent qu'il faille supprimer une règle.

L'étude fournit une contre-analyse de sources au SHA indiqué, un inventaire des consommateurs, une proposition documentaire précise, une liste de conservation et des inconnues explicites. Le seul livrable ajouté est ce rapport. Aucun prompt, script, adaptateur, réglage, manifeste ou politique n'est modifié. Aucun transcript privé, contenu d'apprentissage local, configuration de compte ou secret n'est collecté pour l'étude ou inclus dans le rapport.

La preuve exécutée est mécanique : lectures Git, calcul du préfixe, inventaires et validation des citations par le helper sans patch. Aucun smoke test, sonde textuelle avec modèle, audit délégué ou parcours réel Claude/Codex n'a été exécuté. Les essais historiques et les résultats amont ne sont pas des mesures ShipGuard sur ce SHA. L'absence de diff de prompt signifie qu'aucune modification applicable n'est justifiée ici ; elle ne signifie ni absence universelle de défauts ni efficacité démontrée.

La livraison de ce texte se vérifie par les liens et chemins cités, un diff limité au rapport, une inspection de confidentialité et `git diff --check`. Elle ne demande aucune relance de suite de tests. L'étude peut ainsi être soumise à décision sans transformer les questions différées en campagne autorisée.

## Décision d’intégration — 24 octobre 2026

L’étude est retenue : conserver les prompts et réutiliser `sg-improve --prompt-audit`, sans nouvel outil ni campagne de modèles. Le même lot applique uniquement la correction du résumé des hôtes dans `CLAUDE.md:95`, conforme au préflight et au dispatch existants. Les constats et numéros de ligne précédents restent ceux de la référence étudiée.

Les questions non mesurées — contexte effectivement livré, effet des formulations et pertinence de la recommandation de modèle du parcours rétrospectif — sont conservées pour un éventuel réexamen en 2027 dans le [backlog #150](https://github.com/bacoco/ShipGuard/issues/150). Leur intérêt reste **non évalué : ni prouvé utile, ni prouvé inutile**. Les conserver ne déclenche aucune expérience, modification ou installation.

Cette décision termine l’étude #91 ; elle ne transforme pas les inconnues en bénéfices démontrés. Le lot contient seulement ce rapport et la phrase documentaire corrigée ; aucun prompt distribué, script, adaptateur ou réglage n’est modifié.

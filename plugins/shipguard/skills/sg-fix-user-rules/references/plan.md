# Plan de correction

Le plan appartient à la conversation qui a proposé les modifications. Garder ce fichier privé dans un dossier temporaire, en dehors du projet. Utiliser des extraits courts, uniques et sans données sensibles. Le chemin du projet désigne sa racine, et chaque chemin d’édition est relatif à cette racine.

La présentation enregistre à côté du plan un fichier privé nommé `.shipguard-review-<empreinte>.json`. Il contient les repères qui permettront de retrouver les passages montrés. Garder le plan et ce fichier ensemble jusqu’à la fin des corrections choisies. Si le passage visé a changé au point de ne plus pouvoir être identifié, la commande indique le cas concerné et poursuit les autres corrections acceptées.

```json
{
  "project": "/chemin/absolu/carnet",
  "rules": [{
    "id": "R01",
    "problem": "La liste des notes s’arrête à deux entrées.",
    "action": "Afficher toutes les notes appartenant à la personne.",
    "target": "Liste des notes de la personne connectée.",
    "reported": "Avec trois notes, les trois titres s’affichent.",
    "ordinary": "Avec une seule note, seul son titre s’affiche.",
    "edits": [{
      "path": "src/notes.js",
      "before": "return ownedNotes.slice(0, 2);",
      "after": "return ownedNotes;"
    }]
  }]
}
```

1. Depuis l’installation du plugin, lancer `node cli/shipguard.mjs rules preview /tmp/plan.json --project=/chemin/absolu/carnet`. Garder l’empreinte `review` et montrer les propositions. L’empreinte lie la commande à la version présentée. Seule la personne peut approuver l’effet décrit.
2. Après « corrige R01 », lancer `node cli/shipguard.mjs rules apply /tmp/plan.json --project=/chemin/absolu/carnet --apply=R01 --review=EMPREINTE`. Un plan peut contenir plusieurs modifications par cas. L’option `--project=DIR` permet de vérifier la cible depuis la commande.
3. Dans l’exemple, ouvrir la liste de la personne ayant trois notes, puis celle de la personne ayant une note. Vérifier les titres reçus et l’absence des notes d’autrui. Garder la preuve de chaque observation. Si un parcours manque, le signaler dans le compte rendu.

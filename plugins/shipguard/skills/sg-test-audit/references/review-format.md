# Données du rapport

Préparer le JSON après avoir suivi les parcours et lu les sources autorisées. `project` désigne le dossier local examiné. `coverage`, `instructions` et `recommendations` contiennent des phrases en français ; signaler les limites ou l’absence de consignes le cas échéant. `rules` contient des décisions examinées, y compris les protections utiles. Un tableau vide convient si la conclusion explique le périmètre. Le rapport reprend les dix décisions gênantes dans l’ordre d’impact fourni par le relecteur.

Exemple fictif, à compléter avec les preuves de la version étudiée :

```json
{
  "project": "/chemin/absolu/carnet",
  "revision": "version locale de démonstration",
  "scope": "Liste des notes",
  "conclusion": "La troisième note disparaît de la liste de sa propriétaire.",
  "coverage": ["Écran de liste et programme qui charge les notes. Les exports restent à vérifier."],
  "instructions": ["Le README demande de montrer toutes les notes de la personne."],
  "rules": [{
    "id": "R01", "file": "src/notes.js", "line": 8,
    "example": "Alice a trois notes. Elle en voit deux.",
    "protection": "Le contrôle du propriétaire suffit à protéger les notes d’autrui.",
    "alternative": "Garder le filtre du propriétaire et rendre les trois notes.",
    "verdict": "mal faite",
    "evidence": "Le cas à trois notes a été reproduit dans la version de démonstration.",
    "origin": "indéterminée",
    "commit": "historique indisponible pour cet exemple"
  }],
  "chronology": ["L’ordre d’apparition du test et de la règle reste inconnu."],
  "recommendations": ["Vérifier le nombre de notes obtenues sur la liste de leur propriétaire."]
}
```

Chaque fiche indique l’exemple constaté ou déduit, la protection, l’alternative, le verdict et les preuves. Les quatre avis sont `utile`, `mal faite`, `inutile` et `indéterminée`. Citer les tests et la façon dont ils exercent l’action dans `evidence`. Documenter l’origine précise ou son incertitude.

Lorsque la trace est disponible, renseigner `commit` avec le hash, la date et le titre, `author` avec le nom Git, et `coauthor` avec les lignes de cosignature exactes. `requestSource` contient une source et la demande précise attribuable à la personne. Omettre ce champ si aucune demande n’a été trouvée et documenter les sources indisponibles. Renseigner `ai` et `aiEvidence` ensemble uniquement si la preuve concerne cette décision. Une cosignature du changement entier reste dans `coauthor`. Pour une comparaison périodique, conserver les identifiants et consigner le sort des décisions précédentes dans `coverage` et `chronology`.

Si `aiEvidence` établit une contribution commune, indiquer dans `ai` les noms distincts (par exemple `["Claude", "Codex"]`) pour que le rapport signale le cas partagé et compte une contribution pour chaque IA concernée.

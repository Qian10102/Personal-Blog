// Six persons throughout: je, tu, il, nous, vous, ils.
// Curated principal parts; inflections use the rules documented in README.
type Six = [string, string, string, string, string, string];
type Verb = {
  infinitive: string;
  auxiliary: "avoir" | "être";
  forms: {
    present: Six;
    "passe-compose": Six;
    imparfait: Six;
    futur: Six;
    conditionnel: Six;
    subjonctif: Six;
  };
};
const six = (forms: string): Six => {
  const values = forms.split(" ");
  if (values.length !== 6) throw new Error(`Expected six forms: ${forms}`);
  return values as Six;
};
const suffixes = (stem: string, endings: string): Six =>
  six(endings).map((ending) => stem + ending) as Six;
const imperfectEndings = "ais ais ait ions iez aient";

function make(
  infinitive: string,
  present: Six,
  participle: string,
  future?: string,
  subjunctive?: Six,
  auxiliary: "avoir" | "être" = "avoir",
): Verb {
  const root = present[3].slice(0, -3);
  const imperfectRoot = infinitive === "être" ? "ét" : root;
  const imparfait = suffixes(imperfectRoot, imperfectEndings).map(
    (form, person) => {
      if (person === 3 || person === 4) {
        if (infinitive.endsWith("ger")) return form.replace(/ge(i)/, "g$1");
        if (infinitive.endsWith("cer")) return form.replace(/ç(i)/, "c$1");
      }
      return form;
    },
  ) as Six;
  const futureRoot =
    future ??
    (infinitive.endsWith("re") ? infinitive.slice(0, -1) : infinitive);
  const subjRoot = present[5].slice(0, -3);
  const subjPluralRoot = infinitive.endsWith("ger")
    ? root.slice(0, -1)
    : infinitive.endsWith("cer")
      ? root.replace(/ç$/, "c")
      : root;
  const subjonctif = subjunctive ?? [
    subjRoot + "e",
    subjRoot + "es",
    subjRoot + "e",
    subjPluralRoot + "ions",
    subjPluralRoot + "iez",
    subjRoot + "ent",
  ];
  const aux =
    auxiliary === "être"
      ? six("suis es est sommes êtes sont")
      : six("ai as a avons avez ont");
  return {
    infinitive,
    auxiliary,
    forms: {
      present,
      imparfait,
      futur: suffixes(futureRoot, "ai as a ons ez ont"),
      conditionnel: suffixes(futureRoot, imperfectEndings),
      subjonctif: subjonctif as Six,
      "passe-compose": aux.map(
        (form, person) =>
          `${form} ${participle}${auxiliary === "être" && person >= 3 ? "s" : ""}`,
      ) as Six,
    },
  };
}

// Strong stems account for e/è, doubled consonants, and y/i alternation.
function er(
  verb: string,
  strong?: string,
  future?: string,
  auxiliary: "avoir" | "être" = "avoir",
): Verb {
  const root = verb.slice(0, -2);
  const stressed = strong ?? root;
  const nous = root.endsWith("g")
    ? root + "eons"
    : root.endsWith("c")
      ? root.slice(0, -1) + "çons"
      : root + "ons";
  return make(
    verb,
    [
      stressed + "e",
      stressed + "es",
      stressed + "e",
      nous,
      root + "ez",
      stressed + "ent",
    ],
    root + "é",
    future,
    undefined,
    auxiliary,
  );
}
function ir(verb: string): Verb {
  const root = verb.slice(0, -2);
  return make(verb, suffixes(root, "is is it issons issez issent"), root + "i");
}
function re(verb: string): Verb {
  const root = verb.slice(0, -2);
  return make(
    verb,
    [root + "s", root + "s", root, root + "ons", root + "ez", root + "ent"],
    root + "u",
  );
}
function irregular(
  verb: string,
  present: string,
  participle: string,
  future?: string,
  subjunctive?: string,
  auxiliary?: "être",
): Verb {
  return make(
    verb,
    six(present),
    participle,
    future,
    subjunctive ? six(subjunctive) : undefined,
    auxiliary,
  );
}

// Reflexive answers include the object pronoun, but omit the subject and que.
function reflexive(base: Verb, infinitive: string): Verb {
  const result = structuredClone(base);
  result.infinitive = infinitive;
  result.auxiliary = "être";
  const pronouns = ["me", "te", "se", "nous", "vous", "se"];
  for (const tense of Object.keys(result.forms) as (keyof Verb["forms"])[]) {
    result.forms[tense] = base.forms[tense].map((form, person) => {
      if (tense === "passe-compose") {
        const participle = form.split(" ").slice(1).join(" ");
        form = `${six("suis es est sommes êtes sont")[person]} ${participle}${person >= 3 ? "s" : ""}`;
      }
      const pronoun =
        person < 3 || person === 5
          ? /^[aeiouyàâäéèêëîïôöùûüœ]/i.test(form)
            ? pronouns[person].slice(0, -1) + "'"
            : pronouns[person] + " "
          : pronouns[person] + " ";
      return pronoun + form;
    }) as Six;
  }
  return result;
}

function expression(
  base: Verb,
  infinitive: string,
  complement: string,
  agreement = false,
): Verb {
  const result = structuredClone(base);
  result.infinitive = infinitive;
  for (const tense of Object.keys(result.forms) as (keyof Verb["forms"])[])
    result.forms[tense] = base.forms[tense].map(
      (form, person) =>
        `${form} ${complement}${agreement && person >= 3 ? "s" : ""}`,
    ) as Six;
  return result;
}

export const verbs: Verb[] = [
  irregular(
    "être",
    "suis es est sommes êtes sont",
    "été",
    "ser",
    "sois sois soit soyons soyez soient",
  ),
  irregular(
    "avoir",
    "ai as a avons avez ont",
    "eu",
    "aur",
    "aie aies ait ayons ayez aient",
  ),
  irregular(
    "aller",
    "vais vas va allons allez vont",
    "allé",
    "ir",
    "aille ailles aille allions alliez aillent",
    "être",
  ),
  irregular(
    "faire",
    "fais fais fait faisons faites font",
    "fait",
    "fer",
    "fasse fasses fasse fassions fassiez fassent",
  ),
  irregular("dire", "dis dis dit disons dites disent", "dit"),
  irregular(
    "pouvoir",
    "peux peux peut pouvons pouvez peuvent",
    "pu",
    "pourr",
    "puisse puisses puisse puissions puissiez puissent",
  ),
  irregular(
    "vouloir",
    "veux veux veut voulons voulez veulent",
    "voulu",
    "voudr",
    "veuille veuilles veuille voulions vouliez veuillent",
  ),
  irregular(
    "savoir",
    "sais sais sait savons savez savent",
    "su",
    "saur",
    "sache saches sache sachions sachiez sachent",
  ),
  irregular("devoir", "dois dois doit devons devez doivent", "dû", "devr"),
  irregular("voir", "vois vois voit voyons voyez voient", "vu", "verr"),
  irregular(
    "venir",
    "viens viens vient venons venez viennent",
    "venu",
    "viendr",
    undefined,
    "être",
  ),
  irregular("prendre", "prends prends prend prenons prenez prennent", "pris"),
  irregular("mettre", "mets mets met mettons mettez mettent", "mis"),
  irregular(
    "sortir",
    "sors sors sort sortons sortez sortent",
    "sorti",
    undefined,
    undefined,
    "être",
  ),
  irregular(
    "partir",
    "pars pars part partons partez partent",
    "parti",
    undefined,
    undefined,
    "être",
  ),
  irregular(
    "revenir",
    "reviens reviens revient revenons revenez reviennent",
    "revenu",
    "reviendr",
    undefined,
    "être",
  ),
  irregular(
    "devenir",
    "deviens deviens devient devenons devenez deviennent",
    "devenu",
    "deviendr",
    undefined,
    "être",
  ),
  irregular(
    "naître",
    "nais nais naît naissons naissez naissent",
    "né",
    "naîtr",
    undefined,
    "être",
  ),
  irregular(
    "mourir",
    "meurs meurs meurt mourons mourez meurent",
    "mort",
    "mourr",
    undefined,
    "être",
  ),
  irregular("lire", "lis lis lit lisons lisez lisent", "lu"),
  irregular("écrire", "écris écris écrit écrivons écrivez écrivent", "écrit"),
  irregular("boire", "bois bois boit buvons buvez boivent", "bu"),
  irregular("sentir", "sens sens sent sentons sentez sentent", "senti"),
  irregular("dormir", "dors dors dort dormons dormez dorment", "dormi"),
  irregular(
    "courir",
    "cours cours court courons courez courent",
    "couru",
    "courr",
  ),
  irregular("ouvrir", "ouvre ouvres ouvre ouvrons ouvrez ouvrent", "ouvert"),
  irregular("offrir", "offre offres offre offrons offrez offrent", "offert"),
  irregular(
    "recevoir",
    "reçois reçois reçoit recevons recevez reçoivent",
    "reçu",
    "recevr",
  ),
  irregular(
    "connaître",
    "connais connais connaît connaissons connaissez connaissent",
    "connu",
  ),
  irregular(
    "comprendre",
    "comprends comprends comprend comprenons comprenez comprennent",
    "compris",
  ),
  irregular(
    "apprendre",
    "apprends apprends apprend apprenons apprenez apprennent",
    "appris",
  ),
  irregular("croire", "crois crois croit croyons croyez croient", "cru"),
  irregular("vivre", "vis vis vit vivons vivez vivent", "vécu"),
  irregular("suivre", "suis suis suit suivons suivez suivent", "suivi"),
  irregular(
    "tenir",
    "tiens tiens tient tenons tenez tiennent",
    "tenu",
    "tiendr",
  ),
  irregular(
    "obtenir",
    "obtiens obtiens obtient obtenons obtenez obtiennent",
    "obtenu",
    "obtiendr",
  ),
  irregular(
    "conduire",
    "conduis conduis conduit conduisons conduisez conduisent",
    "conduit",
  ),
  irregular(
    "construire",
    "construis construis construit construisons construisez construisent",
    "construit",
  ),
  ...[
    "donner",
    "parler",
    "aimer",
    "trouver",
    "demander",
    "laisser",
    "penser",
    "regarder",
    "porter",
    "apporter",
    "travailler",
    "jouer",
    "marcher",
    "chercher",
    "écouter",
    "oublier",
    "rencontrer",
    "aider",
    "habiter",
    "raconter",
    "montrer",
    "utiliser",
    "gagner",
    "garder",
    "arrêter",
    "accepter",
    "décider",
    "expliquer",
    "préparer",
    "continuer",
    "étudier",
    "fermer",
    "inviter",
    "remercier",
    "visiter",
  ].map((verb) => er(verb)),
  ...[
    "rester",
    "arriver",
    "entrer",
    "tomber",
    "monter",
    "descendre",
    "retourner",
    "rentrer",
    "passer",
  ].map((verb) =>
    verb === "descendre"
      ? irregular(
          verb,
          "descends descends descend descendons descendez descendent",
          "descendu",
          undefined,
          undefined,
          "être",
        )
      : er(verb, undefined, undefined, "être"),
  ),
  er("manger"),
  er("commencer"),
  er("changer"),
  er("acheter", "achèt", "achèter"),
  er("appeler", "appell", "appeller"),
  er("payer", "pai", "paier"),
  er("envoyer", "envoi", "enverr"),
  er("essayer", "essai", "essaier"),
  ...["finir", "choisir", "réussir", "remplir"].map(ir),
  ...["entendre", "répondre", "attendre", "perdre", "vendre", "rendre"].map(re),
];

// B2 argumentation and reported opinions: exact list membership is documented
// in b2-verb-sources.ts and docs/reference/b2-verbs.md.
verbs.push(
  ...[
    "estimer",
    "réaffirmer",
    "énoncer",
    "revendiquer",
    "illustrer",
    "souligner",
    "démontrer",
    "préciser",
    "clarifier",
    "dénoncer",
    "nier",
    "invalider",
    "dissuader",
    "inciter",
    "encourager",
    "déclarer",
    "insister",
    "affirmer",
    "ajouter",
    "confier",
    "déplorer",
    "objecter",
    "signaler",
    "insinuer",
    "prétexter",
  ].map((verb) => er(verb)),
  er("adhérer", "adhèr"),
  er("rejeter", "rejett", "rejetter"),
  ir("avertir"),
  re("prétendre"),
  irregular(
    "soutenir",
    "soutiens soutiens soutient soutenons soutenez soutiennent",
    "soutenu",
    "soutiendr",
  ),
  irregular(
    "contredire",
    "contredis contredis contredit contredisons contredisez contredisent",
    "contredit",
  ),
  irregular(
    "craindre",
    "crains crains craint craignons craignez craignent",
    "craint",
  ),
  irregular(
    "reconnaître",
    "reconnais reconnais reconnaît reconnaissons reconnaissez reconnaissent",
    "reconnu",
  ),
  irregular(
    "admettre",
    "admets admets admet admettons admettez admettent",
    "admis",
  ),
  irregular(
    "prévenir",
    "préviens préviens prévient prévenons prévenez préviennent",
    "prévenu",
    "préviendr",
  ),
  reflexive(er("prononcer"), "se prononcer"),
  reflexive(er("étonner"), "s'étonner"),
  reflexive(er("moquer"), "se moquer"),
  reflexive(
    irregular(
      "plaindre",
      "plains plains plaint plaignons plaignez plaignent",
      "plaint",
    ),
    "se plaindre",
  ),
  expression(
    verbs.find((verb) => verb.infinitive === "faire")!,
    "faire remarquer",
    "remarquer",
  ),
  expression(
    verbs.find((verb) => verb.infinitive === "être")!,
    "être persuadé",
    "persuadé",
    true,
  ),
  expression(
    verbs.find((verb) => verb.infinitive === "être")!,
    "être convaincu",
    "convaincu",
    true,
  ),
);

// Both spellings are standard for -ayer verbs.
for (const infinitive of ["payer", "essayer"]) {
  const verb = verbs.find((item) => item.infinitive === infinitive)!;
  for (const tense of [
    "present",
    "futur",
    "conditionnel",
    "subjonctif",
  ] as const) {
    verb.forms[tense] = verb.forms[tense].map((form) => {
      const alternative = form.replace(
        infinitive === "payer" ? "pai" : "essai",
        infinitive === "payer" ? "pay" : "essay",
      );
      return alternative === form ? form : `${form} / ${alternative}`;
    }) as Six;
  }
}

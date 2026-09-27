// Fonction serveur (Vercel) — appelée par app.js via fetch("/api/generate-fiche").
// La clé ANTHROPIC_API_KEY reste ici, côté serveur : jamais visible par les élèves.

module.exports = async function handler(req, res) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Méthode non autorisée" });
    return;
  }

  const { titre, matiere, texte, image } = req.body || {};
  if (!titre || (!texte && !image)) {
    res.status(400).json({ error: "Titre et (texte ou photo) requis" });
    return;
  }
  if (!process.env.ANTHROPIC_API_KEY) {
    res.status(500).json({ error: "Clé API manquante côté serveur (variable ANTHROPIC_API_KEY)" });
    return;
  }

  const content = [];
  if (image && image.data) {
    content.push({ type: "image", source: { type: "base64", media_type: image.mediaType, data: image.data } });
  }
  content.push({
    type: "text",
    text: `Tu transformes un cours de lycée en fiche de révision claire, en français.
Matière : ${matiere}. Chapitre : ${titre}.

${texte ? `Cours brut :\n"""${texte}"""\n\n` : "Le cours est fourni en photo ci-dessus.\n\n"}Produis une fiche structurée avec : un court résumé (2-3 phrases), une liste des points clés, les définitions importantes, et 3 questions de révision. Sois concis et concret. Réponds uniquement avec la fiche, sans préambule ni conclusion.`
  });

  try {
    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": process.env.ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01"
      },
      body: JSON.stringify({
        model: "claude-haiku-4-5-20251001",
        max_tokens: 1200,
        messages: [{ role: "user", content }]
      })
    });

    if (!response.ok) {
      const errText = await response.text();
      res.status(502).json({ error: "L'IA n'a pas pu générer la fiche", details: errText });
      return;
    }

    const data = await response.json();
    const contenu = (data.content || []).map(b => b.text || "").join("\n").trim();
    res.status(200).json({ contenu });
  } catch (e) {
    res.status(500).json({ error: "Erreur serveur", details: String(e) });
  }
};

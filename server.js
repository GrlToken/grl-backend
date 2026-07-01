const express = require("express");
const admin   = require("firebase-admin");
const crypto  = require("crypto");

const app = express();
app.use(express.json());

// ── FIREBASE ADMIN ──
const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
const db = admin.firestore();

// ── WEBHOOK MERCADO PAGO ──
app.post("/webhook", async (req, res) => {
  try {
    const { type, data } = req.body;
    if (type !== "payment") return res.sendStatus(200);

    // buscar detalhes do pagamento
    const mpRes = await fetch(
      `https://api.mercadopago.com/v1/payments/${data.id}`,
      { headers: { Authorization: `Bearer ${process.env.MP_ACCESS_TOKEN}` } }
    );
    const pagamento = await mpRes.json();

    if (pagamento.status !== "approved") return res.sendStatus(200);

    // extrair dados do pagamento
    const email     = pagamento.payer.email;
    const sponsorId = pagamento.external_reference; // uid do sponsor

    // criar usuário no Firebase Auth
    const userRecord = await admin.auth().createUser({ email });
    const uid = userRecord.uid;

    // criar documento no Firestore
    await db.collection("usuarios").doc(uid).set({
      uid,
      email,
      sponsor:   sponsorId,
      parent:    sponsorId,
      grade:     0,
      ts:        admin.firestore.FieldValue.serverTimestamp(),
    });

    console.log(`Usuário criado: ${email} — sponsor: ${sponsorId}`);
    res.sendStatus(200);

  } catch (e) {
    console.error(e);
    res.sendStatus(500);
  }
});

app.get("/", (req, res) => res.send("GRL Backend OK"));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Servidor rodando na porta ${PORT}`));

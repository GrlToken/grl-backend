const express = require("express");
const admin   = require("firebase-admin");

const app = express();
app.use(express.json());

// ── CORS ──
app.use((req, res, next) => {
  res.setHeader("Access-Control-Allow-Origin", "https://grlnetwork.com");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.sendStatus(200);
  next();
});

// ── FIREBASE ADMIN ──
const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
const db = admin.firestore();

// ── KEEP-ALIVE (evita que o Render durma) ──
const SELF_URL = "https://grl-backend-vvef.onrender.com";
setInterval(async () => {
  try {
    await fetch(SELF_URL);
    console.log("[keep-alive] ping ok");
  } catch (e) {
    console.warn("[keep-alive] falhou:", e.message);
  }
}, 4 * 60 * 1000); // a cada 4 minutos

// ── CRIAR PREFERÊNCIA DE PAGAMENTO ──
app.post("/criar-pagamento", async (req, res) => {
  try {
    const { valor, metodo, ref } = req.body;
    if (!valor || !ref) return res.status(400).json({ erro: "Dados incompletos." });

    const mpRes = await fetch("https://api.mercadopago.com/checkout/preferences", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${process.env.MP_ACCESS_TOKEN}`,
      },
      body: JSON.stringify({
        items: [{
          title:       "Masterminds",
          quantity:    1,
          unit_price:  valor,
          currency_id: "BRL",
        }],
        external_reference: ref,
        back_urls: {
          success: `https://grlnetwork.com/cadastro.html?status=aprovado&ref=${ref}`,
          failure: `https://grlnetwork.com/cadastro.html?status=erro&ref=${ref}`,
          pending: `https://grlnetwork.com/cadastro.html?status=pendente&ref=${ref}`,
        },
        auto_return: "approved",
        payment_methods: {
          excluded_payment_types: metodo === "pix"
            ? [{ id: "credit_card" }, { id: "debit_card" }]
            : metodo === "debito"
            ? [{ id: "credit_card" }, { id: "ticket" }]
            : [{ id: "ticket" }],
        },
      }),
    });

    const preferencia = await mpRes.json();
    if (!preferencia.init_point) throw new Error("init_point não retornado");

    res.json({ url: preferencia.init_point });

  } catch (e) {
    console.error(e);
    res.status(500).json({ erro: "Erro ao criar pagamento." });
  }
});

// ── WEBHOOK MERCADO PAGO ──
app.post("/webhook", async (req, res) => {
  try {
    const { type, data } = req.body;
    if (type !== "payment") return res.sendStatus(200);

    const mpRes = await fetch(
      `https://api.mercadopago.com/v1/payments/${data.id}`,
      { headers: { Authorization: `Bearer ${process.env.MP_ACCESS_TOKEN}` } }
    );
    const pagamento = await mpRes.json();

    if (pagamento.status !== "approved") return res.sendStatus(200);

    const email     = pagamento.payer.email;
    const sponsorId = pagamento.external_reference;

    const senha = Math.random().toString(36).slice(2, 10).toUpperCase();

    const userRecord = await admin.auth().createUser({ email, password: senha });
    const uid = userRecord.uid;

    await db.collection("usuarios").doc(uid).set({
      uid,
      email,
      sponsor:  sponsorId,
      parent:   sponsorId,
      grade:    0,
      ts:       admin.firestore.FieldValue.serverTimestamp(),
    });

    await db.collection("acessos").doc(uid).set({
      email,
      senha,
      exibido: false,
      ts:      admin.firestore.FieldValue.serverTimestamp(),
    });

    console.log(`Usuário criado: ${email}`);
    res.sendStatus(200);

  } catch (e) {
    console.error(e);
    res.sendStatus(500);
  }
});

// ── BUSCAR CREDENCIAIS APÓS PAGAMENTO ──
app.get("/credenciais", async (req, res) => {
  try {
    const { ref } = req.query;
    if (!ref) return res.status(400).json({ erro: "ref ausente." });

    const snap = await db.collection("usuarios")
      .where("sponsor", "==", ref)
      .orderBy("ts", "desc")
      .limit(1)
      .get();

    if (snap.empty) return res.status(404).json({ erro: "Usuário não encontrado ainda." });

    const novoUid = snap.docs[0].id;
    const acessoSnap = await db.collection("acessos").doc(novoUid).get();

    if (!acessoSnap.exists) return res.status(404).json({ erro: "Acesso não encontrado." });

    const { email, senha } = acessoSnap.data();
    res.json({ email, senha });

  } catch (e) {
    console.error(e);
    res.status(500).json({ erro: "Erro ao buscar credenciais." });
  }
});

app.get("/", (req, res) => res.send("GRL Backend OK"));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Servidor rodando na porta ${PORT}`));

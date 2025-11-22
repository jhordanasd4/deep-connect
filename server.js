const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const { v4: uuidv4 } = require('uuid');

const { PrismaClient, Prisma } = require('@prisma/client');
const prisma = new PrismaClient();


const app = express();
const PORT = process.env.PORT || 3000;

// Middlewares
app.use(cors());
app.use(express.json());

// Static para comprobantes
const UPLOAD_DIR = path.join(__dirname, 'uploads');
if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR);
app.use('/uploads', express.static(UPLOAD_DIR));

// Multer para manejo de archivos
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOAD_DIR),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname);
    cb(null, `${uuidv4()}${ext}`);
  }
});
const upload = multer({ storage });

// Helpers
const toNumber = (d) => (d == null ? 0 : Number(d));

// Mapea User (DB) -> formato antiguo (JSON) para no romper el frontend
function mapUserToApi(user) {
  if (!user) return null;
  return {
    user_id: user.code, // usamos code como "dbu-001"
    nombre: user.nombre,
    apellido: user.apellido,
    username: user.username,
    email: user.email,
    password: user.password,
    nivel: user.nivel,
    gotas_agua: toNumber(user.gotasAgua),
    perlas: toNumber(user.perlas),
    rol: user.rol || 'player',
    ultimo_acceso: user.ultimoAcceso ? user.ultimoAcceso.toISOString() : new Date().toISOString(),
    arrecife_items: user.arrecifeItems || [],
    referred_by: user.referredById || null,
    // estos campos los reconstruimos desde otras tablas cuando haga falta
    referrals: [],
  };
}

// Salud
app.get('/health', (req, res) => res.json({ ok: true }));

// REGISTRO (POST)
app.post('/api/register', async (req, res) => {
  try {
    const { nombre, apellido, username, password, referredBy } = req.body;

    if (!nombre || !apellido || !username || !password) {
      return res.status(400).json({ success: false, message: 'Faltan datos requeridos' });
    }

    const existing = await prisma.user.findFirst({
      where: {
        OR: [{ username }, { email: username }]
      }
    });

    if (existing) {
      return res.status(400).json({ success: false, message: 'El usuario ya existe' });
    }

    const count = await prisma.user.count();
    const newCode = `dbu-${String(count + 1).padStart(3, '0')}`;

    const newUser = await prisma.user.create({
      data: {
        code: newCode,
        nombre,
        apellido,
        username,
        email: username,
        password,
        nivel: 1,
        gotasAgua: new Prisma.Decimal(0),
        perlas: new Prisma.Decimal(0),
        rol: 'player',
        ultimoAcceso: new Date(),
        arrecifeItems: [],
        referredById: referredBy || null,
      },
    });

    res.json({
      success: true,
      message: 'Usuario registrado exitosamente',
      user_id: newUser.code,
    });
  } catch (err) {
    console.error('REGISTER ERROR', err);
    res.status(500).json({ success: false, message: 'Error en el servidor' });
  }
});

// LOGIN (POST)
app.post('/api/login', async (req, res) => {
  try {
    const { username, password } = req.body;

    const user = await prisma.user.findFirst({
      where: {
        AND: [
          { password },
          {
            OR: [
              { username },
              { email: username },
            ],
          },
        ],
      },
    });

    if (!user) {
      return res.status(401).json({ success: false, message: 'Credenciales inválidas.' });
    }

    let rol = user.rol || 'player';
    if (user.email === 'admin@gmail.com') {
      rol = 'admin';
    }

    const updated = await prisma.user.update({
      where: { id: user.id },
      data: {
        rol,
        ultimoAcceso: new Date(),
        sessionToken: uuidv4(),
      },
    });

    return res.json({
      success: true,
      message: 'Login exitoso',
      user_id: updated.code,
      token: updated.sessionToken,
      role: updated.rol,
    });
  } catch (err) {
    console.error('LOGIN ERROR', err);
    res.status(500).json({ success: false, message: 'Error en el servidor' });
  }
});

// SESSION: validar token
app.get('/api/session/me', async (req, res) => {
  try {
    const auth = req.headers['authorization'] || '';
    const parts = auth.split(' ');
    const token = parts.length === 2 && parts[0] === 'Bearer' ? parts[1] : null;
    if (!token) return res.status(401).json({ success: false, message: 'Token requerido' });

    const user = await prisma.user.findFirst({
      where: { sessionToken: token },
    });

    if (!user) return res.status(401).json({ success: false, message: 'Token inválido' });

    res.json({ success: true, user_id: user.code, role: user.rol || 'player' });
  } catch (err) {
    console.error('SESSION ERROR', err);
    res.status(500).json({ success: false, message: 'Error en el servidor' });
  }
});

// ARRECIFE (GET)
app.get('/api/arrecife/:userId', async (req, res) => {
  try {
    const { userId } = req.params; // ej: dbu-001
    const user = await prisma.user.findFirst({
      where: { code: userId },
    });
    if (!user) {
      return res.status(404).json({ success: false, message: 'Usuario no encontrado.' });
    }
    const mapped = mapUserToApi(user);
    return res.json({ success: true, data: mapped });
  } catch (err) {
    console.error('ARRECIFE GET ERROR', err);
    res.status(500).json({ success: false, message: 'Error en el servidor' });
  }
});

// ARRECIFE (UPDATE)
app.post('/api/arrecife/:userId/update', async (req, res) => {
  try {
    const { userId } = req.params;
    const { gotas_agua, perlas, nivel, arrecife_items } = req.body;

    const user = await prisma.user.findFirst({ where: { code: userId } });
    if (!user) {
      return res.status(404).json({ success: false, message: 'Usuario no encontrado.' });
    }

    const data = {};
    if (typeof gotas_agua === 'number') data.gotasAgua = new Prisma.Decimal(gotas_agua);
    if (typeof perlas === 'number') data.perlas = new Prisma.Decimal(perlas);
    if (typeof nivel === 'number') data.nivel = nivel;
    if (Array.isArray(arrecife_items)) data.arrecifeItems = arrecife_items;

    const updated = await prisma.user.update({
      where: { id: user.id },
      data,
    });

    res.json({ success: true, message: 'Usuario actualizado', data: mapUserToApi(updated) });
  } catch (err) {
    console.error('ARRECIFE UPDATE ERROR', err);
    res.status(500).json({ success: false, message: 'Error en el servidor' });
  }
});

// LISTA DE USUARIOS (ADMIN)
app.get('/api/admin/users', async (req, res) => {
  try {
    const users = await prisma.user.findMany({
      orderBy: { ultimoAcceso: 'desc' },
    });

    const userList = users.map((user) => ({
      id: user.code,
      nombre: user.nombre || user.username,
      apellido: user.apellido || '',
      username: user.username,
      email: user.email,
      nivel: user.nivel,
      ultimo_acceso: user.ultimoAcceso ? user.ultimoAcceso.toISOString() : new Date().toISOString(),
      gotas: toNumber(user.gotasAgua),
      rol: user.rol || 'player',
    }));

    res.json({ success: true, total: userList.length, data: userList });
  } catch (err) {
    console.error('ADMIN USERS ERROR', err);
    res.status(500).json({ success: false, message: 'Error en el servidor' });
  }
});

// RECHARGES (crear solicitud)
app.post('/api/recharges', upload.single('file'), async (req, res) => {
  try {
    const { userId, network, address, amount, note, item } = req.body;
    if (!userId) return res.status(400).json({ success: false, message: 'userId requerido' });

    const user = await prisma.user.findFirst({ where: { code: userId } });
    if (!user) return res.status(404).json({ success: false, message: 'Usuario no encontrado' });

    const fileName = req.file ? req.file.filename : null;
    const id = `req-${Date.now()}`;

    const rec = await prisma.recharge.create({
      data: {
        id,
        userId: user.id,
        item: item || null,
        network,
        address,
        amount: new Prisma.Decimal(parseFloat(amount || 0) || 0),
        note: note || '',
        fileName,
        status: 'pending',
        createdAt: new Date(),
      },
      include: { user: true },
    });

    res.json({
      success: true,
      id: rec.id,
      data: {
        ...rec,
        userId: user.code,
        username: rec.user.username,
        fileUrl: fileName ? `/uploads/${fileName}` : null,
      },
    });
  } catch (err) {
    console.error('RECHARGES CREATE ERROR', err);
    res.status(500).json({ success: false, message: 'Error en el servidor' });
  }
});

// RECHARGES (listar)
app.get('/api/recharges', async (req, res) => {
  try {
    const recharges = await prisma.recharge.findMany({
      orderBy: { createdAt: 'desc' },
      include: { user: true },
    });

    const data = recharges.map((r) => ({
      id: r.id,
      userId: r.user.code,
      item: r.item,
      network: r.network,
      address: r.address,
      amount: toNumber(r.amount),
      note: r.note,
      fileName: r.fileName,
      status: r.status,
      created_at: r.createdAt.toISOString(),
      username: r.user ? r.user.username : r.userId,
      fileUrl: r.fileName ? `/uploads/${r.fileName}` : null,
    }));

    res.json({ success: true, total: data.length, data });
  } catch (err) {
    console.error('RECHARGES LIST ERROR', err);
    res.status(500).json({ success: false, message: 'Error en el servidor' });
  }
});

// RECHARGES (aprobar y acreditar)
app.post('/api/recharges/:id/approve', async (req, res) => {
  try {
    const { id } = req.params;
    const { creditAmount } = req.body || {};
    const amount = parseFloat(creditAmount || 0) || 0;

    const rec = await prisma.recharge.findUnique({
      where: { id },
      include: { user: true },
    });

    if (!rec) return res.status(404).json({ success: false, message: 'Solicitud no encontrada' });

    await prisma.$transaction(async (tx) => {
      await tx.recharge.update({
        where: { id },
        data: { status: 'approved' },
      });

      const user = await tx.user.update({
        where: { id: rec.userId },
        data: {
          gotasAgua: (rec.user.gotasAgua || new Prisma.Decimal(0)).add(new Prisma.Decimal(amount)),
        },
      });

      // Sistema de referidos: 15% al que refirió
      if (rec.user.referredById) {
        const bonus = amount * 0.15;
        // 1. Primero, busca al referente de forma segura
        const referrer = await tx.user.findUnique({
          where: { id: rec.user.referredById }
        });

        // 2. Si el referente existe, actualiza su saldo
        if (referrer) {
          // Usamos new Prisma.Decimal para asegurar que la suma sea correcta
          const currentGotas = new Prisma.Decimal(referrer.gotasAgua || 0);
          await tx.user.update({
            where: { id: rec.user.referredById },
            data: { gotasAgua: currentGotas.add(new Prisma.Decimal(bonus)) },
          });
        }

        await tx.referral.create({
          data: {
            referrerId: rec.user.referredById,
            userId: rec.userId,
            username: rec.user.username,
            earned: new Prisma.Decimal(bonus),
            date: new Date(),
          },
        });
      }
    });

    const updatedUser = await prisma.user.findUnique({ where: { id: rec.userId } });

    res.json({
      success: true,
      message: 'Solicitud aprobada',
      updatedUser: updatedUser
        ? {
            user_id: updatedUser.code,
            username: updatedUser.username,
            gotas_agua: toNumber(updatedUser.gotasAgua),
          }
        : null,
      recharge: { ...rec, status: 'approved' },
    });
  } catch (err) {
    console.error('RECHARGE APPROVE ERROR', err);
    res.status(500).json({ success: false, message: 'Error en el servidor' });
  }
});

// RECHARGES (denegar)
app.post('/api/recharges/:id/deny', async (req, res) => {
  try {
    const { id } = req.params;

    const rec = await prisma.recharge.findUnique({ where: { id } });
    if (!rec) return res.status(404).json({ success: false, message: 'Solicitud no encontrada' });

    const updated = await prisma.recharge.update({
      where: { id },
      data: { status: 'denied' },
    });

    res.json({ success: true, message: 'Solicitud denegada', recharge: updated });
  } catch (err) {
    console.error('RECHARGE DENY ERROR', err);
    res.status(500).json({ success: false, message: 'Error en el servidor' });
  }
});

// ADMIN: acreditar gotas manualmente a un usuario
app.post('/api/admin/credit', async (req, res) => {
  try {
    const { userId, amount } = req.body || {};
    const credit = parseFloat(amount || 0) || 0;
    if (!userId || credit <= 0) {
      return res.status(400).json({ success: false, message: 'userId y amount (>0) son requeridos' });
    }

    const user = await prisma.user.findFirst({ where: { code: userId } });
    if (!user) return res.status(404).json({ success: false, message: 'Usuario no encontrado' });

    const updatedUser = await prisma.user.update({
      where: { id: user.id },
      data: {
        gotasAgua: (user.gotasAgua || new Prisma.Decimal(0)).add(new Prisma.Decimal(credit)),
      },
    });

    const rec = await prisma.recharge.create({
      data: {
        id: `adm-${Date.now()}`,
        userId: user.id,
        item: null,
        network: 'admin',
        address: '-',
        amount: new Prisma.Decimal(credit),
        note: 'Crédito directo de administrador (gotas)',
        fileName: null,
        status: 'admin-credit',
        createdAt: new Date(),
      },
    });

    res.json({
      success: true,
      message: 'Crédito aplicado',
      data: { user_id: updatedUser.code, gotas_agua: toNumber(updatedUser.gotasAgua) },
      record: rec,
    });
  } catch (err) {
    console.error('ADMIN CREDIT ERROR', err);
    res.status(500).json({ success: false, message: 'Error en el servidor' });
  }
});

// ADMIN: acreditar perlas manualmente a un usuario
app.post('/api/admin/credit-pearls', async (req, res) => {
  try {
    const { userId, amount } = req.body || {};
    const credit = parseFloat(amount || 0) || 0;
    if (!userId || credit <= 0) {
      return res.status(400).json({ success: false, message: 'userId y amount (>0) son requeridos' });
    }

    const user = await prisma.user.findFirst({ where: { code: userId } });
    if (!user) return res.status(404).json({ success: false, message: 'Usuario no encontrado' });

    const updatedUser = await prisma.user.update({
      where: { id: user.id },
      data: {
        perlas: (user.perlas || new Prisma.Decimal(0)).add(new Prisma.Decimal(credit)),
      },
    });

    const rec = await prisma.recharge.create({
      data: {
        id: `adm-prl-${Date.now()}`,
        userId: user.id,
        item: null,
        network: 'admin',
        address: '-',
        amount: new Prisma.Decimal(credit),
        note: 'Crédito directo de administrador (perlas)',
        fileName: null,
        status: 'admin-credit-pearls',
        createdAt: new Date(),
      },
    });

    res.json({
      success: true,
      message: 'Crédito de perlas aplicado',
      data: { user_id: updatedUser.code, perlas: toNumber(updatedUser.perlas) },
      record: rec,
    });
  } catch (err) {
    console.error('ADMIN CREDIT PEARLS ERROR', err);
    res.status(500).json({ success: false, message: 'Error en el servidor' });
  }
});

// REFERRALS (obtener estadísticas de referidos)
app.get('/api/referrals/:userId', async (req, res) => {
  try {
    const { userId } = req.params;
    const user = await prisma.user.findFirst({ where: { code: userId } });
    if (!user) {
      return res.status(404).json({ success: false, message: 'Usuario no encontrado' });
    }

    const referredUsers = await prisma.user.findMany({
      where: { referredById: user.id },
    });

    const referrals = await prisma.referral.findMany({
      where: { referrerId: user.id },
    });

    const totalEarned = referrals.reduce((sum, r) => sum + toNumber(r.earned), 0);

    const allReferrals = referredUsers.map((refUser) => {
      const purchaseInfo = referrals.find((r) => r.userId === refUser.id);
      return {
        user_id: refUser.code,
        username: refUser.username,
        email: refUser.email,
        name: `${refUser.nombre || ''} ${refUser.apellido || ''}`.trim(),
        earned: purchaseInfo ? toNumber(purchaseInfo.earned) : 0,
        date: refUser.ultimoAcceso ? refUser.ultimoAcceso.toISOString() : new Date().toISOString(),
      };
    });

    res.json({
      success: true,
      data: {
        totalReferrals: referredUsers.length,
        totalEarned,
        referrals: allReferrals,
      },
    });
  } catch (err) {
    console.error('REFERRALS ERROR', err);
    res.status(500).json({ success: false, message: 'Error en el servidor' });
  }
});

// WITHDRAWALS (crear solicitud)
app.post('/api/withdrawals', async (req, res) => {
  try {
    const { userId, network, address, amount, note } = req.body || {};
    const amt = parseFloat(amount || 0) || 0;
    if (!userId || !network || !address || amt < 20) {
      return res.status(400).json({ success: false, message: 'userId, network, address y amount >= 20 son requeridos' });
    }

    const user = await prisma.user.findFirst({ where: { code: userId } });
    if (!user) return res.status(404).json({ success: false, message: 'Usuario no encontrado' });

    const balance = toNumber(user.gotasAgua);
    if (balance < amt) return res.status(400).json({ success: false, message: 'Saldo insuficiente para retiro' });

    const updatedUser = await prisma.user.update({
      where: { id: user.id },
      data: {
        gotasAgua: (user.gotasAgua || new Prisma.Decimal(0)).sub(new Prisma.Decimal(amt)),
      },
    });

    const id = `wd-${Date.now()}`;
    const rec = await prisma.withdrawal.create({
      data: {
        id,
        userId: user.id,
        network,
        address,
        amount: new Prisma.Decimal(amt),
        note: note || '',
        status: 'pending',
        createdAt: new Date(),
      },
    });

    res.json({
      success: true,
      data: {
        ...rec,
        userId: user.code,
      },
      updatedUser: { user_id: updatedUser.code, gotas_agua: toNumber(updatedUser.gotasAgua) },
    });
  } catch (err) {
    console.error('WITHDRAWALS CREATE ERROR', err);
    res.status(500).json({ success: false, message: 'Error en el servidor' });
  }
});

// WITHDRAWALS (listar)
app.get('/api/withdrawals', async (req, res) => {
  try {
    const withdrawals = await prisma.withdrawal.findMany({
      orderBy: { createdAt: 'desc' },
      include: { user: true },
    });

    const data = withdrawals.map((r) => ({
      id: r.id,
      userId: r.user.code,
      network: r.network,
      address: r.address,
      amount: toNumber(r.amount),
      note: r.note,
      status: r.status,
      created_at: r.createdAt.toISOString(),
      username: r.user ? r.user.username : r.userId,
    }));

    res.json({ success: true, total: data.length, data });
  } catch (err) {
    console.error('WITHDRAWALS LIST ERROR', err);
    res.status(500).json({ success: false, message: 'Error en el servidor' });
  }
});

// WITHDRAWALS (aprobar)
app.post('/api/withdrawals/:id/approve', async (req, res) => {
  try {
    const { id } = req.params;

    const rec = await prisma.withdrawal.findUnique({ where: { id } });
    if (!rec) return res.status(404).json({ success: false, message: 'Solicitud no encontrada' });
    if (rec.status !== 'pending') return res.status(400).json({ success: false, message: 'Solicitud ya procesada' });

    const updated = await prisma.withdrawal.update({
      where: { id },
      data: { status: 'approved' },
    });

    res.json({ success: true, message: 'Retiro aprobado', withdrawal: updated });
  } catch (err) {
    console.error('WITHDRAWALS APPROVE ERROR', err);
    res.status(500).json({ success: false, message: 'Error en el servidor' });
  }
});

// WITHDRAWALS (denegar)
app.post('/api/withdrawals/:id/deny', async (req, res) => {
  try {
    const { id } = req.params;

    const rec = await prisma.withdrawal.findUnique({ where: { id }, include: { user: true } });
    if (!rec) return res.status(404).json({ success: false, message: 'Solicitud no encontrada' });
    if (rec.status !== 'pending') return res.status(400).json({ success: false, message: 'Solicitud ya procesada' });

    // Es buena práctica verificar que el usuario aún existe
    if (!rec.user) return res.status(404).json({ success: false, message: 'El usuario asociado a este retiro ya no existe.' });

    await prisma.$transaction(async (tx) => {
      await tx.withdrawal.update({
        where: { id },
        data: { status: 'denied' },
      });

      if (rec.userId) {
        await tx.user.update({
          where: { id: rec.userId },
          data: {
            gotasAgua: (rec.user.gotasAgua || new Prisma.Decimal(0)).add(rec.amount),
          },
        });
      }
    });

    const updatedUser = rec.userId
      ? await prisma.user.findUnique({ where: { id: rec.userId } })
      : null;

    res.json({
      success: true,
      message: 'Retiro denegado y monto reintegrado',
      withdrawal: { ...rec, status: 'denied' },
      updatedUser: updatedUser
        ? { user_id: updatedUser.code, gotas_agua: toNumber(updatedUser.gotasAgua) }
        : null,
    });
  } catch (err) {
    console.error('WITHDRAWALS DENY ERROR', err);
    res.status(500).json({ success: false, message: 'Error en el servidor' });
  }
});

// FUNDS (comprar fondo marino)
app.post('/api/funds/buy', async (req, res) => {
  try {
    const { userId, amount } = req.body || {};
    const amt = parseFloat(amount || 0) || 0;
    if (!userId || amt < 15) {
      return res.status(400).json({ success: false, message: 'userId y amount >= 15 requeridos' });
    }

    const user = await prisma.user.findFirst({ where: { code: userId } });
    if (!user) return res.status(404).json({ success: false, message: 'Usuario no encontrado' });

    const balance = toNumber(user.gotasAgua);
    if (balance < amt) return res.status(400).json({ success: false, message: 'Saldo insuficiente para comprar el fondo' });

    const start = new Date();
    const end = new Date(start.getTime() + 45 * 24 * 60 * 60 * 1000);
    const expected = amt * (0.045 * 45); // misma lógica que tenías

    let updatedUser, fondo;
    await prisma.$transaction(async (tx) => {
      updatedUser = await tx.user.update({
        where: { id: user.id },
        data: {
          gotasAgua: (user.gotasAgua || new Prisma.Decimal(0)).sub(new Prisma.Decimal(amt)),
        },
      });

      fondo = await tx.fondo.create({
        data: {
          userId: user.id,
          amount: new Prisma.Decimal(amt),
          dailyRate: new Prisma.Decimal(4.5),
          days: 45,
          startDate: start,
          endDate: end,
          expectedTotal: new Prisma.Decimal(expected),
        },
      });
    });

    const fondosUser = await prisma.fondo.findMany({
      where: { userId: user.id },
    });

    res.json({
      success: true,
      message: 'Fondo comprado',
      data: {
        user_id: updatedUser.code,
        gotas_agua: toNumber(updatedUser.gotasAgua),
        fondos: fondosUser.map((f) => ({
          id: f.id,
          amount: toNumber(f.amount),
          daily_rate: toNumber(f.dailyRate),
          days: f.days,
          start_date: f.startDate.toISOString(),
          end_date: f.endDate.toISOString(),
          expected_total: toNumber(f.expectedTotal),
        })),
      },
    });
  } catch (err) {
    console.error('FUNDS BUY ERROR', err);
    res.status(500).json({ success: false, message: 'Error en el servidor' });
  }
});

// INICIO
app.listen(PORT, () => {
  console.log(`🚀 Backend DeepBlue Connect corriendo en http://localhost:${PORT}`);
});
